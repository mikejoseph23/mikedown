/**
 * The AI chat panel: questions about this document or the documentation bases,
 * answered with citations. Docked inside the editor by `editor.ts`, so the
 * document stays visible and Insert has a cursor to go to. Loaded through
 * `ai-ui.ts` only, never from the editor's main path.
 *
 * Everything from the model, and every base name, path and heading, goes in as
 * text: through `renderPreviewMarkdown` (no href, no src) or `textContent`. A
 * chip is built from a number the turn actually sent, so model text can never
 * name a target. `[n]` in a code span is not a chip (`parseCitations` parts).
 *
 * History lives in this mount: closing the panel clears it and aborts what is in
 * flight. A question that looks like it holds a key is not kept in history.
 *
 * Nothing here touches the editor document or its DOM; Insert goes through
 * `insertAtCursor`, which the editor implements with a transaction.
 */

import {
  ANSWERED_WITHOUT_SOURCES, NO_SOURCES_CITED, aiErrorCopy, docsActiveBases, docsCitationLabel, docsDocumentLocation, docsFileHref,
  docsSectionFile, docsSectionSlug, parseCitations, prepareInsertMarkdown, rewriteVisibleText, toAiError,
} from './ai';
import type {
  AiDocBaseStatus, AiDocsOptions, AiError, AiRouteOk, DocsChat, DocsSentSection, DocsTurnAnswer, DocsTurnInput, DocsTurnOutcome, DocsTurnProgress,
  MikeDownDocsHost,
} from './ai';
import { renderPreviewMarkdown } from './ai-markdown-preview';
import { ICONS, button, el, experimentalBadge, nextId, note } from './ai-settings-dom';

export type AiChatScope = 'document' | 'bases';

export interface AiChatPanelOptions {
  /** The editor's one chat (`createAiDocsChat`): it holds the one-request-in-flight rule. */
  chat: DocsChat;
  /** Absent: the scope picker is not shown and the scope is This document. */
  docs?: MikeDownDocsHost;
  /** The live text, source mode included. */
  documentText(): string;
  docsOptions?(): Partial<AiDocsOptions>;
  thinking?: DocsTurnInput['thinking'];
  /** An engine's display name. */
  engineName?(engineId: string): string;
  /** The notice while the chat feature is switched off (`aiFeatureOffNotice`), else null. */
  featureOffNotice(): string | null;
  /** False: no Insert (read-only). */
  canInsert(): boolean;
  /** Put markdown at the cursor as one undo step, or return false. */
  insertAtCursor(markdown: string): boolean;
  /** The current document's absolute folder, null when it has none. */
  documentFolder?(): string | null;
  /** Open a base file. Absent: chips only show. */
  openFile?(href: string, reveal?: { section: string }): void;
  /** Whether AI Activity is recording. */
  activityOn?(): boolean;
  openActivity?(requestId: string): void;
  /** The engines page on routing. Absent (a host that routes by itself): that action is not offered. */
  openRouting?(): void;
  /** The engines page on Documentation bases. */
  openBases?(): void;
  /** The host's save dialog and write. Absent: no Save. */
  saveTextFile?(name: string, text: string): Promise<void>;
  /** Esc with nothing in flight: back to the document. */
  onEscape?(): void;
  /** The close button. The host calls `destroy`. */
  onClose(): void;
}

export interface AiChatPanelHandle {
  /** Abort anything in flight, clear the history, leave the container empty. */
  destroy(): void;
  focus(): void;
  /** Settings or bases may have changed: read them again. */
  refresh(): void;
}

export const AI_CHAT_SECRET_NOTICE = 'Your question looks like it holds a key, so nothing was sent. Take the key out and ask again.';
export const AI_CHAT_BUSY_NOTICE = 'The last request is still finishing. Try again in a moment.';
export const AI_CHAT_NO_BASES = 'No documentation base is active. Turn one on or add one, or ask about this document instead.';

const STREAM_THROTTLE_MS = 80;
const CONFIRM_MS = 1600;
/** Marks a chip's place in the markdown handed to the preview. Private use, stripped from model text first. */
const CHIP_OPEN = '';
const CHIP_CLOSE = '';
const CHIP_RE = /(\d+)/;

