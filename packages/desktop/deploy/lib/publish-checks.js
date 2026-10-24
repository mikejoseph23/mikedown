/**
 * Checks shared by the staging gate (check-upload.js, run by release.sh and
 * pack-for-lymedeploy.sh) and the post-publish check (verify-published.js).
 * No I/O: callers hand in bytes, so test/unit/deploy.test.ts covers them.
 */
import crypto from 'node:crypto';
import { ALL_MANIFESTS, checkManifestShape, manifestPlatform } from './release-lib.js';
import { verifySignature } from './minisign.js';

/**
 * What a release of `platforms` ({ mac, windows }) means for each manifest:
 *   'version'  must exist and announce exactly this release's version
 *   'any'      must exist and be valid, at whatever version it is
 *   'optional' may be absent (404); if present it must be valid
 *   'absent'   must not be in the staged folder (a split release leaves it alone)
 */
export function manifestExpectations({ platforms, stage }) {
  const full = platforms.mac && platforms.windows;
  const out = {};
  for (const name of ALL_MANIFESTS) {
    const platform = manifestPlatform(name);
    if (platform) {
      out[name] = platforms[platform] ? 'version' : stage ? 'absent' : 'optional';
    } else {
      out[name] = full ? 'version' : stage ? 'absent' : 'any';
    }
  }
  return out;
}

/** Problems with one artifact's bytes against the manifest entry that points at it. */
export function checkArtifactBytes({ where, entry, data, pubkey, version }) {
  const problems = [];
  if (entry.size !== undefined && data.length !== entry.size) {
    problems.push(`${where}: ${data.length} bytes, manifest says ${entry.size}`);
  }
  if (entry.sha256 !== undefined) {
    const got = crypto.createHash('sha256').update(data).digest('hex');
    if (got !== entry.sha256) {problems.push(`${where}: sha256 ${got}, manifest says ${entry.sha256}`);}
  }
  if (entry.signature !== undefined) {
    try {
      verifySignature({ data, signature: entry.signature, pubkey, version });
    } catch (e) {
      problems.push(`${where}: signature refused: ${e.message}`);
    }
  }
  return problems;
}

