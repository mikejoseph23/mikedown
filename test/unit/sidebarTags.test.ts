import { describe, it, expect, beforeEach, vi } from 'vitest';

// Same scaffolding as sidebarBacklinks.test.ts: the sidebar module keeps
// module-level singletons, so reset modules and re-init per scenario.

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

describe('Sidebar Tags section', () => {
  let mod: typeof import('../../src/webview/outlineSidebar');
  let postMessageSpy: ReturnType<typeof vi.fn>;
  const section = () => document.querySelector('.tags-section') as HTMLElement;

  beforeEach(async () => {
    mountSidebarHost();
    vi.resetModules();
    mod = await import('../../src/webview/outlineSidebar');
    postMessageSpy = vi.fn();
    mod.initOutlineSidebar({
      editor: fakeEditor() as any,
      vscode: { postMessage: postMessageSpy },
      anchorFn: (t: string) => t,
    } as any);
  });

  it('shows an empty state and auto-collapses when there are no tags', () => {
    mod.applyTags([]);
    expect(section().textContent).toContain('No tags.');
    expect(section().classList.contains('collapsed')).toBe(true);
  });

  it('lists tags alphabetically with counts and a total badge', () => {
    mod.applyTags([{ tag: 'zeta', count: 1 }, { tag: 'alpha', count: 4 }]);
    const rows = [...section().querySelectorAll('.tags-item')];
    expect(rows.map(r => r.querySelector('.tags-item-name')!.textContent)).toEqual(['#alpha', '#zeta']);
    expect(rows.map(r => r.querySelector('.tags-item-count')!.textContent)).toEqual(['4', '1']);
    expect(section().querySelector('.section-count')!.textContent).toBe(' (2)');
    expect(section().classList.contains('collapsed')).toBe(false);
  });

  it('clicking a tag posts openTag (same flow as an inline tag)', () => {
    mod.applyTags([{ tag: 'project/active', count: 2 }]);
    (section().querySelector('.tags-item') as HTMLElement).click();
    expect(postMessageSpy).toHaveBeenCalledWith({ type: 'openTag', tag: 'project/active' });
  });

  it('persists a manual collapse like the other sections', () => {
    mod.applyTags([{ tag: 'a', count: 1 }]);
    (section().querySelector('.sidebar-section-header') as HTMLElement).click();
    expect(postMessageSpy).toHaveBeenCalledWith({ type: 'sidebarSectionCollapsed', section: 'tags', collapsed: true });
    // A later empty index no longer overrides the user's choice.
    mod.applyTags([]);
    mod.applyTags([{ tag: 'a', count: 1 }]);
    expect(section().classList.contains('collapsed')).toBe(true);
  });

  it('restores collapse state from sectionPrefs', () => {
    mod.applyTags([{ tag: 'a', count: 1 }]);
    mod.applyOutlineState({ sectionPrefs: { tags: true } });
    expect(section().classList.contains('collapsed')).toBe(true);
  });

  it('hides the section when tags are disabled', () => {
    mod.setTagsSectionEnabled(false);
    expect(section().hidden).toBe(true);
    mod.setTagsSectionEnabled(true);
    expect(section().hidden).toBe(false);
  });
});
