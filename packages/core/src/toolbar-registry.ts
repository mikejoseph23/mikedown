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

import {
  TOOLBAR_SEPARATOR,
  TOOLBAR_SPACER,
  type ToolbarItemId,
  type ToolbarLayoutToken,
} from './toolbar-ids';

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
 * The indices into `tokens` of the entries that will actually render: unknown
 * and unavailable ids dropped, runs of the same divider collapsed to the
 * first, trailing dividers trimmed. The toolbar editor uses the indices to map
 * a rendered child back to its slot in the layout.
 */
export function resolveToolbarTokenIndices(
  defs: readonly ToolbarItemDef[],
  tokens: readonly ToolbarLayoutToken[],
): number[] {
  const byId = new Map(defs.map((d) => [d.id, d] as const));
  const out: number[] = [];
  tokens.forEach((token, i) => {
    if (isDivider(token)) {
      if (!out.length || tokens[out[out.length - 1]] === token) {return;}
      out.push(i);
      return;
    }
    const def = byId.get(token);
    if (!def) {return;}
    if (def.available && !def.available()) {return;}
    out.push(i);
  });
  while (out.length && isDivider(tokens[out[out.length - 1]])) {out.pop();}
  return out;
}

/**
 * The tokens that will actually render: unknown and unavailable ids dropped,
 * runs of the same divider collapsed to one, leading and trailing dividers
 * trimmed.
 */
export function resolveToolbarTokens(
  defs: readonly ToolbarItemDef[],
  tokens: readonly ToolbarLayoutToken[],
): ToolbarLayoutToken[] {
  return resolveToolbarTokenIndices(defs, tokens).map((i) => tokens[i]);
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
 * The element for `def`, rendered on first use and reused afterwards (so its
 * listeners survive re-renders). The toolbar editor also reads it for an
 * item that is not on the toolbar, to show its icon in the palette.
 */
export function renderToolbarItem(def: ToolbarItemDef, toolbar: HTMLElement): HTMLElement {
  let el = rendered.get(def);
  if (!el) {
    el = def.render({ toolbar });
    rendered.set(def, el);
  }
  return el;
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
    return renderToolbarItem(byId.get(token)!, toolbar);
  });
  toolbar.replaceChildren(...nodes);
  return resolved;
}
