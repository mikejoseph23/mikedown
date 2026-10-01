/**
 * Automatic heading numbering (`mikedown.headingNumbering`).
 *
 * Display-only: the numbers are CSS counters rendered in `::before`, so the
 * markdown source, heading text, and `#anchor` slugs are never touched. The
 * same generated CSS drives the editor (scoped to `.ProseMirror`) and the
 * HTML/PDF export (scoped to `body`), which keeps the two in step.
 *
 * Shared by the extension host and the webview bundle — keep it free of
 * `vscode` and DOM imports.
 */

export type HeadingNumbering = 'off' | 'fromH1' | 'fromH2';

/**
 * Off while the design is settled with the requester of issue #6 (display-only
 * counters vs. writing the numbers into the markdown). While false the setting
 * is ignored and hidden from the Settings modal. To ship it, flip this and
 * restore the `mikedown.headingNumbering` schema entry in package.json plus
 * the README settings row and changelog note (all in commit 3e0f819).
 */
export const HEADING_NUMBERING_AVAILABLE = false;

export function parseHeadingNumbering(value: unknown): HeadingNumbering {
  return value === 'fromH1' || value === 'fromH2' ? value : 'off';
}

const counterName = (level: number): string => `mikedown-h${level}`;

/**
 * Build the counter CSS for `mode`, numbering headings that are direct
 * children of `scope`. Headings nested in blockquotes, callouts, or list
 * items are quoted content rather than document sections, so they are left
 * unnumbered (the outline sidebar ignores them for the same reason).
 *
 * `fromH2` treats H1 as the document title: it gets no number, H2 becomes
 * "1", H3 "1.1", and so on. Returns an empty string when numbering is off.
 */
export function headingNumberingCss(mode: HeadingNumbering, scope: string): string {
  if (mode === 'off') {return '';}
  const first = mode === 'fromH2' ? 2 : 1;
  const levels: number[] = [];
  for (let level = first; level <= 6; level++) {levels.push(level);}

  // Only the top counter is created on the scope. The deeper ones must come
  // solely from the sibling resets below: a scope-level instance of the same
  // name stops later sibling resets from taking effect in Chromium, so
  // numbering would run on ("1.2.3" where "1.2.1" belongs).
  const rules = [`${scope} { counter-reset: ${counterName(first)}; }`];
  for (const level of levels) {
    // Reset every deeper counter, not just the next one, so a skipped level
    // (H1 straight to H3) can't inherit a stale count from an earlier section.
    const deeper = levels.filter(l => l > level).map(counterName).join(' ');
    const reset = deeper ? ` counter-reset: ${deeper};` : '';
    rules.push(`${scope} > h${level} { counter-increment: ${counterName(level)};${reset} }`);
    const number = levels
      .filter(l => l <= level)
      .map(l => `counter(${counterName(l)})`)
      .join(' "." ');
    rules.push(`${scope} > h${level}::before { content: ${number}; margin-right: 0.5em; }`);
  }
  return rules.join('\n');
}
