/**
 * M11 (edge 26): an axe pass over each chrome surface: welcome screen, a
 * folder with the tree, tabs + split, the search panel, Settings (App tab),
 * the changed-on-disk dialog and the diff viewer.
 *
 * Scope: violations are reported for the whole page, but the assertion is on
 * desktop chrome only. Nodes inside core's own UI (`.mikedown-root`,
 * `.mikedown-portal`, `.settings-modal`) are collected into the test output as
 * a note for the core owners rather than failing the desktop suite.
 */
import fs from 'node:fs';
import path from 'node:path';
import AxeBuilder from '@axe-core/playwright';
import type { Page } from '@playwright/test';
import { test, expect, type Ipc } from './fixtures';

const CORE_SELECTORS = ['.mikedown-root', '.mikedown-portal', '.settings-modal', '.tiptap', '.ProseMirror'];

interface Found { id: string; impact: string | null | undefined; nodes: string[] }

async function scan(page: Page, label: string): Promise<Found[]> {
  const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
  const chrome: Found[] = [];
  const core: Found[] = [];
  for (const v of results.violations) {
    const mine: string[] = [];
    const theirs: string[] = [];
    for (const n of v.nodes) {
      // Axe's minimal selectors drop ancestors, so ask the page whether the node sits in core's UI.
      const inCore = await page.evaluate(([sel, core]) => {
        const el = document.querySelector(sel);
        return !!el && !!el.closest(core);
      }, [n.target[n.target.length - 1] as string, CORE_SELECTORS.join(',')] as const).catch(() => false);
      (inCore ? theirs : mine).push(n.target.join(' ') + ' :: ' + n.html.slice(0, 140));
    }
    if (mine.length) {chrome.push({ id: v.id, impact: v.impact, nodes: mine });}
    if (theirs.length) {core.push({ id: v.id, impact: v.impact, nodes: theirs });}
  }
  if (core.length) {console.log(`[a11y core note] ${label}: ${JSON.stringify(core)}`);}
  return chrome;
}

async function expectClean(page: Page, label: string): Promise<void> {
  const found = await scan(page, label);
  expect(found, `${label}: ${JSON.stringify(found, null, 2)}`).toEqual([]);
}

function writeRecents(ipc: Ipc, file: string): void {
  fs.mkdirSync(ipc.appData, { recursive: true });
  fs.writeFileSync(path.join(ipc.appData, 'recents.json'), JSON.stringify({
    version: 1,
    firstRunDone: true,
    folders: [{ path: ipc.dir, missingCount: 0, lastOpened: 3 }],
    files: [{ path: file, missingCount: 0, lastOpened: 2 }, { path: path.join(ipc.dir, 'gone.md'), missingCount: 0, lastOpened: 1 }],
  }));
}

test('welcome screen has no chrome violations', async ({ page, ipc }) => {
  const kept = ipc.write('kept.md', '# Kept\n');
  writeRecents(ipc, kept);
  await page.goto('/');
  await expect(page.locator('.mdapp-welcome')).toBeVisible();
  await expectClean(page, 'welcome');
});

test('folder + tree, tabs + split, search results, settings', async ({ page, ipc }) => {
  fs.mkdirSync(path.join(ipc.dir, 'notes'));
  ipc.write('a.md', '# Alpha\n\nA needle line.\n');
  ipc.write('Plan.md', '# Plan\n\nSecond needle.\n');
  fs.writeFileSync(path.join(ipc.dir, 'notes', 'b.md'), '# Beta\n');
  ipc.custom.search_folder = (args) => {
    const { id } = args as { id: number };
    const matches = ['a.md', 'Plan.md'].map((n) => ({ path: path.join(ipc.dir, n), line: 3, column: 3, snippet: 'A needle line.', matchStart: 2, matchEnd: 8 }));
    setTimeout(() => {
      void page.evaluate(([i, m]) => {
        const emit = (window as any).__mikedownE2eEmit as (e: string, p: unknown) => Promise<void>;
        return emit('search-batch', { id: i, matches: m }).then(() => emit('search-done', { id: i, summary: { matches: 2, filesSearched: 2, filesMatched: 2, skippedLarge: 0, truncated: false, cancelled: false, elapsedMs: 1, firstResultMs: 1 } }));
      }, [id, matches] as const);
    }, 10);
    return null;
  };
  ipc.launchFiles = [ipc.dir];
  await page.setViewportSize({ width: 1300, height: 820 });
  await page.goto('/');
  const tree = page.getByRole('tree', { name: 'Files' });
  await expect(tree).toBeVisible();
  await expectClean(page, 'folder with tree');

  // Tabs + split.
  await tree.getByRole('treeitem', { name: /^a\.md/ }).click();
  await tree.getByRole('treeitem', { name: /^Plan\.md/ }).click();
  await expect(page.locator('.mdapp-tab__name')).toHaveText(['a.md', 'Plan.md']);
  await page.locator('.mdapp-pane--focused .ProseMirror').click();
  await page.keyboard.press('ControlOrMeta+\\');
  await expect(page.locator('.mdapp-pane')).toHaveCount(2);
  await expectClean(page, 'tabs + split');

  // Search panel with a rendered result set.
  await page.keyboard.press('ControlOrMeta+Shift+F');
  await expect(page.getByRole('textbox', { name: 'Search the folder' })).toBeFocused();
  await expectClean(page, 'search panel (empty)');
  await page.keyboard.type('needle');
  const results = page.getByRole('tree', { name: 'Search results' });
  await expect(results.locator('.mdapp-search__match')).toHaveCount(2);
  await expectClean(page, 'search results');

  // Settings, App tab.
  await page.locator('#editor .ProseMirror').first().click();
  await page.keyboard.press('ControlOrMeta+,');
  const modal = page.locator('.settings-modal');
  await expect(modal).toBeVisible();
  await modal.getByRole('tab', { name: 'App', exact: true }).click();
  await expectClean(page, 'settings App tab');
  await page.keyboard.press('Escape');
  await expect(modal).toBeHidden();

});

