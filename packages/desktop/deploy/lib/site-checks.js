/**
 * Site-only package gate (pack-for-lymedeploy.sh --site). No I/O: callers hand
 * in bytes, so test/unit/release-pipeline.test.ts covers it.
 *
 * The site package is published into the same folder as a desktop release, and
 * publish-files only adds and replaces, so it is safe exactly as long as it
 * carries no manifest, no artifact and no web.config of its own.
 *
 *   files: { 'relative/posix/path': Buffer } for every file in the package
 *
 * Returns { problems, warnings }. Problems block the pack. Warnings name file
 * extensions iadev-prod may not serve (HEAD one after the first publish; never
 * add a mimeMap for a type that is already mapped, it 500s the whole folder).
 */
import { pageImageNames } from './publish-checks.js';

export const SITE_TOP_DIRS = ['vscode', 'developers', 'site-assets'];
const SITE_REQUIRED = ['index.html', 'vscode/index.html', 'developers/index.html'];
const FORBIDDEN_EXT = /\.(dmg|exe|gz|tgz|sig|appimage|nupkg|msi|pkg|zip)$/i;
// Served as-is by the folder: IIS defaults plus the machine-wide maps.
const SERVED_EXT = new Set(['html', 'js', 'css', 'png', 'jpg', 'jpeg', 'ico', 'txt', 'json', 'gif']);

export function checkSitePackage({ files }) {
  const problems = [];
  const warnings = [];
  for (const req of SITE_REQUIRED) {
    if (!files[req]) {problems.push(`${req} is missing`);}
  }
  const exts = new Set();
  for (const name of Object.keys(files)) {
    const base = name.split('/').pop();
    const lower = base.toLowerCase();
    if (/^latest.*\.json$/.test(lower)) {problems.push(`${name}: manifests belong to desktop releases (it would replace the published one)`);}
    if (FORBIDDEN_EXT.test(lower)) {problems.push(`${name}: release artifacts belong to desktop releases`);}
    if (lower === 'web.config') {problems.push(`${name}: web.config is protected and must not be in a site package`);}
    if (lower === 'sha256sums.txt') {problems.push(`${name}: SHA256SUMS.txt would replace the desktop release's checksums`);}
    const top = name.includes('/') ? name.split('/')[0] : null;
    if (top && !SITE_TOP_DIRS.includes(top)) {
      problems.push(`${name}: top-level folder '${top}' is not a site folder (${SITE_TOP_DIRS.join(', ')})`);
    }
    if (!top && name !== 'index.html' && name !== 'favicon.ico' && !/^[A-Za-z0-9._-]+\.png$/.test(name)) {
      problems.push(`${name}: only index.html, favicon.ico and the .png screenshots and icons may sit at the top level`);
    }
    const dot = base.lastIndexOf('.');
    if (dot > 0) {exts.add(base.slice(dot + 1).toLowerCase());}
  }
  const html = files['index.html'] ? files['index.html'].toString('utf8') : '';
  if (/@@LINUX_[A-Z]+@@/.test(html)) {problems.push('index.html still has @@LINUX_*@@ placeholders (render-page.js did not run)');}
  for (const img of pageImageNames(html)) {
    if (!files[img]) {problems.push(`index.html shows ${img}, which is not in the package`);}
  }
  for (const ext of [...exts].sort()) {
    if (!SERVED_EXT.has(ext)) {warnings.push(`.${ext}: not known to be served by iadev-prod; HEAD one after the first publish`);}
  }
  return { problems, warnings };
}
