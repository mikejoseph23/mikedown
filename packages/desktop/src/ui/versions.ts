/**
 * Version browser (M6): a sidebar view listing the active file's snapshots,
 * newest first, with relative times. Select one to compare it with the
 * current buffer or restore it, or two to compare them with each other.
 *
 * Restore (edge case 2) replaces the editor buffer and marks the tab dirty;
 * it never writes to disk. Saving afterwards snapshots as usual. The panel
 * itself only asks; `main.ts` owns the document and the diff viewer.
 *
 * Keyboard: the list is an ARIA listbox (multi-select, at most two); arrows
 * move, Space selects, Enter compares the selection (one: against the
 * current text; two: with each other).
 */
import type { DocumentModel } from '../documents/documentModel';
import type { Versioning, VersionSnapshot } from '../documents/versioning';

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/**
 * "just now", "5 minutes ago", "yesterday", "3 days ago", then the date.
 * Core has the same buckets in `relativeTime.ts`, but does not export it.
 */
export function relativeTime(ms: number, now: number = Date.now()): string {
  const diff = now - ms;
  if (diff < MINUTE) {return 'just now';}
  if (diff < HOUR) {
    const m = Math.floor(diff / MINUTE);
    return `${m} minute${m === 1 ? '' : 's'} ago`;
  }
  if (diff < DAY) {
    const h = Math.floor(diff / HOUR);
    return `${h} hour${h === 1 ? '' : 's'} ago`;
  }
  if (diff < 2 * DAY) {return 'yesterday';}
  if (diff < 7 * DAY) {return `${Math.floor(diff / DAY)} days ago`;}
  return new Date(ms).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

/** Toggle `name` in the selection, keeping at most `max` (the oldest pick drops out). */
export function toggleSelection(selected: readonly string[], name: string, max = 2): string[] {
  if (selected.includes(name)) {return selected.filter((n) => n !== name);}
  const next = [...selected, name];
  return next.length > max ? next.slice(next.length - max) : next;
}

/** Which buttons apply to a selection. */
export function panelActions(selectedCount: number): { compareCurrent: boolean; compareTwo: boolean; restore: boolean } {
  return { compareCurrent: selectedCount === 1, compareTwo: selectedCount === 2, restore: selectedCount === 1 };
}

/** Why the panel has no list to show, or null. */
export function emptyReason(input: { root: string | null; enabled: boolean; doc: Pick<DocumentModel, 'path' | 'kind'> | null; dir: string | null }): string | null {
  if (!input.root) {return 'Versions are kept for files inside an open folder. Open the file’s folder to keep versions as you save.';}
  if (!input.doc || input.doc.kind === 'image') {return 'Open a file to see its versions.';}
  if (!input.doc.path) {return 'Save the document inside the folder to start keeping versions.';}
  if (!input.dir) {return 'This file is outside the open folder, so it has no versions.';}
  if (!input.enabled) {return 'Keeping versions is turned off in Settings (App tab).';}
  return null;
}

/**
 * Edge case 2: the document's buffer takes the snapshot's text and turns
 * dirty (when it differs from the saved file). Nothing is written; saving
 * commits it and snapshots as usual. Unsaved edits are only replaced after
 * `confirmReplace` agrees.
 */
export async function restoreIntoDocument(
  doc: Pick<DocumentModel, 'path' | 'kind' | 'dirty' | 'text' | 'replaceText'>,
  readSnapshot: () => Promise<string>,
  confirmReplace: () => Promise<boolean>,
): Promise<'restored' | 'unchanged' | 'cancelled'> {
  if (!doc.path || doc.kind === 'image') {return 'cancelled';}
  const text = await readSnapshot();
  if (text === doc.text) {return 'unchanged';}
  if (doc.dirty && !(await confirmReplace())) {return 'cancelled';}
  doc.replaceText(text);
  return 'restored';
}

export interface VersionsPanelDeps {
  versioning: Versioning;
  activeDoc(): DocumentModel | null;
  root(): string | null;
  enabled(): boolean;
  /** Snapshot vs snapshot (older first), or snapshot vs the current buffer. */
  compare(older: VersionSnapshot, newer: VersionSnapshot | 'current'): void;
  restore(snapshot: VersionSnapshot): void;
  close(): void;
  now?(): number;
}

export interface VersionsPanel {
  readonly el: HTMLElement;
  /** Re-list for the active document. */
  refresh(): Promise<void>;
  focus(): void;
}

function formatBytes(n: number): string {
  if (n >= 1024 * 1024) {return `${(n / (1024 * 1024)).toFixed(1)} MB`;}
  if (n >= 1024) {return `${Math.round(n / 1024)} KB`;}
  return `${n} B`;
}

export function createVersionsPanel(deps: VersionsPanelDeps): VersionsPanel {
  const now = deps.now ?? (() => Date.now());
  const el = document.createElement('div');
  el.className = 'mdapp-versions';
  el.innerHTML = `
    <div class="mdapp-versions__head">
      <span class="mdapp-versions__file"></span>
      <button type="button" class="mdapp-iconbtn mdapp-versions__close" data-action="close" aria-label="Close Versions" title="Close Versions (Escape)">
        <svg viewBox="0 0 16 16" width="12" height="12" aria-hidden="true" focusable="false"><path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/></svg>
      </button>
    </div>
    <div class="mdapp-versions__bar">
      <button type="button" class="mdapp-btn mdapp-btn--toolbar" data-action="compare-current" disabled>Compare with Current</button>
      <button type="button" class="mdapp-btn mdapp-btn--toolbar" data-action="compare-two" disabled>Compare Selected</button>
      <button type="button" class="mdapp-btn mdapp-btn--toolbar" data-action="restore" disabled>Restore</button>
    </div>
    <p class="mdapp-versions__hint">Select one version to compare or restore, or two to compare them.</p>
    <ul class="mdapp-versions__list" role="listbox" aria-multiselectable="true" aria-label="Versions"></ul>
    <p class="mdapp-versions__empty" hidden></p>
    <p class="mdapp-versions__status" role="status"></p>`;

  const fileLabel = el.querySelector('.mdapp-versions__file') as HTMLElement;
  const list = el.querySelector('.mdapp-versions__list') as HTMLUListElement;
  const empty = el.querySelector('.mdapp-versions__empty') as HTMLElement;
  const hint = el.querySelector('.mdapp-versions__hint') as HTMLElement;
  const bar = el.querySelector('.mdapp-versions__bar') as HTMLElement;
  const status = el.querySelector('.mdapp-versions__status') as HTMLElement;
  const btn = (name: string): HTMLButtonElement => el.querySelector(`[data-action="${name}"]`) as HTMLButtonElement;

  let snapshots: VersionSnapshot[] = [];
  let selected: string[] = [];
  let focusIndex = 0;
  let generation = 0;

  function byName(name: string): VersionSnapshot | undefined {
    return snapshots.find((s) => s.name === name);
  }

  function syncButtons(): void {
    const a = panelActions(selected.length);
    btn('compare-current').disabled = !a.compareCurrent;
    btn('compare-two').disabled = !a.compareTwo;
    btn('restore').disabled = !a.restore;
    for (const li of list.querySelectorAll<HTMLElement>('[role="option"]')) {
      const on = selected.includes(li.dataset.name ?? '');
      li.setAttribute('aria-selected', String(on));
      li.classList.toggle('mdapp-versions__row--selected', on);
    }
  }

  function setFocus(i: number, move = true): void {
    const rows = Array.from(list.querySelectorAll<HTMLElement>('[role="option"]'));
    if (!rows.length) {return;}
    focusIndex = Math.max(0, Math.min(rows.length - 1, i));
    rows.forEach((r, k) => { r.tabIndex = k === focusIndex ? 0 : -1; });
    if (move) {rows[focusIndex].focus();}
  }

  function toggle(name: string): void {
    selected = toggleSelection(selected, name);
    syncButtons();
  }

  function compareSelection(): void {
    if (selected.length === 1) {
      const s = byName(selected[0]);
      if (s) {deps.compare(s, 'current');}
    } else if (selected.length === 2) {
      const [a, b] = selected.map(byName).filter((x): x is VersionSnapshot => !!x).sort((x, y) => x.timeMs - y.timeMs);
      if (a && b) {deps.compare(a, b);}
    }
  }

  function render(): void {
    list.replaceChildren();
    const t = now();
    snapshots.forEach((s, i) => {
      const li = document.createElement('li');
      li.className = 'mdapp-versions__row';
      li.setAttribute('role', 'option');
      li.dataset.name = s.name;
      li.tabIndex = i === focusIndex ? 0 : -1;
      const when = new Date(s.timeMs);
      const main = document.createElement('span');
      main.className = 'mdapp-versions__when';
      main.textContent = relativeTime(s.timeMs, t);
      if (i === 0) {
        const badge = document.createElement('span');
        badge.className = 'mdapp-versions__badge';
        badge.textContent = 'Latest';
        main.append(' ', badge);
      }
      const meta = document.createElement('span');
      meta.className = 'mdapp-versions__meta';
      meta.textContent = `${when.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'medium' })} · ${formatBytes(s.size)}`;
      li.append(main, meta);
      li.title = when.toLocaleString();
      li.addEventListener('click', () => { setFocus(i, false); toggle(s.name); });
      li.addEventListener('dblclick', () => { selected = [s.name]; syncButtons(); deps.compare(s, 'current'); });
      list.appendChild(li);
    });
    syncButtons();
  }

  async function refresh(): Promise<void> {
    const gen = ++generation;
    const doc = deps.activeDoc();
    const root = deps.root();
    const dir = doc?.path ? deps.versioning.dirFor(doc.path) : null;
    fileLabel.textContent = doc ? (doc.path ? doc.path.split(/[\\/]/).pop() ?? '' : 'Untitled') : 'Versions';
    fileLabel.title = doc?.path ?? '';
    const reason = emptyReason({ root, enabled: deps.enabled(), doc, dir });
    let rows: VersionSnapshot[] = [];
    if (!reason && doc?.path) {
      try {
        rows = await deps.versioning.list(doc.path);
      } catch (err) {
        status.textContent = `Could not list versions: ${String(err)}`;
      }
    }
    if (gen !== generation) {return;}
    const before = snapshots.map((s) => s.name).join('|');
    snapshots = rows;
    if (before !== rows.map((s) => s.name).join('|')) {
      selected = selected.filter((n) => rows.some((s) => s.name === n));
      focusIndex = Math.min(focusIndex, Math.max(0, rows.length - 1));
    }
    const message = reason ?? (rows.length ? null : 'No versions yet. A version is kept each time you save a change.');
    empty.hidden = !message;
    empty.textContent = message ?? '';
    list.hidden = !rows.length;
    bar.hidden = !rows.length;
    hint.hidden = !rows.length;
    if (!reason) {status.textContent = rows.length ? `${rows.length} version${rows.length === 1 ? '' : 's'}` : '';}
    else {status.textContent = '';}
    render();
  }

  btn('close').addEventListener('click', () => deps.close());
  btn('compare-current').addEventListener('click', () => compareSelection());
  btn('compare-two').addEventListener('click', () => compareSelection());
  btn('restore').addEventListener('click', () => {
    const s = selected.length === 1 ? byName(selected[0]) : undefined;
    if (s) {deps.restore(s);}
  });
  list.addEventListener('keydown', (e) => {
    const rows = list.querySelectorAll('[role="option"]').length;
    if (e.key === 'ArrowDown') { e.preventDefault(); setFocus(focusIndex + 1); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setFocus(focusIndex - 1); }
    else if (e.key === 'Home') { e.preventDefault(); setFocus(0); }
    else if (e.key === 'End') { e.preventDefault(); setFocus(rows - 1); }
    else if (e.key === ' ') {
      e.preventDefault();
      const s = snapshots[focusIndex];
      if (s) {toggle(s.name);}
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (!selected.length && snapshots[focusIndex]) {toggle(snapshots[focusIndex].name);}
      compareSelection();
    }
  });
  el.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { e.preventDefault(); deps.close(); }
  });

  return {
    el,
    refresh,
    focus() {
      const row = list.querySelector<HTMLElement>('[role="option"][tabindex="0"]');
      if (row && !list.hidden) {row.focus();}
      else {btn('close').focus();}
    },
  };
}
