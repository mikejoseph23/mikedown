/**
 * Folder search (M7): the controller (debounce, cancel, cap, grouping), the
 * keyboard model, and the panel's DOM behavior over a fake `SearchApi`.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createSearchController,
  relativeDir,
  resolveKey,
  splitSnippet,
  visibleRows,
  type FileGroup,
  type SearchApi,
  type SearchMatch,
  type SearchSummary,
} from '../../src/search/searchLogic';
import { createSearchPanel } from '../../src/search/searchPanel';
import { commandForKey } from '../../src/menu/shortcuts';

const match = (path: string, line: number, text = 'a needle here', start = 2): SearchMatch => ({
  path, line, column: start + 1, snippet: text, matchStart: start, matchEnd: start + 6,
});

const summary = (over: Partial<SearchSummary> = {}): SearchSummary => ({
  matches: 0, filesSearched: 0, filesMatched: 0, skippedLarge: 0, truncated: false, cancelled: false, elapsedMs: 1, firstResultMs: 1, ...over,
});

function fakeApi() {
  let batch: ((e: { id: number; matches: SearchMatch[] }) => void) | null = null;
  let done: ((e: { id: number; summary: SearchSummary }) => void) | null = null;
  const starts: Array<{ id: number; root: string; query: string; options: Parameters<SearchApi['start']>[3] }> = [];
  const cancels: number[] = [];
  const api: SearchApi = {
    start: async (id, root, query, options) => { starts.push({ id, root, query, options }); },
    cancel: async (id) => { cancels.push(id); },
    onBatch: async (h) => { batch = h; return () => { batch = null; }; },
    onDone: async (h) => { done = h; return () => { done = null; }; },
  };
  return {
    api,
    starts,
    cancels,
    sendBatch: (id: number, matches: SearchMatch[]) => batch?.({ id, matches }),
    sendDone: (id: number, s = summary()) => done?.({ id, summary: s }),
  };
}

async function flush(): Promise<void> {
  for (let i = 0; i < 5; i++) {await Promise.resolve();}
}

describe('search controller', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  function make(over: Partial<Parameters<typeof createSearchController>[0]> = {}) {
    const f = fakeApi();
    const c = createSearchController({ api: f.api, root: () => '/notes', showHidden: () => false, ...over });
    return { f, c };
  }

  it('debounces typing by 250 ms and searches only the last query', async () => {
    const { f, c } = make();
    c.setQuery('n');
    vi.advanceTimersByTime(100);
    c.setQuery('ne');
    vi.advanceTimersByTime(100);
    c.setQuery('nee');
    expect(f.starts).toHaveLength(0);
    expect(c.state().status).toBe('pending');
    vi.advanceTimersByTime(249);
    await flush();
    expect(f.starts).toHaveLength(0);
    vi.advanceTimersByTime(1);
    await flush();
    expect(f.starts).toHaveLength(1);
    expect(f.starts[0]).toMatchObject({ root: '/notes', query: 'nee', options: { caseSensitive: false, wholeWord: false, showHidden: false, limit: 2000 } });
    expect(c.state().status).toBe('searching');
  });

  it('cancels the run in flight when the query changes, and ignores its late events', async () => {
    const { f, c } = make();
    c.setQuery('one');
    vi.advanceTimersByTime(250);
    await flush();
    const first = f.starts[0].id;
    f.sendBatch(first, [match('/notes/a.md', 1)]);
    expect(c.state().total).toBe(1);

    c.setQuery('two');
    expect(f.cancels).toEqual([first]);
    // A straggler from the cancelled run changes nothing.
    f.sendBatch(first, [match('/notes/b.md', 9)]);
    f.sendDone(first);
    expect(c.state().total).toBe(1);

    vi.advanceTimersByTime(250);
    await flush();
    expect(f.starts).toHaveLength(2);
    expect(f.starts[1].id).not.toBe(first);
    expect(c.state().total).toBe(0);
    expect(c.state().groups).toEqual([]);
  });

  it('starting a new search while one runs cancels the old one', async () => {
    const { f, c } = make();
    c.setQuery('a');
    c.searchNow();
    await flush();
    const first = f.starts[0].id;
    c.setQuery('ab');
    c.searchNow();
    await flush();
    expect(f.cancels).toContain(first);
    expect(f.starts).toHaveLength(2);
  });

  it('groups streamed matches by file and finishes on done', async () => {
    const { f, c } = make();
    const seen: number[] = [];
    c.subscribe((s) => seen.push(s.total));
    c.setQuery('needle');
    c.searchNow();
    await flush();
    const id = f.starts[0].id;
    f.sendBatch(id, [match('/notes/a.md', 1), match('/notes/a.md', 4)]);
    f.sendBatch(id, [match('/notes/b.md', 2), match('/notes/a.md', 9)]);
    f.sendDone(id, summary({ matches: 4, filesMatched: 2 }));
    const s = c.state();
    expect(s.status).toBe('done');
    expect(s.groups.map((g) => [g.path, g.matches.map((m) => m.line)])).toEqual([
      ['/notes/a.md', [1, 4, 9]],
      ['/notes/b.md', [2]],
    ]);
    expect(s.total).toBe(4);
    expect(s.truncated).toBe(false);
    expect(seen.at(-1)).toBe(4);
  });

  it('caps at the limit, marks the list truncated and cancels the rest', async () => {
    const { f, c } = make({ limit: 5 });
    c.setQuery('needle');
    c.searchNow();
    await flush();
    const id = f.starts[0].id;
    f.sendBatch(id, Array.from({ length: 4 }, (_, i) => match('/notes/a.md', i + 1)));
    expect(c.state().truncated).toBe(false);
    f.sendBatch(id, Array.from({ length: 4 }, (_, i) => match('/notes/b.md', i + 1)));
    const s = c.state();
    expect(s.total).toBe(5);
    expect(s.truncated).toBe(true);
    expect(s.status).toBe('done');
    expect(f.cancels).toContain(id);
    // Later events from that run are ignored.
    f.sendBatch(id, [match('/notes/c.md', 1)]);
    expect(c.state().total).toBe(5);
  });

  it('adopts the truncated flag Rust reports', async () => {
    const { f, c } = make();
    c.setQuery('x');
    c.searchNow();
    await flush();
    const id = f.starts[0].id;
    f.sendBatch(id, [match('/notes/a.md', 1)]);
    f.sendDone(id, summary({ matches: 1, truncated: true }));
    expect(c.state().truncated).toBe(true);
  });

  it('an empty query clears at once and starts nothing', async () => {
    const { f, c } = make();
    c.setQuery('abc');
    c.searchNow();
    await flush();
    f.sendBatch(f.starts[0].id, [match('/notes/a.md', 1)]);
    c.setQuery('');
    expect(c.state()).toMatchObject({ status: 'idle', total: 0, groups: [] });
    vi.advanceTimersByTime(1000);
    await flush();
    expect(f.starts).toHaveLength(1);
  });

  it('does nothing without an open folder', async () => {
    const { f, c } = make({ root: () => null });
    c.setQuery('abc');
    vi.advanceTimersByTime(250);
    await flush();
    expect(f.starts).toHaveLength(0);
    expect(c.state().status).toBe('idle');
  });

  it('passes the toggles and show hidden through, and re-searches when a toggle changes', async () => {
    let hidden = false;
    const { f, c } = make({ showHidden: () => hidden });
    c.setQuery('word');
    c.searchNow();
    await flush();
    c.setOptions({ caseSensitive: true, wholeWord: true });
    hidden = true;
    vi.advanceTimersByTime(250);
    await flush();
    expect(f.starts[1].options).toMatchObject({ caseSensitive: true, wholeWord: true, showHidden: true });
    // Setting the same options again does not schedule another run.
    c.setOptions({ caseSensitive: true });
    vi.advanceTimersByTime(1000);
    await flush();
    expect(f.starts).toHaveLength(2);
  });

  it('reports a start failure as an error state', async () => {
    const f = fakeApi();
    f.api.start = async () => { throw new Error('outside the folders MikeDown may access'); };
    const c = createSearchController({ api: f.api, root: () => '/x', showHidden: () => false });
    c.setQuery('a');
    c.searchNow();
    await flush();
    expect(c.state()).toMatchObject({ status: 'error', error: 'outside the folders MikeDown may access' });
  });
});

describe('result keyboard model', () => {
  const groups: FileGroup[] = [
    { path: '/n/a.md', matches: [match('/n/a.md', 1), match('/n/a.md', 2)] },
    { path: '/n/b.md', matches: [match('/n/b.md', 3)] },
  ];

  it('lists file rows and, unless collapsed, their matches', () => {
    expect(visibleRows(groups, new Set()).map((r) => (r.kind === 'file' ? 'F' : 'm'))).toEqual(['F', 'm', 'm', 'F', 'm']);
    expect(visibleRows(groups, new Set(['/n/a.md'])).map((r) => (r.kind === 'file' ? 'F' : 'm'))).toEqual(['F', 'F', 'm']);
  });

  it('moves with arrows, Home and End, clamped', () => {
    const rows = visibleRows(groups, new Set());
    const none = new Set<string>();
    expect(resolveKey('ArrowDown', rows, -1, none)).toEqual({ type: 'select', row: 0 });
    expect(resolveKey('ArrowDown', rows, 1, none)).toEqual({ type: 'select', row: 2 });
    expect(resolveKey('ArrowDown', rows, 4, none)).toEqual({ type: 'select', row: 4 });
    expect(resolveKey('ArrowUp', rows, 0, none)).toEqual({ type: 'select', row: 0 });
    expect(resolveKey('Home', rows, 3, none)).toEqual({ type: 'select', row: 0 });
    expect(resolveKey('End', rows, 0, none)).toEqual({ type: 'select', row: 4 });
    expect(resolveKey('ArrowDown', [], -1, none)).toEqual({ type: 'none' });
  });

  it('Enter opens a match and toggles a file; Escape closes', () => {
    const rows = visibleRows(groups, new Set());
    const none = new Set<string>();
    expect(resolveKey('Enter', rows, 2, none)).toEqual({ type: 'open', row: { kind: 'match', path: '/n/a.md', index: 1 } });
    expect(resolveKey('Enter', rows, 0, none)).toEqual({ type: 'toggle', path: '/n/a.md', expand: false });
    expect(resolveKey('Enter', rows, 0, new Set(['/n/a.md']))).toEqual({ type: 'toggle', path: '/n/a.md', expand: true });
    expect(resolveKey('Escape', rows, 2, none)).toEqual({ type: 'close' });
    expect(resolveKey('x', rows, 2, none)).toEqual({ type: 'none' });
  });

  it('Left collapses a file or jumps from a match to its file; Right expands', () => {
    const rows = visibleRows(groups, new Set());
    const none = new Set<string>();
    expect(resolveKey('ArrowLeft', rows, 0, none)).toEqual({ type: 'toggle', path: '/n/a.md', expand: false });
    expect(resolveKey('ArrowLeft', rows, 2, none)).toEqual({ type: 'select', row: 0 });
    expect(resolveKey('ArrowLeft', rows, 4, none)).toEqual({ type: 'select', row: 3 });
    expect(resolveKey('ArrowRight', rows, 0, none)).toEqual({ type: 'none' });
    expect(resolveKey('ArrowRight', rows, 0, new Set(['/n/a.md']))).toEqual({ type: 'toggle', path: '/n/a.md', expand: true });
  });
});

describe('snippet and path helpers', () => {
  it('splits a snippet around the match and clamps bad offsets', () => {
    expect(splitSnippet('say needle now', 4, 10)).toEqual({ before: 'say ', hit: 'needle', after: ' now' });
    expect(splitSnippet('abc', 2, 99)).toEqual({ before: 'ab', hit: 'c', after: '' });
    expect(splitSnippet('abc', -3, -1)).toEqual({ before: '', hit: '', after: 'abc' });
  });

  it('shows the folder part of a result path relative to the root', () => {
    expect(relativeDir('/n', '/n/a.md')).toBe('');
    expect(relativeDir('/n/', '/n/sub/deep/a.md')).toBe('sub/deep');
    expect(relativeDir('C:\\notes', 'C:\\notes\\sub\\a.md')).toBe('sub');
    expect(relativeDir('/n', '/elsewhere/a.md')).toBe('/elsewhere');
  });

  it('binds Cmd/Ctrl+Shift+F to the folder search command', () => {
    const k = (over: Partial<Parameters<typeof commandForKey>[0]>) => ({ key: 'F', metaKey: false, ctrlKey: false, shiftKey: true, altKey: false, ...over });
    expect(commandForKey(k({ metaKey: true }), true)).toBe('searchFolder');
    expect(commandForKey(k({ ctrlKey: true }), false)).toBe('searchFolder');
    // Plain Cmd+F stays core's find bar.
    expect(commandForKey(k({ key: 'f', metaKey: true, shiftKey: false }), true)).toBeNull();
  });
});

describe('search panel', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); document.body.replaceChildren(); });

  async function setup() {
    const f = fakeApi();
    const controller = createSearchController({ api: f.api, root: () => '/notes', showHidden: () => false });
    const opened: SearchMatch[] = [];
    let closed = 0;
    const panel = createSearchPanel({
      controller,
      root: () => '/notes',
      openMatch: (m) => opened.push(m),
      close: () => { closed++; },
    });
    document.body.append(panel.el);
    const input = panel.el.querySelector('input') as HTMLInputElement;
    const results = panel.el.querySelector('[role="tree"]') as HTMLElement;
    input.value = 'needle';
    input.dispatchEvent(new Event('input'));
    vi.advanceTimersByTime(250);
    await flush();
    const id = f.starts[0].id;
    f.sendBatch(id, [match('/notes/a.md', 1), match('/notes/a.md', 7)]);
    f.sendBatch(id, [match('/notes/sub/b.md', 3)]);
    f.sendDone(id, summary({ matches: 3, filesMatched: 2 }));
    return { f, panel, input, results, opened, closed: () => closed };
  }

  const key = (el: HTMLElement, k: string, init: KeyboardEventInit = {}) =>
    el.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true, ...init }));

  it('renders ARIA tree rows grouped per file with counts and a highlighted snippet', async () => {
    const { panel, results } = await setup();
    const items = results.querySelectorAll('[role="treeitem"]');
    expect(items).toHaveLength(5);
    const files = results.querySelectorAll('.mdapp-search__file');
    expect([...files].map((f) => f.getAttribute('aria-level'))).toEqual(['1', '1']);
    expect(files[0].querySelector('.mdapp-search__count')?.textContent).toBe('2');
    expect(files[1].querySelector('.mdapp-search__dir')?.textContent).toBe('sub');
    const first = results.querySelector('.mdapp-search__match') as HTMLElement;
    expect(first.getAttribute('aria-level')).toBe('2');
    expect(first.querySelector('mark')?.textContent).toBe('needle');
    expect(panel.el.querySelector('[role="status"]')?.textContent).toBe('3 results in 2 files.');
  });

  it('arrows move the selection and Enter opens the match', async () => {
    const { results, opened } = await setup();
    results.focus();
    key(results, 'ArrowDown'); // row 0 selected by focus; this moves to the first match
    const selected = () => results.querySelector('[aria-selected="true"]') as HTMLElement;
    expect(selected().classList.contains('mdapp-search__match')).toBe(true);
    expect(results.getAttribute('aria-activedescendant')).toBe(selected().id);
    key(results, 'Enter');
    expect(opened).toHaveLength(1);
    expect(opened[0]).toMatchObject({ path: '/notes/a.md', line: 1 });
    key(results, 'ArrowDown');
    key(results, 'ArrowDown'); // now on b.md's header
    expect(selected().classList.contains('mdapp-search__file')).toBe(true);
  });

  it('Left on a file collapses it, hiding its matches; Esc closes', async () => {
    const { results, closed } = await setup();
    results.focus();
    key(results, 'ArrowLeft');
    const header = results.querySelector('.mdapp-search__file') as HTMLElement;
    expect(header.getAttribute('aria-expanded')).toBe('false');
    const aMatches = [...results.querySelectorAll<HTMLElement>('.mdapp-search__match')].filter((m) => m.dataset.path === '/notes/a.md');
    expect(aMatches.every((m) => m.hidden)).toBe(true);
    key(results, 'ArrowDown'); // skips the hidden matches: next row is b.md
    expect((results.querySelector('[aria-selected="true"]') as HTMLElement).dataset.path).toBe('/notes/sub/b.md');
    key(results, 'Escape');
    expect(closed()).toBe(1);
  });

  it('clicking a match opens it, clicking a file toggles it', async () => {
    const { results, opened } = await setup();
    (results.querySelectorAll('.mdapp-search__match')[2] as HTMLElement).click();
    expect(opened.at(-1)).toMatchObject({ path: '/notes/sub/b.md', line: 3 });
    (results.querySelector('.mdapp-search__file') as HTMLElement).click();
    expect((results.querySelector('.mdapp-search__file') as HTMLElement).getAttribute('aria-expanded')).toBe('false');
  });

  it('ArrowDown in the box moves into the results; Esc in the box closes; toggles are pressed buttons', async () => {
    const { panel, input, results, closed } = await setup();
    input.focus();
    key(input, 'ArrowDown');
    expect(document.activeElement).toBe(results);
    key(input, 'Escape');
    expect(closed()).toBe(1);
    const caseBtn = panel.el.querySelector('[data-opt="case"]') as HTMLButtonElement;
    expect(caseBtn.getAttribute('aria-pressed')).toBe('false');
    caseBtn.click();
    expect(caseBtn.getAttribute('aria-pressed')).toBe('true');
  });

  it('says so when the list was capped', async () => {
    const f = fakeApi();
    const controller = createSearchController({ api: f.api, root: () => '/notes', showHidden: () => false, limit: 2 });
    const panel = createSearchPanel({ controller, root: () => '/notes', openMatch: () => {}, close: () => {} });
    document.body.append(panel.el);
    controller.setQuery('needle');
    controller.searchNow();
    await flush();
    f.sendBatch(f.starts[0].id, [match('/notes/a.md', 1), match('/notes/a.md', 2), match('/notes/a.md', 3)]);
    expect(panel.el.querySelector('[role="status"]')?.textContent).toContain('refine your search');
    expect(panel.el.querySelectorAll('.mdapp-search__match')).toHaveLength(2);
  });
});
