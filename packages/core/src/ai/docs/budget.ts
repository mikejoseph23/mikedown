/**
 * The answer call's source budget: keep whole sections in the order asked
 * until the share of the route's context is used, then number what was kept
 * and write the coverage note. Pure. Built on `documentBudget.ts`
 * (`CHARS_PER_TOKEN`).
 *
 * Rules.
 *   - Sections are deduplicated by id (first stays) and taken in the order
 *     given: the loop puts the most relevant first.
 *   - The budget is `floor(contextTokens x sourceShare / 100 x
 *     CHARS_PER_TOKEN)` characters. A section that fits the room left is kept;
 *     one that does not is left out and the next is tried, so a huge section
 *     cannot starve smaller ones.
 *   - If nothing fits whole, the first section is kept cut to the budget (on a
 *     code point boundary, `truncated` set), so an answer always has something.
 *   - NUMBERING HAPPENS AFTER THE CUT: `n` runs 1..k over the sections that
 *     are actually sent, in the order kept. A model never sees a gap.
 *   - Callers scan for secrets first (`scanDocsSections`) and pass how many
 *     sections that left out, so the note can say so.
 */

import { CHARS_PER_TOKEN } from '../documentBudget';
import type { AiDocsSection } from '../types';
import { clampDocsSourceShare } from './caps';
import { secretsLeftOutPhrase } from './secrets';
import { plural } from './util';

export interface DocsBudgetOptions {
  /** The route's context window, in tokens. */
  contextTokens: number;
  /** Percent of it the sections may take. Clamped 30 to 80 (default 60). */
  sourceShare?: number;
  /** Sections the secrets scan already left out. */
  secretsLeftOut?: number;
}

export interface AiDocsNumberedSection {
  /** 1-based, contiguous over what is sent. */
  n: number;
  section: AiDocsSection;
}

export interface DocsBudgetResult {
  /** What goes to the model, numbered. */
  sent: AiDocsNumberedSection[];
  /** Ids left out because they did not fit. */
  cutIds: string[];
  /** Sections asked for, after dedupe and without the secret ones. */
  requested: number;
  /** Sections sent that the host or the budget cut short. */
  cutShort: number;
  /** Characters the budget allowed. */
  budgetChars: number;
  /** "answered from 4 of 7 sections, 3 left out", or null when no section was sent or asked for. */
  note: string | null;
}

/** Characters of source text a route allows. */
export function docsBudgetChars(contextTokens: number, sourceShare?: number): number {
  const share = clampDocsSourceShare(sourceShare);
  const tokens = Number.isFinite(contextTokens) ? Math.max(0, contextTokens) : 0;
  return Math.floor((tokens * share * CHARS_PER_TOKEN) / 100);
}

/** The coverage note (without the secrets part when `secretsLeftOut` is 0). */
export function docsCoverageNote(total: number, used: number, cutShort: number, secretsLeftOut: number): string | null {
  if (total <= 0 && secretsLeftOut <= 0) {return null;}
  const parts: string[] = [];
  if (total > 0) {
    let head = used >= total ? `answered from ${plural(used, 'section', 'sections')}` : `answered from ${used} of ${plural(total, 'section', 'sections')}, ${total - used} left out`;
    if (cutShort > 0) {head += `; ${plural(cutShort, 'section', 'sections')} cut short`;}
    parts.push(head);
  } else {
    parts.push('answered without sources');
  }
  if (secretsLeftOut > 0) {parts.push(secretsLeftOutPhrase(secretsLeftOut));}
  return parts.join('; ');
}

export function budgetDocsSections(sections: readonly AiDocsSection[], opts: DocsBudgetOptions): DocsBudgetResult {
  const budgetChars = docsBudgetChars(opts.contextTokens, opts.sourceShare);
  const seen = new Set<string>();
  const unique: AiDocsSection[] = [];
  for (const s of sections) {
    if (seen.has(s.id)) {continue;}
    seen.add(s.id);
    unique.push(s);
  }
  let room = budgetChars;
  const kept: AiDocsSection[] = [];
  const cutIds: string[] = [];
  for (const s of unique) {
    if (s.text.length <= room) {
      kept.push(s);
      room -= s.text.length;
    } else {
      cutIds.push(s.id);
    }
  }
  if (kept.length === 0 && unique.length > 0 && budgetChars > 0) {
    const first = unique[0];
    let text = first.text.slice(0, budgetChars);
    // Never end in half a surrogate pair.
    const last = text.charCodeAt(text.length - 1);
    if (last >= 0xd800 && last <= 0xdbff) {text = text.slice(0, -1);}
    kept.push({ ...first, text, truncated: true });
    cutIds.splice(cutIds.indexOf(first.id), 1);
  }
  const sent = kept.map((section, i) => ({ n: i + 1, section }));
  const cutShort = kept.filter((s) => s.truncated).length;
  const secretsLeftOut = Math.max(0, opts.secretsLeftOut ?? 0);
  return {
    sent,
    cutIds,
    requested: unique.length,
    cutShort,
    budgetChars,
    note: docsCoverageNote(unique.length, kept.length, cutShort, secretsLeftOut),
  };
}
