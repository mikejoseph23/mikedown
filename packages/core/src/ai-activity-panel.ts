/**
 * The AI Activity panel: every AI request this editor made, with the exact
 * messages sent and the raw response, from the in-memory `AiActivityLog`.
 * Mounted full-window by `editor.ts`, in the same shell as the AI Engines page.
 *
 * Left, the requests, newest first. Right, the selected request: route and
 * thinking, then collapsible Sent and Received. Copy and Save export plain
 * text (`formatActivityExport`). Save is the host's (`saveTextFile`); without
 * it the Save buttons are not there.
 *
 * The log fires on every streamed token, so list work is throttled and
 * incremental: rows update in place, new rows go on top, and the open
 * request's response only ever gets text appended. Scroll positions, text
 * selections and keyboard focus survive streaming.
 *
 * Message and response text goes in as text nodes, never as markup: a message
 * can contain anything. Modal UI only: nothing here touches the editor
 * document or its DOM.
 */

import { getAiFeature } from './ai';
import type { AiMessage } from './ai';
import { AI_ACTIVITY_LIMIT, aiActivityStatus } from './ai-activity';
import type { AiActivityEntry, AiActivityLog, AiActivityStatus } from './ai-activity';
import type { AiRunThinking } from './ai-request';
import { ICONS, button, el, experimentalBadge, nextId, note } from './ai-settings-dom';
import type { MikeDownSettingsSectionContext } from './types';

export interface AiActivityPanelOptions {
  /** The editor's one log (the same one `runAiCompletion` records into). */
  log: AiActivityLog;
  /** The host's save dialog and write. Absent: Save this request and Save all are not shown. */
  saveTextFile?(name: string, text: string): Promise<void>;
}

export interface AiActivityPanelHandle {
  /** Tear down (subscription, timers) and leave the container empty. */
  destroy(): void;
  /** Focus where a keyboard user should land: the selected request, else Back. */
  focus(): void;
  /** Render now, skipping the streaming throttle (the setting changed, or a test wants the DOM). */
  refresh(): void;
}

/** The one line under the header, always there. */
export const AI_ACTIVITY_BANNER = 'This record stays in memory: nothing here is stored or sent anywhere, and turning AI Activity off clears it.';

/** The empty state, while requests are recorded and there are none yet. */
export const AI_ACTIVITY_EMPTY = {
  title: 'No AI requests yet',
  text: 'Each request an AI feature makes from this window shows up here, with the exact messages sent and the raw response that came back.',
};

/** The empty state with the setting off. */
export const AI_ACTIVITY_OFF = {
  title: 'AI Activity is off',
  text: 'Requests are not recorded, and earlier ones were cleared. To record them, turn on AI Activity in the AI tab of Settings and save.',
};

/** Streaming tokens fire far more often than a person can read. */
const RENDER_THROTTLE_MS = 100;
/** How long "Copied" stays. */
const CONFIRM_MS = 1600;
/** Narrower than this and the panel is one column (the AI Engines page's width). */
const NARROW_PX = 720;

const STATUS_LABELS: Record<AiActivityStatus, string> = {
  streaming: 'Streaming',
  ok: 'OK',
  error: 'Failed',
  cancelled: 'Cancelled',
  fallback: 'Fallback',
};

// ── Text helpers ────────────────────────────────────────────────────────────

const pad = (n: number): string => String(n).padStart(2, '0');

/** `mikedown-ai-activity-<yyyymmdd-hhmm>.txt`, in local time. */
export function activityExportFileName(now: Date = new Date()): string {
  const day = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}`;
  return `mikedown-ai-activity-${day}-${pad(now.getHours())}${pad(now.getMinutes())}.txt`;
}

/** 24-hour local time: the column stays one width, like a log. */
function clockTime(ms: number): string {
  const d = new Date(ms);
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

function formatDuration(ms: number): string {
  if (ms < 1000) {return `${Math.round(ms)} ms`;}
  if (ms < 60_000) {return `${(ms / 1000).toFixed(1)} s`;}
  const seconds = Math.round(ms / 1000);
  return `${Math.floor(seconds / 60)} min ${seconds % 60} s`;
}

function entryDuration(entry: AiActivityEntry): number | null {
  return entry.endedAt === null ? null : entry.endedAt - entry.startedAt;
}

function featureLabel(entry: AiActivityEntry): string {
  return getAiFeature(entry.feature)?.label ?? entry.feature;
}

/** Where the request went: the route, or what a tier-1 host reported once it finished. */
function routeOf(entry: AiActivityEntry): { engine: string | null; model: string | null; isLocal: boolean | null } {
  if (entry.route) {return { engine: entry.route.label, model: entry.route.modelId, isLocal: entry.route.isLocal };}
  const served = entry.response.served;
  if (served) {return { engine: served.engineName, model: served.modelId, isLocal: served.isLocal };}
  return { engine: null, model: null, isLocal: null };
}

const NO_ROUTE_LABEL = 'Chosen by the app';

function routeLabel(entry: AiActivityEntry): string {
  const { engine, model } = routeOf(entry);
  if (!engine) {return NO_ROUTE_LABEL;}
  return model ? `${engine} · ${model}` : engine;
}

function tokensLabel(entry: AiActivityEntry): string {
  const { promptTokens, completionTokens } = entry.response.usage ?? {};
  const parts: string[] = [];
  if (promptTokens !== undefined) {parts.push(`${promptTokens} in`);}
  if (completionTokens !== undefined) {parts.push(`${completionTokens} out`);}
  return parts.join(' · ');
}

function thinkingLabel(thinking: AiRunThinking | null): string | null {
  if (!thinking) {return null;}
  const level = thinking.sent ?? thinking.configured;
  const name = level ? level.charAt(0).toUpperCase() + level.slice(1) : 'Model default';
  return thinking.auto ? `${name} (this task's default)` : name;
}

