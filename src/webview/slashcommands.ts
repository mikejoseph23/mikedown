/**
 * Slash command menu ("/" menu).
 *
 * Typing `/` at the start of a textblock or right after whitespace opens a
 * floating, filterable command menu. The query is re-derived from the text
 * before the cursor on every view update (same pattern as
 * `wikilinkautocomplete.ts`), and matched against the pure registry in
 * `slashcommands-registry.ts`.
 *
 * Invariants:
 *  - The popup lives in `document.body`; nothing here touches
 *    `editor.view.dom` (see commit f5415e0).
 *  - Closing the menu, for any reason, never dispatches a transaction. The
 *    `/` position is remembered as "dismissed" so the next keystroke does not
 *    reopen it; the memory is mapped through document changes and cleared when
 *    that `/` is deleted.
 *  - Executing a command replaces `/query` in ONE transaction with
 *    `closeHistory` applied, so a single undo restores the typed `/query`.
 *
 * M2 only executes H1–H6 and Paragraph; M3/M6 wire the rest through
 * `setSlashCommandHandler`.
 */

import { Extension } from '@tiptap/core';
import { Plugin, PluginKey, TextSelection } from '@tiptap/pm/state';
import type { Transaction } from '@tiptap/pm/state';
import type { EditorView } from '@tiptap/pm/view';
import type { Mark, ResolvedPos, Node as PmNode } from '@tiptap/pm/model';
import { closeHistory } from '@tiptap/pm/history';
import {
  extractSlashQuery,
  matchCommands,
  type SlashCommand,
  type SlashCommandGroup
} from './slashcommands-registry';

// ── Public config ─────────────────────────────────────────────────────────────

export interface SlashCommandsConfig {
  enabled: boolean;
  dateFormat: 'iso' | 'long';
  timeZone: string;
}

let config: SlashCommandsConfig = { enabled: true, dateFormat: 'iso', timeZone: 'local' };
let sourceModeActive = false;
let postMessage: ((msg: unknown) => void) | null = null;
let frontmatterProvider: () => boolean = () => false;
/** Optional external executor for commands beyond H1–H6/Paragraph (M3/M6).
 *  Return true when the command was handled. */
let externalHandler:
  | ((id: string, range: { from: number; to: number }, view: EditorView) => boolean)
  | null = null;

export function setSlashCommandsConfig(next: Partial<SlashCommandsConfig>): void {
  config = { ...config, ...next };
  if (!config.enabled) {
    closeSlashMenu();
  }
}

export function getSlashCommandsConfig(): SlashCommandsConfig {
  return { ...config };
}

/** Called by editor-main when toggling source mode. Entering source mode closes the menu. */
export function setSlashSourceMode(active: boolean): void {
  sourceModeActive = active;
  if (active) {
    closeSlashMenu();
  }
}

/** Host messaging hook (the webview's single `acquireVsCodeApi()` instance). */
export function setSlashPostMessage(fn: (msg: unknown) => void): void {
  postMessage = fn;
}

/** Reports whether the current document has YAML frontmatter. */
export function setSlashFrontmatterProvider(fn: () => boolean): void {
  frontmatterProvider = fn;
}

export function setSlashCommandHandler(
  fn: ((id: string, range: { from: number; to: number }, view: EditorView) => boolean) | null
): void {
  externalHandler = fn;
}

/**
 * Marks `pos` (a `/`) as dismissed without touching the document. M3 uses
 * this when handing off to a follow-up picker (table/link/emoji/code
 * language) that keeps `/query` in the doc until it commits: the slash
 * plugin would otherwise re-derive the same query on the next view update
 * (e.g. the picker's own input stealing focus) and reopen the menu on top of
 * the picker, or reopen it after a cancel restores `/query` via undo.
 */
export function markSlashDismissed(pos: number): void {
  const box = dismissBox();
  if (box) {
    box.dismissedAt = pos;
  }
}

const slashCommandsKey = new PluginKey<DismissBox>('slashCommands');

// ── Popup state ───────────────────────────────────────────────────────────────

interface PopupState {
  from: number; // position of the `/`
  to: number; // cursor position (end of query)
  query: string;
  matches: SlashCommand[]; // in display (= navigation) order
  /** 0..matches.length-1 for commands, matches.length for the footer row. */
  activeIndex: number;
}

let popupEl: HTMLElement | null = null;
let listEl: HTMLElement | null = null;
let state: PopupState | null = null;
let viewRef: EditorView | null = null;

