// Minimal YAML frontmatter parser scoped to what the sidebar Properties
// section needs to render: top-level scalar key:value pairs and single-line
// flow-style arrays (`tags: [foo, bar]`). Anything more complex — nested
// maps, multi-line values, anchors, etc. — degrades to a string value
// (the raw line tail). That's intentional: we'd rather show the literal
// text than guess wrong, and the editor already exposes the full YAML
// source via the existing frontmatter block.

export interface ParsedEntry {
  key: string;
  value: string | string[];
}

export function parseFrontmatter(yaml: string): ParsedEntry[] {
  if (!yaml) return [];
  const entries: ParsedEntry[] = [];
  const lines = yaml.split('\n');

  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];
    // Skip blank lines and comments.
    if (!raw.trim() || raw.trim().startsWith('#')) continue;
    // Only top-level keys — skip lines that are indented (nested map values).
    if (/^\s/.test(raw)) continue;

    const match = raw.match(/^([^:]+):\s*(.*)$/);
    if (!match) continue;
    const key = match[1].trim();
    const rest = match[2];

    if (!rest) {
      // Block-style list: collect indented `- ` lines that follow.
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

    // Flow-style array: tags: [a, b, c]
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

function stripQuotes(s: string): string {
  if ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'"))) {
    return s.slice(1, -1);
  }
  return s;
}