/** A message's text, verbatim. An image part is named, not embedded. */
function messageText(message: AiMessage): string {
  if (typeof message.content === 'string') {return message.content;}
  return message.content
    .map((part) => (part.type === 'text' ? part.text : `[image: ${part.mime}, ${part.bytes.length} bytes]`))
    .join('\n');
}

const plural = (n: number, word: string): string => `${n.toLocaleString()} ${word}${n === 1 ? '' : 's'}`;

// ── Plain-text export ───────────────────────────────────────────────────────

function exportEntry(entry: AiActivityEntry, index: number, total: number): string {
  const { request, response, error } = entry;
  const { engine, model, isLocal } = routeOf(entry);
  const duration = entryDuration(entry);
  const thinking = thinkingLabel(entry.thinking);
  const head: Array<[string, string | number | null | undefined]> = [
    ['Time', new Date(entry.startedAt).toISOString()],
    ['Feature', entry.feature],
    ['Task', entry.task],
    ['Status', aiActivityStatus(entry)],
    ['Engine', engine ? `${engine}${isLocal === null ? '' : isLocal ? ' (local)' : ' (cloud)'}` : 'chosen by the app'],
    ['Model', model],
    ['Via fallback', entry.route?.viaFallback ? 'yes' : null],
    ['Attempt', entry.attempt],
    ['Thinking', thinking],
    ['Duration', duration === null ? null : `${duration} ms`],
    ['Format', request.format],
    ['Max tokens', request.maxTokens],
    ['Temperature', request.temperature],
    ['Request overrides', request.requestOverrides ? JSON.stringify(request.requestOverrides) : null],
  ];
  const result: Array<[string, string | number | null | undefined]> = [
    ['Prompt tokens', response.usage?.promptTokens],
    ['Completion tokens', response.usage?.completionTokens],
    ['Finish reason', response.finishReason],
    ['Total time', response.timing ? `${response.timing.totalMs} ms` : null],
    ['First token', response.timing?.firstTokenMs !== undefined ? `${response.timing.firstTokenMs} ms` : null],
    ['Served by', response.served ? `${response.served.engineName} · ${response.served.modelId} (${response.served.isLocal ? 'local' : 'cloud'})` : null],
    ['Error', error ? `${error.code}: ${error.message}` : null],
    ['Retried', entry.retried ? 'yes, on another engine (the next request)' : null],
  ];
  const lines = (rows: typeof head): string[] => rows.filter(([, v]) => v !== null && v !== undefined).map(([k, v]) => `${k}: ${v}`);
  const metadata = lines(result);
  const blocks = [
    [`=== Request ${index + 1} of ${total} ===`, ...lines(head)].join('\n'),
    '--- Sent ---',
    ...request.messages.map((m) => `[${m.role}]\n${messageText(m)}`),
    '--- Received ---',
    response.text,
    ...(metadata.length > 0 ? [['--- Result ---', ...metadata].join('\n')] : []),
  ];
  return blocks.join('\n\n');
}

/**
 * The plain-text export used by Copy and both Saves: a header per request,
 * then the messages and the response verbatim. Deterministic: times are UTC
 * and nothing depends on when it runs.
 */
export function formatActivityExport(entries: readonly AiActivityEntry[]): string {
  if (entries.length === 0) {return '';}
  return `${entries.map((entry, i) => exportEntry(entry, i, entries.length)).join('\n\n')}\n`;
}

