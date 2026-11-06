/** The AI UI loads on demand (ai-lite.ts): never without host.ai, and the editor works before it arrives. */
import * as fs from 'fs';
import * as path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createMikeDownEditor, NoopHost, type MikeDownEditorHandle, type MikeDownHost } from '../src/index';
import { parseAiSettings, type MikeDownAiHost } from '../src/ai';
import { loadAiUi, loadedAiUi, registerAiUi } from '../src/ai-lite';
import { aiGhostKey } from '../src/ai-ghost-plugin';
import * as aiUi from '../src/ai-ui';
import { hideToolbarDropdown } from '../src/toolbar-dropdown';
import { stubLayoutMeasurement } from '../../../test/harness/webviewHarness';

stubLayoutMeasurement();

const quiet = { onWarning: () => {} };
const mounted: Array<{ handle: MikeDownEditorHandle; el: HTMLElement }> = [];

function mount(host: MikeDownHost, settings?: Parameters<typeof createMikeDownEditor>[1]['settings']): MikeDownEditorHandle {
  const el = document.createElement('div');
  document.body.appendChild(el);
  const handle = createMikeDownEditor(el, { host, settings });
  mounted.push({ handle, el });
  return handle;
}

function aiHost(): MikeDownAiHost {
  return { complete: vi.fn(), listEngines: vi.fn(async () => []) } as unknown as MikeDownAiHost;
}

const aiButton = () => mounted[mounted.length - 1]?.el.querySelector<HTMLButtonElement>('button[data-action="ai"]') ?? null;
const isShown = (b: HTMLElement | null) => !!b && b.style.display !== 'none';
const panel = () => document.querySelector<HTMLElement>('.ai-first-run');
/** Let the AI chunk's import() settle and the editor's then() run. */
async function settle(): Promise<void> {
  await loadAiUi();
  await new Promise((r) => setTimeout(r, 0));
}

beforeEach(() => registerAiUi(null));

afterEach(() => {
  hideToolbarDropdown();
  while (mounted.length) {
    const { handle, el } = mounted.pop()!;
    try { handle.destroy(); } catch { /* already destroyed */ }
    el.remove();
  }
  document.querySelectorAll('#mikedown-settings-overlay, #mikedown-ai-page-overlay, .ai-first-run').forEach((n) => n.remove());
  // The other test files rely on the setup file's registration.
  registerAiUi(aiUi);
});

describe('AI UI loading', () => {
  it('is never loaded for a host without AI', async () => {
    mount(new NoopHost());
    await new Promise((r) => setTimeout(r, 0));
    expect(loadedAiUi()).toBeNull();
    expect(aiButton()).toBeNull();
  });

  it('starts loading with host.ai; the toolbar button is there before it arrives', async () => {
    class Host extends NoopHost { ai = aiHost(); }
    mount(new Host());
    expect(loadedAiUi()).toBeNull();
    expect(isShown(aiButton())).toBe(true);
    await settle();
    expect(loadedAiUi()).not.toBeNull();
  });

  it('a click before the AI UI arrives opens the first-run panel once it has', async () => {
    class Host extends NoopHost { ai = aiHost(); }
    mount(new Host());
    aiButton()!.click();
    expect(panel()).toBeNull();
    await settle();
    expect(panel()).not.toBeNull();
  });

  it('settings sent before it arrives apply: the button follows them at once, the rest after the load', async () => {
    class Host extends NoopHost { ai = aiHost(); }
    const handle = mount(new Host(), { ai: parseAiSettings({ showToolbarButton: false }, quiet) });
    expect(isShown(aiButton())).toBe(false);
    handle.updateSettings({ ai: parseAiSettings({ enabled: true }, quiet) });
    expect(isShown(aiButton())).toBe(true);
    await settle();
    expect(aiButton()!.getAttribute('aria-haspopup')).toBe('menu');
  });

  it('the Settings modal opens on the AI tab once the AI UI is there', async () => {
    class Host extends NoopHost { ai = aiHost(); }
    const handle = mount(new Host());
    handle.command('openAiSettings');
    expect(document.querySelector('#mikedown-settings-overlay')).toBeNull();
    await settle();
    expect(document.querySelector('#mikedown-settings-overlay [data-tab-id="ai"]')).not.toBeNull();
  });
});

// ── The editor's main path ──────────────────────────────────────────────────

