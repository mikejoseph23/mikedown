/**
 * The documentation chat's turn: choose one route, navigate by outlines, read
 * sections, answer with citations. The security model rests here, so the rules
 * are stated once and enforced in code, not in a prompt.
 *
 *   - One route per turn (decision 7, A4). The route is resolved once, the
 *     per-base cloud switch is checked on it (one reached `viaFallback` too),
 *     and only then may a consent dialog or a request happen. Every hop and the
 *     answer carry the pin, so an engine going down mid-turn fails the turn; it
 *     never moves pages to another engine. The next turn resolves afresh.
 *   - Fail closed (S6). No route (a tier-1 host routes by itself) counts as not
 *     local. `allowCloud` comes from `listBases()` for this turn, never a copy.
 *   - The model names ids and nothing else (S1). Its reply is hostile: `read`
 *     may be missing, not a list, full of non-strings or thousands long. Only
 *     ids found in an active base's index reach `readSections`, and what is
 *     passed on is the index's own string, not the model's.
 *   - Ids are unique per base only, so a read is always `(baseId, id)`. With
 *     more than one base the ids offered carry a `b1:` token.
 *   - Secrets (S7, A6, A7). Every string is scanned before any message is
 *     built: section text and labels, titles, headings, link text, keyword
 *     labels, the question. The Activity log records messages verbatim, so what
 *     the scan leaves out can reach neither a request nor an entry.
 *   - Nothing from a page changes the control flow (S10). Only the model's JSON,
 *     filtered through the index, picks what is read. The answer call's output
 *     is never parsed for further reads, and the hop cap holds regardless.
 *   - Read-only (S12). No writes, no shell, no URLs: the loop's only effects are
 *     `deps` and the read calls of `host.docs`.
 *
 * Pure: `ai/` has no DOM and no network, and `ai-request.ts` sits outside it,
 * so the completion runner and route resolution are parameters
 * (`ai-docs-run.ts` is the wiring).
 */

import { makeAiError, toAiError } from '../errors';
import { jsonRepairMessages } from '../json';
import { buildDocsAnswerMessages, docsAnswerMaxTokens, finalizeDocsAnswer } from '../prompts/docsAnswer';
import { DOCS_NAV_MAX_TOKENS, buildDocsNavigateMessages, parseDocsNavReply, type DocsNavBlock, type DocsNavEntry } from '../prompts/docsNavigate';
import type { AiRouteOk } from '../router';
import type { AiThinkingLevel } from '../thinking';
import { DEFAULT_CONTEXT_TOKENS } from '../types';
import type {
  AiCompletionResult,
  AiDocBaseStatus,
  AiDocsIndex,
  AiDocsNavigateBy,
  AiDocsOptions,
  AiDocsPage,
  AiDocsSection,
  AiDocsSectionRef,
  AiError,
  AiMessage,
  AiSendsScope,
  MikeDownDocsHost,
} from '../types';
import { budgetDocsSections, docsBudgetChars, type AiDocsNumberedSection } from './budget';
import {
  DOCS_KEYWORD_TOP,
  DOCS_MAX_ACTIVITY_IDS,
  DOCS_MAX_ACTIVITY_ID_CHARS,
  DOCS_MAX_ID_CHARS,
  DOCS_MAX_LINKS,
  DOCS_MAX_NAV_CHARS,
  DOCS_MAX_READ_IDS_PER_HOP,
  capSectionText,
  clampDocsHops,
  clampDocsSourceShare,
} from './caps';
import { ANSWERED_WITHOUT_SOURCES, parseCitations, type ParsedCitations } from './citations';
import { DOCS_MAP_HEADINGS_PER_PAGE, buildDocsMap } from './home';
import { buildDocsIndex, docsPageId, docsPagesById, docsSectionId, parseDocsId } from './index';
import { rankKeywordSections } from './keyword';
import { createDocsLinkResolver, docsLinkList, type DocsLinkResolver } from './links';
import { containsSecret, scanForSecrets, secretsLeftOutPhrase } from './secrets';
import { splitDocsSections } from './sections';

export const DOCS_CHAT_FEATURE = 'chat';
/** The This document scope's synthetic page. */
export const DOCS_DOCUMENT_BASE_ID = 'document';
const DOCUMENT_ROOT = 'document';
const DOCUMENT_REL_PATH = 'document.md';

/**
 * A route held for a whole turn (A4): the pair `runAiCompletion` must use, with
 * no re-routing and no retry elsewhere.
 */
export interface AiRoutePin {
  engineId: string;
  modelId: string;
  /** How the turn's route was reached, for the badge and the Activity entry. */
  viaFallback?: boolean;
  reason?: string;
  /** "Allow once" answered at the start of the turn: it covers every call of this turn, and nothing after it. */
  consented?: boolean;
}

