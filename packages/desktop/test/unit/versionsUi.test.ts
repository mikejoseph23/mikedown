/**
 * M6 UI: the diff model (line pairing, word highlights, folding), the diff
 * viewer's DOM (modes, actions, Escape), the version browser (selection,
 * buttons, empty states) and Restore (edge case 2: the buffer turns dirty,
 * nothing is written).
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createDocumentRegistry, planOpen, type ReadInfo } from '../../src/documents/documentModel';
import type { Versioning, VersionSnapshot } from '../../src/documents/versioning';
import { buildDiffRows, diffStats, foldRows, showDiff } from '../../src/ui/diffView';
import { createVersionsPanel, emptyReason, panelActions, relativeTime, restoreIntoDocument, toggleSelection } from '../../src/ui/versions';
import { fakeHandle, flush } from './helpers/app';

afterEach(() => {
  document.body.replaceChildren();
  vi.restoreAllMocks();
});

describe('buildDiffRows', () => {
  it('pairs changed lines with word-level parts and keeps line numbers', () => {
    const rows = buildDiffRows('# Title\n\nThe quick fox.\nGone line\n', '# Title\n\nThe slow fox.\n\nNew line\n');
    expect(rows.map((r) => r.kind)).toEqual(['same', 'same', 'change', 'change', 'add']);
    const change = rows[2];
    expect(change.left!.no).toBe(3);
    expect(change.right!.no).toBe(3);
    expect(change.left!.parts.filter((p) => p.changed).map((p) => p.text)).toEqual(['quick']);
    expect(change.right!.parts.filter((p) => p.changed).map((p) => p.text)).toEqual(['slow']);
    expect(change.left!.parts.map((p) => p.text).join('')).toBe('The quick fox.');
    expect(rows[4].right!.no).toBe(5);
    expect(diffStats(rows)).toEqual({ added: 3, removed: 2 });
  });

  it('pure additions and deletions have no partner', () => {
    const rows = buildDiffRows('a\nb\n', 'a\n');
    expect(rows.map((r) => r.kind)).toEqual(['same', 'del']);
    expect(rows[1].right).toBeNull();
    expect(buildDiffRows('', 'x\n').map((r) => r.kind)).toEqual(['add']);
  });

  it('identical texts have no changes; CRLF is ignored', () => {
    const rows = buildDiffRows('a\r\nb\r\n', 'a\nb\n');
    expect(diffStats(rows)).toEqual({ added: 0, removed: 0 });
  });
});

describe('foldRows', () => {
  const lines = (n: number, prefix = 'l'): string => Array.from({ length: n }, (_, i) => `${prefix}${i}`).join('\n') + '\n';

  it('keeps three lines of context and folds the rest', () => {
    const left = lines(20);
    const right = left.replace('l10\n', 'changed\n');
    const segs = foldRows(buildDiffRows(left, right));
    expect(segs.map((s) => [s.kind, s.rows.length])).toEqual([['fold', 7], ['rows', 7], ['fold', 6]]);
  });

  it('short unchanged runs stay visible; no change is one fold', () => {
    const segs = foldRows(buildDiffRows('a\nb\nc\n', 'a\nB\nc\n'));
    expect(segs).toHaveLength(1);
    expect(segs[0].kind).toBe('rows');
    expect(foldRows(buildDiffRows(lines(10), lines(10))).map((s) => s.kind)).toEqual(['fold']);
  });
});

describe('showDiff', () => {
  it('renders side by side, switches to inline, resolves with the pressed action', async () => {
    const result = showDiff({ title: 'a.md', leftLabel: 'On disk', rightLabel: 'Yours', left: 'one\ntwo\n', right: 'one\nthree\n', mode: 'split', actions: [{ id: 'overwrite', label: 'Overwrite', primary: true }] });
    const dialog = document.querySelector('.mdapp-diff') as HTMLElement;
    expect(dialog.getAttribute('role')).toBe('dialog');
    expect(dialog.querySelector('.mdapp-diff__title')!.textContent).toBe('a.md');
    expect(dialog.querySelector('.mdapp-diff__table--split')).not.toBeNull();
    expect(dialog.querySelector('.mdapp-diff__row--change .mdapp-diff__text--old .mdapp-diff__word')!.textContent).toBe('two');
    expect(dialog.querySelector('.mdapp-diff__row--change .mdapp-diff__text--new .mdapp-diff__word')!.textContent).toBe('three');
    (dialog.querySelector('[data-mode="inline"]') as HTMLButtonElement).click();
    expect(dialog.querySelector('.mdapp-diff__table--inline')).not.toBeNull();
    expect([...dialog.querySelectorAll('.mdapp-diff__sign')].map((s) => s.textContent)).toEqual(['', '−', '+']);
    (dialog.querySelector('[data-action="overwrite"]') as HTMLButtonElement).click();
    expect(await result).toBe('overwrite');
    expect(document.querySelector('.mdapp-diff')).toBeNull();
  });

  it('Escape closes with null; identical texts say so', async () => {
    const result = showDiff({ title: 'a.md', leftLabel: 'A', rightLabel: 'B', left: 'same\n', right: 'same\n' });
    expect(document.querySelector('.mdapp-diff__same')!.textContent).toMatch(/No differences/);
    document.querySelector('.mdapp-diff')!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(await result).toBeNull();
  });

  it('folded runs expand on click', async () => {
    const left = Array.from({ length: 30 }, (_, i) => `line ${i}`).join('\n') + '\n';
    const result = showDiff({ title: 'x', leftLabel: 'A', rightLabel: 'B', left, right: left.replace('line 15', 'LINE 15'), mode: 'split' });
    const expand = document.querySelectorAll<HTMLButtonElement>('.mdapp-diff__expand');
    expect(expand).toHaveLength(2);
    expect(expand[0].textContent).toBe('12 unchanged lines');
    expand[0].click();
    expect(document.querySelectorAll('.mdapp-diff__expand')).toHaveLength(1);
    (document.querySelector('[data-action="close"]') as HTMLButtonElement).click();
    expect(await result).toBeNull();
  });
});

describe('version browser helpers', () => {
  it('selection keeps at most two, dropping the oldest pick', () => {
    expect(toggleSelection([], 'a')).toEqual(['a']);
    expect(toggleSelection(['a'], 'b')).toEqual(['a', 'b']);
    expect(toggleSelection(['a', 'b'], 'c')).toEqual(['b', 'c']);
    expect(toggleSelection(['a', 'b'], 'a')).toEqual(['b']);
  });

  it('buttons follow the selection size', () => {
    expect(panelActions(0)).toEqual({ compareCurrent: false, compareTwo: false, restore: false });
    expect(panelActions(1)).toEqual({ compareCurrent: true, compareTwo: false, restore: true });
    expect(panelActions(2)).toEqual({ compareCurrent: false, compareTwo: true, restore: false });
  });

  it('explains every empty state', () => {
    const doc = { path: '/n/a.md', kind: 'markdown' as const };
    expect(emptyReason({ root: null, enabled: true, doc, dir: null })).toMatch(/open folder/);
    expect(emptyReason({ root: '/n', enabled: true, doc: null, dir: null })).toMatch(/Open a file/);
    expect(emptyReason({ root: '/n', enabled: true, doc: { path: null, kind: 'markdown' }, dir: null })).toMatch(/Save the document/);
    expect(emptyReason({ root: '/n', enabled: true, doc, dir: null })).toMatch(/outside the open folder/);
    expect(emptyReason({ root: '/n', enabled: false, doc, dir: '/n/.mikedown/versions/a.md' })).toMatch(/turned off/);
    expect(emptyReason({ root: '/n', enabled: true, doc, dir: '/n/.mikedown/versions/a.md' })).toBeNull();
  });

  it('relative times', () => {
    const now = Date.UTC(2026, 9, 23, 12);
    expect(relativeTime(now - 10_000, now)).toBe('just now');
    expect(relativeTime(now - 5 * 60_000, now)).toBe('5 minutes ago');
    expect(relativeTime(now - 3 * 3_600_000, now)).toBe('3 hours ago');
    expect(relativeTime(now - 30 * 3_600_000, now)).toBe('yesterday');
    expect(relativeTime(now - 4 * 86_400_000, now)).toBe('4 days ago');
  });
});

describe('version browser panel', () => {
  const snaps: VersionSnapshot[] = [
    { name: '20261023T120200Z.md', path: '/n/.mikedown/versions/a.md/20261023T120200Z.md', size: 30, timeMs: Date.UTC(2026, 9, 23, 12, 2) },
    { name: '20261023T120100Z.md', path: '/n/.mikedown/versions/a.md/20261023T120100Z.md', size: 20, timeMs: Date.UTC(2026, 9, 23, 12, 1) },
    { name: '20261023T120000Z.md', path: '/n/.mikedown/versions/a.md/20261023T120000Z.md', size: 10, timeMs: Date.UTC(2026, 9, 23, 12, 0) },
  ];

  function panel(opts: { root?: string | null; rows?: VersionSnapshot[] } = {}) {
    const compare = vi.fn();
    const restore = vi.fn();
    const versioning = {
      dirFor: (f: string) => (opts.root === null ? null : `/n/.mikedown/versions/${f.slice(3)}`),
      list: async () => opts.rows ?? snaps,
    } as unknown as Versioning;
    const p = createVersionsPanel({
      versioning,
      activeDoc: () => ({ path: '/n/a.md', kind: 'markdown' }) as never,
      root: () => (opts.root === undefined ? '/n' : opts.root),
      enabled: () => true,
      compare,
      restore,
      close: vi.fn(),
      now: () => Date.UTC(2026, 9, 23, 12, 5),
    });
    document.body.appendChild(p.el);
    return { p, compare, restore };
  }

  it('lists snapshots newest first; one selection compares with current or restores, two compare oldest first', async () => {
    const { p, compare, restore } = panel();
    await p.refresh();
    const rows = [...p.el.querySelectorAll<HTMLElement>('[role="option"]')];
    expect(rows.map((r) => r.querySelector('.mdapp-versions__when')!.textContent)).toEqual(['3 minutes ago Latest', '4 minutes ago', '5 minutes ago']);
    const btn = (a: string) => p.el.querySelector(`[data-action="${a}"]`) as HTMLButtonElement;
    expect(btn('compare-current').disabled).toBe(true);
    rows[1].click();
    expect(rows[1].getAttribute('aria-selected')).toBe('true');
    expect(btn('compare-current').disabled).toBe(false);
    expect(btn('restore').disabled).toBe(false);
    btn('compare-current').click();
    expect(compare).toHaveBeenLastCalledWith(snaps[1], 'current');
    btn('restore').click();
    expect(restore).toHaveBeenLastCalledWith(snaps[1]);
    rows[0].click();
    expect(btn('compare-two').disabled).toBe(false);
    expect(btn('restore').disabled).toBe(true);
    btn('compare-two').click();
    expect(compare).toHaveBeenLastCalledWith(snaps[1], snaps[0]);
  });

  it('keyboard: arrows move, Space selects, Enter compares with current', async () => {
    const { p, compare } = panel();
    await p.refresh();
    p.focus();
    const list = p.el.querySelector('[role="listbox"]') as HTMLElement;
    list.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
    list.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', bubbles: true }));
    list.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    expect(compare).toHaveBeenLastCalledWith(snaps[1], 'current');
  });

  it('shows why there is nothing to list', async () => {
    const lone = panel({ root: null });
    await lone.p.refresh();
    expect((lone.p.el.querySelector('.mdapp-versions__empty') as HTMLElement).hidden).toBe(false);
    expect(lone.p.el.querySelector('.mdapp-versions__empty')!.textContent).toMatch(/open folder/);
    document.body.replaceChildren();
    const none = panel({ rows: [] });
    await none.p.refresh();
    expect(none.p.el.querySelector('.mdapp-versions__empty')!.textContent).toMatch(/No versions yet/);
    expect((none.p.el.querySelector('.mdapp-versions__list') as HTMLElement).hidden).toBe(true);
  });
});

describe('restore (edge case 2)', () => {
  function info(text: string): ReadInfo {
    return { text, encoding: 'utf8', eol: 'lf', mtimeMs: 1, readOnly: false, size: text.length };
  }

  function setup() {
    const writeText = vi.fn(async () => ({ mtimeMs: 2, size: 0 }));
    const registry = createDocumentRegistry({ fs: { readText: async () => info(''), writeText } });
    const doc = registry.open('/n/a.md', info('current\n'), planOpen('/n/a.md', info('current\n')));
    const handle = fakeHandle();
    doc.attach(handle);
    return { doc, handle, writeText };
  }

  it('replaces the buffer, marks the tab dirty and never writes', async () => {
    const { doc, handle, writeText } = setup();
    const confirm = vi.fn(async () => true);
    expect(await restoreIntoDocument(doc, async () => 'older\n', confirm)).toBe('restored');
    await flush();
    expect(doc.text).toBe('older\n');
    expect(doc.dirty).toBe(true);
    expect(handle.getMarkdown()).toBe('older\n');
    expect(writeText).not.toHaveBeenCalled();
    expect(confirm).not.toHaveBeenCalled();
  });

  it('asks before replacing unsaved edits; cancel keeps them', async () => {
    const { doc, handle, writeText } = setup();
    handle.emitChange('unsaved\n');
    expect(await restoreIntoDocument(doc, async () => 'older\n', async () => false)).toBe('cancelled');
    expect(doc.text).toBe('unsaved\n');
    expect(await restoreIntoDocument(doc, async () => 'older\n', async () => true)).toBe('restored');
    expect(doc.text).toBe('older\n');
    expect(writeText).not.toHaveBeenCalled();
  });

  it('restoring the text already there changes nothing', async () => {
    const { doc } = setup();
    expect(await restoreIntoDocument(doc, async () => 'current\n', async () => true)).toBe('unchanged');
    expect(doc.dirty).toBe(false);
  });
});
