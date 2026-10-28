/**
 * Toolbar layout model: parse, normalize (D15), reconcile (D4), resolve,
 * serialize and the edit helpers. Pure logic, no DOM.
 *
 * Grouped by function so T1 can add cases under each describe.
 */
import { describe, expect, it } from 'vitest';
import { DEFAULT_TOOLBAR_ITEMS, TOOLBAR_ITEM_IDS } from '../src/toolbar-ids';
import {
  DEFAULT_TOOLBAR_LAYOUT,
  TOOLBAR_LAYOUT_VERSION,
  layoutWithInsert,
  layoutWithMove,
  layoutWithRemove,
  normalizeToolbarLayout,
  parseToolbarLayout,
  reconcileSeen,
  resolveToolbarLayout,
  serializeToolbarLayout,
  type ToolbarLayout,
} from '../src/toolbar-layout';

const KNOWN = TOOLBAR_ITEM_IDS as readonly string[];

/** A layout with every known id marked seen, so reconcile leaves `items` alone. */
function layout(items: unknown[], extra: Partial<ToolbarLayout> = {}): ToolbarLayout {
  return { version: 1, items: items as string[], seen: [...KNOWN], ...extra };
}

describe('M2 acceptance criteria', () => {
  it('resolveToolbarLayout(undefined) yields the default items and isDefault', () => {
    const r = resolveToolbarLayout(undefined, KNOWN, DEFAULT_TOOLBAR_ITEMS);
    expect(r.tokens).toEqual([...DEFAULT_TOOLBAR_ITEMS]);
    expect(r.isDefault).toBe(true);
  });

  it('round trips default -> serialize -> resolve as identity', () => {
    const first = resolveToolbarLayout(undefined, KNOWN, DEFAULT_TOOLBAR_ITEMS);
    const saved = serializeToolbarLayout(first.layout);
    expect(saved).toEqual(DEFAULT_TOOLBAR_LAYOUT);
    const second = resolveToolbarLayout(JSON.parse(JSON.stringify(saved)), KNOWN, DEFAULT_TOOLBAR_ITEMS);
    expect(second.tokens).toEqual(first.tokens);
    expect(second.layout).toEqual(first.layout);
    expect(second.isDefault).toBe(false);
  });

  it('keeps unknown ids of a version 7 layout out of the tokens but in the saved value', () => {
    // D15 also appends a missing `settings`, so it lands before `more`.
    const value = { version: 7, items: ['textFormat', 'hologram', 'more'], seen: [...KNOWN] };
    const r = resolveToolbarLayout(value, KNOWN, DEFAULT_TOOLBAR_ITEMS);
    expect(r.tokens).toEqual(['textFormat', 'settings', 'more']);
    expect(r.isDefault).toBe(false);
    const saved = serializeToolbarLayout(r.layout);
    expect(saved.version).toBe(7);
    expect(saved.items).toEqual(['textFormat', 'hologram', 'settings', 'more']);
  });
});

describe('parseToolbarLayout', () => {
  it('accepts an object and a JSON string', () => {
    const obj = { version: 1, items: ['textFormat', 'more'], seen: ['textFormat'] };
    expect(parseToolbarLayout(obj)).toEqual(obj);
    expect(parseToolbarLayout(JSON.stringify(obj))).toEqual(obj);
  });

  it('returns null for anything not layout-shaped', () => {
    for (const bad of [undefined, null, 5, true, [], ['textFormat'], {}, { items: 'x' }, '', 'nope', '[1]', '{"items":3}', { version: 'one', items: [] }, { version: 0, items: [] }]) {
      expect(parseToolbarLayout(bad)).toBeNull();
    }
  });

  it('defaults a missing version to 1 and a missing seen to empty', () => {
    expect(parseToolbarLayout({ items: ['textFormat'] })).toEqual({ version: 1, items: ['textFormat'], seen: [] });
  });
});