/** What a chat request's Activity entry adds to the usual fields (A7). Ids only, never text. */
export interface AiDocsActivityDetail {
  /** Which navigation step, 1-based. Absent on the answer. */
  hop?: number;
  /** Navigate: the sections this hop's reply read. Answer: the sections sent. */
  pages: string[];
  /** Ids the model named that were not used, clipped and at most `DOCS_MAX_ACTIVITY_IDS`. */
  droppedIds: string[];
  /** Everything dropped, non-strings and overflow included. */
  droppedCount: number;
  /** Sections the secrets scan left out. */
  leftOutIds?: string[];
  /** Sections that did not fit the budget. */
  cutIds?: string[];
}

export interface DocsRunRequest {
  feature: string;
  task: string;
  sends: AiSendsScope;
  baseIds?: string[];
  messages: AiMessage[];
  maxTokens: number;
  temperature: number;
  format?: 'json';
  job: 'navigate' | 'answer';
  thinking?: AiThinkingLevel | null | ((kind: string) => AiThinkingLevel | null);
  pin?: AiRoutePin;
  docs: AiDocsActivityDetail;
}

/** The thinking state of the request, as the runner reports it. */
export interface DocsRunThinking {
  kind: string;
  configured: AiThinkingLevel | null;
  sent: AiThinkingLevel | null;
  auto?: boolean;
}

export interface DocsRunOutcome {
  result: AiCompletionResult;
  route: AiRouteOk | null;
  viaFallback: boolean;
  thinking: DocsRunThinking | null;
  /** The Activity entry's id, for `annotate`. */
  requestId?: string;
}

export interface DocsRunEvents {
  onRoute?(route: AiRouteOk | null, thinking: DocsRunThinking | null): void;
  onToken?(delta: string, text: string): void;
}

export interface DocsRouteRequest {
  feature: string;
  task: string;
  sends: AiSendsScope;
  baseIds?: string[];
  /** Asked about every route considered, before any consent dialog. False stops the turn with `blocked`. */
  allowed(route: AiRouteOk | null): boolean;
}

export interface DocsTurnRoute {
  /** `allowed` said no; nothing was asked and nothing was sent. */
  blocked: boolean;
  /** Null for a tier-1 host. */
  route: AiRouteOk | null;
  /** Null when there is no route to hold. */
  pin: AiRoutePin | null;
}

/** What the loop needs from the editor's request layer (`aiDocsLoopDeps`). */
export interface DocsLoopDeps {
  resolveRoute(req: DocsRouteRequest, signal: AbortSignal): Promise<DocsTurnRoute>;
  run(req: DocsRunRequest, events: DocsRunEvents, signal: AbortSignal): Promise<DocsRunOutcome>;
  /** The route's context window, null when unknown. */
  contextTokens(route: AiRouteOk | null): number | null;
  /** Update a request's Activity entry once the hop's reply was acted on. */
  annotate?(requestId: string, detail: AiDocsActivityDetail): void;
}

/** The read side of `host.docs`; the loop never touches `saveBases` or a folder picker. */
export type DocsReadHost = Pick<MikeDownDocsHost, 'listBases' | 'index' | 'readSections' | 'keywordSearch'>;

export type DocsTurnScope =
  | { kind: 'bases'; docs: DocsReadHost; options?: Partial<AiDocsOptions> }
  /** Live editor text: a single synthetic page, no host calls, task `chat`. */
  | { kind: 'document'; text: string; title?: string; options?: Partial<AiDocsOptions> };

export interface DocsTurnInput {
  question: string;
  scope: DocsTurnScope;
  /** The user's dial, for the answer only: navigation stays on its job default (Off). */
  thinking?: DocsRunRequest['thinking'];
}

export interface DocsTurnProgress {
  phase: 'navigate' | 'keyword' | 'answer';
  /** Navigation step, 1-based. */
  hop?: number;
  maxHops: number;
  /** Sections read so far. */
  pages: number;
}

export interface DocsTurnEvents extends DocsRunEvents {
  onProgress?(progress: DocsTurnProgress): void;
}

/** A numbered section as sent, with the base it came from: ids are unique per base only. */
export interface DocsSentSection extends AiDocsNumberedSection {
  baseId: string;
}

export interface DocsTurnAnswer {
  kind: 'answered';
  /** The answer with unknown citation numbers removed and reasoning stripped. */
  answer: string;
  citations: ParsedCitations;
  sent: DocsSentSection[];
  /** The note under the answer: coverage, secrets left out, or "answered without sources". */
  coverage: string;
  /** Nothing was read: label the answer. */
  withoutSources: boolean;
  /** Sections were sent and the answer cites none: "No sources cited". */
  noSources: boolean;
  /** Navigation calls made (a repair turn is not a hop). */
  hops: number;
  droppedCount: number;
  secretsLeftOut: number;
  /** Nav entries the scan left out of the prompts. */
  entriesLeftOut: number;
  run: DocsRunOutcome;
}

