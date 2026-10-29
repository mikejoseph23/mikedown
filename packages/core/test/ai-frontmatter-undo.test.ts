/**
 * Edge cases of the undoable frontmatter edits (`frontmatterHistory.ts`) as
 * the Properties Suggest chips and a picked title use them: redo, several
 * edits, a document with no frontmatter, what reaches the host, and loading a
 * new document. The happy paths are in outlineSidebar-suggest.test.ts.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { createMikeDownEditor, NoopHost, type MikeDownEditorHandle } from '../src/index';
import type { MikeDownAiHost } from '../src/ai';
import { FRONTMATTER_DOC_ATTR } from '../src/frontmatterHistory';
import { closeSlashMenu, setSlashSourceMode } from '../src/slashcommands';
import { stubLayoutMeasurement } from '../../../test/harness/webviewHarness';

stubLayoutMeasurement();

const mounted: Array<{ handle: MikeDownEditorHandle; el: HTMLElement }> = [];

afterEach(async () => {
  await new Promise((r) => setTimeout(r, 30));
  closeSlashMenu();
  setSlashSourceMode(false);
  while (mounted.length) {
    const { handle, el } = mounted.pop()!;
    try { handle.destroy(); } catch { /* already destroyed */ }
    el.remove();
  }
  document.querySelectorAll('.mikedown-ai-rewrite').forEach((n) => n.remove());
});

/** Everything the editor reports to the host, in order. */
function mount(markdown: string, reply: string) {
  const sent: string[] = [];
  class Host extends NoopHost {
    onChange(markdown: string): void { sent.push(markdown); }
    ai: MikeDownAiHost = {
      complete: async (_req, onToken) => {
        onToken(reply);
        return { text: reply, served: { engineName: 'Proxy', modelId: 'house-model', isLocal: true }, finishReason: 'stop' };
      },
    } as MikeDownAiHost;
  }
  const el = document.createElement('div');
  document.body.appendChild(el);
  const handle = createMikeDownEditor(el, {
    host: new Host(),
    initialMarkdown: markdown,
    hostOwnsShortcuts: true,
    features: { sidebar: true },
    settings: { ai: { enabled: true } } as never,
  });
  mounted.push({ handle, el });
  return { el, handle, sent };
}

const settle = async (): Promise<void> => {
  for (let i = 0; i < 4; i++) {await new Promise((r) => setTimeout(r, 0));}
};
const suggest = async (el: HTMLElement): Promise<void> => {
  el.querySelector<HTMLButtonElement>('.properties-suggest-btn')!.click();
  await settle();
};
const chips = (el: HTMLElement) => [...el.querySelectorAll<HTMLElement>('.properties-suggest-chip')];
const chip = (el: HTMLElement, kind: string, text?: string) => chips(el).find((c) => c.dataset.kind === kind
  && (text === undefined || c.querySelector('.properties-pill-text')?.textContent === text))!;
const applyChip = (c: HTMLElement) => c.querySelector<HTMLButtonElement>('.properties-suggest-apply')!.click();
const propertiesText = (el: HTMLElement) => el.querySelector('.mikedown-outline-sidebar .properties-list')?.textContent ?? '';

const BODY = '# Plan\n\nWe ship the editor in May.\n';

/** Frontmatter delimiter lines in a markdown string. */
const fences = (md: string): number => (md.match(/^---$/gm) ?? []).length;

describe('chip, undo, redo', () => {
  it('walks the document through apply, undo and redo, and the host hears each state', async () => {
    const start = `---\ntitle: Old\ntags: [a]\n---\n${BODY}`;
    const { el, handle, sent } = mount(start, JSON.stringify({ tags: ['fresh'] }));
    await suggest(el);
    applyChip(chip(el, 'tag', 'fresh'));
    const applied = `---\ntitle: Old\ntags: [a, fresh]\n---\n${BODY}`;
    expect(handle.getMarkdown()).toBe(applied);
    expect(sent.at(-1)).toBe(applied);

    handle.command('undo');
    expect(handle.getMarkdown()).toBe(start);
    expect(sent.at(-1)).toBe(start);
    expect(propertiesText(el)).not.toContain('fresh');

    handle.command('redo');
    expect(handle.getMarkdown()).toBe(applied);
    expect(sent.at(-1)).toBe(applied);
    expect(propertiesText(el)).toContain('fresh');

    // And back again: redo did not consume the history.
    handle.command('undo');
    expect(handle.getMarkdown()).toBe(start);
  });
});