/** Every module reached from `entry` by a static (non-type) import or re-export; `import()` is not followed. */
function staticClosure(entry: string): Set<string> {
  const root = path.resolve(__dirname, '../src');
  const seen = new Set<string>();
  const resolve = (from: string, spec: string): string | null => {
    const base = path.resolve(path.dirname(from), spec);
    for (const candidate of [`${base}.ts`, path.join(base, 'index.ts'), base]) {
      if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) {return candidate;}
    }
    return null;
  };
  const visit = (file: string): void => {
    if (seen.has(file)) {return;}
    seen.add(file);
    const source = fs.readFileSync(file, 'utf8');
    const statements = source.matchAll(/^(import|export)\s+(type\s+)?([^;]*?)\s*from\s*['"](\.[^'"]+)['"]|^import\s+['"](\.[^'"]+)['"]/gm);
    for (const m of statements) {
      // `import type` and `export type { }` are erased, so they load nothing.
      if (m[2]) {continue;}
      const next = resolve(file, m[4] ?? m[5]);
      if (next && next.startsWith(root)) {visit(next);}
    }
  };
  visit(path.join(root, entry));
  return new Set(Array.from(seen, (f) => path.relative(root, f)));
}

describe('the editor\'s main path does not import the AI UI', () => {
  const lazy = [
    'ai-ui.ts', 'ai-chat-panel.ts', 'ai-docs-page.ts', 'ai-engines-page.ts', 'ai-activity-panel.ts', 'ai-docs-run.ts', 'ai-request.ts',
    // Inline suggestions: the controller, the ProseMirror plugin, the session that joins them, and the prompt and context code they use.
    'ai-ghost.ts', 'ai-ghost-plugin.ts', 'ai-ghost-session.ts', 'ai/prompts/continue.ts', 'ai/ghostContext.ts', 'ai/ghostTrim.ts',
  ];

  it.each(['index.ts', 'editor.ts'])('nothing statically reachable from %s is one of the lazy modules', (entry) => {
    const reached = staticClosure(entry);
    // The walk really walked: it found the editor, and the little the editor does import.
    expect(reached.has('editor.ts')).toBe(true);
    expect(reached.has('ai-lite.ts')).toBe(true);
    for (const module of lazy) {expect(reached.has(module), `${module} is imported from ${entry}`).toBe(false);}
  });

  it('the only way in is the dynamic import in ai-lite.ts, and ai-ui.ts is what carries both panels', () => {
    const lite = fs.readFileSync(path.resolve(__dirname, '../src/ai-lite.ts'), 'utf8');
    expect(lite).toMatch(/import\('\.\/ai-ui'\)/);
    expect(lite).not.toMatch(/^import [^t].*from '\.\/ai-ui'/m);
    const ui = fs.readFileSync(path.resolve(__dirname, '../src/ai-ui.ts'), 'utf8');
    expect(ui).toContain("from './ai-chat-panel'");
    expect(ui).toContain("from './ai-docs-page'");
    // And through ai-ui, both are in the chunk.
    const chunk = staticClosure('ai-ui.ts');
    expect(chunk.has('ai-chat-panel.ts')).toBe(true);
    expect(chunk.has('ai-docs-page.ts')).toBe(true);
  });

  it('ai-ghost is in the lazy chunk: ai-ui.ts carries all three ghost modules, and nothing else reaches them', () => {
    const chunk = staticClosure('ai-ui.ts');
    for (const module of ['ai-ghost.ts', 'ai-ghost-plugin.ts', 'ai-ghost-session.ts']) {expect(chunk.has(module), module).toBe(true);}
    const ui = fs.readFileSync(path.resolve(__dirname, '../src/ai-ui.ts'), 'utf8');
    expect(ui).toMatch(/from '\.\/ai-ghost-session'/);
    // Not even by the lightweight entry the editor loads up front.
    expect(staticClosure('ai-lite.ts').has('ai-ghost.ts')).toBe(false);
    // The pure code the controller needs is imported from ./ai, which the editor already has; the lazy files are the DOM and request halves.
    for (const file of fs.readdirSync(path.resolve(__dirname, '../src')).filter((f) => f.endsWith('.ts') && f !== 'ai-ui.ts' && !f.startsWith('ai-ghost'))) {
      const source = fs.readFileSync(path.resolve(__dirname, '../src', file), 'utf8');
      for (const m of source.matchAll(/^import\s+(type\s+)?[^;]*?from\s*'\.\/(ai-ghost[\w-]*)'/gm)) {
        // The editor and the other lazy modules may name the types; nobody else imports a ghost module for a value.
        if (!m[1]) {expect(['ai-ui.ts', 'ai-ghost-session.ts'], `${file} imports ${m[2]} for a value`).toContain(file);}
      }
    }
  });

  it('the editor imports the panels\' types only', () => {
    const editor = fs.readFileSync(path.resolve(__dirname, '../src/editor.ts'), 'utf8');
    for (const m of editor.matchAll(/^import\s+(type\s+)?[^;]*?from\s*'\.\/(ai-chat-panel|ai-docs-page|ai-engines-page)'/gm)) {
      expect(m[1], m[0]).toBeTruthy();
    }
  });
});

