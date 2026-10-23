/**
 * Hot exit (edge cases 7–8): three dirty documents (two files, one
 * Untitled), their backups land in <app-data>/backups about a second after
 * the edits, the page is torn down without any save (the `kill -9`
 * equivalent for the webview), and the next launch restores all three as
 * dirty tabs with their edits, without a dialog. Saving one clears its
 * backup; quitting shows the one dialog listing the rest.
 */
import fs from 'node:fs';
import path from 'node:path';
import { test, expect } from './fixtures';

test('three dirty files survive a crash and come back dirty', async ({ page, ipc }) => {
  fs.writeFileSync(path.join(ipc.dir, 'one.md'), '# One\n\nFirst.\n');
  fs.writeFileSync(path.join(ipc.dir, 'two.md'), '# Two\n\nSecond.\n');
  ipc.launchFiles = [ipc.dir];
  await page.setViewportSize({ width: 1300, height: 800 });
  await page.goto('/');

  const tree = page.getByRole('tree', { name: 'Files' });
  const editor = page.locator('.mdapp-pane--focused .ProseMirror');
  const type = async (anchor: string, text: string): Promise<void> => {
    await editor.getByText(anchor).click();
    await page.keyboard.press('End');
    await page.keyboard.type(text);
  };

  await tree.getByRole('treeitem', { name: 'one.md', exact: true }).click();
  await type('First.', ' Edit one.');
  await tree.getByRole('treeitem', { name: 'two.md', exact: true }).click();
  await type('Second.', ' Edit two.');
  await page.keyboard.press('ControlOrMeta+n');
  await expect(page.getByRole('tab', { name: /Untitled/ })).toHaveAttribute('aria-selected', 'true');
  await editor.click();
  await page.keyboard.type('Draft three.');

  // Backups arrive about a second after the last edit, nothing is saved.
  await expect.poll(() => Object.keys(ipc.backupIndex()).length, { timeout: 5000 }).toBe(3);
  const index = ipc.backupIndex();
  const entries = Object.values(index);
  expect(entries.filter((e) => e.path).map((e) => path.basename(e.path!)).sort()).toEqual(['one.md', 'two.md']);
  expect(entries.filter((e) => e.untitledId)).toHaveLength(1);
  expect(entries.every((e) => e.folder === ipc.dir)).toBe(true);
  expect(fs.readFileSync(path.join(ipc.dir, 'one.md'), 'utf8')).toBe('# One\n\nFirst.\n');
  await expect.poll(() => ipc.session() as any, { timeout: 5000 }).toMatchObject({ folder: ipc.dir });

  // Crash: no save, no close handler, the page just goes.
  await page.goto('about:blank');
  ipc.calls.length = 0;
  ipc.launchFiles = [];
  await page.goto('/');

  // All three are back, dirty, with their edits, and no dialog was shown.
  const tabs = page.getByRole('tablist', { name: 'Open documents' }).getByRole('tab');
  await expect(page.locator('.mdapp-tab__name')).toHaveText(['one.md', 'two.md', 'Untitled']);
  for (const name of ['one.md', 'two.md', 'Untitled']) {
    await expect(tabs.filter({ hasText: name })).toHaveClass(/mdapp-tab--dirty/);
  }
  await expect(page.locator('.mdapp-modal')).toHaveCount(0);
  const docs: Array<{ path: string | null; dirty: boolean; text: string }> = await page.evaluate(() => (window as any).mikedownApp.docs());
  expect(docs).toHaveLength(3);
  expect(docs.find((d) => d.path?.endsWith('one.md'))?.text).toContain('First. Edit one.');
  expect(docs.find((d) => d.path?.endsWith('two.md'))?.text).toContain('Second. Edit two.');
  expect(docs.find((d) => d.path === null)?.text).toContain('Draft three.');
  expect(docs.every((d) => d.dirty)).toBe(true);
  expect(ipc.calls.some((c) => c.cmd === 'write_text')).toBe(false);

  // Save one: its edit reaches disk and its backup goes.
  await tabs.filter({ hasText: 'one.md' }).click();
  await page.keyboard.press('ControlOrMeta+s');
  await expect.poll(() => fs.readFileSync(path.join(ipc.dir, 'one.md'), 'utf8')).toContain('First. Edit one.');
  await expect.poll(() => Object.keys(ipc.backupIndex()).length).toBe(2);

  // Quit: exactly one dialog listing the two still dirty; Cancel keeps the app.
  await page.evaluate(() => (window as any).__mikedownE2eEmit('mikedown:quit-requested', null));
  const dialog = page.getByRole('alertdialog');
  await expect(dialog).toHaveCount(1);
  await expect(dialog).toContainText('Save changes to 2 documents before you quit?');
  await expect(dialog).toContainText('• two.md');
  await expect(dialog).toContainText('• Untitled');
  await dialog.getByRole('button', { name: 'Cancel' }).click();
  await expect.poll(() => ipc.quitReplies).toEqual([false]);
  await expect(tabs).toHaveCount(3);

  // Quit again with Don't Save: proceed, backups cleared, nothing written.
  await page.evaluate(() => (window as any).__mikedownE2eEmit('mikedown:quit-requested', null));
  await page.getByRole('alertdialog').getByRole('button', { name: 'Don’t Save' }).click();
  await expect.poll(() => ipc.quitReplies).toEqual([false, true]);
  await expect.poll(() => Object.keys(ipc.backupIndex()).length).toBe(0);
  expect(fs.readFileSync(path.join(ipc.dir, 'two.md'), 'utf8')).toBe('# Two\n\nSecond.\n');
});
