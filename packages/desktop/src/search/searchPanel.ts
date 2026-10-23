/**
 * The folder search panel (M7, edge cases 19 and 26): a query box with case
 * and whole-word toggles, then the results grouped by file (collapsible, with
 * counts) and highlighted snippets. It lives in the sidebar in place of the
 * tree. Enter opens the selected match, arrows move, Esc closes; the results
 * are an ARIA tree (flat rows with `aria-level`) that keeps focus on one
 * element and points at the selected row with `aria-activedescendant`.
 */
import {
  baseName,
  relativeDir,
  resolveKey,
  splitSnippet,
  visibleRows,
  type NavRow,
  type SearchController,
  type SearchMatch,
  type SearchState,
} from './searchLogic';

export interface SearchPanelDeps {
  controller: SearchController;
  root(): string | null;
  /** Open the file and reveal the match; the panel does not touch documents. */
  openMatch(match: SearchMatch): void;
  /** Esc: leave the search view. */
  close(): void;
}

export interface SearchPanel {
  readonly el: HTMLElement;
  /** Move focus into the query box, selecting its text. */
  focus(): void;
  /** Re-run the current query (the folder or "show hidden" changed). */
  refresh(): void;
  /** A different folder opened: forget the results. */
  reset(): void;
}

let panelSeq = 0;

