/**
 * M6 acceptance in the browser (mocked Tauri, real disk):
 *
 * - Save three times with changes and once without: exactly three snapshots
 *   under `.mikedown/versions/a.md/`, names in chronological order; the
 *   version browser lists them and Compare opens the diff viewer.
 * - Edit the file "in another editor" while the tab is dirty: saving asks
 *   "changed on disk"; Compare shows the disk text against the buffer;
 *   Revert reloads it; Overwrite writes the buffer and snapshots.
 * - A 3 MB file saves without a snapshot and without any message.
 */
import fs from 'node:fs';
import path from 'node:path';
import type { Page } from '@playwright/test';
import { test, expect } from './fixtures';

const SNAP = /^\d{8}T\d{6}Z\.md$/;

function snapshots(dir: string, rel: string): string[] {
  const d = path.join(dir, '.mikedown', 'versions', rel);
  return fs.existsSync(d) ? fs.readdirSync(d).filter((n) => SNAP.test(n)).sort() : [];
}

/** Write the file as another app would, with an mtime clearly after the last one. */
function externalWrite(file: string, text: string, bumpS = 5): void {
  fs.writeFileSync(file, text);
  const t = new Date(Date.now() + bumpS * 1000);
  fs.utimesSync(file, t, t);
}

async function openFolderAndFile(page: Page, dir: string, file: string): Promise<void> {
  await page.goto('/');
  await expect(page.getByRole('tree', { name: 'Files' })).toBeVisible();
  await page.evaluate((p) => (window as any).mikedownApp.controller.openPath(p), file);
  await expect.poll(() => page.evaluate(() => (window as any).mikedownModel?.path)).toBe(file);
}

async function typeAtEnd(page: Page, text: string): Promise<void> {
  const editor = page.locator('#editor .ProseMirror');
  await editor.locator('p').last().click();
  await page.keyboard.press('End');
  await page.keyboard.type(text);
  await expect.poll(() => page.evaluate(() => (window as any).mikedownModel.dirty)).toBe(true);
}

async function save(page: Page, ipc: { calls: Array<{ cmd: string }> }, expectedWrites: number): Promise<void> {
  await page.keyboard.press('ControlOrMeta+s');
  await expect.poll(() => ipc.calls.filter((c) => c.cmd === 'write_text').length).toBe(expectedWrites);
  await expect.poll(() => page.evaluate(() => (window as any).mikedownModel.dirty)).toBe(false);
}