describe('normalizeToolbarLayout', () => {
  const norm = (items: unknown[]) => normalizeToolbarLayout(layout(items), KNOWN).items;

  it('drops non-string entries', () => {
    expect(norm(['textFormat', 5, null, { a: 1 }, 'link', 'settings', 'more'])).toEqual(['textFormat', 'link', 'settings', 'more']);
  });

  it('dedupes ids keeping the first occurrence', () => {
    expect(norm(['textFormat', 'link', 'undo', 'link', 'settings', 'undo', 'more'])).toEqual(['textFormat', 'link', 'undo', 'settings', 'more']);
  });

  it('moves or inserts textFormat first and more last', () => {
    expect(norm(['link', 'textFormat', 'settings', 'more', 'undo'])).toEqual(['textFormat', 'link', 'settings', 'undo', 'more']);
    expect(norm(['link', 'settings'])).toEqual(['textFormat', 'link', 'settings', 'more']);
  });

  it('appends settings before more when missing', () => {
    expect(norm(['textFormat', 'link', 'more'])).toEqual(['textFormat', 'link', 'settings', 'more']);
  });

  it('collapses runs of separators and spacers to one', () => {
    expect(norm(['textFormat', 'link', '|', '|', '~', 'undo', '~', '~', 'settings', 'more'])).toEqual(['textFormat', 'link', '|', 'undo', '~', 'settings', 'more']);
  });

  it('trims leading and trailing separators and spacers', () => {
    expect(norm(['|', '~', 'textFormat', 'link', 'settings', '|', 'more', '~'])).toEqual(['textFormat', 'link', 'settings', '|', 'more']);
    expect(norm(['textFormat', '|', 'link', 'settings', 'more'])).toEqual(['textFormat', '|', 'link', 'settings', 'more']);
    expect(norm(['link', 'settings', '~'])).toEqual(['textFormat', 'link', 'settings', 'more']);
  });

  it('keeps unknown ids in place and is idempotent', () => {
    const once = normalizeToolbarLayout(layout(['textFormat', 'hologram', 'link', 'settings', 'more']), KNOWN);
    expect(once.items).toEqual(['textFormat', 'hologram', 'link', 'settings', 'more']);
    expect(normalizeToolbarLayout(once, KNOWN)).toEqual(once);
  });

  it('preserves a higher version', () => {
    expect(normalizeToolbarLayout(layout(['textFormat'], { version: 7 }), KNOWN).version).toBe(7);
  });
});

describe('reconcileSeen', () => {
  const base = ['textFormat', 'listBlock', 'link', 'insert', 'emoji', 'headingNumbers', 'undo', 'redo', 'settings', 'more'];
  const seenWithoutAi = KNOWN.filter((id) => id !== 'ai');

  it('inserts a new id after its previous present default neighbor and marks it seen', () => {
    const r = reconcileSeen({ version: 1, items: base, seen: seenWithoutAi }, DEFAULT_TOOLBAR_ITEMS, KNOWN);
    expect(r.items.indexOf('ai')).toBe(r.items.indexOf('headingNumbers') + 1);
    expect(r.seen).toContain('ai');
  });

  it('falls back past a removed neighbor', () => {
    const items = base.filter((id) => id !== 'headingNumbers');
    const r = reconcileSeen({ version: 1, items, seen: seenWithoutAi }, DEFAULT_TOOLBAR_ITEMS, KNOWN);
    expect(r.items.indexOf('ai')).toBe(r.items.indexOf('emoji') + 1);
  });

  it('never re-adds an id that is already in seen', () => {
    const items = base.filter((id) => id !== 'emoji');
    const r = reconcileSeen({ version: 1, items, seen: [...KNOWN] }, DEFAULT_TOOLBAR_ITEMS, KNOWN);
    expect(r.items).not.toContain('emoji');
  });

  it('puts an id with no present neighbor before more', () => {
    const r = reconcileSeen({ version: 1, items: ['more'], seen: [] }, ['ai'], ['ai', 'more']);
    expect(r.items).toEqual(['ai', 'more']);
  });
});

