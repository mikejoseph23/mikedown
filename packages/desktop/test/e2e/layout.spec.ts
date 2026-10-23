/**
 * P1 polish: the content column is capped and centered by default, the user
 * can still pick Full Width, and Open Containing Folder is a real,
 * labelled, focusable button. Set P1_SHOTS=<dir> to also save light and dark
 * screenshots of a wide window.
 */
import { test, expect } from './fixtures';

const SHOTS = process.env.P1_SHOTS;

test('content width defaults to a centered 900px column and Full Width still applies', async ({ page, ipc }) => {
  ipc.launchFiles = [ipc.write('a.md', '# A\n\n| x | y |\n| - | - |\n| 1 | 2 |\n\nSome text.\n')];
  await page.setViewportSize({ width: 1700, height: 900 });
  await page.goto('/');
  const pm = page.locator('#editor .ProseMirror');
  await expect(pm).toContainText('Some text.');

  const box = await pm.boundingBox();
  expect(box!.width).toBeLessThanOrEqual(900);
  // Centered: equal gutters either side within a few px.
  const left = box!.x;
  const right = 1700 - (box!.x + box!.width);
  expect(Math.abs(left - right)).toBeLessThan(40);

  await page.keyboard.press('ControlOrMeta+,');
  const width = page.locator('.settings-modal select').filter({ has: page.locator('option[value="100%"]') });
  await expect(width).toHaveValue('900px');
  await width.selectOption('100%');
  await page.locator('.settings-btn--primary').click();
  expect((await pm.boundingBox())!.width).toBeGreaterThan(1200);
});

test('Open Containing Folder is a labelled, focusable button in light and dark', async ({ page, ipc }) => {
  ipc.launchFiles = [ipc.write('a.md', '# Notes\n\n| Cell | Value |\n| - | - |\n| a | 1 |\n\nA paragraph of text that would otherwise run the full width of a wide window.\n')];
  await page.setViewportSize({ width: 1600, height: 800 });
  for (const scheme of ['light', 'dark'] as const) {
    await page.emulateMedia({ colorScheme: scheme });
    await page.goto('/');
    await expect(page.locator('#editor .ProseMirror')).toContainText('A paragraph');
    const btn = page.getByRole('button', { name: 'Open Containing Folder' });
    await expect(btn).toBeEnabled();
    const bg = await btn.evaluate((el) => getComputedStyle(el).backgroundColor);
    expect(bg, 'button has a visible resting fill').not.toMatch(/rgba\(0, 0, 0, 0\)|transparent/);
    await btn.focus();
    const outline = await btn.evaluate((el) => getComputedStyle(el).outlineStyle);
    expect(outline).toBe('solid');
    if (SHOTS) {
      await btn.hover();
      await page.screenshot({ path: `${SHOTS}/p1-${scheme}.png` });
      await page.locator('.mdapp-top').screenshot({ path: `${SHOTS}/p1-${scheme}-tabstrip.png` });
    }
  }
});
