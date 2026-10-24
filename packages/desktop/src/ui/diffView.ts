/**
 * Diff viewer (M6): two plain markdown texts, side by side or inline, with
 * word-level highlights inside changed lines. Read-only, no editor instance;
 * styled with core's `--mikedown-*` tokens (`styles/versions.css`).
 *
 * Used by the version browser (snapshot vs snapshot, snapshot vs the current
 * buffer) and by the "changed on disk" question (disk vs buffer, the plan's
 * Compare). The caller can add action buttons (Restore, Overwrite, Revert);
 * `showDiff` resolves with the id of the one pressed, or null when closed.
 *
 * `buildDiffRows` / `foldRows` are pure so the line pairing and the folding
 * of long unchanged runs are unit-tested without a DOM.
 */
import { diffLines, diffWordsWithSpace } from 'diff';

export interface DiffPart {
  text: string;
  /** Inside a changed line: this run is the part that differs. */
  changed: boolean;
}

export interface DiffSide {
  /** 1-based line number in its text. */
  no: number;
  parts: DiffPart[];
}

export type DiffRowKind = 'same' | 'add' | 'del' | 'change';

export interface DiffRow {
  kind: DiffRowKind;
  left: DiffSide | null;
  right: DiffSide | null;
}

export interface DiffStats {
  added: number;
  removed: number;
}

function linesOf(value: string): string[] {
  const lines = value.split('\n');
  if (lines.length && lines[lines.length - 1] === '') {lines.pop();}
  return lines;
}

/**
 * Line rows for `left` → `right`. A run of removed lines followed by a run of
 * added lines pairs up line by line as `change` rows carrying word-level
 * parts; the leftovers are plain `del` / `add` rows.
 */
export function buildDiffRows(left: string, right: string): DiffRow[] {
  const rows: DiffRow[] = [];
  let ln = 1;
  let rn = 1;
  const chunks = diffLines(left.replace(/\r\n/g, '\n'), right.replace(/\r\n/g, '\n'));
  for (let i = 0; i < chunks.length; i++) {
    const c = chunks[i];
    if (!c.added && !c.removed) {
      for (const text of linesOf(c.value)) {
        rows.push({ kind: 'same', left: { no: ln++, parts: [{ text, changed: false }] }, right: { no: rn++, parts: [{ text, changed: false }] } });
      }
      continue;
    }
    if (c.removed) {
      const removed = linesOf(c.value);
      const next = chunks[i + 1];
      const added = next?.added ? linesOf(next.value) : [];
      if (next?.added) {i++;}
      const pairs = Math.min(removed.length, added.length);
      for (let k = 0; k < pairs; k++) {
        const words = diffWordsWithSpace(removed[k], added[k]);
        const lp: DiffPart[] = [];
        const rp: DiffPart[] = [];
        for (const w of words) {
          if (!w.added) {lp.push({ text: w.value, changed: !!w.removed });}
          if (!w.removed) {rp.push({ text: w.value, changed: !!w.added });}
        }
        rows.push({ kind: 'change', left: { no: ln++, parts: lp }, right: { no: rn++, parts: rp } });
      }
      for (let k = pairs; k < removed.length; k++) {
        rows.push({ kind: 'del', left: { no: ln++, parts: [{ text: removed[k], changed: false }] }, right: null });
      }
      for (let k = pairs; k < added.length; k++) {
        rows.push({ kind: 'add', left: null, right: { no: rn++, parts: [{ text: added[k], changed: false }] } });
      }
      continue;
    }
    for (const text of linesOf(c.value)) {
      rows.push({ kind: 'add', left: null, right: { no: rn++, parts: [{ text, changed: false }] } });
    }
  }
  return rows;
}

export function diffStats(rows: readonly DiffRow[]): DiffStats {
  let added = 0;
  let removed = 0;
  for (const r of rows) {
    if (r.kind === 'add' || r.kind === 'change') {added++;}
    if (r.kind === 'del' || r.kind === 'change') {removed++;}
  }
  return { added, removed };
}

export type DiffSegment = { kind: 'rows'; rows: DiffRow[] } | { kind: 'fold'; rows: DiffRow[] };

