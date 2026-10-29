/**
 * Remembered rewrite picker choices (D10): the recent translate languages and
 * the last reading level. `localStorage` behind try/catch, like the emoji
 * picker's recents; storage may be missing or throw in a webview sandbox, so
 * every read has a default and every write is best effort. Never a
 * `mikedown.*` setting (D3).
 *
 * The popover's thinking level is remembered per engine kind for the
 * session only (in memory, never `localStorage`): the model's configured
 * level is the lasting choice, made in Settings.
 */

import { getAiAudience, type AiAudience } from './ai/prompts/rewrite';
import type { AiThinkingLevel } from './ai/thinking';

const LANGUAGES_KEY = 'mikedown.ai.recentLanguages';
const AUDIENCE_KEY = 'mikedown.ai.audience';

/** Recent languages shown above the fixed list. */
export const MAX_RECENT_LANGUAGES = 3;

/** Longest language name kept (it is free text from "Other…"). */
const LANGUAGE_MAX_CHARS = 60;

/** The fixed translate list, in menu order (D17). */
export const AI_TRANSLATE_LANGUAGES: readonly string[] = [
  'English', 'Spanish', 'French', 'German', 'Portuguese', 'Italian',
  'Dutch', 'Japanese', 'Chinese (Simplified)', 'Korean', 'Arabic', 'Hindi',
];

const sameLanguage = (a: string, b: string): boolean => a.toLocaleLowerCase() === b.toLocaleLowerCase();

/** A typed language name, trimmed to one line; empty when there is nothing to keep. */
function cleanLanguage(language: string): string {
  return language.replace(/\s+/g, ' ').trim().slice(0, LANGUAGE_MAX_CHARS);
}

/** The recent languages, newest first, at most `MAX_RECENT_LANGUAGES`. */
export function loadRecentLanguages(): string[] {
  try {
    const raw = localStorage.getItem(LANGUAGES_KEY);
    if (!raw) {return [];}
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) {return [];}
    const out: string[] = [];
    for (const item of parsed) {
      if (typeof item !== 'string') {continue;}
      const lang = cleanLanguage(item);
      if (lang && !out.some((l) => sameLanguage(l, lang))) {out.push(lang);}
      if (out.length >= MAX_RECENT_LANGUAGES) {break;}
    }
    return out;
  } catch {
    return [];
  }
}

/** Put a language at the top of the recents, stored as typed. */
export function rememberLanguage(language: string): void {
  const lang = cleanLanguage(language);
  if (!lang) {return;}
  try {
    const next = [lang, ...loadRecentLanguages().filter((l) => !sameLanguage(l, lang))].slice(0, MAX_RECENT_LANGUAGES);
    localStorage.setItem(LANGUAGES_KEY, JSON.stringify(next));
  } catch {
    // Storage refused (sandboxed webview, private mode): the choice is not remembered.
  }
}

/** The language picker's rows: recents first, then the fixed list without them. */
export function translateLanguageChoices(recents: string[] = loadRecentLanguages()): { recents: string[]; languages: string[] } {
  return {
    recents,
    languages: AI_TRANSLATE_LANGUAGES.filter((l) => !recents.some((r) => sameLanguage(r, l))),
  };
}

/** The last reading level chosen, or null. */
export function loadAudience(): AiAudience | null {
  try {
    const raw = localStorage.getItem(AUDIENCE_KEY);
    return raw && getAiAudience(raw) ? (raw as AiAudience) : null;
  } catch {
    return null;
  }
}

export function rememberAudience(audience: AiAudience): void {
  if (!getAiAudience(audience)) {return;}
  try {
    localStorage.setItem(AUDIENCE_KEY, audience);
  } catch {
    // Storage refused: the choice is not remembered.
  }
}

const sessionThinking = new Map<string, AiThinkingLevel>();

/** The thinking level last picked in the popover for this engine kind this session, or null. */
export function sessionThinkingLevel(kind: string): AiThinkingLevel | null {
  return sessionThinking.get(kind) ?? null;
}

export function rememberSessionThinking(kind: string, level: AiThinkingLevel): void {
  sessionThinking.set(kind, level);
}

/** Forget every session thinking level (tests; a fresh page starts empty anyway). */
export function clearSessionThinking(): void {
  sessionThinking.clear();
}