const ICON_SEND = svgIcon('<path d="M8 13V3M3.5 7.5L8 3l4.5 4.5"/>');
const ICON_STOP = svgIcon('<rect x="4" y="4" width="8" height="8" rx="1.5"/>');
const ICON_COPY = svgIcon('<rect x="5.5" y="5.5" width="8" height="8" rx="1.5"/><path d="M10.5 5.5v-2a1 1 0 0 0-1-1h-6a1 1 0 0 0-1 1v6a1 1 0 0 0 1 1h2"/>');
const ICON_SAVE = svgIcon('<path d="M8 2.5v8M4.5 7.5L8 11l3.5-3.5M3 13.5h10"/>');

function svgIcon(body: string): string {
  return `<svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;
}

const plural = (n: number, word: string): string => `${n} ${word}${n === 1 ? '' : 's'}`;

/** The line under a question while it runs: "Reading 2 pages... hop 2 of 3". */
export function chatProgressLine(progress: DocsTurnProgress, scope: AiChatScope): string {
  const hop = progress.hop !== undefined ? ` hop ${progress.hop} of ${progress.maxHops}` : '';
  switch (progress.phase) {
    case 'navigate':
      return progress.pages > 0
        ? `Reading ${plural(progress.pages, 'page')}...${hop}`
        : `Looking through the ${scope === 'document' ? 'outline' : 'index'}...${hop}`;
    case 'keyword':
      return 'Searching for matching sections...';
    case 'answer':
      return progress.pages > 0 ? `Answering from ${plural(progress.pages, 'section')}...` : 'Answering...';
  }
}

/** "Base X is local-only", or the same for several. */
export function chatLocalOnlyTitle(bases: ReadonlyArray<{ name: string }>): string {
  const names = bases.map((b) => b.name);
  if (names.length === 1) {return `Base ${names[0]} is local-only`;}
  return `Bases ${names.slice(0, -1).join(', ')} and ${names[names.length - 1]} are local-only`;
}

// ── Plain-text export ───────────────────────────────────────────────────────

/** A finished turn as the export sees it. */
export interface AiChatExportTurn {
  startedAt: number;
  scope: AiChatScope;
  status: string;
  /** Null: not kept (it looked like it held a key). */
  question: string | null;
  answer?: string;
  /** Lines under the answer. */
  notes?: readonly string[];
  /** `[n] file › heading`. */
  sources?: readonly string[];
  engine?: string;
  isLocal?: boolean;
}

const pad = (n: number): string => String(n).padStart(2, '0');

/** `mikedown-ai-chat-<yyyymmdd-hhmm>.txt`, in local time. */
export function chatExportFileName(now: Date = new Date()): string {
  const day = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}`;
  return `mikedown-ai-chat-${day}-${pad(now.getHours())}${pad(now.getMinutes())}.txt`;
}

/** Copy and Save, in the Activity export's shape: a header per turn, then the text verbatim. Times are UTC. */
export function formatChatExport(turns: readonly AiChatExportTurn[]): string {
  if (turns.length === 0) {return '';}
  const blocks = turns.map((turn, i) => {
    const head = [
      `=== Turn ${i + 1} of ${turns.length} ===`,
      `Time: ${new Date(turn.startedAt).toISOString()}`,
      `Scope: ${turn.scope === 'bases' ? 'Active bases' : 'This document'}`,
      `Status: ${turn.status}`,
      ...(turn.engine ? [`Engine: ${turn.engine}${turn.isLocal === undefined ? '' : turn.isLocal ? ' (local)' : ' (cloud)'}`] : []),
    ].join('\n');
    return [
      head,
      '--- Question ---',
      turn.question ?? '(not kept: it looked like it held a key)',
      ...(turn.answer !== undefined ? ['--- Answer ---', turn.answer] : []),
      ...(turn.notes && turn.notes.length > 0 ? ['--- Notes ---', turn.notes.join('\n')] : []),
      ...(turn.sources && turn.sources.length > 0 ? ['--- Sources ---', turn.sources.join('\n')] : []),
    ].join('\n\n');
  });
  return `${blocks.join('\n\n')}\n`;
}

// ── The panel ───────────────────────────────────────────────────────────────

interface Turn {
  scope: AiChatScope;
  startedAt: number;
  question: string | null;
  running: boolean;
  /** The text so far while it streams, kept if it is cancelled. */
  partial: string;
  progress: string;
  route: AiRouteOk | null;
  outcome: DocsTurnOutcome | null;
  node: HTMLElement;
  body: HTMLElement;
  /** The answer's element while it streams. */
  live: HTMLElement | null;
  chips: Array<{ node: HTMLElement; sent: DocsSentSection }>;
}

