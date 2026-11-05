/**
 * Every cap and clamp of the documentation-base feature, in one place (S9).
 * Hosts and the loop import these; nothing else hardcodes a number. The hop
 * and share limits are M1's (`AI_DOCS_*` in `../types`), re-exported here so a
 * caller needs one import.
 */

import {
  AI_DOCS_MAX_HOPS_DEFAULT,
  AI_DOCS_MAX_HOPS_MAX,
  AI_DOCS_MAX_HOPS_MIN,
  AI_DOCS_SOURCE_SHARE_DEFAULT,
  AI_DOCS_SOURCE_SHARE_MAX,
  AI_DOCS_SOURCE_SHARE_MIN,
} from '../types';
import { cutUtf8, utf8Length } from './util';

/** Markdown files indexed per base (decision 13). The walk stops at this many. */
export const DOCS_MAX_FILES = 5000;
/** Bytes per file; a bigger file is skipped and counted in health. */
export const DOCS_MAX_FILE_BYTES = 1024 * 1024;
/** Bytes per section sent to a model (the host cuts at this and sets `truncated`). */
export const DOCS_MAX_SECTION_BYTES = 24 * 1024;
/** Links in one hop-1 list. */
export const DOCS_MAX_LINKS = 200;
/** Pages in the in-memory map used when a root has no home document. */
export const DOCS_MAX_MAP_ENTRIES = 400;
/** Sections the keyword fallback returns. */
export const DOCS_KEYWORD_TOP = 20;
/** Terms the keyword fallback uses from one query. */
export const DOCS_KEYWORD_MAX_TERMS = 12;
/** Headings and links kept per page in the index (defence against one huge file). */
export const DOCS_MAX_HEADINGS_PER_PAGE = 1000;
export const DOCS_MAX_LINKS_PER_PAGE = 1000;
/** Folders read per base while walking; the walk stops at this many and says so in health (S9). */
export const DOCS_MAX_DIRS = 20_000;
/** Heading text is cut to this many code points in the index and in sections (same rule on both hosts). */
export const DOCS_MAX_HEADING_CHARS = 200;
/** A link target is cut to this many code points in the index. */
export const DOCS_MAX_LINK_TARGET_CHARS = 500;
/**
 * How far (UTF-16 units) the link scanner looks for the end of a `<...>`
 * destination or a quoted title. A link whose destination or title does not
 * end within it is not a link. Link text is bounded by the same 300 as before.
 */
export const DOCS_LINK_SCAN_UNITS = 1000;
/** Link text between the brackets, in UTF-16 units (longer is not a link). */
export const DOCS_LINK_TEXT_UNITS = 300;
/** Milliseconds one base's walk and index may take; past it the build ends and health says so (S9). */
export const DOCS_BUILD_BUDGET_MS = 30_000;
/** Candidate pages looked at while counting broken wikilinks, per base; past it the count stops (a lower bound). */
export const DOCS_MAX_LINK_WORK = 5_000_000;
/** Ids taken from one navigation reply; the rest are dropped and counted. Model output is hostile. */
export const DOCS_MAX_READ_IDS_PER_HOP = 20;
/** Characters of index text in one navigation prompt, whatever the route's context (several roots of 400 map entries add up). */
export const DOCS_MAX_NAV_CHARS = 96_000;
/** Longest id the loop looks up; anything longer is dropped unread. */
export const DOCS_MAX_ID_CHARS = 2048;
/** Ids an Activity entry lists per field, each clipped; the count stays exact. */
export const DOCS_MAX_ACTIVITY_IDS = 100;
export const DOCS_MAX_ACTIVITY_ID_CHARS = 200;

export { AI_DOCS_MAX_HOPS_DEFAULT, AI_DOCS_MAX_HOPS_MAX, AI_DOCS_MAX_HOPS_MIN, AI_DOCS_SOURCE_SHARE_DEFAULT, AI_DOCS_SOURCE_SHARE_MAX, AI_DOCS_SOURCE_SHARE_MIN };

function clampInt(value: unknown, min: number, max: number, fallback: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {return fallback;}
  return Math.min(max, Math.max(min, Math.round(value)));
}

/** Navigation calls before the answer, 1 to 5; anything not a number is the default (3). */
export function clampDocsHops(value: unknown): number {
  return clampInt(value, AI_DOCS_MAX_HOPS_MIN, AI_DOCS_MAX_HOPS_MAX, AI_DOCS_MAX_HOPS_DEFAULT);
}

/** Percent of the route's context the answer's sections may take, 30 to 80; default 60. */
export function clampDocsSourceShare(value: unknown): number {
  return clampInt(value, AI_DOCS_SOURCE_SHARE_MIN, AI_DOCS_SOURCE_SHARE_MAX, AI_DOCS_SOURCE_SHARE_DEFAULT);
}

/**
 * Cut a section's text to `DOCS_MAX_SECTION_BYTES` UTF-8 bytes on a code point
 * boundary. Scan (`secrets.ts`) the uncapped text first when you can, so a key
 * is never cut in half and slips through.
 */
export function capSectionText(text: string, maxBytes: number = DOCS_MAX_SECTION_BYTES): { text: string; truncated: boolean } {
  if (utf8Length(text) <= maxBytes) {return { text, truncated: false };}
  return { text: cutUtf8(text, maxBytes), truncated: true };
}
