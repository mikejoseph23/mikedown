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
  const lightTop = await page.locator('.mdapp-pane__strip').evaluate(bg('top'));
  const lightTab = await page.locator('.mdapp-tab').evaluate(bg('tab'));

  await page.emulateMedia({ colorScheme: 'dark' });
  const darkTop = await page.locator('.mdapp-pane__strip').evaluate(bg('top'));
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

test('dark code blocks are one surface, not a band per line', async ({ page, ipc }) => {
  ipc.launchFiles = [ipc.write('c.md', '# C\n\nUse `inline` here.\n\n```js\nconst a = 1;\nconst b = 2;\n```\n')];
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.goto('/');
  const pre = page.locator('#editor .ProseMirror pre');
  await expect(pre).toContainText('const b = 2;');
  const paint = (el: Element) => getComputedStyle(el).backgroundColor;
  // The block paints its background once; the <code> inside adds nothing on top
  // (a translucent dark token stacked per line read as stripes).
  expect(await pre.locator('code').evaluate(paint)).toBe('rgba(0, 0, 0, 0)');
  expect(await pre.evaluate(paint)).not.toBe('rgba(0, 0, 0, 0)');
  // Inline code outside a block keeps its chip.
  expect(await page.locator('#editor .ProseMirror p code').evaluate(paint)).not.toBe('rgba(0, 0, 0, 0)');
});
