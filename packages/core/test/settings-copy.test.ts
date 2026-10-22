/** The core Settings modal copy is host-neutral: no VS Code or workspace wording. */
import { afterEach, describe, expect, it } from 'vitest';
import { createMikeDownEditor, NoopHost, type MikeDownEditorHandle, type MikeDownHost } from '../src/index';
import { stubLayoutMeasurement } from '../../../test/harness/webviewHarness';

stubLayoutMeasurement();

const mounted: Array<{ handle: MikeDownEditorHandle; el: HTMLElement }> = [];

function settingsText(host: MikeDownHost): string {
  const el = document.createElement('div');
  document.body.appendChild(el);
  const handle = createMikeDownEditor(el, { host, spellcheckDictionaryUrl: '/dict' });
  mounted.push({ handle, el });
  handle.command('openSettings');
  return document.body.textContent ?? '';
}

afterEach(() => {
  while (mounted.length) {
    const { handle, el } = mounted.pop()!;
    try { handle.destroy(); } catch { /* already destroyed */ }
    el.remove();
  }
  document.querySelectorAll('[role="dialog"]').forEach(n => n.remove());
});

describe('Settings modal copy', () => {
  it('mentions neither VS Code nor workspaces with a bare host', () => {
    const text = settingsText(new NoopHost());
    expect(text).toContain('Check spelling');
    expect(text).toContain('Highlight inline #tags');
    expect(text).not.toMatch(/VS Code|workspace/i);
  });

  it('adds tag suggestions and tag click wording only when the host supports them', () => {
    expect(settingsText(new NoopHost())).not.toMatch(/Known tags|Cmd\/Ctrl\+click a tag/);
    class TagHost extends NoopHost {
      async getTags() { return []; }
      openTag() { /* noop */ }
    }
    const text = settingsText(new TagHost());
    expect(text).toContain('Known tags are suggested as you type #.');
    expect(text).toContain('Cmd/Ctrl+click a tag');
    expect(text).not.toMatch(/VS Code|workspace/i);
  });
});
