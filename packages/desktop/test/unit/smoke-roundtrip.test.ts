/**
 * The jsdom reference for the webview smoke test: round-trip the fixture
 * through core (the same code the VS Code bundle runs) and pin the result in
 * smoke.expected.md. `scripts/smoke-compare.mjs` diffs a WebKit / WebView2
 * report against that file.
 *
 * Regenerate after an intentional serializer change:
 *   UPDATE_SMOKE_EXPECTED=1 npx vitest run --config vitest.config.ts
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { createMikeDownEditor, NoopHost, type MikeDownEditorHandle } from '@mikedown/core';
import { stubLayoutMeasurement } from '../../../../test/harness/webviewHarness';
import { SMOKE_FIXTURE } from '../../src/smoke/fixture';

stubLayoutMeasurement();

const EXPECTED = join(__dirname, 'smoke.expected.md');
const mounted: Array<{ handle: MikeDownEditorHandle; el: HTMLElement }> = [];

function mount() {
  const el = document.createElement('div');
  document.body.appendChild(el);
  const handle = createMikeDownEditor(el, {
    host: new NoopHost(),
    initialMarkdown: SMOKE_FIXTURE,
    theme: 'auto',
    features: { sidebar: false, supportCard: false },
    hostOwnsShortcuts: true,
  });
  mounted.push({ handle, el });
  return handle;
}

afterEach(() => {
  while (mounted.length) {
    const { handle, el } = mounted.pop()!;
    try { handle.destroy(); } catch { /* already destroyed */ }
    el.remove();
  }
  vi.restoreAllMocks();
});

describe('smoke fixture round-trip (jsdom reference)', () => {
  it('is deterministic and idempotent', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const handle = mount();
    const md1 = handle.getMarkdown();
    handle.setMarkdown(SMOKE_FIXTURE, { pristine: true });
    const md2 = handle.getMarkdown();
    handle.setMarkdown(md1, { pristine: true });
    expect(md2).toBe(md1);
    expect(handle.getMarkdown()).toBe(md1);
  });

  it('keeps every block of the fixture', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const out = mount().getMarkdown();
    for (const needle of [
      '# MikeDown Desktop smoke fixture',
      '**bold**', '==highlight==', '~~strike~~', '`inline code`',
      '[!NOTE]', '[!WARNING]',
      '- [x] Task done', '- [ ] Task open',
      '| Feature | WebKit | WebView2 |',
      '```ts', '```mermaid',
      '$a^2 + b^2 = c^2$', '\\int_0^1',
      '![MikeDown icon](images/icon.png)',
      '[^1]: The footnote text.',
    ]) {
      expect(out, needle).toContain(needle);
    }
  });

  it('matches smoke.expected.md (the webview comparison baseline)', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const out = mount().getMarkdown();
    if (process.env.UPDATE_SMOKE_EXPECTED === '1' || !existsSync(EXPECTED)) {
      writeFileSync(EXPECTED, out);
    }
    expect(out).toBe(readFileSync(EXPECTED, 'utf8'));
  });
});
