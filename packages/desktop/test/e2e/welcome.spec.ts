/**
 * M8: first run opens the welcome guide and offers the default-app setting
 * once; later launches show the welcome screen with the recents; removing a
 * recent entry survives a relaunch; Cmd/Ctrl+, opens Settings; the native
 * menu gets its spec, its recents and routes commands back.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test, expect, type Ipc } from './fixtures';

const here = path.dirname(fileURLToPath(import.meta.url));
const bundledWelcome = path.resolve(here, '..', '..', 'src-tauri', 'resources', 'welcome.md');

/** `welcome_file` as Rust answers it: a copy of the bundled guide in app data. */
function provideWelcome(ipc: Ipc): string {
  const target = path.join(ipc.appData, 'Welcome to MikeDown.md');
  ipc.custom.welcome_file = () => {
    if (!fs.existsSync(target)) {fs.copyFileSync(bundledWelcome, target);}
    return target;
  };
  return target;
}

const recentsFile = (ipc: Ipc) => path.join(ipc.appData, 'recents.json');
const readRecents = (ipc: Ipc) => JSON.parse(fs.readFileSync(recentsFile(ipc), 'utf8'));
const titles = (ipc: Ipc) => ipc.calls.filter((c) => c.cmd === 'plugin:window|set_title').map((c) => (c.args as { value: string }).value);

async function relaunch(page: import('@playwright/test').Page): Promise<void> {
  await page.goto('about:blank');
  await page.goto('/');
}

test('first launch opens the welcome guide and offers the default app once; the next launch shows the welcome screen with one recent file', async ({ page, ipc }) => {
  const guide = provideWelcome(ipc);
  await page.goto('/');

  // The guide opens as a lone file, and the offer appears once.
  await expect(page.locator('#editor .ProseMirror')).toContainText('Welcome to MikeDown');
  await expect(page.getByRole('tab', { name: /Welcome to MikeDown\.md/ })).toBeVisible();
  const offer = page.getByRole('alertdialog');
  await expect(offer).toContainText('Open .md files with MikeDown?');
  await offer.getByRole('button', { name: 'Not Now' }).click();
  await expect.poll(() => {
    try { return JSON.parse(fs.readFileSync(path.join(ipc.appData, 'settings.json'), 'utf8')).fileAssociationsOffered; } catch { return undefined; }
  }).toBe(true);
  await expect.poll(() => readRecents(ipc).files.map((f: { path: string }) => f.path)).toEqual([guide]);
  expect(readRecents(ipc).firstRunDone).toBe(true);
  await expect.poll(() => titles(ipc).at(-1)).toBe('Welcome to MikeDown.md');

  // Closing the last tab of a lone-file window shows the welcome screen.
  await page.locator('#editor .ProseMirror').first().click();
  await page.keyboard.press('ControlOrMeta+w');
  const welcome = page.locator('.mdapp-welcome');
  await expect(welcome).toBeVisible();
  await expect.poll(() => titles(ipc).at(-1)).toBe('MikeDown');

  // Second launch: the welcome screen, one recent file, no offer.
  await relaunch(page);
  await expect(welcome).toBeVisible();
  await expect(welcome.locator('[data-kind="file"] .mdapp-welcome__item')).toHaveCount(1);
  await expect(welcome.locator('[data-kind="file"] .mdapp-welcome__name')).toHaveText('Welcome to MikeDown.md');
  await expect(welcome.locator('[data-kind="folder"] .mdapp-welcome__empty')).toBeVisible();
  await expect(welcome).toContainText('Open a folder to browse your notes');
  await expect(page.getByRole('alertdialog')).toHaveCount(0);
  await expect(page.locator('#editor')).toBeHidden();

  // A recent file opens from the list; the welcome screen goes away.
  await welcome.locator('[data-kind="file"] .mdapp-welcome__open').click();
  await expect(page.locator('#editor .ProseMirror')).toContainText('Welcome to MikeDown');
  await expect(welcome).toBeHidden();
});

