/**
 * Split a markdown file into the sections the index names. Pure.
 *
 * THE SECTION CONTRACT (hosts port this for `readSections` and the keyword
 * scan; `test/ai-fixtures/docs/sections.json` holds the cases).
 *   - Headings are the ones `headingsOutline` reports: ATX (`#` to `######`,
 *     up to three spaces of indent), outside frontmatter and fenced code,
 *     with non-empty text.
 *   - A heading's section runs from its line to the line before the NEXT
 *     heading of any level (sections do not overlap, so a budget never counts
 *     text twice). The last one runs to the end of the file.
 *   - Text before the first heading is the preamble, section 0, with no
 *     heading. It includes the frontmatter. It exists only when there is
 *     non-whitespace text between the frontmatter and the first heading (or
 *     the file has no heading at all and is not blank). A file that opens
 *     with a heading has no preamble, and its frontmatter belongs to no
 *     section (it is still in a whole-page read).
 *   - A section's id is `<page id>#<slug>` (slugs: `docsSlugs`); the preamble
 *     and a whole-page read are the bare page id.
 */

import { frontmatterEndOffset, headingsWithOffsets } from '../documentBudget';
import { docsSlugs } from './index';

export interface DocsMarkdownSection {
  /** Position in the file; the preamble, when there is one, is 0. */
  index: number;
  /** Null for the preamble. */
  heading: { level: number; text: string; slug: string } | null;
  /** Offset of the section's first character, and one past its last. */
  start: number;
  end: number;
  /** The section's markdown (`slice(start, end)`). */
  text: string;
}

export function splitDocsSections(markdown: string): DocsMarkdownSection[] {
  const headings = headingsWithOffsets(markdown);
  const slugs = docsSlugs(headings.map((h) => h.text));
  const out: DocsMarkdownSection[] = [];
  const firstStart = headings.length > 0 ? headings[0].start : markdown.length;
  const preambleBody = markdown.slice(frontmatterEndOffset(markdown), firstStart);
  if (preambleBody.trim() !== '') {
    out.push({ index: 0, heading: null, start: 0, end: firstStart, text: markdown.slice(0, firstStart) });
  }
  headings.forEach((h, i) => {
    const end = i + 1 < headings.length ? headings[i + 1].start : markdown.length;
    out.push({
      index: out.length,
      heading: { level: h.level, text: h.text, slug: slugs[i] },
      start: h.start,
      end,
      text: markdown.slice(h.start, end),
    });
  });
  return out;
}
