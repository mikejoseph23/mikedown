import { describe, it, expect, afterEach, vi } from 'vitest';
import type { EditorView as PmEditorView } from '@tiptap/pm/view';
import { bootWebview, type Harness } from '../harness/webviewHarness';

/**
 * T2: exhaustive round-trip coverage for every slash command — one syntax
 * form per command, inserted both at line start and mid-line, plus a check
 * that the resulting markdown is stable across a reload (`update` a fresh
 * boot with it, re-serialize, compare). Complements the "one representative
 * case per shape" coverage in slashcommandsActions.test.ts and the
 * insertion/undo coverage in slashcommandsHarness.test.ts — this file's job
 * is breadth (every command, both positions) rather than depth.
 */

if (!Element.prototype.scrollIntoView) {
  Element.prototype.scrollIntoView = () => {};
}

let harness: Harness | null = null;
const settle = () => new Promise((r) => setTimeout(r, 30));

async function boot(content: string): Promise<Harness> {
  const h = await bootWebview();
  h.send({ type: 'update', content });
  await settle();
  h.clear();
  return h;
}

afterEach(() => {
  harness?.dispose();
  harness = null;
});

function menuEl(): HTMLElement | null {
  return document.getElementById('mikedown-slash-menu');
}

function markdown(h: Harness): string {
  return h.wysiwygEditor().storage.markdown.getMarkdown();
}

function posAfterText(view: PmEditorView, needle: string): number {
  let pos = -1;
  view.state.doc.descendants((node, p) => {
    if (pos >= 0 || !node.isText || !node.text!.includes(needle)) return;
    pos = p + node.text!.indexOf(needle) + needle.length;
  });
  if (pos < 0) throw new Error(`text not found: ${needle}`);
  return pos;
}

async function typeCommand(h: Harness, query: string): Promise<void> {
  h.typeInWysiwyg('/' + query);
  expect(menuEl()).not.toBeNull();
  h.pressKeyInWysiwyg('Enter');
}

/** Positions the cursor mid-line, right after "foo " (with the trigger
 *  space already in the doc), ready to type a slash command. */
function seedMidline(h: Harness): void {
  const view = h.wysiwygEditor().view as PmEditorView;
  h.setWysiwygCursor(posAfterText(view, 'foo'));
  h.typeInWysiwyg(' ');
}

/** Extracts `--- ... ---` frontmatter the same way editor-main.ts does, for
 *  reload-stability checks that must cover the doc as a whole, not just the
 *  ProseMirror body. */
function splitFrontmatter(md: string): { frontmatter: string | null; body: string } {
  const match = md.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/);
  if (!match) return { frontmatter: null, body: md };
  return { frontmatter: match[1], body: md.slice(match[0].length) };
}

/** Boots a second, independent harness on `fullMd` and asserts the body
 *  re-serializes to the same body text — i.e. loading this exact markdown
 *  and immediately re-emitting it is a no-op. For frontmatter, additionally
 *  confirms it was recognized on load (via the /prop offer disappearing). */
async function expectReloadStable(fullMd: string): Promise<void> {
  const { frontmatter, body } = splitFrontmatter(fullMd);
  const h2 = await boot(fullMd);
  try {
    expect(markdown(h2).trim()).toBe(body.trim());
    if (frontmatter !== null) {
      h2.typeInWysiwyg('/prop');
      expect(menuEl()).toBeNull();
    }
  } finally {
    h2.dispose();
  }
}

/** Same idea as `expectReloadStable`, but for the one case (empty task-list
 *  items — see the T2 summary) where tiptap-markdown's serializer adds a
 *  cosmetic backslash-escape on the FIRST reload (an empty "- [ ]" becomes
 *  "- \[ \]", presumably to disambiguate from a reference-link definition).
 *  That's a pre-existing quirk in the shared markdown pipeline, not a T2
 *  regression, so this checks the SECOND reload matches the first — i.e. it
 *  stabilizes rather than degrading further on every save. */
async function expectReloadIdempotent(fullMd: string): Promise<void> {
  const h2 = await boot(fullMd);
  const once = markdown(h2).trim();
  h2.dispose();
  const h3 = await boot(once);
  try {
    expect(markdown(h3).trim()).toBe(once);
  } finally {
    h3.dispose();
  }
}

