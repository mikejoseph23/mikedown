/**
 * Panes and tabs with real core editors (jsdom): the same file in two panes
 * shows edits in both with the dirty dot on both tabs (M4 acceptance),
 * closing the tab shown elsewhere needs no prompt, a dirty tab's close asks
 * Save / Don't Save / Cancel, the cloud-placeholder timeout shows "still
 * downloading" with Retry, and a large file's notice offers rich text.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createMikeDownEditor } from '@mikedown/core';
import { stubLayoutMeasurement } from '../../../../test/harness/webviewHarness';
import { LARGE_FILE_BYTES, type ReadInfo } from '../../src/documents/documentModel';
import { createTestApp, flush, type TestApp } from './helpers/app';
import { installIpc, uninstallIpc, type IpcCall } from './helpers/ipc';

stubLayoutMeasurement();

const DIR = '/Users/mike/notes';
let files: Record<string, string>;
let calls: IpcCall[];
let app: TestApp;
let slowReads: Map<string, () => void>;
const readOnlyFiles = new Set<string>();

function info(text: string, readOnly = false): ReadInfo {
  return { text, encoding: 'utf8', eol: 'lf', mtimeMs: 1, readOnly, size: text.length };
}

function handler(cmd: string, args: any): unknown {
  switch (cmd) {
    case 'stat': {
      const text = files[args.path];
      return text === undefined
        ? { exists: false, isFile: false, isDir: false, mtimeMs: 0, size: 0, readOnly: false }
        : { exists: true, isFile: true, isDir: false, mtimeMs: 1, size: text.length, readOnly: false };
    }
    case 'read_text': {
      const text = files[args.path];
      if (text === undefined) {throw new Error(`ENOENT ${args.path}`);}
      if (slowReads.has(args.path)) {
        return new Promise<ReadInfo>((resolve) => slowReads.set(args.path, () => resolve(info(text))));
      }
      return info(text, readOnlyFiles.has(args.path));
    }
    case 'write_text':
      files[args.path] = args.text;
      return { mtimeMs: 2, size: args.text.length };
    default:
      return null;
  }
}

const tabNames = (paneIndex: number): string[] =>
  [...app.root.querySelectorAll('.mdapp-pane')[paneIndex].querySelectorAll('.mdapp-tab__name')].map((n) => n.textContent);
const tabEl = (paneIndex: number, i: number): HTMLElement =>
  app.root.querySelectorAll('.mdapp-pane')[paneIndex].querySelectorAll<HTMLElement>('.mdapp-tab')[i];
const pm = (paneIndex: number): HTMLElement =>
  app.root.querySelectorAll('.mdapp-pane')[paneIndex].querySelector('.ProseMirror') as HTMLElement;

beforeEach(() => {
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  files = { [`${DIR}/a.md`]: '# A\n\nAlpha body.\n', [`${DIR}/b.md`]: '# B\n\nBeta body.\n' };
  slowReads = new Map();
  readOnlyFiles.clear();
  calls = installIpc(handler);
  app = createTestApp((host, container) => createMikeDownEditor(container, {
    host,
    initialMarkdown: '',
    features: { sidebar: false, supportCard: false, sourceMode: true },
    hostOwnsShortcuts: true,
  }), { downloadNoticeMs: 50 });
});

afterEach(async () => {
  await new Promise((r) => setTimeout(r, 30));
  app.dispose();
  uninstallIpc();
  vi.restoreAllMocks();
});

describe('split panes', () => {
  it('the same file in two panes shows edits in both, dirty dot on both tabs', async () => {
    expect(await app.controller.openPath(`${DIR}/a.md`)).toBe(true);
    expect(await app.controller.openPath(`${DIR}/b.md`)).toBe(true);
    expect(tabNames(0)).toEqual(['a.md', 'b.md']);
    app.panes.activate(app.panes.focusedPaneId(), 0);
    app.panes.split('row');
    expect(app.root.querySelectorAll('.mdapp-pane')).toHaveLength(2);
    expect(tabNames(1)).toEqual(['a.md']);
    expect(pm(1).textContent).toContain('Alpha body.');

    // Type in pane two (through its editor): pane one follows.
    const second = app.panes.editor(app.panes.focusedPaneId())!.handle;
    second.tiptap.commands.insertContentAt(second.tiptap.state.doc.content.size - 1, ' Typed in pane two.');
    await flush();
    expect(pm(0).textContent).toContain('Alpha body. Typed in pane two.');
    const doc = app.registry.get(`${DIR}/a.md`)!;
    expect(doc.dirty).toBe(true);
    expect(doc.text).toContain('Typed in pane two.');
    expect(tabEl(0, 0).classList.contains('mdapp-tab--dirty')).toBe(true);
    expect(tabEl(1, 0).classList.contains('mdapp-tab--dirty')).toBe(true);
    expect(tabEl(0, 0).querySelector('.mdapp-tab__dot')?.hasAttribute('hidden')).toBe(false);
    // The window title follows the focused pane's document.
    const titles = calls.filter((c) => c.cmd === 'plugin:window|set_title').map((c) => (c.args as { value: string }).value);
    expect(titles.at(-1)).toBe('a.md');
    expect(calls.filter((c) => c.cmd === 'set_document_edited').at(-1)?.args).toEqual({ edited: true });

    // And back: an edit in pane one reaches pane two.
    const first = app.panes.editor('pane-1')!.handle;
    first.tiptap.commands.insertContentAt(first.tiptap.state.doc.content.size - 1, ' And one.');
    await flush();
    expect(pm(1).textContent).toContain('Typed in pane two. And one.');

    // Save from either pane writes the shared text once and cleans both tabs.
    expect(await app.controller.save()).toBe(true);
    expect(files[`${DIR}/a.md`]).toContain('Typed in pane two. And one.');
    expect(doc.dirty).toBe(false);
    expect(tabEl(0, 0).classList.contains('mdapp-tab--dirty')).toBe(false);
    expect(tabEl(1, 0).classList.contains('mdapp-tab--dirty')).toBe(false);
  });

  it('closing the tab in one pane while the other still shows the document asks nothing', async () => {
    await app.controller.openPath(`${DIR}/a.md`);
    app.panes.split('column');
    const second = app.panes.focusedPaneId();
    app.panes.editor(second)!.handle.tiptap.commands.insertContentAt(1, 'x');
    await flush();
    expect(app.registry.get(`${DIR}/a.md`)!.dirty).toBe(true);
    expect(await app.controller.closeTab(second, 0)).toBe(true);
    expect(app.root.querySelectorAll('.mdapp-pane')).toHaveLength(1);
    expect(document.querySelector('.mdapp-modal')).toBeNull();
    expect(app.registry.get(`${DIR}/a.md`)!.dirty).toBe(true);
  });

  it('a dirty tab asks Save / Don’t Save / Cancel; Cancel keeps it, Save writes it', async () => {
    await app.controller.openPath(`${DIR}/a.md`);
    const pane = app.panes.focusedPaneId();
    app.handle.tiptap.commands.insertContentAt(1, 'x');
    await flush();
    const closing = app.controller.closeTab(pane, 0);
    await flush();
    const dialog = document.querySelector('.mdapp-modal--choose') as HTMLElement;
    expect(dialog.textContent).toContain('Save changes to “a.md” before closing?');
    const buttons = [...dialog.querySelectorAll<HTMLButtonElement>('button')].map((b) => b.textContent);
    expect(buttons).toEqual(['Cancel', 'Don’t Save', 'Save']);
    (dialog.querySelector('[data-index="0"]') as HTMLButtonElement).click();
    expect(await closing).toBe(false);
    expect(tabNames(0)).toEqual(['a.md']);

    const closing2 = app.controller.closeTab(pane, 0);
    await flush();
    (document.querySelector('.mdapp-modal--choose [data-index="2"]') as HTMLButtonElement).click();
    expect(await closing2).toBe(true);
    expect(files[`${DIR}/a.md`]).toMatch(/^# xA|x/);
    expect(tabNames(0)).toEqual([]);
    expect(app.registry.get(`${DIR}/a.md`)).toBeUndefined();
  });

  it('the one quit dialog lists every dirty document and Cancel keeps them', async () => {
    await app.controller.openPath(`${DIR}/a.md`);
    app.handle.tiptap.commands.insertContentAt(1, 'x');
    await app.controller.openPath(`${DIR}/b.md`);
    app.handle.tiptap.commands.insertContentAt(1, 'y');
    app.controller.newDocument();
    app.handle.tiptap.commands.insertContent('draft');
    await flush();
    const asking = app.controller.confirmCloseAll('quit');
    await flush();
    const dialogs = document.querySelectorAll('.mdapp-modal--choose');
    expect(dialogs).toHaveLength(1);
    expect(dialogs[0].textContent).toContain('Save changes to 3 documents before you quit?');
    expect(dialogs[0].textContent).toContain('• a.md');
    expect(dialogs[0].textContent).toContain('• Untitled');
    (dialogs[0].querySelector('[data-index="0"]') as HTMLButtonElement).click();
    expect(await asking).toBe(false);
    expect(app.registry.all().filter((d) => d.dirty)).toHaveLength(3);
  });
});

describe('document states', () => {
  it('a slow read shows the tab as still downloading with Retry, then loads (edge 10)', async () => {
    slowReads.set(`${DIR}/a.md`, () => {});
    const opening = app.controller.openPath(`${DIR}/a.md`);
    await new Promise((r) => setTimeout(r, 80));
    const doc = app.registry.get(`${DIR}/a.md`)!;
    expect(doc.state).toBe('downloading');
    expect(tabNames(0)).toEqual(['a.md']);
    const state = tabEl(0, 0).querySelector('.mdapp-tab__state') as HTMLElement;
    expect(state.hidden).toBe(false);
    expect(state.textContent).toContain('still downloading');
    // Retry is a real button in the pane's info bar, not inside the tab (axe: nested-interactive).
    expect(state.querySelector('button')).toBeNull();
    const bar = app.root.querySelector('.mdapp-pane__notice') as HTMLElement;
    expect(bar.hidden).toBe(false);
    expect((bar.querySelector('.mdapp-notice__action') as HTMLButtonElement).textContent).toBe('Retry');
    // The download finishes.
    slowReads.get(`${DIR}/a.md`)!();
    expect(await opening).toBe(true);
    expect(doc.state).toBe('ready');
    expect(doc.text).toContain('Alpha body.');
    expect((tabEl(0, 0).querySelector('.mdapp-tab__state') as HTMLElement).hidden).toBe(true);
    expect(pm(0).textContent).toContain('Alpha body.');
  });

  it('a read-only file opens normally with a lock badge; Cmd+S offers Save As with the reason (edge 10)', async () => {
    files[`${DIR}/locked.md`] = '# Locked\n\nBody.\n';
    readOnlyFiles.add(`${DIR}/locked.md`);
    expect(await app.controller.openPath(`${DIR}/locked.md`)).toBe(true);
    const doc = app.registry.get(`${DIR}/locked.md`)!;
    expect(doc.readOnly).toBe(true);
    expect(doc.sourceMode).toBe(false);
    const lock = tabEl(0, 0).querySelector('.mdapp-tab__lock') as HTMLElement;
    expect(lock.hidden).toBe(false);
    expect(lock.title).toMatch(/read-only/i);
    expect(tabEl(0, 0).getAttribute('aria-label')).toMatch(/read-only/);

    // Cancel keeps everything as it was; Save As writes a copy elsewhere.
    expect(await app.controller.save()).toBe(false);
    expect(calls.some((c) => c.cmd === 'write_text')).toBe(false);
    const prompt = calls.find((c) => c.cmd === 'plugin:dialog|message');
    expect((prompt?.args as { message: string }).message).toMatch(/cannot be saved in place[\s\S]*read-only/);
  });

  it('a large markdown file opens in source mode with an "Open as rich text anyway" action (edge 12)', async () => {
    files[`${DIR}/big.md`] = '# Big\n\n' + 'x'.repeat(LARGE_FILE_BYTES);
    expect(await app.controller.openPath(`${DIR}/big.md`)).toBe(true);
    const doc = app.registry.get(`${DIR}/big.md`)!;
    expect(doc.sourceMode).toBe(true);
    expect(app.controller.isSourceMode()).toBe(true);
    const notice = app.root.querySelector('.mdapp-pane__notice') as HTMLElement;
    expect(notice.hidden).toBe(false);
    expect(notice.textContent).toContain('Large file');
    const action = notice.querySelector('.mdapp-notice__action') as HTMLButtonElement;
    expect(action.textContent).toBe('Open as rich text anyway');
    action.click();
    expect(doc.sourceMode).toBe(false);
    expect(app.controller.isSourceMode()).toBe(false);
    expect(notice.hidden).toBe(true);
  });

  it('a file over 20 MB is refused before reading, offering the default app (edge 12)', async () => {
    const huge = 21 * 1024 * 1024;
    uninstallIpc();
    calls = installIpc((cmd, args) => {
      if (cmd === 'stat') {return { exists: true, isFile: true, isDir: false, mtimeMs: 1, size: huge, readOnly: false };}
      if (cmd === 'plugin:dialog|message') {return 'Open in Default App';}
      if (cmd === 'read_text') {throw new Error('should not read');}
      return null;
    });
    expect(await app.controller.openPath(`${DIR}/huge.md`)).toBe(false);
    expect(calls.map((c) => c.cmd)).toEqual(['stat', 'plugin:dialog|message', 'open_in_default_app']);
    expect((calls[1].args as { message: string }).message).toMatch(/20 MB/);
  });
});