export function createSearchPanel(deps: SearchPanelDeps): SearchPanel {
  const { controller } = deps;
  const uid = `mdapp-search-${++panelSeq}`;
  const el = document.createElement('div');
  el.className = 'mdapp-search';
  el.innerHTML = `
    <div class="mdapp-search__bar">
      <input class="mdapp-search__input" type="text" spellcheck="false" autocomplete="off" autocapitalize="off"
        placeholder="Search" aria-label="Search the folder" />
      <button type="button" class="mdapp-search__toggle" data-opt="case" aria-pressed="false" aria-label="Match case" title="Match case">Aa</button>
      <button type="button" class="mdapp-search__toggle" data-opt="word" aria-pressed="false" aria-label="Match whole word" title="Match whole word"><span class="mdapp-search__word">ab</span></button>
    </div>
    <div class="mdapp-search__status" role="status" aria-live="polite"></div>
    <div class="mdapp-search__results" role="tree" aria-label="Search results" tabindex="0"></div>`;
  const input = el.querySelector('.mdapp-search__input') as HTMLInputElement;
  const statusEl = el.querySelector('.mdapp-search__status') as HTMLElement;
  const results = el.querySelector('.mdapp-search__results') as HTMLElement;
  const caseBtn = el.querySelector('[data-opt="case"]') as HTMLButtonElement;
  const wordBtn = el.querySelector('[data-opt="word"]') as HTMLButtonElement;

  const collapsed = new Set<string>();
  /** Rendered rows, in order, keyed so streamed batches only append. */
  const groupEls = new Map<string, { header: HTMLElement; rows: HTMLElement[]; count: HTMLElement }>();
  let selected = -1;

  const rowId = (row: NavRow): string => (row.kind === 'file' ? `${uid}-f-${hash(row.path)}` : `${uid}-m-${hash(row.path)}-${row.index}`);

  function hash(s: string): string {
    let h = 5381;
    for (let i = 0; i < s.length; i++) {h = ((h << 5) + h + s.charCodeAt(i)) | 0;}
    return (h >>> 0).toString(36);
  }

  function rows(): NavRow[] {
    return visibleRows(controller.state().groups, collapsed);
  }

  function setSelected(index: number, scroll = true): void {
    const list = rows();
    selected = list.length ? Math.max(-1, Math.min(list.length - 1, index)) : -1;
    for (const node of results.querySelectorAll('[aria-selected="true"]')) {node.setAttribute('aria-selected', 'false');}
    const row = list[selected];
    if (!row) {
      results.removeAttribute('aria-activedescendant');
      return;
    }
    const node = document.getElementById(rowId(row));
    node?.setAttribute('aria-selected', 'true');
    results.setAttribute('aria-activedescendant', rowId(row));
    if (scroll) {node?.scrollIntoView?.({ block: 'nearest' });}
  }

  function renderMatch(m: SearchMatch, index: number, setSize: number): HTMLElement {
    const row = document.createElement('div');
    row.className = 'mdapp-search__match';
    row.id = rowId({ kind: 'match', path: m.path, index });
    row.setAttribute('role', 'treeitem');
    row.setAttribute('aria-level', '2');
    row.setAttribute('aria-posinset', String(index + 1));
    row.setAttribute('aria-setsize', String(setSize));
    row.setAttribute('aria-selected', 'false');
    row.dataset.path = m.path;
    row.dataset.index = String(index);
    const { before, hit, after } = splitSnippet(m.snippet, m.matchStart, m.matchEnd);
    const line = document.createElement('span');
    line.className = 'mdapp-search__line';
    line.textContent = String(m.line);
    const text = document.createElement('span');
    text.className = 'mdapp-search__snippet';
    const mark = document.createElement('mark');
    mark.textContent = hit;
    text.append(before, mark, after);
    row.append(line, text);
    row.setAttribute('aria-label', `Line ${m.line}: ${m.snippet}`);
    return row;
  }

  function renderGroup(path: string): { header: HTMLElement; rows: HTMLElement[]; count: HTMLElement } {
    const root = deps.root() ?? '';
    const header = document.createElement('div');
    header.className = 'mdapp-search__file';
    header.id = rowId({ kind: 'file', path });
    header.setAttribute('role', 'treeitem');
    header.setAttribute('aria-level', '1');
    header.setAttribute('aria-expanded', collapsed.has(path) ? 'false' : 'true');
    header.setAttribute('aria-selected', 'false');
    header.dataset.path = path;
    header.title = path;
    const twisty = document.createElement('span');
    twisty.className = 'mdapp-search__twisty';
    twisty.setAttribute('aria-hidden', 'true');
    const name = document.createElement('span');
    name.className = 'mdapp-search__name';
    name.textContent = baseName(path);
    const dir = document.createElement('span');
    dir.className = 'mdapp-search__dir';
    dir.textContent = relativeDir(root, path);
    const count = document.createElement('span');
    count.className = 'mdapp-search__count';
    header.append(twisty, name, dir, count);
    return { header, rows: [], count };
  }

  /** Append what the controller has beyond what is on screen. */
  function render(state: SearchState): void {
    // A new run starts empty: drop the old rows.
    if (state.total === 0 && state.groups.length === 0) {
      results.replaceChildren();
      groupEls.clear();
      selected = -1;
      results.removeAttribute('aria-activedescendant');
    }
    for (const g of state.groups) {
      let ge = groupEls.get(g.path);
      if (!ge) {
        ge = renderGroup(g.path);
        groupEls.set(g.path, ge);
        results.append(ge.header);
      }
      for (let i = ge.rows.length; i < g.matches.length; i++) {
        const node = renderMatch(g.matches[i], i, g.matches.length);
        node.hidden = collapsed.has(g.path);
        // Matches follow their header, in order.
        const after = ge.rows[i - 1] ?? ge.header;
        after.after(node);
        ge.rows.push(node);
      }
      ge.count.textContent = String(g.matches.length);
      ge.header.setAttribute('aria-label', `${baseName(g.path)}, ${g.matches.length} ${g.matches.length === 1 ? 'match' : 'matches'}`);
      for (const r of ge.rows) {r.setAttribute('aria-setsize', String(g.matches.length));}
    }
    statusEl.textContent = statusText(state);
    statusEl.classList.toggle('mdapp-search__status--error', state.status === 'error');
    if (selected < 0 && state.total > 0 && document.activeElement === results) {setSelected(0);}
  }

  function statusText(s: SearchState): string {
    switch (s.status) {
      case 'idle': return '';
      case 'pending': return s.total ? `${count(s)}…` : 'Searching…';
      case 'searching': return s.total ? `${count(s)}…` : 'Searching…';
      case 'error': return s.error ?? 'Search failed.';
      case 'done': {
        if (s.total === 0) {return 'No results.';}
        return s.truncated ? `${count(s)}. Showing the first ${s.total}; refine your search to see the rest.` : `${count(s)}.`;
      }
    }
  }

  function count(s: SearchState): string {
    const files = s.groups.length;
    return `${s.total} ${s.total === 1 ? 'result' : 'results'} in ${files} ${files === 1 ? 'file' : 'files'}`;
  }

  function setCollapsed(path: string, collapse: boolean): void {
    if (collapse) {collapsed.add(path);} else {collapsed.delete(path);}
    const ge = groupEls.get(path);
    if (!ge) {return;}
    ge.header.setAttribute('aria-expanded', collapse ? 'false' : 'true');
    for (const r of ge.rows) {r.hidden = collapse;}
  }

  function matchOf(row: NavRow): SearchMatch | null {
    if (row.kind !== 'match') {return null;}
    return controller.state().groups.find((g) => g.path === row.path)?.matches[row.index] ?? null;
  }

  function indexOfNode(node: HTMLElement): number {
    const path = node.dataset.path ?? '';
    const list = rows();
    if (node.classList.contains('mdapp-search__file')) {return list.findIndex((r) => r.kind === 'file' && r.path === path);}
    const index = Number(node.dataset.index);
    return list.findIndex((r) => r.kind === 'match' && r.path === path && r.index === index);
  }

  // ── Events ────────────────────────────────────────────────────────────────
  controller.subscribe(render);

  input.addEventListener('input', () => controller.setQuery(input.value));
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      const state = controller.state();
      // Enter on an unchanged, finished query opens the first match; else run now.
      if (state.status === 'done' && state.query === input.value && state.total > 0) {
        results.focus();
        setSelected(rows().findIndex((r) => r.kind === 'match'));
        const row = rows()[selected];
        const m = row ? matchOf(row) : null;
        if (m) {deps.openMatch(m);}
      } else {
        controller.setQuery(input.value);
        controller.searchNow();
      }
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      results.focus();
      setSelected(selected < 0 ? 0 : selected);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      deps.close();
    }
  });

  function toggleOption(btn: HTMLButtonElement, key: 'caseSensitive' | 'wholeWord'): void {
    const on = btn.getAttribute('aria-pressed') !== 'true';
    btn.setAttribute('aria-pressed', String(on));
    btn.classList.toggle('mdapp-search__toggle--on', on);
    controller.setOptions({ [key]: on });
    input.focus();
  }
  caseBtn.addEventListener('click', () => toggleOption(caseBtn, 'caseSensitive'));
  wordBtn.addEventListener('click', () => toggleOption(wordBtn, 'wholeWord'));

  results.addEventListener('keydown', (e) => {
    if (e.key === 'Tab' || e.metaKey || e.ctrlKey || e.altKey) {return;}
    const action = resolveKey(e.key, rows(), selected, collapsed);
    if (action.type === 'none') {return;}
    e.preventDefault();
    if (action.type === 'select') {setSelected(action.row);}
    else if (action.type === 'toggle') {setCollapsed(action.path, !action.expand);}
    else if (action.type === 'close') {e.stopPropagation(); deps.close();}
    else {
      const m = matchOf(action.row);
      if (m) {deps.openMatch(m);}
    }
  });
  results.addEventListener('focus', () => {
    if (selected < 0 && controller.state().total > 0) {setSelected(0);}
  });
  results.addEventListener('click', (e) => {
    const node = (e.target as HTMLElement).closest<HTMLElement>('.mdapp-search__file, .mdapp-search__match');
    if (!node) {return;}
    const idx = indexOfNode(node);
    if (idx < 0) {return;}
    setSelected(idx, false);
    const row = rows()[idx];
    if (row.kind === 'file') {
      setCollapsed(row.path, !collapsed.has(row.path));
    } else {
      const m = matchOf(row);
      if (m) {deps.openMatch(m);}
    }
  });
  // Down in the box with no results yet is harmless; Esc anywhere in the panel closes it.
  el.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && e.target !== input && e.target !== results) {
      e.preventDefault();
      deps.close();
    }
  });

  return {
    el,
    focus() {
      input.focus();
      input.select();
    },
    refresh() {
      if (input.value) {controller.searchNow();}
    },
    reset() {
      collapsed.clear();
      controller.clear();
      input.value = '';
    },
  };
}
