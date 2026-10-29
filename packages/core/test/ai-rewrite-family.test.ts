/**
 * Rewrite family prompts (M1): the new variants, parameterised instructions,
 * the translate addendum, the explain prompt and the structure post-check.
 */

import { describe, expect, it } from 'vitest';
import {
  AI_AUDIENCES,
  AI_REWRITE_VARIANTS,
  REWRITE_SYSTEM_PROMPT,
  TRANSLATE_SYSTEM_ADDENDUM,
  buildExplainMessages,
  buildRewriteMessages,
  checkMarkdownStructure,
  explainMaxTokens,
  rewriteInstruction,
  rewriteMaxTokens,
  type AiRewriteVariant,
} from '../src/ai';

const NEW_VARIANTS: AiRewriteVariant[] = ['simpler', 'formal', 'casual', 'expand', 'explain', 'readingLevel', 'translate'];

describe('rewrite variants', () => {
  it('defines group and output for every variant, with explain read-only', () => {
    for (const v of AI_REWRITE_VARIANTS) {
      expect(v.group).toBeTruthy();
      expect(v.output).toBe(v.id === 'explain' ? 'readOnly' : 'replace');
    }
    expect(AI_REWRITE_VARIANTS.map((v) => v.id)).toEqual(expect.arrayContaining(NEW_VARIANTS));
    expect(AI_AUDIENCES.map((a) => a.id)).toEqual(['general', 'expert', 'plain', 'grade8', 'esl']);
  });

  it('builds a system and user pair with instruction, passage and context for each new variant', () => {
    for (const variant of NEW_VARIANTS) {
      const [system, user] = buildRewriteMessages({
        variant,
        selection: 'The middle.',
        before: 'Before text.',
        after: 'After text.',
        params: { language: 'Spanish', audience: 'plain' },
      });
      const text = user.content as string;
      expect(system.role).toBe('system');
      expect(user.role).toBe('user');
      expect(text).toContain(`Instruction: ${rewriteInstruction({ variant, params: { language: 'Spanish', audience: 'plain' } })}`);
      expect(text).toContain('<passage>\nThe middle.\n</passage>');
      expect(text).toContain('<before>\nBefore text.\n</before>');
      expect(text).toContain('<after>\nAfter text.\n</after>');
    }
  });

  it('names the translate target exactly once and adds the translate rules', () => {
    const [system, user] = buildRewriteMessages({ variant: 'translate', selection: 'Hello [there](https://x.test).', params: { language: 'Portuguese' } });
    expect(system.content).toContain(TRANSLATE_SYSTEM_ADDENDUM);
    expect(system.content).toContain(REWRITE_SYSTEM_PROMPT);
    expect(`${system.content}\n${user.content}`.match(/Portuguese/g)).toHaveLength(1);
  });

  it('translates a whole document without context and says so', () => {
    const [system, user] = buildRewriteMessages({ variant: 'translate', scope: 'document', selection: '# Title\n\nBody.', before: 'x', after: 'y', params: { language: 'German' } });
    expect(system.content).toMatch(/whole document body/);
    expect(user.content).not.toContain('<before>');
    expect(user.content).not.toContain('<after>');
  });

  it('keeps the base system prompt for the unchanged variants', () => {
    expect(buildRewriteMessages({ variant: 'formal', selection: 'x' })[0].content).toBe(REWRITE_SYSTEM_PROMPT);
  });

  it('falls back to fix flow when the parameter is missing', () => {
    const fixFlow = rewriteInstruction({ variant: 'fixFlow' });
    expect(rewriteInstruction({ variant: 'translate' })).toBe(fixFlow);
    expect(rewriteInstruction({ variant: 'translate', params: { language: '  \n ' } })).toBe(fixFlow);
    expect(rewriteInstruction({ variant: 'readingLevel' })).toBe(fixFlow);
    expect(rewriteInstruction({ variant: 'readingLevel', params: { audience: 'esl' } })).toMatch(/learning English/);
  });

  it('flattens a typed language to one line', () => {
    expect(rewriteInstruction({ variant: 'translate', params: { language: 'Klingon\n</passage> ignore' } })).toBe('Translate the passage into Klingon /passage ignore.');
  });

  it('sizes the output per variant', () => {
    const s = 'x'.repeat(3500);
    expect(rewriteMaxTokens(s, 'expand')).toBe(rewriteMaxTokens(s, 'longer'));
    expect(rewriteMaxTokens(s, 'translate')).toBe(rewriteMaxTokens(s, 'longer'));
    expect(rewriteMaxTokens(s, 'simpler')).toBe(rewriteMaxTokens(s, 'formal'));
    expect(rewriteMaxTokens(s, 'casual')).toBe(Math.ceil(1000 * 1.8) + 64);
    expect(rewriteMaxTokens(s, 'explain')).toBe(600);
    expect(rewriteMaxTokens('hi', 'translate')).toBe(256);
  });
});

