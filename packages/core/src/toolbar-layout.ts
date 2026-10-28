/**
 * Toolbar layout model: schema, parse, normalize, migrate and edit helpers.
 *
 * Pure logic, no DOM. A layout is one self-contained, versioned value:
 *
 *     { version: 1, items: ['textFormat', ..., '|', ..., '~', ..., 'more'], seen: [...] }
 *
 * `items` holds registry ids plus `'|'` (separator) and `'~'` (flexible
 * spacer). `seen` lists every registry id the layout has been reconciled
 * against, so a button added by a later core is inserted next to its default
 * neighbor while a button the user removed stays removed.
 *
 * Normalization rules (D15), applied by {@link normalizeToolbarLayout}:
 *
 * - Non-string entries are dropped.
 * - Duplicate ids keep the first occurrence.
 * - `textFormat` is moved or inserted first; `more` is moved or appended last;
 *   `settings` is appended before `more` if missing.
 * - Runs of the same divider collapse to one (`| |` is one separator, `~ ~` one
 *   spacer). A separator next to a spacer is kept: a line followed by flexible
 *   space is a deliberate arrangement, and the renderer shows both.
 * - Leading and trailing `'|'`/`'~'` are trimmed (of the list as written; a
 *   separator right after `textFormat` or right before `more` is a deliberate
 *   placement and is kept).
 * - Unknown ids are kept in place (skipped at render, preserved on save).
 * - A `version` greater than 1 is read the same way.
 * - Non-object or wrong-shape values mean the default layout (nothing is
 *   written back until the next save).
 */
import {
  DEFAULT_TOOLBAR_ITEMS,
  TOOLBAR_ITEM_IDS,
  TOOLBAR_ITEM_TRAITS,
  TOOLBAR_SEPARATOR,
  TOOLBAR_SPACER,
  isToolbarItemId,
  type ToolbarLayoutToken,
} from './toolbar-ids';

/** The schema version this core writes and fully understands. */
export const TOOLBAR_LAYOUT_VERSION = 1;

/**
 * A toolbar layout. `items` and `seen` are plain strings (not
 * {@link ToolbarLayoutToken}) because a hand-edited or newer-version layout may
 * carry ids this core does not know; they are skipped at render and preserved
 * on save. All helpers return new objects and never mutate their input.
 */
export interface ToolbarLayout {
  /** Schema version. Higher versions are accepted and preserved. */
  readonly version: number;
  /** Registry ids, `'|'` separators and `'~'` flexible spacers, in toolbar order. */
  readonly items: readonly string[];
  /** Every registry id this layout has been reconciled against. */
  readonly seen: readonly string[];
}

/** Ids may be passed as a set or any iterable (e.g. `TOOLBAR_ITEM_IDS`). */
export type ToolbarKnownIds = ReadonlySet<string> | Iterable<string>;

/** The default layout: today's toolbar, every known id marked seen. Frozen. */
export const DEFAULT_TOOLBAR_LAYOUT: ToolbarLayout = Object.freeze({
  version: TOOLBAR_LAYOUT_VERSION,
  items: DEFAULT_TOOLBAR_ITEMS as readonly string[],
  seen: Object.freeze([...TOOLBAR_ITEM_IDS]) as readonly string[],
});

function toSet(ids: ToolbarKnownIds): ReadonlySet<string> {
  return ids instanceof Set ? ids : new Set(ids as Iterable<string>);
}

function isSpacing(token: string): boolean {
  return token === TOOLBAR_SEPARATOR || token === TOOLBAR_SPACER;
}

/** Collapse runs of the same separator/spacer to one, then trim both ends. */
function collapseSpacing(items: readonly string[]): string[] {
  const out: string[] = [];
  for (const token of items) {
    if (isSpacing(token) && out.length > 0 && out[out.length - 1] === token) { continue; }
    out.push(token);
  }
  while (out.length > 0 && isSpacing(out[0])) { out.shift(); }
  while (out.length > 0 && isSpacing(out[out.length - 1])) { out.pop(); }
  return out;
}

