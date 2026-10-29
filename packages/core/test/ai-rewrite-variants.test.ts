/**
 * Rewrite variant prompts (T1): every variant builds a message pair, the
 * parameterised ones render their parameter or fall back, the output budget
 * stays in range, and Explain never asks for a rewrite. Complements the M1
 * cases in ai-rewrite-family.test.ts.
 */

import { describe, expect, it } from 'vitest';
import {
  AI_AUDIENCES,
  AI_REWRITE_VARIANTS,
  EXPLAIN_MAX_TOKENS,
  REWRITE_INSTRUCTION_MAX_CHARS,
  REWRITE_LANGUAGE_MAX_CHARS,
  buildExplainMessages,
  buildRewriteMessages,
  explainMaxTokens,
  rewriteInstruction,
  rewriteMaxTokens,
} from '../src/ai';

const ALL_IDS = AI_REWRITE_VARIANTS.map((v) => v.id);
const SIZED = ALL_IDS.filter((v) => v !== 'explain');
const fixFlow = rewriteInstruction({ variant: 'fixFlow' });

describe('every variant builds messages', () => {
  it.each(ALL_IDS)('%s: a system and a user message holding the passage', (variant) => {
    const [system, user] = buildRewriteMessages({
      variant,
      instruction: 'Make it rhyme.',
      selection: 'The passage.',
      params: { language: 'French', audience: 'grade8' },
    });
    expect(system.role).toBe('system');
    expect(user.role).toBe('user');
    expect(String(system.content).length).toBeGreaterThan(100);
    const text = String(user.content);
    expect(text).toContain('<passage>\nThe passage.\n</passage>');
    expect(text).toMatch(/^Instruction( \(from the user\))?: /);
    expect(text.trimEnd()).toMatch(/Reply with the (rewritten passage|explanation) only\.$/);
  });

  it('has a distinct, non-empty instruction for every variant except custom', () => {
    const lines = ALL_IDS.filter((id) => id !== 'custom').map((id) => rewriteInstruction({ variant: id, params: { language: 'French', audience: 'plain' } }));
    expect(lines.every((l) => l.length > 10)).toBe(true);
    expect(new Set(lines).size).toBe(lines.length);
  });

  it('quotes a custom instruction in its own block and caps its length', () => {
    const long = 'x'.repeat(REWRITE_INSTRUCTION_MAX_CHARS + 500);
    const [, user] = buildRewriteMessages({ variant: 'custom', instruction: long, selection: 's' });
    const inner = /<instruction>\n([\s\S]*)\n<\/instruction>/.exec(String(user.content))![1];
    expect(inner).toHaveLength(REWRITE_INSTRUCTION_MAX_CHARS);
    expect(rewriteInstruction({ variant: 'custom', instruction: '   ' })).toBe(fixFlow);
  });
});

describe('parameters', () => {
  it('translate renders the language, trimmed and flattened to one short line', () => {
    expect(rewriteInstruction({ variant: 'translate', params: { language: '  Spanish ' } })).toBe('Translate the passage into Spanish.');
    expect(rewriteInstruction({ variant: 'translate', params: { language: 'Chinese\n(Simplified)' } })).toBe('Translate the passage into Chinese (Simplified).');
    const long = rewriteInstruction({ variant: 'translate', params: { language: 'a'.repeat(200) } });
    expect(long).toBe(`Translate the passage into ${'a'.repeat(REWRITE_LANGUAGE_MAX_CHARS)}.`);
  });

  it('a language holding a replacement pattern is inserted literally', () => {
    expect(rewriteInstruction({ variant: 'translate', params: { language: "Pig $& Latin $'" } })).toBe("Translate the passage into Pig $& Latin $'.");
  });

  it('readingLevel renders the instruction of each audience', () => {
    for (const audience of AI_AUDIENCES) {
      expect(rewriteInstruction({ variant: 'readingLevel', params: { audience: audience.id } })).toBe(audience.instruction);
      const user = String(buildRewriteMessages({ variant: 'readingLevel', selection: 's', params: { audience: audience.id } })[1].content);
      expect(user).toContain(`Instruction: ${audience.instruction}`);
    }
  });

  it('a missing, blank or unknown parameter falls back to fix flow', () => {
    expect(rewriteInstruction({ variant: 'translate', params: {} })).toBe(fixFlow);
    expect(rewriteInstruction({ variant: 'translate', params: { language: '<>' } })).toBe(fixFlow);
    expect(rewriteInstruction({ variant: 'readingLevel', params: {} })).toBe(fixFlow);
    expect(rewriteInstruction({ variant: 'readingLevel', params: { audience: 'nonsense' as never } })).toBe(fixFlow);
    const user = String(buildRewriteMessages({ variant: 'translate', selection: 's' })[1].content);
    expect(user).toContain(`Instruction: ${fixFlow}`);
    expect(user).not.toMatch(/Translate the passage into/);
  });

  it('parameters are ignored by variants that take none', () => {
    expect(rewriteInstruction({ variant: 'shorter', params: { language: 'French', audience: 'esl' } })).toBe(rewriteInstruction({ variant: 'shorter' }));
  });
});

