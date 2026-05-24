// Shared frontmatter YAML helpers — pure, no DOM or vscode imports so both
// the extension-host and webview bundles can consume it (see
// `imageDisplayPath.ts` for the same cross-bundle pattern).
//
// Scope: top-level scalar key:value pairs and single-line / block-style
// arrays of scalars. Anything more complex — nested maps, multi-line
// values, anchors, etc. — degrades to a string value. That's intentional:
// we'd rather show the literal text than guess wrong, and the editor
// still exposes the full YAML source via the frontmatter block.

export interface ParsedEntry {
  key: string;
  /** Scalar string, or array of strings (for `tags: [a, b]`-style). */
  value: string | string[];
}

export function parseFrontmatter(yaml: string): ParsedEntry[] {
  if (!yaml) return [];
  const entries: ParsedEntry[] = [];
  const lines = yaml.split('\n');

  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];
    if (!raw.trim() || raw.trim().startsWith('#')) continue;
    if (/^\s/.test(raw)) continue;

    const match = raw.match(/^([^:]+):\s*(.*)$/);
    if (!match) continue;
    const key = match[1].trim();
    const rest = match[2];

    if (!rest) {
      const items: string[] = [];
      let j = i + 1;
      while (j < lines.length && /^\s+-\s+/.test(lines[j])) {
        items.push(stripQuotes(lines[j].replace(/^\s+-\s+/, '').trim()));
        j++;
      }
      if (items.length > 0) {
        entries.push({ key, value: items });
        i = j - 1;
      } else {
        entries.push({ key, value: '' });
      }
      continue;
    }

    const flowMatch = rest.match(/^\[(.*)\]\s*$/);
    if (flowMatch) {
      const items = flowMatch[1]
        .split(',')
        .map(s => stripQuotes(s.trim()))
        .filter(s => s.length > 0);
      entries.push({ key, value: items });
      continue;
    }

    entries.push({ key, value: stripQuotes(rest.trim()) });
  }

  return entries;
}

/**
 * Emit entries as a YAML frontmatter body (no leading/trailing `---`).
 * Preserves entry order. Arrays are emitted flow-style (`[a, b]`); scalar
 * values are quoted only when YAML would otherwise re-parse them as a
 * different type (numbers, booleans, etc.) or when they contain special
 * characters. Original quoting style is NOT preserved — round-tripping is
 * semantic (parse(serialize(entries)) deep-equals entries), not byte-exact.
 */
export function serializeFrontmatter(entries: ParsedEntry[]): string {
  const lines: string[] = [];
  for (const entry of entries) {
    if (Array.isArray(entry.value)) {
      const items = entry.value.map(quoteScalarIfNeeded).join(', ');
      lines.push(`${entry.key}: [${items}]`);
    } else {
      const v = entry.value;
      if (v === '') {
        lines.push(`${entry.key}:`);
      } else {
        lines.push(`${entry.key}: ${quoteScalarIfNeeded(v)}`);
      }
    }
  }
  return lines.join('\n');
}

/**
 * True when every non-blank, non-comment line in the YAML is something the
 * parser fully represents — top-level `key: value`, top-level `key:` followed
 * by `  - item` lines, flow-style arrays. False when the YAML contains
 * nested maps, multi-line scalars, anchors, or anything else that round-trips
 * lossily. The sidebar uses this to gate inline editing — when false, edits
 * would silently drop content, so we keep the section read-only.
 */
export function isSimpleFrontmatter(yaml: string): boolean {
  if (!yaml) return true;
  const lines = yaml.split('\n');
  let prevWasBareKey = false;
  for (const raw of lines) {
    const trimmed = raw.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    if (/^\s/.test(raw)) {
      // Indented line — only allowed as a block-array item directly under a bare key.
      if (prevWasBareKey && /^\s+-\s+/.test(raw)) continue;
      return false;
    }
    const m = raw.match(/^([^:]+):\s*(.*)$/);
    if (!m) return false;
    prevWasBareKey = m[2] === '';
  }
  return true;
}

function stripQuotes(s: string): string {
  if ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'"))) {
    return s.slice(1, -1);
  }
  return s;
}

function quoteScalarIfNeeded(s: string): string {
  if (s === '') return '""';
  // Anything that looks like YAML structure or reserved scalars must be quoted
  // so it parses back as a string.
  const needsQuoteForChars = /[:#\[\]{},&*!|>'"%@`]/.test(s) || /^\s|\s$/.test(s);
  const looksLikeBoolNumNull = /^(-?\d+(\.\d+)?|true|false|null|yes|no|on|off|~)$/i.test(s);
  if (needsQuoteForChars || looksLikeBoolNumNull) {
    return `"${s.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
  }
  return s;
}
