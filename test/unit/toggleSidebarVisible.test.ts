import { describe, it, expect, beforeEach, vi } from 'vitest';

// Covers M2's mikedown.toggleSidebar command case in editor-main.ts
// (~line 4681), which calls outlineSidebar.ts's toggleSidebarVisible()
// (~line 454). That function flips visibility via the module's private
// setVisible(sidebarEl.hidden) — this asserts the DOM-level effect
// (sidebarEl.hidden flipping, aria-expanded, and the body open class)
// since there's no pure logic to isolate. Mirrors the DOM scaffolding
// pattern in sidebarBacklinks.test.ts.

function mountSidebarHost(): void {
  document.body.innerHTML = `
    <aside id="mikedown-outline-sidebar" hidden></aside>
    <button id="mikedown-outline-toggle" aria-expanded="false"></button>
    <div id="editor-container"></div>
  `;
}

function fakeEditor() {
  return {
    state: {
      doc: { forEach: (_cb: any) => { /* no headings */ } },
      selection: { from: 0 },
    },
    on: vi.fn(),
  };
}

describe('toggleSidebarVisible', () => {
  let toggleSidebarVisible: any;
  let sidebarEl: HTMLElement;
  let toggleEl: HTMLElement;

  beforeEach(async () => {
    mountSidebarHost();
    vi.resetModules();
    const mod = await import('../../src/webview/outlineSidebar');
    toggleSidebarVisible = mod.toggleSidebarVisible;
    mod.initOutlineSidebar({
      editor: fakeEditor(),
      vscode: { postMessage: vi.fn() },
      anchorFn: (t: string) => t,
    });
    sidebarEl = document.getElementById('mikedown-outline-sidebar')!;
    toggleEl = document.getElementById('mikedown-outline-toggle')!;
  });

  it('starts hidden after init', () => {
    expect(sidebarEl.hidden).toBe(true);
  });

  it('shows the sidebar on first toggle', () => {
    toggleSidebarVisible();
    expect(sidebarEl.hidden).toBe(false);
    expect(toggleEl.getAttribute('aria-expanded')).toBe('true');
    expect(document.body.classList.contains('mikedown-outline-open')).toBe(true);
  });

  it('hides the sidebar again on a second toggle', () => {
    toggleSidebarVisible();
    toggleSidebarVisible();
    expect(sidebarEl.hidden).toBe(true);
    expect(toggleEl.getAttribute('aria-expanded')).toBe('false');
    expect(document.body.classList.contains('mikedown-outline-open')).toBe(false);
  });

  it('is a no-op before init (sidebarEl not yet resolved)', async () => {
    vi.resetModules();
    document.body.innerHTML = '';
    const mod = await import('../../src/webview/outlineSidebar');
    expect(() => mod.toggleSidebarVisible()).not.toThrow();
  });
});
