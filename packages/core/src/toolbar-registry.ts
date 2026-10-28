/**
 * Toolbar registry: the toolbar is a list of item definitions keyed by id,
 * rendered in the order of a token list (item ids plus `|` separators and
 * `~` flexible spacers).
 *
 * The definitions themselves are built by `buildCondensedToolbar` in
 * editor.ts, because they close over the editor, the host and the settings.
 * This module holds the types, the ids, the default order and the pure-ish
 * `renderToolbar` walk. Only toolbar chrome is touched here, never the
 * ProseMirror DOM.
 *
 * Availability: an item whose `available()` is false is left out of the DOM
 * entirely (it is not hidden with `display:none`). `refreshToolbarAvailability`
 * in editor.ts re-renders when the set of available items changes. Because the
 * item is absent, the separators around it collapse like any other duplicate.
 */

/** Every toolbar item id. Each is also the `data-action` of its element (a group's wrapper carries it too). */
export const TOOLBAR_ITEM_IDS = [
  'textFormat', 'listBlock', 'link', 'insert', 'emoji', 'headingNumbers', 'ai',
  'undo', 'redo', 'sourceToggle', 'share', 'selectAll', 'zoom',
  'themeToggle', 'settings', 'more',
] as const;

export type ToolbarItemId = (typeof TOOLBAR_ITEM_IDS)[number];

/** A separator in a layout. */
export const TOOLBAR_SEPARATOR = '|';
/** A flexible spacer in a layout. */
export const TOOLBAR_SPACER = '~';

/** One slot in a layout: an item id, `'|'` (separator) or `'~'` (flexible spacer). */
export type ToolbarLayoutToken = ToolbarItemId | typeof TOOLBAR_SEPARATOR | typeof TOOLBAR_SPACER;

/**
 * The default layout. Rendering it reproduces the toolbar MikeDown has always
 * had: the separators around the optional Source and Share buttons fall out of
 * duplicate and trailing trimming when those buttons are unavailable.
 */
export const DEFAULT_TOOLBAR_ITEMS: readonly ToolbarLayoutToken[] = [
  'textFormat', 'listBlock', 'link', 'insert', 'emoji', 'headingNumbers', 'ai',
  '|', 'undo', 'redo',
  '|', 'sourceToggle',
  '|', 'share', 'selectAll',
  '|', 'zoom',
  '|', 'themeToggle', 'settings', 'more',
];

/** What `render` gets. */
export interface ToolbarRenderContext {
  /** The toolbar element the item will be appended to. */
  toolbar: HTMLElement;
}

export interface ToolbarItemDef {
  id: ToolbarItemId;
  /** Name shown in the palette and announced by the keyboard editor. */
  label: string;
  /** Name in the More menu when it differs from `label`. */
  menuLabel?: string;
  /** `group` renders a `.toolbar-group` wrapper holding several buttons that move as one. */
  kind: 'button' | 'dropdown' | 'group';
  /** Pinned items cannot be moved: `first` stays first, `last` stays last. */
  pinned?: 'first' | 'last';
  /** False for items a layout may never drop. */
  removable: boolean;
  /** False while the host, a feature flag or a setting hides the item. Absent means always available. */
  available?(): boolean;
  /**
   * Build the element. `renderToolbar` calls it once per definition and
   * reuses the element on later passes, so listeners and references survive.
   */
  render(ctx: ToolbarRenderContext): HTMLElement;
  /** Bring the rendered element in line with the editor state (active styling, labels). Safe before `render`. */
  update?(): void;
}

const isDivider = (t: ToolbarLayoutToken): t is typeof TOOLBAR_SEPARATOR | typeof TOOLBAR_SPACER =>
  t === TOOLBAR_SEPARATOR || t === TOOLBAR_SPACER;

/**
 * The tokens that will actually render: unknown and unavailable ids dropped,
 * runs of the same divider collapsed to one, leading and trailing dividers
 * trimmed.
 */
export function resolveToolbarTokens(
  defs: readonly ToolbarItemDef[],
  tokens: readonly ToolbarLayoutToken[],
): ToolbarLayoutToken[] {
  const byId = new Map(defs.map((d) => [d.id, d] as const));
  const out: ToolbarLayoutToken[] = [];
  for (const token of tokens) {
    if (isDivider(token)) {
      if (!out.length || out[out.length - 1] === token) {continue;}
      out.push(token);
      continue;
    }
    const def = byId.get(token);
    if (!def) {continue;}
    if (def.available && !def.available()) {continue;}
    out.push(token);
  }
  while (out.length && isDivider(out[out.length - 1])) {out.pop();}
  return out;
}

const rendered = new WeakMap<ToolbarItemDef, HTMLElement>();

function makeSeparator(): HTMLElement {
  const sep = document.createElement('div');
  sep.className = 'toolbar-separator';
  sep.setAttribute('role', 'separator');
  return sep;
}

function makeSpacer(): HTMLElement {
  const spacer = document.createElement('div');
  spacer.className = 'toolbar-spacer';
  spacer.setAttribute('aria-hidden', 'true');
  return spacer;
}

/**
 * Replace the toolbar's children with the rendered tokens.
 * Returns the tokens that rendered (see `resolveToolbarTokens`), so a caller
 * can tell whether a later pass would change anything.
 */
export function renderToolbar(
  toolbar: HTMLElement,
  defs: readonly ToolbarItemDef[],
  tokens: readonly ToolbarLayoutToken[],
): ToolbarLayoutToken[] {
  const byId = new Map(defs.map((d) => [d.id, d] as const));
  const resolved = resolveToolbarTokens(defs, tokens);
  const nodes = resolved.map((token) => {
    if (token === TOOLBAR_SEPARATOR) {return makeSeparator();}
    if (token === TOOLBAR_SPACER) {return makeSpacer();}
    const def = byId.get(token)!;
    let el = rendered.get(def);
    if (!el) {
      el = def.render({ toolbar });
      rendered.set(def, el);
    }
    return el;
  });
  toolbar.replaceChildren(...nodes);
  return resolved;
}
