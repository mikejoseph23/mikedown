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

export type AiRewriteVariant =
  | 'shorter' | 'longer' | 'expand' | 'simpler' | 'fixFlow'
  | 'formal' | 'casual' | 'readingLevel' | 'translate' | 'explain' | 'custom';

/** Menu group a variant belongs to (the popover's choose phase renders one section per group). */
export type AiRewriteGroup = 'length' | 'tone' | 'audience' | 'translate' | 'explain' | 'custom';

/** `replace` swaps the selection; `readOnly` only shows text (Explain) and can insert it below. */
export type AiRewriteOutput = 'replace' | 'readOnly';

export type AiAudience = 'general' | 'expert' | 'plain' | 'grade8' | 'esl';

export interface AiAudienceDefinition {
  id: AiAudience;
  label: string;
  /** Instruction line sent to the model for `readingLevel`. */
  instruction: string;
}

export const AI_AUDIENCES: readonly AiAudienceDefinition[] = [
  {
    id: 'general',
    label: 'General audience',
    instruction: 'Rewrite it for a general audience: plain words, short sentences, jargon explained or avoided. Keep the meaning and every fact, name and link.',
  },
  {
    id: 'expert',
    label: 'Expert',
    instruction: 'Rewrite it for expert readers: precise terminology, no basic explanations, dense and direct. Keep the meaning and every fact, name and link.',
  },
  {
    id: 'plain',
    label: 'Plain language',
    instruction: 'Rewrite it in plain language: everyday words, short sentences, active voice, no jargon or idioms. Keep the meaning and every fact, name and link.',
  },
  {
    id: 'grade8',
    label: '8th grade',
    instruction: 'Rewrite it at an 8th grade reading level: common words, short sentences, one idea at a time. Keep the meaning and every fact, name and link.',
  },
  {
    id: 'esl',
    label: 'English learners (ESL)',
    instruction: 'Rewrite it for readers who are learning English: simple vocabulary, short direct sentences, literal wording, no idioms or phrasal verbs. Keep the meaning and every fact, name and link.',
  },
];

export function getAiAudience(id: string): AiAudienceDefinition | undefined {
  return AI_AUDIENCES.find((a) => a.id === id);
}

export interface AiRewriteVariantDefinition {
  id: AiRewriteVariant;
  /** Menu label. */
  label: string;
  /**
   * The instruction line sent to the model. Empty for `custom` (the user's own
   * words); `{language}` and `{audience}` are filled from `RewritePromptInput.params`.
   */
  instruction: string;
  group: AiRewriteGroup;
  output: AiRewriteOutput;
  /** The parameter this variant needs before it can run (a second-level picker supplies it). */
  param?: 'language' | 'audience';
}

