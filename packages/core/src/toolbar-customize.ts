/**
 * Toolbar edit mode (Customize Toolbar…): the live toolbar becomes the
 * editor, with a palette tray under it, Firefox-style.
 *
 * `enterToolbarEditMode` owns a working copy of the layout. Every drop is
 * applied to that copy and the toolbar re-renders from it at once (through
 * `renderToolbar`), so the user sees the real result. Nothing is saved until
 * Done (or Escape), which calls `ctx.save` once, and only when the layout
 * changed (D7). There is no Cancel: Reset to Default in the tray is the undo.
 *
 * While editing (D9) the toolbar carries `.toolbar-editing`: it wraps instead
 * of overflowing (`layoutToolbarOverflow` stands down), More is shown as the
 * fixed end of the row, and every button is inert (clicks are swallowed in the
 * capture phase) and `aria-disabled`. The whole item is the drag handle.
 *
 * Drag uses pointer events, not HTML5 drag and drop (D6): `pointerdown` on a
 * movable item or a tray tile, a 4px threshold, pointer capture, a ghost that
 * follows the pointer, a 2px insertion line between toolbar items (from their
 * midpoints, row by row since the toolbar wraps) and a "drop here" state on the
 * tray for removal. `pointercancel` drops nothing.
 *
 * Keyboard (D11): one roving tab stop over the toolbar items and one over the
 * tray tiles, arrow keys between them. Space or Enter picks a movable item up
 * (`aria-pressed`, `.toolbar-item-grabbed`), Left/Right move it a slot, Space
 * or Enter drops it and Escape puts it back. Delete or Backspace sends it to
 * the tray. Enter or Space on a tray tile adds it after the toolbar item that
 * last had focus. Every change is announced through the tray's polite live
 * region ("Moved Undo to position 7 of 12"). Entering focuses the first movable
 * item; Done gives focus back to `opener` (or the first toolbar item).
 *
 * Only toolbar chrome is touched: the toolbar, the tray, the ghost and the
 * insertion line all live in `.mikedown-root` beside the editor container.
 * Nothing here reads or writes the ProseMirror DOM.
 */

import {
  DEFAULT_TOOLBAR_ITEMS,
  TOOLBAR_SEPARATOR,
  TOOLBAR_SPACER,
  isOptionalToolbarItem,
  type ToolbarLayoutToken,
} from './toolbar-ids';
import {
  DEFAULT_TOOLBAR_LAYOUT,
  layoutWithInsert,
  layoutWithMove,
  layoutWithRemove,
  normalizeToolbarLayout,
  serializeToolbarLayout,
  type ToolbarLayout,
} from './toolbar-layout';
import {
  renderToolbar,
  renderToolbarItem,
  resolveToolbarTokenIndices,
  type ToolbarItemDef,
} from './toolbar-registry';
import { layoutToolbarOverflow } from './toolbar-overflow';

/** Items that stay put in edit mode: Text Format (first), Settings and More (the way back in). */
export const TOOLBAR_FIXED_ITEMS: ReadonlySet<string> = new Set(['textFormat', 'settings', 'more']);

/** Read out once when edit mode opens. */
export const TOOLBAR_EDIT_INSTRUCTIONS =
  'Customizing the toolbar. Use arrow keys to choose an item, Space to pick it up and move it, Delete to remove it, Escape or Done to finish.';

/** Pixels the pointer must travel before a press becomes a drag. */
export const TOOLBAR_DRAG_THRESHOLD = 4;

export interface ToolbarEditResult {
  /** True when the layout differs from the one edit mode started with. */
  changed: boolean;
  /** What Done saved (or would have): the serialized layout, or `null` for the default. */
  value: ToolbarLayout | null;
}

export interface ToolbarCustomizeContext {
  /** The editor's `.mikedown-root`: the tray goes right after the toolbar, the ghost and insertion line at the end. */
  root: HTMLElement;
  toolbar: HTMLElement;
  defs: readonly ToolbarItemDef[];
  /** The layout the toolbar shows now; the working copy starts from it. */
  layout: ToolbarLayout;
  /** The element that opened edit mode (Settings button, More, the toolbar); focus goes back there on Done (M5). */
  opener?: HTMLElement | null;
  /** Called after every render with the tokens that rendered and the working items. */
  onRender?(rendered: ToolbarLayoutToken[], items: readonly string[]): void;
  /** Persist the layout (`null` means default). Called at most once, on Done, and only when it changed. */
  save(value: ToolbarLayout | null): void;
  /** Edit mode is over (Done or Escape); the toolbar is back to normal mode, not yet re-rendered. */
  onExit(result: ToolbarEditResult): void;
}

export interface ToolbarEditSession {
  /** The working layout (normalized after every change). */
  readonly working: ToolbarLayout;
  readonly tray: HTMLElement;
  readonly opener: HTMLElement | null;
  /** True when the working layout differs from the starting one. */
  isChanged(): boolean;
  /** Replace the working layout (from a `layoutWith*` helper) and re-render. False when `next` is the same object. */
  apply(next: ToolbarLayout): boolean;
  /** The working-layout index of a toolbar child, or -1. */
  layoutIndexOf(el: Element): number;
  /** Speak `message` through the tray's polite live region. */
  announce(message: string): void;
  /** Re-render after the set of available items changed. */
  refresh(): void;
  /** Done: save once if changed, leave edit mode. */
  done(): void;
  /** Tear down without saving (the editor is being destroyed). */
  dispose(): void;
}

/** A box in viewport coordinates (a subset of `DOMRect`). */
export interface ToolbarSlotRect {
  left: number;
  right: number;
  top: number;
  bottom: number;
}

