/**
 * M11 end to end in the browser (mocked Tauri, real disk):
 *
 * - Edge 12: a file just over 2 MB opens in source mode with the info bar;
 *   a source-mode-only tab saves; "Open as rich text anyway" switches it;
 *   a 21 MB file is refused without being read and offers the default app.
 * - Edge 20: an unsupported file dropped on the editor is ignored with a toast.
 * - Edge 21: "Don't ask again" on the delete confirmation is written to the
 *   settings file and the next delete goes straight to the Trash.
 * - Keyboard only: tree, open, tabs, split, search and Settings without a mouse.
 */
import fs from 'node:fs';
import path from 'node:path';
import { test, expect } from './fixtures';

const MB = 1024 * 1024;

/** `n` bytes of short markdown lines (many lines keep the rich-text path honest). */
function markdownOfSize(n: number): string {
  const line = 'A line of ordinary prose for the large file gate.\n';
  return '# Big\n\n' + line.repeat(Math.ceil(n / line.length));
}

test('a file over 2 MB opens in source mode; its tab saves; Open as rich text anyway switches', async ({ page, ipc }) => {
  test.setTimeout(120_000);
  const big = ipc.write('big.md', markdownOfSize(2 * MB + 4096));
  const other = ipc.write('other.md', markdownOfSize(2 * MB + 4096));
  ipc.launchFiles = [big];
  await page.goto('/');

  const bar = page.locator('.mdapp-pane__notice');
  await expect(bar).toContainText('Large file');
  await expect(bar.getByRole('button', { name: 'Open as rich text anyway' })).toBeVisible();
  // Source mode: CodeMirror, no rich-text editor.
  const cm = page.locator('#editor .cm-content');
  await expect(cm).toBeVisible();
  await expect(page.locator('#editor .ProseMirror:visible')).toHaveCount(0);

  // A source-mode-only tab saves like any other.
  await cm.click();
  await page.keyboard.press('ControlOrMeta+End');
  await page.keyboard.type('\nTyped at the end.');
  await expect.poll(() => page.evaluate(() => (window as any).mikedownModel.dirty)).toBe(true);
  await page.keyboard.press('ControlOrMeta+s');
  await expect.poll(() => ipc.calls.filter((c) => c.cmd === 'write_text').length).toBe(1);
  await expect.poll(() => page.evaluate(() => (window as any).mikedownModel.dirty)).toBe(false);
  expect(fs.readFileSync(big, 'utf8').endsWith('Typed at the end.')).toBe(true);
  // Over 2 MB: no version snapshot (edge 1) and no error.
  expect(ipc.calls.some((c) => c.cmd.startsWith('versions_'))).toBe(false);
  await expect(page.getByRole('alertdialog')).toHaveCount(0);

  // The second large file: Open as rich text anyway.
  await page.evaluate((p) => (window as any).mikedownApp.controller.openPath(p), other);
  await expect.poll(() => page.evaluate(() => (window as any).mikedownModel?.path)).toBe(other);
  await bar.getByRole('button', { name: 'Open as rich text anyway' }).click();
  await expect(page.locator('#editor .ProseMirror:visible')).toHaveCount(1, { timeout: 60_000 });
  await expect(bar).toBeHidden();
});

test('a file over 20 MB is refused unread and offers the default app', async ({ page, ipc }) => {
  const huge = ipc.write('huge.md', Buffer.alloc(21 * MB, 0x61));
  const small = ipc.write('small.md', '# Small\n');
  ipc.launchFiles = [small];
  await page.addInitScript(() => {
    const internals = (window as any).__TAURI_INTERNALS__;
    const original = internals.invoke;
    (window as any).__dialogs = [];
    internals.invoke = (cmd: string, ...rest: unknown[]) => {
      if (cmd !== 'plugin:dialog|message') {return original(cmd, ...rest);}
      (window as any).__dialogs.push(rest[0]);
      return Promise.resolve('Open in Default App');
    };
  });
  await page.goto('/');
  await expect(page.locator('#editor .ProseMirror')).toContainText('Small');
  const readsBefore = ipc.calls.filter((c) => c.cmd === 'read_text').length;
  await page.evaluate((p) => (window as any).mikedownApp.controller.openPath(p), huge);
  await expect.poll(() => ipc.calls.some((c) => c.cmd === 'open_in_default_app')).toBe(true);
  expect(ipc.calls.filter((c) => c.cmd === 'read_text').length).toBe(readsBefore);
  const shown = (await page.evaluate(() => (window as any).__dialogs)) as Array<{ message: string }>;
  expect(shown).toHaveLength(1);
  expect(shown[0].message).toMatch(/20 MB/);
});