type EngineName = (engineId: string) => string;

function errorText(error: AiError, route: AiRouteOk | null, engineName: EngineName): string {
  if (error.code === 'unknown' && error.message) {return error.message;}
  return aiErrorCopy(error.code, route ? { engine: engineName(route.engineId), model: route.modelId } : {}).message;
}

/** The lines under an answer. */
function answerNotes(turn: Turn, answer: DocsTurnAnswer): string[] {
  const notes: string[] = [];
  if (answer.coverage) {notes.push(answer.coverage);}
  if (answer.withoutSources && !answer.coverage.includes(ANSWERED_WITHOUT_SOURCES)) {notes.push(ANSWERED_WITHOUT_SOURCES);}
  // This document answers have no citations, so there is nothing to miss.
  if (answer.noSources && turn.scope === 'bases') {notes.push(NO_SOURCES_CITED);}
  return notes;
}

/** The answer as parts: This document answers show no citation markers. */
function answerParts(turn: Turn, answer: DocsTurnAnswer): ReturnType<typeof parseCitations>['parts'] {
  return turn.scope === 'bases' ? answer.citations.parts : parseCitations(answer.answer, []).parts;
}

function exportTurn(turn: Turn, engineName: EngineName): AiChatExportTurn {
  const base = { startedAt: turn.startedAt, scope: turn.scope, question: turn.question };
  const route = turn.route ? { engine: `${engineName(turn.route.engineId)} · ${turn.route.modelId}`, isLocal: turn.route.isLocal } : {};
  const outcome = turn.outcome;
  if (!outcome) {return { ...base, ...route, status: 'running', ...(turn.partial ? { answer: turn.partial } : {}) };}
  switch (outcome.kind) {
    case 'answered':
      return {
        ...base,
        ...route,
        status: 'answered',
        answer: answerParts(turn, outcome).map((p) => (p.type === 'text' ? p.text : `[${p.ns.join(', ')}]`)).join(''),
        notes: answerNotes(turn, outcome),
        sources: turn.scope === 'bases'
          ? outcome.sent.filter((s) => outcome.citations.cited.includes(s.n)).map((s) => `[${s.n}] ${docsCitationLabel(s.section)}`)
          : [],
      };
    case 'cancelled':
      return { ...base, ...route, status: 'cancelled', ...(turn.partial ? { answer: turn.partial } : {}) };
    case 'error':
      return { ...base, ...route, status: 'failed', notes: [errorText(outcome.error, turn.route, engineName)] };
    case 'baseLocalOnly':
      return { ...base, status: 'not sent', notes: [chatLocalOnlyTitle(outcome.bases)] };
    case 'noActiveBases':
      return { ...base, status: 'not sent', notes: [AI_CHAT_NO_BASES] };
    case 'questionHasSecret':
      return { ...base, status: 'not sent', notes: [AI_CHAT_SECRET_NOTICE] };
    case 'busy':
      return { ...base, status: 'not sent', notes: [AI_CHAT_BUSY_NOTICE] };
  }
}

/** A quiet confirmation beside some buttons, read out when it changes. */
function inlineStatus(): { element: HTMLElement; show(text: string, level?: 'ok' | 'error'): void; dispose(): void } {
  const element = el('span', 'ai-chat-status');
  element.setAttribute('role', 'status');
  let timer: number | undefined;
  return {
    element,
    show(text, level = 'ok') {
      window.clearTimeout(timer);
      element.textContent = text;
      element.dataset.level = level;
      timer = window.setTimeout(() => { element.textContent = ''; }, level === 'ok' ? CONFIRM_MS : CONFIRM_MS * 3);
    },
    dispose() { window.clearTimeout(timer); },
  };
}