export interface ToolbarDropSlot {
  /** Insert before the toolbar child at this index. */
  slot: number;
  /** Where to draw the insertion line. */
  x: number;
  top: number;
  bottom: number;
}

/**
 * Where a drop at (`x`, `y`) lands among toolbar children laid out at `rects`
 * (DOM order, wrapping onto rows): the row under the pointer (or the nearest
 * one), then before the first child in it whose midpoint is right of `x`, or
 * after the row's last child. The slot is clamped to `[min, max]` (after the
 * first pinned item, up to before More). Null when there are no children.
 */
export function toolbarDropSlot(
  rects: readonly ToolbarSlotRect[],
  x: number,
  y: number,
  min: number,
  max: number,
): ToolbarDropSlot | null {
  if (!rects.length) {return null;}
  // Rows: a child that starts left of the previous one wrapped onto a new row.
  const rowOf: number[] = [];
  const rows: Array<{ start: number; end: number; top: number; bottom: number }> = [];
  rects.forEach((r, i) => {
    const prev = rows[rows.length - 1];
    if (!prev || r.left < rects[i - 1].left - 0.5) {
      rows.push({ start: i, end: i, top: r.top, bottom: r.bottom });
    } else {
      prev.end = i;
      prev.top = Math.min(prev.top, r.top);
      prev.bottom = Math.max(prev.bottom, r.bottom);
    }
    rowOf.push(rows.length - 1);
  });
  const distance = (row: { top: number; bottom: number }) =>
    y < row.top ? row.top - y : y > row.bottom ? y - row.bottom : 0;
  let rowIndex = 0;
  rows.forEach((row, i) => { if (distance(row) < distance(rows[rowIndex])) {rowIndex = i;} });
  const row = rows[rowIndex];

  let slot = row.end + 1;
  for (let i = row.start; i <= row.end; i++) {
    if ((rects[i].left + rects[i].right) / 2 > x) { slot = i; break; }
  }
  slot = Math.min(Math.max(slot, min), max);

  const before = rects[slot - 1];
  const after = rects[slot];
  if (before && after && rowOf[slot - 1] === rowOf[slot]) {
    const r = rows[rowOf[slot]];
    return { slot, x: (before.right + after.left) / 2, top: r.top, bottom: r.bottom };
  }
  if (after && (!before || rowOf[slot] === rowIndex)) {
    const r = rows[rowOf[slot]];
    return { slot, x: after.left - 1, top: r.top, bottom: r.bottom };
  }
  const r = rows[rowOf[slot - 1]];
  return { slot, x: before.right + 1, top: r.top, bottom: r.bottom };
}

type DragSource =
  | { kind: 'toolbar'; el: HTMLElement; index: number; childIndex: number; token: string }
  | { kind: 'tray'; el: HTMLElement; token: string };

type DropTarget = { kind: 'slot'; at: ToolbarDropSlot } | { kind: 'tray' };

const sameItems = (a: readonly string[], b: readonly string[]): boolean =>
  a.length === b.length && a.every((t, i) => t === b[i]);

/** A non-interactive picture of a toolbar item (icons only), for tray tiles and the drag ghost. */
function previewOf(token: string, el: HTMLElement | null): HTMLElement {
  const wrap = document.createElement('span');
  wrap.className = 'mikedown-toolbar-preview';
  wrap.setAttribute('aria-hidden', 'true');
  if (token === TOOLBAR_SEPARATOR) {
    wrap.classList.add('mikedown-toolbar-preview--separator');
    wrap.appendChild(document.createElement('span')).className = 'mikedown-toolbar-preview-sep';
    return wrap;
  }
  if (token === TOOLBAR_SPACER) {
    wrap.classList.add('mikedown-toolbar-preview--spacer');
    wrap.appendChild(document.createElement('span')).className = 'mikedown-toolbar-preview-spacer';
    return wrap;
  }
  const buttons = !el ? [] : el.tagName === 'BUTTON' ? [el] : Array.from(el.querySelectorAll('button'));
  for (const btn of buttons) {
    const part = document.createElement('span');
    part.className = 'mikedown-toolbar-preview-btn';
    // Icons and labels only: the markup is our own toolbar's, no ids or handlers.
    part.innerHTML = btn.innerHTML;
    wrap.appendChild(part);
  }
  return wrap;
}

function labelOf(token: string, defs: readonly ToolbarItemDef[]): string {
  if (token === TOOLBAR_SEPARATOR) {return 'Separator';}
  if (token === TOOLBAR_SPACER) {return 'Flexible Space';}
  return defs.find((d) => d.id === token)?.label ?? token;
}

const isDivider = (token: string): boolean => token === TOOLBAR_SEPARATOR || token === TOOLBAR_SPACER;
const countOf = (items: readonly string[], token: string): number => items.filter((t) => t === token).length;

/**
 * Where `raw[i]` ended up after normalizing `raw` into `norm` (normalizing
 * only drops entries here: collapsed dividers), or -1 when it was dropped.
 */
function mapThroughNormalize(raw: readonly string[], norm: readonly string[], i: number): number {
  let j = 0;
  for (let k = 0; k < raw.length; k++) {
    const kept = j < norm.length && raw[k] === norm[j];
    if (k === i) {return kept ? j : -1;}
    if (kept) {j++;}
  }
  return -1;
}

/**
 * Up/Down in a wrapping grid of tiles laid out at `rects` (DOM order): the
 * tile in the row above or below `index` whose centre is nearest, or null when
 * there is no such row.
 */
