import { describe, it, expect, afterEach } from 'vitest';
import type { EditorView as PmEditorView } from '@tiptap/pm/view';
import { bootWebview, type Harness } from '../harness/webviewHarness';
import { matchCommands, SLASH_COMMANDS } from '../../src/webview/slashcommands-registry';

/**
 * Integration tests for the slash-command menu (M2), driven through the real
 * webview bundle (same pattern as webviewSourceMode.test.ts): the same TipTap
 * editor the extension host talks to, with real keystrokes and keydowns
 * dispatched through the ProseMirror view so every plugin — including
 * SlashCommands — runs exactly as it would for a live user.
 */

let harness: Harness | null = null;

const settle = () => new Promise((r) => setTimeout(r, 30));

async function boot(content: string): Promise<Harness> {
  harness = await bootWebview();
  harness.send({ type: 'update', content });
  await settle();
  harness.clear();
  return harness;
}

afterEach(() => {
  harness?.dispose();
  harness = null;
});

// ── DOM helpers ─────────────────────────────────────────────────────────────

function menuEl(): HTMLElement | null {
  return document.getElementById('mikedown-slash-menu');
}

function menuCommandIds(): string[] {
  const el = menuEl();
  if (!el) return [];
  return Array.from(el.querySelectorAll('.slash-menu-item')).map(
    (row) => (row as HTMLElement).dataset.command as string
  );
}

function footerEl(): HTMLElement | null {
  return document.getElementById('mikedown-slash-opt-off');
}

function activeCommandId(): string | null {
  const el = menuEl();
  if (!el) return null;
  const active = el.querySelector('.slash-menu-item.is-active') as HTMLElement | null;
  return active ? (active.dataset.command as string) : null;
}

function footerIsActive(): boolean {
  return footerEl()?.classList.contains('is-active') ?? false;
}

// ── Document-scan helpers (find real doc positions instead of hardcoding) ───

function findCodeBlockContentStart(view: PmEditorView, containing: string): number {
  let pos = -1;
  view.state.doc.descendants((node, p) => {
    if (pos < 0 && node.type.name === 'codeBlock' && node.textContent.includes(containing)) {
      pos = p;
    }
  });
  if (pos < 0) throw new Error(`code block not found: ${containing}`);
  return pos + 1; // inside the block, before its first character
}

/** Finds `needle` in a text node, requiring it to carry (or not carry) `markName`. */
function findTextPos(view: PmEditorView, needle: string, markName: string | null): number {
  let pos = -1;
  view.state.doc.descendants((node, p) => {
    if (pos >= 0 || !node.isText || !node.text!.includes(needle)) return;
    const hasMark = markName ? node.marks.some((m) => m.type.name === markName) : node.marks.length === 0;
    if (hasMark) pos = p + node.text!.indexOf(needle);
  });
  if (pos < 0) throw new Error(`text not found: ${needle} (mark ${markName})`);
  return pos;
}

describe('slash menu — opening and filtering', () => {
  it('opens on "/" at the start of a line', async () => {
    const h = await boot('');
    h.typeInWysiwyg('/');
    expect(menuEl()).not.toBeNull();
    expect(menuCommandIds().length).toBe(SLASH_COMMANDS.length);
  });

  it('opens on "/" right after a space', async () => {
    const h = await boot('');
    h.typeInWysiwyg('hi /');
    expect(menuEl()).not.toBeNull();
  });

  it('narrows the filtered list to match the registry as the query grows', async () => {
    const h = await boot('');
    h.typeInWysiwyg('/');
    for (const ch of 'heading1') {
      h.typeInWysiwyg(ch);
      // Position 1 is the "/" itself; the query is everything typed after it.
      const query = h.wysiwygEditor().state.doc.textBetween(2, h.wysiwygEditor().state.selection.from);
      expect(menuCommandIds()).toEqual(matchCommands(query, { hasFrontmatter: false }).map((c) => c.id));
    }
    expect(menuCommandIds()).toEqual(['h1']);
  });
});