export type DocsTurnOutcome =
  | DocsTurnAnswer
  /** S6: a cloud route (or none) and a base that may not leave the machine. Nothing was asked or sent. */
  | { kind: 'baseLocalOnly'; bases: Array<{ id: string; name: string }>; route: AiRouteOk | null }
  | { kind: 'noActiveBases' }
  /** The question itself looks like it holds a key. Nothing was sent. */
  | { kind: 'questionHasSecret' }
  /** Another request of this editor is in flight. */
  | { kind: 'busy' }
  | { kind: 'cancelled' }
  | { kind: 'error'; error: AiError };

/** "Active" (A1): enabled and with a root found. Host-reported state, re-checked rather than assumed. */
export function docsActiveBases(statuses: readonly AiDocBaseStatus[]): AiDocBaseStatus[] {
  return statuses.filter((s) => s.active === true && s.base.enabled === true && s.roots.some((r) => r.found === true));
}

/** S6: the active bases `route` may not carry. A null route counts as not local (fail closed). */
export function docsBlockingBases(active: readonly AiDocBaseStatus[], route: AiRouteOk | null): AiDocBaseStatus[] {
  if (route?.isLocal === true) {return [];}
  return active.filter((s) => s.base.allowCloud !== true);
}

// ── The turn's sources ──────────────────────────────────────────────────────

interface LoopBase {
  id: string;
  name: string;
  /** `b1` when there are several bases: the offered ids carry it. */
  token: string | null;
  index: AiDocsIndex;
  pages: Map<string, AiDocsPage>;
  resolver: DocsLinkResolver;
}

interface TurnSource {
  bases: LoopBase[];
  read(base: LoopBase, ids: string[]): Promise<AiDocsSection[]>;
  keyword(base: LoopBase, query: string): Promise<AiDocsSectionRef[]>;
}

function loopBase(id: string, name: string, token: string | null, index: AiDocsIndex): LoopBase {
  return { id, name, token, index, pages: docsPagesById(index), resolver: createDocsLinkResolver(index) };
}

/** The live text as one page of one base. Reading a bare page id yields its sections, so one key does not drop the whole document (A6). */
function documentSource(text: string, title: string | undefined): TurnSource {
  const sections = splitDocsSections(text);
  const index = buildDocsIndex({
    baseId: DOCS_DOCUMENT_BASE_ID,
    roots: [{ label: DOCUMENT_ROOT }],
    homeFile: DOCUMENT_REL_PATH,
    pages: text.trim() === '' ? [] : [{
      root: DOCUMENT_ROOT,
      relPath: DOCUMENT_REL_PATH,
      ...(title ? { title } : {}),
      headings: sections.flatMap((s) => (s.heading ? [{ level: s.heading.level, text: s.heading.text }] : [])),
      chars: text.length,
    }],
  });
  const pageId = docsPageId(DOCUMENT_ROOT, DOCUMENT_REL_PATH);
  const pageTitle = index.pages[0]?.title ?? '';
  const asSection = (s: (typeof sections)[number]): AiDocsSection => {
    const capped = capSectionText(s.text);
    return {
      id: s.heading ? docsSectionId(pageId, s.heading.slug) : pageId,
      pageId,
      title: pageTitle,
      relPath: DOCUMENT_REL_PATH,
      ...(s.heading ? { heading: s.heading.text } : {}),
      text: capped.text,
      truncated: capped.truncated,
    };
  };
  const all = sections.map(asSection);
  return {
    bases: [loopBase(DOCS_DOCUMENT_BASE_ID, '', null, index)],
    read: (_base, ids) => Promise.resolve(ids.flatMap((id) => (id === pageId ? all : all.filter((s) => s.id === id)))),
    keyword: (_base, query) => Promise.resolve(rankKeywordSections(query, sections.map((s, i) => ({
      id: all[i].id,
      pageId,
      title: pageTitle,
      relPath: DOCUMENT_REL_PATH,
      ...(s.heading ? { heading: s.heading.text } : {}),
      text: s.text,
    })))),
  };
}

// ── Turn state ──────────────────────────────────────────────────────────────

interface KeptSection {
  base: LoopBase;
  section: AiDocsSection;
}

interface TurnState {
  kept: KeptSection[];
  /** Every `(baseId, id)` asked for, read or not: never asked for twice. */
  attempted: Set<string>;
  /** Pages read whole: their sections count as read. */
  wholePages: Set<string>;
  /** Pages read, for the next hop's outlines (A5: never their bodies). */
  readPages: Array<{ base: LoopBase; page: AiDocsPage }>;
  offeredRead: string[];
  secretsLeftOut: number;
  leftOutIds: string[];
  /** Nav entries the scan left out; a set because every hop rebuilds the prompt. */
  navLeftOut: Set<string>;
  droppedCount: number;
  droppedIds: string[];
}

const keyOf = (baseId: string, id: string): string => `${baseId}\u0000${id}`;

function offer(base: LoopBase, id: string): string {
  return base.token ? `${base.token}:${id}` : id;
}

