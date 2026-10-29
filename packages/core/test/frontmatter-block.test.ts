/**
 * The frontmatter YAML block above the document, and Properties edits made
 * in the sidebar: the block sits in the scrolling container's flow (it used
 * to sit under the toolbar with the document drawn over it), long values
 * wrap, removing the last item of a list removes its key, removing the last
 * key removes the block, and each sidebar edit is one undo step.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createMikeDownEditor, NoopHost, type MikeDownEditorHandle } from '../src/index';
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
});

function mount(markdown: string) {
  const sent: string[] = [];
  class Host extends NoopHost {
    onChange(md: string): void { sent.push(md); }
  }
  const el = document.createElement('div');
  document.body.appendChild(el);
  const handle = createMikeDownEditor(el, {
    host: new Host(),
    initialMarkdown: markdown,
    hostOwnsShortcuts: true,
    features: { sidebar: true },
  });
  mounted.push({ handle, el });
  return { el, handle, sent };
}

const BODY = '# Sample Document\n\nThis is a test document.\n';
const LONG = 'A test document containing basic Markdown features like bold text, italics, links, and tables for integration testing purposes.';

const propsRow = (el: HTMLElement, key: string) => [...el.querySelectorAll<HTMLElement>('.mikedown-outline-sidebar .properties-row')]
  .find((r) => r.querySelector('.properties-key')?.textContent === key)!;
const removePill = (el: HTMLElement, key: string, text: string) => [...propsRow(el, key).querySelectorAll<HTMLElement>('.properties-pill')]
  .find((p) => p.querySelector('.properties-pill-text')?.textContent === text)!
  .querySelector<HTMLButtonElement>('.properties-pill-x')!.click();
const deleteRow = (el: HTMLElement, key: string) => propsRow(el, key).querySelector<HTMLButtonElement>('.properties-delete')!.click();

/** The declarations of the first rule whose selector ends with `selector`. */
function cssRule(file: string, selector: string): string {
  const css = readFileSync(resolve(__dirname, '../src/styles', file), 'utf8');
  const at = css.indexOf(`${selector} {`);
  expect(at).toBeGreaterThan(-1);
  return css.slice(at, css.indexOf('}', at));
}

describe('the frontmatter block', () => {
  it('sits inside the scrolling container, above the document and outside ProseMirror', () => {
    const { el } = mount(`---\ntitle: Sample Document\ndescription: "${LONG}"\ntags: [planning, markdown]\n---\n${BODY}`);
    const block = el.querySelector<HTMLElement>('.frontmatter-block')!;
    const container = el.querySelector<HTMLElement>('.mikedown-editor-container')!;
    const pm = el.querySelector<HTMLElement>('.ProseMirror')!;
    expect(block.parentElement).toBe(container);
    expect(block.nextElementSibling).toBe(pm);
    expect(pm.contains(block)).toBe(false);
  });

  it('stays in flow, shares the content column and wraps long values', () => {
    const block = cssRule('codeblocks.css', '.frontmatter-block');
    expect(block).not.toMatch(/position:\s*(absolute|fixed)/);
    expect(block).toContain('max-width: var(--mikedown-content-width, 100%)');
    expect(block).toMatch(/margin:\s*0 auto/);
    const content = cssRule('codeblocks.css', '.frontmatter-content');
    expect(content).toMatch(/white-space:\s*pre-wrap/);
    expect(content).not.toMatch(/white-space:\s*pre;/);
  });

  it('is rebuilt in the same place after an edit', () => {
    const { el } = mount(`---\ntitle: T\ntags: [a, b]\n---\n${BODY}`);
    removePill(el, 'tags', 'b');
    const blocks = el.querySelectorAll('.frontmatter-block');
    expect(blocks).toHaveLength(1);
    expect(blocks[0].parentElement?.classList.contains('mikedown-editor-container')).toBe(true);
  });
});

describe('removing Properties in the sidebar', () => {
  it('removing the last tag removes the tags key; one undo puts it back', () => {
    const start = `---\ntitle: T\ntags: [a]\n---\n${BODY}`;
    const { el, handle, sent } = mount(start);
    removePill(el, 'tags', 'a');
    expect(handle.getMarkdown()).toBe(`---\ntitle: T\n---\n${BODY}`);
    expect(sent.at(-1)).toBe(`---\ntitle: T\n---\n${BODY}`);
    expect(propsRow(el, 'tags')).toBeUndefined();
    handle.command('undo');
    expect(handle.getMarkdown()).toBe(start);
    expect(propsRow(el, 'tags')).toBeDefined();
  });

  it('removing every property removes the block; each removal is one undo step', () => {
    const start = `---\ntitle: T\ntags: [a, b]\n---\n${BODY}`;
    const { el, handle, sent } = mount(start);
    deleteRow(el, 'title');
    removePill(el, 'tags', 'a');
    removePill(el, 'tags', 'b');
    expect(handle.getMarkdown()).toBe(BODY);
    expect(sent.at(-1)).toBe(BODY);
    expect(el.querySelector('.frontmatter-block')).toBeNull();

    handle.command('undo');
    expect(handle.getMarkdown()).toBe(`---\ntags: [b]\n---\n${BODY}`);
    expect(el.querySelector('.frontmatter-block')).not.toBeNull();
    handle.command('undo');
    expect(handle.getMarkdown()).toBe(`---\ntags: [a, b]\n---\n${BODY}`);
    handle.command('undo');
    expect(handle.getMarkdown()).toBe(start);
    handle.command('redo');
    expect(handle.getMarkdown()).toBe(`---\ntags: [a, b]\n---\n${BODY}`);
  });

  it('deleting the last row removes the block, and one undo restores it whole', () => {
    const start = `---\ntitle: T\n---\n${BODY}`;
    const { el, handle } = mount(start);
    deleteRow(el, 'title');
    expect(handle.getMarkdown()).toBe(BODY);
    expect(el.querySelector('.frontmatter-block')).toBeNull();
    handle.command('undo');
    expect(handle.getMarkdown()).toBe(start);
  });

  it('a property added to an empty block undoes to no block at all', () => {
    const { el, handle } = mount(`---\n\n---\n${BODY}`);
    expect(el.querySelector('.frontmatter-block')).not.toBeNull();
    el.querySelector<HTMLButtonElement>('.properties-add-trigger')!.click();
    const [key, value] = [...el.querySelectorAll<HTMLInputElement>('.properties-add-row input')];
    key.value = 'title';
    value.value = 'T';
    value.focus();
    value.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    expect(handle.getMarkdown()).toBe(`---\ntitle: T\n---\n${BODY}`);
    handle.command('undo');
    expect(handle.getMarkdown()).toBe(BODY);
    expect(el.querySelector('.frontmatter-block')).toBeNull();
  });
});
