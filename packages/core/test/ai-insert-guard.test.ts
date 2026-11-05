/**
 * S8: Insert at cursor through the editor's real wiring, parser and options, in
 * rich text and source mode. Nothing but a citation link or a URL verbatim in a
 * cited section may reach the document live, whatever the first pass let through.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { undo as cmUndo } from '@codemirror/commands';
import { EditorView as CmEditorView } from '@codemirror/view';
import { DOMParser as PmDOMParser, Fragment, Schema } from '@tiptap/pm/model';
import type { Editor } from '@tiptap/core';
import { createMikeDownEditor, NoopHost, type MikeDownEditorHandle } from '../src/index';
import { parseAiSettings, prepareInsertMarkdown, type MikeDownAiHost } from '../src/ai';
import { registerAiUi } from '../src/ai-lite';
import * as aiUi from '../src/ai-ui';
import { guardInsertFragment, guardSourceMarkdown, type InsertGuardParser, type SourceInspector } from '../src/ai-insert-guard';
import type { AiChatPanelOptions } from '../src/ai-chat-panel';
import { sourceCursorTarget } from '../src/ai-rewrite';
import { answered, ask, fakeChat, mount as mountPanel, settle, status, unmountPanels } from './helpers/ai-chat-fakes';
import { stubLayoutMeasurement } from '../../../test/harness/webviewHarness';

stubLayoutMeasurement();

const section = (n: number, relPath: string, slug: string, heading: string, text: string) => ({
  n,
  baseId: 'b',
  section: { id: `docs/${relPath}#${slug}`, pageId: `docs/${relPath}`, title: heading, relPath, heading, text, truncated: false },
});
const BENIGN = [section(1, 'a.md', 'x', 'X', 'just text')];
const LOCATION = { root: 'docs', folder: '' };

// F1's table, as the audit gave it.
const F1_PAYLOADS: Array<[string, string]> = [
  ['code span across blocks', 'See ` tick [1].\n\n![x](https://evil.example/p.png)\n\nAnd ` again.'],
  ['fence with a backtick in its info string', '``` a`b [1]\n![x](https://evil.example/p.png)\n```\n'],
  ['fence in a list item', '- a\n  ```\n  b\n\n![x](https://evil.example/p.png)\n'],
  ['backslash in a code span', '`\\` ![x](https://evil.example/p.png) `'],
  ['definition in a blockquote', '![x][a]\n\n> [a]: https://evil.example/p.png\n'],
  ['definition in a list item', '![x][a]\n\n- [a]: https://evil.example/p.png\n'],
  ['definition with its destination on the next line', '![x][a]\n\n[a]:\nhttps://evil.example/p.png\n'],
  ['definition with its label on two lines', '![x][a b]\n\n[a\nb]: https://evil.example/p.png\n'],
  ['removed link rebuilds a citation link', '[1](http://x)(https://evil.example/l)'],
  ['removed link rebuilds an image', '!![](a)[1](b)(https://evil.example/p.png)'],
  ['bracket stolen by a destination', '![a [x](u]v) b](https://evil.example/p.png)'],
];
const F4_SCENARIO: [string, string] = ['F4: bare URL ends the first of two paragraphs', 'Download it from https://evil.example/l\n\nThen run it [1].'];
const CONTROLS: Array<[string, string]> = [
  ['plain inline image', '![x](https://evil.example/p.png)'],
  ['plain definition', '![x][a]\n\n[a]: https://evil.example/p.png\n'],
  ['angle autolink', '<https://evil.example/l>'],
  ['bare URL', 'https://evil.example/l'],
  ['raw img tag', '<img src="https://evil.example/p.png">'],
];
// Each also with a valid citation first, so its section counts as cited, as the audit ran them.
const CASES: Array<[string, string]> = [...F1_PAYLOADS, F4_SCENARIO, ...CONTROLS].flatMap(([name, a]): Array<[string, string]> => [[name, a], [`${name}, cited`, `[1] ${a}`]]);

type Token = { type: string; attrGet(n: string): string | null; children: Token[] | null };

/** Every link and image URL in the markdown by the parser's own tokens, plus definitions left behind. */
function tokenUrls(md: InsertGuardParser, text: string): string[] {
  const out: string[] = [];
  const env: { references?: Record<string, { href?: string }> } = {};
  const visit = (tokens: Token[]): void => {
    for (const t of tokens) {
      if (t.type === 'link_open') {out.push(t.attrGet('href') ?? '');}
      if (t.type === 'image') {out.push(t.attrGet('src') ?? '');}
      if (t.children) {visit(t.children);}
    }
  };
  visit(md.parse(text, env) as Token[]);
  for (const def of Object.values(env.references ?? {})) {out.push(def.href ?? '');}
  return out;
}