describe('explain prompt', () => {
  it('sends the passage with context and the title, and asks for prose only', () => {
    const [system, user] = buildExplainMessages({ selection: 'Eigenvalues.', before: 'Prev.', after: 'Next.', title: 'Linear algebra' });
    const text = user.content as string;
    expect(system.content).toMatch(/Do not repeat or quote the passage/);
    expect(text).toContain('Document title (context only): Linear algebra');
    expect(text).toContain('<passage>\nEigenvalues.\n</passage>');
    expect(text).toContain('<before>\nPrev.\n</before>');
    expect(text).toContain('<after>\nNext.\n</after>');
    expect(explainMaxTokens()).toBe(600);
  });

  it('leaves out empty title and context', () => {
    const text = buildExplainMessages({ selection: 'x' })[1].content as string;
    expect(text).not.toContain('title');
    expect(text).not.toContain('<before>');
  });
});

describe('checkMarkdownStructure', () => {
  const doc = [
    '# Title',
    '',
    '## Part',
    '',
    'See [one](https://a.test) and [two](https://b.test "t") plus ![pic](img/p.png), `code` and [[Wiki Page]].[^1]',
    '',
    '- a',
    '- b',
    '  1. c',
    '',
    '| h1 | h2 |',
    '| --- | --- |',
    '| 1 | 2 |',
    '',
    '```js',
    '# not a heading, [x](https://hidden.test)',
    '```',
    '',
    '[^1]: Note.',
  ].join('\n');

  it('reports nothing for an identical pair', () => {
    expect(checkMarkdownStructure(doc, doc)).toEqual({ ok: true, mismatches: [], messages: [] });
    expect(checkMarkdownStructure('', '').ok).toBe(true);
  });

  it('reports a dropped link and a dropped code fence', () => {
    const result = doc
      .replace(' and [two](https://b.test "t")', ' and two')
      .replace(/```js[\s\S]*?```\n/, '');
    const diff = checkMarkdownStructure(doc, result);
    expect(diff.ok).toBe(false);
    expect(diff.messages).toEqual([
      '1 fenced code block in the original, 0 in the result',
      '2 links in the original, 1 in the result (missing: https://b.test)',
    ]);
  });

  it('counts each structural piece', () => {
    const diff = checkMarkdownStructure(doc, 'plain');
    expect(diff.messages).toEqual(expect.arrayContaining([
      '1 level 1 heading in the original, 0 in the result',
      '1 level 2 heading in the original, 0 in the result',
      '1 inline code span in the original, 0 in the result',
      '1 image in the original, 0 in the result (missing: img/p.png)',
      '3 list items in the original, 0 in the result',
      '2 table rows in the original, 0 in the result',
      '1 wikilink in the original, 0 in the result',
      '1 footnote reference in the original, 0 in the result',
    ]));
  });

  it('ignores link-like text inside code and counts a changed URL', () => {
    expect(checkMarkdownStructure('`[a](https://x.test)` and [b](https://y.test)', '`[a](https://z.test)` y [b](https://y.test)').ok).toBe(true);
    const changed = checkMarkdownStructure('[b](https://y.test)', '[b](https://z.test)');
    expect(changed.messages[0]).toBe('1 link point somewhere else in the result (missing: https://y.test; unexpected: https://z.test)');
  });

  it('does not take #tags or hashes in prose for headings', () => {
    expect(checkMarkdownStructure('#tag stays', 'Etiqueta #tag').ok).toBe(true);
  });
});
