/**
 * Properties suggestions (the `frontmatter` feature: "Suggest" in the
 * sidebar's Properties header). Pure: the prompt asks for a title, a
 * description and tags as JSON; `parsePropertySuggestions` validates the
 * reply and normalises tags through the shared tag syntax, so what reaches the
 * UI is already safe to apply.
 */

import type { ParsedEntry } from '../../shared/frontmatterYaml';
import { normalizeTag } from '../../shared/tagSyntax';
import { JSON_SHAPE_HINT, parseLenientJson } from '../json';
import type { HeadingOutlineEntry } from '../documentBudget';
import type { AiMessage } from '../types';
import { renderHeadingOutline } from './title';

/** A frontmatter property as the sidebar holds it. */
export type AiFrontmatterEntry = ParsedEntry;

export const PROPERTY_MAX_TAGS = 8;
export const PROPERTY_DESCRIPTION_MAX_CHARS = 200;
export const PROPERTY_TITLE_MAX_CHARS = 120;
/** Vocabulary tags listed in the prompt at most. */
export const PROPERTY_VOCABULARY_MAX = 80;

export interface PropertiesPromptInput {
  /** The document as markdown, already through `budgetDocument`. */
  document: string;
  /** All headings of the full document. */
  outline: readonly HeadingOutlineEntry[];
  /** The properties the document already has. */
  existing: readonly AiFrontmatterEntry[];
  /** Tags used elsewhere in the workspace, most used first. */
  vocabulary: readonly string[];
}

export const PROPERTIES_SYSTEM_PROMPT = [
  'You are a writing assistant inside a Markdown editor. You suggest frontmatter properties for the document the user gives you: a title, a description and tags.',
  '',
  'Rules:',
  '- title: specific to the document, under 80 characters, no trailing period and no quotation marks.',
  '- description: one or two plain sentences under 160 characters that say what the document is about. No marketing wording.',
  '- tags: 3 to 6 short topic tags, lowercase, words joined by hyphens, no "#" and no spaces. Nested tags use a slash, like project/active.',
  '- Prefer tags from the list of existing tags when they fit. Add a new tag only when none of them does.',
  '- Do not repeat a tag the document already has.',
  '- Write in the language of the document.',
  '- Reply with the JSON object only.',
].join('\n');

function fence(text: string, tag: string): string {
  return text.split(`</${tag}>`).join(`<\\/${tag}>`);
}

function entryValue(value: string | string[]): string {
  return Array.isArray(value) ? value.join(', ') : value;
}

/** The tags the entries already carry, normalised (`tags:` or `tag:`, array or comma list). */
export function existingTagsOf(existing: readonly AiFrontmatterEntry[]): string[] {
  const out: string[] = [];
  for (const entry of existing) {
    if (!/^tags?$/i.test(entry.key)) {continue;}
    const parts = Array.isArray(entry.value) ? entry.value : entry.value.split(/[,\s]+/);
    for (const p of parts) {
      const t = normalizeTag(p);
      if (t && !out.includes(t)) {out.push(t);}
    }
  }
  return out;
}

export function buildPropertiesMessages(input: PropertiesPromptInput): AiMessage[] {
  const parts: string[] = ['Suggest a title, a description and tags for this document.'];
  const props = input.existing.filter((e) => entryValue(e.value).trim() !== '');
  if (props.length > 0) {
    parts.push(`Properties it already has:\n<properties>\n${fence(props.map((e) => `${e.key}: ${entryValue(e.value)}`).join('\n'), 'properties')}\n</properties>`);
  }
  const vocabulary = input.vocabulary.slice(0, PROPERTY_VOCABULARY_MAX);
  if (vocabulary.length > 0) {
    parts.push(`Prefer these existing tags when they fit:\n<tags>\n${fence(vocabulary.join(', '), 'tags')}\n</tags>`);
  }
  if (input.outline.length > 0) {
    parts.push(`Headings of the whole document:\n<headings>\n${fence(renderHeadingOutline(input.outline), 'headings')}\n</headings>`);
  }
  parts.push(`Document:\n<document>\n${fence(input.document, 'document')}\n</document>`);
  parts.push(JSON_SHAPE_HINT({ title: 'the title', description: 'one or two sentences', tags: ['tag-one', 'tag-two', 'tag-three'] }));
  return [
    { role: 'system', content: PROPERTIES_SYSTEM_PROMPT },
    { role: 'user', content: parts.join('\n\n') },
  ];
}

