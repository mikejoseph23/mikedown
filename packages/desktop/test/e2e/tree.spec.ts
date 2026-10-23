/**
 * M3: open a folder, expand a directory, open a file from the tree, and
 * create a note with New File (inline rename, `.md` appended). The folder
 * arrives the way a folder dropped on the Dock icon or passed on the command
 * line does (`frontend_ready` → a directory path). Set M3_SHOTS=<dir> to save
 * light and dark screenshots of the sidebar.
 */
import fs from 'node:fs';
import path from 'node:path';
import { test, expect } from './fixtures';

const SHOTS = process.env.M3_SHOTS;

test('open a folder, expand, open a file, New File', async ({ page, ipc }) => {
  fs.mkdirSync(path.join(ipc.dir, 'notes', 'deep'), { recursive: true });
  fs.mkdirSync(path.join(ipc.dir, '.git'));
  fs.writeFileSync(path.join(ipc.dir, 'a.md'), '# Alpha\n\nSee [[Beta]].\n');
  fs.writeFileSync(path.join(ipc.dir, 'notes', 'Beta.md'), '# Beta\n\nThe beta note.\n');
  fs.writeFileSync(path.join(ipc.dir, 'notes', 'file10.md'), '# Ten\n');
  fs.writeFileSync(path.join(ipc.dir, 'notes', 'file2.md'), '# Two\n');
  ipc.launchFiles = [ipc.dir];
  await page.setViewportSize({ width: 1300, height: 800 });
  await page.goto('/');

  const tree = page.getByRole('tree', { name: 'Files' });
  await expect(tree).toBeVisible();
  const items = tree.getByRole('treeitem');
  await expect(items).toHaveText(['notes', 'a.md']);

  // Expand: children load lazily, folders first, natural order.
  await tree.getByRole('treeitem', { name: 'notes', exact: true }).click();
  await expect(tree.getByRole('treeitem', { name: 'notes', exact: true })).toHaveAttribute('aria-expanded', 'true');
  await expect(items).toHaveText(['notes', 'deep', 'Beta.md', 'file2.md', 'file10.md', 'a.md']);

  // Open a file from the tree.
  await tree.getByRole('treeitem', { name: 'Beta.md', exact: true }).click();
  await expect(page.locator('#editor .ProseMirror')).toContainText('The beta note.');
  await expect(page.locator('.mdapp-tab__name')).toHaveText('Beta.md');
  await expect(page.getByRole('button', { name: 'Open Containing Folder' })).toBeHidden();
  await expect(tree.locator('.mdapp-tree__row--active')).toHaveText('Beta.md');

  // Keyboard: Up moves to the previous row.
  await tree.getByRole('treeitem', { name: 'file2.md', exact: true }).focus();
  await page.keyboard.press('ArrowUp');
  await expect(tree.getByRole('treeitem', { name: 'Beta.md', exact: true })).toBeFocused();

  // The wikilink in a.md resolves through the folder index.
  await tree.getByRole('treeitem', { name: 'a.md', exact: true }).click();
  await expect(page.locator('#editor a[data-wikilink]')).toHaveAttribute('href', './notes/Beta.md');

  if (SHOTS) {
    for (const scheme of ['light', 'dark'] as const) {
      await page.emulateMedia({ colorScheme: scheme });
      await tree.getByRole('treeitem', { name: 'file2.md', exact: true }).hover();
      await page.screenshot({ path: `${SHOTS}/m3-e2e-${scheme}.png` });
    }
    await page.emulateMedia({ colorScheme: 'light' });
  }

  // New File: Untitled.md in rename mode; a typed name without an extension gets .md.
  await page.getByRole('button', { name: 'New File' }).click();
  const field = tree.locator('.mdapp-tree__input');
  await expect(field).toHaveValue('Untitled.md');
  await field.fill('Fresh idea');
  await field.press('Enter');
  await expect(tree.getByRole('treeitem', { name: 'Fresh idea.md', exact: true })).toBeVisible();
  expect(fs.existsSync(path.join(ipc.dir, 'notes', 'Fresh idea.md')) || fs.existsSync(path.join(ipc.dir, 'Fresh idea.md'))).toBe(true);

  // Cmd/Ctrl+B outside the editor collapses the sidebar; inside it is Bold.
  await tree.getByRole('treeitem', { name: 'a.md', exact: true }).focus();
  await page.keyboard.press('ControlOrMeta+b');
  await expect(tree).toBeHidden();
  await page.keyboard.press('ControlOrMeta+Shift+E');
  await expect(tree).toBeVisible();
});
