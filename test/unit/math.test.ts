import { describe, it, expect, afterEach } from 'vitest';
import { matchInlineMath, serializeMathBlock } from '../../src/webview/mathSyntax';
import { escapeMarkdownText } from '../../src/webview/markdownEscape';
import { bootWebview, type Harness } from '../harness/webviewHarness';

describe('matchInlineMath — delimiter rules', () => {
  it('matches a simple formula', () => {
    expect(matchInlineMath('$x^2$', 0)).toEqual({ latex: 'x^2', end: 5 });
  });

  it('rejects a space after the opener or before the closer', () => {
    expect(matchInlineMath('$ x$', 0)).toBeNull();
    expect(matchInlineMath('$x $', 0)).toBeNull();
  });

  it('rejects a closer followed by a digit (prices)', () => {
    expect(matchInlineMath('$5-$10', 0)).toBeNull();
  });

  it('leaves prose with two prices alone', () => {
    expect(matchInlineMath('costs $5 and $10 total', 6)).toBeNull();
  });

  it('skips escaped dollars inside the formula', () => {
    expect(matchInlineMath('$a\\$b$', 0)).toEqual({ latex: 'a\\$b', end: 6 });
  });

  it('does not treat `$$` as an inline opener', () => {
    expect(matchInlineMath('$$x$$', 0)).toBeNull();
  });

  it('does not span lines', () => {
    expect(matchInlineMath('$a\nb$', 0)).toBeNull();
  });

  it('serializes display math on its own fence lines', () => {
    expect(serializeMathBlock('x^2')).toBe('$$\nx^2\n$$');
  });
});

describe('escapeMarkdownText — dollar signs', () => {
  it('leaves prices untouched', () => {
    expect(escapeMarkdownText('costs $5 and $10')).toBe('costs $5 and $10');
  });

  it('escapes a literal `$x$` so it stays text', () => {
    expect(escapeMarkdownText('literal $x$ here')).toBe('literal \\$x$ here');
  });

  it('escapes `$$` at line start', () => {
    expect(escapeMarkdownText('$$ money', { startOfLine: true })).toBe('\\$$ money');
  });
});

let harness: Harness | null = null;
const settle = () => new Promise((r) => setTimeout(r, 30));

afterEach(() => {
  harness?.dispose();
  harness = null;
});

/** Type like a user: each char goes through `handleTextInput` so input rules fire. */
function typeWithRules(h: Harness, text: string): void {
  const view = h.wysiwygEditor().view;
  for (const ch of text) {
    const { from, to } = view.state.selection;
    const handled = view.someProp('handleTextInput', (f: any) => f(view, from, to, ch, () => view.state.tr.insertText(ch, from, to)));
    if (!handled) {view.dispatch(view.state.tr.insertText(ch, from, to));}
  }
}

async function roundTrip(md: string): Promise<{ out: string; h: Harness }> {
  const h = await bootWebview();
  harness = h;
  h.send({ type: 'update', content: md });
  await settle();
  return { out: h.wysiwygEditor().storage.markdown.getMarkdown(), h };
}

describe('math nodes — full webview round-trip', () => {
  it('parses inline math into a mathInline node and round-trips it', async () => {
    const { out, h } = await roundTrip('Energy is $E = mc^2$ here.');
    const types: string[] = [];
    h.wysiwygEditor().state.doc.descendants((n: any) => { types.push(n.type.name); });
    expect(types).toContain('mathInline');
    expect(out).toBe('Energy is $E = mc^2$ here.');
  });

  it('renders inline math with KaTeX', async () => {
    const { h } = await roundTrip('A $x^2$ b');
    const el = h.wysiwygEditor().view.dom.querySelector('.mikedown-math-inline .katex');
    expect(el).not.toBeNull();
  });

  it('round-trips a multi-line display block', async () => {
    const md = 'Before\n\n$$\n\\int_0^1 x^2\\,dx\n= \\frac{1}{3}\n$$\n\nAfter';
    const { out, h } = await roundTrip(md);
    let latex = '';
    h.wysiwygEditor().state.doc.descendants((n: any) => {
      if (n.type.name === 'mathBlock') {latex = n.attrs.latex;}
    });
    expect(latex).toBe('\\int_0^1 x^2\\,dx\n= \\frac{1}{3}');
    expect(out).toBe(md);
  });

  it('normalizes a one-line `$$ x $$` block onto fence lines', async () => {
    const { out } = await roundTrip('$$ a+b $$');
    expect(out).toBe('$$\na+b\n$$');
  });

  it('keeps prices and escaped dollars as plain text', async () => {
    const { out, h } = await roundTrip('Paid $5 and $10, or \\$20.');
    let hasMath = false;
    h.wysiwygEditor().state.doc.descendants((n: any) => {
      if (n.type.name.startsWith('math')) {hasMath = true;}
    });
    expect(hasMath).toBe(false);
    expect(out).toBe('Paid $5 and $10, or $20.');
  });

  it('does not parse math inside inline code', async () => {
    const { out } = await roundTrip('Use `$x$` literally.');
    expect(out).toBe('Use `$x$` literally.');
  });

  it('shows raw source when rendering is turned off', async () => {
    const { h } = await roundTrip('A $x^2$ b');
    h.send({ type: 'settings', renderMath: false });
    await settle();
    const el = h.wysiwygEditor().view.dom.querySelector('.mikedown-math-inline .mikedown-math-rendered');
    expect(el?.textContent).toBe('$x^2$');
    h.send({ type: 'settings', renderMath: true });
  });

  it('converts typed `$x$ ` into a math node', async () => {
    const { h } = await roundTrip('');
    typeWithRules(h, 'see $y_1$ ');
    await settle();
    expect(h.wysiwygEditor().storage.markdown.getMarkdown()).toBe('see $y_1$ ');
    let found = false;
    h.wysiwygEditor().state.doc.descendants((n: any) => { if (n.type.name === 'mathInline') {found = true;} });
    expect(found).toBe(true);
  });

  it('turns `$$ ` on an empty line into a display block', async () => {
    const { h } = await roundTrip('');
    typeWithRules(h, '$$ ');
    await settle();
    let found = false;
    h.wysiwygEditor().state.doc.descendants((n: any) => { if (n.type.name === 'mathBlock') {found = true;} });
    expect(found).toBe(true);
  });

  it('does not convert a typed price range', async () => {
    const { h } = await roundTrip('');
    typeWithRules(h, 'from $5-$10 ');
    await settle();
    let found = false;
    h.wysiwygEditor().state.doc.descendants((n: any) => { if (n.type.name === 'mathInline') {found = true;} });
    expect(found).toBe(false);
  });
});
