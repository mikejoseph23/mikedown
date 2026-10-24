/**
 * M7: Cmd/Ctrl+Shift+F opens the search panel in the sidebar, typing finds
 * matches grouped by file (hidden folders and node_modules excluded), whole
 * word drops partial matches, clicking or pressing Enter on a result opens the
 * file and selects the match in the editor, Esc returns to the tree.
 *
 * The Rust walker itself is covered by `cargo test` (search.rs); here the
 * `search_folder` command is answered by a small stand-in that applies the
 * same rules and streams `search-batch` / `search-done` events back.
 */
import fs from 'node:fs';
import path from 'node:path';
import type { Page } from '@playwright/test';
import { test, expect } from './fixtures';

interface Opts { caseSensitive?: boolean; wholeWord?: boolean; showHidden?: boolean; limit?: number }

function searchFolder(page: Page, args: { id: number; root: string; query: string; options?: Opts }): null {
  const { id, root, query } = args;
  const o = args.options ?? {};
  const matches: unknown[] = [];
  const isWord = (c: string | undefined): boolean => !!c && /[\p{L}\p{N}_]/u.test(c);
  const walk = (dir: string): void => {
    const entries = fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name));
    for (const e of entries.filter((x) => x.isFile())) {
      if (!/\.(md|markdown|txt)$/i.test(e.name)) {continue;}
      const file = path.join(dir, e.name);
      fs.readFileSync(file, 'utf8').split('\n').forEach((line, i) => {
        const hay = o.caseSensitive ? line : line.toLowerCase();
        const needle = o.caseSensitive ? query : query.toLowerCase();
        for (let at = hay.indexOf(needle); at !== -1; at = hay.indexOf(needle, at + needle.length)) {
          if (o.wholeWord && (isWord(line[at - 1]) || isWord(line[at + needle.length]))) {continue;}
          matches.push({ path: file, line: i + 1, column: at + 1, snippet: line.trim(), matchStart: at - (line.length - line.trimStart().length), matchEnd: at - (line.length - line.trimStart().length) + needle.length });
        }
      });
    }
    for (const e of entries.filter((x) => x.isDirectory())) {
      if (e.name === '.mikedown' || (!o.showHidden && (e.name.startsWith('.') || e.name === 'node_modules'))) {continue;}
      walk(path.join(dir, e.name));
    }
  };
  walk(root);
  // Events arrive after `search_folder` has returned, as with the real command.
  setTimeout(() => {
    void page.evaluate(([i, m]) => {
      const emit = (window as unknown as { __mikedownE2eEmit(e: string, p: unknown): Promise<void> }).__mikedownE2eEmit;
      return emit('search-batch', { id: i, matches: m }).then(() => emit('search-done', {
        id: i,
        summary: { matches: (m as unknown[]).length, filesSearched: 0, filesMatched: 0, skippedLarge: 0, truncated: false, cancelled: false, elapsedMs: 1, firstResultMs: 1 },
      }));
    }, [id, matches] as const);
  }, 10);
  return null;
}

test('search the folder, narrow with whole word, open a result at the match', async ({ page, ipc }) => {
  fs.mkdirSync(path.join(ipc.dir, 'notes'), { recursive: true });
  fs.mkdirSync(path.join(ipc.dir, '.hidden'));
  fs.mkdirSync(path.join(ipc.dir, 'node_modules'));
  fs.writeFileSync(path.join(ipc.dir, 'a.md'), '# Alpha\n\nA line with the needle in it.\n');
  fs.writeFileSync(path.join(ipc.dir, 'notes', 'b.md'), '# Beta\n\nFirst needle here.\n\nSecond needle there, far below.\n');
  fs.writeFileSync(path.join(ipc.dir, 'notes', 'c.md'), '# Gamma\n\nMany needles in a haystack.\n');
  fs.writeFileSync(path.join(ipc.dir, '.hidden', 'x.md'), 'needle in a hidden folder\n');
  fs.writeFileSync(path.join(ipc.dir, 'node_modules', 'y.md'), 'needle in node_modules\n');
  ipc.custom.search_folder = (args) => searchFolder(page, args as Parameters<typeof searchFolder>[1]);
  ipc.launchFiles = [ipc.dir];
  await page.setViewportSize({ width: 1300, height: 800 });
  await page.goto('/');
  await expect(page.getByRole('tree', { name: 'Files' })).toBeVisible();

  // The chord opens the panel with the box focused.
  await page.keyboard.press('ControlOrMeta+Shift+F');
  const box = page.getByRole('textbox', { name: 'Search the folder' });
  await expect(box).toBeFocused();
  await expect(page.getByRole('tree', { name: 'Files' })).toBeHidden();

  await box.fill('needle');
  const results = page.getByRole('tree', { name: 'Search results' });
  await expect(page.getByRole('status')).toHaveText('4 results in 3 files.');
  // Grouped by file, hidden folder and node_modules excluded.
  await expect(results.locator('.mdapp-search__file .mdapp-search__name')).toHaveText(['a.md', 'b.md', 'c.md']);
  await expect(results.locator('.mdapp-search__file .mdapp-search__count')).toHaveText(['1', '2', '1']);
  await expect(results.locator('.mdapp-search__snippet mark').first()).toHaveText('needle');
  // The query went out once, after the debounce, with the default options.
  const starts = ipc.calls.filter((c) => c.cmd === 'search_folder');
  expect(starts).toHaveLength(1);
  expect(starts[0].args).toMatchObject({ root: ipc.dir, query: 'needle', options: { caseSensitive: false, wholeWord: false, showHidden: false, limit: 2000 } });

  // Whole word drops "needles".
  await page.getByRole('button', { name: 'Match whole word' }).click();
  await expect(page.getByRole('status')).toHaveText('3 results in 2 files.');

  // Click the second match in b.md: the file opens with the match selected.
  await results.locator('.mdapp-search__match').nth(2).click();
  await expect(page.locator('.mdapp-tab__name')).toHaveText('b.md');
  await expect(page.locator('#editor .ProseMirror')).toContainText('Second needle there');
  await expect.poll(() => page.evaluate(() => window.getSelection()?.toString())).toBe('needle');
  // It is the second "needle" of the file, not the first.
  await expect.poll(() => page.evaluate(() => {
    const sel = window.getSelection();
    return sel?.anchorNode?.textContent ?? '';
  })).toContain('Second needle');

  // Keyboard: back to the list, move to a.md's match, Enter opens it.
  await page.keyboard.press('ControlOrMeta+Shift+F');
  await expect(box).toBeFocused();
  await box.press('ArrowDown');
  await expect(results).toBeFocused();
  await results.press('Home');
  await results.press('ArrowDown');
  await results.press('Enter');
  await expect(page.getByRole('tab', { selected: true })).toContainText('a.md');
  await expect.poll(() => page.evaluate(() => window.getSelection()?.toString())).toBe('needle');

  // Esc closes the panel and shows the tree again.
  await page.keyboard.press('ControlOrMeta+Shift+F');
  await box.press('Escape');
  await expect(page.getByRole('tree', { name: 'Files' })).toBeVisible();
  await expect(box).toBeHidden();
});