/** Ids for an entry (A7): no id that holds a key, clipped, and only so many. */
function activityIds(ids: readonly string[]): string[] {
  const out: string[] = [];
  for (const id of ids) {
    if (out.length >= DOCS_MAX_ACTIVITY_IDS) {break;}
    if (containsSecret(id)) {continue;}
    out.push(id.length > DOCS_MAX_ACTIVITY_ID_CHARS ? `${id.slice(0, DOCS_MAX_ACTIVITY_ID_CHARS)}…` : id);
  }
  return out;
}

function throwIfAborted(signal: AbortSignal): void {
  if (signal.aborted) {throw makeAiError('cancelled');}
}

// ── Navigation prompt content ───────────────────────────────────────────────

/** The block builders: every string is scanned here, before any message exists. */
function navBlocks(source: TurnSource, state: TurnState, navigateBy: AiDocsNavigateBy): DocsNavBlock[] {
  const admit = (key: string, ...strings: string[]): boolean => {
    if (!strings.some(containsSecret)) {return true;}
    state.navLeftOut.add(key);
    return false;
  };

  const headingEntries = (base: LoopBase, page: AiDocsPage, limit?: number): DocsNavEntry[] => {
    const headings = limit === undefined ? page.headings : page.headings.filter((h) => h.level <= 3).slice(0, limit);
    const out: DocsNavEntry[] = [];
    for (const h of headings) {
      if (admit(keyOf(base.id, h.id), h.id, h.text)) {out.push({ id: offer(base, h.id), text: h.text });}
    }
    return out;
  };

  /** What to offer for a page: its section ids, or one page id. */
  const pageOffer = (base: LoopBase, page: AiDocsPage, label: string): DocsNavEntry | null => {
    if (!admit(keyOf(base.id, page.id), page.id, page.title, label)) {return null;}
    const text = label && label !== page.title ? `${label} (${page.title})` : page.title;
    if (page.headings.length === 0) {return { id: offer(base, page.id), text };}
    if (navigateBy === 'page') {
      const outline = page.headings
        .filter((h) => h.level <= 3)
        .slice(0, DOCS_MAP_HEADINGS_PER_PAGE)
        .filter((h) => admit(keyOf(base.id, h.id), h.text))
        .map((h) => h.text);
      return { id: offer(base, page.id), text: outline.length > 0 ? `${text} | ${outline.join('; ')}` : text };
    }
    const children = headingEntries(base, page, DOCS_MAP_HEADINGS_PER_PAGE);
    return children.length > 0 ? { id: null, text, children } : null;
  };

  const linkEntries = (base: LoopBase, page: AiDocsPage): { entries: DocsNavEntry[]; omitted: number } => {
    const list = docsLinkList(base.index, page.id, DOCS_MAX_LINKS, base.resolver);
    const entries: DocsNavEntry[] = [];
    const seen = new Set<string>();
    for (const link of list.links) {
      const target = link.pageId ? base.pages.get(link.pageId) : undefined;
      if (!target) {continue;}
      if (navigateBy === 'section' && link.sectionId) {
        if (admit(keyOf(base.id, link.sectionId), link.sectionId, link.text, target.title)) {
          entries.push({ id: offer(base, link.sectionId), text: link.text });
        }
        continue;
      }
      if (seen.has(target.id)) {continue;}
      seen.add(target.id);
      const entry = pageOffer(base, target, link.text);
      if (entry) {entries.push(entry);}
    }
    // Decision 14: a wikilink with no match here may name a page of another active base. Several matches are all offered, with a count.
    if (source.bases.length > 1) {
      for (const link of page.links) {
        if (link.kind !== 'wikilink' || base.resolver.resolve(page.id, link).status !== 'broken') {continue;}
        const matches: Array<{ other: LoopBase; target: AiDocsPage }> = [];
        for (const other of source.bases) {
          const from = other.index.pages[0];
          if (other === base || !from) {continue;}
          const hit = other.resolver.resolve(from.id, link);
          const target = hit.status === 'ok' && hit.pageId ? other.pages.get(hit.pageId) : undefined;
          if (target) {matches.push({ other, target });}
        }
        for (const { other, target } of matches) {
          const label = matches.length > 1 ? `${link.text} (1 of ${matches.length} matches)` : link.text;
          const entry = pageOffer(other, target, label);
          if (entry) {entries.push(entry);}
        }
      }
    }
    return { entries, omitted: list.omitted };
  };

  const baseLabel = (base: LoopBase): string => {
    if (!base.token) {return '';}
    return base.name && !containsSecret(base.name) ? `Base ${base.token} (${base.name}), ` : `Base ${base.token}, `;
  };

  const pageBlock = (base: LoopBase, page: AiDocsPage, label: string): DocsNavBlock => {
    const links = linkEntries(base, page);
    const entry = navigateBy === 'page' ? pageOffer(base, page, '') : null;
    const outline = navigateBy === 'page'
      ? (entry ? [entry] : [])
      : page.headings.length > 0
        ? headingEntries(base, page)
        : admit(keyOf(base.id, page.id), page.id, page.title) ? [{ id: offer(base, page.id), text: page.title }] : [];
    const title = containsSecret(page.title) ? '' : `: ${page.title}`;
    return { label: `${baseLabel(base)}${label}${title}`, outline, links: links.entries, omitted: links.omitted };
  };

  const blocks: DocsNavBlock[] = [];
  // Newest first: they are what this hop adds, and a long home must not crowd them out.
  const homeIds = new Set(source.bases.flatMap((b) => b.index.homes.map((h) => keyOf(b.id, h.pageId ?? ''))));
  const listed = new Set<string>();
  for (let i = state.readPages.length - 1; i >= 0; i--) {
    const { base, page } = state.readPages[i];
    const key = keyOf(base.id, page.id);
    if (homeIds.has(key) || listed.has(key)) {continue;}
    listed.add(key);
    blocks.push(pageBlock(base, page, 'Page already read'));
  }
  for (const base of source.bases) {
    for (const home of base.index.homes) {
      if (!admit(keyOf(base.id, `root:${home.root}`), home.root)) {continue;}
      const page = home.pageId ? base.pages.get(home.pageId) : undefined;
      if (page) {
        blocks.push(pageBlock(base, page, `Root ${home.root}, home page`));
        continue;
      }
      const map = buildDocsMap(base.index, home.root);
      const outline: DocsNavEntry[] = [];
      for (const e of map.entries) {
        if (!admit(keyOf(base.id, e.pageId), e.pageId, e.title, ...e.headings)) {continue;}
        outline.push({ id: offer(base, e.pageId), text: e.headings.length > 0 ? `${e.title} | ${e.headings.join('; ')}` : e.title });
      }
      blocks.push({ label: `${baseLabel(base)}Root ${home.root}, list of pages`, outline, links: [], omitted: map.omitted });
    }
  }
  return blocks;
}