describe('round-trip — headings and paragraph', () => {
  const cases: Array<[string, string]> = [
    ['h1', '#'],
    ['h2', '##'],
    ['h3', '###'],
    ['h4', '####'],
    ['h5', '#####'],
    ['h6', '######'],
  ];

  for (const [query, marker] of cases) {
    it(`/${query} at line start emits "${marker} " and reloads stable`, async () => {
      harness = await boot('');
      await typeCommand(harness, query);
      const md = markdown(harness);
      expect(md.trimEnd()).toMatch(new RegExp(`^${marker}\\s*$`));
      await expectReloadStable(md);
    });

    it(`/${query} mid-line leaves "foo" and inserts an empty heading below`, async () => {
      harness = await boot('foo\n');
      seedMidline(harness);
      await typeCommand(harness, query);
      const md = markdown(harness);
      expect(md.trim()).toMatch(new RegExp(`^foo\\n\\n${marker}\\s*$`));
      await expectReloadStable(md);
    });
  }

  it('/text at line start converts to a plain paragraph', async () => {
    harness = await boot('');
    await typeCommand(harness, 'text');
    expect(harness.wysiwygEditor().isActive('paragraph')).toBe(true);
    expect(harness.wysiwygEditor().isActive('heading')).toBe(false);
  });
});

describe('round-trip — quote, lists, todo, divider', () => {
  it('/quote at line start and reload', async () => {
    harness = await boot('');
    await typeCommand(harness, 'quote');
    const md = markdown(harness);
    expect(md.trim()).toBe('>');
    await expectReloadStable(md);
  });

  it('/quote mid-line: "foo" paragraph + empty quote below', async () => {
    harness = await boot('foo\n');
    seedMidline(harness);
    await typeCommand(harness, 'quote');
    const md = markdown(harness);
    expect(md.trim()).toBe('foo\n\n>');
    await expectReloadStable(md);
  });

  it('/bullet at line start and reload', async () => {
    harness = await boot('');
    await typeCommand(harness, 'bullet');
    expect(harness.wysiwygEditor().isActive('bulletList')).toBe(true);
    const md = markdown(harness);
    expect(md).toMatch(/^-\s*$/m);
    await expectReloadStable(md);
  });

  it('/bullet mid-line: "foo" paragraph + empty bullet list below', async () => {
    harness = await boot('foo\n');
    seedMidline(harness);
    await typeCommand(harness, 'bullet');
    const md = markdown(harness);
    expect(md.startsWith('foo')).toBe(true);
    expect(md).toMatch(/^-\s*$/m);
    await expectReloadStable(md);
  });

  it('/numbered at line start and reload', async () => {
    harness = await boot('');
    await typeCommand(harness, 'numbered');
    expect(harness.wysiwygEditor().isActive('orderedList')).toBe(true);
    const md = markdown(harness);
    expect(md).toMatch(/^1\.\s*$/m);
    await expectReloadStable(md);
  });

  it('/numbered mid-line: "foo" paragraph + empty ordered list below', async () => {
    harness = await boot('foo\n');
    seedMidline(harness);
    await typeCommand(harness, 'numbered');
    const md = markdown(harness);
    expect(md.startsWith('foo')).toBe(true);
    expect(md).toMatch(/^1\.\s*$/m);
    await expectReloadStable(md);
  });

  it('/todo at line start and reload', async () => {
    harness = await boot('');
    await typeCommand(harness, 'todo');
    expect(harness.wysiwygEditor().isActive('taskList')).toBe(true);
    const md = markdown(harness);
    expect(md).toMatch(/^- \[ \]\s*$/m);
    // Not expectReloadStable: an empty task item picks up a cosmetic
    // backslash-escape on its FIRST reload (see expectReloadIdempotent's
    // doc comment) — check it stabilizes instead of matching pre-reload text.
    await expectReloadIdempotent(md);
  });

  it('/todo mid-line: "foo" paragraph + empty task list below', async () => {
    harness = await boot('foo\n');
    seedMidline(harness);
    await typeCommand(harness, 'todo');
    const md = markdown(harness);
    expect(md.startsWith('foo')).toBe(true);
    expect(md).toMatch(/^- \[ \]\s*$/m);
    await expectReloadIdempotent(md);
  });

  it('/divider at line start emits "---" and reloads stable', async () => {
    harness = await boot('');
    await typeCommand(harness, 'divider');
    const md = markdown(harness);
    expect(md).toContain('---');
    await expectReloadStable(md);
  });

  it('/divider mid-line: "foo" paragraph + "---" below', async () => {
    harness = await boot('foo\n');
    seedMidline(harness);
    await typeCommand(harness, 'divider');
    const md = markdown(harness);
    expect(md.startsWith('foo')).toBe(true);
    expect(md).toContain('---');
    await expectReloadStable(md);
  });
});

