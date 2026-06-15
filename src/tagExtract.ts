// Pure tag extraction — no DOM or vscode imports, so it's unit-testable and
// usable from either bundle. Pulls tags from frontmatter `tags:` and inline
// `#tag` tokens in the body (ignoring code + link targets).

import { parseFrontmatter } from './frontmatterYaml';
import { findInlineTags, normalizeTag } from './tagSyntax';

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
 * Blank out fenced code blocks and strip inline code spans + markdown link/
 * image targets so `#tag`-shaped text inside them isn't indexed.
 */
function stripCode(body: string): string[] {
  const out: string[] = [];
  let inFence = false;
  for (const line of body.split('\n')) {
    if (/^\s*(```+|~~~+)/.test(line)) {
      inFence = !inFence;
      out.push('');
      continue;
    }
    if (inFence) { out.push(''); continue; }
    let s = line.replace(/`[^`]*`/g, ' '); // inline code
    s = s.replace(/\]\([^)]*\)/g, '] ');    // [text](target) / ![alt](src)
    out.push(s);
  }
  return out;
}