export function toolbarGridNeighbor(rects: readonly ToolbarSlotRect[], index: number, dir: 'up' | 'down'): number | null {
  if (index < 0 || index >= rects.length) {return null;}
  const rowOf: number[] = [];
  let row = 0;
  rects.forEach((r, i) => {
    if (i > 0 && r.left < rects[i - 1].left - 0.5) {row++;}
    rowOf.push(row);
  });
  const want = rowOf[index] + (dir === 'up' ? -1 : 1);
  const centre = (r: ToolbarSlotRect) => (r.left + r.right) / 2;
  const x = centre(rects[index]);
  let best: number | null = null;
  rects.forEach((r, i) => {
    if (rowOf[i] !== want) {return;}
    if (best === null || Math.abs(centre(r) - x) < Math.abs(centre(rects[best]) - x)) {best = i;}
  });
  return best;
}

/** Turn `ctx.toolbar` into the drag-and-drop editor. One session per editor instance at a time. */
export function enterToolbarEditMode(ctx: ToolbarCustomizeContext): ToolbarEditSession {
  const { root, toolbar, defs } = ctx;
  const initial = normalizeToolbarLayout(ctx.layout);
  let working = initial;
  /** Rendered toolbar child i shows `working.items[indices[i]]`. */
  let indices: number[] = [];
  let finished = false;
  let instructionTimer: ReturnType<typeof setTimeout> | 0 = 0;

  const cleanups: Array<() => void> = [];
  function on<E extends Event>(target: EventTarget, type: string, fn: (e: E) => void, opts?: boolean | AddEventListenerOptions): void {
    const listener = fn as EventListener;
    target.addEventListener(type, listener, opts);
    cleanups.push(() => target.removeEventListener(type, listener, opts));
  }

  // ── Normal-mode state to restore on exit ─────────────────────────────────
  const prevLabel = toolbar.getAttribute('aria-label');
  const decorated = new Set<HTMLElement>();
  /** Attributes edit mode changed on toolbar elements, with their normal-mode values. */
  const savedAttrs = new Map<HTMLElement, Map<string, string | null>>();
  function setAttr(el: HTMLElement, name: string, value: string | null): void {
    let saved = savedAttrs.get(el);
    if (!saved) { saved = new Map(); savedAttrs.set(el, saved); }
    if (!saved.has(name)) {saved.set(name, el.getAttribute(name));}
    if (value === null) {el.removeAttribute(name);} else {el.setAttribute(name, value);}
  }

  toolbar.classList.add('toolbar-editing');
  toolbar.setAttribute('aria-label', 'Customize toolbar');
  root.classList.add('mikedown-toolbar-customizing');

  // ── Tray ──────────────────────────────────────────────────────────────────
  const tray = document.createElement('div');
  tray.className = 'mikedown-toolbar-tray';
  tray.setAttribute('role', 'region');
  tray.setAttribute('aria-label', 'Toolbar items');

  const heading = document.createElement('div');
  heading.className = 'toolbar-tray-heading';
  heading.textContent = 'Drag items onto the toolbar';

  const tiles = document.createElement('div');
  tiles.className = 'toolbar-tray-items';

  const footer = document.createElement('div');
  footer.className = 'toolbar-tray-footer';
  const hint = document.createElement('span');
  hint.className = 'toolbar-tray-hint';
  hint.textContent = 'Drag a toolbar item here to remove it.';
  const resetBtn = document.createElement('button');
  resetBtn.type = 'button';
  resetBtn.className = 'toolbar-tray-reset';
  resetBtn.textContent = 'Reset to Default';
  const doneBtn = document.createElement('button');
  doneBtn.type = 'button';
  doneBtn.className = 'toolbar-tray-done';
  doneBtn.textContent = 'Done';
  footer.append(hint, resetBtn, doneBtn);

  const status = document.createElement('div');
  status.className = 'toolbar-tray-status';
  status.setAttribute('role', 'status');
  status.setAttribute('aria-live', 'polite');

  tray.append(heading, tiles, footer, status);
  toolbar.after(tray);

  const dropLine = document.createElement('div');
  dropLine.className = 'mikedown-toolbar-drop-line';
  dropLine.hidden = true;
  root.appendChild(dropLine);

  // ── Render ────────────────────────────────────────────────────────────────
  function tokenOfChild(child: HTMLElement): string {
    const i = (Array.from(toolbar.children) as HTMLElement[]).indexOf(child);
    return i >= 0 && i < indices.length ? working.items[indices[i]] : '';
  }

  /**
   * Every toolbar child is one keyboard stop. A button is its own stop; a
   * separator, spacer or group (Zoom) becomes a named `role="button"` and the
   * buttons inside a group are hidden from the keyboard and screen readers.
   * Movable stops are toggle buttons (`aria-pressed`, true while grabbed);
   * fixed ones are `aria-disabled`. Dropdown triggers lose `aria-haspopup`
   * (they open nothing here). All of it is restored on exit.
   */
  function decorate(): void {
    for (const child of Array.from(toolbar.children) as HTMLElement[]) {
      const token = tokenOfChild(child);
      const fixed = TOOLBAR_FIXED_ITEMS.has(token);
      const grabbed = !!grab && indices[Array.prototype.indexOf.call(toolbar.children, child)] === grab.index;
      child.classList.toggle('toolbar-item-fixed', fixed);
      child.classList.toggle('toolbar-item-movable', !fixed);
      child.classList.toggle('toolbar-item-grabbed', grabbed);
      decorated.add(child);
      setAttr(child, 'tabindex', '-1');
      setAttr(child, 'aria-haspopup', null);
      if (child.tagName !== 'BUTTON') {
        setAttr(child, 'role', 'button');
        setAttr(child, 'aria-label', labelOf(token, defs));
        setAttr(child, 'aria-hidden', null);
        for (const inner of Array.from(child.querySelectorAll<HTMLElement>('button'))) {
          setAttr(inner, 'tabindex', '-1');
          setAttr(inner, 'aria-hidden', 'true');
          setAttr(inner, 'aria-disabled', 'true');
        }
      }
      if (fixed) {
        setAttr(child, 'aria-disabled', 'true');
        setAttr(child, 'aria-pressed', null);
      } else {
        setAttr(child, 'aria-disabled', null);
        setAttr(child, 'aria-pressed', grabbed ? 'true' : 'false');
      }
    }
  }

  function renderTray(): void {
    const present = new Set(working.items);
    const unused = defs.filter((d) => !present.has(d.id) && (!d.available || d.available()));
    // Optional items (not in the default layout) come after the separator and spacer.
    const isOptional = (d: ToolbarItemDef): boolean => isOptionalToolbarItem(d.id);
    const tokens = [
      ...unused.filter((d) => !isOptional(d)).map((d) => d.id as string),
      TOOLBAR_SEPARATOR,
      TOOLBAR_SPACER,
      ...unused.filter(isOptional).map((d) => d.id as string),
    ];
    tiles.replaceChildren(...tokens.map((token) => {
      const def = defs.find((d) => d.id === token);
      const tile = document.createElement('button');
      tile.type = 'button';
      tile.className = 'toolbar-tray-item';
      tile.dataset.token = token;
      const label = labelOf(token, defs);
      tile.setAttribute('aria-label', label);
      tile.tabIndex = -1;
      const text = document.createElement('span');
      text.className = 'toolbar-tray-label';
      text.textContent = label;
      tile.append(previewOf(token, def ? renderToolbarItem(def, toolbar) : null), text);
      return tile;
    }));
    const isDefault = sameItems(working.items, DEFAULT_TOOLBAR_ITEMS);
    resetBtn.disabled = isDefault;
  }

  function positionTray(): void {
    tray.style.top = `${toolbar.offsetTop + toolbar.offsetHeight}px`;
  }

  const toolbarStops = (): HTMLElement[] => Array.from(toolbar.children) as HTMLElement[];
  const trayStops = (): HTMLElement[] => Array.from(tiles.children) as HTMLElement[];
  const childIndexOf = (el: EventTarget | null): number => {
    let node = el instanceof Element ? el : null;
    while (node && node.parentElement !== toolbar) {node = node.parentElement;}
    return node ? Array.prototype.indexOf.call(toolbar.children, node) : -1;
  };
  const tileIndexOf = (el: EventTarget | null): number => {
    const tile = el instanceof Element ? el.closest<HTMLElement>('.toolbar-tray-item') : null;
    return tile ? trayStops().indexOf(tile) : -1;
  };
  const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(n, hi));

  /** The roving stops: the toolbar child and the tray tile that Tab lands on. */
  let rovingChild = 0;
  let rovingTile = 0;
  /** The toolbar child that last had focus: tray additions go after it (null: before More). */
  let insertAfterChild: number | null = null;

  function syncRoving(): void {
    const kids = toolbarStops();
    rovingChild = clamp(rovingChild, 0, Math.max(0, kids.length - 1));
    kids.forEach((k, i) => k.setAttribute('tabindex', i === rovingChild ? '0' : '-1'));
    if (insertAfterChild !== null) {insertAfterChild = clamp(insertAfterChild, 0, Math.max(0, kids.length - 1));}
    const tileEls = trayStops();
    rovingTile = clamp(rovingTile, 0, Math.max(0, tileEls.length - 1));
    tileEls.forEach((t, i) => t.setAttribute('tabindex', i === rovingTile ? '0' : '-1'));
  }

  /** Where focus should go after the next render; otherwise it stays on the same stop. */
  let focusAfterRender: (() => HTMLElement | null | undefined) | null = null;
  /** True while re-rendering: focus moves then are ours, not the user's. */
  let rendering = false;

  function render(): void {
    // Re-rendering detaches the focused element; remember which stop it was.
    const active = document.activeElement;
    const wasChild = active && toolbar.contains(active) ? childIndexOf(active) : -1;
    const wasTile = active && tiles.contains(active) ? tileIndexOf(active) : -1;
    rendering = true;
    try {
      const items = working.items as ToolbarLayoutToken[];
      const rendered = renderToolbar(toolbar, defs, items);
      indices = resolveToolbarTokenIndices(defs, items);
      decorate();
      layoutToolbarOverflow(toolbar); // edit mode: clears overflow, shows More
      renderTray();
      syncRoving();
      positionTray();
      ctx.onRender?.(rendered, working.items);
      const pick = focusAfterRender;
      focusAfterRender = null;
      const target = pick ? pick()
        : wasChild >= 0 ? toolbarStops()[clamp(wasChild, 0, toolbarStops().length - 1)]
        : wasTile >= 0 ? (trayStops()[clamp(wasTile, 0, trayStops().length - 1)] ?? null)
        : null;
      if (target && document.activeElement !== target) {target.focus();}
    } finally {
      rendering = false;
    }
  }

  function apply(next: ToolbarLayout, focus?: () => HTMLElement | null | undefined): boolean {
    if (finished || next === working) {return false;}
    working = normalizeToolbarLayout(next);
    focusAfterRender = focus ?? null;
    render();
    return true;
  }

  // ── Inert buttons: no editor actions, no dropdowns ───────────────────────
  on<MouseEvent>(toolbar, 'click', (e) => {
    e.preventDefault();
    e.stopImmediatePropagation();
  }, true);

  // ── Pointer drag ──────────────────────────────────────────────────────────
  let press: {
    source: DragSource;
    pointerId: number;
    x0: number;
    y0: number;
    dx: number;
    dy: number;
  } | null = null;
  let drag: { ghost: HTMLElement; target: DropTarget | null } | null = null;
  let lastDragEnd = 0;

  function sourceAt(target: EventTarget | null): DragSource | null {
    if (!(target instanceof Element)) {return null;}
    const tile = target.closest<HTMLElement>('.toolbar-tray-item');
    if (tile && tray.contains(tile) && tile.dataset.token) {
      return { kind: 'tray', el: tile, token: tile.dataset.token };
    }
    let el: Element | null = target;
    while (el && el.parentElement !== toolbar) {el = el.parentElement;}
    if (!el) {return null;}
    const childIndex = Array.prototype.indexOf.call(toolbar.children, el);
    if (childIndex < 0 || childIndex >= indices.length) {return null;}
    const index = indices[childIndex];
    const token = working.items[index];
    if (TOOLBAR_FIXED_ITEMS.has(token)) {return null;}
    return { kind: 'toolbar', el: el as HTMLElement, index, childIndex, token };
  }

  function hitTest(x: number, y: number, source: DragSource): DropTarget | null {
    const inside = (r: ToolbarSlotRect, pad = 0) =>
      x >= r.left - pad && x <= r.right + pad && y >= r.top - pad && y <= r.bottom + pad;
    const trayRect = tray.getBoundingClientRect();
    if (inside(trayRect)) {return source.kind === 'toolbar' ? { kind: 'tray' } : null;}
    const bar = toolbar.getBoundingClientRect();
    const zone = { left: bar.left - 16, right: bar.right + 16, top: bar.top - 16, bottom: Math.max(bar.bottom, Math.min(bar.bottom + 16, trayRect.top)) };
    if (!inside(zone)) {return null;}
    const children = Array.from(toolbar.children) as HTMLElement[];
    const at = toolbarDropSlot(children.map((c) => c.getBoundingClientRect()), x, y, 1, children.length - 1);
    if (!at) {return null;}
    // Dropping an item right where it is changes nothing: show no line.
    if (source.kind === 'toolbar' && (at.slot === source.childIndex || at.slot === source.childIndex + 1)) {return null;}
    return { kind: 'slot', at };
  }

  function showTarget(target: DropTarget | null): void {
    tray.classList.toggle('is-drop-target', target?.kind === 'tray');
    if (target?.kind === 'slot') {
      dropLine.hidden = false;
      dropLine.style.left = `${target.at.x - 1}px`;
      dropLine.style.top = `${target.at.top + 4}px`;
      dropLine.style.height = `${Math.max(0, target.at.bottom - target.at.top - 8)}px`;
    } else {
      dropLine.hidden = true;
    }
  }

  function moveGhost(x: number, y: number): void {
    if (!drag || !press) {return;}
    drag.ghost.style.left = `${x - press.dx}px`;
    drag.ghost.style.top = `${y - press.dy}px`;
  }

  function startDrag(): void {
    if (!press) {return;}
    const { source } = press;
    const ghost = document.createElement('div');
    ghost.className = 'mikedown-toolbar-ghost';
    ghost.setAttribute('aria-hidden', 'true');
    ghost.appendChild(previewOf(source.token, source.kind === 'toolbar' ? source.el : (() => {
      const def = defs.find((d) => d.id === source.token);
      return def ? renderToolbarItem(def, toolbar) : null;
    })()));
    root.appendChild(ghost);
    drag = { ghost, target: null };
    source.el.classList.add('toolbar-item-dragging');
    root.classList.add('toolbar-drag-active');
  }

  function endPress(dropIt: boolean): void {
    const p = press;
    const d = drag;
    press = null;
    drag = null;
    if (!p) {return;}
    try { p.source.el.releasePointerCapture?.(p.pointerId); } catch { /* not captured */ }
    p.source.el.classList.remove('toolbar-item-dragging');
    root.classList.remove('toolbar-drag-active');
    showTarget(null);
    d?.ghost.remove();
    // The click that follows a drag from a tray tile is not an "add" click.
    if (d) {lastDragEnd = Date.now();}
    if (!dropIt || !d?.target) {return;}
    const { source } = p;
    const target = d.target;
    if (target.kind === 'tray') {
      if (source.kind === 'toolbar') {apply(layoutWithRemove(working, source.index));}
      return;
    }
    const before = indices[target.at.slot] ?? working.items.length - 1;
    if (source.kind === 'toolbar') {
      apply(layoutWithMove(working, source.index, source.index < before ? before - 1 : before));
    } else {
      apply(layoutWithInsert(working, source.token, before));
    }
  }

  function onPointerDown(e: PointerEvent): void {
    if (press || finished || (e.button ?? 0) !== 0) {return;}
    if (grab) {dropGrab();}
    const source = sourceAt(e.target);
    if (!source) {return;}
    const r = source.el.getBoundingClientRect();
    const pointerId = typeof e.pointerId === 'number' ? e.pointerId : 1;
    press = { source, pointerId, x0: e.clientX, y0: e.clientY, dx: e.clientX - r.left, dy: e.clientY - r.top };
    try { source.el.setPointerCapture?.(pointerId); } catch { /* jsdom or an inactive pointer */ }
  }
  on<PointerEvent>(toolbar, 'pointerdown', onPointerDown);
  on<PointerEvent>(tray, 'pointerdown', onPointerDown);

  const samePointer = (e: PointerEvent) => !!press && (typeof e.pointerId !== 'number' || e.pointerId === press.pointerId);
  on<PointerEvent>(document, 'pointermove', (e) => {
    if (!press || !samePointer(e)) {return;}
    if (!drag) {
      if (Math.hypot(e.clientX - press.x0, e.clientY - press.y0) < TOOLBAR_DRAG_THRESHOLD) {return;}
      startDrag();
    }
    e.preventDefault();
    moveGhost(e.clientX, e.clientY);
    if (drag) {
      drag.target = hitTest(e.clientX, e.clientY, press.source);
      showTarget(drag.target);
    }
  });
  on<PointerEvent>(document, 'pointerup', (e) => { if (samePointer(e)) {endPress(true);} });
  on<PointerEvent>(document, 'pointercancel', (e) => { if (samePointer(e)) {endPress(false);} });

  // ── Live region ───────────────────────────────────────────────────────────
  let spoken = false;
  let parity = false;
  function announce(message: string): void {
    spoken = true;
    // A trailing no-break space on every other message makes a repeat
    // ("Text Format cannot be moved." twice) a change the screen reader reads.
    parity = !parity;
    status.textContent = parity ? `${message}\u00a0` : message;
  }
  const positionOf = (child: number): string => `position ${child + 1} of ${toolbarStops().length}`;
  const childOfLayoutIndex = (index: number): number => indices.indexOf(index);

  // ── Keyboard (D11) ────────────────────────────────────────────────────────
  /** The item picked up with Space/Enter: its layout index now, and the layout to restore on Escape. */
  let grab: { token: string; index: number; origin: ToolbarLayout; originIndex: number } | null = null;

  function focusChild(child: number): void {
    const kids = toolbarStops();
    if (!kids.length) {return;}
    kids[clamp(child, 0, kids.length - 1)].focus();
  }
  function focusTile(tile: number): void {
    const tileEls = trayStops();
    if (!tileEls.length) {return;}
    tileEls[clamp(tile, 0, tileEls.length - 1)].focus();
  }

  // Focus decides the roving stops and where a tray item is added.
  on<FocusEvent>(toolbar, 'focusin', (e) => {
    const child = childIndexOf(e.target);
    if (child < 0) {return;}
    rovingChild = child;
    insertAfterChild = child;
    syncRoving();
  });
  on<FocusEvent>(tiles, 'focusin', (e) => {
    const tile = tileIndexOf(e.target);
    if (tile < 0) {return;}
    rovingTile = tile;
    syncRoving();
  });
  // Tabbing (or clicking) away from a grabbed item drops it where it is.
  on<FocusEvent>(toolbar, 'focusout', (e) => {
    if (!grab || rendering) {return;}
    const to = e.relatedTarget;
    if (to instanceof Node && toolbar.contains(to) && childIndexOf(to) === childOfLayoutIndex(grab.index)) {return;}
    dropGrab();
  });

  function startGrab(child: number): void {
    const index = indices[child];
    const token = working.items[index];
    const label = labelOf(token, defs);
    if (TOOLBAR_FIXED_ITEMS.has(token)) {
      announce(`${label} cannot be moved.`);
      return;
    }
    grab = { token, index, origin: working, originIndex: index };
    decorate();
    announce(`Picked up ${label}, ${positionOf(child)}. Use Left and Right Arrow to move it, Space to drop it, Escape to cancel.`);
  }

  function endGrab(): { token: string; child: number } | null {
    const g = grab;
    if (!g) {return null;}
    grab = null;
    decorate();
    return { token: g.token, child: childOfLayoutIndex(g.index) };
  }

  function dropGrab(): void {
    const ended = endGrab();
    if (ended && ended.child >= 0) {announce(`Dropped ${labelOf(ended.token, defs)} at ${positionOf(ended.child)}.`);}
  }

  function cancelGrab(): void {
    const g = grab;
    if (!g) {return;}
    const child = childOfLayoutIndex(g.index);
    grab = null;
    if (g.origin !== working) {
      apply(g.origin, () => toolbarStops()[childOfLayoutIndex(g.originIndex)]);
    } else {
      decorate();
      focusChild(child);
    }
    const back = childIndexOf(document.activeElement);
    announce(`Move cancelled. ${labelOf(g.token, defs)} is back at ${positionOf(back >= 0 ? back : child)}.`);
  }

  /**
   * Move the grabbed item one visible slot (`-1`/`1`) or to the first/last
   * movable slot. A step that would make a separator or spacer merge with one
   * of its kind, or leave the item hidden, goes one slot further instead.
   */
  function moveGrab(dir: -1 | 1, toEnd = false): void {
    const g = grab;
    if (!g) {return;}
    const kids = toolbarStops();
    const from = childOfLayoutIndex(g.index);
    const lo = 1;
    const hi = kids.length - 2; // between Text Format and More
    const rendered = resolveToolbarTokenIndices(defs, working.items as ToolbarLayoutToken[]).map((i) => working.items[i]).join(' ');
    const candidates: number[] = [];
    if (toEnd) {
      for (let t = dir < 0 ? lo : hi; dir < 0 ? t < from : t > from; t -= dir) {candidates.push(t);}
    } else {
      for (let t = from + dir; t >= lo && t <= hi; t += dir) {candidates.push(t);}
    }
    const label = labelOf(g.token, defs);
    for (const t of candidates) {
      const to = indices[t];
      const raw = layoutWithMove(working, g.index, to);
      if (raw === working) {continue;}
      const norm = normalizeToolbarLayout(raw);
      const at = mapThroughNormalize(raw.items, norm.items, to);
      if (at < 0) {continue;}
      if (isDivider(g.token) && countOf(norm.items, g.token) !== countOf(working.items, g.token)) {continue;}
      const shown = resolveToolbarTokenIndices(defs, norm.items as ToolbarLayoutToken[]);
      if (!shown.includes(at)) {continue;}
      if (shown.map((i) => norm.items[i]).join(' ') === rendered) {continue;}
      g.index = at;
      apply(norm, () => toolbarStops()[childOfLayoutIndex(at)]);
      announce(`Moved ${label} to ${positionOf(childOfLayoutIndex(at))}.`);
      return;
    }
    announce(`${label} is already ${dir < 0 ? 'first' : 'last'}.`);
  }

  /** Send the item at toolbar child `child` to the tray; focus goes to the item after it. */
  function removeChild(child: number): void {
    const index = indices[child];
    const token = working.items[index];
    const label = labelOf(token, defs);
    const next = layoutWithRemove(working, index);
    if (TOOLBAR_FIXED_ITEMS.has(token) || next === working) {
      announce(`${label} cannot be moved.`);
      return;
    }
    apply(next, () => toolbarStops()[clamp(child, 0, toolbarStops().length - 1)]);
    announce(`Removed ${label}.`);
  }

  /**
   * Add the tray item `token` after the toolbar item that last had focus (or
   * before More when none did). Focus stays in the tray so several items can
   * be added in a row; each one goes after the previous.
   */
  function addFromTray(token: string, tile: number): void {
    const kids = toolbarStops();
    const last = kids.length - 1;
    const before = insertAfterChild === null || insertAfterChild >= last
      ? indices[last]
      : indices[insertAfterChild] + 1;
    const label = labelOf(token, defs);
    const raw = layoutWithInsert(working, token, before);
    if (raw === working) {return;}
    let k = 0;
    while (k < working.items.length && raw.items[k] === working.items[k]) {k++;}
    const norm = normalizeToolbarLayout(raw);
    const at = mapThroughNormalize(raw.items, norm.items, k);
    const merged = isDivider(token) && countOf(norm.items, token) !== countOf(working.items, token) + 1;
    if (at < 0 || merged || !resolveToolbarTokenIndices(defs, norm.items as ToolbarLayoutToken[]).includes(at)) {
      announce(`There is already a ${label} there.`);
      return;
    }
    rovingTile = tile;
    apply(norm, () => trayStops()[clamp(tile, 0, trayStops().length - 1)]);
    const child = childOfLayoutIndex(at);
    insertAfterChild = child;
    rovingChild = child;
    syncRoving();
    announce(`Added ${label} at ${positionOf(child)}.`);
  }

  const plainKey = (e: KeyboardEvent) => !e.altKey && !e.ctrlKey && !e.metaKey;

  on<KeyboardEvent>(toolbar, 'keydown', (e) => {
    if (finished || !plainKey(e)) {return;}
    const child = childIndexOf(e.target);
    if (child < 0) {return;}
    const last = toolbarStops().length - 1;
    const handled = (): void => { e.preventDefault(); e.stopPropagation(); };
    if (grab) {
      switch (e.key) {
        case 'ArrowLeft': handled(); moveGrab(-1); return;
        case 'ArrowRight': handled(); moveGrab(1); return;
        case 'Home': handled(); moveGrab(-1, true); return;
        case 'End': handled(); moveGrab(1, true); return;
        case 'ArrowUp': case 'ArrowDown': handled(); return;
        case ' ': case 'Enter': handled(); dropGrab(); return;
        case 'Delete': case 'Backspace': {
          handled();
          const ended = endGrab();
          if (ended && ended.child >= 0) {removeChild(ended.child);}
          return;
        }
        default: return; // Escape: the document handler cancels; Tab: focusout drops.
      }
    }
    switch (e.key) {
      case 'ArrowRight':
        handled();
        if (child < last) {focusChild(child + 1);} else if (trayStops().length) {focusTile(0);}
        return;
      case 'ArrowLeft': handled(); focusChild(child - 1); return;
      case 'Home': handled(); focusChild(0); return;
      case 'End': handled(); focusChild(last); return;
      case 'ArrowDown': handled(); focusTile(rovingTile); return;
      case 'ArrowUp': handled(); return;
      case ' ': case 'Enter': handled(); startGrab(child); return;
      case 'Delete': case 'Backspace': handled(); removeChild(child); return;
    }
  });

  on<KeyboardEvent>(tiles, 'keydown', (e) => {
    if (finished || !plainKey(e)) {return;}
    const tile = tileIndexOf(e.target);
    if (tile < 0) {return;}
    const count = trayStops().length;
    const handled = (): void => { e.preventDefault(); e.stopPropagation(); };
    switch (e.key) {
      case 'ArrowRight': handled(); focusTile(Math.min(tile + 1, count - 1)); return;
      case 'ArrowLeft':
        handled();
        if (tile > 0) {focusTile(tile - 1);} else {focusChild(rovingChild);}
        return;
      case 'Home': handled(); focusTile(0); return;
      case 'End': handled(); focusTile(count - 1); return;
      case 'ArrowUp':
      case 'ArrowDown': {
        handled();
        const rects = trayStops().map((t) => t.getBoundingClientRect());
        const next = toolbarGridNeighbor(rects, tile, e.key === 'ArrowUp' ? 'up' : 'down');
        if (next !== null) {focusTile(next);} else if (e.key === 'ArrowUp') {focusChild(rovingChild);}
        return;
      }
      case ' ': case 'Enter': {
        handled();
        const token = trayStops()[tile]?.dataset.token;
        if (token) {addFromTray(token, tile);}
        return;
      }
    }
  });

  // A plain click on a tray tile adds it the same way (a drag from it does not).
  on<MouseEvent>(tiles, 'click', (e) => {
    if (finished || e.detail === 0 || Date.now() - lastDragEnd < 400) {return;}
    const tile = tileIndexOf(e.target);
    const token = trayStops()[tile]?.dataset.token;
    if (token) {addFromTray(token, tile);}
  });

  // ── Tray buttons, Escape ──────────────────────────────────────────────────
  on(resetBtn, 'click', () => {
    if (grab) {endGrab();}
    const changed = apply({ ...DEFAULT_TOOLBAR_LAYOUT, items: [...DEFAULT_TOOLBAR_LAYOUT.items], seen: [...DEFAULT_TOOLBAR_LAYOUT.seen] });
    // Reset disables itself; keep keyboard focus in the tray, on Done.
    if (document.activeElement === resetBtn || document.activeElement === document.body) {doneBtn.focus();}
    if (changed) {announce('Toolbar reset to the default layout.');}
  });
  on(doneBtn, 'click', () => done());

  on<KeyboardEvent>(document, 'keydown', (e) => {
    if (e.key !== 'Escape' || finished) {return;}
    if (press) {
      // Escape mid-drag puts the item back where it was.
      e.preventDefault();
      e.stopPropagation();
      endPress(false);
      return;
    }
    if (grab) {
      // Escape with an item picked up puts it back; a second Escape is Done.
      e.preventDefault();
      e.stopPropagation();
      cancelGrab();
      return;
    }
    const t = e.target;
    const ours = t instanceof Node && (root.contains(t) || t === document.body || t === document.documentElement);
    if (!ours) {return;}
    e.preventDefault();
    done();
  });

  // Keep the tray under the toolbar as it wraps onto more rows.
  if (typeof ResizeObserver !== 'undefined') {
    const ro = new ResizeObserver(() => positionTray());
    ro.observe(toolbar);
    cleanups.push(() => ro.disconnect());
  }

  // ── Exit ──────────────────────────────────────────────────────────────────
  function teardown(): void {
    finished = true;
    if (press) {endPress(false);}
    while (cleanups.length) {
      try { cleanups.pop()?.(); } catch (err) { console.error('MikeDown: toolbar edit cleanup failed —', err); }
    }
    tray.remove();
    dropLine.remove();
    grab = null;
    if (instructionTimer) {clearTimeout(instructionTimer);}
    for (const el of decorated) {el.classList.remove('toolbar-item-fixed', 'toolbar-item-movable', 'toolbar-item-dragging', 'toolbar-item-grabbed');}
    for (const [el, attrs] of savedAttrs) {
      for (const [name, value] of attrs) {
        if (value === null) {el.removeAttribute(name);} else {el.setAttribute(name, value);}
      }
    }
    toolbar.classList.remove('toolbar-editing');
    if (prevLabel === null) {toolbar.removeAttribute('aria-label');} else {toolbar.setAttribute('aria-label', prevLabel);}
    root.classList.remove('mikedown-toolbar-customizing', 'toolbar-drag-active');
  }

  /** Can `el` take keyboard focus in the normal-mode toolbar? */
  function focusable(el: HTMLElement | null | undefined): el is HTMLElement {
    if (!el || !el.isConnected || el.closest('[hidden], .toolbar-overflowed')) {return false;}
    if ((el as HTMLButtonElement).disabled) {return false;}
    return el.matches('button, a[href], input, select, textarea, [tabindex]:not([tabindex="-1"])');
  }

  /** After Done: back to the opener, else the first toolbar button that can take focus, else More. */
  function returnFocus(): void {
    const opener = ctx.opener ?? null;
    const candidates = [
      opener,
      ...Array.from(toolbar.querySelectorAll<HTMLElement>('button')),
      toolbar.querySelector<HTMLElement>('button[data-action="more"]'),
    ];
    const target = candidates.find(focusable);
    target?.focus();
  }

  function done(): void {
    if (finished) {return;}
    const final = normalizeToolbarLayout(working);
    const changed = !sameItems(final.items, initial.items);
    const value = sameItems(final.items, DEFAULT_TOOLBAR_ITEMS) ? null : serializeToolbarLayout(final);
    // Only move focus when it is ours to move: in the toolbar or tray, or lost
    // to the body when they went away. Never into the document.
    const active = document.activeElement;
    const focusWasOurs = !active || active === document.body || toolbar.contains(active) || tray.contains(active);
    teardown();
    if (changed) {ctx.save(value);}
    ctx.onExit({ changed, value });
    if (focusWasOurs) {returnFocus();}
  }

  render();

  // Start on the first item that can move, and say how the keyboard works
  // (after a beat, so the screen reader has met the new live region).
  {
    const kids = toolbarStops();
    const first = kids.findIndex((_, i) => !TOOLBAR_FIXED_ITEMS.has(working.items[indices[i]]));
    rovingChild = first >= 0 ? first : 0;
    syncRoving();
    focusChild(rovingChild);
  }
  instructionTimer = setTimeout(() => {
    instructionTimer = 0;
    if (!finished && !spoken) {announce(TOOLBAR_EDIT_INSTRUCTIONS);}
  }, 150);

  return {
    get working() { return working; },
    tray,
    opener: ctx.opener ?? null,
    isChanged: () => !sameItems(normalizeToolbarLayout(working).items, initial.items),
    apply,
    layoutIndexOf: (el) => {
      const i = Array.prototype.indexOf.call(toolbar.children, el);
      return i >= 0 && i < indices.length ? indices[i] : -1;
    },
    announce,
    refresh: () => { if (!finished) {render();} },
    done,
    dispose: () => { if (!finished) {teardown();} },
  };
}

/** Done for `session` (same as its Done button). */
export function exitToolbarEditMode(session: ToolbarEditSession): void {
  session.done();
}