/** Strings only, first occurrence wins. */
function dedupeStrings(values: unknown): string[] {
  const out: string[] = [];
  if (!Array.isArray(values)) { return out; }
  const seen = new Set<string>();
  for (const v of values) {
    if (typeof v !== 'string' || seen.has(v)) { continue; }
    seen.add(v);
    out.push(v);
  }
  return out;
}

/**
 * Parse a stored value into a layout, or `null` when it is not layout-shaped.
 *
 * Accepts a plain object or a JSON string. The value must be an object with an
 * `items` array; `version` (when present) must be a positive integer, and
 * defaults to 1 when absent; `seen` defaults to `[]` when absent or not an
 * array. Entries are not validated here (that is {@link normalizeToolbarLayout}'s
 * job); the arrays are copied, so the result never aliases the input.
 * Invalid JSON, arrays, numbers, `null` and `undefined` all give `null`
 * (meaning: use the default layout).
 */
export function parseToolbarLayout(value: unknown): ToolbarLayout | null {
  let raw: unknown = value;
  if (typeof raw === 'string') {
    try { raw = JSON.parse(raw); } catch { return null; }
  }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) { return null; }
  const obj = raw as Record<string, unknown>;
  if (!Array.isArray(obj.items)) { return null; }
  let version = TOOLBAR_LAYOUT_VERSION;
  if (obj.version !== undefined) {
    if (typeof obj.version !== 'number' || !Number.isInteger(obj.version) || obj.version < 1) { return null; }
    version = obj.version;
  }
  const seen = Array.isArray(obj.seen) ? [...(obj.seen as unknown[])] : [];
  return { version, items: [...(obj.items as unknown[])] as string[], seen: seen as string[] };
}

/**
 * Apply the D15 rules so the toolbar always renders something sane: drop
 * non-strings, dedupe ids keeping the first, put `textFormat` first and `more`
 * last, append `settings` before `more` if missing, collapse runs of the same
 * divider (`'|'` or `'~'`) to one and trim leading/trailing ones. Unknown ids (not in `knownIds`) stay in
 * place. `version` is preserved (a version above 1 is read the same way). `seen`
 * is reduced to unique strings. Idempotent.
 *
 * `knownIds` is accepted for symmetry with the other entry points; the rules
 * above only need to know which ids are pinned, which the shared table covers.
 */
export function normalizeToolbarLayout(layout: ToolbarLayout, knownIds: ToolbarKnownIds = TOOLBAR_ITEM_IDS): ToolbarLayout {
  void knownIds;
  const ordered: string[] = [];
  const have = new Set<string>();
  for (const token of Array.isArray(layout.items) ? layout.items : []) {
    if (typeof token !== 'string') { continue; }
    if (!isSpacing(token)) {
      if (have.has(token)) { continue; }
      have.add(token);
    }
    ordered.push(token);
  }
  // Trim the ends of what the user wrote, then lift out the pinned items and
  // put them back at their ends.
  const body = collapseSpacing(ordered).filter((t) => t !== 'textFormat' && t !== 'more');
  if (!have.has('settings')) { body.push('settings'); }
  const items = collapseSpacing(['textFormat', ...body, 'more']);
  return {
    version: typeof layout.version === 'number' && layout.version >= 1 ? layout.version : TOOLBAR_LAYOUT_VERSION,
    items,
    seen: dedupeStrings(layout.seen),
  };
}

/**
 * Migrate a layout forward (D4): every id in `knownIds` that is not in `seen`
 * is handled in `defaultItems` order. If the layout already shows it, it is
 * only added to `seen`. Otherwise it is inserted right after its previous
 * default neighbor that is present in the layout, else right before its next
 * default neighbor that is present, else before `more` (else appended); then it
 * is added to `seen`. An id already in `seen` is never re-added, so a button
 * the user removed stays removed. Separators and spacers are never neighbors;
 * an insertion never lands after `more`. Ids in `knownIds` that `defaultItems`
 * does not mention go before `more`. Unknown ids in `seen` are preserved.
 */
