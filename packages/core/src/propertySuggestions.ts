/**
 * Applying one Properties suggestion chip (D5): the frontmatter entries with
 * that title, description or tag merged in. Pure; editor.ts serialises the
 * result and records it as one undo step.
 */

import type { ParsedEntry } from './shared/frontmatterYaml';
import { normalizeTag } from './shared/tagSyntax';

export type PropertySuggestionPick =
  | { kind: 'title'; value: string }
  | { kind: 'description'; value: string }
  | { kind: 'tag'; tag: string };

const isKey = (entry: ParsedEntry, key: string): boolean => entry.key.trim().toLowerCase() === key;
const isTagsKey = (entry: ParsedEntry): boolean => /^tags?$/i.test(entry.key.trim());

/** A scalar `tags:` value as a list: `a, b` and `a b` both split; `#` kept off. */
function tagList(value: string | string[]): string[] {
  const parts = Array.isArray(value) ? value : value.split(/[,\s]+/);
  return parts.map((p) => p.trim()).filter(Boolean);
}

/**
 * The entries with `pick` applied: title and description set or replaced
 * (a new title goes first, a new description after the title), a tag
 * appended to the existing `tags:` (or `tag:`) list, a scalar list turned
 * into an array, or a new `tags:` entry at the end. A tag already there
 * leaves the entries as they are. The input is not changed.
 */
export function mergePropertySuggestion(entries: readonly ParsedEntry[], pick: PropertySuggestionPick): ParsedEntry[] {
  const out = entries.map((e) => ({ key: e.key, value: Array.isArray(e.value) ? [...e.value] : e.value }));
  if (pick.kind === 'tag') {
    const tag = normalizeTag(pick.tag);
    if (!tag) {return out;}
    const i = out.findIndex(isTagsKey);
    if (i < 0) {
      out.push({ key: 'tags', value: [tag] });
      return out;
    }
    const list = tagList(out[i].value);
    if (!list.some((t) => normalizeTag(t) === tag)) {list.push(tag);}
    out[i] = { key: out[i].key, value: list };
    return out;
  }
  const key = pick.kind;
  const i = out.findIndex((e) => isKey(e, key));
  if (i >= 0) {
    out[i] = { key: out[i].key, value: pick.value };
    return out;
  }
  const titleAt = out.findIndex((e) => isKey(e, 'title'));
  out.splice(key === 'title' ? 0 : titleAt + 1, 0, { key, value: pick.value });
  return out;
}
