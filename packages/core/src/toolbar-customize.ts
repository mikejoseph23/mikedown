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
 * Keyboard (M5) plugs into the session: `apply` takes a layout from the
 * `layoutWith*` helpers, `layoutIndexOf` maps a toolbar child to its slot,
 * `announce` writes to the tray's live region, and `opener` is where focus
 * returns on Done.
 *
 * Only toolbar chrome is touched: the toolbar, the tray, the ghost and the
 * insertion line all live in `.mikedown-root` beside the editor container.
 * Nothing here reads or writes the ProseMirror DOM.
 */

import {
  DEFAULT_TOOLBAR_ITEMS,
  TOOLBAR_SEPARATOR,
  TOOLBAR_SPACER,
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

/** Turn `ctx.toolbar` into the drag-and-drop editor. One session per editor instance at a time. */
export function enterToolbarEditMode(ctx: ToolbarCustomizeContext): ToolbarEditSession {
  const { root, toolbar, defs } = ctx;
  const initial = normalizeToolbarLayout(ctx.layout);
  let working = initial;
  /** Rendered toolbar child i shows `working.items[indices[i]]`. */
  let indices: number[] = [];
  let finished = false;

  const cleanups: Array<() => void> = [];
  function on<E extends Event>(target: EventTarget, type: string, fn: (e: E) => void, opts?: boolean | AddEventListenerOptions): void {
    const listener = fn as EventListener;
    target.addEventListener(type, listener, opts);
    cleanups.push(() => target.removeEventListener(type, listener, opts));
  }

  // ── Normal-mode state to restore on exit ─────────────────────────────────
  const prevLabel = toolbar.getAttribute('aria-label');
  const ariaDisabled = new Map<HTMLElement, string | null>();
  const decorated = new Set<HTMLElement>();

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

  function decorate(): void {
    for (const child of Array.from(toolbar.children) as HTMLElement[]) {
      const fixed = TOOLBAR_FIXED_ITEMS.has(tokenOfChild(child));
      child.classList.toggle('toolbar-item-fixed', fixed);
      child.classList.toggle('toolbar-item-movable', !fixed);
      decorated.add(child);
      const buttons = child.tagName === 'BUTTON' ? [child] : Array.from(child.querySelectorAll<HTMLElement>('button'));
      for (const btn of buttons) {
        if (!ariaDisabled.has(btn)) {ariaDisabled.set(btn, btn.getAttribute('aria-disabled'));}
        btn.setAttribute('aria-disabled', 'true');
      }
    }
  }

  function renderTray(): void {
    const present = new Set(working.items);
    const unused = defs.filter((d) => !present.has(d.id) && (!d.available || d.available()));
    const tokens = [...unused.map((d) => d.id as string), TOOLBAR_SEPARATOR, TOOLBAR_SPACER];
    tiles.replaceChildren(...tokens.map((token) => {
      const def = defs.find((d) => d.id === token);
      const tile = document.createElement('button');
      tile.type = 'button';
      tile.className = 'toolbar-tray-item';
      tile.dataset.token = token;
      const label = labelOf(token, defs);
      tile.setAttribute('aria-label', label);
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

  function render(): void {
    const items = working.items as ToolbarLayoutToken[];
    const rendered = renderToolbar(toolbar, defs, items);
    indices = resolveToolbarTokenIndices(defs, items);
    decorate();
    layoutToolbarOverflow(toolbar); // edit mode: clears overflow, shows More
    renderTray();
    positionTray();
    ctx.onRender?.(rendered, working.items);
  }

  function apply(next: ToolbarLayout): boolean {
    if (finished || next === working) {return false;}
    working = normalizeToolbarLayout(next);
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

  // ── Tray buttons, Escape ──────────────────────────────────────────────────
  on(resetBtn, 'click', () => {
    apply({ ...DEFAULT_TOOLBAR_LAYOUT, items: [...DEFAULT_TOOLBAR_LAYOUT.items], seen: [...DEFAULT_TOOLBAR_LAYOUT.seen] });
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
    for (const el of decorated) {el.classList.remove('toolbar-item-fixed', 'toolbar-item-movable', 'toolbar-item-dragging');}
    for (const [btn, value] of ariaDisabled) {
      if (value === null) {btn.removeAttribute('aria-disabled');} else {btn.setAttribute('aria-disabled', value);}
    }
    toolbar.classList.remove('toolbar-editing');
    if (prevLabel === null) {toolbar.removeAttribute('aria-label');} else {toolbar.setAttribute('aria-label', prevLabel);}
    root.classList.remove('mikedown-toolbar-customizing', 'toolbar-drag-active');
  }

  function done(): void {
    if (finished) {return;}
    const final = normalizeToolbarLayout(working);
    const changed = !sameItems(final.items, initial.items);
    const value = sameItems(final.items, DEFAULT_TOOLBAR_ITEMS) ? null : serializeToolbarLayout(final);
    teardown();
    if (changed) {ctx.save(value);}
    ctx.onExit({ changed, value });
  }

  render();

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
    announce: (message) => { status.textContent = message; },
    refresh: () => { if (!finished) {render();} },
    done,
    dispose: () => { if (!finished) {teardown();} },
  };
}

/** Done for `session` (same as its Done button). */
export function exitToolbarEditMode(session: ToolbarEditSession): void {
  session.done();
}