/**
 * Dismissal memory, kept in the plugin state so it is mapped through every
 * document change without side effects in `apply`. The object is mutated in
 * place when the menu closes (closing must never dispatch a transaction);
 * `apply` derives a fresh, mapped copy on each doc change.
 */
interface DismissBox {
  /** Doc position of a `/` whose menu was dismissed; do not reopen for it. */
  dismissedAt: number | null;
  /** `/` position of the currently open menu, mapped like `dismissedAt`. */
  openFrom: number | null;
  /** Keep positions numerically stable across the next full-document reload
   *  (host `update`), where mapping would otherwise mark them deleted. */
  holdThroughReload: boolean;
}

function dismissBox(): DismissBox | null {
  return viewRef ? (slashCommandsKey.getState(viewRef.state) ?? null) : null;
}

const LISTBOX_ID = 'mikedown-slash-menu';
const OPTION_ID_PREFIX = 'mikedown-slash-opt-';
const FOOTER_ID = 'mikedown-slash-opt-off';

const GROUP_ORDER: SlashCommandGroup[] = ['basic', 'lists', 'insert', 'callouts'];
const GROUP_LABEL: Record<SlashCommandGroup, string> = {
  basic: 'Basic blocks',
  lists: 'Lists',
  insert: 'Insert',
  callouts: 'Callouts'
};

export function isSlashMenuOpen(): boolean {
  return popupEl !== null && state !== null;
}

/**
 * Close the menu without touching the document. When the menu was open, its
 * `/` is remembered as dismissed. Used for Esc, click-away, blur, source mode,
 * disable, and host `update` reloads.
 */
export function closeSlashMenu(opts: { reload?: boolean } = {}): void {
  const box = dismissBox();
  if (state && box) {
    box.dismissedAt = box.openFrom ?? state.from;
    if (opts.reload) {
      box.holdThroughReload = true;
    }
  }
  hidePopup();
}

function hidePopup(): void {
  if (popupEl) {
    popupEl.remove();
    popupEl = null;
    listEl = null;
  }
  state = null;
  const box = dismissBox();
  if (box) {
    box.openFrom = null;
  }
  document.removeEventListener('mousedown', onDocumentMouseDown, true);
}

function onDocumentMouseDown(e: MouseEvent): void {
  if (!popupEl) {
    return;
  }
  const target = e.target as Node | null;
  if (target && popupEl.contains(target)) {
    return;
  }
  closeSlashMenu();
}

// ── Icons (same 16px stroke style as the toolbar's `icons.*`) ────────────────

