/**
 * Summary prompts (the `summary` feature: `/summary` and `/outline`). Pure:
 * builds the chat messages from the budgeted document and tidies the reply
 * before it is previewed and inserted.
 *
 * TL;DR is wrapped in a `[!NOTE]` callout whose first line is **Summary**
 * (D11: the GFM five are the only kinds that round-trip on GitHub). Outline
 * stays a plain nested list.
 */

import type { AiMessage } from '../types';
import { rewriteVisibleText } from './rewrite';

export type AiSummaryKind = 'tldr' | 'outline';

export interface SummaryPromptInput {
  /** The document as markdown, already through `budgetDocument`. */
  document: string;
  kind: AiSummaryKind;
  /** Share of the document included, 0 to 1 (below 1 means it was cut). */
  coverage: number;
}

/** A document shorter than this gets a one-paragraph TL;DR instead of bullets. */
export const SUMMARY_SHORT_DOCUMENT_CHARS = 1200;

const COMMON_RULES = [
  'Reply with Markdown only. No preamble, no closing remarks, no code fence around the answer and no title line.',
  'Use only what the document says. Do not invent facts, names or numbers.',
  'Write in the language of the document.',
];

export const SUMMARY_SYSTEM_PROMPT = [
  'You are a writing assistant inside a Markdown editor. You write a short TL;DR of the document the user gives you.',
  '',
  'Rules:',
  '- Write 3 to 6 bullet points, one line each, most important first. Each bullet is a list item starting with "- ".',
  '- Plain wording that someone who has not read the document can follow. No heading, no "Summary" label.',
  ...COMMON_RULES.map((r) => `- ${r}`),
].join('\n');

export const OUTLINE_SYSTEM_PROMPT = [
  'You are a writing assistant inside a Markdown editor. You write an outline of the document the user gives you.',
  '',
  'Rules:',
  '- Reply with a nested Markdown list: top-level items are the main sections, indented items (two spaces per level, "- " markers) are their subsections or key points. At most three levels.',
  '- If the document has headings, follow them in order and keep their wording. If it has none, propose short headings that fit its parts.',
  '- Each item is a few words, not a sentence. No heading syntax (#) and no numbering.',
  ...COMMON_RULES.map((r) => `- ${r}`),
].join('\n');

/** Neutralise a closing tag inside user text so it cannot end its block early. */
function fence(text: string, tag: string): string {
  return text.split(`</${tag}>`).join(`<\\/${tag}>`);
}

export function coveragePercent(coverage: number): number {
  return Math.max(1, Math.min(99, Math.round(coverage * 100)));
}

export function buildSummaryMessages(input: SummaryPromptInput): AiMessage[] {
  const parts: string[] = [];
  if (input.kind === 'tldr') {
    parts.push(input.document.length < SUMMARY_SHORT_DOCUMENT_CHARS
      ? 'This document is short: write one paragraph of two to four sentences instead of bullet points.'
      : 'Write the TL;DR as 3 to 6 bullet points.');
  } else {
    parts.push('Write the outline.');
  }
  if (input.coverage < 1) {
    parts.push(`Only the first ${coveragePercent(input.coverage)}% of the document is included below; it was cut to fit. Cover only what is shown and do not guess at the rest.`);
  }
  parts.push(`Document:\n<document>\n${fence(input.document, 'document')}\n</document>`);
  parts.push(input.kind === 'tldr' ? 'Reply with the TL;DR only.' : 'Reply with the outline list only.');
  return [
    { role: 'system', content: input.kind === 'tldr' ? SUMMARY_SYSTEM_PROMPT : OUTLINE_SYSTEM_PROMPT },
    { role: 'user', content: parts.join('\n\n') },
  ];
}

/** Output budget: scales with the input, within a range a small model handles. */
export function summaryMaxTokens(kind: AiSummaryKind, inputChars: number): number {
  const approxTokens = Math.ceil(inputChars / 3.5);
  return kind === 'tldr'
    ? Math.max(256, Math.min(700, Math.ceil(approxTokens * 0.2) + 128))
    : Math.max(384, Math.min(1200, Math.ceil(approxTokens * 0.3) + 160));
}

/** The text to show while it streams (reasoning hidden). */
export function summaryVisibleText(raw: string): string {
  return rewriteVisibleText(raw);
}

/** Drop a wrapping code fence and a "Here is the summary:" lead-in. */
function tidy(raw: string, kind: AiSummaryKind): string {
  let text = rewriteVisibleText(raw).trim();
  const fenced = /^```(?:markdown|md|text)?[ \t]*\n([\s\S]*?)\n```$/i.exec(text);
  if (fenced) {text = fenced[1].trim();}
  const lines = text.split('\n');
  if (lines.length > 1 && /^(here('s| is| are)|sure|certainly|of course)\b[^\n]*:\s*$/i.test(lines[0].trim())) {
    lines.shift();
    while (lines.length > 0 && lines[0].trim() === '') {lines.shift();}
  }
  // The callout supplies its own label.
  if (kind === 'tldr' && lines.length > 1 && /^(?:#{1,6}\s*)?(?:\*\*|__)?\s*(?:summary|tl;?dr)\s*:?\s*(?:\*\*|__)?\s*:?\s*$/i.test(lines[0].trim())) {
    lines.shift();
  }
  return lines.join('\n').trim();
}

/**
 * The markdown to insert. TL;DR becomes a `[!NOTE]` callout headed
 * **Summary**; Outline stays the list. When the document was cut
 * (`coverage` below 1) a "Covers the first N% of the document." line closes
 * it. An empty reply stays empty so the caller can report a bad output.
 */
export function finalizeSummary(raw: string, kind: AiSummaryKind, coverage = 1): string {
  const body = tidy(raw, kind);
  if (!body) {return '';}
  const note = coverage < 1 ? `Covers the first ${coveragePercent(coverage)}% of the document.` : '';
  if (kind === 'outline') {
    return note ? `${body}\n\n${note}` : body;
  }
  const inner = ['**Summary**', '', body, ...(note ? ['', note] : [])].join('\n');
  return ['[!NOTE]', inner].join('\n').split('\n').map((l) => (l ? `> ${l}` : '>')).join('\n');
}
