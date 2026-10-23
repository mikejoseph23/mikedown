/**
 * The folder tree view (M3): lazy per-directory loading, ARIA `tree` with
 * flat `treeitem` rows (`aria-level`, `aria-setsize`, `aria-posinset`) and a
 * roving tabindex (edge case 26), keyboard navigation, type-ahead, inline
 * rename, and pointer-driven drags between rows.
 *
 * Only the root is read when a folder opens; a directory is listed the first
 * time it is expanded, and watched only while it is visible and expanded
 * (plan: Large folders). File operations are not done here: the tree reports
 * intents to its owner (`folderWorkspace.ts`), which talks to the disk.
 *
 * Keys (VS Code's explorer conventions): arrows move and expand/collapse,
 * Home/End, Space opens, Enter opens on Windows and renames on macOS, F2
 * renames, Cmd+Down opens on macOS, Delete (Cmd+Backspace on macOS) moves to
 * the Trash, Shift+F10 / the context-menu key opens the menu, letters jump by
 * name, Escape returns to the editor.
 */
import type { PathOps } from '@mikedown/core/shared/imagePaste';
import { typeAheadIndex, validateName, visibleEntries, type TreeEntry } from './treeLogic';

export interface TreeNode {
  path: string;
  name: string;
  isDir: boolean;
  depth: number;
  parent: TreeNode | null;
  expanded: boolean;
  /** Children once listed; null until the first expand. */
  children: TreeNode[] | null;
  loading: boolean;
}

export interface FileTreeDeps {
  path: PathOps;
  isMac: boolean;
  /** Validate names with Windows' rules. */
  windows: boolean;
  listDir(dir: string): Promise<TreeEntry[]>;
  showHidden(): boolean;
  watch(dir: string): void;
  unwatch(dir: string): void;
  open(node: TreeNode): void;
  contextMenu(node: TreeNode | null, x: number, y: number): void;
  /**
   * Commit an inline rename. Resolves with the new path, or false to keep
   * the field open (the owner showed the error).
   */
  rename(node: TreeNode, newName: string): Promise<string | false>;
  remove(nodes: TreeNode[]): void;
  /** A row was dragged onto a folder (or the root). `alt`: Option/Alt was held at the drop. */
  drop(sources: TreeNode[], targetDir: string, alt: boolean): void;
  /** Escape from the tree: give focus back to the editor. */
  leave(): void;
}

export interface FileTree {
  readonly el: HTMLElement;
  root(): string | null;
  setRoot(root: string | null): Promise<void>;
  /** Re-list a loaded directory, keeping expansion state below it. */
  refreshDir(dir: string): Promise<void>;
  /** Re-list every loaded directory (show hidden toggled). */
  refreshAll(): Promise<void>;
  /** Expand the ancestors of `path`, select it and scroll it into view. */
  reveal(path: string, opts?: { focus?: boolean }): Promise<void>;
  /** Mark the row of the open document. */
  setActive(path: string | null): void;
  focus(): void;
  /** Put a row into inline-rename mode (after New File / New Folder, or F2). */
  startRename(path: string, opts?: { selectStem?: boolean }): Promise<void>;
  isRenaming(): boolean;
  selectedNode(): TreeNode | null;
  findNode(path: string): TreeNode | null;
  /** Visible, expanded directories (for session restore in M4). */
  expandedDirs(): string[];
  /** The row under a viewport point, for drops from outside the app. */
  rowAt(x: number, y: number): TreeNode | null;
  /** Highlight the folder a drop would land in (null clears). */
  setDropTarget(dir: string | null): void;
}

const TYPEAHEAD_RESET_MS = 700;
/** Must match `.mdapp-tree__row { height }` in sidebar.css. */
const ROW_HEIGHT = 24;
const OVERSCAN = 20;
const DRAG_THRESHOLD_PX = 4;

let nextTreeId = 1;