const svg = (d: string, sw = 1.6) =>
  `<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="${sw}" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;
const txt = (x: number, y: number, s: string, size = 6.5) =>
  `<text x="${x}" y="${y}" font-size="${size}" font-weight="600" fill="currentColor" stroke="none" font-family="sans-serif">${s}</text>`;
const heading = (n: number) =>
  svg(`<path d="M2 3.5v9M8 3.5v9M2 8h6"/>${txt(9.8, 13.2, String(n))}`);

const ICONS: Record<string, string> = {
  'heading-1': heading(1),
  'heading-2': heading(2),
  'heading-3': heading(3),
  'heading-4': heading(4),
  'heading-5': heading(5),
  'heading-6': heading(6),
  paragraph: svg('<path d="M12 2.5v11M9.5 2.5v11"/><path d="M13.5 2.5H7a3 3 0 0 0 0 6h2.5"/>'),
  quote: svg(
    '<line x1="3" y1="3" x2="3" y2="13"/><line x1="6" y1="5" x2="13" y2="5"/><line x1="6" y1="8" x2="13" y2="8"/><line x1="6" y1="11" x2="10" y2="11"/>'
  ),
  'list-unordered': svg(
    '<line x1="6" y1="4" x2="14" y2="4"/><line x1="6" y1="8" x2="14" y2="8"/><line x1="6" y1="12" x2="14" y2="12"/><circle cx="3" cy="4" r="1" fill="currentColor" stroke="none"/><circle cx="3" cy="8" r="1" fill="currentColor" stroke="none"/><circle cx="3" cy="12" r="1" fill="currentColor" stroke="none"/>'
  ),
  'list-ordered': svg(
    `<line x1="6" y1="4" x2="14" y2="4"/><line x1="6" y1="8" x2="14" y2="8"/><line x1="6" y1="12" x2="14" y2="12"/>${txt(2, 5.5, '1', 5)}${txt(2, 9.5, '2', 5)}${txt(2, 13.5, '3', 5)}`
  ),
  checklist: svg(
    '<rect x="2" y="4" width="5" height="5" rx="1"/><polyline points="3.5 6.5 4.5 7.5 6 5.5"/><line x1="9" y1="5" x2="14" y2="5"/><line x1="9" y1="9" x2="14" y2="9"/><line x1="9" y1="13" x2="12" y2="13"/>'
  ),
  code: svg(
    '<rect x="2" y="2" width="12" height="12" rx="2"/><polyline points="5.5 5.5 4 8 5.5 10.5"/><polyline points="10.5 5.5 12 8 10.5 10.5"/>'
  ),
  'type-hierarchy': svg(
    '<rect x="5.5" y="1.5" width="5" height="3.5" rx="0.8"/><rect x="1.5" y="11" width="5" height="3.5" rx="0.8"/><rect x="9.5" y="11" width="5" height="3.5" rx="0.8"/><path d="M8 5v3M4 11V8h8v3"/>'
  ),
  math: svg('<path d="M13 3.5H4.5L9 8l-4.5 4.5H13"/>'),
  table: svg(
    '<rect x="2" y="2" width="12" height="12" rx="1.5"/><line x1="2" y1="6" x2="14" y2="6"/><line x1="2" y1="10" x2="14" y2="10"/><line x1="6" y1="2" x2="6" y2="14"/><line x1="10" y1="2" x2="10" y2="14"/>'
  ),
  'horizontal-rule': svg(
    '<line x1="2" y1="8" x2="14" y2="8"/><path d="M4 4.5h8M4 11.5h8" stroke-opacity="0.35"/>'
  ),
  note: svg(
    '<circle cx="8" cy="8" r="6"/><line x1="8" y1="7.5" x2="8" y2="11"/><circle cx="8" cy="5" r="0.6" fill="currentColor" stroke="none"/>'
  ),
  lightbulb: svg(
    '<path d="M6 12h4M6.5 14h3"/><path d="M5.5 10a4 4 0 1 1 5 0c-.6.5-.9 1-.9 1.5H6.4c0-.5-.3-1-.9-1.5z"/>'
  ),
  report: svg(
    '<path d="M2.5 2.5h11v8.5h-6L4.5 13.5V11h-2z"/><line x1="8" y1="4.8" x2="8" y2="7.3"/><circle cx="8" cy="9" r="0.6" fill="currentColor" stroke="none"/>'
  ),
  warning: svg(
    '<path d="M8 2 1.8 13h12.4z"/><line x1="8" y1="6.5" x2="8" y2="9.3"/><circle cx="8" cy="11.1" r="0.6" fill="currentColor" stroke="none"/>'
  ),
  error: svg(
    '<path d="M5.5 1.8h5l3.7 3.7v5l-3.7 3.7h-5l-3.7-3.7v-5z"/><path d="M6 6l4 4M10 6l-4 4"/>'
  ),
  link: svg(
    '<path d="M6.5 9.5l3-3"/><path d="M9 5l1.5-1.5a2.12 2.12 0 0 1 3 3L12 8"/><path d="M7 11l-1.5 1.5a2.12 2.12 0 0 1-3-3L4 8"/>'
  ),
  'symbol-file': svg(
    '<path d="M5 2.5H3.5v11H5M11 2.5h1.5v11H11"/><path d="M6.5 5.5h3M6.5 8h3M6.5 10.5h2"/>'
  ),
  'file-media': svg(
    '<rect x="2" y="3" width="12" height="10" rx="1.5"/><circle cx="5.5" cy="6.5" r="1.2" fill="currentColor" stroke="none"/><polyline points="14 10.5 10.5 7 6 11.5 4.5 10 2 12.5"/>'
  ),
  smiley: svg(
    '<circle cx="8" cy="8" r="6"/><circle cx="6" cy="6.5" r="0.6" fill="currentColor" stroke="none"/><circle cx="10" cy="6.5" r="0.6" fill="currentColor" stroke="none"/><path d="M5.5 9.5c.7 1.2 1.7 1.8 2.5 1.8s1.8-.6 2.5-1.8"/>'
  ),
  'settings-gear': svg(
    '<path d="M3 2.5h10v11H3z"/><path d="M5.5 5.5h1.5M5.5 8h1.5M5.5 10.5h1.5"/><path d="M9 5.5h1.5M9 8h1.5M9 10.5h1.5" stroke-opacity="0.5"/>'
  ),
  calendar: svg(
    '<rect x="2" y="3" width="12" height="11" rx="1.5"/><line x1="2" y1="6.5" x2="14" y2="6.5"/><line x1="5.5" y1="1.8" x2="5.5" y2="4"/><line x1="10.5" y1="1.8" x2="10.5" y2="4"/><rect x="4.5" y="8.8" width="2.2" height="2.2" rx="0.4" fill="currentColor" stroke="none"/>'
  ),
  clock: svg('<circle cx="8" cy="8" r="6"/><polyline points="8 4.5 8 8 10.5 9.5"/>')
};
const FALLBACK_ICON = svg('<rect x="3" y="3" width="10" height="10" rx="2"/>');
const OFF_ICON = svg('<path d="M8 2v5"/><path d="M4.6 4.2a5 5 0 1 0 6.8 0"/>', 1.5);

// ── Matching ──────────────────────────────────────────────────────────────────

/** Display order: grouped (by GROUP_ORDER) when the query is empty, ranked otherwise. */
function orderForDisplay(query: string, matches: SlashCommand[]): SlashCommand[] {
  if (query.length > 0) {
    return matches;
  }
  return GROUP_ORDER.flatMap(g => matches.filter(m => m.group === g));
}

/** The shortcut shown on the right: the alias the user matched, else the id. */
function hintFor(cmd: SlashCommand, query: string): string {
  const q = query.toLowerCase();
  if (q && !cmd.id.toLowerCase().startsWith(q)) {
    const alias = cmd.aliases.find(a => a.toLowerCase().startsWith(q));
    if (alias) {
      return alias;
    }
  }
  return cmd.id;
}

// ── Rendering ─────────────────────────────────────────────────────────────────

function ensurePopup(): HTMLElement {
  if (!popupEl) {
    popupEl = document.createElement('div');
    popupEl.id = LISTBOX_ID;
    popupEl.className = 'slash-menu';
    popupEl.setAttribute('role', 'listbox');
    popupEl.setAttribute('aria-label', 'Slash commands');
    popupEl.tabIndex = -1;
    listEl = document.createElement('div');
    listEl.className = 'slash-menu-list';
    listEl.setAttribute('role', 'presentation');
    popupEl.appendChild(listEl);
    document.body.appendChild(popupEl);
    document.addEventListener('mousedown', onDocumentMouseDown, true);
  }
  return popupEl;
}

function footerIndex(): number {
  return state ? state.matches.length : 0;
}

function renderPopup(): void {
  if (!state) {
    return;
  }
  const el = ensurePopup();
  const list = listEl!;
  const prevScroll = list.scrollTop;

  list.innerHTML = '';
  const grouped = state.query.length === 0;
  let currentGroup: SlashCommandGroup | null = null;
  let groupEl: HTMLElement = list;

  state.matches.forEach((cmd, i) => {
    if (grouped && cmd.group !== currentGroup) {
      currentGroup = cmd.group;
      groupEl = document.createElement('div');
      groupEl.className = 'slash-menu-group';
      groupEl.setAttribute('role', 'group');
      const headerId = `mikedown-slash-group-${cmd.group}`;
      groupEl.setAttribute('aria-labelledby', headerId);
      const header = document.createElement('div');
      header.className = 'slash-menu-group-header';
      header.id = headerId;
      header.setAttribute('role', 'presentation');
      header.textContent = GROUP_LABEL[cmd.group];
      groupEl.appendChild(header);
      list.appendChild(groupEl);
    }
    groupEl.appendChild(buildRow(cmd, i));
  });

  // Footer: its own option, outside the filtered list and below a divider.
  const divider = document.createElement('div');
  divider.className = 'slash-menu-divider';
  divider.setAttribute('role', 'separator');
  const footer = document.createElement('div');
  footer.id = FOOTER_ID;
  footer.className =
    'slash-menu-footer' + (state.activeIndex === footerIndex() ? ' is-active' : '');
  footer.setAttribute('role', 'option');
  footer.setAttribute('aria-selected', String(state.activeIndex === footerIndex()));
  footer.innerHTML = `<span class="slash-menu-footer-icon">${OFF_ICON}</span><span class="slash-menu-footer-label">Turn off slash commands</span>`;
  footer.addEventListener('mousedown', e => {
    e.preventDefault();
    e.stopPropagation();
    chooseDisable();
  });

  // Replace any previous divider/footer (they live outside the scroll list).
  el.querySelectorAll('.slash-menu-divider, .slash-menu-footer').forEach(n => n.remove());
  el.appendChild(divider);
  el.appendChild(footer);

  const activeId =
    state.activeIndex === footerIndex() ? FOOTER_ID : OPTION_ID_PREFIX + state.activeIndex;
  el.setAttribute('aria-activedescendant', activeId);

  list.scrollTop = prevScroll;
  scrollActiveIntoView();
}

function buildRow(cmd: SlashCommand, i: number): HTMLElement {
  const active = i === state!.activeIndex;
  const row = document.createElement('div');
  row.id = OPTION_ID_PREFIX + i;
  row.className = 'slash-menu-item' + (active ? ' is-active' : '');
  row.setAttribute('role', 'option');
  row.setAttribute('aria-selected', String(active));
  row.dataset.command = cmd.id;

  const icon = document.createElement('span');
  icon.className = 'slash-menu-icon';
  icon.innerHTML = ICONS[cmd.icon] ?? FALLBACK_ICON;

  const text = document.createElement('span');
  text.className = 'slash-menu-text';
  const title = document.createElement('span');
  title.className = 'slash-menu-title';
  title.textContent = cmd.title;
  const desc = document.createElement('span');
  desc.className = 'slash-menu-desc';
  desc.textContent = cmd.description;
  text.append(title, desc);

  const hint = document.createElement('span');
  hint.className = 'slash-menu-hint';
  hint.textContent = '/' + hintFor(cmd, state!.query);

  row.append(icon, text, hint);
  row.addEventListener('mousedown', e => {
    e.preventDefault();
    e.stopPropagation();
    runMatch(i);
  });
  return row;
}

function scrollActiveIntoView(): void {
  if (!state || !listEl) {
    return;
  }
  if (state.activeIndex === footerIndex()) {
    return;
  } // footer is always visible
  const row = listEl.querySelector<HTMLElement>('#' + OPTION_ID_PREFIX + state.activeIndex);
  if (!row) {
    return;
  }
  const listRect = listEl.getBoundingClientRect();
  const rowRect = row.getBoundingClientRect();
  // Keep the group header visible when landing on a group's first row.
  const prev = row.previousElementSibling as HTMLElement | null;
  const headerPad =
    prev && prev.classList.contains('slash-menu-group-header') ? prev.offsetHeight : 0;
  if (rowRect.top - headerPad < listRect.top) {
    listEl.scrollTop -= listRect.top - rowRect.top + headerPad;
  } else if (rowRect.bottom > listRect.bottom) {
    listEl.scrollTop += rowRect.bottom - listRect.bottom;
  }
}

const MAX_HEIGHT = 380;
const MIN_COMFORT_HEIGHT = 180;
const GAP = 6;
const MARGIN = 8;

function positionPopup(view: EditorView, from: number): void {
  if (!popupEl) {
    return;
  }
  let coords: { top: number; bottom: number; left: number };
  try {
    coords = view.coordsAtPos(from);
  } catch {
    return;
  }
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const spaceBelow = vh - coords.bottom - GAP - MARGIN;
  const spaceAbove = coords.top - GAP - MARGIN;
  const placeAbove = spaceBelow < MIN_COMFORT_HEIGHT && spaceAbove > spaceBelow;
  const maxH = Math.max(120, Math.min(MAX_HEIGHT, placeAbove ? spaceAbove : spaceBelow));

  popupEl.style.maxHeight = `${maxH}px`;
  popupEl.style.visibility = 'hidden';
  popupEl.style.left = '0px';
  popupEl.style.top = '0px';
  const rect = popupEl.getBoundingClientRect();
  const left = Math.max(MARGIN, Math.min(coords.left - 10, vw - rect.width - MARGIN));
  const top = placeAbove
    ? Math.max(MARGIN, coords.top - GAP - rect.height)
    : Math.max(MARGIN, Math.min(coords.bottom + GAP, vh - rect.height - MARGIN));
  popupEl.style.left = `${left}px`;
  popupEl.style.top = `${top}px`;
  popupEl.classList.toggle('is-above', placeAbove);
  popupEl.style.visibility = '';
  scrollActiveIntoView();
}

// ── Actions ───────────────────────────────────────────────────────────────────

function runMatch(index: number): void {
  if (!state || !viewRef) {
    return;
  }
  if (index === footerIndex()) {
    chooseDisable();
    return;
  }
  const cmd = state.matches[index];
  if (!cmd) {
    return;
  }
  const range = { from: state.from, to: state.to };
  const view = viewRef;
  const box = dismissBox();
  // Captured before hidePopup() clears box.openFrom.
  const dismissPos = box?.openFrom ?? state.from;
  hidePopup();
  const handled = executeSlashCommand(cmd.id, range, view);
  if (!handled && box) {
    // Nothing was handled (id not wired yet, e.g. still-pending M4/M6 hooks):
    // no transaction ran, so remember the `/` as dismissed. Otherwise the
    // next view update re-derives the identical, still-open query and
    // reopens the menu right back up (T1 finding).
    box.dismissedAt = dismissPos;
  }
  view.focus();
}

function chooseDisable(): void {
  // Leaves `/query` in the document: no transaction.
  closeSlashMenu();
  config = { ...config, enabled: false };
  postMessage?.({
    type: 'saveSettings',
    settings: { slashCommandsEnabled: false },
    source: 'slashMenu'
  });
  viewRef?.focus();
}

const HEADING_LEVELS: Record<string, number> = { h1: 1, h2: 2, h3: 3, h4: 4, h5: 5, h6: 6 };

/**
 * Run a slash command against `[from, to]` (the `/query` text). Returns true
 * when handled. M2 implements H1–H6 and Paragraph; other ids go to the
 * handler registered via `setSlashCommandHandler` (M3/M6).
 */
export function executeSlashCommand(
  id: string,
  range: { from: number; to: number },
  view: EditorView | null = viewRef
): boolean {
  if (!view) {
    return false;
  }
  const { schema } = view.state;
  const level = HEADING_LEVELS[id];
  const blockType = level ? schema.nodes.heading : id === 'text' ? schema.nodes.paragraph : null;
  if (!blockType) {
    return externalHandler ? externalHandler(id, range, view) : false;
  }
  const attrs = level ? { level } : undefined;

  const { from, to } = range;
  const $from = view.state.doc.resolve(from);
  const textblock = $from.parent;
  if (!textblock.isTextblock) {
    return false;
  }
  // Inside a list item (or task item), the item's content model is
  // `paragraph block*`-ish and generally won't accept a heading directly —
  // `setBlockType` silently no-ops per node it can't convert. Escape the
  // whole enclosing list instead of trying to convert the item in place.
  const listAfter = listEscapeAfter($from);
  const onlyContent = listAfter === null && textblock.content.size === to - from;
  const deleteFrom = computeDeleteFrom(view, $from, from, to, onlyContent, textblock);

  const tr = closeHistory(view.state.tr);
  tr.delete(deleteFrom, to);

  if (onlyContent) {
    // `/query` was the whole block: convert it in place.
    tr.setBlockType(deleteFrom, deleteFrom, blockType, attrs);
    tr.setSelection(TextSelection.create(tr.doc, deleteFrom));
  } else {
    // Leave the line's text untouched; new block goes right after it (or,
    // inside a list item, right after the whole enclosing list).
    const insertAt = tr.mapping.map(listAfter ?? $from.after());
    try {
      tr.insert(insertAt, blockType.create(attrs));
      tr.setSelection(TextSelection.create(tr.doc, insertAt + 1));
    } catch {
      return false;
    }
  }
  view.dispatch(tr.scrollIntoView());
  return true;
}

/**
 * When `$from`'s textblock sits directly inside a `listItem`/`taskItem`,
 * returns the doc position right after the whole enclosing list — the
 * "lift out, insert below" landing spot used instead of converting the
 * item's own paragraph (which the list's content model usually rejects).
 * Returns null when not inside a list item.
 */
export function listEscapeAfter($from: ResolvedPos): number | null {
  const itemDepth = $from.depth - 1;
  if (itemDepth < 0) {
    return null;
  }
  const itemName = $from.node(itemDepth).type.name;
  if (itemName !== 'listItem' && itemName !== 'taskItem') {
    return null;
  }
  const listDepth = itemDepth - 1;
  if (listDepth < 0) {
    return null;
  }
  return $from.after(listDepth);
}

/**
 * Mid-line only (never when `/query` is the block's only content): strips
 * the single triggering whitespace character too, but ONLY when nothing
 * follows the query on the line — `foo /h2` (nothing after) leaves `foo`,
 * not `foo `, since the new block appears below and a trailing space would
 * be an orphaned artifact. When something DOES follow on the line (`foo
 * /table` immediately followed by `bar`, no space in between), the space is
 * the only thing left separating the two once `/table` is gone, so it's kept
 * — `foo /table|bar` must leave `foo bar` (T2 expectation), not `foobar`.
 */
function computeDeleteFrom(
  view: EditorView,
  $from: ResolvedPos,
  from: number,
  to: number,
  onlyContent: boolean,
  textblock: PmNode
): number {
  const blockStart = $from.start();
  const hasTrailingContent = to < blockStart + textblock.content.size;
  if (onlyContent || hasTrailingContent || from <= blockStart) {
    return from;
  }
  return /\s/.test(view.state.doc.textBetween(from - 1, from, '', '')) ? from - 1 : from;
}

/**
 * Builds (but does not dispatch) the "delete `/query`, land an empty target
 * paragraph" transaction shared by `prepareSlashTarget` and
 * `applySlashWrap`. Returns the transaction and the position inside the
 * empty target paragraph, or null when the position can't be resolved.
 */
function buildSlashTargetTr(
  view: EditorView,
  range: { from: number; to: number }
): { tr: Transaction; pos: number } | null {
  const { from, to } = range;
  const $from = view.state.doc.resolve(from);
  const textblock = $from.parent;
  if (!textblock.isTextblock) {
    return null;
  }
  const listAfter = listEscapeAfter($from);
  const onlyContent = listAfter === null && textblock.content.size === to - from;
  const deleteFrom = computeDeleteFrom(view, $from, from, to, onlyContent, textblock);

  const tr = closeHistory(view.state.tr);
  tr.delete(deleteFrom, to);

  if (onlyContent) {
    return { tr, pos: deleteFrom };
  }
  const insertAt = tr.mapping.map(listAfter ?? $from.after());
  const paragraph = view.state.schema.nodes.paragraph.create();
  try {
    tr.insert(insertAt, paragraph);
  } catch {
    return null;
  }
  return { tr, pos: insertAt + 1 };
}

/**
 * Deletes `/query` and leaves the cursor in an empty target paragraph (see
 * `buildSlashTargetTr`), dispatching immediately. Safe to follow with a
 * SEPARATE `editor.chain()` call that itself uses `setBlockType` under the
 * hood (headings, `toggleCodeBlock`, `setHorizontalRule`, `insertTable`) —
 * empirically, ProseMirror's history groups a `setBlockType`/insert-shaped
 * step right after this into the same undo event. It is NOT safe to follow
 * with a `wrapIn`/`toggleList`-shaped command (`ReplaceAroundStep`) — those
 * do not group with the preceding transaction, so two `Cmd+Z` would be
 * needed instead of one; use `applySlashWrap` for those instead.
 */
export function prepareSlashTarget(view: EditorView, range: { from: number; to: number }): boolean {
  const built = buildSlashTargetTr(view, range);
  if (!built) {
    return false;
  }
  const { tr, pos } = built;
  tr.setSelection(TextSelection.create(tr.doc, pos));
  view.dispatch(tr.scrollIntoView());
  return true;
}

/**
 * Same target preparation as `prepareSlashTarget`, but for wrap-shaped
 * commands (blockquote, lists, callouts): `shape` mutates the SAME
 * transaction (e.g. via `tr.wrap`) before the single dispatch, so the text
 * deletion and the wrap are always one undo step — no reliance on
 * ProseMirror's history-grouping heuristic (see `prepareSlashTarget`'s
 * doc comment for why that heuristic doesn't cover wraps).
 */
export function applySlashWrap(
  view: EditorView,
  range: { from: number; to: number },
  shape: (tr: Transaction, pos: number) => boolean
): boolean {
  const built = buildSlashTargetTr(view, range);
  if (!built) {
    return false;
  }
  const { tr, pos } = built;
  if (!shape(tr, pos)) {
    return false;
  }
  view.dispatch(tr.scrollIntoView());
  return true;
}

// ── Context checks ────────────────────────────────────────────────────────────

function insideCodeBlock($pos: ResolvedPos): boolean {
  for (let d = $pos.depth; d >= 0; d--) {
    if ($pos.node(d).type.name === 'codeBlock') {
      return true;
    }
  }
  return false;
}

function hasBlockingMark(view: EditorView, from: number, to: number): boolean {
  const { schema, doc, storedMarks, selection } = view.state;
  const blocking = [schema.marks.code, schema.marks.link].filter(Boolean);
  if (blocking.length === 0) {
    return false;
  }
  const inSet = (marks: readonly Mark[] | null | undefined) =>
    !!marks && blocking.some(type => type.isInSet(marks));
  const $cur = selection.$from;
  if (inSet(storedMarks) || inSet($cur.marks())) {
    return true;
  }
  // Cursor sitting right before inline code/link text (just inside the
  // opening backtick) or the `/query` itself carrying such a mark.
  if (inSet($cur.nodeAfter?.marks)) {
    return true;
  }
  let blocked = false;
  doc.nodesBetween(from, Math.max(from + 1, to), node => {
    if (node.isText && inSet(node.marks)) {
      blocked = true;
    }
    return !blocked;
  });
  return blocked;
}

// ── Plugin ────────────────────────────────────────────────────────────────────

function update(view: EditorView): void {
  viewRef = view;
  const box = slashCommandsKey.getState(view.state)!;
  const close = () => {
    // Whatever closed the menu (cursor left the range, whitespace, selection),
    // remember the `/` so the next keystroke does not reopen it.
    const pos = box.openFrom;
    if (
      state &&
      pos !== null &&
      pos < view.state.doc.content.size &&
      view.state.doc.textBetween(pos, pos + 1, '', '') === '/'
    ) {
      box.dismissedAt = pos;
    }
    hidePopup();
  };

  if (!config.enabled || sourceModeActive) {
    return hidePopup();
  }
  const { selection } = view.state;
  if (!selection.empty) {
    return close();
  }
  const $from = selection.$from;
  if (!$from.parent.isTextblock || insideCodeBlock($from)) {
    return close();
  }

  // Full textblock prefix, with a single-char placeholder for every leaf so
  // string offsets line up 1:1 with document positions.
  const textBefore = $from.parent.textBetween(0, $from.parentOffset, undefined, '￼');
  const match = extractSlashQuery(textBefore, true);
  if (!match) {
    return close();
  }

  const from = $from.start() + match.offset;
  const to = selection.from;
  if (box.dismissedAt === from) {
    return hidePopup();
  }
  if (state && box.openFrom !== from) {
    close();
  }
  if (hasBlockingMark(view, from, to)) {
    return hidePopup();
  }

  const ranked = matchCommands(match.query, { hasFrontmatter: frontmatterProvider() });
  if (ranked.length === 0) {
    return hidePopup();
  } // no empty state: just close
  const matches = orderForDisplay(match.query, ranked);

  if (!state || state.from !== from || state.query !== match.query) {
    state = { from, to, query: match.query, matches, activeIndex: 0 };
  } else {
    const prevId =
      state.activeIndex < state.matches.length ? state.matches[state.activeIndex].id : null;
    const keep = prevId ? matches.findIndex(m => m.id === prevId) : -1;
    state = { ...state, to, matches, activeIndex: keep >= 0 ? keep : 0 };
  }
  box.openFrom = from;
  renderPopup();
  positionPopup(view, from);
}

export const SlashCommands = Extension.create({
  name: 'slashCommands',
  // Ahead of EmojiAutocomplete / WikilinkAutocomplete (default 100) and the
  // StarterKit keymaps so Enter/Tab/arrows reach this menu first.
  priority: 1000,

  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: slashCommandsKey,
        state: {
          init: (): DismissBox => ({ dismissedAt: null, openFrom: null, holdThroughReload: false }),
          apply(tr, box): DismissBox {
            if (!tr.docChanged) {
              return box;
            }
            if (box.holdThroughReload) {
              return { ...box, holdThroughReload: false };
            }
            // Forget a position once the `/` after it is deleted.
            const map = (pos: number | null) => {
              if (pos === null) {
                return null;
              }
              const r = tr.mapping.mapResult(pos, 1);
              return r.deletedAfter ? null : r.pos;
            };
            return {
              dismissedAt: map(box.dismissedAt),
              openFrom: map(box.openFrom),
              holdThroughReload: false
            };
          }
        },
        view(view) {
          viewRef = view;
          return {
            update,
            destroy() {
              hidePopup();
              viewRef = null;
            }
          };
        },
        props: {
          handleDOMEvents: {
            blur() {
              if (state) {
                closeSlashMenu();
              }
              return false;
            }
          },
          handleKeyDown(_view, event) {
            if (!state) {
              return false;
            }
            const total = state.matches.length + 1; // + footer row
            switch (event.key) {
              case 'ArrowDown':
                state.activeIndex = (state.activeIndex + 1) % total;
                break;
              case 'ArrowUp':
                state.activeIndex = (state.activeIndex - 1 + total) % total;
                break;
              case 'Home':
                state.activeIndex = 0;
                break;
              case 'End':
                state.activeIndex = state.matches.length - 1;
                break;
              case 'Enter':
              case 'Tab':
                if (event.shiftKey || event.altKey || event.metaKey || event.ctrlKey) {
                  return false;
                }
                event.preventDefault();
                runMatch(state.activeIndex);
                return true;
              case 'Escape':
                event.preventDefault();
                closeSlashMenu();
                return true;
              default:
                return false;
            }
            event.preventDefault();
            renderPopup();
            return true;
          }
        }
      })
    ];
  }
});
