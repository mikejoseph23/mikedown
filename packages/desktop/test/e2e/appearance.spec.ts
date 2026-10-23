/**
 * The app chrome (tab strip, status footer) follows the OS appearance with
 * the editor. Regression: T1 found the chrome stuck light in dark mode
 * because core's tokens only apply under [data-mikedown-theme].
 */
import { test, expect } from './fixtures';

const bg = (sel: string) => (el: Element) => getComputedStyle(el).backgroundColor;

test('dark OS appearance recolors the chrome as well as the editor', async ({ page, ipc }) => {
  ipc.launchFiles = [ipc.write('a.md', '# A\n\nText.\n')];
  await page.emulateMedia({ colorScheme: 'light' });
  await page.goto('/');
  await expect(page.locator('#editor .ProseMirror')).toContainText('Text.');
  const lightTop = await page.locator('.mdapp-top').evaluate(bg('top'));
  const lightTab = await page.locator('.mdapp-tab').evaluate(bg('tab'));

  await page.emulateMedia({ colorScheme: 'dark' });
  const darkTop = await page.locator('.mdapp-top').evaluate(bg('top'));
  const darkTab = await page.locator('.mdapp-tab').evaluate(bg('tab'));
  const darkStatus = await page.locator('.mdapp-status').evaluate(bg('status'));
  expect(darkTop).not.toBe(lightTop);
  expect(darkTab).not.toBe(lightTab);
  for (const c of [darkTop, darkTab, darkStatus]) {
    const [r, g, b] = (c.match(/\d+/g) ?? ['255', '255', '255']).map(Number);
    expect(r + g + b, `${c} should be dark`).toBeLessThan(200);
  }
});
