/**
 * Launch → open fixture → type → save → reload → content persisted.
 * The fixture is CRLF with a BOM so the save path's byte preservation is
 * checked on real disk too.
 */
import { test, expect } from './fixtures';

const FIXTURE = '﻿# E2E fixture\r\n\r\nFirst paragraph.\r\n\r\n- one\r\n- two\r\n';

test('open, type, save, reload: the edit is on disk and back in the editor', async ({ page, ipc }) => {
  const file = ipc.write('e2e.md', FIXTURE);
  ipc.launchFiles = [file];

  await page.goto('/');
  const editor = page.locator('#editor .ProseMirror');
  await expect(editor).toContainText('First paragraph.');
  await expect.poll(() => page.evaluate(() => (window as any).mikedownModel?.path)).toBe(file);
  expect(await page.evaluate(() => (window as any).mikedownModel.dirty)).toBe(false);

  // Type at the end of the first paragraph.
  await editor.getByText('First paragraph.').click();
  await page.keyboard.press('End');
  await page.keyboard.type(' Typed by Playwright.');
  await expect.poll(() => page.evaluate(() => (window as any).mikedownModel.dirty)).toBe(true);

  await page.keyboard.press('ControlOrMeta+s');
  await expect.poll(() => ipc.calls.filter((c) => c.cmd === 'write_text').length).toBe(1);
  await expect.poll(() => page.evaluate(() => (window as any).mikedownModel.dirty)).toBe(false);

  const onDisk = ipc.read('e2e.md');
  expect(onDisk.subarray(0, 3)).toEqual(Buffer.from([0xef, 0xbb, 0xbf]));
  const text = onDisk.subarray(3).toString('utf8');
  expect(text).toContain('First paragraph. Typed by Playwright.\r\n');
  expect(text.replace(/\r\n/g, '')).not.toContain('\n');

  // Reload: the launch queue hands the same file back, as a relaunch would.
  ipc.calls.length = 0;
  await page.reload();
  await expect(editor).toContainText('First paragraph. Typed by Playwright.');
  await expect.poll(() => page.evaluate(() => (window as any).mikedownModel?.path)).toBe(file);
  expect(await page.evaluate(() => (window as any).mikedownModel.dirty)).toBe(false);
  expect(ipc.calls.some((c) => c.cmd === 'read_text')).toBe(true);
  expect(ipc.calls.some((c) => c.cmd === 'write_text')).toBe(false);
});
