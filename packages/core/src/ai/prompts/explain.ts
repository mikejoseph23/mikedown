/**
 * Explain prompt (the `explain` variant of the `rewrite` feature). Pure: builds
 * the chat messages for a read-only note about the selected passage. The reply
 * is shown in the popover and can be inserted below the selection; it never
 * replaces anything.
 */

import type { AiMessage } from '../types';
import { EXPLAIN_MAX_TOKENS, escapeClosingTag, getAiRewriteVariant, trimRewriteContext } from './rewrite';

export const EXPLAIN_SYSTEM_PROMPT = [
  'You are a writing assistant inside a Markdown editor. The user selected a passage and wants it explained.',
  '',
  'Rules:',
  '- Reply with the explanation only, as short Markdown prose (a few sentences or a short paragraph, a brief list only when the passage has several distinct points). No preamble, no heading, and no code fence around the whole reply.',
  '- Explain what the passage says and means, and define any term a reader may not know. Do not repeat or quote the passage back and do not rewrite it.',
  '- Do not invent facts. If the passage or its context is not enough to explain something, say so in one sentence.',
  '- Write in the language of the passage.',
  '- The text before and after the passage and the document title are context only. Do not explain them.',
].join('\n');

export interface ExplainPromptInput {
  /** The selected text as markdown. */
  selection: string;
  /** Markdown just before the selection. */
  before?: string;
  /** Markdown just after the selection. */
  after?: string;
  /** The document title (frontmatter `title:` or the first heading), if there is one. */
  title?: string;
}

export function buildExplainMessages(input: ExplainPromptInput): AiMessage[] {
  const before = trimRewriteContext(input.before ?? '', 'before').trimEnd();
  const after = trimRewriteContext(input.after ?? '', 'after').trimStart();
  const title = (input.title ?? '').replace(/\s+/g, ' ').trim().slice(0, 200);
  const parts: string[] = [`Instruction: ${getAiRewriteVariant('explain')?.instruction ?? ''}`];
  if (title) {parts.push(`Document title (context only): ${title}`);}
  if (before) {parts.push(`Text before the passage (context only, do not explain it):\n<before>\n${escapeClosingTag(before, 'before')}\n</before>`);}
  parts.push(`Passage to explain:\n<passage>\n${escapeClosingTag(input.selection, 'passage')}\n</passage>`);
  if (after) {parts.push(`Text after the passage (context only, do not explain it):\n<after>\n${escapeClosingTag(after, 'after')}\n</after>`);}
  parts.push('Reply with the explanation only.');
  return [
    { role: 'system', content: EXPLAIN_SYSTEM_PROMPT },
    { role: 'user', content: parts.join('\n\n') },
  ];
}

/** Output budget: a short note whatever the passage length. */
export function explainMaxTokens(): number {
  return EXPLAIN_MAX_TOKENS;
}