// ── DOM helpers ─────────────────────────────────────────────────────────────

function setText(node: Node, text: string): void {
  if (node.textContent !== text) {node.textContent = text;}
}

function setAttr(node: Element, name: string, value: string): void {
  if (node.getAttribute(name) !== value) {node.setAttribute(name, value);}
}

function localityPill(isLocal: boolean, extraClass = ''): HTMLElement {
  const pill = el('span', `ai-pill ai-pill--${isLocal ? 'local' : 'cloud'}${extraClass ? ` ${extraClass}` : ''}`);
  pill.innerHTML = isLocal ? ICONS.local : ICONS.cloud;
  pill.append(el('span', '', isLocal ? 'local' : 'cloud'));
  return pill;
}

function actionButton(action: string, label: string): HTMLButtonElement {
  const b = button('settings-btn ai-activity-action', label, { fk: `activity:${action}` });
  b.dataset.action = action;
  return b;
}

/** A label and value list (the footers under Sent and Received). */
function metaList(rows: ReadonlyArray<{ label: string; value: string; raw?: boolean }>): HTMLElement {
  const list = el('dl', 'ai-activity-meta');
  for (const row of rows) {
    const value = el('dd', row.raw ? 'is-raw' : '', row.value);
    value.dataset.meta = row.label;
    list.append(el('dt', '', row.label), value);
  }
  return list;
}

/** One quiet line beside some buttons: read out when it changes, gone after `ms`. */
function inlineStatus(): { element: HTMLElement; show(text: string, level: 'ok' | 'error', ms?: number): void; clear(): void } {
  const element = el('span', 'ai-activity-inline-status');
  element.setAttribute('role', 'status');
  let timer: number | undefined;
  const clear = (): void => {
    window.clearTimeout(timer);
    element.textContent = '';
    delete element.dataset.level;
  };
  return {
    element,
    clear,
    show(text, level, ms) {
      clear();
      element.textContent = text;
      element.dataset.level = level;
      if (ms) {timer = window.setTimeout(clear, ms);}
    },
  };
}

// ── The panel ───────────────────────────────────────────────────────────────

interface RowRefs {
  row: HTMLElement;
  dot: HTMLElement;
  feature: HTMLElement;
  statusWord: HTMLElement;
  time: HTMLElement;
  engine: HTMLElement;
  locality: HTMLElement;
  duration: HTMLElement;
  tokens: HTMLElement;
  /** The entry this row shows. Log entries are replaced on update, so identity tells a change. */
  entry: AiActivityEntry | null;
  shownLocal: boolean | null;
}

/** What changes in an open request, kept so streaming never rebuilds the pane. */
interface DetailRefs {
  entry: AiActivityEntry;
  status: HTMLElement;
  statusWord: HTMLElement;
  route: HTMLElement;
  notes: HTMLElement;
  receivedSummary: HTMLElement;
  receivedBlock: HTMLElement;
  receivedText: Text;
  receivedMeta: HTMLElement;
  copyStatus: ReturnType<typeof inlineStatus>;
}

type SectionKey = 'sent' | 'received';