/** Output budget: three short fields. */
export function propertiesMaxTokens(): number {
  return 384;
}

export interface SuggestedTag {
  /** Normalised: lowercase, no `#`. */
  tag: string;
  /** Already used somewhere in the workspace (it is in the vocabulary). */
  known: boolean;
}

export interface PropertySuggestions {
  title?: string;
  description?: string;
  tags: SuggestedTag[];
}

export type ParsedPropertySuggestions = { ok: true; suggestions: PropertySuggestions } | { ok: false; error: string };

/** A model's tag as a valid one: spaces to hyphens, stray punctuation dropped, `#` removed. */
function cleanTag(raw: string): string | null {
  const t = normalizeTag(raw.trim().replace(/\s+/g, '-').replace(/[^A-Za-z0-9_/#-]/g, ''));
  if (!t) {return null;}
  const segments = t.split('/').map((s) => s.replace(/^-+|-+$/g, '')).filter(Boolean);
  const joined = segments.join('/');
  return /[a-z]/.test(joined) ? joined : null;
}

function oneLine(value: unknown, max: number): string {
  if (typeof value !== 'string') {return '';}
  const t = value.replace(/\s+/g, ' ').trim().replace(/^["“]+|["”]+$/g, '').trim();
  return t.length > max ? t.slice(0, max).trimEnd() : t;
}

function firstScalar(existing: readonly AiFrontmatterEntry[], key: string): string {
  const entry = existing.find((e) => e.key.toLowerCase() === key);
  return entry ? entryValue(entry.value).trim() : '';
}

/**
 * Validate a reply: title and description trimmed to length and dropped when
 * empty or equal to what the document has, tags normalised, marked `known`
 * from the vocabulary, minus tags already present, de-duplicated and capped at
 * 8. A reply with no title, description or tag at all is a failure; one whose
 * suggestions are all already present succeeds with nothing left in it.
 */
export function parsePropertySuggestions(
  raw: string,
  existing: readonly AiFrontmatterEntry[],
  vocabulary: readonly string[],
): ParsedPropertySuggestions {
  const parsed = parseLenientJson(raw);
  if (!parsed.ok) {return { ok: false, error: parsed.error };}
  const v = parsed.value;
  if (!v || typeof v !== 'object' || Array.isArray(v)) {return { ok: false, error: 'The JSON is not an object.' };}
  const o = v as Record<string, unknown>;

  const suggestions: PropertySuggestions = { tags: [] };
  const title = oneLine(o.title, PROPERTY_TITLE_MAX_CHARS).replace(/[.。]+$/, '');
  if (title && title.toLowerCase() !== firstScalar(existing, 'title').toLowerCase()) {suggestions.title = title;}
  const description = oneLine(o.description, PROPERTY_DESCRIPTION_MAX_CHARS);
  if (description && description.toLowerCase() !== firstScalar(existing, 'description').toLowerCase()) {suggestions.description = description;}

  const rawTags: unknown[] = Array.isArray(o.tags) ? o.tags : typeof o.tags === 'string' ? o.tags.split(/[,\n]+/) : [];
  const present = new Set(existingTagsOf(existing));
  const known = new Set<string>();
  for (const t of vocabulary) {
    const n = normalizeTag(t);
    if (n) {known.add(n);}
  }
  const seen = new Set<string>();
  for (const item of rawTags) {
    if (typeof item !== 'string') {continue;}
    const tag = cleanTag(item);
    if (!tag || present.has(tag) || seen.has(tag)) {continue;}
    seen.add(tag);
    suggestions.tags.push({ tag, known: known.has(tag) });
    if (suggestions.tags.length >= PROPERTY_MAX_TAGS) {break;}
  }

  // Everything filtered out as already present is a valid "nothing new"; no content at all is a bad reply.
  const hadContent = oneLine(o.title, 1) !== '' || oneLine(o.description, 1) !== '' || rawTags.some((t) => typeof t === 'string' && cleanTag(t));
  if (!hadContent) {return { ok: false, error: 'The JSON has no usable title, description or tags.' };}
  return { ok: true, suggestions };
}
