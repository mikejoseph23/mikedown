import { describe, it, expect, afterEach, vi } from 'vitest';
import type { EditorView as PmEditorView } from '@tiptap/pm/view';
import { bootWebview, type Harness } from '../harness/webviewHarness';
import { formatSlashDate } from '../../src/webview/slashcommands-date';

/**
 * M3/M4/M6 coverage: the action map wired in `slashcommands-actions.ts`
 * (plus the `executeSlashCommand`/`runMatch` fixes in `slashcommands.ts`).
 * T2 does the exhaustive round-trip/mid-line/undo/cancel matrix later; this
 * file checks one representative case per command shape, and the specific
 * handoffs from M2/T1 (list-item escape, preceding-space strip, the
 * "unhandled command reopens the menu" bug).
 */

// jsdom has no layout engine and doesn't implement scrollIntoView at all.
// The language/emoji pickers call it on their focused/active row; harmless
// no-op here (same spirit as the harness's own getClientRects stub).
if (!Element.prototype.scrollIntoView) {
  Element.prototype.scrollIntoView = () => {};
}

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

function menuEl(): HTMLElement | null {
  return document.getElementById('mikedown-slash-menu');
}

function markdown(h: Harness): string {
  return h.wysiwygEditor().storage.markdown.getMarkdown();
}

/** Finds `needle` in a text node and returns the position right after it. */
function posAfterText(view: PmEditorView, needle: string): number {
  let pos = -1;
  view.state.doc.descendants((node, p) => {
    if (pos >= 0 || !node.isText || !node.text!.includes(needle)) return;
    pos = p + node.text!.indexOf(needle) + needle.length;
  });
  if (pos < 0) throw new Error(`text not found: ${needle}`);
  return pos;
}

async function runCommand(h: Harness, query: string): Promise<void> {
  h.typeInWysiwyg('/' + query);
  expect(menuEl()).not.toBeNull();
  h.pressKeyInWysiwyg('Enter');
}