test('changed-on-disk dialog and diff viewer', async ({ page, ipc }) => {
  const a = ipc.write('a.md', '# Alpha\n\nA needle line.\n');
  ipc.launchFiles = [ipc.dir];
  await page.setViewportSize({ width: 1300, height: 820 });
  await page.goto('/');
  await expect(page.getByRole('tree', { name: 'Files' })).toBeVisible();
  await page.evaluate((p) => (window as any).mikedownApp.controller.openPath(p), a);
  await expect.poll(() => page.evaluate(() => (window as any).mikedownModel?.path)).toBe(a);
  await page.locator('#editor .ProseMirror').locator('p').last().click();
  await page.keyboard.press('End');
  await page.keyboard.type(' Mine.');
  await expect.poll(() => page.evaluate(() => (window as any).mikedownModel.dirty)).toBe(true);
  fs.writeFileSync(a, '# Alpha\n\nA needle line. Theirs.\n');
  const t = new Date(Date.now() + 5000);
  fs.utimesSync(a, t, t);
  await page.keyboard.press('ControlOrMeta+s');
  const ask = page.getByRole('alertdialog');
  await expect(ask).toContainText('changed on disk');
  await expectClean(page, 'changed-on-disk dialog');

  // Diff viewer.
  await ask.getByRole('button', { name: 'Compare…' }).click();
  const diff = page.getByRole('dialog');
  await expect(diff).toContainText('On disk');
  await expectClean(page, 'diff viewer');
});

test('reduced motion, more contrast and forced colors reach the chrome and the core tokens', async ({ page, ipc }) => {
  ipc.launchFiles = [ipc.write('a.md', '# Alpha\n\nText.\n')];
  await page.goto('/');
  await expect(page.locator('#editor .ProseMirror')).toContainText('Text.');
  const token = (sel: string) => page.evaluate((s) => getComputedStyle(document.querySelector(s)!).getPropertyValue('--mikedown-border').trim(), sel);
  const duration = () => page.evaluate(() => {
    const el = document.querySelector('.mdapp-btn--toolbar, .mdapp-tab') as HTMLElement;
    return getComputedStyle(el).transitionDuration;
  });

  const lightBorder = await token('.mikedown-root');
  expect(lightBorder).not.toBe('rgba(0, 0, 0, 0.7)');
  expect(await duration()).not.toMatch(/^0\.01ms|^1e-05s/);

  // Reduced motion: transitions collapse to ~0.
  await page.emulateMedia({ reducedMotion: 'reduce' });
  expect(await duration()).toMatch(/^(0\.01ms|1e-05s|0s)(, (0\.01ms|1e-05s|0s))*$/);
  await page.emulateMedia({ reducedMotion: 'no-preference' });

  // More contrast, light: the editor root and the page root tokens strengthen.
  await page.emulateMedia({ contrast: 'more', colorScheme: 'light' });
  expect(await token('.mikedown-root')).toBe('rgba(0, 0, 0, 0.7)');
  expect(await token('html')).toBe('rgba(0, 0, 0, 0.7)');
  // More contrast, dark.
  await page.emulateMedia({ contrast: 'more', colorScheme: 'dark' });
  await expect.poll(() => token('.mikedown-root')).toBe('rgba(255, 255, 255, 0.75)');
  expect(await token('html')).toBe('rgba(255, 255, 255, 0.75)');
  await page.emulateMedia({ contrast: 'no-preference', colorScheme: 'light' });
  expect(await token('.mikedown-root')).toBe(lightBorder);

  // Forced colors: buttons keep a visible border from the system palette.
  await page.emulateMedia({ forcedColors: 'active' });
  const border = await page.evaluate(() => {
    const b = document.querySelector('.mdapp-btn--toolbar, .mdapp-iconbtn') as HTMLElement;
    const cs = getComputedStyle(b);
    return { width: cs.borderTopWidth, style: cs.borderTopStyle };
  });
  expect(border.style).toBe('solid');
  expect(parseFloat(border.width)).toBeGreaterThan(0);
});