// ── Ids from the model ──────────────────────────────────────────────────────

interface IdRef {
  base: LoopBase;
  /** The index's own string, never the model's. */
  id: string;
  pageId: string;
}

function resolveInBase(base: LoopBase, id: string): IdRef | null {
  const parsed = parseDocsId(id, (pageId) => base.pages.has(pageId));
  if (!parsed) {return null;}
  const page = base.pages.get(parsed.pageId) as AiDocsPage;
  if (parsed.slug === undefined) {return { base, id: page.id, pageId: page.id };}
  const heading = page.headings.find((h) => h.slug === parsed.slug);
  return heading ? { base, id: heading.id, pageId: page.id } : null;
}

/** S1: an id the model named, as a `(base, id)` in an active base's index, or null. Disabled bases have no index here, so their pages are simply unknown. */
function resolveModelId(raw: string, bases: readonly LoopBase[]): IdRef | null {
  if (raw === '' || raw.length > DOCS_MAX_ID_CHARS) {return null;}
  const tokened = /^(b\d{1,3}):/.exec(raw);
  if (tokened) {
    const base = bases.find((b) => b.token === tokened[1]);
    if (base) {return resolveInBase(base, raw.slice(tokened[0].length));}
  }
  // No token: fine as long as exactly one base has it.
  let found: IdRef | null = null;
  for (const base of bases) {
    const ref = resolveInBase(base, raw);
    if (!ref) {continue;}
    if (found) {return null;}
    found = ref;
  }
  return found;
}

function pickIds(read: readonly unknown[], source: TurnSource, state: TurnState): { refs: IdRef[]; droppedIds: string[]; droppedCount: number } {
  const refs: IdRef[] = [];
  const dropped: string[] = [];
  let droppedCount = 0;
  const seen = new Set<string>();
  for (const raw of read) {
    if (typeof raw !== 'string') {
      droppedCount++;
      continue;
    }
    const text = raw.trim();
    const ref = resolveModelId(text, source.bases);
    if (!ref) {
      droppedCount++;
      dropped.push(text);
      continue;
    }
    const key = keyOf(ref.base.id, ref.id);
    // A repeat is not hostile, just not news.
    if (seen.has(key) || state.attempted.has(key) || state.wholePages.has(keyOf(ref.base.id, ref.pageId))) {continue;}
    if (refs.length >= DOCS_MAX_READ_IDS_PER_HOP) {
      droppedCount++;
      dropped.push(text);
      continue;
    }
    seen.add(key);
    refs.push(ref);
  }
  return { refs, droppedIds: activityIds(dropped), droppedCount };
}

// ── Reading ─────────────────────────────────────────────────────────────────

interface ReadResult {
  pages: string[];
  leftOutIds: string[];
  missing: string[];
}

