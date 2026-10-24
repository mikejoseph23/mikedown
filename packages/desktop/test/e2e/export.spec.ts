/**
 * M9: File > Export > HTML… against `vite dev` with the mocked Tauri layer.
 * The native save dialog is answered from the test (a wrapper around the
 * mock's `invoke`), the menu click is the `mikedown:menu` event Rust sends.
 * The exported file is then opened in a second page with every network request
 * aborted, which is the "opens offline" acceptance check: image, KaTeX and
 * code highlighting must all come from the file itself.
 */
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { test, expect } from './fixtures';

const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);

test('Export as HTML writes a standalone file that renders offline', async ({ page, context, ipc }) => {
  ipc.write('pic.png', PNG);
  const doc = ipc.write(
    'doc.md',
    '# Export Me\n\nInline math $x^2$ and ![pic](pic.png)\n\n```ts\nconst a: number = 1;\n```\n\n> [!NOTE]\n> A callout.\n',
  );
  ipc.launchFiles = [doc];
  const target = path.join(ipc.dir, 'out.html');

  await page.addInitScript((savePath: string) => {
    const internals = (window as any).__TAURI_INTERNALS__;
    const original = internals.invoke;
    internals.invoke = (cmd: string, ...rest: unknown[]) =>
      cmd === 'plugin:dialog|save' ? Promise.resolve(savePath) : original(cmd, ...rest);
  }, target);

  await page.goto('/');
  await expect(page.locator('#editor .ProseMirror')).toContainText('Export Me');
  await expect(page.locator('#editor .ProseMirror .katex').first()).toBeVisible();

  await page.evaluate(() => (window as any).__mikedownE2eEmit('mikedown:menu', 'exportHtml'));
  // The document has a local image, so the embed-or-copy question comes first.
  await page.getByRole('button', { name: 'Choose File…' }).click();
  await expect.poll(() => fs.existsSync(target), { timeout: 15_000 }).toBe(true);

  const html = fs.readFileSync(target, 'utf8');
  expect(html).toContain('<title>Export Me</title>');
  expect(html).toContain('src="data:image/png;base64,');
  expect(html).not.toContain('data-mikedown-src');
  expect(html).toContain('url(data:font/woff2;base64,');
  expect(html).not.toMatch(/\ssrc="(?:https?:)?\/\//);
  expect(html).not.toMatch(/url\(\s*['"]?(?:https?:)?\/\//);
  expect(html).not.toContain('asset://');
  expect(html).not.toContain('--vscode-');

  const offline = await context.newPage();
  await offline.route(/^https?:/, (route) => route.abort());
  await offline.goto(pathToFileURL(target).href);
  await expect(offline.locator('.ProseMirror h1')).toHaveText('Export Me');
  await expect(offline.locator('.ProseMirror .katex').first()).toBeVisible();
  const imgOk = await offline.locator('.ProseMirror img').first().evaluate((el: HTMLImageElement) => el.complete && el.naturalWidth > 0);
  expect(imgOk).toBe(true);
  // Code highlighting classes survive and the stylesheet colors them.
  await expect(offline.locator('.ProseMirror pre code')).toContainText('const a');
});

test('Export with the copy-images option writes the image next to the file', async ({ page, ipc }) => {
  ipc.write('pic.png', PNG);
  ipc.launchFiles = [ipc.write('doc.md', '# Sidecar\n\n![pic](pic.png)\n')];
  const target = path.join(ipc.dir, 'side.html');
  await page.addInitScript((savePath: string) => {
    const internals = (window as any).__TAURI_INTERNALS__;
    const original = internals.invoke;
    internals.invoke = (cmd: string, ...rest: unknown[]) =>
      cmd === 'plugin:dialog|save' ? Promise.resolve(savePath) : original(cmd, ...rest);
  }, target);
  await page.goto('/');
  await expect(page.locator('#editor .ProseMirror')).toContainText('Sidecar');
  await page.evaluate(() => (window as any).__mikedownE2eEmit('mikedown:menu', 'exportHtml'));
  await page.getByRole('checkbox').check();
  await page.getByRole('button', { name: 'Choose File…' }).click();
  await expect.poll(() => fs.existsSync(target), { timeout: 15_000 }).toBe(true);
  expect(fs.readFileSync(target, 'utf8')).toContain('src="side_files/pic.png"');
  expect(fs.existsSync(path.join(ipc.dir, 'side_files', 'pic.png'))).toBe(true);
});
