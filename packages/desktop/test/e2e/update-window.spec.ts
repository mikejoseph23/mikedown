/**
 * U2: the found-notice and the update window in the real page (vite + the
 * Tauri mock), driven through the dev hook `window.mikedownApp.updater`.
 * An axe pass over each, light and dark. Set MIKEDOWN_SHOTS=<dir> to also
 * save screenshots for a look.
 */
import path from 'node:path';
import AxeBuilder from '@axe-core/playwright';
import type { Page } from '@playwright/test';
import { test, expect } from './fixtures';

const INFO = {
  version: '1.0.0',
  currentVersion: '0.1.0',
  notes: '## New\n\n- Update window with release notes\n- Skip This Version and Remind Me Later are remembered\n\n## Fixed\n\n- Links in notes open in your browser. See [the website](https://www.iadev.net/mikedown/).\n- `latest.json` per platform',
  date: null,
};

const shots = process.env.MIKEDOWN_SHOTS;
async function shot(page: Page, name: string): Promise<void> {
  if (shots) {await page.screenshot({ path: path.join(shots, `${name}.png`) });}
}

async function noViolations(page: Page, selector: string): Promise<void> {
  // Let the entrance fade finish, or color-contrast reads a half-faded color.
  await page.waitForTimeout(300);
  const r = await new AxeBuilder({ page }).include(selector).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
  expect(r.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`)).toEqual([]);
}

for (const scheme of ['light', 'dark'] as const) {
  test(`notice, window and progress (${scheme})`, async ({ page, ipc: _ipc }) => {
    await page.emulateMedia({ colorScheme: scheme });
    await page.setViewportSize({ width: 1100, height: 720 });
    await page.goto('/');
    await page.waitForFunction(() => !!(window as any).mikedownApp?.updater);

    await page.evaluate((info) => (window as any).mikedownApp.updater.announce(info), INFO);
    const notice = page.locator('.mdapp-update');
    await expect(notice).toContainText('MikeDown 1.0.0 is available');
    await noViolations(page, '.mdapp-update');
    await shot(page, `${scheme}-notice`);

    await notice.locator('[data-action="view"]').click();
    const sheet = page.locator('.mdapp-updwin');
    await expect(sheet).toHaveAttribute('data-mode', 'offer');
    await expect(sheet).toContainText('This is a major update');
    await expect(page.locator('[data-action="install"]')).toBeFocused();
    await page.waitForTimeout(300);
    await noViolations(page, '.mdapp-updwin');
    await shot(page, `${scheme}-window`);

    await page.evaluate(() => {
      const u = (window as any).mikedownApp.updater;
      u.applyHostState({ state: 'downloading', version: '1.0.0', error: null });
      u.applyProgress({ downloaded: 42, total: 100 });
    });
    await expect(sheet).toHaveAttribute('data-mode', 'progress');
    await expect(sheet).toContainText('Downloading update… 42%');
    await shot(page, `${scheme}-downloading`);

    await page.evaluate(() => (window as any).mikedownApp.updater.applyHostState({ state: 'failed', version: '1.0.0', error: 'x' }));
    await expect(sheet).toContainText("The update couldn't be installed.");
    await noViolations(page, '.mdapp-updwin');
    await shot(page, `${scheme}-failed`);

    await page.keyboard.press('Escape');
    await expect(sheet).toHaveCount(0);
  });
}

test('narrow window: buttons stack', async ({ page, ipc: _ipc }) => {
  await page.setViewportSize({ width: 420, height: 700 });
  await page.goto('/');
  await page.waitForFunction(() => !!(window as any).mikedownApp?.updater);
  await page.evaluate((info) => {
    const app = (window as any).mikedownApp;
    app.updater.announce(info);
    app.updateWindow.open();
  }, { ...INFO, version: '0.2.0', notes: null });
  await expect(page.locator('.mdapp-updwin')).toContainText('No release notes were provided for this version.');
  const box = await page.locator('.mdapp-updwin').boundingBox();
  expect(box!.width).toBeLessThanOrEqual(420);
  await page.waitForTimeout(300);
  await shot(page, 'narrow');
});