/**
 * Keep `context` unchanged lines around every change and fold longer
 * unchanged runs into one expandable row. A text with no change is one fold.
 */
export function foldRows(rows: readonly DiffRow[], context = 3): DiffSegment[] {
  const out: DiffSegment[] = [];
  const push = (kind: DiffSegment['kind'], r: DiffRow[]): void => {
    if (!r.length) {return;}
    const last = out[out.length - 1];
    if (last && last.kind === kind) {last.rows.push(...r);}
    else {out.push({ kind, rows: [...r] });}
  };
  let i = 0;
  while (i < rows.length) {
    if (rows[i].kind !== 'same') {
      push('rows', [rows[i]]);
      i++;
      continue;
    }
    let j = i;
    while (j < rows.length && rows[j].kind === 'same') {j++;}
    const run = rows.slice(i, j);
    const head = i === 0 ? 0 : context;
    const tail = j === rows.length ? 0 : context;
    if (run.length > head + tail + 1) {
      push('rows', run.slice(0, head));
      push('fold', run.slice(head, run.length - tail));
      push('rows', run.slice(run.length - tail));
    } else {
      push('rows', run);
    }
    i = j;
  }
  return out;
}

// ── View ────────────────────────────────────────────────────────────────────

export type DiffMode = 'split' | 'inline';

export interface DiffAction {
  id: string;
  label: string;
  primary?: boolean;
  danger?: boolean;
}

export interface DiffViewOptions {
  title: string;
  leftLabel: string;
  rightLabel: string;
  left: string;
  right: string;
  mode?: DiffMode;
  actions?: DiffAction[];
  root?: HTMLElement;
}

const MODE_KEY = 'mikedown.desktop.diffMode';

function savedMode(): DiffMode {
  try { return window.localStorage.getItem(MODE_KEY) === 'inline' ? 'inline' : 'split'; } catch { return 'split'; }
}

function saveMode(mode: DiffMode): void {
  try { window.localStorage.setItem(MODE_KEY, mode); } catch { /* storage blocked */ }
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) {e.className = cls;}
  if (text !== undefined) {e.textContent = text;}
  return e;
}

function partsInto(cell: HTMLElement, parts: DiffPart[]): void {
  for (const p of parts) {
    if (p.changed) {
      cell.appendChild(el('mark', 'mdapp-diff__word', p.text));
    } else {
      cell.appendChild(document.createTextNode(p.text));
    }
  }
  // Keep empty lines one line tall.
  if (!cell.textContent) {cell.appendChild(document.createTextNode('​'));}
}

function splitRow(r: DiffRow): HTMLTableRowElement {
  const tr = el('tr', `mdapp-diff__row mdapp-diff__row--${r.kind}`);
  const cells: Array<[DiffSide | null, 'old' | 'new']> = [[r.left, 'old'], [r.right, 'new']];
  for (const [side, which] of cells) {
    const no = el('td', `mdapp-diff__no mdapp-diff__no--${which}`, side ? String(side.no) : '');
    const text = el('td', `mdapp-diff__text mdapp-diff__text--${which}${side ? '' : ' mdapp-diff__text--empty'}`);
    if (side) {partsInto(text, side.parts);}
    tr.append(no, text);
  }
  return tr;
}

function inlineRows(r: DiffRow): HTMLTableRowElement[] {
  const make = (kind: 'same' | 'add' | 'del', left: DiffSide | null, right: DiffSide | null, parts: DiffPart[]): HTMLTableRowElement => {
    const tr = el('tr', `mdapp-diff__row mdapp-diff__row--${kind}`);
    tr.append(
      el('td', 'mdapp-diff__no mdapp-diff__no--old', left ? String(left.no) : ''),
      el('td', 'mdapp-diff__no mdapp-diff__no--new', right ? String(right.no) : ''),
      el('td', 'mdapp-diff__sign', kind === 'add' ? '+' : kind === 'del' ? '−' : ''),
    );
    const text = el('td', 'mdapp-diff__text');
    partsInto(text, parts);
    tr.appendChild(text);
    return tr;
  };
  switch (r.kind) {
    case 'same': return [make('same', r.left, r.right, r.left!.parts)];
    case 'add': return [make('add', null, r.right, r.right!.parts)];
    case 'del': return [make('del', r.left, null, r.left!.parts)];
    case 'change': return [make('del', r.left, null, r.left!.parts), make('add', null, r.right, r.right!.parts)];
  }
}