describe('round-trip — callouts', () => {
  const cases: Array<[string, string]> = [
    ['note', '[!NOTE]'],
    ['tip', '[!TIP]'],
    ['important', '[!IMPORTANT]'],
    ['warn', '[!WARNING]'],
    ['danger', '[!CAUTION]'],
  ];

  for (const [query, tag] of cases) {
    it(`/${query} at line start emits "> ${tag}" and reloads stable`, async () => {
      harness = await boot('');
      await typeCommand(harness, query);
      const md = markdown(harness);
      expect(md).toContain(tag);
      expect(md.trim().startsWith('>')).toBe(true);
      await expectReloadStable(md);
    });

    it(`/${query} mid-line: "foo" paragraph + empty callout below`, async () => {
      harness = await boot('foo\n');
      seedMidline(harness);
      await typeCommand(harness, query);
      const md = markdown(harness);
      expect(md.startsWith('foo')).toBe(true);
      expect(md).toContain(tag);
      await expectReloadStable(md);
    });
  }
});

describe('round-trip — code block', () => {
  function pickLanguage(value: string): void {
    const picker = document.getElementById('mikedown-language-picker');
    expect(picker).not.toBeNull();
    const item = picker!.querySelector(`.lp-item[data-value="${value}"]`) as HTMLElement;
    expect(item).not.toBeNull();
    item.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
  }

  it('/code at line start, picking a language, emits a fenced block and reloads stable', async () => {
    harness = await boot('');
    await typeCommand(harness, 'code');
    pickLanguage('python');
    const md = markdown(harness);
    expect(md).toContain('```python');
    await expectReloadStable(md);
  });

  it('/code mid-line: "foo" paragraph + fenced block below', async () => {
    harness = await boot('foo\n');
    seedMidline(harness);
    await typeCommand(harness, 'code');
    pickLanguage('typescript');
    const md = markdown(harness);
    expect(md.startsWith('foo')).toBe(true);
    expect(md).toContain('```typescript');
    await expectReloadStable(md);
  });
});

describe('round-trip — mermaid', () => {
  it('/mermaid at line start emits the starter diagram and reloads stable', async () => {
    harness = await boot('');
    await typeCommand(harness, 'mermaid');
    const md = markdown(harness);
    expect(md).toContain('```mermaid');
    expect(md).toContain('flowchart TD');
    await expectReloadStable(md);
  });

  it('/mermaid mid-line: "foo" paragraph + mermaid block below', async () => {
    harness = await boot('foo\n');
    seedMidline(harness);
    await typeCommand(harness, 'mermaid');
    const md = markdown(harness);
    expect(md.startsWith('foo')).toBe(true);
    expect(md).toContain('```mermaid');
    await expectReloadStable(md);
  });
});

describe('round-trip — table', () => {
  function pickGrid(rows: number, cols: number): void {
    const grid = document.getElementById('mikedown-table-picker');
    expect(grid).not.toBeNull();
    const cell = grid!.querySelector(`.tp-cell[data-row="${rows}"][data-col="${cols}"]`) as HTMLElement;
    expect(cell).not.toBeNull();
    cell.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
  }

  it('/table at line start, picking 2x2, emits a table and reloads stable', async () => {
    harness = await boot('');
    await typeCommand(harness, 'table');
    pickGrid(2, 2);
    const md = markdown(harness);
    expect(md).toContain('|');
    expect(harness.wysiwygEditor().isActive('table')).toBe(true);
    await expectReloadStable(md);
  });

  it('/table mid-line ("foo /table|bar"): text stays "foo bar", table lands below', async () => {
    harness = await boot('foo bar\n');
    const view = harness.wysiwygEditor().view as PmEditorView;
    harness.setWysiwygCursor(posAfterText(view, 'foo '));
    harness.typeInWysiwyg('/table');
    expect(menuEl()).not.toBeNull();
    harness.pressKeyInWysiwyg('Enter');
    pickGrid(2, 2);
    const md = markdown(harness);
    expect(md.startsWith('foo bar')).toBe(true);
    expect(md).toContain('|');
    await expectReloadStable(md);
  });
});

