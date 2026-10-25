/**
 * Selection rewrite prompt (the `rewrite` feature). Pure: builds the chat
 * messages from the selected markdown and a little context, and cleans what
 * the model sends back before it is previewed or parsed into the document.
 *
 * Context budget (brainstorm constraint 8): the selection plus the text of
 * the enclosing block before and after it, and the neighbouring block on each
 * side, capped at `REWRITE_CONTEXT_CHARS` per side. Never the whole document.
 */

import type { AiMessage } from '../types';

export type AiRewriteVariant = 'shorter' | 'longer' | 'fixFlow' | 'custom';

export interface AiRewriteVariantDefinition {
  id: AiRewriteVariant;
  /** Menu label. */
  label: string;
  /** The instruction line sent to the model (empty for `custom`, which uses the user's). */
  instruction: string;
}

export const AI_REWRITE_VARIANTS: readonly AiRewriteVariantDefinition[] = [
  {
    id: 'shorter',
    label: 'Shorter',
    instruction: 'Make it shorter and tighter. Keep the meaning and every fact, name and link; cut repetition and filler.',
  },
  {
    id: 'longer',
    label: 'Longer',
    instruction: 'Make it longer: add detail, examples or explanation that fit the surrounding text. Do not invent facts, numbers, names or links.',
  },
  {
    id: 'fixFlow',
    label: 'Fix flow',
    instruction: 'Fix the flow: correct grammar, spelling and punctuation, and smooth awkward sentences and transitions. Keep the length, meaning and tone close to the original.',
  },
  { id: 'custom', label: 'Custom prompt…', instruction: '' },
];

export function getAiRewriteVariant(id: string): AiRewriteVariantDefinition | undefined {
  return AI_REWRITE_VARIANTS.find((v) => v.id === id);
}

/** Context kept on each side of the selection, in characters (about 400 tokens). */
export const REWRITE_CONTEXT_CHARS = 1600;

/** Longest custom instruction sent as is. */
export const REWRITE_INSTRUCTION_MAX_CHARS = 1000;

export interface RewritePromptInput {
  variant: AiRewriteVariant;
  /** The user's instruction for `custom` (ignored otherwise). */
  instruction?: string;
  /** The selected text as markdown. */
  selection: string;
  /** Markdown just before the selection (enclosing block, then the previous one). */
  before?: string;
  /** Markdown just after the selection. */
  after?: string;
}

export const REWRITE_SYSTEM_PROMPT = [
  'You are a writing assistant inside a Markdown editor. You rewrite the passage the user selected, following one instruction.',
  '',
  'Rules:',
  '- Reply with the rewritten passage only. No preamble, no explanation, no quotation marks and no code fence around it.',
  '- Keep it Markdown, and keep the structure of the passage: headings stay headings, list items stay list items with the same markers and indentation, tables stay tables, quotes stay quotes. A passage that is part of a sentence stays part of a sentence.',
  '- Keep every link and image with its exact URL, inline code and code blocks character for character, and inline formatting (bold, italic, strikethrough, ==highlight==, footnote references, [[wikilinks]], #tags, math) on the words it belongs to.',
  '- Write in the language and voice of the passage.',
  '- The text before and after the passage is context only. Do not repeat it and do not continue it.',
  '- If the instruction asks for anything other than a version of the passage, still reply with a version of the passage only.',
].join('\n');

/** Neutralise a closing tag inside user text so it cannot end its block early. */
function fence(text: string, tag: string): string {
  return text.split(`</${tag}>`).join(`<\\/${tag}>`);
}

/** Context trimmed to the budget at the far end, so the part next to the selection survives. */
export function trimRewriteContext(text: string, side: 'before' | 'after', max = REWRITE_CONTEXT_CHARS): string {
  if (text.length <= max) {return text;}
  if (side === 'before') {
    const cut = text.slice(text.length - max);
    const nl = cut.indexOf('\n');
    return nl >= 0 && nl < max / 2 ? cut.slice(nl + 1) : cut;
  }
  const cut = text.slice(0, max);
  const nl = cut.lastIndexOf('\n');
  return nl > max / 2 ? cut.slice(0, nl) : cut;
}