export function reconcileSeen(layout: ToolbarLayout, defaultItems: readonly string[], knownIds: ToolbarKnownIds): ToolbarLayout {
  const known = toSet(knownIds);
  const items = [...layout.items];
  const seen = new Set(layout.seen);
  const seenOut = [...layout.seen];
  const order = orderedKnown(defaultItems, known);

  const beforeMore = (): number => {
    const m = items.lastIndexOf('more');
    return m === -1 ? items.length : m;
  };

  for (const id of order) {
    if (seen.has(id)) { continue; }
    seen.add(id);
    seenOut.push(id);
    if (items.includes(id)) { continue; }
    const at = defaultItems.indexOf(id);
    let index = -1;
    if (at !== -1) {
      for (let i = at - 1; i >= 0 && index === -1; i--) {
        const prev = defaultItems[i];
        if (isSpacing(prev)) { continue; }
        const pos = items.indexOf(prev);
        if (pos !== -1) { index = prev === 'more' ? pos : pos + 1; }
      }
      for (let i = at + 1; i < defaultItems.length && index === -1; i++) {
        const next = defaultItems[i];
        if (isSpacing(next)) { continue; }
        const pos = items.indexOf(next);
        if (pos !== -1) { index = pos; }
      }
    }
    if (index === -1) { index = beforeMore(); }
    items.splice(index, 0, id);
  }
  return { version: layout.version, items, seen: seenOut };
}

/** Known ids in default order, then any the default does not mention. */
function orderedKnown(defaultItems: readonly string[], known: ReadonlySet<string>): string[] {
  const out: string[] = [];
  for (const t of defaultItems) {
    if (!isSpacing(t) && known.has(t) && !out.includes(t)) { out.push(t); }
  }
  for (const id of known) {
    if (!out.includes(id)) { out.push(id); }
  }
  return out;
}

/** The result of {@link resolveToolbarLayout}. */
export interface ResolvedToolbarLayout {
  /** What to render: known ids plus `'|'`/`'~'`, spacing collapsed and trimmed. Unknown ids are left out. */
  readonly tokens: ToolbarLayoutToken[];
  /** The full normalized and reconciled layout, unknown ids still in place. Use as the edit-mode working copy. */
  readonly layout: ToolbarLayout;
  /** True when `value` was empty or invalid and the default layout was used. */
  readonly isDefault: boolean;
}

/**
 * The single entry the editor calls with a stored `toolbarLayout` setting.
 *
 * Parses `value` (object or JSON string); an empty, missing or invalid value
 * (or one with an empty `items` array) gives the default layout and
 * `isDefault: true`. Otherwise the layout is normalized (D15), reconciled
 * against `knownIds`/`defaultItems` (D4) and normalized again. `tokens` is
 * `layout.items` minus unknown ids, with separators/spacers collapsed and
 * trimmed again since dropping an unknown id can leave two side by side.
 * Availability (`available()`) is not applied here: unavailable items keep
 * their slot and are skipped by the renderer.
 */
export function resolveToolbarLayout(value: unknown, knownIds: ToolbarKnownIds, defaultItems: readonly string[]): ResolvedToolbarLayout {
  const known = toSet(knownIds);
  const parsed = parseToolbarLayout(value);
  const isDefault = !parsed || parsed.items.length === 0;
  const start: ToolbarLayout = isDefault
    ? { version: TOOLBAR_LAYOUT_VERSION, items: [...defaultItems], seen: orderedKnown(defaultItems, known) }
    : parsed;
  const layout = normalizeToolbarLayout(reconcileSeen(normalizeToolbarLayout(start, known), defaultItems, known), known);
  const tokens = collapseSpacing(layout.items.filter((t) => isSpacing(t) || known.has(t))) as ToolbarLayoutToken[];
  return { tokens, layout, isDefault };
}

/**
 * The value to persist. Copies `items` as they are (unknown ids kept in place),
 * sets `version` to the layout's version, never lower than
 * {@link TOOLBAR_LAYOUT_VERSION} (so a newer layout is not downgraded), and
 * sorts `seen` in default order (known ids first in {@link TOOLBAR_ITEM_IDS}
 * order, then unknown ids in their original order) with duplicates and
 * non-strings removed, for stable diffs.
 */