describe('rewriteMaxTokens ranges', () => {
  it('never goes below 256 or above 4096, whatever the variant or length', () => {
    for (const variant of SIZED) {
      for (const length of [0, 1, 50, 500, 5000, 50_000, 500_000]) {
        const n = rewriteMaxTokens('x'.repeat(length), variant);
        expect(n, `${variant} @ ${length}`).toBeGreaterThanOrEqual(256);
        expect(n, `${variant} @ ${length}`).toBeLessThanOrEqual(4096);
      }
    }
  });

  it('grows with the passage until the cap', () => {
    for (const variant of SIZED) {
      expect(rewriteMaxTokens('x'.repeat(9000), variant), variant).toBeGreaterThan(rewriteMaxTokens('x'.repeat(2000), variant));
    }
    expect(rewriteMaxTokens('x'.repeat(200_000), 'translate')).toBe(4096);
  });

  it('gives expanding variants more room than the shortening ones', () => {
    const s = 'x'.repeat(3500);
    for (const v of ['longer', 'expand', 'translate', 'custom'] as const) {
      expect(rewriteMaxTokens(s, v), v).toBeGreaterThan(rewriteMaxTokens(s, 'simpler'));
    }
    expect(rewriteMaxTokens(s, 'simpler')).toBeGreaterThan(rewriteMaxTokens(s, 'shorter'));
    expect(rewriteMaxTokens(s, 'fixFlow')).toBe(rewriteMaxTokens(s, 'shorter'));
    expect(rewriteMaxTokens(s, 'readingLevel')).toBe(rewriteMaxTokens(s, 'shorter'));
  });

  it('explain is a short fixed note, whatever the passage length', () => {
    expect(rewriteMaxTokens('', 'explain')).toBe(EXPLAIN_MAX_TOKENS);
    expect(rewriteMaxTokens('x'.repeat(100_000), 'explain')).toBe(EXPLAIN_MAX_TOKENS);
    expect(explainMaxTokens()).toBe(EXPLAIN_MAX_TOKENS);
  });
});

describe('explain messages do not ask to rewrite', () => {
  const asks = /\b(rewrite|rewritten|revise|reword|paraphrase)\b/i;

  it('buildExplainMessages asks for an explanation only', () => {
    const [system, user] = buildExplainMessages({ selection: 'Eigenvalues.', before: 'Before.', after: 'After.', title: 'Notes' });
    // The only mention of rewriting in the system prompt is the prohibition.
    expect(String(system.content).match(new RegExp(asks.source, 'gi'))).toHaveLength(1);
    expect(String(system.content)).toMatch(/do not rewrite it/i);
    expect(String(user.content)).not.toMatch(asks);
    expect(String(user.content)).toContain('Passage to explain:');
    expect(String(user.content).trimEnd()).toMatch(/Reply with the explanation only\.$/);
  });

  it('the explain variant of buildRewriteMessages lifts the "version of the passage" rule', () => {
    const [system, user] = buildRewriteMessages({ variant: 'explain', selection: 'Eigenvalues.' });
    expect(String(system.content)).toMatch(/not a version of it/);
    expect(String(system.content)).toMatch(/do not repeat the passage/);
    expect(String(user.content)).toContain('Passage to explain:');
    expect(String(user.content)).not.toContain('Passage to rewrite');
    expect(String(user.content)).not.toMatch(/Reply with the rewritten passage/);
    expect(String(user.content)).toContain('Reply with the explanation only.');
  });

  it('is the only read-only variant', () => {
    expect(AI_REWRITE_VARIANTS.filter((v) => v.output === 'readOnly').map((v) => v.id)).toEqual(['explain']);
  });
});