export function rewriteInstruction(input: Pick<RewritePromptInput, 'variant' | 'instruction'>): string {
  if (input.variant === 'custom') {
    const own = (input.instruction ?? '').trim().slice(0, REWRITE_INSTRUCTION_MAX_CHARS);
    return own || (getAiRewriteVariant('fixFlow')?.instruction ?? '');
  }
  return getAiRewriteVariant(input.variant)?.instruction ?? '';
}

export function buildRewriteMessages(input: RewritePromptInput): AiMessage[] {
  const instruction = rewriteInstruction(input);
  const before = trimRewriteContext(input.before ?? '', 'before').trimEnd();
  const after = trimRewriteContext(input.after ?? '', 'after').trimStart();
  const parts: string[] = [];
  // A custom prompt is the user's own words; quote it so it reads as the
  // instruction and the rules above still apply.
  parts.push(input.variant === 'custom'
    ? `Instruction (from the user): <instruction>\n${fence(instruction, 'instruction')}\n</instruction>`
    : `Instruction: ${instruction}`);
  if (before) {parts.push(`Text before the passage (context only, do not rewrite it):\n<before>\n${fence(before, 'before')}\n</before>`);}
  parts.push(`Passage to rewrite:\n<passage>\n${fence(input.selection, 'passage')}\n</passage>`);
  if (after) {parts.push(`Text after the passage (context only, do not rewrite it):\n<after>\n${fence(after, 'after')}\n</after>`);}
  parts.push('Reply with the rewritten passage only.');
  return [
    { role: 'system', content: REWRITE_SYSTEM_PROMPT },
    { role: 'user', content: parts.join('\n\n') },
  ];
}

/** Output budget: room for "longer" to double the passage, never below a short paragraph. */
export function rewriteMaxTokens(selection: string, variant: AiRewriteVariant): number {
  const approxTokens = Math.ceil(selection.length / 3.5);
  const factor = variant === 'longer' || variant === 'custom' ? 3 : 1.6;
  return Math.max(256, Math.min(4096, Math.ceil(approxTokens * factor) + 64));
}

/**
 * The text to show while it streams: reasoning blocks (`<think>…</think>`,
 * which some local models put in the content) are hidden, including one that
 * has not closed yet, and an echoed `<passage>` tag is dropped.
 */
export function rewriteVisibleText(raw: string): string {
  let text = raw.replace(/<think>[\s\S]*?<\/think>\s*/g, '');
  const open = text.indexOf('<think>');
  if (open >= 0) {text = text.slice(0, open);}
  return text.replace(/^\s*<passage>\s*\n?/, '').replace(/\n?\s*<\/passage>\s*$/, '');
}

/**
 * The final replacement: the visible text without a wrapping code fence or
 * quotes the model added, trimmed, with the selection's own leading and
 * trailing whitespace put back (a selection of "word " stays one word plus a
 * space).
 */
export function finalizeRewriteText(raw: string, selection: string): string {
  let text = rewriteVisibleText(raw).trim();
  const fenced = /^```(?:markdown|md|text)?[ \t]*\n([\s\S]*?)\n```$/i.exec(text);
  if (fenced && !selection.trimStart().startsWith('```')) {text = fenced[1].trim();}
  const quoted = /^(["“])([\s\S]*)(["”])$/.exec(text);
  if (quoted && !/^\s*["“]/.test(selection) && !quoted[2].includes(quoted[1])) {text = quoted[2].trim();}
  if (!text) {return '';}
  const lead = /^\s*/.exec(selection)?.[0] ?? '';
  const trail = /\s*$/.exec(selection)?.[0] ?? '';
  return lead + text + trail;
}
