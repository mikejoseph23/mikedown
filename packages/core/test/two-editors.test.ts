/**
 * Two createMikeDownEditor instances on one page, mounted the way the demo
 * mounts them (a host with uploadImage, both themes): each must get its own
 * toolbar and rendered content. Also pins the CSS floor that keeps a root in an
 * unsized container from collapsing to 0px (the demo's blank "Editor B").
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { createMikeDownEditor, type MikeDownEditorHandle, type MikeDownHost } from '../src/index';
import { stubLayoutMeasurement } from '../../../test/harness/webviewHarness';

stubLayoutMeasurement();

const mounted: Array<{ handle: MikeDownEditorHandle; el: HTMLElement }> = [];

const host: MikeDownHost = {
  onChange() {},
  async uploadImage(file) {
    return { src: `blob:${file.name ?? 'image'}`, alt: file.name ?? 'pasted image' };
  },
};

function mount(markdown: string, theme: 'light' | 'dark') {
  const el = document.createElement('div');
  document.body.appendChild(el);
  const handle = createMikeDownEditor(el, { host, initialMarkdown: markdown, theme });
  mounted.push({ handle, el });
  return { el, handle };
}

afterEach(() => {
  while (mounted.length) {
    const { handle, el } = mounted.pop()!;
    try { handle.destroy(); } catch { /* already destroyed */ }
    el.remove();
  }
  vi.restoreAllMocks();
});

const A = '# Release checklist\n\nNotes for the **2.15** release.\n\n- [x] Bump the version\n';
const B = '# Meeting notes\n\n- [ ] Review the plan\n\n```mermaid\ngraph LR\n  A --> B\n```\n';

describe('two editors on one page', () => {
  it.each(['light', 'dark'] as const)('both render a toolbar and content (%s)', (theme) => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const a = mount(A, theme);
    const b = mount(B, theme);
    for (const [ed, title] of [[a, 'Release checklist'], [b, 'Meeting notes']] as const) {
      expect(ed.el.querySelectorAll('.mikedown-root')).toHaveLength(1);
      expect(ed.el.querySelector('.mikedown-toolbar')?.children.length).toBeGreaterThan(0);
      expect(ed.el.querySelector('.mikedown-editor-container .ProseMirror h1')?.textContent).toBe(title);
    }
    expect(a.handle.getMarkdown()).toContain('Release checklist');
    expect(a.handle.getMarkdown()).not.toContain('Meeting notes');
    expect(b.handle.getMarkdown()).toContain('Meeting notes');
  });

  it('keeps editor B working after a theme switch and after A is destroyed', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const a = mount(A, 'light');
    const b = mount(B, 'light');
    a.handle.setTheme('dark');
    b.handle.setTheme('dark');
    a.handle.destroy();
    b.handle.setMarkdown('# Still here\n');
    expect(b.el.querySelector('.mikedown-toolbar')).not.toBeNull();
    expect(b.el.querySelector('.ProseMirror h1')?.textContent).toBe('Still here');
  });

  it('gives .mikedown-root a min-height floor for unsized containers', () => {
    const css = readFileSync(join(__dirname, '..', 'src', 'styles', 'editor.css'), 'utf8');
    const rule = css.match(/^\.mikedown-root \{[^}]*\}/m)?.[0] ?? '';
    expect(rule).toMatch(/min-height:\s*var\(--mikedown-min-height,\s*\d+px\)/);
  });
});
