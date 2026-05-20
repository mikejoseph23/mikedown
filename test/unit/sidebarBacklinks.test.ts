import { describe, it, expect, beforeEach, vi } from 'vitest';

// The sidebar module uses module-level singletons; reset modules between
// test files isn't free here, so we set up the DOM scaffolding once and
// re-init for each scenario. The init function expects #mikedown-outline-sidebar
// and #mikedown-outline-toggle to already exist (they're declared in the
// host's HTML template), so we mirror that minimal shape.

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

describe('Sidebar Backlinks rendering', () => {
  let initOutlineSidebar: any;
  let applyBacklinks: any;
  let postMessageSpy: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    mountSidebarHost();
    vi.resetModules();
    const mod = await import('../../src/webview/outlineSidebar');
    initOutlineSidebar = mod.initOutlineSidebar;
    applyBacklinks = mod.applyBacklinks;
    postMessageSpy = vi.fn();
    initOutlineSidebar({
      editor: fakeEditor(),
      vscode: { postMessage: postMessageSpy },
      anchorFn: (t: string) => t,
    });
  });

  it('renders an empty-state row when there are no backlinks', () => {
    applyBacklinks([]);
    const list = document.querySelector('.backlinks-list');
    expect(list).toBeTruthy();
    expect(list!.textContent).toContain('No backlinks');
  });

  it('hides the count badge when empty', () => {
    applyBacklinks([]);
    const badge = document.querySelector('.section-count') as HTMLElement;
    expect(badge.hidden).toBe(true);
  });

  it('renders one row per backlink entry', () => {
    applyBacklinks([
      { uri: './a.md', displayPath: 'a.md', line: 1, lineText: '[link to current](./current.md)' },
      { uri: './nested/b.md', displayPath: 'nested/b.md', line: 4 },
    ]);
    const items = document.querySelectorAll('.backlinks-item');
    expect(items.length).toBe(2);
    expect(items[0].textContent).toBe('a.md');
    expect(items[1].textContent).toBe('nested/b.md');
  });

  it('shows count badge with non-zero count', () => {
    applyBacklinks([
      { uri: './a.md', displayPath: 'a.md', line: 1 },
      { uri: './b.md', displayPath: 'b.md', line: 2 },
      { uri: './c.md', displayPath: 'c.md', line: 3 },
    ]);
    const badge = document.querySelector('.section-count') as HTMLElement;
    expect(badge.hidden).toBe(false);
    expect(badge.textContent).toContain('3');
  });

  it('clicking a row posts openLink with navigateCurrentTab behavior', () => {
    applyBacklinks([
      { uri: './a.md', displayPath: 'a.md', line: 1 },
    ]);
    const row = document.querySelector('.backlinks-item') as HTMLButtonElement;
    row.click();
    expect(postMessageSpy).toHaveBeenCalledWith(expect.objectContaining({
      type: 'openLink',
      href: './a.md',
      behavior: 'navigateCurrentTab',
    }));
  });

  it('exposes tooltip with line number and excerpt', () => {
    applyBacklinks([
      { uri: './a.md', displayPath: 'a.md', line: 7, lineText: 'see [doc](./current.md)' },
    ]);
    const row = document.querySelector('.backlinks-item') as HTMLButtonElement;
    expect(row.title).toContain('line 7');
    expect(row.title).toContain('see [doc](./current.md)');
  });
});
