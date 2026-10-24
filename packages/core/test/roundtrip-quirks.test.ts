/**
 * Markdown round-trip quirks seen in desktop testing (identical in VS Code and
 * jsdom, so core behavior): the trailing newline, backslash / two-space hard
 * breaks, tight task lists, bare code fences, and the caret after a Cmd+/
 * round-trip from source mode.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { createMikeDownEditor, NoopHost, type MikeDownEditorHandle, type MikeDownHost } from '../src/index';
import { stubLayoutMeasurement } from '../../../test/harness/webviewHarness';

stubLayoutMeasurement();

const mounted: Array<{ handle: MikeDownEditorHandle; el: HTMLElement }> = [];

afterEach(async () => {
  await new Promise(r => setTimeout(r, 20));
  while (mounted.length) {
    const { handle, el } = mounted.pop()!;
    try { handle.destroy(); } catch { /* already destroyed */ }
    el.remove();
  }
});

function mount(markdown: string) {
  const changes: string[] = [];
  const host: MikeDownHost = Object.assign(new NoopHost(), {
    onChange: (md: string) => { changes.push(md); },
  });
  const el = document.createElement('div');
  document.body.appendChild(el);
  const handle = createMikeDownEditor(el, { host, initialMarkdown: markdown });
  mounted.push({ handle, el });
  return { handle, changes };
}

/** Load `md`, make an edit at the very start, and return what the host receives. */
function editedRoundTrip(md: string): string {
  const { handle, changes } = mount(md);
  handle.tiptap.commands.focus('start');
  handle.tiptap.commands.insertContent('X');
  const last = changes[changes.length - 1];
  expect(last.startsWith('X') || last.includes('X')).toBe(true);
  return last.replace('X', '');
}

describe('trailing newline', () => {
  it('keeps the final newline after an edit when the file had one', () => {
    expect(editedRoundTrip('Hello world\n')).toBe('Hello world\n');
    expect(editedRoundTrip('# Title\n\nBody text.\n')).toBe('# Title\n\nBody text.\n');
  });

  it('does not add one when the file had none', () => {
    expect(editedRoundTrip('Hello world')).toBe('Hello world');
  });

  it('getMarkdown reports the final newline too', () => {
    const { handle } = mount('Hello\n');
    handle.tiptap.commands.focus('end');
    handle.tiptap.commands.insertContent('!');
    expect(handle.getMarkdown()).toBe('Hello!\n');
  });

  it('keeps the final newline with frontmatter', () => {
    const md = '---\ntitle: A\n---\nBody\n';
    const { handle, changes } = mount(md);
    handle.tiptap.commands.focus('end');
    handle.tiptap.commands.insertContent('!');
    expect(changes[changes.length - 1]).toBe('---\ntitle: A\n---\nBody!\n');
  });

  it('follows the source text after a source-mode edit', () => {
    const { handle } = mount('Hello\n');
    handle.setViewState({ sourceMode: true });
    handle.setMarkdown('Hi there');
    handle.setViewState({ sourceMode: false });
    handle.tiptap.commands.focus('end');
    handle.tiptap.commands.insertContent('!');
    expect(handle.getMarkdown()).toBe('Hi there!');
  });
});

describe('hard breaks', () => {
  it('keeps a trailing-backslash hard break', () => {
    expect(editedRoundTrip('line one\\\nline two\n')).toBe('line one\\\nline two\n');
  });

  it('keeps a two-space hard break', () => {
    expect(editedRoundTrip('line one  \nline two\n')).toBe('line one  \nline two\n');
  });

  it('leaves a soft-wrapped line as a bare newline', () => {
    expect(editedRoundTrip('line one\nline two\n')).toBe('line one\nline two\n');
  });

  it('keeps a backslash hard break inside a blockquote and a list', () => {
    expect(editedRoundTrip('> a\\\n> b\n')).toBe('> a\\\n> b\n');
    expect(editedRoundTrip('- a\\\n  b\n')).toBe('- a\\\n  b\n');
  });
});

describe('task lists', () => {
  it('keeps a tight task list tight', () => {
    expect(editedRoundTrip('- [ ] a\n- [x] b\n')).toBe('- [ ] a\n- [x] b\n');
  });

  it('keeps a loose task list loose', () => {
    expect(editedRoundTrip('- [ ] a\n\n- [x] b\n')).toBe('- [ ] a\n\n- [x] b\n');
  });

  it('keeps a nested tight task list tight', () => {
    const md = '- [ ] a\n  - [x] a1\n  - [ ] a2\n- [ ] b\n';
    expect(editedRoundTrip(md)).toBe(md);
  });
});

describe('code fences', () => {
  it('leaves a bare fence without an info string', () => {
    expect(editedRoundTrip('```\ncode\n```\n')).toBe('```\ncode\n```\n');
  });

  it('keeps an explicit language, including plaintext', () => {
    expect(editedRoundTrip('```ts\ncode\n```\n')).toBe('```ts\ncode\n```\n');
    expect(editedRoundTrip('```plaintext\ncode\n```\n')).toBe('```plaintext\ncode\n```\n');
  });
});

describe('caret after a source-mode round-trip', () => {
  const table = '| A1 | B1 |\n| --- | --- |\n| A2 | B2 |\n';

  /** Text of the innermost textblock holding the WYSIWYG caret. */
  function caretBlockText(handle: MikeDownEditorHandle): string {
    return handle.tiptap.state.selection.$from.parent.textContent;
  }

  it('lands in the table cell it was in', () => {
    const { handle } = mount(table);
    handle.setViewState({ sourceMode: true, cursor: table.indexOf('A1') + 1 });
    handle.setViewState({ sourceMode: false });
    expect(caretBlockText(handle)).toBe('A1');
  });

  it('lands in a later cell too', () => {
    const { handle } = mount(table);
    handle.setViewState({ sourceMode: true, cursor: table.indexOf('B2') + 2 });
    handle.setViewState({ sourceMode: false });
    expect(caretBlockText(handle)).toBe('B2');
  });

  it('lands in a task item', () => {
    const md = '- [ ] first\n- [ ] second\n';
    const { handle } = mount(md);
    handle.setViewState({ sourceMode: true, cursor: md.indexOf('second') + 3 });
    handle.setViewState({ sourceMode: false });
    expect(caretBlockText(handle)).toBe('second');
  });
});
