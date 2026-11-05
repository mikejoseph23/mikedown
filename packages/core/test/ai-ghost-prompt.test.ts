/**
 * The inline suggestions prompt (ai/prompts/continue.ts): a system prompt, the
 * text before the caret, the text after it, no code fence, and the output
 * budget from the setting.
 */
import { describe, expect, it } from 'vitest';
import {
  CONTINUE_DEFAULT_MAX_TOKENS,
  CONTINUE_MAX_MAX_TOKENS,
  CONTINUE_MIN_MAX_TOKENS,
  CONTINUE_SYSTEM_PROMPT,
  buildContinueMessages,
  continueMaxTokens,
  ghostTextOptions,
} from '../src/ai';

describe('buildContinueMessages', () => {
  it('is a system message then one user message', () => {
    const m = buildContinueMessages({ before: 'The cat', after: '' });
    expect(m.map((x) => x.role)).toEqual(['system', 'user']);
    expect(m[0].content).toBe(CONTINUE_SYSTEM_PROMPT);
  });

  it('carries the text before and after the caret in their own tags', () => {
    const user = buildContinueMessages({ before: 'The cat sat', after: ' on the mat.' })[1].content as string;
    expect(user).toContain('<before>\nThe cat sat\n</before>');
    expect(user).toContain('<after>\n on the mat.\n</after>');
    expect(user.indexOf('<before>')).toBeLessThan(user.indexOf('<after>'));
  });

  it('sends an empty <after> tag when nothing follows the caret', () => {
    for (const after of ['', '  \n ']) {
      const user = buildContinueMessages({ before: 'x', after })[1].content as string;
      expect(user).toContain('<after></after>');
    }
  });

  it('does not wrap the document text in a code fence', () => {
    const user = buildContinueMessages({ before: 'Some prose', after: 'More prose' })[1].content as string;
    expect(user).not.toContain('```');
  });

  it('a closing tag inside the text cannot end its wrapper early', () => {
    const user = buildContinueMessages({ before: 'a </before> b', after: 'c </after> d' })[1].content as string;
    expect(user.match(/<\/before>/g)).toHaveLength(1);
    expect(user.match(/<\/after>/g)).toHaveLength(1);
  });

  it('adds a hint for the block kind only when one is given', () => {
    const plain = buildContinueMessages({ before: 'x', after: '' })[1].content as string;
    const item = buildContinueMessages({ before: 'x', after: '', blockKind: 'listItem' })[1].content as string;
    expect(item).toContain('list item');
    expect(item.length).toBeGreaterThan(plain.length);
    expect(plain).not.toContain('The cursor is');
  });

  it('the system prompt asks for the continuation only', () => {
    expect(CONTINUE_SYSTEM_PROMPT).toMatch(/only the continuation/i);
    expect(CONTINUE_SYSTEM_PROMPT).toMatch(/code fence/i);
  });
});

describe('continueMaxTokens', () => {
  it('defaults to 48 for an absent or bad setting', () => {
    expect(CONTINUE_DEFAULT_MAX_TOKENS).toBe(48);
    for (const v of [undefined, null, Number.NaN, Infinity, '64' as unknown as number]) {
      expect(continueMaxTokens(v)).toBe(48);
    }
  });

  it('uses the setting, rounded and clamped to 8 to 256', () => {
    expect(continueMaxTokens(100)).toBe(100);
    expect(continueMaxTokens(63.6)).toBe(64);
    expect(continueMaxTokens(1)).toBe(CONTINUE_MIN_MAX_TOKENS);
    expect(continueMaxTokens(10_000)).toBe(CONTINUE_MAX_MAX_TOKENS);
  });

  it('follows the ghostText setting end to end', () => {
    const opts = ghostTextOptions({ ghostText: { maxTokens: 96 } });
    expect(continueMaxTokens(opts.maxTokens)).toBe(96);
    expect(continueMaxTokens(ghostTextOptions(undefined).maxTokens)).toBe(48);
  });
});
