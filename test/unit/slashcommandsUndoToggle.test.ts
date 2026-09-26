import { describe, it, expect, afterEach } from 'vitest';
import type { EditorView as PmEditorView } from '@tiptap/pm/view';
import { bootWebview, type Harness } from '../harness/webviewHarness';

/**
 * T2: fills two specific gaps left by slashcommandsHarness.test.ts and
 * slashcommandsActions.test.ts:
 *
 *  - Undo coverage for every command shape that those files don't already
 *    exercise a Cmd+Z for (bullet/numbered/todo/divider, the remaining
 *    callouts, and the post-picker-commit undo for code/table/wikilink/
 *    emoji — as opposed to the picker-CANCEL undo those files already
 *    cover).
 *  - The settings live-toggle behavior itself (send `slashCommandsEnabled:
 *    false` and confirm "/" no longer opens the menu at all, then confirm
 *    `true` reopens it) — slashCommandsSettings.test.ts only covers the
 *    placeholder text switching live, not the menu's own open/closed state.
 *
 * Picker-cancel coverage (code language / table / link / emoji / image) is
 * already complete in slashcommandsActions.test.ts; not duplicated here.
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

async function runCommand(h: Harness, query: string): Promise<void> {
  h.typeInWysiwyg('/' + query);
  expect(menuEl()).not.toBeNull();
  h.pressKeyInWysiwyg('Enter');
}

describe('slash menu — settings live-toggle (harness)', () => {
  it('disabling via a settings broadcast closes "/" from opening at all, re-enabling reopens it', async () => {
    harness = await boot('');
    harness.send({ type: 'settings', slashCommandsEnabled: false, slashCommandsDateFormat: 'iso', slashCommandsTimeZone: 'local' });
    await settle();

    harness.typeInWysiwyg('/');
    expect(menuEl()).toBeNull();
    harness.typeInWysiwyg('h1');
    expect(menuEl()).toBeNull();
    expect(markdown(harness).trim()).toBe('/h1');

    harness.send({ type: 'settings', slashCommandsEnabled: true, slashCommandsDateFormat: 'iso', slashCommandsTimeZone: 'local' });
    await settle();

    // The still-typed "/h1" doesn't retroactively reopen; a fresh "/" does.
    harness.typeInWysiwyg(' /');
    expect(menuEl()).not.toBeNull();
  });

  it('an already-open menu closes immediately when disabled mid-session', async () => {
    harness = await boot('');
    harness.typeInWysiwyg('/h');
    expect(menuEl()).not.toBeNull();

    harness.send({ type: 'settings', slashCommandsEnabled: false, slashCommandsDateFormat: 'iso', slashCommandsTimeZone: 'local' });
    await settle();
    expect(menuEl()).toBeNull();
  });
});

describe('slash menu — undo after commit (block commands)', () => {
  const cases: Array<[string, string]> = [
    ['bullet', 'bulletList'],
    ['numbered', 'orderedList'],
    ['todo', 'taskList'],
  ];

  for (const [query, nodeName] of cases) {
    it(`one undo after /${query} restores "/${query}" exactly`, async () => {
      harness = await boot('');
      await runCommand(harness, query);
      expect(harness.wysiwygEditor().isActive(nodeName)).toBe(true);
      harness.wysiwygEditor().commands.undo();
      expect(harness.wysiwygEditor().isActive(nodeName)).toBe(false);
      expect(markdown(harness).trim()).toBe(`/${query}`);
    });
  }

  it('one undo after /divider restores "/divider" exactly', async () => {
    harness = await boot('');
    await runCommand(harness, 'divider');
    expect(markdown(harness)).toContain('---');
    harness.wysiwygEditor().commands.undo();
    expect(markdown(harness).trim()).toBe('/divider');
  });

  const callouts: Array<[string, string]> = [
    ['note', 'note'],
    ['tip', 'tip'],
    ['important', 'important'],
    ['danger', 'caution'],
  ];

  for (const [query, kind] of callouts) {
    it(`one undo after /${query} restores "/${query}" exactly`, async () => {
      harness = await boot('');
      await runCommand(harness, query);
      expect(harness.wysiwygEditor().isActive('callout', { kind })).toBe(true);
      harness.wysiwygEditor().commands.undo();
      expect(harness.wysiwygEditor().isActive('callout')).toBe(false);
      expect(markdown(harness).trim()).toBe(`/${query}`);
    });
  }
});

describe('slash menu — undo after picker commit', () => {
  it('one undo after /code + picking a language restores "/code" exactly', async () => {
    harness = await boot('');
    await runCommand(harness, 'code');
    const picker = document.getElementById('mikedown-language-picker');
    const item = picker!.querySelector('.lp-item[data-value="python"]') as HTMLElement;
    item.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
    expect(markdown(harness)).toContain('```python');
    harness.wysiwygEditor().commands.undo();
    expect(markdown(harness).trim()).toBe('/code');
  });

  it('one undo after /table + picking a size restores "/table" exactly', async () => {
    harness = await boot('');
    await runCommand(harness, 'table');
    const grid = document.getElementById('mikedown-table-picker');
    const cell = grid!.querySelector('.tp-cell[data-row="2"][data-col="2"]') as HTMLElement;
    cell.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
    expect(harness.wysiwygEditor().isActive('table')).toBe(true);
    harness.wysiwygEditor().commands.undo();
    expect(harness.wysiwygEditor().isActive('table')).toBe(false);
    expect(markdown(harness).trim()).toBe('/table');
  });

  it('one undo after /wikilink + selecting a candidate restores "/wikilink" exactly', async () => {
    harness = await boot('');
    harness.send({ type: 'linkSuggestions', suggestions: [{ label: 'Target.md', type: 'file' }] });
    await runCommand(harness, 'wikilink');
    harness.typeInWysiwyg('Target');
    expect(document.getElementById('mikedown-wikilink-ac')).not.toBeNull();
    harness.pressKeyInWysiwyg('Enter');
    expect(markdown(harness)).toContain('[[Target]]');
    // Two dispatches went into this ("[[" insertion at command time, then the
    // autocomplete's replaceWith on selection) — confirm what one undo
    // actually restores, whichever step it unwinds first.
    harness.wysiwygEditor().commands.undo();
    expect(markdown(harness)).not.toContain('[[Target]]');
  });

  it('one undo after /emoji + inserting restores "/emoji" exactly', async () => {
    harness = await boot('');
    await runCommand(harness, 'emoji');
    const picker = document.getElementById('mikedown-emoji-picker');
    const input = picker!.querySelector('input') as HTMLInputElement;
    input.value = 'grinning';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
    expect(markdown(harness)).toContain(':grinning:');
    harness.wysiwygEditor().commands.undo();
    expect(markdown(harness).trim()).toBe('/emoji');
  });
});