test('a missing recent is greyed; removing an entry survives a relaunch; New File leaves the welcome screen', async ({ page, ipc }) => {
  const kept = ipc.write('kept.md', '# Kept\n');
  const gone = path.join(ipc.dir, 'gone.md');
  fs.mkdirSync(ipc.appData, { recursive: true });
  fs.writeFileSync(recentsFile(ipc), JSON.stringify({
    version: 1,
    firstRunDone: true,
    folders: [{ path: ipc.dir, missingCount: 0, lastOpened: 3 }],
    files: [{ path: kept, missingCount: 0, lastOpened: 2 }, { path: gone, missingCount: 0, lastOpened: 1 }],
  }));
  await page.goto('/');
  const welcome = page.locator('.mdapp-welcome');
  await expect(welcome).toBeVisible();
  const files = welcome.locator('[data-kind="file"] .mdapp-welcome__item');
  await expect(files).toHaveCount(2);
  const goneRow = files.filter({ hasText: 'gone.md' });
  await expect(goneRow).toHaveClass(/is-missing/);
  await expect(goneRow.locator('.mdapp-welcome__open')).toBeDisabled();
  // The launch counted one missing launch.
  await expect.poll(() => readRecents(ipc).files.find((f: { path: string }) => f.path === gone)?.missingCount).toBe(1);

  // Remove the kept file's entry with its ×, then relaunch: still gone.
  await files.filter({ hasText: 'kept.md' }).hover();
  await files.filter({ hasText: 'kept.md' }).getByRole('button', { name: /Remove kept\.md/ }).click();
  await expect(files).toHaveCount(1);
  await relaunch(page);
  await expect(welcome).toBeVisible();
  await expect(welcome.locator('[data-kind="file"] .mdapp-welcome__name')).toHaveText(['gone.md']);
  expect(readRecents(ipc).files.map((f: { path: string }) => f.path)).toEqual([gone]);

  // Third launch prunes the missing entry (missing on launches 1, 2, 3).
  await relaunch(page);
  await expect(welcome).toBeVisible();
  await expect.poll(() => readRecents(ipc).files).toEqual([]);

  // New File replaces the welcome screen with an Untitled tab.
  await welcome.getByRole('button', { name: /New File/ }).click();
  await expect(welcome).toBeHidden();
  await expect(page.getByRole('tab', { name: /Untitled/ })).toBeVisible();
});

test('Cmd/Ctrl+, opens Settings from the welcome screen and from a document', async ({ page, ipc }) => {
  fs.mkdirSync(ipc.appData, { recursive: true });
  fs.writeFileSync(recentsFile(ipc), JSON.stringify({ version: 1, firstRunDone: true, folders: [], files: [] }));
  await page.goto('/');
  await expect(page.locator('.mdapp-welcome')).toBeVisible();
  await page.keyboard.press('ControlOrMeta+,');
  const modal = page.locator('.settings-modal');
  await expect(modal).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(modal).toBeHidden();

  await page.getByRole('button', { name: /New File/ }).click();
  await page.locator('#editor .ProseMirror').first().click();
  await page.keyboard.press('ControlOrMeta+,');
  await expect(modal).toBeVisible();
});

test('the native menu gets the spec and the recents, and its clicks run commands', async ({ page, ipc }) => {
  const file = ipc.write('menu.md', 'Hello\n');
  ipc.launchFiles = [file];
  await page.goto('/');
  await expect(page.locator('#editor .ProseMirror')).toContainText('Hello');

  const spec = ipc.calls.find((c) => c.cmd === 'menu_set')?.args as { spec: Array<{ label: string }> } | undefined;
  expect(spec?.spec.map((m) => m.label)).toContain('Format');
  await expect.poll(() => {
    const last = ipc.calls.filter((c) => c.cmd === 'menu_set_recents').at(-1)?.args as { items: Array<{ id?: string }> } | undefined;
    return last?.items.map((i) => i.id).filter(Boolean);
  }).toEqual([`recent-file:${file}`, 'clearRecents']);
  // The focused window reports enablement: Save All is off until a document is dirty.
  await page.locator('#editor .ProseMirror').first().click();
  await expect.poll(() => (ipc.calls.filter((c) => c.cmd === 'menu_update').at(-1)?.args as { enabled: Record<string, boolean> } | undefined)?.enabled.saveAll).toBe(false);

  // Format > Heading > Heading 2 from the menu.
  await page.evaluate(() => (window as unknown as { __mikedownE2eEmit: (e: string, p: unknown) => void }).__mikedownE2eEmit('mikedown:menu', 'heading2'));
  await expect(page.locator('#editor .ProseMirror h2')).toHaveText('Hello');
  await expect.poll(() => (ipc.calls.filter((c) => c.cmd === 'menu_update').at(-1)?.args as { enabled: Record<string, boolean> } | undefined)?.enabled.saveAll).toBe(true);

  // Help > Keyboard Shortcuts lists the table.
  await page.evaluate(() => (window as unknown as { __mikedownE2eEmit: (e: string, p: unknown) => void }).__mikedownE2eEmit('mikedown:menu', 'keyboardShortcuts'));
  const sheet = page.getByRole('dialog', { name: 'Keyboard Shortcuts' });
  await expect(sheet).toContainText('Save As');
  await sheet.getByRole('button', { name: 'Close' }).click();

  // Strikethrough moved to Cmd/Ctrl+Shift+X; Cmd/Ctrl+Shift+S stays Save As (no strike).
  await page.locator('#editor .ProseMirror h2').click();
  await page.keyboard.press('ControlOrMeta+a');
  await page.keyboard.press('ControlOrMeta+Shift+x');
  await expect(page.locator('#editor .ProseMirror h2 s')).toHaveText('Hello');
});