describe('two chips, two undos', () => {
  it('undoes them newest first and redoes them oldest first', async () => {
    const start = `---\ntitle: Old\n---\n${BODY}`;
    const { el, handle } = mount(start, JSON.stringify({ description: 'About May.', tags: ['x'] }));
    await suggest(el);
    applyChip(chip(el, 'description'));
    const afterOne = `---\ntitle: Old\ndescription: About May.\n---\n${BODY}`;
    expect(handle.getMarkdown()).toBe(afterOne);
    applyChip(chip(el, 'tag', 'x'));
    const afterTwo = `---\ntitle: Old\ndescription: About May.\ntags: [x]\n---\n${BODY}`;
    expect(handle.getMarkdown()).toBe(afterTwo);

    handle.command('undo');
    expect(handle.getMarkdown()).toBe(afterOne);
    handle.command('undo');
    expect(handle.getMarkdown()).toBe(start);
    // Nothing left to undo.
    handle.command('undo');
    expect(handle.getMarkdown()).toBe(start);

    handle.command('redo');
    expect(handle.getMarkdown()).toBe(afterOne);
    handle.command('redo');
    expect(handle.getMarkdown()).toBe(afterTwo);
  });

  it('typing between two chips is its own step: undo takes the typing, then the chip', async () => {
    const start = `---\ntitle: Old\n---\n${BODY}`;
    const { el, handle } = mount(start, JSON.stringify({ description: 'About May.', tags: ['x'] }));
    await suggest(el);
    applyChip(chip(el, 'description'));
    const afterChip = handle.getMarkdown();
    handle.tiptap.commands.setTextSelection(handle.tiptap.state.doc.content.size - 1);
    handle.tiptap.view.dispatch(handle.tiptap.state.tr.insertText('Typed. '));
    expect(handle.getMarkdown()).toContain('Typed.');

    handle.command('undo');
    expect(handle.getMarkdown()).toBe(afterChip);
    handle.command('undo');
    expect(handle.getMarkdown()).toBe(start);
  });
});

describe('a document with no frontmatter', () => {
  it('the first chip creates the block, undo removes it, redo creates it again', async () => {
    const { el, handle, sent } = mount(BODY, JSON.stringify({ title: 'Launch Plan' }));
    await suggest(el);
    applyChip(chip(el, 'title'));
    const created = `---\ntitle: Launch Plan\n---\n${BODY}`;
    expect(handle.getMarkdown()).toBe(created);
    expect(el.querySelector('.frontmatter-block')).not.toBeNull();

    handle.command('undo');
    expect(handle.getMarkdown()).toBe(BODY);
    expect(sent.at(-1)).toBe(BODY);
    expect(el.querySelector('.frontmatter-block')).toBeNull();
    expect(propertiesText(el)).not.toContain('Launch Plan');

    handle.command('redo');
    expect(handle.getMarkdown()).toBe(created);
    expect(el.querySelector('.frontmatter-block')).not.toBeNull();
  });

  it('two chips from nothing: one undo leaves the first, the second removes the block', async () => {
    const { el, handle } = mount(BODY, JSON.stringify({ title: 'Launch Plan', tags: ['x'] }));
    await suggest(el);
    applyChip(chip(el, 'title'));
    applyChip(chip(el, 'tag', 'x'));
    expect(handle.getMarkdown()).toBe(`---\ntitle: Launch Plan\ntags: [x]\n---\n${BODY}`);
    handle.command('undo');
    expect(handle.getMarkdown()).toBe(`---\ntitle: Launch Plan\n---\n${BODY}`);
    handle.command('undo');
    expect(handle.getMarkdown()).toBe(BODY);
    expect(el.querySelector('.frontmatter-block')).toBeNull();
  });
});