describe('slash menu — block commands (M3)', () => {
  it('/quote converts the empty line to a blockquote, one undo restores "/quote"', async () => {
    const h = await boot('');
    await runCommand(h, 'quote');
    expect(h.wysiwygEditor().isActive('blockquote')).toBe(true);
    h.wysiwygEditor().commands.undo();
    expect(h.wysiwygEditor().isActive('blockquote')).toBe(false);
    expect(markdown(h).trim()).toBe('/quote');
  });

  it('/bullet converts the empty line to a bullet list', async () => {
    const h = await boot('');
    await runCommand(h, 'bullet');
    expect(h.wysiwygEditor().isActive('bulletList')).toBe(true);
  });

  it('/todo converts the empty line to a task list', async () => {
    const h = await boot('');
    await runCommand(h, 'todo');
    expect(h.wysiwygEditor().isActive('taskList')).toBe(true);
  });

  it('/divider inserts a horizontal rule', async () => {
    const h = await boot('');
    await runCommand(h, 'divider');
    expect(markdown(h)).toContain('---');
  });

  it('/warn (alias) inserts a warning callout, serialized as GFM', async () => {
    const h = await boot('');
    await runCommand(h, 'warn');
    expect(h.wysiwygEditor().isActive('callout', { kind: 'warning' })).toBe(true);
    expect(markdown(h)).toContain('[!WARNING]');
  });

  it('mid-line: "foo /quote" leaves "foo" alone and inserts an empty quote after it', async () => {
    const h = await boot('foo\n');
    const ed = h.wysiwygEditor();
    h.setWysiwygCursor(posAfterText(ed.view as PmEditorView, 'foo'));
    h.typeInWysiwyg(' '); // the trigger space; "/" alone right after "foo" wouldn't open
    await runCommand(h, 'quote');
    // "foo" stays a plain paragraph; the blockquote is a new block, not a
    // wrap around "foo" itself.
    expect(markdown(h).trim()).toBe('foo\n\n>');
  });

  it('mid-line preceding space is swallowed: "foo /table|bar" leaves "foo bar"', async () => {
    const h = await boot('foo bar\n');
    const ed = h.wysiwygEditor();
    // Right before "bar", i.e. right after the existing "foo " space.
    const cursor = posAfterText(ed.view as PmEditorView, 'foo ');
    h.setWysiwygCursor(cursor);
    h.typeInWysiwyg('/table');
    expect(menuEl()).not.toBeNull();
    h.pressKeyInWysiwyg('Enter'); // opens the grid picker; no doc change yet
    const grid = document.getElementById('mikedown-table-picker');
    expect(grid).not.toBeNull();
    const cell = grid!.querySelector('.tp-cell[data-row="2"][data-col="2"]') as HTMLElement;
    cell.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
    // The "foo"/"bar" text is one paragraph again, with a single space, and a
    // table appears below it.
    const md = markdown(h);
    expect(md.startsWith('foo bar')).toBe(true);
    expect(md).toContain('|');
  });

  it('inside a list item, a block command lands after the whole list instead of corrupting the item', async () => {
    const h = await boot('- item\n');
    const ed = h.wysiwygEditor();
    expect(ed.isActive('bulletList')).toBe(true);
    h.setWysiwygCursor(posAfterText(ed.view as PmEditorView, 'item'));
    h.typeInWysiwyg(' '); // the trigger space
    await runCommand(h, 'h2');
    // The list item's own paragraph is untouched (still plain text "item");
    // the new heading is a sibling after the whole list, not nested in it.
    const md = markdown(h);
    expect(md).toContain('- item');
    expect(md).toMatch(/- item\s*\n\s*\n##\s/);
    expect(ed.isActive('heading', { level: 2 })).toBe(true);
  });
});

describe('slash menu — code and mermaid (M3)', () => {
  it('/code opens the language picker; picking one sets the code block language', async () => {
    const h = await boot('');
    await runCommand(h, 'code');
    expect(h.wysiwygEditor().isActive('codeBlock')).toBe(true);
    const picker = document.getElementById('mikedown-language-picker');
    expect(picker).not.toBeNull();
    const item = picker!.querySelector('.lp-item[data-value="python"]') as HTMLElement;
    expect(item).not.toBeNull();
    item.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
    expect(document.getElementById('mikedown-language-picker')).toBeNull();
    expect(markdown(h)).toContain('```python');
  });

  it('/code, cancelling the language picker restores "/code" exactly', async () => {
    const h = await boot('');
    await runCommand(h, 'code');
    expect(h.wysiwygEditor().isActive('codeBlock')).toBe(true);
    const input = document.querySelector('#mikedown-language-picker .lp-input') as HTMLInputElement;
    expect(input).not.toBeNull();
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    expect(document.getElementById('mikedown-language-picker')).toBeNull();
    expect(markdown(h).trim()).toBe('/code');
  });

  it('/mermaid inserts a mermaid code block pre-filled with the starter diagram', async () => {
    const h = await boot('');
    await runCommand(h, 'mermaid');
    expect(h.wysiwygEditor().isActive('codeBlock', { language: 'mermaid' })).toBe(true);
    expect(markdown(h)).toContain('```mermaid');
    expect(markdown(h)).toContain('flowchart TD');
    // Three dispatches went into this (prepare target, toggleCodeBlock, the
    // starter-text insert) — one undo must still restore "/mermaid" exactly.
    h.wysiwygEditor().commands.undo();
    expect(markdown(h).trim()).toBe('/mermaid');
  });
});

describe('slash menu — table (M3)', () => {
  it('/table opens the grid picker; picking a size inserts the table', async () => {
    const h = await boot('');
    await runCommand(h, 'table');
    const grid = document.getElementById('mikedown-table-picker');
    expect(grid).not.toBeNull();
    const cell = grid!.querySelector('.tp-cell[data-row="2"][data-col="2"]') as HTMLElement;
    cell.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
    expect(document.getElementById('mikedown-table-picker')).toBeNull();
    expect(h.wysiwygEditor().isActive('table')).toBe(true);
  });

  it('/table, cancelling (Escape) restores "/table" exactly', async () => {
    const h = await boot('');
    await runCommand(h, 'table');
    const grid = document.getElementById('mikedown-table-picker');
    expect(grid).not.toBeNull();
    grid!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    expect(document.getElementById('mikedown-table-picker')).toBeNull();
    expect(markdown(h).trim()).toBe('/table');
  });
});

describe('slash menu — link, wikilink, emoji (M3)', () => {
  it('/link opens the link dialog; Insert removes "/link" and applies the href', async () => {
    const h = await boot('');
    await runCommand(h, 'link');
    const overlay = document.getElementById('mikedown-link-dialog-overlay');
    expect(overlay).not.toBeNull();
    const input = overlay!.querySelector('input') as HTMLInputElement;
    input.value = 'https://example.com';
    const insertBtn = Array.from(overlay!.querySelectorAll('button')).find(
      (b) => b.textContent === 'Insert'
    ) as HTMLButtonElement;
    expect(insertBtn).toBeTruthy();
    insertBtn.click();
    expect(document.getElementById('mikedown-link-dialog-overlay')).toBeNull();
    expect(markdown(h)).not.toContain('/link');
    h.wysiwygEditor().commands.undo();
    expect(markdown(h).trim()).toBe('/link');
  });

  it('/link, cancelling the dialog leaves "/link" untouched', async () => {
    const h = await boot('');
    await runCommand(h, 'link');
    const overlay = document.getElementById('mikedown-link-dialog-overlay');
    expect(overlay).not.toBeNull();
    const cancelBtn = Array.from(overlay!.querySelectorAll('button')).find(
      (b) => b.textContent === 'Cancel'
    ) as HTMLButtonElement;
    cancelBtn.click();
    expect(document.getElementById('mikedown-link-dialog-overlay')).toBeNull();
    expect(markdown(h).trim()).toBe('/link');
  });

  it('/wikilink (alias "[[") replaces the query with "[[" and hands off to the wikilink popup', async () => {
    const h = await boot('');
    // The wikilink popup only renders once it has candidates (lazily
    // requested from the host); seed some via the same message the real
    // host sends so the popup actually appears.
    h.send({ type: 'linkSuggestions', suggestions: [{ label: 'Some Page.md', type: 'file' }] });
    await runCommand(h, 'wikilink');
    // The markdown serializer escapes a bare "[[" (it looks like it could
    // start a reference), so check the actual doc text, not the markdown.
    expect(h.wysiwygEditor().state.doc.textContent).toBe('[[');
    // The wikilink autocomplete plugin re-derives its own query on the next
    // view update and opens its popup for the (empty) query after "[[".
    expect(document.getElementById('mikedown-wikilink-ac')).not.toBeNull();
  });

  it('/emoji opens the emoji picker; Enter on the first result inserts it inline', async () => {
    const h = await boot('hi');
    const ed = h.wysiwygEditor();
    h.setWysiwygCursor(posAfterText(ed.view as PmEditorView, 'hi'));
    h.typeInWysiwyg(' '); // the trigger space
    await runCommand(h, 'emoji');
    const picker = document.getElementById('mikedown-emoji-picker');
    expect(picker).not.toBeNull();
    const input = picker!.querySelector('input') as HTMLInputElement;
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
    expect(document.getElementById('mikedown-emoji-picker')).toBeNull();
    expect(markdown(h)).not.toContain('/emoji');
    expect(markdown(h).startsWith('hi ')).toBe(true);
  });

  it('/emoji, cancelling (Escape) leaves "/emoji" untouched', async () => {
    const h = await boot('');
    await runCommand(h, 'emoji');
    const picker = document.getElementById('mikedown-emoji-picker');
    expect(picker).not.toBeNull();
    const input = picker!.querySelector('input') as HTMLInputElement;
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    expect(document.getElementById('mikedown-emoji-picker')).toBeNull();
    expect(markdown(h).trim()).toBe('/emoji');
  });
});

describe('slash menu — image (M4)', () => {
  it('/image posts pickImage with a requestId, keeping "/image" until the host replies', async () => {
    const h = await boot('');
    await runCommand(h, 'image');
    expect(markdown(h).trim()).toBe('/image');
    const pick = h.last('pickImage');
    expect(pick).toBeDefined();
    expect(typeof pick.requestId).toBe('string');
  });

  it('a pickedImageResult reply replaces "/image" with the image, serialized to insertPath', async () => {
    const h = await boot('');
    await runCommand(h, 'image');
    const { requestId } = h.last('pickImage');
    h.send({ type: 'pickedImageResult', requestId, insertPath: 'images/cat.png', alt: 'cat' });
    expect(markdown(h)).not.toContain('/image');
    expect(markdown(h)).toContain('![cat](images/cat.png)');
    h.wysiwygEditor().commands.undo();
    expect(markdown(h).trim()).toBe('/image');
  });

  it('a cancelled pickedImageResult leaves "/image" untouched', async () => {
    const h = await boot('');
    await runCommand(h, 'image');
    const { requestId } = h.last('pickImage');
    h.send({ type: 'pickedImageResult', requestId, cancelled: true });
    expect(markdown(h).trim()).toBe('/image');
  });

  it('an errored pickedImageResult leaves "/image" untouched', async () => {
    const h = await boot('');
    await runCommand(h, 'image');
    const { requestId } = h.last('pickImage');
    h.send({ type: 'pickedImageResult', requestId, error: 'document not saved' });
    expect(markdown(h).trim()).toBe('/image');
  });
});

describe('slash menu — date and datetime (M6)', () => {
  const FIXED_NOW = new Date('2026-03-05T09:07:00Z');

  async function runWithClock(h: Harness, query: string): Promise<void> {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(FIXED_NOW);
    try {
      await runCommand(h, query);
    } finally {
      vi.useRealTimers();
    }
  }

  const combos: Array<[format: 'iso' | 'long', timeZone: string]> = [
    ['iso', 'local'],
    ['long', 'local'],
    ['iso', 'UTC'],
    ['long', 'America/New_York'],
  ];

  for (const [dateFormat, timeZone] of combos) {
    it(`/date inserts the expected text for dateFormat=${dateFormat} timeZone=${timeZone}`, async () => {
      const h = await boot('');
      h.send({ type: 'settings', slashCommandsEnabled: true, slashCommandsDateFormat: dateFormat, slashCommandsTimeZone: timeZone });
      await settle();
      await runWithClock(h, 'date');
      const expected = formatSlashDate(FIXED_NOW, { format: dateFormat, timeZone, includeTime: false });
      expect(markdown(h).trim()).toBe(expected);
      h.wysiwygEditor().commands.undo();
      expect(markdown(h).trim()).toBe('/date');
    });

    it(`/datetime inserts the expected text for dateFormat=${dateFormat} timeZone=${timeZone}`, async () => {
      const h = await boot('');
      h.send({ type: 'settings', slashCommandsEnabled: true, slashCommandsDateFormat: dateFormat, slashCommandsTimeZone: timeZone });
      await settle();
      await runWithClock(h, 'datetime');
      const expected = formatSlashDate(FIXED_NOW, { format: dateFormat, timeZone, includeTime: true });
      expect(markdown(h).trim()).toBe(expected);
      h.wysiwygEditor().commands.undo();
      expect(markdown(h).trim()).toBe('/datetime');
    });
  }
});

describe('slash menu — properties (M6)', () => {
  it('inserts an empty frontmatter block, removes "/properties", and one undo restores both', async () => {
    const h = await boot('');
    await runCommand(h, 'properties');

    // The frontmatter block isn't part of the PM doc (see editor-main.ts's
    // frontmatterContent), so check the full document the host would save,
    // not just the WYSIWYG body.
    expect(markdown(h).trim()).toBe('');
    expect(h.lastEditMarkdown()).toBe('---\n\n---\n');

    h.wysiwygEditor().commands.undo();
    expect(markdown(h).trim()).toBe('/properties');
    expect(h.lastEditMarkdown()).not.toContain('---');
  });

  it('/prop is not offered once frontmatter exists (right after running /properties)', async () => {
    const h = await boot('');
    await runCommand(h, 'properties');
    h.typeInWysiwyg('/prop');
    expect(menuEl()).toBeNull();
  });
});

describe('slash menu — unhandled commands (T1 regression)', () => {
  // As of M4/M6 every registry id is wired to a real action, so there's no
  // genuinely unhandled id left to pick — exercise the same generic path
  // (runMatch's "handler returned false" branch in slashcommands.ts) by
  // forcing the external handler to report "not handled" for one call.
  it('a command whose handler reports unhandled closes the menu and stays closed on the next update', async () => {
    const h = await boot('');
    // `bootWebview()` calls `vi.resetModules()` before (re-)importing the
    // bundle, so a top-level `setSlashCommandHandler` import in this file
    // would be bound to a stale module instance by now — re-import to reach
    // the live one `editor-main.ts` (and its `initSlashCommandActions`)
    // registered its real handler on.
    const live = await import('../../src/webview/slashcommands');
    live.setSlashCommandHandler(() => false);
    await runCommand(h, 'quote');
    expect(menuEl()).toBeNull();
    expect(markdown(h).trim()).toBe('/quote');
    // Any later view update (a selection-only transaction here) must not
    // re-derive and reopen the menu for the same, still-unhandled "/quote".
    h.setWysiwygCursor(h.wysiwygEditor().state.selection.from);
    expect(menuEl()).toBeNull();
  });
});
