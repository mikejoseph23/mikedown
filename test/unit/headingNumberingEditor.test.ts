import { describe, it, expect, afterEach } from 'vitest';
import { bootWebview, type Harness } from '../harness/webviewHarness';

// Editor wiring for heading numbering (#6): the toolbar toggle, live
// renumbering, and in-doc link updates, driven through the real webview.

let harness: Harness | null = null;
const wait = (ms: number) => new Promise(r => setTimeout(r, ms));

async function boot(content: string, mode = 'fromH1'): Promise<Harness> {
  harness = await bootWebview();
  harness.send({ type: 'settings', headingNumbering: mode });
  harness.send({ type: 'update', content });
  await wait(30);
  harness.clear();
  return harness;
}

const button = () => document.querySelector<HTMLButtonElement>('button[data-action="headingNumbers"]')!;
const markdown = (h: Harness) => (h.wysiwygEditor().storage.markdown.getMarkdown() as string).trim();

afterEach(() => {
  harness?.dispose();
  harness = null;
});

describe('heading numbering (webview)', () => {
  it('hides the toolbar button while the setting is off', async () => {
    await boot('# A', 'off');
    expect(button().style.display).toBe('none');
    harness!.send({ type: 'settings', headingNumbering: 'fromH2' });
    expect(button().style.display).toBe('');
  });

  it('toggles numbers into the markdown and back out', async () => {
    const h = await boot('# Title\n\n## Intro\n\n### Setup\n\n## Usage', 'fromH2');
    button().click();
    expect(markdown(h)).toBe('# Title\n\n## 1 Intro\n\n### 1.1 Setup\n\n## 2 Usage');
    button().click();
    expect(markdown(h)).toBe('# Title\n\n## Intro\n\n### Setup\n\n## Usage');
  });

  it('does not renumber a stale document just by opening it', async () => {
    const h = await boot('## 2 A\n\n## 1 B');
    await wait(500);
    expect(markdown(h)).toBe('## 2 A\n\n## 1 B');
  });

  it('renumbers live after an edit and updates in-doc links', async () => {
    const h = await boot('## 1 Intro\n\n## 2 Usage\n\nSee [usage](#2-usage).');
    const editor = h.wysiwygEditor();
    // Insert a new section at the top, outside any heading's cursor.
    editor.commands.insertContentAt(0, { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: 'Overview' }] });
    editor.commands.setTextSelection(editor.state.doc.content.size - 2);
    await wait(500);
    expect(markdown(h)).toBe('## 1 Overview\n\n## 2 Intro\n\n## 3 Usage\n\nSee [usage](#3-usage).');
  });
});