export function serializeToolbarLayout(layout: ToolbarLayout): ToolbarLayout {
  const seen = dedupeStrings(layout.seen);
  const rank = (id: string): number => {
    const i = (TOOLBAR_ITEM_IDS as readonly string[]).indexOf(id);
    return i === -1 ? TOOLBAR_ITEM_IDS.length : i;
  };
  const sorted = seen.map((id, i) => ({ id, i })).sort((a, b) => rank(a.id) - rank(b.id) || a.i - b.i).map((e) => e.id);
  return {
    version: Math.max(typeof layout.version === 'number' ? layout.version : 1, TOOLBAR_LAYOUT_VERSION),
    items: layout.items.filter((t): t is string => typeof t === 'string'),
    seen: sorted,
  };
}

function isPinned(token: string): boolean {
  return isToolbarItemId(token) && TOOLBAR_ITEM_TRAITS[token].pinned !== undefined;
}

/** Index range a non-pinned entry may occupy among `items`: `[lo, hi]` inclusive. */
function movableRange(items: readonly string[]): { lo: number; hi: number } {
  const first = items.length > 0 && items[0] === 'textFormat';
  const last = items.length > 0 && items[items.length - 1] === 'more';
  return { lo: first ? 1 : 0, hi: items.length - 1 - (last ? 1 : 0) };
}

/**
 * Move the entry at `from` so it ends up at index `to` of the result. Entries
 * are addressed by index because separators and spacers have no unique id.
 * Pinned items (`textFormat`, `more`) cannot be moved and nothing can move past
 * them: `to` is clamped between the pinned ends. A separator or spacer can move
 * anywhere between them. Returns the same `layout` object when nothing changes
 * (out-of-range `from`, pinned item, or already in place). `seen` is untouched.
 * Does not collapse neighbouring separators; that happens on normalize/render.
 */
export function layoutWithMove(layout: ToolbarLayout, from: number, to: number): ToolbarLayout {
  const items = [...layout.items];
  if (!Number.isInteger(from) || !Number.isInteger(to) || from < 0 || from >= items.length) { return layout; }
  if (isPinned(items[from])) { return layout; }
  const { lo, hi } = movableRange(items);
  const dest = Math.min(Math.max(to, lo), hi);
  if (dest === from) { return layout; }
  const [token] = items.splice(from, 1);
  items.splice(dest, 0, token);
  return { ...layout, items };
}

/**
 * Remove the entry at `index`. Pinned and non-removable items (`textFormat`,
 * `settings`, `more`) are refused; separators, spacers and every other id can be
 * removed. A removed id is added to `seen` so it stays removed after the next
 * reconcile. Returns the same `layout` object when refused or out of range.
 */
export function layoutWithRemove(layout: ToolbarLayout, index: number): ToolbarLayout {
  if (!Number.isInteger(index) || index < 0 || index >= layout.items.length) { return layout; }
  const token = layout.items[index];
  if (isToolbarItemId(token) && !TOOLBAR_ITEM_TRAITS[token].removable) { return layout; }
  const items = [...layout.items];
  items.splice(index, 1);
  const seen = isSpacing(token) || layout.seen.includes(token) ? [...layout.seen] : [...layout.seen, token];
  return { ...layout, items, seen };
}

/**
 * Insert `token` (a registry id, `'|'` or `'~'`) before the entry currently at
 * `index` (`index === items.length` appends), clamped so it lands between the
 * pinned ends: never before `textFormat`, never after `more`. A separator or
 * spacer can be inserted anywhere in that range, repeatedly; an id already in
 * the layout, a pinned id, or an empty/non-string token is refused. An inserted
 * id is added to `seen`. Returns the same `layout` object when refused.
 */
export function layoutWithInsert(layout: ToolbarLayout, token: string, index: number): ToolbarLayout {
  if (typeof token !== 'string' || token === '' || !Number.isInteger(index)) { return layout; }
  if (!isSpacing(token) && (isPinned(token) || layout.items.includes(token))) { return layout; }
  const items = [...layout.items];
  const { lo, hi } = movableRange(items);
  const at = Math.min(Math.max(index, lo), hi + 1);
  items.splice(at, 0, token);
  const seen = isSpacing(token) || layout.seen.includes(token) ? [...layout.seen] : [...layout.seen, token];
  return { ...layout, items, seen };
}