describe('inline suggestions load only with the AI UI', () => {
  it('without host.ai nothing of them loads: no AI chunk, no plugin, no timer', async () => {
    vi.useFakeTimers();
    try {
      const handle = mount(new NoopHost(), { ai: parseAiSettings({ enabled: true, features: { ghostText: { enabled: true } } }, quiet) });
      expect(aiGhostKey.get(handle.tiptap.state)).toBeUndefined();
      handle.command('aiSuggestContinuation');
      handle.tiptap.view.dom.dispatchEvent(new KeyboardEvent('keydown', { key: 'a', bubbles: true }));
      handle.tiptap.view.dispatch(handle.tiptap.state.tr.insertText('a'));
      await vi.advanceTimersByTimeAsync(5000);
      expect(loadedAiUi()).toBeNull();
      expect(aiGhostKey.get(handle.tiptap.state)).toBeUndefined();
    } finally {
      vi.useRealTimers();
    }
  });

  it('with host.ai the plugin arrives only with the chunk, and only when the feature is on', async () => {
    class Host extends NoopHost { ai = aiHost(); }
    const on = mount(new Host(), { ai: parseAiSettings({ enabled: true, features: { ghostText: { enabled: true } } }, quiet) });
    expect(aiGhostKey.get(on.tiptap.state)).toBeUndefined();
    await settle();
    expect(aiGhostKey.get(on.tiptap.state)).toBeDefined();

    const off = mount(new Host(), { ai: parseAiSettings({ enabled: true }, quiet) });
    await settle();
    expect(loadedAiUi()).not.toBeNull();
    expect(aiGhostKey.get(off.tiptap.state)).toBeUndefined();
  });
});

describe('the panels load only with the AI UI', () => {
  it('without host.ai the chat command opens nothing and the AI UI stays unloaded', async () => {
    const handle = mount(new NoopHost());
    handle.command('aiChat');
    await new Promise((r) => setTimeout(r, 0));
    expect(loadedAiUi()).toBeNull();
    expect(document.querySelector('.ai-chat')).toBeNull();
  });

  it('with host.ai the chat opens once the chunk has arrived, and not before', async () => {
    class Host extends NoopHost { ai = aiHost(); }
    const handle = mount(new Host(), { ai: parseAiSettings({ enabled: true }, quiet) });
    handle.command('aiChat');
    expect(document.querySelector('.ai-chat')).toBeNull();
    await settle();
    expect(document.querySelector('.ai-chat')).not.toBeNull();
    handle.destroy();
    expect(document.querySelector('.ai-chat')).toBeNull();
  });

  it('the bases manager is offered only to a host with host.docs', async () => {
    class Plain extends NoopHost { ai = aiHost(); }
    class WithDocs extends NoopHost { ai = aiHost(); docs = { listBases: vi.fn(async () => []), index: vi.fn(), readSections: vi.fn(), keywordSearch: vi.fn(), saveBases: vi.fn(async () => {}) } as never; }
    const open = async (host: MikeDownHost) => {
      const handle = mount(host);
      handle.command('openAiSettings');
      await settle();
      return document.querySelector('#mikedown-settings-overlay');
    };
    const plain = await open(new Plain());
    expect(plain?.querySelector('[data-fk="manage-bases"]')).toBeNull();
    document.querySelectorAll('#mikedown-settings-overlay').forEach((n) => n.remove());
    const withDocs = await open(new WithDocs());
    expect(withDocs?.querySelector('[data-fk="manage-bases"]')).not.toBeNull();
  });
});
