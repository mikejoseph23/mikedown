/**
 * Core's document sidebar (Outline / Backlinks / Properties) on the right of
 * each pane: the toggle (button, Cmd/Ctrl+Alt+B, View > Toggle Outline), the
 * outline's headings and jump, folder backlinks that open in a tab, the
 * Properties section, one sidebar per split pane, a lone-file window without
 * Backlinks, and the pin and section state persisted in settings.json.
 * Set OUTLINE_SHOTS=<dir> to save light, dark and split screenshots.
 */
import fs from 'node:fs';
import path from 'node:path';
import { test, expect } from './fixtures';

const SHOTS = process.env.OUTLINE_SHOTS;

const B_MD = [
  '---',
  'title: Beta note',
  'status: draft',
  '---',
  '',
  '# Beta',
  '',
  ...Array.from({ length: 40 }, (_, i) => `Intro line ${i + 1}.\n`),
  '## Details',
  '',
  ...Array.from({ length: 40 }, (_, i) => `Detail line ${i + 1}.\n`),
  '## Wrap up',
  '',
  'The end.',
  '',
].join('\n');

const emitMenu = (page: import('@playwright/test').Page, id: string) =>
  page.evaluate((cmd) => (window as unknown as { __mikedownE2eEmit: (e: string, p: unknown) => void }).__mikedownE2eEmit('mikedown:menu', cmd), id);

function writeFolder(dir: string): void {
  fs.mkdirSync(path.join(dir, 'notes'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'a.md'), '# Alpha\n\nSee [the beta note](notes/b.md) for more.\n');
  fs.writeFileSync(path.join(dir, 'c.md'), '# Gamma\n\nAlso [[b]] here.\n\n```\n[not a link](notes/b.md)\n```\n');
  fs.writeFileSync(path.join(dir, 'notes', 'b.md'), B_MD);
}

test('toggle, outline, backlinks, properties and persisted pin', async ({ page, ipc }) => {
  writeFolder(ipc.dir);
  ipc.launchFiles = [ipc.dir];
  await page.setViewportSize({ width: 1300, height: 800 });
  await page.goto('/');

  const tree = page.getByRole('tree', { name: 'Files' });
  await tree.getByRole('treeitem', { name: 'notes', exact: true }).click();
  await tree.getByRole('treeitem', { name: 'b.md', exact: true }).click();
  await expect(page.locator('#editor .ProseMirror')).toContainText('The end.');

  const sidebar = page.locator('.mikedown-outline-sidebar');
  const toggle = page.locator('.mikedown-outline-toggle');
  // Off by default; the left file tree is untouched.
  await expect(sidebar).toBeHidden();
  await expect(tree).toBeVisible();
  await expect(toggle).toBeVisible();

  // The show button opens it on the right of the pane.
  await toggle.click();
  await expect(sidebar).toBeVisible();
  const paneBox = (await page.locator('.mdapp-pane').boundingBox())!;
  const sideBox = (await sidebar.boundingBox())!;
  expect(Math.round(sideBox.x + sideBox.width)).toBe(Math.round(paneBox.x + paneBox.width));

  // Outline: the headings, click jumps.
  const items = sidebar.locator('.outline-item');
  await expect(items).toHaveText(['Beta', 'Details', 'Wrap up']);
  await items.filter({ hasText: 'Details' }).click();
  await expect(page.locator('#editor h2', { hasText: 'Details' })).toBeInViewport();
  // The scroll spy follows: Details is the active heading.
  await expect(items.filter({ hasText: 'Details' })).toHaveClass(/active/);
  await expect(items.filter({ hasText: 'Beta' })).not.toHaveClass(/active/);

  // Backlinks: a markdown link and a wikilink; the fenced one does not count.
  const backlinks = sidebar.locator('.backlinks-section');
  await expect(backlinks).toBeVisible();
  await expect(backlinks.locator('.backlinks-item')).toHaveText(['a.md', 'c.md']);

  // Properties: the frontmatter keys.
  const props = sidebar.locator('.properties-section');
  await expect(props).toContainText('title');
  await expect(props).toContainText('Beta note');
  await expect(props).toContainText('status');

  // No horizontal scroll introduced.
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);

  if (SHOTS) {
    for (const scheme of ['light', 'dark'] as const) {
      await page.emulateMedia({ colorScheme: scheme });
      await page.screenshot({ path: `${SHOTS}/outline-${scheme}.png` });
    }
    await page.emulateMedia({ colorScheme: 'light' });
  }

  // View > Toggle Outline and Cmd/Ctrl+Alt+B flip it. (Menu first: a menu
  // event right after the same chord is dropped as its echo.)
  await page.locator('#editor .ProseMirror').click();
  await emitMenu(page, 'toggleOutline');
  await expect(sidebar).toBeHidden();
  await page.keyboard.press('ControlOrMeta+Alt+KeyB');
  await expect(sidebar).toBeVisible();

  // Collapsing a section and pinning persist in the global settings file.
  await props.locator('.sidebar-section-header').click();
  await expect(props).toHaveClass(/collapsed/);
  await sidebar.locator('.outline-pin').click();
  const settingsFile = path.join(ipc.appData, 'settings.json');
  await expect.poll(() => {
    try { return JSON.parse(fs.readFileSync(settingsFile, 'utf8')); } catch { return null; }
  }).toMatchObject({ 'outline.visibility': 'always', 'outline.sectionPrefs': { properties: true } });

  // A backlink opens its file in a tab.
  await backlinks.locator('.backlinks-item', { hasText: 'a.md' }).click();
  await expect(page.locator('.mdapp-tab__name')).toContainText(['b.md', 'a.md']);
  await expect(page.locator('#editor .ProseMirror')).toContainText('See the beta note for more.');

  // Relaunch: the pin opens the sidebar, the section stays collapsed.
  await page.reload();
  await expect(page.locator('#editor .ProseMirror')).toBeVisible();
  await expect(page.locator('.mikedown-outline-sidebar')).toBeVisible();
  await expect(page.locator('.mikedown-outline-sidebar .properties-section')).toHaveClass(/collapsed/);
});