export function mountAiActivityPanel(container: HTMLElement, ctx: MikeDownSettingsSectionContext, opts: AiActivityPanelOptions): AiActivityPanelHandle {
  const { log } = opts;
  const canSave = typeof opts.saveTextFile === 'function';

  let selectedId: string | null = null;
  let detail: DetailRefs | null = null;
  let mounted = false;
  let destroyed = false;
  let narrow = false;
  /** Narrow layout only: which pane shows. */
  let view: 'list' | 'detail' = 'list';
  let renderTimer: number | undefined;
  let lastRender = 0;
  let savingAll = false;
  /** Closed sections stay closed from request to request while the panel is open. */
  const collapsed: Record<SectionKey, boolean> = { sent: false, received: false };

  // ── Shell ─────────────────────────────────────────────────────────────────

  const root = el('div', 'ai-page ai-activity');
  // A click on plain text keeps focus here, so Escape still reaches the panel.
  root.tabIndex = -1;

  const header = el('div', 'ai-page-header');
  const backBtn = button('ai-page-back', 'Back', { html: ICONS.back, fk: 'activity:back' });
  backBtn.addEventListener('click', () => back());
  const title = el('h2', 'ai-page-title', 'AI Activity');
  title.id = nextId('ai-activity-title');
  const titleLine = el('div', 'ai-page-title-line');
  titleLine.append(title, experimentalBadge());
  const headerActions = el('div', 'ai-activity-header-actions');
  const headerStatus = inlineStatus();
  const saveAllBtn = actionButton('save-all', 'Save all');
  saveAllBtn.hidden = !canSave;
  saveAllBtn.addEventListener('click', () => { void saveAll(); });
  const clearBtn = actionButton('clear', 'Clear all');
  clearBtn.addEventListener('click', () => log.clear());
  headerActions.append(headerStatus.element, saveAllBtn, clearBtn);
  header.append(backBtn, titleLine, headerActions);

  const banner = el('p', 'ai-activity-banner', AI_ACTIVITY_BANNER);

  const body = el('div', 'ai-activity-body');
  const master = el('div', 'ai-activity-master');
  const listHead = el('div', 'ai-activity-list-head');
  const listId = nextId('ai-activity-list-label');
  const listLabel = el('span', 'ai-activity-list-label', 'Requests');
  listLabel.id = listId;
  const listCount = el('span', 'ai-activity-list-count');
  listHead.append(listLabel, listCount);
  const list = el('div', 'ai-activity-list');
  list.setAttribute('role', 'listbox');
  list.setAttribute('aria-labelledby', listId);
  master.append(listHead, list);
  const detailPane = el('section', 'ai-activity-detail');
  detailPane.tabIndex = 0;
  detailPane.setAttribute('aria-label', 'Selected request');
  body.append(master, detailPane);

  const empty = el('div', 'ai-activity-empty');
  const emptyTitle = el('div', 'ai-activity-empty-title');
  const emptyText = el('p', 'ai-activity-empty-text');
  empty.append(emptyTitle, emptyText);

  root.append(header, banner, body, empty);

  // ── List ──────────────────────────────────────────────────────────────────

  const rows = new Map<string, RowRefs>();

  function createRow(entry: AiActivityEntry): RowRefs {
    const row = el('div', 'ai-activity-row');
    row.setAttribute('role', 'option');
    row.dataset.entryId = entry.id;
    row.tabIndex = -1;
    const dot = el('span', 'ai-activity-dot');
    dot.setAttribute('aria-hidden', 'true');
    const head = el('span', 'ai-activity-row-head');
    const feature = el('span', 'ai-activity-row-feature');
    const statusWord = el('span', 'ai-activity-row-status');
    head.append(feature, statusWord);
    const when = el('span', 'ai-activity-row-when');
    const duration = el('span', 'ai-activity-row-duration');
    const time = el('span', 'ai-activity-row-time');
    when.append(duration, time);
    const sub = el('span', 'ai-activity-row-sub');
    const engine = el('span', 'ai-activity-row-engine');
    const locality = el('span', 'ai-activity-row-locality');
    sub.append(engine, locality);
    const tokens = el('span', 'ai-activity-row-tokens');
    row.append(dot, head, when, sub, tokens);
    const refs: RowRefs = { row, dot, feature, statusWord, time, engine, locality, duration, tokens, entry: null, shownLocal: null };
    updateRow(refs, entry);
    return refs;
  }

  function updateRow(refs: RowRefs, entry: AiActivityEntry): void {
    if (refs.entry === entry) {return;}
    refs.entry = entry;
    const status = aiActivityStatus(entry);
    const statusText = entry.retried ? 'Failed, retried' : STATUS_LABELS[status];
    const route = routeLabel(entry);
    const { isLocal } = routeOf(entry);
    const duration = entryDuration(entry);
    if (refs.row.dataset.status !== status) {refs.row.dataset.status = status;}
    setText(refs.feature, featureLabel(entry));
    // A row that went fine says nothing extra: the dot is enough.
    setText(refs.statusWord, status === 'ok' ? '' : statusText);
    setText(refs.time, clockTime(entry.startedAt));
    setText(refs.engine, route);
    setAttr(refs.engine, 'title', route);
    if (refs.shownLocal !== isLocal) {
      refs.shownLocal = isLocal;
      refs.locality.replaceChildren(...(isLocal === null ? [] : [localityPill(isLocal)]));
    }
    setText(refs.duration, duration === null ? '' : formatDuration(duration));
    setText(refs.tokens, tokensLabel(entry));
    setAttr(refs.row, 'aria-label', `${featureLabel(entry)}, ${statusText}, ${route}, ${clockTime(entry.startedAt)}`);
  }

  function renderList(entries: AiActivityEntry[]): void {
    const live = new Set(entries.map((e) => e.id));
    for (const [id, refs] of rows) {
      if (!live.has(id)) {
        refs.row.remove();
        rows.delete(id);
      }
    }
    // Newest first. New rows land on top: keep what the user is looking at
    // where it is (scroll anchoring is off in the CSS, and absent in WebKit).
    const before = list.scrollTop;
    const added: HTMLElement[] = [];
    let cursor = list.firstElementChild;
    for (let i = entries.length - 1; i >= 0; i--) {
      const entry = entries[i];
      let refs = rows.get(entry.id);
      if (!refs) {
        refs = createRow(entry);
        rows.set(entry.id, refs);
        list.insertBefore(refs.row, cursor);
        added.push(refs.row);
        continue;
      }
      updateRow(refs, entry);
      if (refs.row === cursor) {
        cursor = cursor.nextElementSibling;
      } else {
        list.insertBefore(refs.row, cursor);
      }
    }
    if (before > 0 && added.length > 0) {
      list.scrollTop = before + added.reduce((sum, row) => sum + row.offsetHeight, 0);
    }
    setText(listCount, entries.length === 0 ? '' : `${entries.length} of the last ${AI_ACTIVITY_LIMIT}`);
  }

  function markSelected(): void {
    for (const [id, refs] of rows) {
      const on = id === selectedId;
      setAttr(refs.row, 'aria-selected', String(on));
      refs.row.tabIndex = on ? 0 : -1;
    }
  }

  function selectedRow(): HTMLElement | null {
    return selectedId ? rows.get(selectedId)?.row ?? null : null;
  }

  function select(id: string, o: { focus?: boolean } = {}): void {
    flush();
    if (!log.get(id)) {return;}
    selectedId = id;
    markSelected();
    renderDetail(log.get(id) ?? null);
    const row = selectedRow();
    if (row) {
      row.scrollIntoView?.({ block: 'nearest' });
      if (o.focus) {row.focus({ preventScroll: true });}
    }
  }

  /** Enter or a click: show the request. One column switches to it; two columns move focus on Enter. */
  function openDetail(o: { focus: boolean }): void {
    if (!selectedId) {return;}
    if (narrow) {
      view = 'detail';
      applyLayout();
    }
    if (o.focus || narrow) {detailPane.focus({ preventScroll: true });}
  }

  list.addEventListener('click', (e) => {
    const row = (e.target as Element).closest<HTMLElement>('.ai-activity-row');
    const id = row?.dataset.entryId;
    if (!id) {return;}
    select(id, { focus: true });
    openDetail({ focus: false });
  });

  list.addEventListener('keydown', (e) => {
    if (e.altKey || e.ctrlKey || e.metaKey) {return;}
    const ids = Array.from(list.children, (n) => (n as HTMLElement).dataset.entryId ?? '');
    if (ids.length === 0) {return;}
    const at = selectedId ? ids.indexOf(selectedId) : -1;
    let next: string | undefined;
    if (e.key === 'ArrowDown') {next = ids[Math.min(at + 1, ids.length - 1)];}
    else if (e.key === 'ArrowUp') {next = ids[Math.max(at - 1, 0)];}
    else if (e.key === 'Home') {next = ids[0];}
    else if (e.key === 'End') {next = ids[ids.length - 1];}
    else if (e.key === 'Enter') {
      e.preventDefault();
      openDetail({ focus: true });
      return;
    } else {
      return;
    }
    e.preventDefault();
    if (next) {select(next, { focus: true });}
  });

  // ── Detail ────────────────────────────────────────────────────────────────

  function buildSection(key: SectionKey, label: string): { section: HTMLElement; summary: HTMLElement; content: HTMLElement } {
    const section = el('section', 'ai-activity-section');
    section.dataset.section = key;
    const head = el('div', 'ai-activity-section-head');
    const toggle = button('ai-disclosure ai-activity-section-toggle', label, { html: ICONS.chevron, fk: `activity:section:${key}` });
    const summary = el('span', 'ai-activity-section-summary');
    head.append(toggle, summary);
    const content = el('div', 'ai-activity-section-body');
    content.id = nextId(`ai-activity-${key}`);
    toggle.setAttribute('aria-controls', content.id);
    const apply = (): void => {
      content.hidden = collapsed[key];
      toggle.setAttribute('aria-expanded', String(!collapsed[key]));
    };
    apply();
    toggle.addEventListener('click', () => {
      collapsed[key] = !collapsed[key];
      apply();
    });
    section.append(head, content);
    return { section, summary, content };
  }

  function renderRoute(node: HTMLElement, entry: AiActivityEntry): void {
    const { engine, model, isLocal } = routeOf(entry);
    const parts: HTMLElement[] = [el('span', 'ai-activity-route-engine', engine ?? NO_ROUTE_LABEL)];
    if (model) {parts.push(el('span', 'ai-activity-route-model', model));}
    if (isLocal !== null) {parts.push(localityPill(isLocal));}
    node.replaceChildren(...parts);
  }

  function detailNotes(entry: AiActivityEntry): HTMLElement[] {
    const out: HTMLElement[] = [];
    if (entry.error) {out.push(note(entry.error.code === 'cancelled' ? 'info' : 'error', entry.error.message));}
    if (entry.retried) {out.push(note('info', 'This engine could not be reached, so the request went to another engine. That attempt is the next request in the list.'));}
    if (!entry.error && entry.route?.viaFallback) {out.push(note('info', 'The preferred engine was passed over, so a fallback engine handled this request.'));}
    return out;
  }

  function requestRows(entry: AiActivityEntry): Array<{ label: string; value: string; raw?: boolean }> {
    const { format, maxTokens, temperature, requestOverrides } = entry.request;
    const out: Array<{ label: string; value: string; raw?: boolean }> = [];
    if (format) {out.push({ label: 'Format', value: format });}
    if (maxTokens !== undefined) {out.push({ label: 'Max tokens', value: maxTokens.toLocaleString() });}
    if (temperature !== undefined) {out.push({ label: 'Temperature', value: String(temperature) });}
    if (requestOverrides) {out.push({ label: 'Overrides', value: JSON.stringify(requestOverrides), raw: true });}
    return out;
  }

  /** The footer under Received: empty until the request has ended. */
  function resultRows(entry: AiActivityEntry): Array<{ label: string; value: string }> {
    if (entry.endedAt === null) {return [];}
    const { usage, finishReason, timing, served } = entry.response;
    const out: Array<{ label: string; value: string }> = [];
    const usageParts: string[] = [];
    if (usage?.promptTokens !== undefined) {usageParts.push(`${usage.promptTokens.toLocaleString()} prompt`);}
    if (usage?.completionTokens !== undefined) {usageParts.push(`${usage.completionTokens.toLocaleString()} completion`);}
    if (usageParts.length > 0) {out.push({ label: 'Usage', value: `${usageParts.join(' · ')} tokens` });}
    if (finishReason) {out.push({ label: 'Finish reason', value: finishReason });}
    const total = timing?.totalMs ?? entryDuration(entry);
    if (total !== null) {
      const first = timing?.firstTokenMs;
      out.push({ label: 'Timing', value: first === undefined ? formatDuration(total) : `${formatDuration(total)} total · first token at ${formatDuration(first)}` });
    }
    if (served) {out.push({ label: 'Served by', value: `${served.engineName} · ${served.modelId} (${served.isLocal ? 'local' : 'cloud'})` });}
    if (entry.error) {out.push({ label: 'Error code', value: entry.error.code });}
    return out;
  }

  function receivedSummaryText(entry: AiActivityEntry): string {
    const size = plural(entry.response.text.length, 'character');
    if (entry.endedAt === null) {return entry.response.text ? `Streaming · ${size}` : 'Waiting for the first token';}
    return entry.response.text ? size : 'Nothing received';
  }

  function buildDetail(entry: AiActivityEntry): DetailRefs {
    const head = el('div', 'ai-activity-detail-head');
    const titleRow = el('div', 'ai-activity-detail-title-row');
    const detailTitle = el('h3', 'ai-activity-detail-title', featureLabel(entry));
    const status = el('span', 'ai-activity-status');
    const dot = el('span', 'ai-activity-dot');
    dot.setAttribute('aria-hidden', 'true');
    const statusWord = el('span', 'ai-activity-status-word');
    status.append(dot, statusWord);

    const actions = el('div', 'ai-activity-detail-actions');
    const copyStatus = inlineStatus();
    const copyBtn = actionButton('copy', 'Copy');
    copyBtn.addEventListener('click', () => copySelected(copyStatus));
    actions.append(copyStatus.element, copyBtn);
    if (canSave) {
      const saveBtn = actionButton('save', 'Save this request');
      saveBtn.addEventListener('click', () => { void saveSelected(saveBtn, copyStatus); });
      actions.append(saveBtn);
    }
    titleRow.append(detailTitle, status, actions);

    const route = el('div', 'ai-activity-route');
    renderRoute(route, entry);
    const facts = [`Task: ${entry.task}`, `Started ${clockTime(entry.startedAt)}`];
    const thinking = thinkingLabel(entry.thinking);
    if (thinking) {facts.unshift(`Thinking: ${thinking}`);}
    if (entry.attempt === 2) {facts.push('Second attempt');}
    head.append(titleRow, route, el('div', 'ai-activity-thinking', facts.join(' · ')));

    const notes = el('div', 'ai-activity-notes');

    const sent = buildSection('sent', 'Sent');
    const totalChars = entry.request.messages.reduce((sum, m) => sum + messageText(m).length, 0);
    sent.summary.textContent = `${plural(entry.request.messages.length, 'message')} · ${plural(totalChars, 'character')}`;
    for (const message of entry.request.messages) {
      const text = messageText(message);
      const block = el('div', 'ai-activity-block ai-activity-message');
      block.dataset.role = message.role;
      const caption = el('div', 'ai-activity-block-caption');
      caption.append(el('span', 'ai-activity-message-role', message.role), el('span', 'ai-activity-block-size', plural(text.length, 'character')));
      block.append(caption, el('pre', 'ai-activity-text ai-activity-message-text', text));
      sent.content.append(block);
    }
    const requestMeta = requestRows(entry);
    if (requestMeta.length > 0) {sent.content.append(metaList(requestMeta));}

    const received = buildSection('received', 'Received');
    const receivedBlock = el('div', 'ai-activity-block ai-activity-received');
    const receivedPre = el('pre', 'ai-activity-text ai-activity-received-text');
    // One text node for the life of the pane: appending to it keeps a text selection.
    const receivedText = document.createTextNode('');
    receivedPre.append(receivedText);
    receivedBlock.append(receivedPre);
    const receivedMeta = el('div', 'ai-activity-received-meta');
    received.content.append(receivedBlock, receivedMeta);

    detailPane.replaceChildren();
    const inner = el('div', 'ai-activity-detail-inner');
    inner.append(head, notes, sent.section, received.section);
    detailPane.append(inner);
    detailPane.scrollTop = 0;

    const refs: DetailRefs = {
      entry, status, statusWord, route, notes,
      receivedSummary: received.summary, receivedBlock, receivedText, receivedMeta, copyStatus,
    };
    syncDetail(refs, entry, true);
    return refs;
  }

  /** Bring the open pane up to `entry`: append response text; rebuild only the small parts that changed. */
  function syncDetail(refs: DetailRefs, entry: AiActivityEntry, first = false): void {
    const previous = refs.entry;
    refs.entry = entry;
    const text = entry.response.text;
    const current = refs.receivedText.data;
    if (text !== current) {
      if (text.startsWith(current)) {refs.receivedText.appendData(text.slice(current.length));}
      else {refs.receivedText.data = text;}
    }
    refs.receivedBlock.hidden = text === '';
    setText(refs.receivedSummary, receivedSummaryText(entry));
    const ended = first || previous.endedAt !== entry.endedAt || previous.error !== entry.error || previous.retried !== entry.retried || previous.response.served !== entry.response.served;
    if (!ended) {return;}
    const status = aiActivityStatus(entry);
    refs.status.dataset.status = status;
    setText(refs.statusWord, entry.retried ? 'Failed, retried' : STATUS_LABELS[status]);
    renderRoute(refs.route, entry);
    refs.notes.replaceChildren(...detailNotes(entry));
    const meta = resultRows(entry);
    refs.receivedMeta.replaceChildren(...(meta.length > 0 ? [metaList(meta)] : []));
  }

  function renderDetail(entry: AiActivityEntry | null): void {
    if (!entry) {
      detail?.copyStatus.clear();
      detail = null;
      detailPane.replaceChildren();
      return;
    }
    if (detail && detail.entry.id === entry.id) {
      if (detail.entry !== entry) {syncDetail(detail, entry);}
      return;
    }
    detail?.copyStatus.clear();
    detail = buildDetail(entry);
  }

  // ── Copy and Save ─────────────────────────────────────────────────────────

  function copySelected(status: ReturnType<typeof inlineStatus>): void {
    const entry = selectedId ? log.get(selectedId) : undefined;
    if (!entry) {return;}
    let written: Promise<void>;
    try {
      written = navigator.clipboard.writeText(formatActivityExport([entry]));
    } catch {
      // No clipboard API in this context.
      status.show('Could not copy', 'error', CONFIRM_MS * 2);
      return;
    }
    written.then(
      () => { if (!destroyed) {status.show('Copied', 'ok', CONFIRM_MS);} },
      () => { if (!destroyed) {status.show('Could not copy', 'error', CONFIRM_MS * 2);} },
    );
  }

  /** The host's save. It resolves after a cancelled dialog too, so success says nothing. */
  async function saveEntries(entries: AiActivityEntry[], status: ReturnType<typeof inlineStatus>): Promise<void> {
    status.clear();
    try {
      await opts.saveTextFile?.(activityExportFileName(), formatActivityExport(entries));
    } catch (err) {
      if (destroyed) {return;}
      const reason = err instanceof Error && err.message ? `: ${err.message}` : '';
      status.show(`Could not save${reason}`, 'error');
    }
  }

  async function saveSelected(btn: HTMLButtonElement, status: ReturnType<typeof inlineStatus>): Promise<void> {
    const entry = selectedId ? log.get(selectedId) : undefined;
    if (!entry) {return;}
    btn.disabled = true;
    await saveEntries([entry], status);
    btn.disabled = false;
  }

  async function saveAll(): Promise<void> {
    const entries = log.entries();
    if (entries.length === 0) {return;}
    savingAll = true;
    saveAllBtn.disabled = true;
    await saveEntries(entries, headerStatus);
    savingAll = false;
    if (!destroyed) {saveAllBtn.disabled = log.entries().length === 0;}
  }

  // ── Render ────────────────────────────────────────────────────────────────

  function flush(): void {
    if (renderTimer !== undefined) {render();}
  }

  function render(): void {
    window.clearTimeout(renderTimer);
    renderTimer = undefined;
    lastRender = Date.now();
    const entries = log.entries();
    const isEmpty = entries.length === 0;

    root.dataset.recording = log.enabled ? 'on' : 'off';
    body.hidden = isEmpty;
    empty.hidden = !isEmpty;
    if (isEmpty) {
      const copy = log.enabled ? AI_ACTIVITY_EMPTY : AI_ACTIVITY_OFF;
      setText(emptyTitle, copy.title);
      setText(emptyText, copy.text);
      view = 'list';
      applyLayout();
    }
    clearBtn.disabled = isEmpty;
    if (!savingAll) {saveAllBtn.disabled = isEmpty;}

    renderList(entries);

    // Keep the selection while requests come and go. The first request is
    // selected for you; a request that fell off the ring hands over to the next one.
    if (selectedId && !log.get(selectedId)) {selectedId = isEmpty ? null : entries[0].id;}
    else if (!selectedId && !isEmpty) {selectedId = entries[entries.length - 1].id;}
    markSelected();
    renderDetail(selectedId ? log.get(selectedId) ?? null : null);
    keepFocusInside();
  }

  /** A row that left the list or a button that just disabled took focus with it: Escape must still work. */
  function keepFocusInside(): void {
    if (!mounted) {return;}
    const active = document.activeElement;
    if (active === document.body || (active instanceof HTMLButtonElement && active.disabled && root.contains(active))) {focus();}
  }

  function onLogChange(): void {
    if (destroyed) {return;}
    // A new request or a cleared log shows at once; tokens wait their turn.
    const entries = log.entries();
    const newest = entries[entries.length - 1];
    const wait = RENDER_THROTTLE_MS - (Date.now() - lastRender);
    if (wait <= 0 || !newest || !rows.has(newest.id)) {
      render();
    } else if (renderTimer === undefined) {
      renderTimer = window.setTimeout(render, wait);
    }
  }

  // ── Keyboard, layout, lifetime ────────────────────────────────────────────

  function focus(): void {
    (selectedRow() ?? backBtn).focus({ preventScroll: true });
  }

  /** Back: from the request to the list in one column, otherwise close. */
  function back(): void {
    if (narrow && view === 'detail') {
      view = 'list';
      applyLayout();
      focus();
      return;
    }
    ctx.close();
  }

  root.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape' || e.defaultPrevented) {return;}
    // Escape is Back; nothing else (a modal under the panel) should see it.
    e.preventDefault();
    e.stopPropagation();
    back();
  });

  function applyLayout(): void {
    root.classList.toggle('is-narrow', narrow);
    root.dataset.view = narrow ? view : 'both';
    backBtn.setAttribute('aria-label', narrow && view === 'detail' ? 'Back to the list' : 'Back');
  }

  function measure(width: number): void {
    // Zero means "not laid out" (jsdom, a hidden host): keep two panes.
    const next = width > 0 && width < NARROW_PX;
    if (next === narrow) {return;}
    narrow = next;
    applyLayout();
  }

  let resizeObserver: ResizeObserver | null = null;
  if (typeof ResizeObserver === 'function') {
    resizeObserver = new ResizeObserver((entries) => { measure(entries[0]?.contentRect.width ?? 0); });
    resizeObserver.observe(root);
  }

  container.append(root);
  applyLayout();
  render();
  mounted = true;
  measure(root.getBoundingClientRect().width);
  const unsubscribe = log.subscribe(onLogChange);

  return {
    destroy() {
      if (destroyed) {return;}
      destroyed = true;
      unsubscribe();
      window.clearTimeout(renderTimer);
      renderTimer = undefined;
      resizeObserver?.disconnect();
      headerStatus.clear();
      detail?.copyStatus.clear();
      root.remove();
    },
    focus,
    refresh() {
      if (!destroyed) {render();}
    },
  };
}