test('an unsupported file dropped on the editor is ignored with a toast', async ({ page, ipc }) => {
  const doc = ipc.write('a.md', '# Alpha\n\nText.\n');
  const pdf = ipc.write('report.pdf', '%PDF-1.4');
  ipc.launchFiles = [doc];
  await page.setViewportSize({ width: 1200, height: 800 });
  await page.goto('/');
  await expect(page.locator('#editor .ProseMirror')).toContainText('Text.');
  const box = (await page.locator('#editor .ProseMirror').boundingBox())!;
  const dpr = await page.evaluate(() => window.devicePixelRatio || 1);
  await page.evaluate(([paths, x, y]) => (window as any).__mikedownE2eEmit('tauri://drag-drop', { paths, position: { x, y } }), [[pdf], (box.x + 40) * dpr, (box.y + 40) * dpr] as const);
  await expect(page.locator('.mdapp-toast--visible')).toContainText('cannot insert “report.pdf”');
  // Nothing was inserted and nothing opened.
  await expect(page.locator('#editor .ProseMirror')).not.toContainText('report.pdf');
  expect(await page.evaluate(() => (window as any).mikedownModel.dirty)).toBe(false);
});

test('Don’t ask again on the delete confirmation is persisted and skips the next prompt', async ({ page, ipc }) => {
  fs.writeFileSync(path.join(ipc.dir, 'one.md'), '# One\n');
  fs.writeFileSync(path.join(ipc.dir, 'two.md'), '# Two\n');
  ipc.launchFiles = [ipc.dir];
  await page.goto('/');
  const tree = page.getByRole('tree', { name: 'Files' });
  const item = (name: string) => tree.getByRole('treeitem', { name, exact: true });
  await item('one.md').focus();
  await page.keyboard.press('Delete');
  const dialog = page.getByRole('alertdialog');
  await dialog.getByLabel('Don’t ask again').check();
  await dialog.getByRole('button', { name: /Move to Trash|Delete/ }).click();
  await expect(item('one.md')).toHaveCount(0);
  const settingsFile = path.join(ipc.appData, 'settings.json');
  await expect.poll(() => {
    try { return JSON.parse(fs.readFileSync(settingsFile, 'utf8'))['tree.confirmDelete']; } catch { return undefined; }
  }).toBe(false);

  await item('two.md').focus();
  await page.keyboard.press('Delete');
  await expect(item('two.md')).toHaveCount(0);
  await expect(page.getByRole('alertdialog')).toHaveCount(0);
  expect(ipc.calls.filter((c) => c.cmd === 'trash')).toHaveLength(2);

  // And it survives a relaunch.
  fs.writeFileSync(path.join(ipc.dir, 'three.md'), '# Three\n');
  await page.goto('about:blank');
  await page.goto('/');
  await item('three.md').focus();
  await page.keyboard.press('Delete');
  await expect(item('three.md')).toHaveCount(0);
  await expect(page.getByRole('alertdialog')).toHaveCount(0);
});

test('keyboard only: tree, open, tabs, split, search, Settings', async ({ page, ipc }) => {
  ipc.write('a.md', '# Alpha\n\nThe needle is here.\n');
  ipc.write('b.md', '# Beta\n');
  ipc.custom.search_folder = () => null;
  ipc.launchFiles = [ipc.dir];
  await page.setViewportSize({ width: 1300, height: 820 });
  await page.goto('/');
  await expect(page.getByRole('tree', { name: 'Files' })).toBeVisible();

  const inTree = () => page.evaluate(() => !!document.activeElement?.closest('[role="tree"][aria-label="Files"]'));
  // Tab until a tree row has focus (no mouse), then Home / ArrowDown / Space to open (Enter renames on macOS) two files.
  for (let i = 0; i < 25 && !(await inTree()); i++) {await page.keyboard.press('Tab');}
  expect(await inTree()).toBe(true);
  await page.keyboard.press('Home');
  await page.keyboard.press('Space');
  await expect(page.locator('.mdapp-tab__name')).toHaveText(['a.md']);
  // Opening moves focus to the editor; Cmd/Ctrl+Shift+E brings it back to the tree.
  await page.keyboard.press('ControlOrMeta+Shift+E');
  expect(await inTree()).toBe(true);
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Space');
  await expect(page.locator('.mdapp-tab__name')).toHaveText(['a.md', 'b.md']);

  // Ctrl+Tab moves to the other tab; the tablist exposes the selection.
  const selected = page.getByRole('tab', { selected: true });
  const before = await selected.getAttribute('aria-label');
  await page.keyboard.press('Control+Tab');
  await expect.poll(() => selected.getAttribute('aria-label')).not.toBe(before);

  // Split.
  await page.locator('.mdapp-pane--focused .ProseMirror').focus();
  await page.keyboard.press('ControlOrMeta+\\');
  await expect(page.locator('.mdapp-pane')).toHaveCount(2);

  // Search, then back out.
  await page.keyboard.press('ControlOrMeta+Shift+F');
  await expect(page.getByRole('textbox', { name: 'Search the folder' })).toBeFocused();
  await page.keyboard.type('needle');
  await page.keyboard.press('Escape');

  // Settings and out again.
  await page.locator('.mdapp-pane--focused .ProseMirror').focus();
  await page.keyboard.press('ControlOrMeta+,');
  const modal = page.locator('.settings-modal');
  await expect(modal).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(modal).toBeHidden();
});