/** Order here is the menu order. */
export const AI_REWRITE_VARIANTS: readonly AiRewriteVariantDefinition[] = [
  {
    id: 'shorter',
    label: 'Shorter',
    instruction: 'Make it shorter and tighter. Keep the meaning and every fact, name and link; cut repetition and filler.',
    group: 'length',
    output: 'replace',
  },
  {
    id: 'longer',
    label: 'Longer',
    instruction: 'Make it longer: add detail, examples or explanation that fit the surrounding text. Do not invent facts, numbers, names or links.',
    group: 'length',
    output: 'replace',
  },
  {
    id: 'expand',
    label: 'Expand',
    instruction: 'Expand it: develop each point with the reasoning, detail or an example that the surrounding text supports, so it reads as a fuller passage. Do not invent facts, numbers, names or links.',
    group: 'length',
    output: 'replace',
  },
  {
    id: 'simpler',
    label: 'Simpler',
    instruction: 'Make it simpler: shorter sentences, everyday words, one idea at a time. Keep the meaning and every fact, name and link.',
    group: 'tone',
    output: 'replace',
  },
  {
    id: 'fixFlow',
    label: 'Fix flow',
    instruction: 'Fix the flow: correct grammar, spelling and punctuation, and smooth awkward sentences and transitions. Keep the length, meaning and tone close to the original.',
    group: 'tone',
    output: 'replace',
  },
  {
    id: 'formal',
    label: 'More formal',
    instruction: 'Make the tone more formal and professional: no contractions or slang, precise wording. Keep the meaning, every fact and the length close to the original.',
    group: 'tone',
    output: 'replace',
  },
  {
    id: 'casual',
    label: 'More casual',
    instruction: 'Make the tone more casual and conversational: contractions and everyday phrasing. Keep the meaning, every fact and the length close to the original.',
    group: 'tone',
    output: 'replace',
  },
  {
    id: 'readingLevel',
    label: 'Reading level…',
    instruction: '{audience}',
    group: 'audience',
    output: 'replace',
    param: 'audience',
  },
  {
    id: 'translate',
    label: 'Translate…',
    instruction: 'Translate the passage into {language}.',
    group: 'translate',
    output: 'replace',
    param: 'language',
  },
  {
    id: 'explain',
    label: 'Explain',
    instruction: 'Explain what the passage says and means in plain words, as a short note for the reader. Do not repeat the passage.',
    group: 'explain',
    output: 'readOnly',
  },
  { id: 'custom', label: 'Custom prompt…', instruction: '', group: 'custom', output: 'replace' },
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
  /** Values for the parameterised variants (`translate` needs `language`, `readingLevel` needs `audience`). */
  params?: AiRewriteParams;
  /**
   * `document` for a whole-document run (`translate`): the passage is the body
   * without its frontmatter and no context is sent. Default `selection`.
   */
  scope?: AiRewriteScope;
}

export interface AiRewriteParams {
  language?: string;
  audience?: AiAudience;
}

export type AiRewriteScope = 'selection' | 'document';

/** Longest target language name sent (it is free text from "Other…"). */
export const REWRITE_LANGUAGE_MAX_CHARS = 60;

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

/**
 * Appended to the system prompt for `translate`. It overrides the "write in the
 * language of the passage" rule; the target language is named only in the
 * instruction line.
 */
export const TRANSLATE_SYSTEM_ADDENDUM = [
  'This is a translation. The "write in the language and voice of the passage" rule above does not apply: write in the language named in the instruction.',
  '- Translate prose only: paragraph text, list item text, table cell text, heading text, image alt text and link text.',
  '- Keep verbatim, untranslated: the Markdown syntax itself (heading marks, list markers and indentation, table pipes and separator rows, quote marks), link and image URLs, inline code and fenced code blocks (including their language tag), [[wikilinks]], #tags, math, footnote markers such as [^1], HTML tags and frontmatter keys.',
  '- Keep the line structure: the same number of lines, blocks and list items in the same order, with blank lines where the passage has them.',
  '- Keep names of people, products and places as they are unless they have a well established translation.',
].join('\n');

/** Appended to the system prompt when the instruction asks for an explanation (the `explain` variant). */
export const EXPLAIN_SYSTEM_ADDENDUM =
  'The instruction asks for an explanation of the passage, not a version of it: the "version of the passage" rules above do not apply. Reply with the explanation only, as Markdown prose, and do not repeat the passage.';

/** The whole-document variant of the translation note. */
export const TRANSLATE_DOCUMENT_NOTE =
  'The passage is a whole document body (its frontmatter has been removed and is handled elsewhere). Translate all of it, from the first line to the last.';