export function mountAiChatPanel(container: HTMLElement, opts: AiChatPanelOptions): AiChatPanelHandle {
  const engineName: EngineName = (id) => opts.engineName?.(id) ?? id;
  const turns: Turn[] = [];
  let statuses: AiDocBaseStatus[] = [];
  let scope: AiChatScope = 'document';
  /** Once the user has chosen, a late base list does not change it. */
  let scopeChosen = false;
  let current: Turn | null = null;
  let controller: AbortController | null = null;
  let destroyed = false;
  let streamTimer: number | undefined;
  const statusDisposers = new Set<() => void>();

  const makeStatus = (): ReturnType<typeof inlineStatus> => {
    const status = inlineStatus();
    statusDisposers.add(() => status.dispose());
    return status;
  };

  // ── Shell ─────────────────────────────────────────────────────────────────

  const root = el('section', 'ai-chat');
  const titleId = nextId('ai-chat-title');
  root.setAttribute('aria-labelledby', titleId);

  const header = el('div', 'ai-chat-header');
  const title = el('h2', 'ai-chat-title', 'Chat');
  title.id = titleId;
  const headerStatus = makeStatus();
  const copyAllBtn = button('ai-chat-icon', '', { html: ICON_COPY, ariaLabel: 'Copy conversation', title: 'Copy conversation', fk: 'chat:copy-all' });
  const saveBtn = button('ai-chat-icon', '', { html: ICON_SAVE, ariaLabel: 'Save conversation', title: 'Save conversation', fk: 'chat:save' });
  const closeBtn = button('ai-chat-icon', '', { html: ICONS.close, ariaLabel: 'Close chat (clears this conversation)', title: 'Close (clears this conversation)', fk: 'chat:close' });
  header.append(title, experimentalBadge(), el('span', 'ai-chat-spacer'), headerStatus.element, copyAllBtn, ...(opts.saveTextFile ? [saveBtn] : []), closeBtn);

  const log = el('div', 'ai-chat-log');
  log.setAttribute('role', 'log');
  log.setAttribute('aria-live', 'polite');
  log.tabIndex = 0;
  log.setAttribute('aria-label', 'Conversation');

  const empty = el('div', 'ai-chat-empty');
  const emptyTitle = el('div', 'ai-chat-empty-title');
  const emptyText = el('p', 'ai-chat-empty-text');
  empty.append(emptyTitle, emptyText);
  log.append(empty);

  const composer = el('div', 'ai-chat-composer');
  const offNote = el('div', 'ai-chat-off');
  const picker = el('div', 'ai-chat-scope');
  picker.setAttribute('role', 'radiogroup');
  picker.setAttribute('aria-label', 'What to ask about');
  const radioName = nextId('ai-chat-scope');
  const radios = new Map<AiChatScope, HTMLInputElement>();
  for (const [value, label] of [['document', 'This document'], ['bases', 'Active bases']] as const) {
    const option = el('label', 'ai-chat-seg');
    const radio = el('input');
    radio.type = 'radio';
    radio.name = radioName;
    radio.value = value;
    radio.addEventListener('change', () => {
      if (!radio.checked) {return;}
      scopeChosen = true;
      setScope(value);
    });
    radios.set(value, radio);
    option.append(radio, el('span', '', label));
    picker.append(option);
  }
  picker.hidden = !opts.docs;
  const basesLine = el('div', 'ai-chat-bases');
  const box = el('div', 'ai-chat-box');
  const input = el('textarea', 'ai-chat-input');
  input.rows = 1;
  input.setAttribute('aria-label', 'Your question');
  const sendBtn = button('ai-chat-send', '', { html: ICON_SEND, ariaLabel: 'Send', title: 'Send (Enter)', fk: 'chat:send' });
  const cancelBtn = button('ai-chat-send ai-chat-send--cancel', '', { html: ICON_STOP, ariaLabel: 'Cancel', title: 'Cancel (Esc)', fk: 'chat:cancel' });
  cancelBtn.hidden = true;
  box.append(input, sendBtn, cancelBtn);
  composer.append(offNote, picker, basesLine, box);
  root.append(header, log, composer);

  // ── Scope and availability ────────────────────────────────────────────────

  function activeBases(): AiDocBaseStatus[] {
    return docsActiveBases(statuses);
  }

  function setScope(next: AiChatScope): void {
    scope = next;
    const radio = radios.get(next);
    if (radio) {radio.checked = true;}
    renderComposerState();
  }

  function renderBasesLine(): void {
    basesLine.replaceChildren();
    basesLine.hidden = scope !== 'bases';
    if (scope !== 'bases') {return;}
    const active = activeBases();
    if (active.length > 0) {
      basesLine.textContent = active.map((s) => s.base.name).join(', ');
      basesLine.title = basesLine.textContent;
      return;
    }
    basesLine.title = '';
    basesLine.append(el('span', '', 'No base is active. '));
    if (opts.openBases) {
      const manage = button('ai-chat-link', 'Manage bases…', { fk: 'chat:manage-bases' });
      manage.addEventListener('click', () => opts.openBases?.());
      basesLine.append(manage);
    }
  }

  function renderComposerState(): void {
    const off = opts.featureOffNotice();
    offNote.replaceChildren();
    offNote.hidden = !off;
    if (off) {offNote.append(note('info', off));}
    picker.hidden = !opts.docs || !!off;
    renderBasesLine();
    if (off) {basesLine.hidden = true;}
    const busy = current !== null;
    input.disabled = !!off;
    input.placeholder = off ? '' : scope === 'bases' ? 'Ask your documentation…' : 'Ask about this document…';
    sendBtn.hidden = busy;
    cancelBtn.hidden = !busy;
    sendBtn.disabled = !!off || input.value.trim() === '';
    for (const radio of radios.values()) {radio.disabled = busy;}
    emptyTitle.textContent = scope === 'bases' ? 'Ask your documentation' : 'Ask about this document';
    emptyText.textContent = scope === 'bases'
      ? 'Answers come from the active bases, with citations you can open.'
      : 'Answers come from the text in this editor, as it is right now.';
    empty.hidden = turns.length > 0;
    copyAllBtn.hidden = turns.length === 0;
    saveBtn.hidden = turns.length === 0;
  }

  async function loadStatuses(): Promise<void> {
    if (!opts.docs) {return;}
    try {
      statuses = await opts.docs.listBases();
    } catch {
      statuses = [];
    }
    if (destroyed) {return;}
    // Defaults to This document when no base is active.
    if (!scopeChosen && current === null) {setScope(activeBases().length > 0 ? 'bases' : 'document');}
    for (const turn of turns) {updateChipTitles(turn);}
    renderComposerState();
  }

  // ── Rendering a turn ──────────────────────────────────────────────────────

  function nearBottom(): boolean {
    return log.scrollHeight - log.scrollTop - log.clientHeight < 48;
  }

  function scrollDown(was: boolean): void {
    if (was) {log.scrollTop = log.scrollHeight;}
  }

  function chipTitle(sent: DocsSentSection): string {
    const file = docsSectionFile(sent.section, sent.baseId, statuses);
    if (!file) {return sent.section.relPath;}
    return `${file.baseName}: ${file.root.replace(/[\\/]+$/, '')}/${file.relPath}`;
  }

  function updateChipTitles(turn: Turn): void {
    for (const { node, sent } of turn.chips) {node.title = chipTitle(sent);}
  }

  function makeChip(turn: Turn, sent: DocsSentSection, status: ReturnType<typeof inlineStatus>): HTMLElement {
    const label = docsCitationLabel(sent.section);
    const content = [el('span', 'ai-chat-chip-n', String(sent.n)), el('span', 'ai-chat-chip-label', label)];
    let node: HTMLElement;
    if (opts.openFile) {
      node = button('ai-chat-chip', '', {});
      node.setAttribute('aria-label', `Open source ${sent.n}: ${label}`);
      node.addEventListener('click', () => { void openCitation(sent, status); });
    } else {
      node = el('span', 'ai-chat-chip');
    }
    node.append(...content);
    node.title = chipTitle(sent);
    turn.chips.push({ node, sent });
    return node;
  }

  async function openCitation(sent: DocsSentSection, status: ReturnType<typeof inlineStatus>): Promise<void> {
    let file = docsSectionFile(sent.section, sent.baseId, statuses);
    if (!file) {
      await loadStatuses();
      if (destroyed) {return;}
      file = docsSectionFile(sent.section, sent.baseId, statuses);
    }
    if (!file || !opts.openFile) {
      status.show(`Could not open ${sent.section.relPath}: its base is no longer set up.`, 'error');
      return;
    }
    const slug = docsSectionSlug(sent.section);
    opts.openFile(docsFileHref(file.root, file.relPath), slug ? { section: slug } : undefined);
  }

  /** The answer through the preview, with each citation's place swapped for a chip. */
  function renderAnswerInto(into: HTMLElement, turn: Turn, answer: DocsTurnAnswer, status: ReturnType<typeof inlineStatus>): void {
    const bySent = new Map(answer.sent.map((s) => [s.n, s]));
    const marks: DocsSentSection[] = [];
    let markdown = '';
    for (const part of answerParts(turn, answer)) {
      if (part.type === 'text') {
        markdown += part.text.replace(/[]/g, '');
        continue;
      }
      part.ns.forEach((n) => {
        const sent = bySent.get(n);
        if (!sent) {return;}
        markdown += `${CHIP_OPEN}${marks.length}${CHIP_CLOSE}`;
        marks.push(sent);
      });
    }
    renderPreviewMarkdown(into, markdown.trim());
    const walker = document.createTreeWalker(into, NodeFilter.SHOW_TEXT);
    const texts: Text[] = [];
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      if (CHIP_RE.test((node as Text).data)) {texts.push(node as Text);}
    }
    for (const text of texts) {
      const pieces = text.data.split(CHIP_RE);
      const out: Node[] = [];
      pieces.forEach((piece, i) => {
        if (i % 2 === 1) {out.push(makeChip(turn, marks[Number(piece)], status));}
        else if (piece) {out.push(document.createTextNode(piece));}
      });
      text.replaceWith(...out);
    }
  }

  function renderNotice(body: HTMLElement, level: 'warning' | 'info' | 'error', text: string, actions: Array<{ label: string; fk: string; run(): void }> = [], titleText?: string): void {
    const card = el('div', 'ai-chat-notice');
    if (titleText) {card.append(el('div', 'ai-chat-notice-title', titleText));}
    card.append(note(level, text));
    if (actions.length > 0) {
      const row = el('div', 'ai-chat-actions');
      for (const action of actions) {
        const b = button('ai-chat-action', action.label, { fk: action.fk });
        b.addEventListener('click', () => action.run());
        row.append(b);
      }
      card.append(row);
    }
    body.append(card);
  }

  function renderAnswered(turn: Turn, answer: DocsTurnAnswer): void {
    const { body } = turn;
    const status = makeStatus();
    const text = el('div', 'ai-chat-answer ai-rw-out');
    renderAnswerInto(text, turn, answer, status);
    body.append(text);
    const notes = answerNotes(turn, answer);
    if (notes.length > 0) {
      const box2 = el('div', 'ai-chat-notes');
      for (const line of notes) {box2.append(el('div', 'ai-chat-note', line));}
      body.append(box2);
    }
    const row = el('div', 'ai-chat-actions');
    if (opts.canInsert()) {
      const insert = button('ai-chat-action', 'Insert at cursor', { fk: 'chat:insert' });
      insert.addEventListener('click', () => {
        const sources = turn.scope === 'bases' ? answer.sent : [];
        const location = docsDocumentLocation(opts.documentFolder?.() ?? null, statuses, answer.sent.map((s) => s.baseId));
        const { markdown } = prepareInsertMarkdown(answer.answer, sources, location);
        if (opts.insertAtCursor(markdown)) {status.show('Inserted');}
        else {status.show('Could not insert here.', 'error');}
      });
      row.append(insert);
    }
    const copy = button('ai-chat-action', 'Copy', { fk: 'chat:copy' });
    copy.addEventListener('click', () => {
      const one = exportTurn(turn, engineName);
      const sources = one.sources && one.sources.length > 0 ? `\n\n${one.sources.join('\n')}` : '';
      void copyText(`${one.answer ?? ''}${sources}`, status);
    });
    row.append(copy);
    const requestId = answer.run.requestId;
    if (requestId && opts.openActivity && opts.activityOn?.()) {
      const activity = button('ai-chat-link', 'Activity', { fk: 'chat:activity', title: 'View this request in AI Activity' });
      activity.addEventListener('click', () => opts.openActivity?.(requestId));
      row.append(activity);
    }
    row.append(status.element, el('span', 'ai-chat-spacer'));
    if (turn.route) {
      const pill = el('span', 'ai-chat-route');
      pill.title = `${engineName(turn.route.engineId)} · ${turn.route.modelId}${turn.route.isLocal ? ' (local)' : ' (cloud)'}`;
      const icon = el('span', 'ai-chat-route-icon');
      icon.innerHTML = turn.route.isLocal ? ICONS.local : ICONS.cloud;
      pill.append(icon, el('span', 'ai-chat-route-name', turn.route.modelId));
      row.append(pill);
    }
    body.append(row);
  }

  function renderBody(turn: Turn): void {
    const { body } = turn;
    body.replaceChildren();
    turn.chips = [];
    turn.live = null;
    if (turn.question === null) {turn.node.querySelector('.ai-chat-question')?.remove();}
    if (turn.running) {
      if (turn.partial) {
        turn.live = el('div', 'ai-chat-answer ai-rw-out');
        renderPreviewMarkdown(turn.live, turn.partial);
        body.append(turn.live);
      }
      const line = el('div', 'ai-chat-progress');
      line.append(el('span', 'ai-chat-dot'), el('span', '', turn.progress));
      body.append(line);
      return;
    }
    const outcome = turn.outcome;
    if (!outcome) {return;}
    switch (outcome.kind) {
      case 'answered':
        renderAnswered(turn, outcome);
        return;
      case 'baseLocalOnly': {
        const onCloud = outcome.route ? `${engineName(outcome.route.engineId)} is a cloud engine, so` : 'This route may not stay on this machine, so';
        const actions = [
          ...(opts.openRouting ? [{ label: 'Pick a local engine', fk: 'chat:pick-local', run: () => opts.openRouting?.() }] : []),
          ...(opts.openBases ? [{ label: "Open the base's switch", fk: 'chat:base-switch', run: () => opts.openBases?.() }] : []),
        ];
        renderNotice(body, 'warning', `${onCloud} nothing was sent.`, actions, chatLocalOnlyTitle(outcome.bases));
        return;
      }
      case 'noActiveBases':
        renderNotice(body, 'info', AI_CHAT_NO_BASES, opts.openBases ? [{ label: 'Manage bases…', fk: 'chat:manage-bases', run: () => opts.openBases?.() }] : []);
        return;
      case 'questionHasSecret':
        renderNotice(body, 'warning', AI_CHAT_SECRET_NOTICE);
        return;
      case 'busy':
        renderNotice(body, 'info', AI_CHAT_BUSY_NOTICE);
        return;
      case 'cancelled':
        if (turn.partial) {
          const text = el('div', 'ai-chat-answer ai-rw-out is-cancelled');
          renderPreviewMarkdown(text, turn.partial);
          body.append(text);
        }
        body.append(el('div', 'ai-chat-note', 'Cancelled'));
        return;
      case 'error': {
        const actions = opts.openRouting ? [{ label: 'Open engines', fk: 'chat:engines', run: () => opts.openRouting?.() }] : [];
        renderNotice(body, 'error', errorText(outcome.error, turn.route, engineName), actions);
        return;
      }
    }
  }

  // ── A turn ────────────────────────────────────────────────────────────────

  function addTurn(question: string): Turn {
    const node = el('article', 'ai-chat-turn');
    const body = el('div', 'ai-chat-reply');
    node.append(el('div', 'ai-chat-question', question), body);
    const turn: Turn = {
      scope,
      startedAt: Date.now(),
      question,
      running: true,
      partial: '',
      progress: 'Starting...',
      route: null,
      outcome: null,
      node,
      body,
      live: null,
      chips: [],
    };
    turns.push(turn);
    log.append(node);
    renderBody(turn);
    return turn;
  }

  function flushStream(turn: Turn): void {
    window.clearTimeout(streamTimer);
    streamTimer = undefined;
    if (!turn.running || turn !== current) {return;}
    const was = nearBottom();
    if (turn.live) {renderPreviewMarkdown(turn.live, turn.partial);}
    else {renderBody(turn);}
    scrollDown(was);
  }

  function finish(turn: Turn, outcome: DocsTurnOutcome): void {
    window.clearTimeout(streamTimer);
    streamTimer = undefined;
    const was = nearBottom();
    turn.running = false;
    turn.outcome = outcome;
    // Don't keep a key in history, or put it in an export. The text goes back in the box to fix.
    if (outcome.kind === 'questionHasSecret') {
      if (input.value === '' && turn.question) {input.value = turn.question;}
      turn.question = null;
    }
    if (outcome.kind === 'busy' && input.value === '' && turn.question) {input.value = turn.question;}
    if (outcome.kind === 'answered') {
      turn.route = outcome.run.route ?? turn.route;
      turn.node.classList.add('ai-chat-turn--arrived');
    }
    renderBody(turn);
    updateChipTitles(turn);
    current = null;
    controller = null;
    if (outcome.kind === 'noActiveBases') {void loadStatuses();}
    // Cancel is about to hide: keep the keyboard in the panel.
    if (document.activeElement === cancelBtn) {input.focus();}
    renderComposerState();
    resizeInput();
    scrollDown(was);
  }

  function send(): void {
    const question = input.value.trim();
    if (question === '' || current !== null || opts.featureOffNotice()) {return;}
    const useBases = scope === 'bases' && !!opts.docs;
    const turn = addTurn(question);
    current = turn;
    input.value = '';
    resizeInput();
    const abort = new AbortController();
    controller = abort;
    renderComposerState();
    log.scrollTop = log.scrollHeight;
    if (useBases) {void loadStatuses();}

    const options = opts.docsOptions?.();
    const docs = opts.docs;
    const request: DocsTurnInput = {
      question,
      scope: useBases && docs
        ? { kind: 'bases', docs, ...(options ? { options } : {}) }
        : { kind: 'document', text: opts.documentText(), ...(options ? { options } : {}) },
      ...(opts.thinking !== undefined ? { thinking: opts.thinking } : {}),
    };
    const live = (): boolean => !destroyed && current === turn;
    opts.chat.run(request, {
      onRoute(route) {
        if (live()) {turn.route = route;}
      },
      onProgress(progress) {
        if (!live()) {return;}
        turn.progress = chatProgressLine(progress, turn.scope);
        const was = nearBottom();
        renderBody(turn);
        scrollDown(was);
      },
      onToken(_delta, text) {
        if (!live()) {return;}
        turn.partial = rewriteVisibleText(text).trimStart();
        if (streamTimer === undefined) {
          streamTimer = window.setTimeout(() => flushStream(turn), STREAM_THROTTLE_MS);
        }
      },
    }, abort.signal).then(
      (outcome) => { if (live()) {finish(turn, outcome);} },
      (err: unknown) => { if (live()) {finish(turn, { kind: 'error', error: toAiError(err) });} },
    );
  }

  /** Back to idle at once; a late result for this turn is ignored. Earlier history stays. */
  function cancel(): void {
    if (!current) {return;}
    controller?.abort();
    finish(current, { kind: 'cancelled' });
  }

  // ── Copy and Save ─────────────────────────────────────────────────────────

  async function copyText(text: string, status: ReturnType<typeof inlineStatus>): Promise<void> {
    try {
      await navigator.clipboard.writeText(text);
      status.show('Copied');
    } catch {
      status.show('Could not copy.', 'error');
    }
  }

  const exportAll = (): string => formatChatExport(turns.map((turn) => exportTurn(turn, engineName)));

  copyAllBtn.addEventListener('click', () => { void copyText(exportAll(), headerStatus); });
  saveBtn.addEventListener('click', () => {
    Promise.resolve(opts.saveTextFile?.(chatExportFileName(), exportAll())).catch(() => {
      if (!destroyed) {headerStatus.show('Could not save.', 'error');}
    });
  });

  // ── Input ─────────────────────────────────────────────────────────────────

  function resizeInput(): void {
    input.style.height = 'auto';
    if (input.scrollHeight > 0) {input.style.height = `${input.scrollHeight}px`;}
  }

  input.addEventListener('input', () => {
    resizeInput();
    sendBtn.disabled = !!opts.featureOffNotice() || input.value.trim() === '';
  });
  input.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter' || e.shiftKey || e.isComposing) {return;}
    e.preventDefault();
    send();
  });
  sendBtn.addEventListener('click', () => send());
  cancelBtn.addEventListener('click', () => cancel());
  closeBtn.addEventListener('click', () => opts.onClose());
  root.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') {return;}
    e.stopPropagation();
    if (current) {cancel();}
    else {opts.onEscape?.();}
  });

  container.append(root);
  setScope('document');
  void loadStatuses();

  return {
    destroy() {
      if (destroyed) {return;}
      destroyed = true;
      controller?.abort();
      controller = null;
      current = null;
      window.clearTimeout(streamTimer);
      for (const dispose of statusDisposers) {dispose();}
      statusDisposers.clear();
      turns.length = 0;
      container.replaceChildren();
    },
    focus() {
      if (input.disabled) {closeBtn.focus();}
      else {input.focus();}
    },
    refresh() {
      if (destroyed) {return;}
      void loadStatuses();
      for (const turn of turns) {
        if (!turn.running) {renderBody(turn);}
      }
      renderComposerState();
    },
  };
}
