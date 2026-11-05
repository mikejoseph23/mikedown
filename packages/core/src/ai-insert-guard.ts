/**
 * Insert at cursor's security boundary (S8). Model text is untrusted, and a
 * hostile page can steer it, so a live image or foreign link in the document is
 * a way to send section text to a server. `sanitizeInsertMarkdown` is only a
 * first pass, because a string-level pass approximates CommonMark and every
 * disagreement with markdown-it lets markup through. This module judges what the
 * editor's own parser produced.
 *
 * Rich text: `guardInsertFragment` walks the parsed fragment against an
 * allow-list. A node or mark type not listed here is not live, including one
 * added to the editor later. A link whose URL `InsertUrlPolicy` does not allow
 * keeps its text; such an image becomes its alt text plus the URL.
 *
 * Source mode: nothing structural can be rebuilt, because text goes in as text,
 * so `guardSourceMarkdown` picks the first version of the text that is clean,
 * alone and in the document, with less and less markup left. Null means none
 * was, and the caller refuses the insert.
 *
 * Raw HTML: the editor parses with `html: false`, so a tag is text. The one
 * exception is the `<a id>` anchor rule (`htmlanchor.ts`), whose node is not on
 * the allow-list either.
 */

import { Fragment, type Mark, type Node as PmNode } from '@tiptap/pm/model';
import { insertUrlIsVerbatim, type InsertUrlPolicy } from './ai';

/**
 * Nodes that carry no URL of their own (their children are walked). Math renders
 * with KaTeX's `trust: false` and Mermaid with `securityLevel: 'strict'`, so a
 * code block or formula cannot fetch or link. Not here on purpose: `image`
 * (judged below), `wikilink`, `tableOfContents` (it saves its raw markdown body
 * verbatim) and `htmlAnchor`.
 */
const INERT_NODES: ReadonlySet<string> = new Set([
  'blockquote', 'bulletList', 'callout', 'codeBlock', 'emoji', 'footnoteDef', 'footnoteRef', 'hardBreak', 'heading', 'horizontalRule',
  'listItem', 'mathBlock', 'mathInline', 'orderedList', 'paragraph', 'table', 'tableCell', 'tableHeader', 'tableRow', 'taskItem', 'taskList', 'text',
]);

/** Marks that carry no URL. `link` is judged below. */
const INERT_MARKS: ReadonlySet<string> = new Set(['bold', 'code', 'highlight', 'italic', 'strike', 'underline']);

/** The part of markdown-it the guard uses. */
export interface InsertGuardParser {
  normalizeLink(url: string): string;
  normalizeLinkText(url: string): string;
  parse(src: string, env: { references?: Record<string, { href?: string }> }): MarkdownToken[];
}

interface MarkdownToken {
  type: string;
  attrGet(name: string): string | null;
  children: MarkdownToken[] | null;
}

export interface InsertUrlCheck {
  link(href: string): boolean;
  image(src: string): boolean;
}

/**
 * `policy` as predicates on URLs as the parser leaves them. markdown-it
 * normalizes a destination (`é` to `%C3%A9`, a host to punycode), so a citation
 * href is compared normalized and a cited section's text, which has the URL as
 * written, is also tried against the readable form.
 */
export function insertUrlCheck(policy: InsertUrlPolicy, md: InsertGuardParser | undefined): InsertUrlCheck {
  const citations = new Set(md ? policy.citationHrefs.map((h) => md.normalizeLink(h)) : policy.citationHrefs);
  const verbatim = (url: string, kind: 'link' | 'image'): boolean =>
    insertUrlIsVerbatim(policy, url, kind) || (!!md && insertUrlIsVerbatim(policy, md.normalizeLinkText(url), kind));
  return {
    link: (href) => citations.has(href) || verbatim(href, 'link'),
    image: (src) => verbatim(src, 'image'),
  };
}

/** Text standing in for a node that is not live. */
function plainText(node: PmNode): string {
  if (node.type.name === 'image') {return [node.attrs.alt, node.attrs.src].filter(Boolean).join(' ');}
  const attrs = node.attrs as { alias?: unknown; target?: unknown; body?: unknown };
  return (node.textContent || String(attrs.alias ?? attrs.target ?? attrs.body ?? '')).replace(/\s+/g, ' ').trim();
}

export interface GuardedFragment {
  fragment: Fragment;
  /** What did not stay live: URLs, and `node:` or `mark:` entries for types off the allow-list. Empty means `fragment` is the input. */
  dropped: string[];
}

class InvalidContent extends Error {}

