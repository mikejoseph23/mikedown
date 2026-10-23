/**
 * The app chrome (tab strip, status footer) follows the OS appearance with
 * the editor. Regression: T1 found the tab strip, status footer and page
 * background stuck light in dark mode because core's tokens only apply under
 * [data-mikedown-theme]; transparent elements are judged by what shows through.
 */
import { test, expect } from './fixtures';

/** The colour actually painted behind `el`: its own background, else the nearest ancestor's. */
const bg = (_label: string) => (el: Element) => {
  for (let n: Element | null = el; n; n = n.parentElement) {
    const c = getComputedStyle(n).backgroundColor;
    if (c && c !== 'transparent' && !/rgba\(.*,\s*0\)$/.test(c)) {return c;}
  }
  return 'rgb(255, 255, 255)';
};

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
  const darkBody = await page.locator('body').evaluate(bg('body'));
  expect(darkTop).not.toBe(lightTop);
  expect(darkTab).not.toBe(lightTab);
  for (const c of [darkTop, darkTab, darkStatus, darkBody]) {
    const [r, g, b] = (c.match(/\d+/g) ?? ['255', '255', '255']).map(Number);
    expect(r + g + b, `${c} should be dark`).toBeLessThan(200);
  }
});