describe('what the host receives', () => {
  it('never carries the doc attribute, and the frontmatter appears exactly once', async () => {
    const { el, handle, sent } = mount(`---\ntitle: Old\n---\n${BODY}`, JSON.stringify({ description: 'About May.', tags: ['x', 'y'] }));
    await suggest(el);
    applyChip(chip(el, 'description'));
    applyChip(chip(el, 'tag', 'x'));
    handle.command('undo');
    handle.command('redo');
    handle.command('undo');
    handle.command('undo');
    handle.command('redo');
    handle.tiptap.commands.insertContent('Typing after. ');

    expect(sent.length).toBeGreaterThan(4);
    for (const md of [...sent, handle.getMarkdown()]) {
      expect(md).not.toContain(FRONTMATTER_DOC_ATTR);
      expect(md).not.toContain('seq');
      expect(fences(md)).toBe(2);
      expect(md.startsWith('---\n')).toBe(true);
      expect(md.match(/^title:/gm)).toHaveLength(1);
    }
  });

  it('a document that starts without frontmatter never gets a stray block while edits come and go', async () => {
    const { el, handle, sent } = mount(BODY, JSON.stringify({ tags: ['x'] }));
    await suggest(el);
    applyChip(chip(el, 'tag', 'x'));
    handle.command('undo');
    expect(sent.at(-1)).toBe(BODY);
    expect(fences(sent.at(-1)!)).toBe(0);
    handle.command('redo');
    handle.command('undo');
    expect(handle.getMarkdown()).toBe(BODY);
    expect(fences(handle.getMarkdown())).toBe(0);
  });

  it('a picked title (frontmatter path) is also clean in what the host receives', async () => {
    const { handle, sent } = mount(`---\ntitle: Old\n---\n${BODY}`, '{"titles": ["Alpha Plan", "Beta Plan"]}');
    handle.command('aiSuggestTitle');
    await settle();
    document.querySelector<HTMLButtonElement>('.mikedown-ai-rewrite .ai-rw-titles > button')!.click();
    expect(sent.at(-1)).toBe(`---\ntitle: Alpha Plan\n---\n${BODY}`);
    handle.command('undo');
    expect(sent.at(-1)).toBe(`---\ntitle: Old\n---\n${BODY}`);
    for (const md of sent) {expect(md).not.toContain(FRONTMATTER_DOC_ATTR);}
  });
});

describe('loading a new document', () => {
  it('leaves no undo step that restores the old document\'s YAML', async () => {
    const { el, handle } = mount(`---\ntitle: Old\ntags: [a]\n---\n${BODY}`, JSON.stringify({ tags: ['x'] }));
    await suggest(el);
    applyChip(chip(el, 'tag', 'x'));
    expect(handle.getMarkdown()).toContain('tags: [a, x]');

    const other = '---\ntitle: Other\n---\n# Other\n\nSecond file.\n';
    handle.setMarkdown(other);
    expect(handle.getMarkdown()).toBe(other);
    handle.command('undo');
    expect(handle.getMarkdown()).toBe(other);
    handle.command('redo');
    expect(handle.getMarkdown()).toBe(other);
    expect(propertiesText(el)).toContain('Other');
    expect(propertiesText(el)).not.toContain('Old');
    expect(el.querySelector('.frontmatter-block')?.textContent).not.toContain('tags: [a, x]');
  });

  it('a new document with no frontmatter does not inherit the old block, even after undo', async () => {
    const { el, handle } = mount(`---\ntitle: Old\n---\n${BODY}`, JSON.stringify({ tags: ['x'] }));
    await suggest(el);
    applyChip(chip(el, 'tag', 'x'));

    handle.setMarkdown('# Plain\n\nNo properties.\n');
    handle.command('undo');
    expect(handle.getMarkdown()).toBe('# Plain\n\nNo properties.\n');
    expect(el.querySelector('.frontmatter-block')).toBeNull();
  });

  it('edits to the new document undo to the new document\'s YAML, not the old one\'s', async () => {
    const { el, handle } = mount(`---\ntitle: Old\ntags: [a]\n---\n${BODY}`, JSON.stringify({ tags: ['x'] }));
    await suggest(el);
    applyChip(chip(el, 'tag', 'x'));

    const other = '---\ntitle: Other\ntags: [z]\n---\n# Other\n';
    handle.setMarkdown(other);
    await suggest(el);
    applyChip(chip(el, 'tag', 'x'));
    expect(handle.getMarkdown()).toBe('---\ntitle: Other\ntags: [z, x]\n---\n# Other\n');
    handle.command('undo');
    expect(handle.getMarkdown()).toBe(other);
    handle.command('undo');
    expect(handle.getMarkdown()).toBe(other);
  });
});
