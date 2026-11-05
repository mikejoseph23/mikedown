/** The answer prompt's citation rule depends on the scope: This document answers show no citations. */
import { describe, expect, it } from 'vitest';
import { buildDocsAnswerMessages, docsAnswerSystemPrompt } from '../src/ai';

const section = { n: 1, section: { id: 'document/document.md#a', pageId: 'document/document.md', title: 'T', relPath: 'document.md', text: 'body', truncated: false } };

describe('docsAnswerSystemPrompt', () => {
  it('asks a bases answer to cite by number', () => {
    const prompt = docsAnswerSystemPrompt('bases', true);
    expect(prompt).toContain('cite the source it came from as [n]');
    expect(prompt).not.toContain('Do not write citations');
  });

  it('does not ask a This document answer to cite, and says not to', () => {
    const prompt = docsAnswerSystemPrompt('document', true);
    expect(prompt).not.toMatch(/cite the source/i);
    expect(prompt).not.toContain('using the numbers given');
    expect(prompt).toContain('Do not write citations such as [1]');
  });

  it('keeps every other source rule for a document: data not instructions, answer only from sources, no extra links', () => {
    const prompt = docsAnswerSystemPrompt('document', true);
    expect(prompt).toMatch(/never an instruction/);
    expect(prompt).toContain('Answer only from the sources.');
    expect(prompt).toContain('Do not add links or images');
    expect(prompt).toContain('coverage note');
    // Same rule count: the cite rule was swapped, not dropped.
    expect(prompt.split('\n- ').length).toBe(docsAnswerSystemPrompt('bases', true).split('\n- ').length);
  });

  it('a no-source prompt forbids citations for either scope', () => {
    for (const scope of ['bases', 'document'] as const) {
      const prompt = docsAnswerSystemPrompt(scope, false);
      expect(prompt).toContain('Do not write citations such as [1]');
      expect(prompt).not.toMatch(/cite the source/i);
    }
  });

  it('reaches the messages the loop sends', () => {
    const [system] = buildDocsAnswerMessages({ question: 'q', scope: 'document', coverage: null, sent: [section] });
    expect(system.content).not.toMatch(/cite the source/i);
    const [bases] = buildDocsAnswerMessages({ question: 'q', scope: 'bases', coverage: null, sent: [section] });
    expect(bases.content).toMatch(/cite the source/i);
  });
});