describe('resolveToolbarLayout', () => {
  it('treats invalid or empty values as the default', () => {
    for (const bad of ['{not json', 42, { items: [] }, null]) {
      expect(resolveToolbarLayout(bad, KNOWN, DEFAULT_TOOLBAR_ITEMS).isDefault).toBe(true);
    }
  });

  it('reads a JSON string and collapses separators left behind by unknown ids', () => {
    const value = JSON.stringify(layout(['textFormat', 'link', '|', 'hologram', '|', 'undo', 'settings', 'more']));
    const r = resolveToolbarLayout(value, KNOWN, DEFAULT_TOOLBAR_ITEMS);
    expect(r.tokens).toEqual(['textFormat', 'link', '|', 'undo', 'settings', 'more']);
    expect(r.layout.items).toContain('hologram');
  });
});

describe('serializeToolbarLayout', () => {
  it('sorts seen in default order, unknown ids last, and sets the version', () => {
    const saved = serializeToolbarLayout({ version: 0, items: ['textFormat', 'more'], seen: ['more', 'zzz', 'link', 'textFormat', 'link'] });
    expect(saved.version).toBe(TOOLBAR_LAYOUT_VERSION);
    expect(saved.seen).toEqual(['textFormat', 'link', 'more', 'zzz']);
  });
});

describe('layout edit helpers', () => {
  const l = layout(['textFormat', 'link', '|', 'undo', 'settings', 'more']);

  it('moves an item, clamped between the pinned ends', () => {
    expect(layoutWithMove(l, 1, 3).items).toEqual(['textFormat', '|', 'undo', 'link', 'settings', 'more']);
    expect(layoutWithMove(l, 3, 0).items).toEqual(['textFormat', 'undo', 'link', '|', 'settings', 'more']);
    expect(layoutWithMove(l, 1, 99).items).toEqual(['textFormat', '|', 'undo', 'settings', 'link', 'more']);
  });

  it('refuses to move pinned items', () => {
    expect(layoutWithMove(l, 0, 2)).toBe(l);
    expect(layoutWithMove(l, 5, 1)).toBe(l);
  });

  it('removes removable items and keeps them in seen', () => {
    const r = layoutWithRemove(layout(['textFormat', 'link', 'settings', 'more'], { seen: [] }), 1);
    expect(r.items).toEqual(['textFormat', 'settings', 'more']);
    expect(r.seen).toContain('link');
  });

  it('refuses to remove textFormat, settings and more', () => {
    expect(layoutWithRemove(l, 0)).toBe(l);
    expect(layoutWithRemove(l, 4)).toBe(l);
    expect(layoutWithRemove(l, 5)).toBe(l);
  });

  it('inserts a separator or spacer anywhere between the pinned ends, repeatedly', () => {
    const once = layoutWithInsert(l, '~', 2);
    expect(once.items).toEqual(['textFormat', 'link', '~', '|', 'undo', 'settings', 'more']);
    expect(layoutWithInsert(once, '~', 2).items.filter((t) => t === '~')).toHaveLength(2);
    expect(layoutWithInsert(l, '|', 0).items[0]).toBe('textFormat');
    expect(layoutWithInsert(l, '|', 99).items.at(-1)).toBe('more');
  });

  it('inserts an id once and refuses duplicates and pinned ids', () => {
    const r = layoutWithInsert(layout(['textFormat', 'settings', 'more'], { seen: [] }), 'emoji', 1);
    expect(r.items).toEqual(['textFormat', 'emoji', 'settings', 'more']);
    expect(layoutWithInsert(r, 'emoji', 1)).toBe(r);
    expect(layoutWithInsert(r, 'more', 1)).toBe(r);
  });

  it('does not mutate its input', () => {
    const before = JSON.stringify(l);
    layoutWithMove(l, 1, 3);
    layoutWithRemove(l, 1);
    layoutWithInsert(l, '~', 2);
    expect(JSON.stringify(l)).toBe(before);
  });
});