describe('slash menu — blocked contexts', () => {
  const DOC = [
    'plain text',
    '',
    '```',
    'plain fence content',
    '```',
    '',
    '```ts',
    'const x = 1;',
    '```',
    '',
    '```mermaid',
    'flowchart TD',
    '```',
    '',
    'has `codeword` and [linktext](http://example.com) and word',
    '',
  ].join('\n');

  async function bootRich() {
    const h = await boot(DOC);
    const view = h.wysiwygEditor().view as PmEditorView;
    return { h, view };
  }

  it('does not open inside a plain fenced code block, at line start', async () => {
    const { h, view } = await bootRich();
    h.setWysiwygCursor(findCodeBlockContentStart(view, 'plain fence content'));
    h.typeInWysiwyg('/x');
    expect(menuEl()).toBeNull();
  });

  it('does not open inside a plain fenced code block, after a space', async () => {
    const { h, view } = await bootRich();
    const start = findCodeBlockContentStart(view, 'plain fence content');
    h.setWysiwygCursor(start + 'plain'.length); // right after "plain", before the space
    h.typeInWysiwyg(' /x');
    expect(menuEl()).toBeNull();
  });

  it('does not open inside a ```ts code block, at line start', async () => {
    const { h, view } = await bootRich();
    h.setWysiwygCursor(findCodeBlockContentStart(view, 'const x = 1;'));
    h.typeInWysiwyg('/x');
    expect(menuEl()).toBeNull();
  });

  it('does not open inside a ```ts code block, after a space', async () => {
    const { h, view } = await bootRich();
    const start = findCodeBlockContentStart(view, 'const x = 1;');
    h.setWysiwygCursor(start + 'const'.length);
    h.typeInWysiwyg(' /x');
    expect(menuEl()).toBeNull();
  });

  it('does not open inside a ```mermaid code block, at line start', async () => {
    const { h, view } = await bootRich();
    h.setWysiwygCursor(findCodeBlockContentStart(view, 'flowchart TD'));
    h.typeInWysiwyg('/x');
    expect(menuEl()).toBeNull();
  });

  it('does not open inside a ```mermaid code block, after a space', async () => {
    const { h, view } = await bootRich();
    const start = findCodeBlockContentStart(view, 'flowchart TD');
    h.setWysiwygCursor(start + 'flowchart'.length);
    h.typeInWysiwyg(' /x');
    expect(menuEl()).toBeNull();
  });

  it('does not open in the middle of inline code', async () => {
    const { h, view } = await bootRich();
    h.setWysiwygCursor(findTextPos(view, 'codeword', 'code') + 4); // between "code" and "word"
    h.typeInWysiwyg('/x');
    expect(menuEl()).toBeNull();
  });

  it('does not open just inside the opening backtick of inline code', async () => {
    const { h, view } = await bootRich();
    h.setWysiwygCursor(findTextPos(view, 'codeword', 'code')); // right before the marked run
    h.typeInWysiwyg('/x');
    expect(menuEl()).toBeNull();
  });

  it('does not open just inside the closing backtick of inline code', async () => {
    const { h, view } = await bootRich();
    h.setWysiwygCursor(findTextPos(view, 'codeword', 'code') + 'codeword'.length); // right after the marked run
    h.typeInWysiwyg('/x');
    expect(menuEl()).toBeNull();
  });

  it('does not open inside a link', async () => {
    const { h, view } = await bootRich();
    h.setWysiwygCursor(findTextPos(view, 'linktext', 'link') + 4);
    h.typeInWysiwyg('/x');
    expect(menuEl()).toBeNull();
  });

  it('does not open mid-word', async () => {
    const { h, view } = await bootRich();
    h.setWysiwygCursor(findTextPos(view, 'word', null) + 2); // between "wo" and "rd"
    h.typeInWysiwyg('/x');
    expect(menuEl()).toBeNull();
  });

  it('does not open in source mode', async () => {
    const h = await boot('');
    h.typeInWysiwyg('/');
    expect(menuEl()).not.toBeNull();
    h.send({ type: 'toggleSource' });
    await settle();
    expect(menuEl()).toBeNull();
  });
});

describe('slash menu — /prop and frontmatter', () => {
  it('shows Properties in a document without frontmatter', async () => {
    const h = await boot('some body text\n');
    h.typeInWysiwyg('/prop');
    expect(menuCommandIds()).toEqual(['properties']);
  });

  it('does not show Properties (or open at all) in a document with frontmatter', async () => {
    const h = await boot('---\ntitle: Hi\n---\nsome body text\n');
    h.typeInWysiwyg('/prop');
    expect(menuEl()).toBeNull();
  });
});

