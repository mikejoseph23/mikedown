import { describe, it, expect, afterEach } from 'vitest';
import { bootWebview, type Harness } from '../harness/webviewHarness';

let harness: Harness | null = null;
const settle = () => new Promise((r) => setTimeout(r, 30));

async function load(content: string): Promise<Harness> {
  harness = await bootWebview();
  harness.send({ type: 'update', content });
  await settle();
  return harness;
}

const md = (h: Harness) => h.wysiwygEditor().storage.markdown.getMarkdown() as string;

afterEach(() => {
  harness?.dispose();
  harness = null;
});

describe('footnotes', () => {
  it('round-trips a reference and its definition byte for byte', async () => {
    const src = 'Claim[^1] and more[^note].\n\n[^1]: First source.\n\n[^note]: Second source.';
    const h = await load(src);
    expect(md(h)).toBe(src);
  });

  it('parses into ref and def nodes with the author labels', async () => {
    const h = await load('Text[^a].\n\n[^a]: Note body.');
    const names: string[] = [];
    h.wysiwygEditor().state.doc.descendants((n: any) => { names.push(n.type.name + ':' + (n.attrs.label ?? '')); });
    expect(names).toContain('footnoteRef:a');
    expect(names).toContain('footnoteDef:a');
  });

  it('keeps definitions in place and keeps unreferenced ones', async () => {
    const src = 'Intro.\n\n[^orphan]: Nobody cites me.\n\nBody[^z].\n\n[^z]: Cited.';
    const h = await load(src);
    expect(md(h)).toBe(src);
  });

  it('keeps multi-paragraph definitions', async () => {
    const src = 'Text[^1].\n\n[^1]: First paragraph.\n\n    Second paragraph.';
    const h = await load(src);
    expect(md(h)).toBe(src);
  });

  it('leaves a reference with no definition as literal text', async () => {
    const h = await load('Dangling[^x] ref.');
    expect(md(h)).toBe('Dangling\\[^x\\] ref.');
    const types: string[] = [];
    h.wysiwygEditor().state.doc.descendants((n: any) => { types.push(n.type.name); });
    expect(types).not.toContain('footnoteRef');
  });

  it('leaves inline footnote syntax as literal text', async () => {
    const h = await load('Inline^[not supported] here.');
    const types: string[] = [];
    h.wysiwygEditor().state.doc.descendants((n: any) => { types.push(n.type.name); });
    expect(types).not.toContain('footnoteRef');
  });

  it('insertFootnote adds a numbered reference and a definition at the end', async () => {
    const h = await load('Hello world.\n\n[^1]: Existing.');
    const ed = h.wysiwygEditor();
    ed.commands.setTextSelection(6);
    ed.commands.insertFootnote();
    expect(md(h)).toBe('Hello[^2] world.\n\n[^1]: Existing.\n\n[^2]:');
  });

  it('typing [^n] converts to a reference and creates its definition', async () => {
    const h = await load('Start ');
    const ed = h.wysiwygEditor();
    ed.commands.focus('end');
    for (const ch of '[^7]') {
      const { from, to } = ed.state.selection;
      const handled = ed.view.someProp('handleTextInput', (f: any) => f(ed.view, from, to, ch));
      if (!handled) {ed.view.dispatch(ed.state.tr.insertText(ch, from, to));}
    }
    expect(md(h)).toBe('Start[^7]\n\n[^7]:');
  });

  it('insertFootnote reuses an existing definition when given its label', async () => {
    const h = await load('A.\n\nB.\n\n[^1]: Shared.');
    const ed = h.wysiwygEditor();
    ed.commands.setTextSelection(3);
    ed.commands.insertFootnote('1');
    expect(md(h)).toBe('A.[^1]\n\nB.\n\n[^1]: Shared.');
  });
});
