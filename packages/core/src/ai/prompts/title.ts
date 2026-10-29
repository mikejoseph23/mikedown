/**
 * Title suggestions (`/title` and "Suggest titles…", the `title` feature).
 * Pure: the prompt asks for a small JSON object, `parseTitles` validates it.
 * The document is the budgeted prefix plus the full headings list, so a long
 * document is still judged as a whole.
 */

import { JSON_SHAPE_HINT, parseLenientJson } from '../json';
import type { AiMessage } from '../types';
import type { HeadingOutlineEntry } from '../documentBudget';

export const TITLE_MAX_CHARS = 120;
/** Longest headings list sent, so a huge outline cannot eat the budget. */
export const TITLE_OUTLINE_MAX_ITEMS = 60;

export interface TitlePromptInput {
  /** The document as markdown, already through `budgetDocument`. */
  document: string;
  /** All headings of the full document (not only the budgeted part). */
  outline: readonly HeadingOutlineEntry[];
  /** The current title, so the model does not hand it back. */
  existingTitle?: string;
  count?: number;
}

export const TITLE_SYSTEM_PROMPT = [
  'You are a writing assistant inside a Markdown editor. You suggest titles for the document the user gives you.',
  '',
  'Rules:',
  '- Each title is specific to this document, in plain wording, in Title Case or sentence case to match the document, under 80 characters, with no trailing period and no quotation marks.',
  '- Make the titles different from each other in angle (descriptive, benefit-led, short).',
  '- Write in the language of the document.',
  '- Reply with the JSON object only.',
].join('\n');

function fence(text: string, tag: string): string {
  return text.split(`</${tag}>`).join(`<\\/${tag}>`);
}

/** The headings as an indented list, capped. Shared by the title and properties prompts. */
export function renderHeadingOutline(outline: readonly HeadingOutlineEntry[], max = TITLE_OUTLINE_MAX_ITEMS): string {
  const shown = outline.slice(0, max).map((h) => `${'  '.repeat(Math.max(0, h.level - 1))}- ${h.text}`);
  if (outline.length > max) {shown.push(`(${outline.length - max} more headings)`);}
  return shown.join('\n');
}

export function buildTitleMessages(input: TitlePromptInput): AiMessage[] {
  const count = Math.max(1, Math.min(8, input.count ?? 3));
  const placeholders = Array.from({ length: count }, (_, i) => `title ${i + 1}`);
  const parts: string[] = [`Suggest ${count} titles for this document.`];
  const existing = (input.existingTitle ?? '').trim();
  if (existing) {parts.push(`The current title is "${existing.replace(/"/g, "'")}". Do not repeat it.`);}
  if (input.outline.length > 0) {
    parts.push(`Headings of the whole document:\n<headings>\n${fence(renderHeadingOutline(input.outline), 'headings')}\n</headings>`);
  }
  parts.push(`Document:\n<document>\n${fence(input.document, 'document')}\n</document>`);
  parts.push(JSON_SHAPE_HINT({ titles: placeholders }));
  return [
    { role: 'system', content: TITLE_SYSTEM_PROMPT },
    { role: 'user', content: parts.join('\n\n') },
  ];
}

/** Output budget: a few short strings. */
export function titleMaxTokens(count = 3): number {
  return 128 + 48 * Math.max(1, count);
}

function cleanTitle(value: string): string {
  let t = value.replace(/\s+/g, ' ').trim();
  t = t.replace(/^["“'‘]+|["”'’]+$/g, '').trim();
  t = t.replace(/^#{1,6}\s+/, '').replace(/[.。]+$/, '').trim();
  if (t.length > TITLE_MAX_CHARS) {t = t.slice(0, TITLE_MAX_CHARS).trimEnd();}
  return t;
}

const sameTitle = (a: string, b: string): boolean => a.toLowerCase() === b.toLowerCase();

export type ParsedTitles = { ok: true; titles: string[] } | { ok: false; error: string };

/**
 * The titles in a reply: `{ "titles": [...] }` (a bare array or a single
 * `title` string is accepted too), trimmed to 120 characters, de-duplicated
 * case-insensitively, minus the existing title. No usable title is a failure
 * so the caller can repair or report `badOutput`.
 */
export function parseTitles(raw: string, existingTitle?: string): ParsedTitles {
  const parsed = parseLenientJson(raw);
  if (!parsed.ok) {return { ok: false, error: parsed.error };}
  const v = parsed.value;
  let list: unknown;
  if (Array.isArray(v)) {list = v;}
  else if (v && typeof v === 'object') {
    const o = v as Record<string, unknown>;
    list = o.titles ?? (typeof o.title === 'string' ? [o.title] : undefined);
  }
  if (!Array.isArray(list)) {return { ok: false, error: 'The JSON has no "titles" array.' };}
  const existing = (existingTitle ?? '').trim();
  const titles: string[] = [];
  for (const item of list) {
    if (typeof item !== 'string') {continue;}
    const t = cleanTitle(item);
    if (!t || (existing && sameTitle(t, existing)) || titles.some((x) => sameTitle(x, t))) {continue;}
    titles.push(t);
  }
  if (titles.length === 0) {return { ok: false, error: 'The "titles" array has no usable title.' };}
  return { ok: true, titles };
}
