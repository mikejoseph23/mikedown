/**
 * T3: renaming a file or folder in the tree carries its version snapshots
 * (edge case 3). The snapshots are seeded on disk, so the test needs no saves.
 */
import fs from 'node:fs';
import path from 'node:path';
import { test, expect } from './fixtures';

const SNAP = '20261023T120000Z.md';

test('renaming a file and a folder moves their .mikedown/versions mirrors', async ({ page, ipc }) => {
  fs.mkdirSync(path.join(ipc.dir, 'notes'));
  fs.writeFileSync(path.join(ipc.dir, 'a.md'), '# Alpha\n');
  fs.writeFileSync(path.join(ipc.dir, 'notes', 'b.md'), '# Beta\n');
  const mirror = (rel: string) => path.join(ipc.dir, '.mikedown', 'versions', rel);
  for (const rel of ['a.md', path.join('notes', 'b.md')]) {
    fs.mkdirSync(mirror(rel), { recursive: true });
    fs.writeFileSync(path.join(mirror(rel), SNAP), 'old text\n');
  }
  ipc.launchFiles = [ipc.dir];
  await page.setViewportSize({ width: 1300, height: 820 });
  await page.goto('/');

  const tree = page.getByRole('tree', { name: 'Files' });
  const item = (name: string) => tree.getByRole('treeitem', { name, exact: true });
  const rename = async (from: string, to: string) => {
    await item(from).focus();
    await page.keyboard.press('F2');
    const field = tree.locator('.mdapp-tree__input');
    await field.fill(to);
    await field.press('Enter');
    await expect(item(to)).toBeVisible();
  };

  await expect(item('a.md')).toBeVisible();
  await rename('a.md', 'renamed.md');
  await expect.poll(() => fs.existsSync(path.join(mirror('renamed.md'), SNAP))).toBe(true);
  expect(fs.existsSync(mirror('a.md'))).toBe(false);

  await rename('notes', 'journal');
  await expect.poll(() => fs.existsSync(path.join(mirror('journal'), 'b.md', SNAP))).toBe(true);
  expect(fs.existsSync(mirror('notes'))).toBe(false);
  expect(fs.readFileSync(path.join(mirror('journal'), 'b.md', SNAP), 'utf8')).toBe('old text\n');
});