export function createFileTree(deps: FileTreeDeps): FileTree {
  const { path } = deps;
  const treeId = `mdapp-tree-${nextTreeId++}`;
  const el = document.createElement('div');
  el.className = 'mdapp-tree';
  el.setAttribute('role', 'tree');
  el.setAttribute('aria-label', 'Files');
  el.tabIndex = -1;

  let rootNode: TreeNode | null = null;
  let rows: TreeNode[] = [];
  let rowIndex = new Map<TreeNode, number>();
  let painted: [number, number] = [-1, -1];
  let scrollHost: HTMLElement | null = null;
  let focused: TreeNode | null = null;
  let activePath: string | null = null;
  let dropTarget: string | null = null;
  let editing: { path: string; selectStem: boolean } | null = null;
  const pendingRefresh = new Set<string>();
  const watched = new Set<string>();
  let typeBuffer = '';
  let typeTimer: ReturnType<typeof setTimeout> | undefined;
  let rowIds = new Map<string, string>();
  let rowEls = new Map<string, HTMLElement>();
  let idCounter = 0;

  function makeNode(entry: TreeEntry, parent: TreeNode): TreeNode {
    return {
      path: path.join(parent.path, entry.name),
      name: entry.name,
      isDir: entry.isDir,
      depth: parent.depth + 1,
      parent,
      expanded: false,
      children: null,
      loading: false,
    };
  }

  function flatten(): TreeNode[] {
    const out: TreeNode[] = [];
    const walk = (node: TreeNode): void => {
      for (const child of node.children ?? []) {
        out.push(child);
        if (child.isDir && child.expanded) {walk(child);}
      }
    };
    if (rootNode) {walk(rootNode);}
    return out;
  }

  /** Watch exactly the visible expanded directories (and the root). */
  function syncWatches(): void {
    const want = new Set<string>();
    if (rootNode) {
      want.add(rootNode.path);
      for (const row of rows) {if (row.isDir && row.expanded) {want.add(row.path);}}
    }
    for (const dir of [...watched]) {
      if (!want.has(dir)) {
        watched.delete(dir);
        deps.unwatch(dir);
      }
    }
    for (const dir of want) {
      if (!watched.has(dir)) {
        watched.add(dir);
        deps.watch(dir);
      }
    }
  }

  function rowId(node: TreeNode): string {
    let id = rowIds.get(node.path);
    if (!id) {
      id = `${treeId}-r${idCounter++}`;
      rowIds.set(node.path, id);
    }
    return id;
  }

  /**
   * Rebuild the visible-row list and paint the rows in view. Rows are
   * virtualised (fixed height, spacers above and below) so a folder with
   * thousands of entries in one directory stays fast; `aria-setsize` and
   * `aria-posinset` keep the structure for assistive technology.
   */
  function render(): void {
    rows = flatten();
    rowIndex = new Map(rows.map((r, i) => [r, i]));
    if (focused && !rowIndex.has(focused)) {
      focused = rows.find((r) => r.path === focused?.path) ?? null;
    }
    if (!focused && rows.length > 0) {focused = rows[0];}
    const hadFocus = el.contains(document.activeElement);
    paint(true);
    el.classList.toggle('mdapp-tree--drop-root', dropTarget !== null && dropTarget === rootNode?.path);
    if (hadFocus && !editing) {focusRow(focused, { scroll: false });}
    syncWatches();
  }

  function scroller(): HTMLElement | null {
    return el.parentElement;
  }

  /** The [start, end) slice of `rows` in view, with overscan. */
  function windowRange(): [number, number] {
    const sc = scroller();
    const viewTop = sc ? Math.max(0, sc.scrollTop - el.offsetTop) : 0;
    const viewH = sc && sc.clientHeight > 0 ? sc.clientHeight : 2000;
    const start = Math.max(0, Math.floor(viewTop / ROW_HEIGHT) - OVERSCAN);
    const end = Math.min(rows.length, Math.ceil((viewTop + viewH) / ROW_HEIGHT) + OVERSCAN);
    return [start, end];
  }

  function paint(force: boolean, around?: number): void {
    const sc = scroller();
    if (sc && sc !== scrollHost) {
      scrollHost?.removeEventListener('scroll', onScroll);
      scrollHost = sc;
      sc.addEventListener('scroll', onScroll, { passive: true });
    }
    let [start, end] = windowRange();
    // Keep the row being renamed (or asked for) painted whatever the scroll
    // position says (no layout yet, a hidden sidebar).
    const editIdx = editing ? rows.findIndex((r) => r.path === editing?.path) : -1;
    const keep = around ?? (editIdx >= 0 ? editIdx : undefined);
    if (keep !== undefined && (keep < start || keep >= end)) {
      start = Math.max(0, keep - OVERSCAN);
      end = Math.min(rows.length, keep + OVERSCAN + 1);
    }
    if (!force && start === painted[0] && end === painted[1]) {return;}
    painted = [start, end];
    const posIn = new Map<TreeNode, number>();
    const frag = document.createDocumentFragment();
    const top = document.createElement('div');
    top.setAttribute('role', 'presentation');
    top.style.height = `${start * ROW_HEIGHT}px`;
    frag.appendChild(top);
    const liveIds = new Map<string, string>();
    const liveEls = new Map<string, HTMLElement>();
    for (let i = start; i < end; i++) {
      const node = rows[i];
      const siblings = node.parent?.children ?? [];
      if (!posIn.has(node)) {siblings.forEach((s, k) => posIn.set(s, k + 1));}
      const row = document.createElement('div');
      row.className = 'mdapp-tree__row';
      row.id = rowId(node);
      liveIds.set(node.path, row.id);
      liveEls.set(node.path, row);
      row.setAttribute('role', 'treeitem');
      row.setAttribute('aria-level', String(node.depth));
      row.setAttribute('aria-setsize', String(siblings.length));
      row.setAttribute('aria-posinset', String(posIn.get(node) ?? 1));
      row.setAttribute('aria-selected', node === focused ? 'true' : 'false');
      if (node.isDir) {row.setAttribute('aria-expanded', node.expanded ? 'true' : 'false');}
      row.dataset.path = node.path;
      row.style.setProperty('--mdapp-depth', String(node.depth - 1));
      row.tabIndex = node === focused ? 0 : -1;
      row.title = node.path;
      if (node.path === activePath) {row.classList.add('mdapp-tree__row--active');}
      if (node.isDir && node.path === dropTarget) {row.classList.add('mdapp-tree__row--drop');}
      // The twisty is drawn by CSS from aria-expanded, so the row's text is just its name.
      if (node.loading) {row.classList.add('mdapp-tree__row--loading');}
      const twisty = document.createElement('span');
      twisty.className = 'mdapp-tree__twisty';
      twisty.setAttribute('aria-hidden', 'true');
      const icon = document.createElement('span');
      icon.className = `mdapp-tree__icon ${node.isDir ? 'mdapp-tree__icon--dir' : /\.(md|markdown)$/i.test(node.name) ? 'mdapp-tree__icon--md' : 'mdapp-tree__icon--file'}`;
      icon.setAttribute('aria-hidden', 'true');
      row.append(twisty, icon);
      if (editing && editing.path === node.path) {
        row.appendChild(renameField(node, editing.selectStem));
      } else {
        const name = document.createElement('span');
        name.className = 'mdapp-tree__name';
        name.textContent = node.name;
        row.appendChild(name);
      }
      frag.appendChild(row);
    }
    const bottom = document.createElement('div');
    bottom.setAttribute('role', 'presentation');
    bottom.style.height = `${(rows.length - end) * ROW_HEIGHT}px`;
    frag.appendChild(bottom);
    rowIds = liveIds;
    rowEls = liveEls;
    const hadFocus = el.contains(document.activeElement) && !editing;
    el.replaceChildren(frag);
    if (hadFocus && focused && rowEls.has(focused.path)) {
      rowEls.get(focused.path)!.focus({ preventScroll: true });
    } else if (hadFocus) {
      el.focus({ preventScroll: true });
    }
  }

  /** Scroll so row `i` is in view (nearest edge), then paint. */
  function ensureVisible(i: number): void {
    const sc = scroller();
    if (sc && sc.clientHeight > 0) {
      const rowTop = el.offsetTop + i * ROW_HEIGHT;
      if (rowTop < sc.scrollTop) {sc.scrollTop = rowTop;}
      else if (rowTop + ROW_HEIGHT > sc.scrollTop + sc.clientHeight) {sc.scrollTop = rowTop + ROW_HEIGHT - sc.clientHeight;}
    }
    paint(false, i);
  }

  function onScroll(): void {
    paint(false);
  }

  function rowEl(node: TreeNode | null): HTMLElement | null {
    if (!node) {return null;}
    return rowEls.get(node.path) ?? null;
  }

  function focusRow(node: TreeNode | null, opts: { scroll?: boolean } = {}): void {
    if (!node) {
      el.focus();
      return;
    }
    if (focused !== node) {
      const prev = rowEl(focused);
      if (prev) {
        prev.tabIndex = -1;
        prev.setAttribute('aria-selected', 'false');
      }
      focused = node;
    }
    const idx = rowIndex.get(node);
    if (opts.scroll !== false && idx !== undefined) {ensureVisible(idx);}
    else if (!rowEls.has(node.path) && idx !== undefined) {ensureVisible(idx);}
    const r = rowEl(node);
    if (r) {
      r.tabIndex = 0;
      r.setAttribute('aria-selected', 'true');
      r.focus({ preventScroll: true });
    }
  }

  async function load(node: TreeNode): Promise<void> {
    node.loading = true;
    try {
      const entries = visibleEntries(await deps.listDir(node.path), deps.showHidden());
      const old = new Map((node.children ?? []).map((c) => [c.name, c]));
      node.children = entries.map((e) => {
        const prev = old.get(e.name);
        if (prev && prev.isDir === e.isDir) {return prev;}
        return makeNode(e, node);
      });
    } catch (err) {
      console.warn('MikeDown: could not list', node.path, err);
      node.children = node.children ?? [];
    } finally {
      node.loading = false;
    }
  }

  async function expand(node: TreeNode): Promise<void> {
    if (!node.isDir || node.expanded) {return;}
    node.expanded = true;
    if (node.children === null) {
      node.loading = true;
      render();
      await load(node);
    }
    render();
  }

  function collapse(node: TreeNode): void {
    if (!node.isDir || !node.expanded) {return;}
    node.expanded = false;
    render();
  }

  function findNode(p: string): TreeNode | null {
    if (!rootNode) {return null;}
    if (path.relative(rootNode.path, p) === '') {return rootNode;}
    const stack = [...(rootNode.children ?? [])];
    while (stack.length) {
      const n = stack.pop()!;
      if (n.path === p) {return n;}
      if (n.children && isAncestor(n.path, p)) {stack.push(...n.children);}
    }
    return null;
  }

  function isAncestor(dir: string, p: string): boolean {
    const rel = path.relative(dir, p);
    return rel !== '' && rel.split(/[\\/]/)[0] !== '..' && !path.isAbsolute(rel);
  }

  async function refreshDir(dir: string): Promise<void> {
    if (editing) {
      pendingRefresh.add(dir);
      return;
    }
    const node = findNode(dir);
    if (!node || !node.isDir || node.children === null) {return;}
    await load(node);
    render();
  }

  // ── Inline rename ──────────────────────────────────────────────────────

  function renameField(node: TreeNode, selectStem: boolean): HTMLElement {
    const wrap = document.createElement('span');
    wrap.className = 'mdapp-tree__rename';
    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'mdapp-tree__input';
    input.value = node.name;
    input.setAttribute('aria-label', `Rename ${node.name}`);
    input.spellcheck = false;
    const error = document.createElement('span');
    error.className = 'mdapp-tree__error';
    error.setAttribute('role', 'alert');
    error.hidden = true;
    wrap.append(input, error);

    let done = false;
    const validate = (): string | null => {
      const msg = validateName(input.value, deps.windows);
      error.hidden = !msg;
      error.textContent = msg ?? '';
      input.setAttribute('aria-invalid', msg ? 'true' : 'false');
      return msg;
    };
    const finish = async (commit: boolean): Promise<void> => {
      if (done) {return;}
      const value = input.value.trim();
      let renamedTo: string | null = null;
      if (commit && value !== node.name) {
        if (validate()) {
          input.focus();
          return;
        }
        done = true;
        const result = await deps.rename(node, value);
        if (result === false) {
          done = false;
          input.focus();
          return;
        }
        renamedTo = result;
      }
      done = true;
      void endRename(node, renamedTo);
    };
    input.addEventListener('input', validate);
    input.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Enter') { e.preventDefault(); void finish(true); }
      else if (e.key === 'Escape') { e.preventDefault(); void finish(false); }
    });
    input.addEventListener('blur', () => { void finish(true); });
    input.addEventListener('mousedown', (e) => e.stopPropagation());
    queueMicrotask(() => {
      input.focus();
      const dot = node.isDir ? -1 : node.name.lastIndexOf('.');
      if (selectStem && dot > 0) {input.setSelectionRange(0, dot);}
      else {input.select();}
    });
    return wrap;
  }

  async function endRename(node: TreeNode, renamedTo: string | null): Promise<void> {
    editing = null;
    const dirs = new Set(pendingRefresh);
    pendingRefresh.clear();
    if (renamedTo && node.parent) {dirs.add(node.parent.path);}
    for (const d of dirs) {
      const n = findNode(d);
      if (n && n.children !== null) {await load(n);}
    }
    render();
    const target = findNode(renamedTo ?? node.path);
    focusRow(target && rows.includes(target) ? target : focused);
  }

  async function startRename(p: string, opts: { selectStem?: boolean } = {}): Promise<void> {
    await reveal(p, { focus: false });
    const node = findNode(p);
    if (!node || node === rootNode) {return;}
    focused = node;
    editing = { path: p, selectStem: opts.selectStem ?? true };
    render();
  }

  // ── Reveal ─────────────────────────────────────────────────────────────

  async function reveal(p: string, opts: { focus?: boolean } = {}): Promise<void> {
    if (!rootNode || !isAncestor(rootNode.path, p)) {return;}
    const rel = path.relative(rootNode.path, p).split(/[\\/]/).filter(Boolean);
    let node: TreeNode = rootNode;
    for (let i = 0; i < rel.length; i++) {
      if (node.children === null) {await load(node);}
      if (node !== rootNode && !node.expanded) {node.expanded = true;}
      const next = (node.children ?? []).find((c) => c.name === rel[i]);
      if (!next) {break;}
      node = next;
    }
    render();
    if (node !== rootNode) {
      if (opts.focus) {focusRow(node);}
      else {
        focused = node;
        render();
        const idx = rowIndex.get(node);
        if (idx !== undefined) {ensureVisible(idx);}
      }
    }
  }

  // ── Keyboard ───────────────────────────────────────────────────────────

  el.addEventListener('keydown', (e) => {
    if (editing) {return;}
    // Keys act on the row that has focus.
    const hit = nodeFromEvent(e);
    if (hit) {focused = hit;}
    const i = focused ? rows.indexOf(focused) : -1;
    const node = focused;
    const mod = deps.isMac ? e.metaKey : e.ctrlKey;
    const go = (idx: number): void => {
      if (rows.length === 0) {return;}
      e.preventDefault();
      focusRow(rows[Math.max(0, Math.min(rows.length - 1, idx))]);
    };
    switch (e.key) {
      case 'ArrowDown':
        if (deps.isMac && e.metaKey && node) { e.preventDefault(); openNode(node); return; }
        go(i + 1); return;
      case 'ArrowUp': go(i - 1); return;
      case 'Home': go(0); return;
      case 'End': go(rows.length - 1); return;
      case 'PageDown': go(i + 10); return;
      case 'PageUp': go(i - 10); return;
      case 'ArrowRight':
        if (!node) {return;}
        e.preventDefault();
        if (node.isDir && !node.expanded) {void expand(node);}
        else if (node.isDir && node.children && node.children.length > 0) {focusRow(node.children[0]);}
        return;
      case 'ArrowLeft':
        if (!node) {return;}
        e.preventDefault();
        if (node.isDir && node.expanded) {collapse(node);}
        else if (node.parent && node.parent !== rootNode) {focusRow(node.parent);}
        return;
      case 'Enter':
        if (!node || mod) {return;}
        e.preventDefault();
        if (deps.isMac) {void startRename(node.path);}
        else {openNode(node);}
        return;
      case ' ':
        if (!node || typeBuffer) {break;}
        e.preventDefault();
        openNode(node);
        return;
      case 'F2':
        if (!node) {return;}
        e.preventDefault();
        void startRename(node.path);
        return;
      case 'Delete':
        if (!node) {return;}
        e.preventDefault();
        deps.remove([node]);
        return;
      case 'Backspace':
        if (!node || !(deps.isMac && e.metaKey)) {return;}
        e.preventDefault();
        deps.remove([node]);
        return;
      case 'ContextMenu':
        e.preventDefault();
        menuAt(node);
        return;
      case 'F10':
        if (!e.shiftKey) {return;}
        e.preventDefault();
        menuAt(node);
        return;
      case 'Escape':
        e.preventDefault();
        deps.leave();
        return;
      default:
        break;
    }
    // Type-ahead: printable characters without modifiers.
    if (e.key.length === 1 && !e.metaKey && !e.ctrlKey && !e.altKey) {
      e.preventDefault();
      e.stopPropagation();
      typeBuffer += e.key;
      clearTimeout(typeTimer);
      typeTimer = setTimeout(() => { typeBuffer = ''; }, TYPEAHEAD_RESET_MS);
      const idx = typeAheadIndex(rows.map((r) => r.name), typeBuffer, i);
      if (idx >= 0) {focusRow(rows[idx]);}
    }
  });

  function openNode(node: TreeNode): void {
    if (node.isDir) {
      if (node.expanded) {collapse(node);}
      else {void expand(node);}
      return;
    }
    deps.open(node);
  }

  function menuAt(node: TreeNode | null): void {
    const r = rowEl(node);
    const box = (r ?? el).getBoundingClientRect();
    deps.contextMenu(node, box.left + 24, box.top + Math.min(box.height, 24));
  }

  // ── Mouse: click, context menu, drag ───────────────────────────────────

  function nodeFromEvent(e: Event): TreeNode | null {
    const row = (e.target as HTMLElement).closest<HTMLElement>('.mdapp-tree__row');
    if (!row?.dataset.path) {return null;}
    return rows.find((n) => n.path === row.dataset.path) ?? null;
  }

  let drag: {
    node: TreeNode;
    x: number;
    y: number;
    active: boolean;
    ghost: HTMLElement | null;
    target: string | null;
  } | null = null;

  el.addEventListener('mousedown', (e) => {
    if (e.button !== 0 || editing) {return;}
    const node = nodeFromEvent(e);
    if (!node) {return;}
    drag = { node, x: e.clientX, y: e.clientY, active: false, ghost: null, target: null };
  });

  function dropDirFor(target: TreeNode | null): string | null {
    if (!rootNode) {return null;}
    if (!target) {return rootNode.path;}
    return target.isDir ? target.path : (target.parent ?? rootNode).path;
  }

  window.addEventListener('mousemove', (e) => {
    if (!drag) {return;}
    if (!drag.active) {
      if (Math.abs(e.clientX - drag.x) < DRAG_THRESHOLD_PX && Math.abs(e.clientY - drag.y) < DRAG_THRESHOLD_PX) {return;}
      drag.active = true;
      drag.ghost = document.createElement('div');
      drag.ghost.className = 'mdapp-tree__ghost';
      drag.ghost.textContent = drag.node.name;
      document.body.appendChild(drag.ghost);
      el.classList.add('mdapp-tree--dragging');
    }
    if (drag.ghost) {
      drag.ghost.style.left = `${e.clientX + 12}px`;
      drag.ghost.style.top = `${e.clientY + 8}px`;
      drag.ghost.classList.toggle('mdapp-tree__ghost--copy', e.altKey);
    }
    const inside = el.contains(document.elementFromPoint(e.clientX, e.clientY));
    const over = inside ? rowAt(e.clientX, e.clientY) : null;
    const dir = inside ? dropDirFor(over) : null;
    drag.target = dir;
    setDropTarget(dir);
  });

  window.addEventListener('mouseup', (e) => {
    const d = drag;
    drag = null;
    if (!d) {return;}
    if (d.active) {
      d.ghost?.remove();
      el.classList.remove('mdapp-tree--dragging');
      setDropTarget(null);
      if (d.target) {deps.drop([d.node], d.target, e.altKey);}
      // Swallow the click that follows a drag.
      const swallow = (ev: Event): void => { ev.stopPropagation(); ev.preventDefault(); };
      el.addEventListener('click', swallow, { capture: true, once: true });
      setTimeout(() => el.removeEventListener('click', swallow, { capture: true }), 0);
    }
  });

  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && drag?.active) {
      drag.ghost?.remove();
      el.classList.remove('mdapp-tree--dragging');
      drag = null;
      setDropTarget(null);
    }
  }, true);

  el.addEventListener('click', (e) => {
    if (editing) {return;}
    const node = nodeFromEvent(e);
    if (!node) {return;}
    focusRow(node, { scroll: false });
    openNode(node);
  });

  el.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    const node = nodeFromEvent(e);
    if (node) {focusRow(node, { scroll: false });}
    deps.contextMenu(node, e.clientX, e.clientY);
  });

  el.addEventListener('focus', () => {
    // Focus landed on the container (Tab in, or after a re-render): move it
    // to the roving row.
    if (document.activeElement === el && focused) {focusRow(focused);}
  });

  function rowAt(x: number, y: number): TreeNode | null {
    const hit = document.elementFromPoint(x, y) as HTMLElement | null;
    const row = hit?.closest<HTMLElement>('.mdapp-tree__row');
    if (!row || !el.contains(row)) {return null;}
    return rows.find((n) => n.path === row.dataset.path) ?? null;
  }

  function setDropTarget(dir: string | null): void {
    if (dir === dropTarget) {return;}
    dropTarget = dir;
    for (const r of el.querySelectorAll('.mdapp-tree__row--drop')) {r.classList.remove('mdapp-tree__row--drop');}
    el.classList.toggle('mdapp-tree--drop-root', dir !== null && dir === rootNode?.path);
    if (dir) {
      const n = rows.find((r) => r.path === dir);
      rowEl(n ?? null)?.classList.add('mdapp-tree__row--drop');
    }
  }

  return {
    el,
    root: () => rootNode?.path ?? null,
    async setRoot(root) {
      editing = null;
      pendingRefresh.clear();
      focused = null;
      rowIds = new Map();
      rowEls = new Map();
      if (!root) {
        rootNode = null;
        render();
        return;
      }
      rootNode = {
        path: root,
        name: path.basename(root) || root,
        isDir: true,
        depth: 0,
        parent: null,
        expanded: true,
        children: null,
        loading: true,
      };
      await load(rootNode);
      render();
    },
    refreshDir,
    async refreshAll() {
      if (!rootNode) {return;}
      const dirs: TreeNode[] = [];
      const walk = (n: TreeNode): void => {
        if (n.children !== null) {
          dirs.push(n);
          for (const c of n.children) {if (c.isDir) {walk(c);}}
        }
      };
      walk(rootNode);
      for (const d of dirs) {await load(d);}
      render();
    },
    reveal,
    setActive(p) {
      activePath = p;
      for (const r of el.querySelectorAll('.mdapp-tree__row--active')) {r.classList.remove('mdapp-tree__row--active');}
      if (p) {
        const n = rows.find((r) => r.path === p);
        rowEl(n ?? null)?.classList.add('mdapp-tree__row--active');
      }
    },
    focus() {
      if (focused) {focusRow(focused);}
      else {el.focus();}
    },
    startRename,
    isRenaming: () => editing !== null,
    selectedNode: () => focused,
    findNode,
    expandedDirs: () => rows.filter((r) => r.isDir && r.expanded).map((r) => r.path),
    rowAt,
    setDropTarget,
  };
}