test('three saves with changes and one without leave three snapshots; the browser lists and compares them', async ({ page, ipc }) => {
  const file = ipc.write('a.md', '# Alpha\n\nFirst line.\n');
  ipc.launchFiles = [ipc.dir];
  await page.setViewportSize({ width: 1300, height: 820 });
  await openFolderAndFile(page, ipc.dir, file);
  expect(fs.existsSync(path.join(ipc.dir, '.mikedown'))).toBe(false);

  await typeAtEnd(page, ' One.');
  await save(page, ipc, 1);
  await expect.poll(() => snapshots(ipc.dir, 'a.md').length).toBe(1);
  await typeAtEnd(page, ' Two.');
  await save(page, ipc, 2);
  await expect.poll(() => snapshots(ipc.dir, 'a.md').length).toBe(2);
  // A save with no change: the bytes match the newest snapshot.
  await page.keyboard.press('ControlOrMeta+s');
  await expect.poll(() => ipc.calls.filter((c) => c.cmd === 'write_text').length).toBe(3);
  await expect.poll(() => ipc.calls.filter((c) => c.cmd === 'versions_snapshot').length).toBe(3);
  await typeAtEnd(page, ' Three.');
  await save(page, ipc, 4);
  await expect.poll(() => snapshots(ipc.dir, 'a.md').length).toBe(3);

  const names = snapshots(ipc.dir, 'a.md');
  expect(names).toHaveLength(3);
  expect([...names].sort()).toEqual(names);
  const newest = fs.readFileSync(path.join(ipc.dir, '.mikedown', 'versions', 'a.md', names[2]), 'utf8');
  expect(newest).toContain('First line. One. Two. Three.');

  // The version browser (Cmd/Ctrl+Alt+V) lists them, newest first.
  await page.locator('#editor .ProseMirror').click();
  await page.keyboard.press('ControlOrMeta+Alt+V');
  const list = page.getByRole('listbox', { name: 'Versions' });
  await expect(list.getByRole('option')).toHaveCount(3);
  await expect(list.getByRole('option').first()).toContainText('Latest');

  // Oldest vs current: the diff viewer, side by side, word highlights.
  await list.getByRole('option').last().click();
  await page.getByRole('button', { name: 'Compare with Current' }).click();
  const diff = page.getByRole('dialog');
  await expect(diff).toBeVisible();
  await expect(diff.locator('.mdapp-diff__text--new .mdapp-diff__word').first()).toContainText('Two');
  if (process.env.M6_SHOTS) {await page.screenshot({ path: path.join(process.env.M6_SHOTS, 'm6-diff-split.png') });}
  await diff.getByRole('button', { name: 'Inline' }).click();
  await expect(diff.locator('.mdapp-diff__table--inline')).toBeVisible();
  if (process.env.M6_SHOTS) {await page.screenshot({ path: path.join(process.env.M6_SHOTS, 'm6-diff-inline.png') });}

  // Restore from the diff: the buffer takes the old text and turns dirty; nothing is written.
  const writesBefore = ipc.calls.filter((c) => c.cmd === 'write_text').length;
  await diff.getByRole('button', { name: /^Restore/ }).click();
  await expect(diff).toBeHidden();
  await expect.poll(() => page.evaluate(() => (window as any).mikedownModel.dirty)).toBe(true);
  await expect(page.locator('#editor .ProseMirror')).not.toContainText('Two.');
  expect(ipc.calls.filter((c) => c.cmd === 'write_text').length).toBe(writesBefore);
  expect(fs.readFileSync(file, 'utf8')).toContain('Three.');
  if (process.env.M6_SHOTS) {await page.screenshot({ path: path.join(process.env.M6_SHOTS, 'm6-versions-panel.png') });}
});