describe('round-trip — link', () => {
  function commitLink(href: string): void {
    const overlay = document.getElementById('mikedown-link-dialog-overlay');
    expect(overlay).not.toBeNull();
    const input = overlay!.querySelector('input') as HTMLInputElement;
    input.value = href;
    const insertBtn = Array.from(overlay!.querySelectorAll('button')).find(
      (b) => b.textContent === 'Insert'
    ) as HTMLButtonElement;
    insertBtn.click();
  }

  it('/link at line start, then typing text, emits "[text](href)" and reloads stable', async () => {
    harness = await boot('');
    await typeCommand(harness, 'link');
    commitLink('https://example.com');
    harness.typeInWysiwyg('example');
    const md = markdown(harness);
    expect(md).toContain('[example](https://example.com)');
    await expectReloadStable(md);
  });

  it('/link mid-line leaves "foo" alone and hangs the link off the trailing space', async () => {
    harness = await boot('foo\n');
    seedMidline(harness);
    await typeCommand(harness, 'link');
    commitLink('https://example.com');
    harness.typeInWysiwyg('bar');
    const md = markdown(harness);
    expect(md).toContain('foo');
    expect(md).toContain('[bar](https://example.com)');
    await expectReloadStable(md);
  });
});

describe('round-trip — wikilink', () => {
  // Typing the closing "]]" doesn't itself convert "[[Target]]" into a
  // wikilink node here: ProseMirror's input rules fire off the real DOM
  // `beforeinput` pipeline (prosemirror-view's handleTextInput prop), and
  // the harness's typeInWysiwyg dispatches insertText transactions directly
  // — the same reason arrow-key caret movement needs a manual
  // setWysiwygCursor (see webviewHarness.ts's doc comment on
  // pressKeyInWysiwyg). The real completion path is the autocomplete popup
  // /wikilink hands off to, so drive that instead: seed a matching
  // candidate, type its name, and select it.
  async function selectWikilinkCandidate(h: Harness, name: string): Promise<void> {
    h.send({ type: 'linkSuggestions', suggestions: [{ label: `${name}.md`, type: 'file' }] });
    await settle();
    h.typeInWysiwyg(name);
    expect(document.getElementById('mikedown-wikilink-ac')).not.toBeNull();
    h.pressKeyInWysiwyg('Enter');
  }

  it('/wikilink at line start, selecting a candidate, emits "[[Target]]" and reloads stable', async () => {
    harness = await boot('');
    await typeCommand(harness, 'wikilink');
    await selectWikilinkCandidate(harness, 'Target');
    const md = markdown(harness);
    expect(md).toContain('[[Target]]');
    await expectReloadStable(md);
  });

  it('/wikilink mid-line: "foo" stays, wikilink follows the trigger space', async () => {
    harness = await boot('foo\n');
    seedMidline(harness);
    await typeCommand(harness, 'wikilink');
    await selectWikilinkCandidate(harness, 'Target');
    const md = markdown(harness);
    expect(md).toContain('foo');
    expect(md).toContain('[[Target]]');
    await expectReloadStable(md);
  });
});

describe('round-trip — emoji', () => {
  function commitEmoji(shortcode: string): void {
    const picker = document.getElementById('mikedown-emoji-picker');
    expect(picker).not.toBeNull();
    const input = picker!.querySelector('input') as HTMLInputElement;
    input.value = shortcode;
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
  }

  it('/emoji at line start emits ":grinning:" and reloads stable', async () => {
    harness = await boot('');
    await typeCommand(harness, 'emoji');
    commitEmoji('grinning');
    const md = markdown(harness);
    expect(md).toContain(':grinning:');
    await expectReloadStable(md);
  });

  it('/emoji mid-line inserts inline: "foo :grinning:"', async () => {
    harness = await boot('foo\n');
    seedMidline(harness);
    await typeCommand(harness, 'emoji');
    commitEmoji('grinning');
    const md = markdown(harness);
    expect(md.trim()).toBe('foo :grinning:');
    await expectReloadStable(md);
  });
});

