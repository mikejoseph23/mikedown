/**
 * Toolbar item ids, the default order and the pinned/removable table.
 *
 * Pure data, no DOM: shared by the toolbar registry (`toolbar-registry.ts`)
 * and the layout model (`toolbar-layout.ts`) so neither depends on the other.
 * The ids are the registry ids, which match the `data-action` attribute on
 * each toolbar button (`zoom` is the wrapper around `zoomOut`, `zoomReset`
 * and `zoomIn`).
 */

/** Every registry item id, in default toolbar order. */
export const TOOLBAR_ITEM_IDS = [
  'textFormat',
  'listBlock',
  'link',
  'insert',
  'emoji',
  'headingNumbers',
  'ai',
  'undo',
  'redo',
  'sourceToggle',
  'share',
  'selectAll',
  'zoom',
  'themeToggle',
  'settings',
  'more',
] as const;

/** A registry item id. */
export type ToolbarItemId = (typeof TOOLBAR_ITEM_IDS)[number];

/** One entry of a layout: a registry id, a separator (`'|'`) or a flexible spacer (`'~'`). */
export type ToolbarLayoutToken = ToolbarItemId | '|' | '~';

/** The separator token. */
export const TOOLBAR_SEPARATOR = '|' as const;

/** The flexible spacer token. */
export const TOOLBAR_SPACER = '~' as const;

/**
 * The default layout's `items`, including separator positions. Reproduces the
 * hand-written toolbar order. Separators around buttons that are unavailable
 * (Source, Share) fall out of duplicate/trailing trimming at render time.
 */
export const DEFAULT_TOOLBAR_ITEMS: readonly ToolbarLayoutToken[] = Object.freeze([
  'textFormat',
  'listBlock',
  'link',
  'insert',
  'emoji',
  'headingNumbers',
  'ai',
  '|',
  'undo',
  'redo',
  '|',
  'sourceToggle',
  '|',
  'share',
  'selectAll',
  '|',
  'zoom',
  '|',
  'themeToggle',
  'settings',
  'more',
] as ToolbarLayoutToken[]);

/** Per-item layout rules. */
export interface ToolbarItemTraits {
  /** `'first'` or `'last'` pins the item to that end of the toolbar: it cannot be moved or removed. */
  readonly pinned?: 'first' | 'last';
  /** False when the user may not remove the item (always a way back into customize). */
  readonly removable: boolean;
}

/**
 * Pinned/removable table. `textFormat` is pinned first, `more` pinned last;
 * `textFormat`, `settings` and `more` cannot be removed. `settings` can be
 * moved.
 */
export const TOOLBAR_ITEM_TRAITS: Readonly<Record<ToolbarItemId, ToolbarItemTraits>> = Object.freeze({
  textFormat: { pinned: 'first', removable: false },
  listBlock: { removable: true },
  link: { removable: true },
  insert: { removable: true },
  emoji: { removable: true },
  headingNumbers: { removable: true },
  ai: { removable: true },
  undo: { removable: true },
  redo: { removable: true },
  sourceToggle: { removable: true },
  share: { removable: true },
  selectAll: { removable: true },
  zoom: { removable: true },
  themeToggle: { removable: true },
  settings: { removable: false },
  more: { pinned: 'last', removable: false },
});

/** True for a registry id this core knows (not a separator, spacer or unknown string). */
export function isToolbarItemId(value: unknown): value is ToolbarItemId {
  return typeof value === 'string' && (TOOLBAR_ITEM_IDS as readonly string[]).includes(value);
}