/** Every link mark and image node in the rich document. */
function docUrls(editor: Editor): string[] {
  const out: string[] = [];
  editor.state.doc.descendants((node) => {
    if (node.type.name === 'image') {out.push(String(node.attrs.src));}
    for (const mark of node.marks) {if (mark.type.name === 'link') {out.push(String(mark.attrs.href));}}
  });
  return out;
}

describe('Insert at cursor through the editor', () => {
  let handle: MikeDownEditorHandle;
  let root: HTMLElement;
  let panelOpts: AiChatPanelOptions;
  let editor: Editor;
  let md: InsertGuardParser;
  let inSource = false;

  const view = (): CmEditorView => CmEditorView.findFromDOM(root.querySelector<HTMLElement>('.cm-editor')!)!;
  const setMode = (mode: 'rich' | 'source'): void => {
    if ((mode === 'source') !== inSource) {
      handle.command('toggleSource');
      inSource = !inSource;
    }
  };
  /** Fresh document, then the mode. In source mode the caret goes to `caretAtEnd`. */
  const start = (mode: 'rich' | 'source', doc = ''): void => {
    setMode('rich');
    handle.setMarkdown(doc, { pristine: true });
    setMode(mode);
    if (mode === 'source') {view().dispatch({ selection: { anchor: view().state.doc.length } });}
    else if (doc) {editor.commands.focus('end');}
  };
  const insert = (answer: string, sources = BENIGN, location: { root: string; folder: string } | null = null): boolean => {
    const { markdown, policy } = prepareInsertMarkdown(answer, sources, location);
    return panelOpts.insertAtCursor(markdown, policy);
  };
  /** The live URLs by every reading of the result: nodes and marks now or after a mode switch, tokens of what is saved. */
  const liveUrls = (mode: 'rich' | 'source'): string[] => {
    const urls = [...tokenUrls(md, mode === 'source' ? view().state.doc.toString() : handle.getMarkdown())];
    if (mode === 'rich') {urls.push(...docUrls(editor));}
    setMode(mode === 'rich' ? 'source' : 'rich');
    if (mode === 'source') {urls.push(...docUrls(editor));}
    else {urls.push(...tokenUrls(md, view().state.doc.toString()));}
    setMode(mode);
    return urls;
  };

  beforeAll(() => {
    registerAiUi({
      ...aiUi,
      mountAiChatPanel: (dock: HTMLElement, opts: AiChatPanelOptions) => {
        panelOpts = opts;
        return aiUi.mountAiChatPanel(dock, opts);
      },
    } as typeof aiUi);
    class Host extends NoopHost { ai = { complete: vi.fn(), listEngines: vi.fn(async () => []) } as unknown as MikeDownAiHost; }
    root = document.createElement('div');
    document.body.append(root);
    handle = createMikeDownEditor(root, { host: new Host(), settings: { ai: parseAiSettings({ enabled: true }, { onWarning: () => {} }) } });
    handle.command('aiChat');
    editor = (root.querySelector('.ProseMirror') as unknown as { editor: Editor }).editor;
    md = (editor.storage as unknown as { markdown: { parser: { md: InsertGuardParser } } }).markdown.parser.md;
  });

  afterAll(() => {
    handle.destroy();
    root.remove();
    registerAiUi(aiUi);
  });

  it('judges with the options the editor parses with', () => {
    expect(panelOpts).toBeDefined();
    expect((md as unknown as { options: Record<string, unknown> }).options).toMatchObject({ html: false, linkify: false, breaks: true });
  });

  describe.each(['rich', 'source'] as const)('%s', (mode) => {
    it.each(CASES)('nothing live from: %s', (_name, answer) => {
      start(mode);
      expect(insert(answer)).toBe(true);
      expect(liveUrls(mode)).toEqual([]);
    });

    it.each(CASES)('only the citation link is live next to: %s', (_name, answer) => {
      start(mode);
      expect(insert(`Fact [1].\n\n${answer}`, BENIGN, LOCATION)).toBe(true);
      const live = liveUrls(mode);
      expect(live.filter((u) => u !== 'a.md#x')).toEqual([]);
    });

    it('a citation link and a verbatim cited URL stay live, and the answer reads as before', () => {
      const cited = [section(1, 'guides/key rotation.md', 'rot', 'Rotation', 'See https://ok.example/guide and https://ok.example/p.png here.')];
      start(mode);
      expect(insert('Rotate [1]. [Guide](https://ok.example/guide) ![pic](https://ok.example/p.png)', cited, LOCATION)).toBe(true);
      expect(new Set(liveUrls(mode))).toEqual(new Set(['guides/key%20rotation.md#rot', 'https://ok.example/guide', 'https://ok.example/p.png']));
    });

    it('URLs the parser normalizes still match: a non-ASCII citation path and a non-ASCII verbatim URL', () => {
      const cited = [section(1, 'çà/é.md', 'é', 'É', 'At https://ok.example/é and https://münchen.example/p.')];
      start(mode);
      expect(insert('Yes [1]. [a](https://ok.example/é) [b](https://münchen.example/p)', cited, LOCATION)).toBe(true);
      expect(new Set(liveUrls(mode))).toEqual(new Set(['%C3%A7%C3%A0/%C3%A9.md#%C3%A9', 'https://ok.example/%C3%A9', 'https://xn--mnchen-3ya.example/p']));
    });

    it('a URL extended past what the section has is not verbatim', () => {
      const cited = [section(1, 'a.md', 'x', 'X', 'See https://ok.example/p.png here.')];
      start(mode);
      expect(insert('[1] `\\` ![x](https://ok.example/p.png?d=SECRET) `', cited)).toBe(true);
      expect(liveUrls(mode)).toEqual([]);
    });

    it('an ordinary answer goes in with one undo step', () => {
      start(mode, 'Before.');
      const before = mode === 'rich' ? handle.getMarkdown() : view().state.doc.toString();
      expect(insert('## Key rotation\n\n- rotate **often** [1]\n- `code` and ~~old~~\n\n```js\nconst a = "[x](y)";\n```\n', BENIGN, LOCATION)).toBe(true);
      const after = mode === 'rich' ? handle.getMarkdown() : view().state.doc.toString();
      expect(after).toContain('## Key rotation');
      expect(after).toContain('[X](a.md#x)');
      expect(after).toContain('const a = "[x](y)";');
      expect(after).toContain('**often**');
      if (mode === 'rich') {
        editor.commands.undo();
        expect(handle.getMarkdown()).toBe(before);
      } else {
        cmUndo(view());
        expect(view().state.doc.toString()).toBe(before);
      }
    });
  });

  describe('rich text', () => {
    it('a dropped link keeps its text, a dropped image becomes alt text plus URL', () => {
      start('rich');
      expect(insert('![a [x](u]v) b](https://evil.example/p.png)')).toBe(true);
      const text = editor.state.doc.textContent;
      expect(text).toContain('https://evil.example/p.png');
      start('rich');
      expect(insert('[1](http://x)(https://evil.example/l)')).toBe(true);
      expect(editor.state.doc.textContent).toContain('1');
      expect(docUrls(editor)).toEqual([]);
    });

    it('F4: the plain URL stays plain on insert and after an edit elsewhere in the paragraph', () => {
      start('rich');
      expect(insert(F4_SCENARIO[1])).toBe(true);
      expect(docUrls(editor)).toEqual([]);
      expect(editor.state.doc.textContent).toContain('https://evil.example/l');
      editor.view.dispatch(editor.state.tr.insertText('Now ', 1));
      expect(docUrls(editor)).toEqual([]);
    });

    it('F4: the plain URL stays plain when the saved text is loaded again', () => {
      start('rich');
      expect(insert(F4_SCENARIO[1])).toBe(true);
      const saved = handle.getMarkdown();
      expect(saved).toContain('https://evil.example/l');
      expect(saved).not.toContain('<https');
      handle.setMarkdown('', { pristine: true });
      handle.setMarkdown(saved, { pristine: true });
      expect(docUrls(editor)).toEqual([]);
      expect(handle.getMarkdown()).toBe(saved);
    });
  });

  describe('source mode', () => {
    it('a fence that would close the one the caret is in cannot make its content live', () => {
      start('source', '```\ncode\n\n');
      expect(insert('```\n![x](https://evil.example/p.png)\n```')).toBe(true);
      expect(tokenUrls(md, view().state.doc.toString())).toEqual([]);
    });

    it("the document's own links do not make an ordinary insert count as affected", () => {
      start('source', '[mine](https://mine.example/x)\n\n');
      expect(insert('Plain *answer*.')).toBe(true);
      expect(view().state.doc.toString()).toBe('[mine](https://mine.example/x)\n\nPlain *answer*.');
    });

    it('a part that is clean keeps its citation link when another is escaped', () => {
      start('source');
      expect(insert('Fact [1].\n\n![x][a]\n\n> [a]: https://evil.example/p.png\n', BENIGN, LOCATION)).toBe(true);
      expect(tokenUrls(md, view().state.doc.toString())).toEqual(['a.md#x']);
    });

    it('a target with no parser to judge by refuses a guarded insert, and only a guarded one', () => {
      start('source');
      const { markdown, policy } = prepareInsertMarkdown('Fact.', BENIGN, null);
      const target = sourceCursorTarget(view());
      expect(target.accept(markdown, policy)).toBe(false);
      expect(target.accept(markdown)).toBe(true);
    });
  });

  describe('every other caller of the target', () => {
    const LIVE_IMAGE = '![x](https://evil.example/p.png)';

    it('rich text: no policy, no walk and no autolink block', () => {
      start('rich');
      const target = aiUi.cursorInsertTarget(editor)!;
      expect(target.accept(`Download https://other.example/l\n\n${LIVE_IMAGE}`)).toBe(true);
      expect(docUrls(editor)).toEqual(['https://other.example/l', 'https://evil.example/p.png']);
    });

    it('source mode: no policy, inserted as given', () => {
      start('source');
      const target = aiUi.sourceCursorTarget(view());
      expect(target.accept(LIVE_IMAGE)).toBe(true);
      expect(view().state.doc.toString()).toBe(LIVE_IMAGE);
    });
  });

  describe('the walk', () => {
    const parsed = (text: string): Fragment => {
      const div = document.createElement('div');
      div.innerHTML = (editor.storage as unknown as { markdown: { parser: { parse(s: string): string } } }).markdown.parser.parse(text);
      return aiPmParser().parse(div).content;
    };
    const aiPmParser = () => PmDOMParser.fromSchema(editor.state.schema);
    const none = { link: () => false, image: () => false };
    const all = { link: () => true, image: () => true };

    it('keeps the very same fragment when nothing is dropped', () => {
      const content = parsed('# T\n\n> [!NOTE]\n> quoted **b** ==h== :smile: $x$ [^1]\n\n[^1]: foot\n\n- [ ] t\n\n|a|\n|-|\n|b|\n\n```js\nx\n```\n\n---\n');
      const out = guardInsertFragment(content, none)!;
      expect(out.dropped).toEqual([]);
      expect(out.fragment).toBe(content);
    });

    it('raw HTML is text under html: false; no tag survives as a node or mark', () => {
      const content = parsed('<img src="https://evil.example/p.png"> <a href="https://evil.example/l">x</a> <script>bad()</script> <iframe src="https://evil.example/f"></iframe>\n\n<div>block</div>\n');
      const out = guardInsertFragment(content, none)!;
      expect(out.dropped).toEqual([]);
      expect(out.fragment).toBe(content);
      const types = new Set<string>();
      content.descendants((n) => { types.add(n.type.name); });
      expect([...types].sort()).toEqual(['paragraph', 'text']);
    });

    it('editor nodes off the allow-list become text, even with every URL allowed', () => {
      const out = guardInsertFragment(parsed('[[Other page]] <a id="x"></a> end\n\n<!-- toc -->\n- [A](https://evil.example/toc)\n<!-- tocstop -->\n'), all)!;
      const types = new Set<string>();
      out.fragment.descendants((n) => { types.add(n.type.name); });
      expect([...types].sort()).toEqual(['paragraph', 'text']);
      expect(out.fragment.textBetween(0, out.fragment.size, '\n')).toBe('Other page  end\n- [A](https://evil.example/toc)');
    });

    it('a node or mark type added later is not live by default', () => {
      const schema = new Schema({
        nodes: {
          doc: { content: 'block+' },
          paragraph: { group: 'block', content: 'inline*' },
          text: { group: 'inline' },
          video: { group: 'inline', inline: true, atom: true, attrs: { src: {} } },
          embed: { group: 'block', content: 'inline*' },
        },
        marks: { tracked: { attrs: { href: {} } }, bold: {} },
      });
      const { paragraph, video, embed } = schema.nodes;
      const content = Fragment.fromArray([
        paragraph.create(null, [schema.text('a', [schema.marks.tracked.create({ href: 'https://evil.example/m' })]), schema.text('b', [schema.marks.bold.create()]), video.create({ src: 'https://evil.example/v' })]),
        embed.create(null, schema.text('inside')),
      ]);
      const out = guardInsertFragment(content, all)!;
      const types: string[] = [];
      const marks = new Set<string>();
      out.fragment.descendants((n) => {
        types.push(n.type.name);
        for (const m of n.marks) {marks.add(m.type.name);}
      });
      expect(types.filter((t) => t !== 'text')).toEqual(['paragraph', 'paragraph']);
      expect([...marks]).toEqual(['bold']);
      expect(out.dropped.some((d) => d.startsWith('node:video'))).toBe(true);
      expect(out.dropped).toContain('mark:tracked');
      expect(out.fragment.textBetween(0, out.fragment.size, '\n')).toBe('ab\ninside');
    });

    it('an image in a link: each is judged, so neither carries the other through', () => {
      const out = guardInsertFragment(parsed('[![x](https://evil.example/p.png)](https://good.example/l)'), { link: () => true, image: () => false })!;
      const urls: string[] = [];
      out.fragment.descendants((n) => {
        if (n.type.name === 'image') {urls.push('image');}
        for (const m of n.marks) {urls.push(String(m.attrs.href));}
      });
      expect(urls).toEqual(['https://good.example/l']);
      expect(out.fragment.textBetween(0, out.fragment.size)).toBe('x https://evil.example/p.png');
    });
  });

  describe('source text fallbacks', () => {
    const inspector = (dirtyWhile: (text: string) => boolean): SourceInspector => ({
      check: { link: () => true, image: () => true },
      md,
      fragment: (text) => (dirtyWhile(text) ? Fragment.fromArray([editor.schema.nodes.paragraph.create(null, editor.schema.nodes.wikilink.create({ target: 't' }))]) : Fragment.empty),
    });

    it('escapes an existing backslash too, so `\\[` cannot cancel the escape', () => {
      const out = guardSourceMarkdown('\\[x](https://evil.example/l) ![y](https://evil.example/p.png)', { ...inspector(() => false), check: { link: () => false, image: () => false } })!;
      expect(tokenUrls(md, out)).toEqual([]);
      expect(out).toContain('\\\\\\[x\\]');
    });

    it('falls back to escaping all punctuation, then refuses', () => {
      const out = guardSourceMarkdown('*a* [b] c', inspector((t) => /(^|[^\\])\*/.test(t)));
      expect(out).toBe('\\*a\\* \\[b\\] c');
      expect(guardSourceMarkdown('*a*', inspector(() => true))).toBeNull();
    });
  });
});

describe('the chat panel', () => {
  it('hands the policy to the insert: citations from what was sent, texts from what was cited', async () => {
    const insertAtCursor = vi.fn((_md: string, _policy: unknown) => true);
    const list = [section(1, 'a.md', 'x', 'X', 'cited text'), section(2, 'b.md', 'y', 'Y', 'uncited text')];
    const { container, input } = mountPanel({
      chat: fakeChat(async () => answered('Yes [1].', list)),
      docs: { listBases: async () => [status('b', '/kb', 'docs')] } as never,
      insertAtCursor,
      documentFolder: () => '/kb',
    });
    await settle();
    await ask(input, 'q');
    container.querySelector<HTMLElement>('[data-fk="chat:insert"]')!.click();
    expect(insertAtCursor.mock.calls[0][1]).toEqual({ citationHrefs: ['a.md#x', 'b.md#y'], citedTexts: ['cited text'] });
    unmountPanels();
  });
});