/** Read `refs`, scan before anything else looks at the text (S7), and keep the clean ones in the order asked. */
async function readAndKeep(refs: readonly IdRef[], source: TurnSource, state: TurnState, signal: AbortSignal): Promise<ReadResult> {
  const byBase = new Map<LoopBase, IdRef[]>();
  refs.forEach((ref) => {
    state.attempted.add(keyOf(ref.base.id, ref.id));
    const list = byBase.get(ref.base);
    if (list) {list.push(ref);} else {byBase.set(ref.base, [ref]);}
  });
  const rank = new Map(refs.map((ref, i) => [keyOf(ref.base.id, ref.id), i]));
  const got: Array<{ id: string; base: LoopBase; section: AiDocsSection }> = [];
  const returned = new Set<string>();
  for (const [base, list] of byBase) {
    const sections = await source.read(base, list.map((r) => r.id));
    throwIfAborted(signal);
    for (const section of sections) {
      const key = keyOf(base.id, section.id);
      if (returned.has(key)) {continue;}
      returned.add(key);
      state.attempted.add(key);
      got.push({ id: key, base, section });
    }
  }
  got.sort((a, b) => (rank.get(a.id) ?? Number.MAX_SAFE_INTEGER) - (rank.get(b.id) ?? Number.MAX_SAFE_INTEGER));

  const scan = scanForSecrets(
    got,
    ({ section: s }) => [s.text, s.id, s.title, s.relPath, s.heading ?? ''],
    ({ section: s }) => s.truncated === true,
  );
  const leftOut = got.filter((g) => scan.kinds[g.id] !== undefined).map((g) => g.section.id);
  state.secretsLeftOut += leftOut.length;
  state.leftOutIds.push(...leftOut);

  const pages: string[] = [];
  for (const { base, section } of scan.kept) {
    if (section.text.trim() === '') {continue;}
    // A whole page holds the sections read earlier, unless the cap cut it.
    if (section.id === section.pageId && !section.truncated) {
      state.wholePages.add(keyOf(base.id, section.pageId));
      state.kept = state.kept.filter((k) => k.base !== base || k.section.pageId !== section.pageId);
    }
    if (state.kept.some((k) => k.base === base && k.section.id === section.id)) {continue;}
    state.kept.push({ base, section });
    pages.push(section.id);
    const page = base.pages.get(section.pageId);
    if (page) {state.readPages.push({ base, page });}
  }
  const missing = refs.filter((r) => !returned.has(keyOf(r.base.id, r.id))).map((r) => r.id);
  return { pages: activityIds(pages), leftOutIds: activityIds(leftOut), missing };
}

// ── The turn ────────────────────────────────────────────────────────────────

async function keywordFallback(question: string, source: TurnSource, state: TurnState, signal: AbortSignal): Promise<void> {
  const nothingRead = state.kept.length === 0;
  const hits: Array<{ ref: IdRef; score: number }> = [];
  for (const base of source.bases) {
    if (!nothingRead && !base.index.homes.some((h) => h.kind === 'map')) {continue;}
    const found = await source.keyword(base, question);
    throwIfAborted(signal);
    for (const hit of found) {
      const ref = typeof hit.id === 'string' ? resolveInBase(base, hit.id) : null;
      if (!ref) {
        state.droppedCount++;
        if (typeof hit.id === 'string') {state.droppedIds.push(...activityIds([hit.id]));}
        continue;
      }
      if (state.attempted.has(keyOf(base.id, ref.id)) || state.wholePages.has(keyOf(base.id, ref.pageId))) {continue;}
      hits.push({ ref, score: typeof hit.score === 'number' && Number.isFinite(hit.score) ? hit.score : 0 });
    }
  }
  if (hits.length === 0) {return;}
  hits.sort((a, b) => b.score - a.score);
  const read = await readAndKeep(hits.slice(0, DOCS_KEYWORD_TOP).map((h) => h.ref), source, state, signal);
  state.droppedCount += read.missing.length;
  state.droppedIds.push(...activityIds(read.missing));
}

