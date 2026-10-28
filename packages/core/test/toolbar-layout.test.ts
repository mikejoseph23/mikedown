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

  it('collapses runs of the same divider to one', () => {
    expect(norm(['textFormat', 'link', '|', '|', '~', 'undo', '~', '~', 'settings', 'more'])).toEqual(['textFormat', 'link', '|', '~', 'undo', '~', 'settings', 'more']);
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

describe('D15 rules, one case each', () => {
  const norm = (items: unknown[], extra: Partial<ToolbarLayout> = {}) => normalizeToolbarLayout(layout(items, extra), KNOWN);

  it('non-object and wrong-shape values mean the default and are not written back', () => {
    for (const bad of [undefined, null, 7, 'text', [], ['textFormat'], { items: 'x' }, { version: 1 }]) {
      const r = resolveToolbarLayout(bad, KNOWN, DEFAULT_TOOLBAR_ITEMS);
      expect(r.isDefault).toBe(true);
      expect(r.tokens).toEqual([...DEFAULT_TOOLBAR_ITEMS]);
    }
  });

  it('drops numbers, null, objects and arrays from items', () => {
    expect(norm(['textFormat', 1, null, undefined, ['link'], true, 'undo', 'settings', 'more']).items)
      .toEqual(['textFormat', 'undo', 'settings', 'more']);
  });

  it('keeps the first of a duplicated id, wherever the second sits', () => {
    expect(norm(['textFormat', 'undo', 'link', 'undo', 'settings', 'more']).items).toEqual(['textFormat', 'undo', 'link', 'settings', 'more']);
    expect(norm(['textFormat', 'settings', 'settings', 'more', 'more']).items).toEqual(['textFormat', 'settings', 'more']);
  });

  it('dedupes unknown ids too', () => {
    expect(norm(['textFormat', 'hologram', 'link', 'hologram', 'settings', 'more']).items).toEqual(['textFormat', 'hologram', 'link', 'settings', 'more']);
  });

  it('moves textFormat to the front when it is elsewhere', () => {
    expect(norm(['link', 'undo', 'textFormat', 'settings', 'more']).items).toEqual(['textFormat', 'link', 'undo', 'settings', 'more']);
  });

  it('inserts textFormat first when it is missing', () => {
    expect(norm(['link', 'settings', 'more']).items[0]).toBe('textFormat');
  });

  it('moves more to the end when it is elsewhere', () => {
    expect(norm(['textFormat', 'more', 'link', 'settings']).items).toEqual(['textFormat', 'link', 'settings', 'more']);
  });

  it('appends more when it is missing', () => {
    expect(norm(['textFormat', 'link', 'settings']).items.at(-1)).toBe('more');
  });

  it('appends settings before more when it is missing, and leaves it where it is when present', () => {
    expect(norm(['textFormat', 'link', 'more']).items).toEqual(['textFormat', 'link', 'settings', 'more']);
    expect(norm(['textFormat', 'settings', 'link', 'more']).items).toEqual(['textFormat', 'settings', 'link', 'more']);
  });

  it('collapses a run of separators to one', () => {
    expect(norm(['textFormat', 'link', '|', '|', '|', 'undo', 'settings', 'more']).items).toEqual(['textFormat', 'link', '|', 'undo', 'settings', 'more']);
  });

  it('collapses a run of spacers to one', () => {
    expect(norm(['textFormat', 'link', '~', '~', '~', 'undo', 'settings', 'more']).items).toEqual(['textFormat', 'link', '~', 'undo', 'settings', 'more']);
  });

  it('keeps a separator next to a spacer (the renderer shows both)', () => {
    expect(norm(['textFormat', 'link', '|', '~', 'undo', 'settings', 'more']).items).toEqual(['textFormat', 'link', '|', '~', 'undo', 'settings', 'more']);
    expect(norm(['textFormat', 'link', '~', '|', 'undo', 'settings', 'more']).items).toEqual(['textFormat', 'link', '~', '|', 'undo', 'settings', 'more']);
    expect(norm(['textFormat', 'link', '|', '~', '~', '|', '|', 'undo', 'settings', 'more']).items).toEqual(['textFormat', 'link', '|', '~', '|', 'undo', 'settings', 'more']);
  });

  it('trims leading dividers', () => {
    expect(norm(['|', '~', '|', 'textFormat', 'link', 'settings', 'more']).items).toEqual(['textFormat', 'link', 'settings', 'more']);
  });

  it('trims trailing dividers', () => {
    expect(norm(['textFormat', 'link', 'settings', 'more', '|', '~']).items).toEqual(['textFormat', 'link', 'settings', 'more']);
  });

  it('keeps a divider placed deliberately right after textFormat or right before more', () => {
    expect(norm(['textFormat', '~', 'link', 'settings', '|', 'more']).items).toEqual(['textFormat', '~', 'link', 'settings', '|', 'more']);
  });

  it('keeps unknown ids exactly where they were', () => {
    expect(norm(['textFormat', 'a', 'link', 'b', 'settings', 'more']).items).toEqual(['textFormat', 'a', 'link', 'b', 'settings', 'more']);
  });

  it('reads version 2 and above the same way and keeps the number', () => {
    const r = norm(['link', 'hologram', 'settings'], { version: 2 });
    expect(r.version).toBe(2);
    expect(r.items).toEqual(['textFormat', 'link', 'hologram', 'settings', 'more']);
  });

  it('turns a missing or bad version into 1', () => {
    expect(normalizeToolbarLayout({ version: 0, items: ['textFormat'], seen: [] }, KNOWN).version).toBe(1);
    expect(normalizeToolbarLayout({ version: 'x' as unknown as number, items: ['textFormat'], seen: [] }, KNOWN).version).toBe(1);
  });

  it('cleans seen of non-strings and duplicates', () => {
    expect(norm(['textFormat'], { seen: ['link', 3 as unknown as string, 'link', null as unknown as string, 'undo'] }).seen).toEqual(['link', 'undo']);
  });

  it('survives a layout whose items is not an array', () => {
    const r = normalizeToolbarLayout({ version: 1, items: 'nope' as unknown as string[], seen: [] }, KNOWN);
    expect(r.items).toEqual(['textFormat', 'settings', 'more']);
  });
});

describe('reconcileSeen cases', () => {
  const noAiItems = ['textFormat', 'listBlock', 'link', 'insert', 'emoji', 'headingNumbers', '|', 'undo', 'redo', '|', 'zoom', '|', 'themeToggle', 'settings', 'more'];
  const without = (...drop: string[]) => KNOWN.filter((id) => !drop.includes(id));

  it('inserts a new id right after its present default neighbor', () => {
    const r = reconcileSeen({ version: 1, items: noAiItems, seen: without('ai') }, DEFAULT_TOOLBAR_ITEMS, KNOWN);
    const i = r.items.indexOf('ai');
    expect(r.items[i - 1]).toBe('headingNumbers');
    expect(r.items[i + 1]).toBe('|');
    expect(r.seen).toContain('ai');
  });

  it('skips a neighbor the user removed and uses the one before it', () => {
    const items = noAiItems.filter((id) => id !== 'headingNumbers');
    const r = reconcileSeen({ version: 1, items, seen: without('ai') }, DEFAULT_TOOLBAR_ITEMS, KNOWN);
    expect(r.items[r.items.indexOf('ai') - 1]).toBe('emoji');
  });

  it('uses the next present neighbor when no earlier default neighbor is present', () => {
    const items = ['undo', 'settings', 'more'];
    const r = reconcileSeen({ version: 1, items, seen: [...KNOWN] }, ['foo', 'undo', 'settings', 'more'], [...KNOWN, 'foo']);
    expect(r.items).toEqual(['foo', 'undo', 'settings', 'more']);
  });

  it('puts a new id before more when none of its default neighbors are present', () => {
    const r = reconcileSeen({ version: 1, items: ['settings', 'more'], seen: [] }, ['foo', 'bar'], ['foo', 'bar', 'settings', 'more']);
    expect(r.items.indexOf('foo')).toBeLessThan(r.items.indexOf('more'));
    expect(r.items.at(-1)).toBe('more');
  });

  it('keeps a user-removed id removed when it is in seen', () => {
    const items = noAiItems.filter((id) => id !== 'emoji');
    const r = reconcileSeen({ version: 1, items, seen: [...KNOWN] }, DEFAULT_TOOLBAR_ITEMS, KNOWN);
    expect(r.items).not.toContain('emoji');
    expect(r.items).toEqual(items);
  });

  it('only adds to seen, without moving it, a new id the layout already lists', () => {
    const items = ['textFormat', 'ai', 'settings', 'more'];
    const r = reconcileSeen({ version: 1, items, seen: without('ai') }, DEFAULT_TOOLBAR_ITEMS, KNOWN);
    expect(r.items.filter((t) => t === 'ai')).toHaveLength(1);
    expect(r.items.indexOf('ai')).toBe(1);
    expect(r.seen).toContain('ai');
  });

  it('with an empty (legacy) seen, adds only the known ids missing from items', () => {
    const items = ['textFormat', 'undo', 'settings', 'more'];
    const r = reconcileSeen({ version: 1, items, seen: [] }, DEFAULT_TOOLBAR_ITEMS, KNOWN);
    for (const id of items) { expect(r.items.filter((t) => t === id)).toHaveLength(1); }
    expect(r.items.slice(0, 2)).toEqual(['textFormat', 'listBlock']);
    for (const id of KNOWN) {
      expect(r.items).toContain(id);
      expect(r.seen).toContain(id);
    }
    expect(r.items.at(-1)).toBe('more');
  });

  it('is a no-op when seen already lists every known id', () => {
    const l = layout(noAiItems);
    const r = reconcileSeen(l, DEFAULT_TOOLBAR_ITEMS, KNOWN);
    expect(r.items).toEqual(noAiItems);
    expect(r.seen).toEqual(l.seen);
  });

  it('preserves unknown ids in seen and in items', () => {
    const r = reconcileSeen({ version: 1, items: ['textFormat', 'hologram', 'settings', 'more'], seen: ['hologram'] }, DEFAULT_TOOLBAR_ITEMS, KNOWN);
    expect(r.items).toContain('hologram');
    expect(r.seen).toContain('hologram');
  });

  it('does not mutate its input and keeps the version', () => {
    const l: ToolbarLayout = { version: 4, items: ['textFormat', 'settings', 'more'], seen: [] };
    const before = JSON.stringify(l);
    expect(reconcileSeen(l, DEFAULT_TOOLBAR_ITEMS, KNOWN).version).toBe(4);
    expect(JSON.stringify(l)).toBe(before);
  });

  it('never puts an inserted id after more', () => {
    const r = reconcileSeen({ version: 1, items: ['textFormat', 'more'], seen: [] }, DEFAULT_TOOLBAR_ITEMS, KNOWN);
    expect(r.items.at(-1)).toBe('more');
  });
});

describe('resolveToolbarLayout cases', () => {
  it('reconciles a saved layout from an older core: a new id appears next to its default neighbor', () => {
    const saved = { version: 1, items: ['textFormat', 'listBlock', 'link', 'insert', 'emoji', 'undo', 'settings', 'more'], seen: KNOWN.filter((id) => id !== 'headingNumbers') };
    const r = resolveToolbarLayout(saved, KNOWN, DEFAULT_TOOLBAR_ITEMS);
    expect(r.isDefault).toBe(false);
    expect(r.tokens[r.tokens.indexOf('emoji') + 1]).toBe('headingNumbers');
    expect(r.layout.seen).toContain('headingNumbers');
  });

  it('keeps a removed id out of tokens and out of the layout', () => {
    const items = DEFAULT_TOOLBAR_ITEMS.filter((t) => t !== 'emoji');
    const r = resolveToolbarLayout({ version: 1, items, seen: [...KNOWN] }, KNOWN, DEFAULT_TOOLBAR_ITEMS);
    expect(r.tokens).not.toContain('emoji');
    expect(r.layout.items).not.toContain('emoji');
  });

  it('treats an empty items array as the default', () => {
    expect(resolveToolbarLayout({ version: 1, items: [], seen: [] }, KNOWN, DEFAULT_TOOLBAR_ITEMS).isDefault).toBe(true);
  });

  it('accepts a Set for knownIds', () => {
    const r = resolveToolbarLayout(undefined, new Set(KNOWN), DEFAULT_TOOLBAR_ITEMS);
    expect(r.tokens).toEqual([...DEFAULT_TOOLBAR_ITEMS]);
  });

  it('keeps the higher version and the unknown ids through resolve and serialize', () => {
    const value = { version: 9, items: ['textFormat', 'hologram', 'link', 'settings', 'more'], seen: [...KNOWN, 'hologram'] };
    const r = resolveToolbarLayout(value, KNOWN, DEFAULT_TOOLBAR_ITEMS);
    expect(r.layout.version).toBe(9);
    const saved = serializeToolbarLayout(r.layout);
    expect(saved.version).toBe(9);
    expect(saved.items).toEqual(['textFormat', 'hologram', 'link', 'settings', 'more']);
    expect(saved.seen).toContain('hologram');
  });

  it('reads a JSON string the same as an object', () => {
    const value = { version: 1, items: ['textFormat', 'link', '~', 'settings', 'more'], seen: [...KNOWN] };
    expect(resolveToolbarLayout(JSON.stringify(value), KNOWN, DEFAULT_TOOLBAR_ITEMS))
      .toEqual(resolveToolbarLayout(value, KNOWN, DEFAULT_TOOLBAR_ITEMS));
  });

  it('does not alias or mutate the stored value', () => {
    const value = { version: 1, items: ['link', 'textFormat', 'settings', 'more'], seen: [] as string[] };
    const before = JSON.stringify(value);
    const r = resolveToolbarLayout(value, KNOWN, DEFAULT_TOOLBAR_ITEMS);
    expect(JSON.stringify(value)).toBe(before);
    expect(r.layout.items).not.toBe(value.items);
  });

  it('returns tokens that can be mutated without touching DEFAULT_TOOLBAR_ITEMS', () => {
    const r = resolveToolbarLayout(undefined, KNOWN, DEFAULT_TOOLBAR_ITEMS);
    r.tokens.pop();
    expect(DEFAULT_TOOLBAR_ITEMS.at(-1)).toBe('more');
  });
});

describe('garbage input', () => {
  it('never throws and always yields a renderable result', () => {
    const garbage: unknown[] = [
      undefined, null, NaN, 0, -1, true, false, '', ' ', '{', '[]', 'null', '"x"', [], [[]], {}, { items: null },
      { items: [null, 1, {}], seen: 'x', version: -3 }, { items: ['|', '|', '~'], seen: {} },
      { items: new Array(5).fill(undefined) },
    ];
    for (const g of garbage) {
      const r = resolveToolbarLayout(g, KNOWN, DEFAULT_TOOLBAR_ITEMS);
      expect(r.tokens[0]).toBe('textFormat');
      expect(r.tokens.at(-1)).toBe('more');
      expect(r.tokens).toContain('settings');
    }
  });

  it('serialize copes with non-string entries', () => {
    const saved = serializeToolbarLayout({ version: 1, items: ['textFormat', 4 as unknown as string, 'more'], seen: [] });
    expect(saved.items).toEqual(['textFormat', 'more']);
  });
});

describe('edit helpers, more cases', () => {
  const l = layout(['textFormat', 'link', '~', 'undo', '|', 'settings', 'more']);

  it('moves a spacer and a separator like any other entry', () => {
    expect(layoutWithMove(l, 2, 1).items).toEqual(['textFormat', '~', 'link', 'undo', '|', 'settings', 'more']);
    expect(layoutWithMove(l, 4, 1).items).toEqual(['textFormat', '|', 'link', '~', 'undo', 'settings', 'more']);
  });

  it('lets settings move (only removal is refused)', () => {
    expect(layoutWithMove(l, 5, 1).items).toEqual(['textFormat', 'settings', 'link', '~', 'undo', '|', 'more']);
  });

  it('returns the same object for a move to the same slot, a bad index or a non-integer', () => {
    expect(layoutWithMove(l, 1, 1)).toBe(l);
    expect(layoutWithMove(l, -1, 2)).toBe(l);
    expect(layoutWithMove(l, 99, 2)).toBe(l);
    expect(layoutWithMove(l, 1.5, 2)).toBe(l);
    expect(layoutWithMove(l, 1, Number.NaN)).toBe(l);
  });

  it('never lets an item land before textFormat', () => {
    const r = layoutWithMove(l, 3, -5);
    expect(r.items[0]).toBe('textFormat');
    expect(r.items[1]).toBe('undo');
  });

  it('never lets an item land after more', () => {
    const r = layoutWithMove(l, 1, 100);
    expect(r.items.at(-1)).toBe('more');
    expect(r.items.at(-2)).toBe('link');
  });

  it('leaves seen alone when moving', () => {
    expect(layoutWithMove(l, 1, 3).seen).toEqual(l.seen);
  });

  it('removes a separator or spacer without touching seen', () => {
    const a = layoutWithRemove(l, 2);
    expect(a.items).toEqual(['textFormat', 'link', 'undo', '|', 'settings', 'more']);
    expect(a.seen).toEqual(l.seen);
    expect(layoutWithRemove(l, 4).items).toEqual(['textFormat', 'link', '~', 'undo', 'settings', 'more']);
  });

  it('adds a removed id to seen exactly once', () => {
    const start = layout(['textFormat', 'link', 'settings', 'more'], { seen: ['link'] });
    expect(layoutWithRemove(start, 1).seen).toEqual(['link']);
    const unseen = layout(['textFormat', 'link', 'settings', 'more'], { seen: [] });
    expect(layoutWithRemove(unseen, 1).seen).toEqual(['link']);
  });

  it('refuses a bad remove index or non-integer', () => {
    expect(layoutWithRemove(l, -1)).toBe(l);
    expect(layoutWithRemove(l, 99)).toBe(l);
    expect(layoutWithRemove(l, 0.5)).toBe(l);
  });

  it('removes an unknown id', () => {
    const u = layout(['textFormat', 'hologram', 'settings', 'more']);
    expect(layoutWithRemove(u, 1).items).toEqual(['textFormat', 'settings', 'more']);
  });

  it('inserts at the start of the movable range and at the end of it', () => {
    expect(layoutWithInsert(l, 'emoji', 0).items[1]).toBe('emoji');
    const end = layoutWithInsert(l, 'emoji', l.items.length);
    expect(end.items.at(-1)).toBe('more');
    expect(end.items.at(-2)).toBe('emoji');
  });

  it('refuses a pinned id, an id already present, and bad tokens or indexes', () => {
    expect(layoutWithInsert(l, 'textFormat', 1)).toBe(l);
    expect(layoutWithInsert(l, 'more', 1)).toBe(l);
    expect(layoutWithInsert(l, 'link', 1)).toBe(l);
    expect(layoutWithInsert(l, '', 1)).toBe(l);
    expect(layoutWithInsert(l, 7 as unknown as string, 1)).toBe(l);
    expect(layoutWithInsert(l, 'emoji', 1.5)).toBe(l);
  });

  it('does not add a separator or spacer to seen, and adds a new id once', () => {
    expect(layoutWithInsert(l, '|', 1).seen).toEqual(l.seen);
    const withId = layoutWithInsert(layout(['textFormat', 'settings', 'more'], { seen: [] }), 'emoji', 1);
    expect(withId.seen).toEqual(['emoji']);
  });

  it('does not duplicate an id already in seen when re-inserting it after a remove', () => {
    const removed = layoutWithRemove(layout(['textFormat', 'emoji', 'settings', 'more'], { seen: ['emoji'] }), 1);
    expect(layoutWithInsert(removed, 'emoji', 1).seen).toEqual(['emoji']);
  });

  it('keeps the version through every helper', () => {
    const v = layout(['textFormat', 'link', 'settings', 'more'], { version: 5 });
    expect(layoutWithMove(v, 1, 2).version).toBe(5);
    expect(layoutWithRemove(v, 1).version).toBe(5);
    expect(layoutWithInsert(v, '|', 1).version).toBe(5);
  });

  it('round trips an edit session: remove, insert, move, serialize, resolve', () => {
    let work = resolveToolbarLayout(undefined, KNOWN, DEFAULT_TOOLBAR_ITEMS).layout;
    work = layoutWithRemove(work, work.items.indexOf('emoji'));
    work = layoutWithInsert(work, '~', work.items.indexOf('redo'));
    work = layoutWithMove(work, work.items.indexOf('selectAll'), 1);
    const saved = serializeToolbarLayout(work);
    const back = resolveToolbarLayout(JSON.parse(JSON.stringify(saved)), KNOWN, DEFAULT_TOOLBAR_ITEMS);
    expect(back.layout.items).toEqual(work.items);
    expect(back.tokens).not.toContain('emoji');
    expect(back.tokens[1]).toBe('selectAll');
  });
});
