/**
 * M5: the App tab in core's Settings modal, global vs "Save for this folder",
 * the corrupt-file banner, and the theme following the OS (no manual toggle).
 */
import fs from 'node:fs';
import path from 'node:path';
import { test, expect } from './fixtures';

const globalFile = (appData: string): string => path.join(appData, 'settings.json');

/** Core's checkbox rows label the text, not the input: find the input by its row text. */
const check = (scope: import('@playwright/test').Locator, text: string) =>
  scope.locator('.settings-row--check', { hasText: text }).locator('input[type="checkbox"]');

async function openAppTab(page: import('@playwright/test').Page): Promise<import('@playwright/test').Locator> {
  await page.locator('#editor .ProseMirror').first().click();
  await page.keyboard.press('ControlOrMeta+,');
  const modal = page.locator('.settings-modal');
  await expect(modal).toBeVisible();
  await modal.getByRole('tab', { name: 'App', exact: true }).click();
  return modal;
}

test('the App tab is there and Save for this folder is off in a lone-file window', async ({ page, ipc }) => {
  ipc.launchFiles = [ipc.write('a.md', '# A\n\nText.\n')];
  await page.goto('/');
  await expect(page.locator('#editor .ProseMirror')).toContainText('Text.');
  const modal = await openAppTab(page);
  for (const text of ['Versions to keep', 'Automatically check for updates', 'Show hidden files', 'Confirm before delete', 'About MikeDown']) {
    await expect(modal).toContainText(text);
  }
  await expect(modal.getByRole('button', { name: 'Set MikeDown as default for .md' })).toBeVisible();
  await expect(modal.getByRole('button', { name: 'Check Now' })).toBeVisible();
  await expect(check(modal, 'Save for this folder')).toBeDisabled();
});

test('Save for this folder writes only the changed key; other folders and the global file are untouched', async ({ page, ipc }) => {
  const notes = path.join(ipc.dir, 'notes');
  fs.mkdirSync(notes);
  fs.writeFileSync(path.join(notes, 'a.md'), '# A\n\nText.\n');
  ipc.launchFiles = [notes, path.join(notes, 'a.md')];
  await page.goto('/');
  await expect(page.locator('#editor .ProseMirror')).toContainText('Text.');
  expect(fs.existsSync(path.join(notes, '.mikedown'))).toBe(false);

  const modal = await openAppTab(page);
  const folderToggle = check(modal, 'Save for this folder');
  await expect(folderToggle).toBeEnabled();
  await folderToggle.check();
  const keep = modal.locator('.settings-row', { hasText: 'Versions to keep' }).locator('input[type="number"]');
  await expect(keep).toHaveValue('25');
  await keep.fill('10');
  await modal.getByRole('button', { name: /Save to Settings/ }).click();

  const file = path.join(notes, '.mikedown', 'settings.json');
  await expect.poll(() => fs.existsSync(file)).toBe(true);
  expect(JSON.parse(fs.readFileSync(file, 'utf8'))).toEqual({ 'versioning.keep': 10 });
  expect(fs.existsSync(globalFile(ipc.appData))).toBe(false);

  // Reopen: this folder shows 10.
  const again = await openAppTab(page);
  await expect(again.locator('.settings-row', { hasText: 'Versions to keep' }).locator('input[type="number"]')).toHaveValue('10');
});

test('a global change persists to the app-data file and survives a reload', async ({ page, ipc }) => {
  ipc.launchFiles = [ipc.write('a.md', '# A\n\nText.\n')];
  await page.goto('/');
  await expect(page.locator('#editor .ProseMirror')).toContainText('Text.');
  const modal = await openAppTab(page);
  await check(modal, 'Confirm before delete').uncheck();
  const keep = modal.locator('.settings-row', { hasText: 'Versions to keep' }).locator('input[type="number"]');
  await keep.fill('7');
  await modal.getByRole('button', { name: /Save to Settings/ }).click();

  await expect.poll(() => fs.existsSync(globalFile(ipc.appData))).toBe(true);
  const saved = JSON.parse(fs.readFileSync(globalFile(ipc.appData), 'utf8'));
  expect(saved).toMatchObject({ 'versioning.keep': 7, 'tree.confirmDelete': false });

  await page.reload();
  await expect(page.locator('#editor .ProseMirror')).toContainText('Text.');
  const after = await openAppTab(page);
  await expect(after.locator('.settings-row', { hasText: 'Versions to keep' }).locator('input[type="number"]')).toHaveValue('7');
  await expect(check(after, 'Confirm before delete')).not.toBeChecked();
});

test('changing the body font persists globally, applies after a relaunch and without a folder file', async ({ page, ipc }) => {
  ipc.launchFiles = [ipc.write('a.md', '# A\n\nText.\n')];
  await page.goto('/');
  await expect(page.locator('#editor .ProseMirror')).toContainText('Text.');
  await page.locator('#editor .ProseMirror').first().click();
  await page.keyboard.press('ControlOrMeta+,');
  const modal = page.locator('.settings-modal');
  await expect(modal).toBeVisible();
  const before = await page.locator('.mikedown-root').first().evaluate((el) => getComputedStyle(el).getPropertyValue('--mikedown-font-family').trim());
  await modal.locator('.settings-theme-item').nth(2).click();
  await modal.getByRole('button', { name: /Save to Settings/ }).click();
  await expect.poll(() => fs.existsSync(globalFile(ipc.appData))).toBe(true);
  const saved = JSON.parse(fs.readFileSync(globalFile(ipc.appData), 'utf8'));
  expect(saved.fontFamily).toBeTruthy();
  expect(saved.fontFamily).not.toBe(before);

  await page.reload();
  await expect(page.locator('#editor .ProseMirror')).toContainText('Text.');
  await expect.poll(() => page.locator('.mikedown-root').first().evaluate((el) => getComputedStyle(el).getPropertyValue('--mikedown-font-family').trim())).toBe(saved.fontFamily);
});

test('a corrupt settings file loads defaults, shows the banner, and is left untouched until Reset', async ({ page, ipc }) => {
  const corrupt = '{ "fontSize": 20, broken';
  fs.writeFileSync(globalFile(ipc.appData), corrupt);
  ipc.launchFiles = [ipc.write('a.md', '# A\n\nText.\n')];
  await page.goto('/');
  await expect(page.locator('#editor .ProseMirror')).toContainText('Text.');

  const banner = page.locator('.mdapp-banner');
  await expect(banner).toBeVisible();
  await expect(banner).toContainText('could not be read');
  await expect(banner.getByRole('button', { name: 'Open file' })).toBeVisible();
  expect(fs.readFileSync(globalFile(ipc.appData), 'utf8')).toBe(corrupt);

  await banner.getByRole('button', { name: 'Reset to defaults' }).click();
  await expect.poll(() => fs.readFileSync(globalFile(ipc.appData), 'utf8')).toBe('{}\n');
  await expect(banner).toBeHidden();
});

test('there is no manual theme toggle; the chrome follows prefers-color-scheme', async ({ page, ipc }) => {
  ipc.launchFiles = [ipc.write('a.md', '# A\n\nText.\n')];
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.goto('/');
  await expect(page.locator('#editor .ProseMirror')).toContainText('Text.');
  await expect(page.locator('[data-action="themeToggle"]')).toBeHidden();
  const dark = await page.locator('body').evaluate((el) => getComputedStyle(el).backgroundColor);
  await page.emulateMedia({ colorScheme: 'light' });
  const light = await page.locator('body').evaluate((el) => getComputedStyle(el).backgroundColor);
  expect(dark).not.toBe(light);
});