describe('slash menu — exit paths leave the markdown untouched', () => {
  async function openMenu(content = ''): Promise<Harness> {
    const h = await boot(content);
    h.typeInWysiwyg('/h');
    expect(menuEl()).not.toBeNull();
    return h;
  }

  it('Esc closes without changing the document', async () => {
    const h = await openMenu();
    const before = h.wysiwygEditor().storage.markdown.getMarkdown();
    h.pressKeyInWysiwyg('Escape');
    expect(menuEl()).toBeNull();
    expect(h.wysiwygEditor().storage.markdown.getMarkdown()).toBe(before);
  });

  it('clicking away closes without changing the document', async () => {
    const h = await openMenu();
    const before = h.wysiwygEditor().storage.markdown.getMarkdown();
    document.body.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    expect(menuEl()).toBeNull();
    expect(h.wysiwygEditor().storage.markdown.getMarkdown()).toBe(before);
  });

  it('blurring the editor closes without changing the document', async () => {
    const h = await openMenu();
    const before = h.wysiwygEditor().storage.markdown.getMarkdown();
    (h.wysiwygEditor().view as PmEditorView).dom.dispatchEvent(new FocusEvent('blur'));
    expect(menuEl()).toBeNull();
    expect(h.wysiwygEditor().storage.markdown.getMarkdown()).toBe(before);
  });

  it('Backspace past the "/" closes, leaving only the expected single-character delete', async () => {
    // jsdom has no real contentEditable text-editing pipeline, so a synthetic
    // "Backspace" keydown never reaches actual character deletion (that's
    // driven by the browser's native beforeinput handling, which PM's own
    // Backspace keymap only supplements at block boundaries). We drive the
    // exact transaction a real Backspace produces instead — one character
    // deleted at a time — which still runs through the real plugin update().
    const h = await openMenu(); // types "/h"
    const ed = h.wysiwygEditor();
    const afterH = ed.state.selection.from;
    ed.commands.deleteRange({ from: afterH - 1, to: afterH }); // "/h" -> "/"
    expect(menuEl()).not.toBeNull(); // still just the slash, empty query: stays open

    const afterSlash = ed.state.selection.from;
    ed.commands.deleteRange({ from: afterSlash - 1, to: afterSlash }); // "/" -> "" (past the slash)
    expect(menuEl()).toBeNull();
    expect(ed.storage.markdown.getMarkdown().trim()).toBe('');
  });

  it('typing a space with no matches closes, leaving only the expected space insert', async () => {
    const h = await boot('');
    h.typeInWysiwyg('/zzznomatch');
    expect(menuEl()).toBeNull(); // already closed: no matches means no popup at all
    h.typeInWysiwyg(' ');
    expect(menuEl()).toBeNull();
    expect(h.wysiwygEditor().storage.markdown.getMarkdown().trim()).toBe('/zzznomatch');
  });

  it('moving the cursor out of range with the arrow keys closes without changing the document', async () => {
    // jsdom has no real caret, so arrow keys don't move the DOM selection on
    // their own; we move the PM selection directly (what an arrow key would
    // ultimately produce) and confirm the plugin's update() reacts to it —
    // a selection-only transaction, so the document itself cannot change.
    const h = await boot('before\n');
    // Put "/h" at the very end of the existing line, then move away from it.
    h.setWysiwygCursor(h.wysiwygEditor().state.doc.content.size - 1);
    h.typeInWysiwyg(' /h');
    expect(menuEl()).not.toBeNull();
    const before = h.wysiwygEditor().storage.markdown.getMarkdown();
    h.setWysiwygCursor(1); // back to the very start of the document — well outside [from, to]
    expect(menuEl()).toBeNull();
    expect(h.wysiwygEditor().storage.markdown.getMarkdown()).toBe(before);
  });

  it('after Esc, typing another character does not reopen the menu for that "/"', async () => {
    const h = await openMenu();
    h.pressKeyInWysiwyg('Escape');
    expect(menuEl()).toBeNull();
    h.typeInWysiwyg('1');
    expect(menuEl()).toBeNull();
  });
});

