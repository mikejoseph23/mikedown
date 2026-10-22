// Pure tag extraction — no DOM or vscode imports, so it's unit-testable and
// usable from either bundle. Pulls tags from frontmatter `tags:` and inline
// `#tag` tokens in the body (ignoring code + link targets).

import { parseFrontmatter } from './frontmatterYaml';
import { findInlineTags, normalizeTag } from './tagSyntax';
import { matchInlineMath } from './webview/mathSyntax';

/** Split a document into its frontmatter YAML and the remaining body. */
export function splitFrontmatter(content: string): { yaml: string; body: string } {
  const lines = content.split('\n');
  if (lines[0]?.trim() !== '---') return { yaml: '', body: content };
  let i = 1;
  while (i < lines.length && lines[i].trim() !== '---') i++;
  if (i >= lines.length) return { yaml: '', body: content };
  return { yaml: lines.slice(1, i).join('\n'), body: lines.slice(i + 1).join('\n') };
}

/** Collect normalized tags from frontmatter `tags:` and inline `#tag` tokens. */
export function extractTags(content: string): Set<string> {
  const tags = new Set<string>();
  const { yaml, body } = splitFrontmatter(content);

  // Frontmatter tags / tag
  for (const entry of parseFrontmatter(yaml)) {
    const key = entry.key.toLowerCase();
    if (key !== 'tags' && key !== 'tag') continue;
    const values = Array.isArray(entry.value)
      ? entry.value
      : String(entry.value).split(/[,\s]+/);
    for (const v of values) {
      const t = normalizeTag(v);
      if (t) tags.add(t);
    }
  }

  // Inline #tags in the body, ignoring fenced code, inline code, and link targets
  for (const line of stripCode(body)) {
    for (const m of findInlineTags(line)) {
      const t = normalizeTag(m.tag);
      if (t) tags.add(t);
    }
  }

  return tags;
}

/**
 * Blank out fenced code and display-math blocks, and strip everything else
 * that can hold `#tag`-shaped text without being a tag: inline code, inline
 * `$…$` math, `[[wikilinks]]` (`[[#Heading]]` / `[[Note#Heading]]`), link and
 * image targets, reference-link definitions, and raw HTML tags (`href="#x"`).
 */
function stripCode(body: string): string[] {
  const out: string[] = [];
  let fence: string | null = null;
  let inMath = false;
  for (const line of body.split('\n')) {
    const fenceMatch = /^\s*(`{3,}|~{3,})/.exec(line);
    if (!inMath && fenceMatch) {
      const marker = fenceMatch[1];
      if (fence === null) {fence = marker;}
      else if (marker[0] === fence[0] && marker.length >= fence.length) {fence = null;}
      out.push('');
      continue;
    }
    if (fence !== null) { out.push(''); continue; }
    if (/^\s*\$\$/.test(line)) {
      // `$$` opens/closes display math; `$$x$$` on one line is self-contained.
      const oneLine = /^\s*\$\$.*\S.*\$\$\s*$/.test(line);
      if (!oneLine) {inMath = !inMath;}
      out.push('');
      continue;
    }
    if (inMath) { out.push(''); continue; }
    if (/^\s{0,3}\[[^\]]+\]:\s/.test(line)) { out.push(''); continue; } // [id]: target
    let s = line.replace(/`[^`]*`/g, ' ');   // inline code
    s = stripInlineMath(s);
    s = s.replace(/\[\[[^\]\n]*\]\]/g, ' '); // [[wikilink]]
    s = s.replace(/\]\([^)]*\)/g, '] ');     // [text](target) / ![alt](src)
    s = s.replace(/<[^>\n]*>/g, ' ');       // raw HTML tags + <autolinks>
    out.push(s);
  }
  return out;
}

/** Replace each inline `$…$` span (same delimiter rules as the editor) with a space. */
function stripInlineMath(line: string): string {
  if (!line.includes('$')) {return line;}
  let out = '';
  let i = 0;
  while (i < line.length) {
    const ch = line[i];
    if (ch === '\\') { out += line.slice(i, i + 2); i += 2; continue; }
    if (ch === '$') {
      const m = matchInlineMath(line, i);
      if (m) { out += ' '; i = m.end; continue; }
    }
    out += ch;
    i++;
  }
  return out;
}
