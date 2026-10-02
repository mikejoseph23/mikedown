/**
 * Automatic heading numbering (`mikedown.headingNumbering`).
 *
 * The numbers are real text at the start of each heading (`## 1.2 Setup`),
 * so they show in every markdown renderer. The setting only picks the scheme
 * and reveals the toolbar toggle; whether a document is numbered is read
 * from the document itself (see `isNumbered`), so there is no hidden state.
 *
 * Pure logic: no `vscode`, DOM, or ProseMirror imports. The webview feeds it
 * the top-level headings and applies the returned edits in a transaction.
 */

export type HeadingNumbering = 'off' | 'fromH1' | 'fromH2';

export function parseHeadingNumbering(value: unknown): HeadingNumbering {
  return value === 'fromH1' || value === 'fromH2' ? value : 'off';
}

/** A leading section number: `1`, `1.2`, `1.2.3`, with an optional trailing dot. */
const NUMBER_PREFIX = /^(\d+(?:\.\d+)*)\.?[ \t]+/;

/** The leading section-number prefix of `text` (including its spaces), or ''. */
export function numberPrefix(text: string): string {
  return NUMBER_PREFIX.exec(text)?.[0] ?? '';
}

export interface HeadingInfo {
  level: number;
  text: string;
}

const firstLevel = (mode: HeadingNumbering): number => (mode === 'fromH2' ? 2 : 1);

/** Whether `h` takes part in numbering: in scheme range and not empty. */
function isNumberable(h: HeadingInfo, first: number): boolean {
  return h.level >= first && h.text.trim() !== '';
}

/**
 * Section number for each heading (`"1"`, `"1.2"`), or null for headings that
 * aren't numbered (above the scheme's first level, or empty). A skipped level
 * counts as 0, so an H3 straight under the first H1 is `1.0.1`.
 */
export function sectionNumbers(headings: HeadingInfo[], mode: HeadingNumbering): (string | null)[] {
  if (mode === 'off') {return headings.map(() => null);}
  const first = firstLevel(mode);
  // Start at the shallowest level in use, so a document without an H1 gets
  // 1, 2, 3 rather than 0.1, 0.2, 0.3.
  const levels = headings.filter((h) => isNumberable(h, first)).map((h) => h.level);
  const top = levels.length ? Math.min(...levels) : first;
  const counters = [0, 0, 0, 0, 0, 0, 0];
  return headings.map((h) => {
    if (!isNumberable(h, first)) {return null;}
    counters[h.level]++;
    for (let l = h.level + 1; l <= 6; l++) {counters[l] = 0;}
    return counters.slice(top, h.level + 1).join('.');
  });
}

/**
 * Whether the document is already numbered: at least half of the numberable
 * headings carry a plausible section number. Plausible means the right depth
 * for the heading's level and no part larger than the heading count, so a
 * stale number (after a section moves or a new one is added) still counts,
 * but `## 2024 Review` does not switch a plain document into numbered mode.
 */
export function isNumbered(headings: HeadingInfo[], mode: HeadingNumbering): boolean {
  if (mode === 'off') {return false;}
  const numbers = sectionNumbers(headings, mode);
  const count = numbers.filter((n) => n !== null).length;
  let prefixed = 0;
  headings.forEach((h, i) => {
    const expected = numbers[i];
    const prefix = numberPrefix(h.text);
    if (expected === null || !prefix) {return;}
    const parts = prefix.trim().replace(/\.$/, '').split('.').map(Number);
    if (parts.length === expected.split('.').length && parts.every((n) => n <= count)) {prefixed++;}
  });
  return prefixed > 0 && prefixed * 2 >= count;
}

export interface PrefixEdit {
  /** Index into the headings array. */
  index: number;
  /** The prefix currently at the start of the heading text ('' if none). */
  oldPrefix: string;
  /** The prefix to put there instead ('' to remove it). */
  newPrefix: string;
}

/**
 * Edits that bring every numberable heading's prefix to its section number
 * (`"1.2 "`). Headings whose prefix is already right are left out. `skip`
 * names an index to leave alone (the heading the cursor is in).
 *
 * `fresh` is for numbering a document that isn't numbered yet, where a
 * leading number may be part of the title (`## 2024 Review`). A dotted
 * prefix (`1.2`, `3.`) is still taken as a hand-typed section number, but a
 * bare integer only counts when it is no larger than the heading count.
 */
export function renumberEdits(
  headings: HeadingInfo[],
  mode: HeadingNumbering,
  skip = -1,
  fresh = false,
): PrefixEdit[] {
  const numbers = sectionNumbers(headings, mode);
  const count = numbers.filter((n) => n !== null).length;
  const edits: PrefixEdit[] = [];
  headings.forEach((h, index) => {
    const number = numbers[index];
    if (number === null || index === skip) {return;}
    let oldPrefix = numberPrefix(h.text);
    if (fresh && /^\d+[ \t]/.test(oldPrefix) && parseInt(oldPrefix, 10) > count) {oldPrefix = '';}
    const newPrefix = `${number} `;
    if (oldPrefix !== newPrefix) {edits.push({ index, oldPrefix, newPrefix });}
  });
  return edits;
}

/** Edits that remove the number prefix from every numberable heading. */
export function stripEdits(headings: HeadingInfo[], mode: HeadingNumbering): PrefixEdit[] {
  const first = firstLevel(mode);
  const edits: PrefixEdit[] = [];
  headings.forEach((h, index) => {
    const oldPrefix = numberPrefix(h.text);
    if (oldPrefix && isNumberable(h, first)) {edits.push({ index, oldPrefix, newPrefix: '' });}
  });
  return edits;
}

/** `text` with `edit` applied. */
export function applyPrefixEdit(text: string, edit: PrefixEdit): string {
  return edit.newPrefix + text.slice(edit.oldPrefix.length);
}