test('external edit while dirty: save asks; Compare shows disk vs buffer; Revert reloads; Overwrite writes and snapshots', async ({ page, ipc }) => {
  const file = ipc.write('a.md', '# Alpha\n\nFirst line.\n');
  ipc.launchFiles = [ipc.dir];
  await page.setViewportSize({ width: 1300, height: 820 });
  await openFolderAndFile(page, ipc.dir, file);

  // Round 1: Compare, then Revert from the diff viewer.
  await typeAtEnd(page, ' Mine.');
  externalWrite(file, '# Alpha\n\nFirst line. Theirs.\n');
  await page.keyboard.press('ControlOrMeta+s');
  const ask = page.getByRole('alertdialog');
  await expect(ask).toContainText('“a.md” changed on disk.');
  await expect(ask.getByRole('button')).toHaveText(['Cancel', 'Compare…', 'Revert', 'Overwrite']);
  if (process.env.M6_SHOTS) {await page.screenshot({ path: path.join(process.env.M6_SHOTS, 'm6-changed-on-disk.png') });}
  await ask.getByRole('button', { name: 'Compare…' }).click();
  const diff = page.getByRole('dialog');
  await expect(diff).toContainText('On disk');
  await expect(diff).toContainText('Your unsaved version');
  await expect(diff.locator('.mdapp-diff__text--old .mdapp-diff__word')).toContainText(['Theirs']);
  await expect(diff.locator('.mdapp-diff__text--new .mdapp-diff__word')).toContainText(['Mine']);
  if (process.env.M6_SHOTS) {await page.screenshot({ path: path.join(process.env.M6_SHOTS, 'm6-compare-disk.png') });}
  await diff.getByRole('button', { name: 'Revert to Disk' }).click();
  await expect(page.locator('#editor .ProseMirror')).toContainText('First line. Theirs.');
  await expect.poll(() => page.evaluate(() => (window as any).mikedownModel.dirty)).toBe(false);
  expect(ipc.calls.filter((c) => c.cmd === 'write_text')).toHaveLength(0);
  expect(snapshots(ipc.dir, 'a.md')).toHaveLength(0);

  // Round 2: Revert straight from the question.
  await typeAtEnd(page, ' Again.');
  externalWrite(file, '# Alpha\n\nFirst line. Theirs twice.\n', 10);
  await page.keyboard.press('ControlOrMeta+s');
  await page.getByRole('alertdialog').getByRole('button', { name: 'Revert' }).click();
  await expect(page.locator('#editor .ProseMirror')).toContainText('Theirs twice.');
  await expect.poll(() => page.evaluate(() => (window as any).mikedownModel.dirty)).toBe(false);
  expect(ipc.calls.filter((c) => c.cmd === 'write_text')).toHaveLength(0);

  // Round 3: Overwrite writes the buffer and snapshots it.
  await typeAtEnd(page, ' Final.');
  externalWrite(file, '# Alpha\n\nSomeone else.\n', 15);
  await page.keyboard.press('ControlOrMeta+s');
  await page.getByRole('alertdialog').getByRole('button', { name: 'Overwrite' }).click();
  await expect.poll(() => ipc.calls.filter((c) => c.cmd === 'write_text').length).toBe(1);
  await expect.poll(() => page.evaluate(() => (window as any).mikedownModel.dirty)).toBe(false);
  expect(fs.readFileSync(file, 'utf8')).toContain('Theirs twice. Final.');
  await expect.poll(() => snapshots(ipc.dir, 'a.md').length).toBe(1);
});

test('a clean tab reloads silently when the file changes on disk', async ({ page, ipc }) => {
  const file = ipc.write('a.md', '# Alpha\n\nFirst line.\n');
  ipc.launchFiles = [ipc.dir];
  await openFolderAndFile(page, ipc.dir, file);
  externalWrite(file, '# Alpha\n\nChanged elsewhere.\n');
  // The watcher's event for the open file's folder (the same path a focus check takes).
  await page.evaluate(([p, d]) => (window as any).__mikedownE2eEmit('fs-changed', { kind: 'modify', path: p, dir: d }), [file, ipc.dir]);
  await expect(page.locator('#editor .ProseMirror')).toContainText('Changed elsewhere.');
  expect(await page.evaluate(() => (window as any).mikedownModel.dirty)).toBe(false);
  await expect(page.getByRole('alertdialog')).toHaveCount(0);
});

test('a 3 MB file saves without a snapshot and without a message', async ({ page, ipc }) => {
  const big = '# Big\n\n' + 'x'.repeat(80) + '\n';
  const text = big.repeat(Math.ceil((3 * 1024 * 1024) / big.length));
  const file = ipc.write('big.md', text);
  ipc.launchFiles = [ipc.dir];
  await openFolderAndFile(page, ipc.dir, file);
  await page.evaluate(() => (window as any).mikedownModel.replaceText((window as any).mikedownModel.text + 'edit\n'));
  await expect.poll(() => page.evaluate(() => (window as any).mikedownModel.dirty)).toBe(true);
  await page.evaluate(() => (window as any).mikedownApp.controller.save());
  await expect.poll(() => ipc.calls.filter((c) => c.cmd === 'write_text').length).toBe(1);
  expect(fs.statSync(file).size).toBeGreaterThan(3 * 1024 * 1024);
  expect(ipc.calls.some((c) => c.cmd.startsWith('versions_'))).toBe(false);
  expect(fs.existsSync(path.join(ipc.dir, '.mikedown'))).toBe(false);
  await expect(page.locator('.mdapp-toast--visible')).toHaveCount(0);
  await expect(page.getByRole('alertdialog')).toHaveCount(0);
});