test('each split pane has its own sidebar; narrow panes stay usable', async ({ page, ipc }) => {
  writeFolder(ipc.dir);
  ipc.launchFiles = [ipc.dir];
  await page.setViewportSize({ width: 1100, height: 700 });
  await page.goto('/');
  const tree = page.getByRole('tree', { name: 'Files' });
  await tree.getByRole('treeitem', { name: 'a.md', exact: true }).click();
  await expect(page.locator('#editor .ProseMirror')).toContainText('See the beta note');

  await page.keyboard.press('ControlOrMeta+\\');
  const panes = page.locator('.mdapp-pane');
  await expect(panes).toHaveCount(2);
  await tree.getByRole('treeitem', { name: 'c.md', exact: true }).click();

  await panes.nth(0).locator('.mikedown-outline-toggle').click();
  await expect(panes.nth(0).locator('.mikedown-outline-sidebar')).toBeVisible();
  await expect(panes.nth(1).locator('.mikedown-outline-sidebar')).toBeHidden();
  await expect(panes.nth(0).locator('.outline-item')).toHaveText(['Alpha']);

  await panes.nth(1).locator('.mikedown-outline-toggle').click();
  await expect(panes.nth(1).locator('.outline-item')).toHaveText(['Gamma']);
  // A narrow pane gets the slim sidebar; the editor column keeps room next to it.
  expect((await panes.nth(1).locator('.mikedown-outline-sidebar').boundingBox())!.width).toBe(160);
  const editorBox = (await panes.nth(1).locator('.mikedown-editor-container').boundingBox())!;
  expect(editorBox.width).toBeGreaterThan(150);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);

  if (SHOTS) {await page.screenshot({ path: `${SHOTS}/outline-split.png` });}
});

test('a lone-file window shows Outline and Properties but no Backlinks', async ({ page, ipc }) => {
  ipc.launchFiles = [ipc.write('solo.md', '---\ntags: x\n---\n\n# Solo\n\n## Part\n')];
  await page.goto('/');
  await expect(page.locator('#editor .ProseMirror')).toContainText('Part');
  await page.locator('.mikedown-outline-toggle').click();
  const sidebar = page.locator('.mikedown-outline-sidebar');
  await expect(sidebar.locator('.outline-item')).toHaveText(['Solo', 'Part']);
  await expect(sidebar.locator('.backlinks-section')).toBeHidden();
  await expect(sidebar.locator('.properties-section')).toBeVisible();
});
