import { describe, it, expect, afterEach } from 'vitest';
import { bootWebview, type Harness } from '../harness/webviewHarness';
import { SLASH_COMMANDS } from '../../src/webview/slashcommands-registry';

/**
 * Fills the specific gaps left by the other slashcommands* suites while
 * auditing `.orchestrator/slash-commands-planning/hands-on-checklist.md` for
 * automation (2.11.0 hands-on sign-off): the popup's grouped rendering and
 * default focus (step 1), the exact "/che" scenario (step 2), two literal
 * non-triggering strings typed through the real doc rather than only via the
 * pure `extractSlashQuery` matcher (step 3), typing "/" from inside an
 * already-active source-mode session (step 16), and the sidebar handoff after
 * `/properties` (step 23).
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

describe('slash menu — grouped display and default focus (checklist step 1)', () => {
  it('groups commands under "Basic blocks / Lists / Insert / Callouts", in that order, for an empty query', async () => {
    harness = await boot('');
    harness.typeInWysiwyg('/');
    const headers = Array.from(
      document.querySelectorAll('#mikedown-slash-menu .slash-menu-group-header')
    ).map((el) => el.textContent);
    expect(headers).toEqual(['Basic blocks', 'Lists', 'Insert', 'Callouts']);
  });

  it('the first row (Heading 1, the first "basic" command) is focused/active by default', async () => {
    harness = await boot('');
    harness.typeInWysiwyg('/');
    const active = document.querySelector('#mikedown-slash-menu .slash-menu-item.is-active') as HTMLElement | null;
    expect(active).not.toBeNull();
    expect(active!.dataset.command).toBe('h1');
    expect(SLASH_COMMANDS[0].id).toBe('h1');
  });
});

describe('slash menu — "/che" (checklist step 2)', () => {
  it('matches only Task list, Enter inserts an empty task item, one undo restores "/che"', async () => {
    harness = await boot('');
    harness.typeInWysiwyg('/che');
    const ids = Array.from(document.querySelectorAll('#mikedown-slash-menu .slash-menu-item')).map(
      (row) => (row as HTMLElement).dataset.command
    );
    expect(ids).toEqual(['todo']);

    harness.pressKeyInWysiwyg('Enter');
    expect(harness.wysiwygEditor().isActive('taskList')).toBe(true);
    expect(markdown(harness)).toMatch(/^- \[ \]/m);

    harness.wysiwygEditor().commands.undo();
    expect(harness.wysiwygEditor().isActive('taskList')).toBe(false);
    expect(markdown(harness).trim()).toBe('/che');
  });
});

describe('slash menu — literal non-triggers (checklist step 3)', () => {
  it('typing "and/or" never opens the menu', async () => {
    harness = await boot('');
    harness.typeInWysiwyg('and/or');
    expect(menuEl()).toBeNull();
    expect(markdown(harness).trim()).toBe('and/or');
  });

  it('typing "path/to/file" never opens the menu', async () => {
    harness = await boot('');
    harness.typeInWysiwyg('path/to/file');
    expect(menuEl()).toBeNull();
    expect(markdown(harness).trim()).toBe('path/to/file');
  });
});

describe('slash menu — already in source mode (checklist step 16)', () => {
  it('typing "/" into the source (CodeMirror) buffer never opens the WYSIWYG slash menu', async () => {
    harness = await boot('');
    harness.send({ type: 'toggleSource' });
    await settle();
    expect(harness.inSourceMode()).toBe(true);
    harness.typeInSource('/');
    await settle();
    expect(menuEl()).toBeNull();
  });
});

describe('slash menu — /properties hands the sidebar over (checklist step 23)', () => {
  it('shows the sidebar, expands Properties, and renders "+ Add property"', async () => {
    harness = await boot('');
    harness.typeInWysiwyg('/properties');
    harness.pressKeyInWysiwyg('Enter');

    const sidebar = document.getElementById('mikedown-outline-sidebar') as HTMLElement | null;
    expect(sidebar).not.toBeNull();
    expect(sidebar!.hidden).toBe(false);
    expect(document.querySelector('.properties-add-trigger')).not.toBeNull();
  });

  // BUG (found while automating the hands-on checklist): the checklist says
  // "/properties" should leave focus on the sidebar's "+ Add property"
  // trigger (`focusPropertiesSection` in outlineSidebar.ts does call
  // `trigger.focus()`), but `runMatch` in slashcommands.ts unconditionally
  // calls `view.focus()` right after every command executes — including
  // /properties — which steals focus straight back to the ProseMirror editor
  // in the same synchronous tick. Verified against the real webview bundle:
  // `document.activeElement` ends up back on `.ProseMirror`, not on
  // `.properties-add-trigger`. Not fixed here (scope is tests only).
  it.todo(
    'focus should land on "+ Add property" after /properties, per checklist step 23 — currently runMatch\'s trailing view.focus() steals it back to the editor'
  );
});

describe('slash menu — mid-line wrap command with trailing content on the same line (checklist step 9)', () => {
  // BUG (found while automating the hands-on checklist): the checklist
  // expects "hello world" + cursor after "hello " + "/quote" + Enter to give
  // an "hello" paragraph followed by a quote CONTAINING "world". The shared
  // `buildSlashTargetTr` (slashcommands.ts) only ever deletes the "/query"
  // text and inserts an EMPTY wrap block right after the current block when
  // trailing content follows on the same line (see computeDeleteFrom's doc
  // comment) — it never moves that trailing text into the new block. Actual
  // result, verified against the real webview bundle: "hello world\n\n> "
  // (an untouched "hello world" paragraph, then an empty blockquote below).
  // Not fixed here (scope is tests only) — flagging for Mike to confirm
  // which behavior is actually wanted before this checklist step is signed
  // off as automated.
  it.todo(
    'mid-line "/quote" with trailing text on the line should quote the trailing text, per checklist step 9 — currently leaves the line untouched and appends an empty quote'
  );
});