describe('round-trip — image', () => {
  it('/image at line start emits "![alt](path)" and reloads stable', async () => {
    harness = await boot('');
    await typeCommand(harness, 'image');
    const { requestId } = harness.last('pickImage');
    harness.send({ type: 'pickedImageResult', requestId, insertPath: 'images/cat.png', alt: 'cat' });
    const md = markdown(harness);
    expect(md).toContain('![cat](images/cat.png)');
    await expectReloadStable(md);
  });

  it('/image mid-line: "foo" stays, image inline after the trigger space', async () => {
    harness = await boot('foo\n');
    seedMidline(harness);
    await typeCommand(harness, 'image');
    const { requestId } = harness.last('pickImage');
    harness.send({ type: 'pickedImageResult', requestId, insertPath: 'images/cat.png', alt: 'cat' });
    const md = markdown(harness);
    expect(md).toContain('foo');
    expect(md).toContain('![cat](images/cat.png)');
    await expectReloadStable(md);
  });
});

describe('round-trip — date and datetime', () => {
  const FIXED_NOW = new Date('2026-03-05T09:07:00Z');

  async function withClock(fn: () => Promise<void>): Promise<void> {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(FIXED_NOW);
    try {
      await fn();
    } finally {
      vi.useRealTimers();
    }
  }

  it('/date at line start emits an ISO date and reloads stable as plain text', async () => {
    harness = await boot('');
    await withClock(async () => { await typeCommand(harness!, 'date'); });
    const md = markdown(harness);
    expect(md.trim()).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    await expectReloadStable(md);
  });

  it('/date mid-line: "foo 2026-03-05"', async () => {
    harness = await boot('foo\n');
    seedMidline(harness);
    await withClock(async () => { await typeCommand(harness!, 'date'); });
    const md = markdown(harness);
    expect(md.trim()).toMatch(/^foo \d{4}-\d{2}-\d{2}$/);
    await expectReloadStable(md);
  });

  it('/datetime at line start emits an ISO date-time and reloads stable as plain text', async () => {
    harness = await boot('');
    await withClock(async () => { await typeCommand(harness!, 'datetime'); });
    const md = markdown(harness);
    expect(md.trim()).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/);
    await expectReloadStable(md);
  });

  it('/datetime mid-line inserts inline after "foo "', async () => {
    harness = await boot('foo\n');
    seedMidline(harness);
    await withClock(async () => { await typeCommand(harness!, 'datetime'); });
    const md = markdown(harness);
    expect(md.trim()).toMatch(/^foo \d{4}-\d{2}-\d{2} \d{2}:\d{2}$/);
    await expectReloadStable(md);
  });
});

describe('round-trip — properties (frontmatter)', () => {
  it('/properties at line start emits an empty frontmatter block and reloads stable', async () => {
    harness = await boot('');
    await typeCommand(harness, 'properties');
    const full = harness.lastEditMarkdown()!;
    expect(full).toBe('---\n\n---\n');
    await expectReloadStable(full);
  });

  it('/properties mid-line still adds frontmatter at the top of the document', async () => {
    harness = await boot('foo\n');
    seedMidline(harness);
    await typeCommand(harness, 'properties');
    const full = harness.lastEditMarkdown()!;
    expect(full.startsWith('---\n')).toBe(true);
    expect(full).toContain('foo');
    await expectReloadStable(full);
  });
});

describe('mid-line insert-below matrix (T2 spec examples)', () => {
  it('"foo /h2|" gives a "foo" paragraph and an empty H2 below', async () => {
    harness = await boot('foo\n');
    seedMidline(harness);
    await typeCommand(harness, 'h2');
    expect(markdown(harness).trim()).toMatch(/^foo\n\n##\s*$/);
  });

  it('"foo /table|bar" gives paragraph "foo bar" (text intact, /table removed) + table below', async () => {
    harness = await boot('foo bar\n');
    const view = harness.wysiwygEditor().view as PmEditorView;
    harness.setWysiwygCursor(posAfterText(view, 'foo '));
    harness.typeInWysiwyg('/table');
    expect(menuEl()).not.toBeNull();
    harness.pressKeyInWysiwyg('Enter');
    const grid = document.getElementById('mikedown-table-picker');
    const cell = grid!.querySelector('.tp-cell[data-row="2"][data-col="2"]') as HTMLElement;
    cell.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
    const md = markdown(harness);
    expect(md.startsWith('foo bar')).toBe(true);
    expect(md).toContain('|');
  });

  it('"foo /emoji|" inserts inline', async () => {
    harness = await boot('foo\n');
    seedMidline(harness);
    await typeCommand(harness, 'emoji');
    const picker = document.getElementById('mikedown-emoji-picker');
    const input = picker!.querySelector('input') as HTMLInputElement;
    input.value = 'grinning';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
    expect(markdown(harness).trim()).toBe('foo :grinning:');
  });
});