async function runTurn(deps: DocsLoopDeps, input: DocsTurnInput, events: DocsTurnEvents, signal: AbortSignal): Promise<DocsTurnOutcome> {
  const question = input.question.trim();
  if (question === '') {return { kind: 'error', error: makeAiError('unknown', 'Type a question first.') };}
  // S7 covers every string sent. Nothing has happened yet, so this is the cheapest place to stop.
  if (containsSecret(question)) {return { kind: 'questionHasSecret' }; }
  throwIfAborted(signal);

  const { scope } = input;
  const task = scope.kind === 'bases' ? 'docs' : 'chat';
  const sends: AiSendsScope = scope.kind === 'bases' ? 'docsBase' : 'document';

  // S6: the switch is read for this turn, and checked before anything is asked or sent.
  const active = scope.kind === 'bases' ? docsActiveBases(await scope.docs.listBases()) : [];
  throwIfAborted(signal);
  if (scope.kind === 'bases' && active.length === 0) {return { kind: 'noActiveBases' };}
  const baseIds = active.map((s) => s.base.id);
  const blocked = (route: AiRouteOk | null): DocsTurnOutcome => ({
    kind: 'baseLocalOnly',
    bases: docsBlockingBases(active, route).map((s) => ({ id: s.base.id, name: s.base.name })),
    route,
  });
  const routeAllowed = (route: AiRouteOk | null): boolean => docsBlockingBases(active, route).length === 0;

  const turn = await deps.resolveRoute({
    feature: DOCS_CHAT_FEATURE,
    task,
    sends,
    ...(baseIds.length > 0 ? { baseIds } : {}),
    allowed: routeAllowed,
  }, signal);
  // The resolver was told, and this is checked again here: the loop does not take its word for it.
  if (turn.blocked || !routeAllowed(turn.route)) {return blocked(turn.route);}
  throwIfAborted(signal);

  const options = scope.options ?? {};
  const maxHops = clampDocsHops(options.maxHops);
  const sourceShare = clampDocsSourceShare(options.sourceShare);
  const navigateBy: AiDocsNavigateBy = scope.kind === 'bases' && options.navigateBy === 'page' ? 'page' : 'section';
  const contextTokens = deps.contextTokens(turn.route) ?? DEFAULT_CONTEXT_TOKENS;

  // Only now do the bases get touched: a blocked turn does no work.
  let source: TurnSource;
  if (scope.kind === 'document') {
    source = documentSource(scope.text, scope.title);
  } else {
    const bases: LoopBase[] = [];
    let firstError: unknown = null;
    for (const status of active) {
      try {
        const index = await scope.docs.index(status.base.id);
        bases.push(loopBase(status.base.id, status.base.name, active.length > 1 ? `b${active.indexOf(status) + 1}` : null, index));
      } catch (err) {
        firstError = firstError ?? err;
      }
      throwIfAborted(signal);
    }
    if (bases.length === 0) {throw firstError ?? makeAiError('unknown', 'No documentation base could be read.');}
    const { docs } = scope;
    source = {
      bases,
      read: async (base, ids) => {
        // Only what was asked for: a host answers ids, it does not add to them.
        const asked = new Set(ids);
        const sections = await docs.readSections(base.id, ids);
        return sections.filter((s) => asked.has(s.id));
      },
      keyword: (base, query) => docs.keywordSearch(base.id, query),
    };
  }

  const state: TurnState = {
    kept: [],
    attempted: new Set(),
    wholePages: new Set(),
    readPages: [],
    offeredRead: [],
    secretsLeftOut: 0,
    leftOutIds: [],
    navLeftOut: new Set(),
    droppedCount: 0,
    droppedIds: [],
  };
  const common = {
    feature: DOCS_CHAT_FEATURE,
    task,
    sends,
    ...(baseIds.length > 0 ? { baseIds } : {}),
    ...(turn.pin ? { pin: turn.pin } : {}),
  };
  const navChars = Math.min(DOCS_MAX_NAV_CHARS, docsBudgetChars(contextTokens, sourceShare));
  const routeEvents: DocsRunEvents = { onRoute: (route, thinking) => events.onRoute?.(route, thinking) };

  let hops = 0;
  for (let hop = 1; hop <= maxHops; hop++) {
    throwIfAborted(signal);
    const prompt = buildDocsNavigateMessages({
      question,
      blocks: navBlocks(source, state, navigateBy),
      alreadyRead: state.offeredRead,
      hop,
      maxHops,
      navigateBy,
      maxChars: navChars,
    });
    // Nothing to choose from: no point asking.
    if (prompt.offered === 0) {break;}
    hops = hop;
    events.onProgress?.({ phase: 'navigate', hop, maxHops, pages: state.kept.length });
    const navRequest = (messages: AiMessage[]): DocsRunRequest => ({
      ...common,
      messages,
      maxTokens: DOCS_NAV_MAX_TOKENS,
      temperature: 0,
      format: 'json',
      job: 'navigate',
      docs: { hop, pages: [], droppedIds: [], droppedCount: 0 },
    });
    let out = await deps.run(navRequest(prompt.messages), routeEvents, signal);
    let reply = parseDocsNavReply(out.result.text);
    if (!reply.ok) {
      // One repair turn, then the loop ends with what was read (decision 4).
      throwIfAborted(signal);
      out = await deps.run(navRequest([...prompt.messages, ...jsonRepairMessages(out.result.text, reply.error)]), routeEvents, signal);
      reply = parseDocsNavReply(out.result.text);
      if (!reply.ok) {break;}
    }
    throwIfAborted(signal);

    const picked = pickIds(reply.read, source, state);
    const read = picked.refs.length > 0 ? await readAndKeep(picked.refs, source, state, signal) : { pages: [], leftOutIds: [], missing: [] };
    const droppedIds = [...picked.droppedIds, ...activityIds(read.missing)];
    const droppedCount = picked.droppedCount + read.missing.length;
    state.droppedCount += droppedCount;
    state.droppedIds.push(...droppedIds);
    state.offeredRead.push(...picked.refs.map((r) => offer(r.base, r.id)).filter((id) => !containsSecret(id)));
    if (out.requestId) {
      deps.annotate?.(out.requestId, {
        hop,
        pages: read.pages,
        droppedIds: droppedIds.slice(0, DOCS_MAX_ACTIVITY_IDS),
        droppedCount,
        ...(read.leftOutIds.length > 0 ? { leftOutIds: read.leftOutIds } : {}),
      });
    }
    if (reply.done || picked.refs.length === 0) {break;}
  }

  // Decision 11: when a home is the map, or navigation read nothing.
  if (state.kept.length === 0 || source.bases.some((b) => b.index.homes.some((h) => h.kind === 'map'))) {
    throwIfAborted(signal);
    events.onProgress?.({ phase: 'keyword', maxHops, pages: state.kept.length });
    await keywordFallback(question, source, state, signal);
  }
  throwIfAborted(signal);

  // Scanned already. Keyed by position because the budget dedupes by `id`, and ids are unique per base only.
  const budget = budgetDocsSections(
    state.kept.map((k, i) => ({ ...k.section, id: String(i) })),
    { contextTokens, sourceShare, secretsLeftOut: state.secretsLeftOut },
  );
  const sent: DocsSentSection[] = budget.sent.map(({ n, section }) => {
    const origin = state.kept[Number(section.id)];
    return { n, baseId: origin.base.id, section: { ...section, id: origin.section.id } };
  });
  const cutIds = budget.cutIds.map((i) => state.kept[Number(i)].section.id);
  const coverageParts = [
    budget.note ?? (sent.length === 0 ? ANSWERED_WITHOUT_SOURCES : ''),
    secretsLeftOutPhrase(state.navLeftOut.size, 'entry'),
  ].filter((p) => p !== '');
  const coverage = coverageParts.join('; ');

  events.onProgress?.({ phase: 'answer', maxHops, pages: sent.length });
  const messages = buildDocsAnswerMessages({ question, sent, coverage, scope: scope.kind });
  const run = await deps.run({
    ...common,
    messages,
    maxTokens: docsAnswerMaxTokens(contextTokens, messages),
    temperature: 0.3,
    job: 'answer',
    ...(input.thinking !== undefined ? { thinking: input.thinking } : {}),
    docs: {
      pages: activityIds(sent.map((s) => s.section.id)),
      droppedIds: activityIds(state.droppedIds),
      droppedCount: state.droppedCount,
      ...(state.leftOutIds.length > 0 ? { leftOutIds: activityIds(state.leftOutIds) } : {}),
      ...(cutIds.length > 0 ? { cutIds: activityIds(cutIds) } : {}),
    },
  }, {
    ...routeEvents,
    onToken: (delta, text) => events.onToken?.(delta, text),
  }, signal);

  // Text for a person. Nothing below reads it for instructions or ids.
  const citations = parseCitations(finalizeDocsAnswer(run.result.text), sent.map((s) => s.n));
  return {
    kind: 'answered',
    answer: citations.text,
    citations,
    sent,
    coverage,
    withoutSources: sent.length === 0,
    noSources: sent.length > 0 && citations.noSources,
    hops,
    droppedCount: state.droppedCount,
    secretsLeftOut: state.secretsLeftOut,
    entriesLeftOut: state.navLeftOut.size,
    run,
  };
}