/** Neutralise a closing tag inside user text so it cannot end its block early. */
export function escapeClosingTag(text: string, tag: string): string {
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

/** Target language as typed, flattened to one short line (it ends up inside a prompt). */
export function normalizeRewriteLanguage(language: string | undefined): string {
  return (language ?? '').replace(/[<>\r\n]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, REWRITE_LANGUAGE_MAX_CHARS);
}

/**
 * The instruction line for a variant. A parameterised variant whose parameter
 * is missing or unknown falls back to `fixFlow`, like an empty `custom`.
 */
export function rewriteInstruction(input: Pick<RewritePromptInput, 'variant' | 'instruction' | 'params'>): string {
  const fallback = getAiRewriteVariant('fixFlow')?.instruction ?? '';
  if (input.variant === 'custom') {
    const own = (input.instruction ?? '').trim().slice(0, REWRITE_INSTRUCTION_MAX_CHARS);
    return own || fallback;
  }
  const def = getAiRewriteVariant(input.variant);
  if (!def) {return '';}
  if (def.param === 'language') {
    const language = normalizeRewriteLanguage(input.params?.language);
    return language ? def.instruction.replace('{language}', () => language) : fallback;
  }
  if (def.param === 'audience') {
    const audience = input.params?.audience ? getAiAudience(input.params.audience) : undefined;
    return audience ? def.instruction.replace('{audience}', () => audience.instruction) : fallback;
  }
  return def.instruction;
}

/** The system prompt for a variant: the shared rules plus the translate or explain addendum. */
export function rewriteSystemPrompt(variant: AiRewriteVariant, scope: AiRewriteScope = 'selection'): string {
  if (variant === 'translate') {
    return [REWRITE_SYSTEM_PROMPT, TRANSLATE_SYSTEM_ADDENDUM, ...(scope === 'document' ? [TRANSLATE_DOCUMENT_NOTE] : [])].join('\n\n');
  }
  if (variant === 'explain') {return `${REWRITE_SYSTEM_PROMPT}\n\n${EXPLAIN_SYSTEM_ADDENDUM}`;}
  return REWRITE_SYSTEM_PROMPT;
}

export function buildRewriteMessages(input: RewritePromptInput): AiMessage[] {
  const instruction = rewriteInstruction(input);
  const scope: AiRewriteScope = input.scope === 'document' && input.variant === 'translate' ? 'document' : 'selection';
  const before = scope === 'document' ? '' : trimRewriteContext(input.before ?? '', 'before').trimEnd();
  const after = scope === 'document' ? '' : trimRewriteContext(input.after ?? '', 'after').trimStart();
  const parts: string[] = [];
  // A custom prompt is the user's own words; quote it so it reads as the
  // instruction and the rules above still apply.
  parts.push(input.variant === 'custom'
    ? `Instruction (from the user): <instruction>\n${escapeClosingTag(instruction, 'instruction')}\n</instruction>`
    : `Instruction: ${instruction}`);
  if (before) {parts.push(`Text before the passage (context only, do not rewrite it):\n<before>\n${escapeClosingTag(before, 'before')}\n</before>`);}
  parts.push(`${input.variant === 'explain' ? 'Passage to explain' : 'Passage to rewrite'}:\n<passage>\n${escapeClosingTag(input.selection, 'passage')}\n</passage>`);
  if (after) {parts.push(`Text after the passage (context only, do not rewrite it):\n<after>\n${escapeClosingTag(after, 'after')}\n</after>`);}
  parts.push(input.variant === 'explain' ? 'Reply with the explanation only.' : 'Reply with the rewritten passage only.');
  return [
    { role: 'system', content: rewriteSystemPrompt(input.variant, scope) },
    { role: 'user', content: parts.join('\n\n') },
  ];
}

/** Output budget for `explain`: a short note, independent of the passage length. */
export const EXPLAIN_MAX_TOKENS = 600;

const REWRITE_TOKEN_FACTOR: Partial<Record<AiRewriteVariant, number>> = {
  longer: 3,
  expand: 3,
  translate: 3,
  custom: 3,
  simpler: 1.8,
  formal: 1.8,
  casual: 1.8,
};

/** Output budget: room for "longer" to double the passage, never below a short paragraph. */
export function rewriteMaxTokens(selection: string, variant: AiRewriteVariant): number {
  if (variant === 'explain') {return EXPLAIN_MAX_TOKENS;}
  const approxTokens = Math.ceil(selection.length / 3.5);
  const factor = REWRITE_TOKEN_FACTOR[variant] ?? 1.6;
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