describe('slash menu — insertion and undo', () => {
  const cases: Array<[string, string, (ed: any) => boolean]> = [
    ['/h1', 'h1', (ed) => ed.isActive('heading', { level: 1 })],
    ['/h2', 'h2', (ed) => ed.isActive('heading', { level: 2 })],
    ['/h3', 'h3', (ed) => ed.isActive('heading', { level: 3 })],
    ['/h4', 'h4', (ed) => ed.isActive('heading', { level: 4 })],
    ['/h5', 'h5', (ed) => ed.isActive('heading', { level: 5 })],
    ['/h6', 'h6', (ed) => ed.isActive('heading', { level: 6 })],
    ['/text', 'text', (ed) => ed.isActive('paragraph') && !ed.isActive('heading')],
  ];

  for (const [query, label, isActive] of cases) {
    it(`${query} at line start converts the block (${label})`, async () => {
      const h = await boot('');
      h.typeInWysiwyg(query);
      expect(menuEl()).not.toBeNull();
      h.pressKeyInWysiwyg('Enter');
      expect(menuEl()).toBeNull();
      expect(isActive(h.wysiwygEditor())).toBe(true);
    });
  }

  it('Cmd+Z undoes a slash insertion in one step, restoring "/h2" exactly', async () => {
    const h = await boot('');
    h.typeInWysiwyg('/h2');
    h.pressKeyInWysiwyg('Enter');
    expect(h.wysiwygEditor().isActive('heading', { level: 2 })).toBe(true);

    h.wysiwygEditor().commands.undo();

    expect(h.wysiwygEditor().isActive('heading')).toBe(false);
    expect(h.wysiwygEditor().storage.markdown.getMarkdown().trim()).toBe('/h2');
  });
});

describe('slash menu — footer row', () => {
  /** Does not assert the menu opened: some callers deliberately pass a
   *  no-match query to confirm Enter/footer checks hold vacuously too. */
  async function openMenu(query: string): Promise<Harness> {
    const h = await boot('');
    h.typeInWysiwyg('/' + query);
    return h;
  }

  it('is never in the filtered match list, for several queries', async () => {
    // Queries with no real matches (e.g. "off") close the popup entirely
    // (see slashcommands.ts: "no empty state: just close"), so the footer
    // never renders standalone either — only pick queries with real matches.
    for (const query of ['', 'h', 'date']) {
      const h = await openMenu(query);
      expect(menuEl()).not.toBeNull();
      expect(menuCommandIds()).not.toContain('off');
      h.dispose();
    }
  });

  it('is not the active row on open', async () => {
    const h = await openMenu('h');
    expect(menuEl()).not.toBeNull();
    expect(footerIsActive()).toBe(false);
    expect(activeCommandId()).not.toBeNull();
  });

  it('is not the active row right after typing', async () => {
    const h = await openMenu('');
    h.typeInWysiwyg('h');
    expect(menuEl()).not.toBeNull();
    expect(footerIsActive()).toBe(false);
  });

  it('Enter on a filtered query never selects the footer', async () => {
    // "tur"/"off" match nothing in the registry, so the popup never opens for
    // them at all (see the previous test) — Enter is then a no-op. Kept
    // alongside "h" (which does open, and does execute a real command) so
    // the footer's saveSettings message is verified never to fire either way.
    for (const query of ['h', 'tur', 'off']) {
      const h = await openMenu(query);
      h.pressKeyInWysiwyg('Enter');
      expect(menuEl()).toBeNull();
      expect(h.last('saveSettings')).toBeUndefined();
      h.dispose();
    }
  });

  it('ArrowDown past the last command reaches the footer', async () => {
    const h = await openMenu('h1'); // single match: h1
    expect(menuEl()).not.toBeNull();
    h.pressKeyInWysiwyg('ArrowDown'); // h1 -> footer
    expect(footerIsActive()).toBe(true);
  });

  it('choosing the footer via keyboard closes the menu, leaves the markdown untouched, and posts saveSettings', async () => {
    const h = await openMenu('h1');
    expect(menuEl()).not.toBeNull();
    const before = h.wysiwygEditor().storage.markdown.getMarkdown();
    h.pressKeyInWysiwyg('ArrowDown'); // -> footer
    h.pressKeyInWysiwyg('Enter');
    expect(menuEl()).toBeNull();
    expect(h.wysiwygEditor().storage.markdown.getMarkdown()).toBe(before);
    const saved = h.last('saveSettings');
    expect(saved).toBeDefined();
    expect(saved.settings).toEqual({ slashCommandsEnabled: false });
    expect(saved.source).toBe('slashMenu');
  });

  it('choosing the footer via click closes the menu, leaves the markdown untouched, and posts saveSettings', async () => {
    const h = await openMenu('h1');
    expect(menuEl()).not.toBeNull();
    const before = h.wysiwygEditor().storage.markdown.getMarkdown();
    const footer = footerEl()!;
    footer.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
    expect(menuEl()).toBeNull();
    expect(h.wysiwygEditor().storage.markdown.getMarkdown()).toBe(before);
    const saved = h.last('saveSettings');
    expect(saved).toBeDefined();
    expect(saved.settings).toEqual({ slashCommandsEnabled: false });
    expect(saved.source).toBe('slashMenu');
  });
});
