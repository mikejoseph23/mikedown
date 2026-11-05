/**
 * Secrets scan (S7, A6): strict patterns, run on every string that leaves the
 * machine for a model, on every engine. A matching section or entry is left
 * out and counted in the coverage note. No lookbehind (older WebKit rejects
 * the whole module). Pure, linear-time (each pattern is
 * anchored on a literal prefix and uses bounded or possessive-by-construction
 * runs; `test/…` runs 1 MiB adversarial inputs).
 *
 * Patterns (a match anywhere in the text):
 *   - aws-access-key: `AKIA` or `ASIA` + 16 of `[0-9A-Z]`, not inside a longer
 *     alphanumeric run.
 *   - api-token: `sk-` (optionally `sk-ant-`, `sk-proj-` ...) followed by a run
 *     of at least 20 of `[A-Za-z0-9_-]` that contains a digit, and only where
 *     `sk-` does not continue a word, so `task-based`, `risk-free` and
 *     `desk-mounted` never match; or Stripe style `sk_live_` / `sk_test_` /
 *     `rk_live_` / `rk_test_` + 16 or more alphanumerics.
 *   - private-key: any `-----BEGIN ... PRIVATE KEY-----` header (RSA, EC,
 *     DSA, OPENSSH, ENCRYPTED, bare, `PGP PRIVATE KEY BLOCK`). The header is
 *     enough; the body need not be present. Whitespace between the words of
 *     the header may include a line break (a header re-wrapped by a tool).
 *   - jwt: `eyJ...` `.` `eyJ...` `.` signature (each part base64url; header
 *     and payload at least 8 characters after `eyJ`; the signature may be
 *     empty, for unsecured tokens).
 *
 * A section the host cut at the byte cap (`truncated`) may have lost the end
 * of a key. Hosts scan the uncapped text when they can (`capSectionText`
 * says so); for what arrives already cut, `scanDocsSections` also applies the
 * tail rule (`findSecretAtCutoff`): a key that starts in the last stretch of
 * the text and runs to its end counts.
 */

import type { AiDocsSection } from '../types';
import { splitDocsSections } from './sections';
import { plural } from './util';

export type DocsSecretKind = 'aws-access-key' | 'api-token' | 'private-key' | 'jwt';

const PATTERNS: ReadonlyArray<[DocsSecretKind, RegExp]> = [
  ['private-key', /-----BEGIN\s+(?:[A-Z0-9]+\s+){0,5}PRIVATE\s+KEY(?:\s+BLOCK)?-----/],
  ['aws-access-key', /(?:^|[^A-Za-z0-9])A(?:KIA|SIA)[0-9A-Z]{16}(?![A-Za-z0-9])/],
  ['api-token', /(?:^|[^A-Za-z0-9_-])sk-(?=[A-Za-z0-9_-]{20,})(?=[A-Za-z0-9_-]*[0-9])[A-Za-z0-9_-]{20,}/],
  ['api-token', /(?:^|[^A-Za-z0-9_])[sr]k_(?:live|test)_[A-Za-z0-9]{16,}/],
  ['jwt', /(?:^|[^A-Za-z0-9_-])eyJ[A-Za-z0-9_-]{8,}\.eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]*/],
];

/** What kind of secret `text` contains, or null. The string-level check (A6). */
export function findSecret(text: string): DocsSecretKind | null {
  if (text.length < 12) {return null;}
  for (const [kind, re] of PATTERNS) {
    if (re.test(text)) {return kind;}
  }
  return null;
}

export function containsSecret(text: string): boolean {
  return findSecret(text) !== null;
}

/** How much of the end of a cut section the tail rule looks at. */
const TAIL = 256;

