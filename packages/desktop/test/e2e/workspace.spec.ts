/**
 * T2 workspace flow: open a folder, create a file, rename it, delete one
 * (the Trash is the mock's `trash` command), split a pane, close a tab, then
 * relaunch and find the session restored (folder, tabs, split).
 */
import fs from 'node:fs';
import path from 'node:path';
import { test, expect } from './fixtures';

test('create, rename, delete, split, close, relaunch restores the session', async ({ page, ipc }) => {
  fs.writeFileSync(path.join(ipc.dir, 'a.md'), '# Alpha\n\nAlpha body.\n');
  fs.writeFileSync(path.join(ipc.dir, 'old.md'), '# Old\n');
  ipc.launchFiles = [ipc.dir];
  await page.setViewportSize({ width: 1400, height: 800 });
  await page.goto('/');

  const tree = page.getByRole('tree', { name: 'Files' });
  const item = (name: string) => tree.getByRole('treeitem', { name, exact: true });
  await expect(tree.getByRole('treeitem')).toHaveText(['a.md', 'old.md']);

  // Create: New File, a typed name without an extension gets .md.
  await page.getByRole('button', { name: 'New File' }).click();
  const field = tree.locator('.mdapp-tree__input');
  await expect(field).toHaveValue('Untitled.md');
  await field.fill('Idea');
  await field.press('Enter');
  await expect(item('Idea.md')).toBeVisible();
  expect(fs.existsSync(path.join(ipc.dir, 'Idea.md'))).toBe(true);

  // Rename: F2 on the row; new name on disk and in the tree.
  await item('Idea.md').focus();
  await page.keyboard.press('F2');
  const rename = tree.locator('.mdapp-tree__input');
  await rename.fill('Plan.md');
  await rename.press('Enter');
  await expect(item('Plan.md')).toBeVisible();
  await expect(item('Idea.md')).toHaveCount(0);
  expect(fs.existsSync(path.join(ipc.dir, 'Plan.md'))).toBe(true);
  expect(fs.existsSync(path.join(ipc.dir, 'Idea.md'))).toBe(false);

  // Delete: confirm, then the file is gone (the mocked Trash removes it).
  await item('old.md').focus();
  await page.keyboard.press('Delete');
  const dialog = page.getByRole('alertdialog');
  await expect(dialog).toContainText('old.md');
  await dialog.getByRole('button', { name: /Move to Trash|Delete/ }).click();
  await expect(item('old.md')).toHaveCount(0);
  expect(ipc.calls.some((c) => c.cmd === 'trash' && String((c.args as { path?: string }).path).endsWith('old.md'))).toBe(true);
  expect(fs.existsSync(path.join(ipc.dir, 'old.md'))).toBe(false);

  // Open two files and split: the second pane shows the active one.
  await item('a.md').click();
  await item('Plan.md').click();
  await expect(page.locator('.mdapp-tab__name')).toHaveText(['a.md', 'Plan.md']);
  await page.locator('.mdapp-pane--focused .ProseMirror').click();
  await page.keyboard.press('ControlOrMeta+\\');
  const panes = page.locator('.mdapp-pane');
  await expect(panes).toHaveCount(2);

  // Close a.md in the first pane (clean, so no prompt).
  await panes.nth(0).getByRole('tab', { name: /a\.md/ }).click();
  await page.keyboard.press('ControlOrMeta+w');
  await expect(panes.nth(0).locator('.mdapp-tab__name')).toHaveText(['Plan.md']);
  await expect(page.locator('.mdapp-modal')).toHaveCount(0);

  const tabsOf = (s: any): string[][] => s.layout.children.map((c: any) => c.tabs.map((t: any) => path.basename(t.path)));
  await expect.poll(() => {
    const s = ipc.session() as any;
    return s?.layout?.kind === 'split' ? tabsOf(s) : null;
  }, { timeout: 5000 }).toEqual([['Plan.md'], ['Plan.md']]);
  expect((ipc.session() as any).folder).toBe(ipc.dir);

  // Relaunch with nothing on the command line: the session comes back.
  await page.goto('about:blank');
  ipc.launchFiles = [];
  await page.goto('/');
  await expect(panes).toHaveCount(2);
  await expect(panes.nth(0).locator('.mdapp-tab__name')).toHaveText(['Plan.md']);
  await expect(panes.nth(1).locator('.mdapp-tab__name')).toHaveText(['Plan.md']);
  await expect(item('Plan.md')).toBeVisible();
  await expect(item('old.md')).toHaveCount(0);
});
