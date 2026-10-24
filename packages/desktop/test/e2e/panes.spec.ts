/**
 * M4 tabs and panes: a folder with two notes, both open as tabs, Cmd/Ctrl+\
 * splits the pane and the same file shows in both; typing in one pane lands
 * in the other, the dirty dot shows on both tabs, Cmd/Ctrl+W asks about
 * unsaved changes and Cancel keeps the tab, tabs cycle with Ctrl+Tab, the
 * tab strip is an ARIA tablist, and the session file records the layout.
 */
import fs from 'node:fs';
import path from 'node:path';
import { test, expect } from './fixtures';

test('tabs, split panes, propagation, dirty dots, close prompt, session', async ({ page, ipc }) => {
  fs.writeFileSync(path.join(ipc.dir, 'a.md'), '# Alpha\n\nAlpha body.\n');
  fs.writeFileSync(path.join(ipc.dir, 'b.md'), '# Beta\n\nBeta body.\n');
  ipc.launchFiles = [ipc.dir];
  await page.setViewportSize({ width: 1400, height: 800 });
  await page.goto('/');

  const tree = page.getByRole('tree', { name: 'Files' });
  await tree.getByRole('treeitem', { name: 'a.md', exact: true }).click();
  await tree.getByRole('treeitem', { name: 'b.md', exact: true }).click();

  // Two tabs in one pane, b.md active, ARIA roles in place.
  const strip = page.getByRole('tablist', { name: 'Open documents' });
  await expect(strip).toHaveCount(1);
  const tabs = strip.getByRole('tab');
  const names = strip.locator('.mdapp-tab__name');
  await expect(names).toHaveText(['a.md', 'b.md']);
  await expect(tabs.nth(1)).toHaveAttribute('aria-selected', 'true');
  await expect(page.locator('.mdapp-pane--focused .ProseMirror')).toContainText('Beta body.');

  // Ctrl+Tab cycles (on macOS too; Cmd+Tab is the app switcher).
  await page.locator('.mdapp-pane--focused .ProseMirror').click();
  await page.keyboard.press('Control+Tab');
  await expect(tabs.nth(0)).toHaveAttribute('aria-selected', 'true');
  await expect(page.locator('.mdapp-pane--focused .ProseMirror')).toContainText('Alpha body.');

  // Split right: a second pane showing the same document.
  await page.keyboard.press('ControlOrMeta+\\');
  const panes = page.locator('.mdapp-pane');
  await expect(panes).toHaveCount(2);
  const strips = page.getByRole('tablist', { name: 'Open documents' });
  await expect(strips.nth(1).locator('.mdapp-tab__name')).toHaveText(['a.md']);
  await expect(panes.nth(1)).toHaveClass(/mdapp-pane--focused/);
  await expect(panes.nth(1).locator('.ProseMirror')).toContainText('Alpha body.');

  // Type in the second pane: the first pane follows, both tabs show the dot.
  await panes.nth(1).locator('.ProseMirror').getByText('Alpha body.').click();
  await page.keyboard.press('End');
  await page.keyboard.type(' Typed in pane two.');
  await expect(panes.nth(0).locator('.ProseMirror')).toContainText('Alpha body. Typed in pane two.');
  await expect(strips.nth(0).getByRole('tab', { name: /a\.md/ })).toHaveClass(/mdapp-tab--dirty/);
  await expect(strips.nth(1).getByRole('tab', { name: /a\.md/ })).toHaveClass(/mdapp-tab--dirty/);
  expect(await page.evaluate(() => (window as any).mikedownModel.dirty)).toBe(true);
  const docs = await page.evaluate(() => (window as any).mikedownApp.docs());
  expect(docs.filter((d: any) => d.dirty).map((d: any) => path.basename(d.path))).toEqual(['a.md']);

  // Edit in the first pane, see it in the second.
  await panes.nth(0).locator('.ProseMirror').getByText('Typed in pane two.').click();
  await page.keyboard.press('End');
  await page.keyboard.type(' And one.');
  await expect(panes.nth(1).locator('.ProseMirror')).toContainText('Typed in pane two. And one.');

  // The session records the split and both tabs.
  await expect.poll(() => ipc.session() as any, { timeout: 5000 }).toMatchObject({ version: 1, folder: ipc.dir });
  const session = ipc.session() as any;
  expect(session.layout.kind).toBe('split');
  expect(session.layout.direction).toBe('row');
  expect(session.layout.children.map((c: any) => c.tabs.map((t: any) => path.basename(t.path)))).toEqual([['a.md', 'b.md'], ['a.md']]);

  // Close the second pane's only tab: the document is still shown in pane one, so no prompt.
  await panes.nth(1).locator('.ProseMirror').click();
  await page.keyboard.press('ControlOrMeta+w');
  await expect(panes).toHaveCount(1);
  await expect(page.locator('.mdapp-modal')).toHaveCount(0);

  // Cmd+W on the dirty tab asks; Cancel keeps it.
  await page.locator('.mdapp-pane--focused .ProseMirror').click();
  await page.keyboard.press('ControlOrMeta+w');
  const dialog = page.getByRole('alertdialog');
  await expect(dialog).toContainText('Save changes to “a.md” before closing?');
  await dialog.getByRole('button', { name: 'Cancel' }).click();
  await expect(names).toHaveText(['a.md', 'b.md']);

  // Don't Save closes it and removes its backup.
  await expect.poll(() => Object.keys(ipc.backupIndex()).length).toBe(1);
  await page.keyboard.press('ControlOrMeta+w');
  await page.getByRole('alertdialog').getByRole('button', { name: 'Don’t Save' }).click();
  await expect(names).toHaveText(['b.md']);
  await expect.poll(() => Object.keys(ipc.backupIndex()).length).toBe(0);
  expect(fs.readFileSync(path.join(ipc.dir, 'a.md'), 'utf8')).toBe('# Alpha\n\nAlpha body.\n');

  // Middle click closes the last tab; the pane stays, empty.
  await tabs.nth(0).click({ button: 'middle' });
  await expect(tabs).toHaveCount(0);
  await expect(panes).toHaveCount(1);
});