const TAIL_PATTERNS: ReadonlyArray<[DocsSecretKind, RegExp]> = [
  ['private-key', /-----BEGIN[\s A-Z0-9]*$/],
  ['aws-access-key', /(?:^|[^A-Za-z0-9])A(?:KIA|SIA)[0-9A-Z]{4,15}$/],
  ['api-token', /(?:^|[^A-Za-z0-9_-])sk-(?=[A-Za-z0-9_-]*[0-9])[A-Za-z0-9_-]{8,}$/],
  ['api-token', /(?:^|[^A-Za-z0-9_])[sr]k_(?:live|test)_[A-Za-z0-9]{6,}$/],
  ['jwt', /(?:^|[^A-Za-z0-9_-])eyJ[A-Za-z0-9_-]{8,}\.eyJ[A-Za-z0-9_-]*$/],
];

/**
 * For text that was cut at the cap: a secret that begins near the end and runs
 * off it (half a key is still a key). Looks only at the last 256 characters.
 */
export function findSecretAtCutoff(text: string): DocsSecretKind | null {
  const tail = text.slice(Math.max(0, text.length - TAIL));
  for (const [kind, re] of TAIL_PATTERNS) {
    if (re.test(tail)) {return kind;}
  }
  return null;
}

export interface SecretScan<T> {
  /** Items with no secret, in the order given. */
  kept: T[];
  /** Ids of the items left out. Ids only: never the text (S13). */
  leftOut: string[];
  /** Why each was left out, by id. */
  kinds: Record<string, DocsSecretKind>;
}

/** Scan any list of items. `textOf` returns every string of the item that would be sent. */
export function scanForSecrets<T extends { id: string }>(items: readonly T[], textOf: (item: T) => string | readonly string[], truncatedOf?: (item: T) => boolean): SecretScan<T> {
  const out: SecretScan<T> = { kept: [], leftOut: [], kinds: {} };
  for (const item of items) {
    const raw = textOf(item);
    const texts = typeof raw === 'string' ? [raw] : raw;
    let kind: DocsSecretKind | null = null;
    for (const t of texts) {
      kind = findSecret(t);
      if (!kind && truncatedOf?.(item)) {kind = findSecretAtCutoff(t);}
      if (kind) {break;}
    }
    if (kind) {
      out.leftOut.push(item.id);
      out.kinds[item.id] = kind;
    } else {
      out.kept.push(item);
    }
  }
  return out;
}

/** Scan the sections `readSections` returned. */
export function scanDocsSections(sections: readonly AiDocsSection[]): SecretScan<AiDocsSection> {
  return scanForSecrets(sections, (s) => s.text, (s) => s.truncated);
}

/**
 * This-document scope: scan the live text per section, drop the sections that
 * hold a key and keep the rest, so one key does not drop the whole document.
 * `text` is the kept sections joined as they were (in file order).
 */
export function dropSecretSections(markdown: string): { text: string; total: number; leftOut: number } {
  if (!containsSecret(markdown)) {
    return { text: markdown, total: markdown.trim() === '' ? 0 : splitDocsSections(markdown).length, leftOut: 0 };
  }
  const sections = splitDocsSections(markdown);
  if (sections.length === 0) {return { text: markdown, total: 0, leftOut: 0 };}
  const kept = sections.filter((s) => !containsSecret(s.text));
  // Text outside every section (frontmatter before a first heading) is scanned as part of the document too.
  const outside = sections[0].start > 0 ? markdown.slice(0, sections[0].start) : '';
  const lead = outside !== '' && !containsSecret(outside) ? outside : '';
  return { text: lead + kept.map((s) => s.text).join(''), total: sections.length, leftOut: sections.length - kept.length };
}

/**
 * The coverage phrase: "1 section left out: looks like it contains a key".
 * `noun` is what was left out (`section`, or `entry` for navigation lists).
 */
export function secretsLeftOutPhrase(count: number, noun: 'section' | 'entry' = 'section'): string {
  if (count <= 0) {return '';}
  const many = noun === 'entry' ? 'entries' : 'sections';
  return count === 1
    ? `1 ${noun} left out: looks like it contains a key`
    : `${plural(count, noun, many)} left out: look like they contain a key`;
}
