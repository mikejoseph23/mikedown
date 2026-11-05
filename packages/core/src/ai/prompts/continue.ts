/**
 * Inline suggestions ("ghost text", the `ghostText` feature). Pure: a chat
 * "continue" prompt sent to every model (decision D4; the wire has no FIM
 * path). The text before the caret is the user turn; the text after it rides
 * in an `<after>` tag so the model stops where the existing text resumes.
 */

import type { AiMessage } from '../types';

/** Which kind of text block the caret is in; steers the continuation's shape. */
export type GhostBlockKind = 'paragraph' | 'heading' | 'listItem' | 'blockquote';

/** Default and bounds for the output budget (tokens). */
export const CONTINUE_DEFAULT_MAX_TOKENS = 48;
export const CONTINUE_MIN_MAX_TOKENS = 8;
export const CONTINUE_MAX_MAX_TOKENS = 256;

export const CONTINUE_SYSTEM_PROMPT = [
  'You are an inline writing assistant inside a Markdown editor. You continue the text the user is writing, from exactly where the cursor is.',
  '',
  'Rules:',
  '- Output only the continuation: the next words that follow the text before the cursor. No preamble, no explanation, no labels.',
  '- Do not repeat any of the text before the cursor, and do not start over.',
  '- Do not wrap the output in quotation marks, backticks or a markdown code fence.',
  '- Continue in the same language, voice, tense and Markdown style as the text before the cursor.',
  '- Keep it short: finish the current sentence, or at most one more. Never start a new paragraph or a new heading.',
  '- If the text after the cursor (inside <after>) is not empty, write only what fits between the cursor and that text, and stop where <after> resumes. Never repeat or rewrite <after>.',
  '- If you have nothing useful to add, output nothing.',
].join('\n');

export interface ContinuePromptInput {
  /** The document text before the caret (see `ghostContext`). */
  before: string;
  /** The document text after the caret, possibly empty. */
  after: string;
  blockKind?: GhostBlockKind;
}

const BLOCK_HINTS: Record<GhostBlockKind, string> = {
  paragraph: 'The cursor is at the end of a paragraph.',
  heading: 'The cursor is in a heading: continue it as a heading, on one line, with no markdown marker.',
  listItem: 'The cursor is at the end of a list item: continue that item only, on one line. Do not write the next bullet.',
  blockquote: 'The cursor is at the end of a quoted paragraph. Continue the quote only, without a ">" marker.',
};

/** A closing tag inside the text must not end its own wrapper early. */
function fence(text: string, tag: string): string {
  return text.split(`</${tag}>`).join(`<\\/${tag}>`);
}

export function buildContinueMessages(input: ContinuePromptInput): AiMessage[] {
  const parts: string[] = [];
  parts.push(`Text before the cursor:\n<before>\n${fence(input.before, 'before')}\n</before>`);
  if (input.after.trim() !== '') {
    parts.push(`Text after the cursor:\n<after>\n${fence(input.after, 'after')}\n</after>`);
  } else {
    parts.push('Text after the cursor:\n<after></after>');
  }
  if (input.blockKind) {parts.push(BLOCK_HINTS[input.blockKind]);}
  parts.push('Write the continuation now. Output only the continuation text.');
  return [
    { role: 'system', content: CONTINUE_SYSTEM_PROMPT },
    { role: 'user', content: parts.join('\n\n') },
  ];
}

/**
 * Output budget for a request: the `features.ghostText.maxTokens` setting
 * (default 48), rounded and clamped to 8 to 256. A bad value gets the default.
 */
export function continueMaxTokens(setting?: number | null): number {
  if (typeof setting !== 'number' || !Number.isFinite(setting)) {return CONTINUE_DEFAULT_MAX_TOKENS;}
  return Math.min(CONTINUE_MAX_MAX_TOKENS, Math.max(CONTINUE_MIN_MAX_TOKENS, Math.round(setting)));
}