/**
 * One turn, start to finish. Never rejects: a cancelled or failed hop ends the
 * turn with an outcome, and what Activity recorded stays there.
 */
export async function runDocsTurn(deps: DocsLoopDeps, input: DocsTurnInput, events: DocsTurnEvents, signal: AbortSignal): Promise<DocsTurnOutcome> {
  try {
    return await runTurn(deps, input, events, signal);
  } catch (err) {
    const error = signal.aborted ? makeAiError('cancelled') : toAiError(err);
    return error.code === 'cancelled' ? { kind: 'cancelled' } : { kind: 'error', error };
  }
}

export interface DocsChat {
  /** A turn is in flight. */
  readonly busy: boolean;
  /** Start a turn; `{ kind: 'busy' }`, with nothing touched, while another is running. Abort `signal` to cancel the hops and the answer. */
  run(input: DocsTurnInput, events: DocsTurnEvents, signal: AbortSignal): Promise<DocsTurnOutcome>;
}

/** One per editor: one chat request in flight at a time (decision 13). */
export function createDocsChat(deps: DocsLoopDeps): DocsChat {
  let busy = false;
  return {
    get busy() { return busy; },
    async run(input, events, signal) {
      if (busy) {return { kind: 'busy' };}
      busy = true;
      try {
        return await runDocsTurn(deps, input, events, signal);
      } finally {
        busy = false;
      }
    },
  };
}