/** File name a manifest URL points at, when it lives under `baseUrl`. */
export function fileForUrl(url, baseUrl) {
  const base = baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`;
  if (typeof url !== 'string' || !url.startsWith(base)) {return null;}
  return decodeURIComponent(url.slice(base.length));
}

/**
 * The staged upload folder, before anything is packed or pushed.
 *   files: { name: Buffer } for every regular file in the folder
 *   dirs:  names of any subfolders (none are allowed)
 * Returns a list of problems; empty means the folder is safe to publish.
 */
export function checkStagedUpload({ version, platforms, files, dirs = [], pubkey, baseUrl }) {
  const problems = [];
  if (dirs.length) {problems.push(`subfolders are not allowed (publish-files would mirror them): ${dirs.join(', ')}`);}
  for (const required of ['index.html', 'web.config']) {
    if (!(required in files)) {problems.push(`${required} is missing`);}
  }
  if (files['web.config'] && /<!--/.test(files['web.config'].toString('utf8'))) {
    problems.push('web.config has an XML comment (iadev-2025 has 500ed a whole folder over a commented web.config; keep it comment-free)');
  }
  if (files['web.config'] && /<remove\b/.test(files['web.config'].toString('utf8'))) {
    problems.push('web.config has a <remove> (removing an entry the server does not have is a 500)');
  }
  const expect = manifestExpectations({ platforms, stage: true });
  const referenced = new Set();
  for (const [name, rule] of Object.entries(expect)) {
    const buf = files[name];
    if (rule === 'absent') {
      if (buf) {problems.push(`${name} must not be staged in a ${platforms.mac ? 'mac' : 'windows'}-only release (it would replace the published one)`);}
      continue;
    }
    if (!buf) {problems.push(`${name} is missing`); continue;}
    let m;
    try { m = JSON.parse(buf.toString('utf8')); } catch (e) { problems.push(`${name}: not JSON (${e.message})`); continue; }
    problems.push(...checkManifestShape(name, m, { expectVersion: version, baseUrl }));
    for (const [key, entry] of Object.entries(m.platforms ?? {})) {
      const file = fileForUrl(entry?.url, baseUrl);
      if (!file || !files[file]) {problems.push(`${name}: ${key} points at ${entry?.url}, which is not in the folder`); continue;}
      referenced.add(file);
      problems.push(...checkArtifactBytes({ where: `${name} ${key}`, entry, data: files[file], pubkey, version: m.version }));
    }
    for (const [k, d] of Object.entries(m.downloads ?? {})) {
      const file = fileForUrl(d?.url, baseUrl);
      if (!file || !files[file]) {problems.push(`${name}: downloads.${k} points at ${d?.url}, which is not in the folder`); continue;}
      referenced.add(file);
      problems.push(...checkArtifactBytes({ where: `${name} downloads.${k}`, entry: { size: d.size, sha256: d.sha256 }, data: files[file], pubkey, version }));
    }
  }
  // The download page's own images (screenshots): published only when
  // index.html names them, and every one it names must be staged.
  const pageImages = files['index.html'] ? pageImageNames(files['index.html'].toString('utf8')) : [];
  for (const img of pageImages) {
    if (!files[img]) {problems.push(`index.html shows ${img}, which is not in the folder`);}
  }
  // Linux (preview) is not a platform in the manifests: it ships as a plain
  // download the page links to, so the page and the folder must agree.
  const linux = linuxArtifactName(version);
  const html = files['index.html'] ? files['index.html'].toString('utf8') : '';
  if (/@@LINUX_[A-Z]+@@/.test(html)) {problems.push('index.html still has @@LINUX_*@@ placeholders (render-page.js did not run)');}
  const pageLinksLinux = html.includes(`${baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`}${linux}`);
  if (pageLinksLinux && !files[linux]) {problems.push(`index.html links ${linux}, which is not in the folder`);}
  if (files[linux] && !pageLinksLinux) {problems.push(`${linux} is staged but index.html does not link it`);}
  if (/\.AppImage"/.test(html) && !pageLinksLinux) {problems.push('index.html links an AppImage other than this version\'s');}
  const known = new Set([...ALL_MANIFESTS, 'index.html', 'web.config', 'SHA256SUMS.txt', ...pageImages, ...(files[linux] ? [linux] : [])]);
  for (const name of Object.keys(files)) {
    if (known.has(name) || referenced.has(name)) {continue;}
    if (!name.includes(version)) {problems.push(`${name} is unversioned and nothing references it`);}
    else if (/\.sig$/.test(name)) {problems.push(`${name}: .sig files are not published (the signature is inside the manifest, and .sig may not be MIME-mapped)`);}
    else {problems.push(`${name} is not referenced by any manifest`);}
  }
  return problems;
}

/**
 * Local images the download page shows: every `src="name.png"` that is a
 * bare file name next to the page. IIS maps .png out of the box, so the
 * page's web.config needs no mimeMap (adding one would 500 the folder), and
 * pack-for-lymedeploy.sh declares its content type in the package.
 */
export function pageImageNames(html) {
  const out = new Set();
  for (const m of html.matchAll(/\bsrc="([A-Za-z0-9._-]+\.png)"/g)) {out.add(m[1]);}
  return [...out];
}

/** The Linux (preview) download: x86_64 AppImage, unsigned, no updater and no manifest entry. */
export const linuxArtifactName = (version) => `MikeDown-${version}-linux-x86_64.AppImage`;

/** Parse `shasum -a 256` output ("<hex>  <name>" per line) into { name: hex }. */
export function parseSha256Sums(text) {
  const out = {};
  for (const line of text.split(/\r?\n/)) {
    const m = /^([0-9a-f]{64}) [ *](.+)$/.exec(line.trim());
    if (m) {out[m[2]] = m[1];}
  }
  return out;
}

/**
 * Fill the download page's Linux blocks (delimited by <!--linux:begin--> and
 * <!--linux:end-->). With `linux` ({ url, size }) the placeholders become the
 * real link and size; with null the blocks are removed, so a release without
 * a Linux build never shows a dead link.
 */
export function renderLinuxPage(html, linux) {
  const block = /[ \t]*<!--linux:begin-->[\s\S]*?<!--linux:end-->[ \t]*\n?/g;
  if (!linux) {return html.replace(block, '');}
  const mb = String(Math.max(1, Math.round(linux.size / 1048576)));
  return html
    .replace(/<!--linux:(begin|end)-->/g, '')
    .replaceAll('@@LINUX_URL@@', linux.url)
    .replaceAll('@@LINUX_MB@@', mb);
}
