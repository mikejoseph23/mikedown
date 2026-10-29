/**
 * The AI popover's markdown preview: lists, emphasis and code render, raw
 * HTML and links never become live DOM, and Insert still takes the original
 * markdown.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { createMikeDownEditor, NoopHost, type MikeDownEditorHandle } from '../src/index';
import type { AiCompletionResult, MikeDownAiHost } from '../src/ai';
import { renderPreviewMarkdown } from '../src/ai-markdown-preview';
import { stubLayoutMeasurement } from '../../../test/harness/webviewHarness';

stubLayoutMeasurement();

function render(md: string): HTMLElement {
  const host = document.createElement('div');
  renderPreviewMarkdown(host, md);
  return host;
}

describe('renderPreviewMarkdown', () => {
  it('turns bullets into a list without the leading hyphens', () => {
    const out = render('- The engineering team ships **Friday**.\n- Docs follow in `June`.');
    expect(out.querySelectorAll('ul > li')).toHaveLength(2);
    expect(out.textContent).toBe('The engineering team ships Friday.Docs follow in June.');
    expect(out.querySelector('li strong')?.textContent).toBe('Friday');
    expect(out.querySelector('li code')?.textContent).toBe('June');
  });

  it('nests lists by indent and numbers ordered lists', () => {
    const out = render('- A\n  - A1\n  - A2\n- B\n\n1. one\n2. two');
    expect(out.querySelectorAll('ul ul > li')).toHaveLength(2);
    expect(out.querySelectorAll('ol > li')).toHaveLength(2);
  });

  it('keeps plain prose as paragraphs with its own newlines', () => {
    const out = render('First line\nsecond line.\n\nNext paragraph.');
    const ps = out.querySelectorAll('p');
    expect(ps).toHaveLength(2);
    expect(ps[0].textContent).toBe('First line\nsecond line.');
    expect(out.querySelector('ul, ol, strong, em')).toBeNull();
  });

  it('leaves unmatched delimiters, snake_case and a lone asterisk literal', () => {
    expect(render('2 * 3 and snake_case_name and **open').textContent).toBe('2 * 3 and snake_case_name and **open');
  });

  it('renders headings, italics, strikethrough, quotes and fenced code', () => {
    const out = render('## Title\n\n*soft* and ~~gone~~\n\n> quoted\n\n```js\nconst a = <b>1</b>;\n```');
    expect(out.querySelector('.ai-rw-md-h')?.textContent).toBe('Title');
    expect(out.querySelector('em')?.textContent).toBe('soft');
    expect(out.querySelector('del')?.textContent).toBe('gone');
    expect(out.querySelector('blockquote')?.textContent).toBe('quoted');
    expect(out.querySelector('pre code')?.textContent).toBe('const a = <b>1</b>;');
    expect(out.querySelector('pre b')).toBeNull();
  });

  it('never injects raw HTML or script, and never sets a link target', () => {
    const out = render('Hi <script>window.pwned = 1</script> <img src=x onerror="window.pwned = 1"> [click](javascript:alert(1)) ![pic](https://example.com/p.png)\n\n- <b>bold</b>');
    expect(out.querySelector('script, img, b, a, [href], [src], [onerror]')).toBeNull();
    expect(out.textContent).toContain('<script>window.pwned = 1</script>');
    expect(out.textContent).toContain('click');
    expect(out.textContent).not.toContain('javascript:');
    expect((window as unknown as { pwned?: number }).pwned).toBeUndefined();
  });
});

// ── In the popover ──────────────────────────────────────────────────────────

const CHAT = { chat: true, stream: true, vision: false, json: false, tools: false, fim: false, embed: false, contextTokens: 32768 };
const mounted: Array<{ handle: MikeDownEditorHandle; el: HTMLElement }> = [];
afterEach(async () => {
  await new Promise((r) => setTimeout(r, 10));
  for (const { handle, el } of mounted.splice(0)) {
    try { handle.destroy(); } catch { /* already destroyed */ }
    el.remove();
  }
  document.querySelectorAll('.mikedown-ai-rewrite').forEach((n) => n.remove());
});

function mount(markdown: string, text: string, isLocal = false) {
  class AiHost extends NoopHost {
    ai: MikeDownAiHost = {
      complete: async (_req, onToken): Promise<AiCompletionResult> => {
        onToken(text);
        return { text, served: { engineId: 'e', engineName: 'OpenAI', modelId: 'gpt-5.5', isLocal }, finishReason: 'stop' };
      },
      listEngines: async () => [],
    };
  }
  const el = document.createElement('div');
  document.body.appendChild(el);
  const ai = {
    enabled: true,
    allowCloud: true,
    engines: [{ id: 'e', name: 'OpenAI', kind: 'openai', baseUrl: 'https://api.openai.com/v1', models: [{ id: 'gpt-5.5', capabilities: CHAT, capabilitiesSource: 'user' }] }],
    routing: { default: { engineId: 'e', modelId: 'gpt-5.5' }, fallback: 'none', tasks: {} },
  };
  const handle = createMikeDownEditor(el, { host: new AiHost(), initialMarkdown: markdown, hostOwnsShortcuts: true, features: { sidebar: true }, settings: { ai } as never });
  mounted.push({ handle, el });
  return { handle };
}

const settle = async (): Promise<void> => {
  for (let i = 0; i < 4; i++) {await new Promise((r) => setTimeout(r, 0));}
};
const popover = () => document.querySelector<HTMLElement>('.mikedown-ai-rewrite');

describe('popover preview', () => {
  const MD = '# Plan\n\nWe ship the editor in May. Docs follow in June.\n';

  it('renders summary bullets as a list, shows the cloud badge with spaced separators, and Insert uses the original markdown', async () => {
    const reply = '- The engineering team ships in **May**.\n- Docs follow in June.';
    const { handle } = mount(MD, reply);
    await settle();
    handle.tiptap.commands.setTextSelection(handle.tiptap.state.doc.content.size - 1);
    handle.command('aiSummarize');
    await settle();
    expect(popover()!.dataset.phase).toBe('done');
    const out = popover()!.querySelector('.ai-rw-out')!;
    expect(out.querySelectorAll('ul > li')).toHaveLength(2);
    expect(out.textContent).not.toMatch(/^-/);
    expect(out.querySelector('strong')?.textContent).toBe('May');
    expect(popover()!.querySelector('.ai-rw-badge-engine')!.textContent).toBe('Cloud · OpenAI · ');
    expect(popover()!.querySelector('.ai-rw-badge-model')!.textContent).toBe('gpt-5.5');
    [...popover()!.querySelectorAll<HTMLButtonElement>('button')].find((b) => b.textContent === 'Insert')!.click();
    expect(handle.getMarkdown()).toContain('- The engineering team ships in **May**.');
  });

  it('a script or raw HTML in the answer is shown as text, not run or injected', async () => {
    const { handle } = mount(MD, 'Done <script>window.pwned = 1</script> <img src=x onerror="window.pwned = 1">');
    await settle();
    handle.tiptap.commands.setTextSelection(handle.tiptap.state.doc.content.size - 1);
    handle.command('aiSummarize');
    await settle();
    const out = popover()!.querySelector('.ai-rw-out')!;
    expect(out.querySelector('script, img')).toBeNull();
    expect(out.textContent).toContain('<script>');
    expect((window as unknown as { pwned?: number }).pwned).toBeUndefined();
  });
});