/** The fragment with everything not allowed made plain. Null when the result would not fit the schema (never expected; refuse rather than guess). */
export function guardInsertFragment(fragment: Fragment, check: InsertUrlCheck): GuardedFragment | null {
  const dropped: string[] = [];

  const keepMarks = (marks: readonly Mark[]): readonly Mark[] => {
    const kept = marks.filter((mark) => {
      if (INERT_MARKS.has(mark.type.name)) {return true;}
      if (mark.type.name === 'link') {
        const href = String(mark.attrs.href ?? '');
        if (check.link(href)) {return true;}
        dropped.push(href);
        return false;
      }
      dropped.push(`mark:${mark.type.name}`);
      return false;
    });
    return kept.length === marks.length ? marks : kept;
  };

  const asPlain = (node: PmNode, marks: readonly Mark[]): PmNode[] => {
    const { schema } = node.type;
    const text = plainText(node);
    if (node.isInline) {return text ? [schema.text(text, marks)] : [];}
    return text ? [schema.nodes.paragraph.create(null, schema.text(text))] : [];
  };

  const walkNode = (node: PmNode): PmNode[] => {
    const name = node.type.name;
    const marks = keepMarks(node.marks);
    if (name === 'image') {
      const src = String(node.attrs.src ?? '');
      if (check.image(src)) {return [marks === node.marks ? node : node.mark(marks)];}
      dropped.push(src);
      return asPlain(node, marks);
    }
    if (!INERT_NODES.has(name)) {
      dropped.push(`node:${name}:${JSON.stringify(node.attrs)}`);
      return asPlain(node, marks);
    }
    if (node.isText) {return [marks === node.marks ? node : node.mark(marks)];}
    const kids = walkFragment(node.content);
    if (kids !== node.content && !node.type.validContent(kids)) {throw new InvalidContent();}
    if (kids === node.content && marks === node.marks) {return [node];}
    return [node.type.create(node.attrs, kids, marks)];
  };

  const walkFragment = (content: Fragment): Fragment => {
    const out: PmNode[] = [];
    let same = true;
    content.forEach((child) => {
      const next = walkNode(child);
      if (next.length !== 1 || next[0] !== child) {same = false;}
      out.push(...next);
    });
    return same ? content : Fragment.fromArray(out);
  };

  try {
    return { fragment: walkFragment(fragment), dropped };
  } catch (err) {
    if (err instanceof InvalidContent) {return null;}
    throw err;
  }
}

// ── Source mode ─────────────────────────────────────────────────────────────

export interface SourceInspector {
  check: InsertUrlCheck;
  /** The text parsed as the rich editor would parse it. */
  fragment(markdown: string): Fragment;
  md: InsertGuardParser | undefined;
}

/** Everything in `markdown` that would not be allowed: nodes and marks, then tokens and reference definitions, which leave no node. Null when there is no parser to ask. */
function offenders(markdown: string, inspector: SourceInspector): Set<string> | null {
  const { check, md } = inspector;
  if (!md) {return null;}
  const guarded = guardInsertFragment(inspector.fragment(markdown), check);
  if (!guarded) {return null;}
  const found = new Set(guarded.dropped);
  const env: { references?: Record<string, { href?: string }> } = {};
  const visit = (tokens: MarkdownToken[]): void => {
    for (const token of tokens) {
      if (token.type === 'link_open') {
        const href = token.attrGet('href') ?? '';
        if (!check.link(href)) {found.add(href);}
      } else if (token.type === 'image') {
        const src = token.attrGet('src') ?? '';
        if (!check.image(src)) {found.add(src);}
      }
      if (token.children) {visit(token.children);}
    }
  };
  visit(md.parse(markdown, env));
  for (const def of Object.values(env.references ?? {})) {
    const href = def.href ?? '';
    if (!check.link(href) && !check.image(href)) {found.add(href);}
  }
  return found;
}

/** `\` first in the class, so an escape already in the text cannot cancel the one added here (`\[` must not become `\\[`). */
function escapeLinkSyntax(text: string): string {
  return text.replace(/[\\[\]!<`]/g, '\\$&');
}

/** Every ASCII punctuation character escaped: CommonMark gives each its literal meaning. */
function escapeAllPunctuation(text: string): string {
  return text.replace(/[!-/:-@[-`{-~]/g, '\\$&');
}

/** Escape only the blank-line separated parts that are not clean by themselves. */
function escapeAffectedParts(markdown: string, clean: (text: string) => boolean): string {
  return markdown.split(/(\n[ \t]*\n)/).map((part, i) => (i % 2 === 1 || clean(part) ? part : escapeLinkSyntax(part))).join('');
}

/**
 * The text to insert: as given when clean, else with only the affected parts
 * escaped, then all of it, then all punctuation. `placed` gives the document
 * body before and after an insert: text can parse differently there (an opening
 * fence closes one the caret sits in, an indented line joins a list item), so
 * every candidate is also judged in place, against what the body already holds.
 */
export function guardSourceMarkdown(markdown: string, inspector: SourceInspector, placed?: (text: string) => { before: string; after: string }): string | null {
  const cleanAlone = (text: string): boolean => offenders(text, inspector)?.size === 0;
  let existing: Set<string> | null = null;
  const cleanInPlace = (text: string): boolean => {
    if (!placed) {return true;}
    const { before, after } = placed(text);
    existing ??= offenders(before, inspector);
    const now = offenders(after, inspector);
    if (!existing || !now) {return false;}
    for (const url of now) {if (!existing.has(url)) {return false;}}
    return true;
  };
  const candidates: Array<() => string> = [
    () => markdown,
    () => escapeAffectedParts(markdown, cleanAlone),
    () => escapeLinkSyntax(markdown),
    () => escapeAllPunctuation(markdown),
  ];
  for (const candidate of candidates) {
    const text = candidate();
    if (cleanAlone(text) && cleanInPlace(text)) {return text;}
  }
  return null;
}