test('large files open in source mode with an "Open as rich text anyway" bar (edge 12)', async ({ page, ipc }) => {
  const big = '# Big\n\n' + 'A line of text that pads the file out.\n'.repeat(60_000);
  expect(big.length).toBeGreaterThan(2 * 1024 * 1024);
  ipc.launchFiles = [ipc.write('big.md', big)];
  await page.goto('/');
  const notice = page.locator('.mdapp-pane__notice');
  await expect(notice).toContainText('Large file');
  await expect(page.locator('.cm-editor')).toBeVisible();
  expect(await page.evaluate(() => (window as any).mikedown.getViewState().sourceMode)).toBe(true);
  await notice.getByRole('button', { name: 'Open as rich text anyway' }).click();
  await expect(notice).toBeHidden();
  await expect.poll(() => page.evaluate(() => (window as any).mikedown.getViewState().sourceMode)).toBe(false);
});

test('the status bar word count follows the focused pane and the active tab', async ({ page, ipc }) => {
  fs.writeFileSync(path.join(ipc.dir, 'one.md'), 'One.\n');
  fs.writeFileSync(path.join(ipc.dir, 'three.md'), 'One two three.\n');
  ipc.launchFiles = [ipc.dir];
  await page.setViewportSize({ width: 1400, height: 800 });
  await page.goto('/');
  const tree = page.getByRole('tree', { name: 'Files' });
  const words = page.locator('.mdapp-status__words');

  await tree.getByRole('treeitem', { name: 'one.md', exact: true }).click();
  await expect(words).toHaveText(/^1 word\b/);
  await tree.getByRole('treeitem', { name: 'three.md', exact: true }).click();
  await expect(words).toHaveText(/^3 words\b/);

  // Tab switch within a pane.
  const strip = page.getByRole('tablist', { name: 'Open documents' });
  await strip.getByRole('tab', { name: /one\.md/ }).click();
  await expect(words).toHaveText(/^1 word\b/);

  // Split: the new pane shows one.md; open three.md there, then move focus back and forth.
  await page.locator('.mdapp-pane--focused .ProseMirror').click();
  await page.keyboard.press('ControlOrMeta+\\');
  const panes = page.locator('.mdapp-pane');
  await expect(panes).toHaveCount(2);
  await tree.getByRole('treeitem', { name: 'three.md', exact: true }).click();
  await expect(panes.nth(1).locator('.ProseMirror')).toContainText('One two three.');
  await expect(words).toHaveText(/^3 words\b/);

  await panes.nth(0).locator('.ProseMirror').click();
  await expect(words).toHaveText(/^1 word\b/);
  await panes.nth(1).locator('.ProseMirror').click();
  await expect(words).toHaveText(/^3 words\b/);
  // A selection in one pane does not wipe its count for the next focus change.
  await page.keyboard.press('ControlOrMeta+a');
  await panes.nth(0).locator('.ProseMirror').click();
  await expect(words).toHaveText(/^1 word\b/);
  await panes.nth(1).getByRole('tab', { name: /three\.md/ }).click();
  await expect(words).toHaveText(/^3 words\b/);
});