/**
 * Open the diff viewer over the window. Resolves with the pressed action's
 * id, or null when closed (Close, Escape).
 */
export function showDiff(opts: DiffViewOptions): Promise<string | null> {
  const root = opts.root ?? document.body;
  const rows = buildDiffRows(opts.left, opts.right);
  const stats = diffStats(rows);
  let mode: DiffMode = opts.mode ?? savedMode();
  const expanded = new Set<number>();

  return new Promise((resolve) => {
    const previous = document.activeElement as HTMLElement | null;
    const backdrop = el('div', 'mdapp-modal-backdrop mdapp-diff-backdrop');
    const dialog = el('div', 'mdapp-diff');
    dialog.setAttribute('role', 'dialog');
    dialog.setAttribute('aria-modal', 'true');
    dialog.setAttribute('aria-labelledby', 'mdapp-diff-title');
    dialog.tabIndex = -1;

    const header = el('div', 'mdapp-diff__header');
    const title = el('h2', 'mdapp-diff__title', opts.title);
    title.id = 'mdapp-diff-title';
    const summary = el('span', 'mdapp-diff__summary');
    if (stats.added || stats.removed) {
      summary.append(el('span', 'mdapp-diff__count mdapp-diff__count--add', `+${stats.added}`), el('span', 'mdapp-diff__count mdapp-diff__count--del', `−${stats.removed}`));
      summary.setAttribute('aria-label', `${stats.added} lines added, ${stats.removed} lines removed`);
    }
    const tools = el('div', 'mdapp-diff__tools');
    const modes = el('div', 'mdapp-diff__modes');
    modes.setAttribute('role', 'group');
    modes.setAttribute('aria-label', 'Layout');
    const splitBtn = el('button', 'mdapp-btn mdapp-btn--toolbar mdapp-diff__mode', 'Side by Side');
    const inlineBtn = el('button', 'mdapp-btn mdapp-btn--toolbar mdapp-diff__mode', 'Inline');
    splitBtn.type = inlineBtn.type = 'button';
    splitBtn.dataset.mode = 'split';
    inlineBtn.dataset.mode = 'inline';
    modes.append(splitBtn, inlineBtn);
    const prevBtn = el('button', 'mdapp-btn mdapp-btn--toolbar', '↑');
    const nextBtn = el('button', 'mdapp-btn mdapp-btn--toolbar', '↓');
    prevBtn.type = nextBtn.type = 'button';
    prevBtn.title = 'Previous Change (Shift+F7)';
    nextBtn.title = 'Next Change (F7)';
    prevBtn.setAttribute('aria-label', 'Previous change');
    nextBtn.setAttribute('aria-label', 'Next change');
    tools.append(modes, prevBtn, nextBtn);

    const actions = el('div', 'mdapp-diff__actions');
    const buttons: HTMLButtonElement[] = [];
    for (const a of opts.actions ?? []) {
      const b = el('button', `mdapp-btn${a.primary ? ' mdapp-btn--primary' : ''}${a.danger ? ' mdapp-btn--danger' : ''}`, a.label);
      b.type = 'button';
      b.dataset.action = a.id;
      b.addEventListener('click', () => finish(a.id));
      actions.appendChild(b);
      buttons.push(b);
    }
    const close = el('button', 'mdapp-btn', 'Close');
    close.type = 'button';
    close.dataset.action = 'close';
    close.addEventListener('click', () => finish(null));
    actions.appendChild(close);
    header.append(title, summary, tools, actions);

    const labels = el('div', 'mdapp-diff__labels');
    const leftLabel = el('span', 'mdapp-diff__label mdapp-diff__label--old', opts.leftLabel);
    const rightLabel = el('span', 'mdapp-diff__label mdapp-diff__label--new', opts.rightLabel);
    labels.append(leftLabel, rightLabel);

    const body = el('div', 'mdapp-diff__body');
    body.tabIndex = 0;
    body.setAttribute('aria-label', `Differences between ${opts.leftLabel} and ${opts.rightLabel}`);

    dialog.append(header, labels, body);
    backdrop.appendChild(dialog);

    function render(): void {
      splitBtn.setAttribute('aria-pressed', String(mode === 'split'));
      inlineBtn.setAttribute('aria-pressed', String(mode === 'inline'));
      dialog.dataset.mode = mode;
      labels.hidden = false;
      body.replaceChildren();
      if (!stats.added && !stats.removed) {
        body.appendChild(el('p', 'mdapp-diff__same', 'No differences: both versions have the same text.'));
        return;
      }
      const table = el('table', `mdapp-diff__table mdapp-diff__table--${mode}`);
      const tbody = el('tbody');
      foldRows(rows).forEach((seg, index) => {
        if (seg.kind === 'fold' && !expanded.has(index)) {
          const tr = el('tr', 'mdapp-diff__fold');
          const td = el('td');
          td.colSpan = 4;
          const btn = el('button', 'mdapp-diff__expand', `${seg.rows.length} unchanged line${seg.rows.length === 1 ? '' : 's'}`);
          btn.type = 'button';
          btn.addEventListener('click', () => { expanded.add(index); render(); });
          td.appendChild(btn);
          tr.appendChild(td);
          tbody.appendChild(tr);
          return;
        }
        for (const r of seg.rows) {
          if (mode === 'split') {tbody.appendChild(splitRow(r));}
          else {for (const tr of inlineRows(r)) {tbody.appendChild(tr);}}
        }
      });
      table.appendChild(tbody);
      body.appendChild(table);
    }

    function changeRows(): HTMLElement[] {
      // The first row of each run of changed rows.
      const all = Array.from(body.querySelectorAll<HTMLElement>('.mdapp-diff__row'));
      return all.filter((r, i) => !r.classList.contains('mdapp-diff__row--same') && (i === 0 || all[i - 1].classList.contains('mdapp-diff__row--same')));
    }

    function jump(delta: 1 | -1): void {
      const targets = changeRows();
      if (!targets.length) {return;}
      const top = body.scrollTop;
      const offset = (t: HTMLElement): number => t.offsetTop - body.offsetTop;
      let target: HTMLElement | undefined;
      if (delta > 0) {target = targets.find((t) => offset(t) > top + 2) ?? targets[0];}
      else {target = [...targets].reverse().find((t) => offset(t) < top - 2) ?? targets[targets.length - 1];}
      body.scrollTop = Math.max(0, offset(target) - 8);
    }

    function setMode(next: DiffMode): void {
      if (next === mode) {return;}
      mode = next;
      saveMode(mode);
      render();
    }

    function finish(value: string | null): void {
      backdrop.remove();
      previous?.focus?.();
      resolve(value);
    }

    splitBtn.addEventListener('click', () => setMode('split'));
    inlineBtn.addEventListener('click', () => setMode('inline'));
    prevBtn.addEventListener('click', () => jump(-1));
    nextBtn.addEventListener('click', () => jump(1));
    backdrop.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); finish(null); }
      else if (e.key === 'F7') { e.preventDefault(); jump(e.shiftKey ? -1 : 1); }
      else if (e.key === 'Tab') {
        const focusables = Array.from(dialog.querySelectorAll<HTMLElement>('button, [tabindex="0"]')).filter((x) => !x.hidden && x.offsetParent !== null);
        if (!focusables.length) {return;}
        const i = focusables.indexOf(document.activeElement as HTMLElement);
        e.preventDefault();
        focusables[(i + (e.shiftKey ? focusables.length - 1 : 1) + focusables.length) % focusables.length].focus();
      }
    });
    // Keys typed here must not reach the window's shortcut handler.
    backdrop.addEventListener('keydown', (e) => e.stopPropagation());

    render();
    root.appendChild(backdrop);
    body.focus();
    // Start at the first change.
    const first = changeRows()[0];
    if (first) {body.scrollTop = Math.max(0, first.offsetTop - body.offsetTop - 40);}
  });
}
