/**
 * The Settings modal's AI tab. Built only when the host has an `ai` group
 * (see `editor.ts#showSettingsModal`), with the modal's own row builders so
 * it sits flush with the other tabs.
 *
 * Tier 1 hosts (`complete` only, they route by themselves) get the master
 * switch and the feature toggles. Tier 2 hosts (an engine registry) also get
 * Allow cloud, the engine list with its inline editor and models table, and
 * routing.
 *
 * Everything edits a draft copy of the settings; Save sends only the `ai.*`
 * keys that changed, through the modal's normal `saveSettings` patch. API
 * keys never touch the draft: Store and Clear call `host.ai.setSecret`
 * straight away, and a deleted engine's key is dropped when the modal saves.
 * Test connection and Discover models need the host to know the engine, so
 * when its connection fields differ from what the host has they save the
 * engines first and wait for the host's settings echo.
 *
 * Modal UI only: nothing here touches the editor document or its DOM.
 */

import {
  AI_ENGINE_KINDS,
  AI_ENGINE_PRESETS,
  AI_FALLBACK_MODES,
  AI_FEATURES,
  AI_TASKS,
  aiErrorCopy,
  getAiTask,
  isKnownEngineKind,
  resolveAiFeature,
  serializeAiSettings,
  toAiError,
} from './ai';
import type {
  AiEngineConfig,
  AiEnginePreset,
  AiEngineStatus,
  AiFallbackMode,
  AiLocalitySetting,
  AiModelConfig,
  AiRoute,
  AiSettings,
  AiSettingsPatch,
  MikeDownAiHost,
} from './ai';
import {
  AI_CAPABILITY_CHIPS,
  AI_ENGINE_KIND_LABELS,
  DEFAULT_ROUTE_REQUIREMENTS,
  addManualModel,
  aiHostTier,
  baseUrlProblem,
  changedAiPatch,
  cloneAiSettings,
  connectionDiffers,
  defaultRouteForEngine,
  engineDisplayName,
  engineFromPreset,
  engineIssues,
  engineKindLabel,
  engineLocalityInfo,
  formatRequestOverrides,
  formatTokens,
  groupPresets,
  mergeDiscoveryStatus,
  modelDisplayName,
  parseContextTokens,
  parseRequestOverrides,
  parseRouteKey,
  removeEngine,
  removeRoutesTo,
  routeKey,
  routeLabel,
  routePairs,
  shortUrl,
  taskRequirements,
  taskRouteNote,
  toggleModelCapability,
  unknownRoutedTasks,
  withEngine,
  withModel,
  setModelContextTokens,
} from './ai-settings-model';
import type { RouteRequirements } from './ai-settings-model';
import type { MikeDownSettingsSectionBuild, MikeDownSettingsSectionContext } from './types';

export interface AiSettingsSectionOptions {
  ai: MikeDownAiHost;
  /** The host's AI settings when the modal opened. */
  settings: AiSettings;
  /** Last known engine statuses. */
  statuses: readonly AiEngineStatus[];
  /** The host's settings now (they change when the tab saves engines before a test). */
  getHostSettings(): AiSettings;
  /** Persist an AI patch right away. Absent when the host cannot persist settings. */
  saveNow?(patch: AiSettingsPatch): void;
  /** Resolves with the host's next settings `accept` likes, or null after `timeoutMs`. */
  waitForSettings(accept: (s: AiSettings) => boolean, timeoutMs: number): Promise<AiSettings | null>;
  /** Fresh statuses (list, test, discover) for the editor's cache and the indicator. */
  onStatuses(statuses: AiEngineStatus[]): void;
  /** The modal saved; the draft is the new settings. */
  onSaved(draft: AiSettings): void;
}

/** How long Test and Discover wait for the host to echo engines the tab just saved. */
const SAVE_ECHO_TIMEOUT_MS = 4000;

const FALLBACK_LABELS: Record<AiFallbackMode, string> = {
  none: 'Nothing (the feature is unavailable)',
  default: 'Use the default model',
  anyLocal: 'Default, then any local model',
  any: 'Default, any local, then cloud',
};

const LOCALITY_LABELS: Record<Exclude<AiLocalitySetting, 'auto'>, string> = {
  local: 'Local',
  cloud: 'Cloud',
};

// ── Icons (inline, currentColor) ────────────────────────────────────────────

const svg = (body: string, size = 14, extra = '') =>
  `<svg width="${size}" height="${size}" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"${extra}>${body}</svg>`;

const ICONS = {
  starOff: svg('<path d="M8 1.9l1.86 3.77 4.16.6-3.01 2.94.71 4.14L8 11.4l-3.72 1.95.71-4.14L1.98 6.27l4.16-.6z"/>'),
  starOn: svg('<path d="M8 1.9l1.86 3.77 4.16.6-3.01 2.94.71 4.14L8 11.4l-3.72 1.95.71-4.14L1.98 6.27l4.16-.6z" fill="currentColor"/>'),
  trash: svg('<path d="M2.5 4h11M6.5 4V2.5h3V4M4 4l.7 9.5h6.6L12 4M6.6 6.5v4.5M9.4 6.5v4.5"/>'),
  chevron: svg('<path d="M6 4l4 4-4 4"/>', 12),
  plus: svg('<path d="M8 3v10M3 8h10"/>', 12),
  local: svg('<path d="M2.5 7.5L8 3l5.5 4.5M4 6.5V13h8V6.5"/>', 11),
  cloud: svg('<path d="M4.5 12.5h7a2.75 2.75 0 0 0 .3-5.48A4 4 0 0 0 4.1 7.6 2.5 2.5 0 0 0 4.5 12.5z"/>', 11),
  warn: svg('<path d="M8 2.2l6.2 11H1.8z"/><path d="M8 6.5v3M8 11.4v.1"/>', 12),
  info: svg('<circle cx="8" cy="8" r="6"/><path d="M8 7.2v3.8M8 5v.1"/>', 12),
  check: svg('<path d="M3.5 8.5l3 3 6-7"/>', 12),
  braces: svg('<path d="M6 2.5c-1.5 0-2 .7-2 2v1.6c0 .9-.5 1.4-1.4 1.9.9.5 1.4 1 1.4 1.9v1.6c0 1.3.5 2 2 2M10 2.5c1.5 0 2 .7 2 2v1.6c0 .9.5 1.4 1.4 1.9-.9.5-1.4 1-1.4 1.9v1.6c0 1.3-.5 2-2 2"/>', 16),
  close: svg('<path d="M4 4l8 8M12 4l-8 8"/>', 10),
  servers: '<svg width="44" height="44" viewBox="0 0 44 44" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><rect x="7" y="9" width="24" height="9" rx="2.5"/><rect x="7" y="21" width="24" height="9" rx="2.5"/><path d="M11.5 13.5h.01M11.5 25.5h.01M16 13.5h8M16 25.5h8"/><path d="M36 22v8M32 26h8" class="ai-empty-spark"/><path d="M19 30v5M13 35h12"/></svg>',
};

/** Two-letter tiles for the kinds without a glyph; the generic kind gets braces. */
const KIND_MONOGRAMS: Record<string, string> = {
  lmstudio: 'LM',
  ollama: 'Ol',
  anthropic: 'An',
  openai: 'OA',
};

// ── Small DOM helpers ───────────────────────────────────────────────────────

let uid = 0;
const nextId = (prefix: string) => `${prefix}-${++uid}`;

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className?: string, text?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) {node.className = className;}
  if (text !== undefined) {node.textContent = text;}
  return node;
}

function button(className: string, label: string, opts: { html?: string; ariaLabel?: string; title?: string; fk?: string } = {}): HTMLButtonElement {
  const b = el('button', className);
  b.type = 'button';
  if (opts.html !== undefined) {
    b.innerHTML = opts.html;
    if (label) {b.append(el('span', 'ai-btn-text', label));}
  } else {
    b.textContent = label;
  }
  if (opts.ariaLabel) {b.setAttribute('aria-label', opts.ariaLabel);}
  if (opts.title) {b.title = opts.title;}
  if (opts.fk) {b.dataset.fk = opts.fk;}
  return b;
}

/** A switch-styled checkbox (role="switch"), labelled for screen readers. */
function switchInput(checked: boolean, ariaLabel: string, fk?: string): HTMLInputElement {
  const input = el('input', 'ai-switch');
  input.type = 'checkbox';
  input.setAttribute('role', 'switch');
  input.checked = checked;
  input.setAttribute('aria-label', ariaLabel);
  if (fk) {input.dataset.fk = fk;}
  return input;
}

function note(level: 'warning' | 'info' | 'error' | 'ok', text: string, className = ''): HTMLDivElement {
  const n = el('div', `ai-note ai-note--${level}${className ? ` ${className}` : ''}`);
  const icon = el('span', 'ai-note-icon');
  icon.innerHTML = level === 'ok' ? ICONS.check : level === 'info' ? ICONS.info : ICONS.warn;
  n.append(icon, el('span', 'ai-note-text', text));
  return n;
}

/**
 * Rebuild `scope` and put focus (and the caret) back on the control with the
 * same `data-fk`, so re-rendering a list never throws the keyboard user out.
 */
function keepFocus(scope: HTMLElement, rebuild: () => HTMLElement | void): void {
  const active = document.activeElement as HTMLElement | null;
  const key = active && scope.contains(active) ? active.dataset.fk : undefined;
  let sel: [number | null, number | null] | null = null;
  if (key && (active instanceof HTMLInputElement || active instanceof HTMLTextAreaElement)) {
    try { sel = [active.selectionStart, active.selectionEnd]; } catch { sel = null; }
  }
  // A rebuild that swaps `scope` for a new node returns the new one.
  const target = rebuild() ?? scope;
  if (!key) {return;}
  const next = Array.from(target.querySelectorAll<HTMLElement>('[data-fk]')).find((n) => n.dataset.fk === key);
  if (!next) {return;}
  next.focus({ preventScroll: true });
  if (sel && (next instanceof HTMLInputElement || next instanceof HTMLTextAreaElement)) {
    try { next.setSelectionRange(sel[0], sel[1]); } catch { /* number inputs have no selection */ }
  }
}

// ── The tab ─────────────────────────────────────────────────────────────────

export function buildAiSettingsSection(ctx: MikeDownSettingsSectionContext, opts: AiSettingsSectionOptions): MikeDownSettingsSectionBuild {
  const { ai } = opts;
  const tier = aiHostTier(ai);
  const original = cloneAiSettings(opts.settings);
  let draft = cloneAiSettings(opts.settings);

  const statuses = new Map<string, AiEngineStatus>(opts.statuses.map((s) => [s.engineId, s]));
  /** `hasKey` the tab learned itself from Store / Clear, ahead of the next status. */
  const keyOverride = new Map<string, boolean>();
  /** Engines deleted in this session: their keys are dropped on Save. */
  const deleted = new Set<string>();
  const busy = new Map<string, 'test' | 'discover'>();
  /** Last Test / Discover / key result per engine, shown in its editor. */
  const results = new Map<string, { level: 'ok' | 'error' | 'info'; text: string }>();
  let openEngineId: string | null = null;
  let confirmDeleteId: string | null = null;
  /** Overrides editors the user opened, and their last unparsable text. */
  const openOverrides = new Set<string>();
  const overrideErrors = new Map<string, { text: string; error: string }>();

  const hasKey = (id: string) => keyOverride.get(id) ?? statuses.get(id)?.hasKey ?? false;
  const statusList = () => [...statuses.values()];
  const getEngine = (id: string) => draft.engines.find((e) => e.id === id);

  // Screen reader announcements for probe results and key changes.
  const live = el('div', 'ai-live');
  live.setAttribute('role', 'status');
  live.setAttribute('aria-live', 'polite');
  let liveTimer: number | undefined;
  function announce(text: string): void {
    window.clearTimeout(liveTimer);
    live.textContent = '';
    // A fresh text node after a tick, so repeating the same message is read again.
    liveTimer = window.setTimeout(() => { live.textContent = text; }, 40);
  }

  // ── Master switch and Allow cloud ─────────────────────────────────────────
  const rows: HTMLElement[] = [];

  const masterField = ctx.makeCheckboxRow(
    'Enable AI features',
    tier === 2
      ? 'Writing help from engines you choose. While this is off, nothing is sent anywhere.'
      : 'Writing help from the AI service this app provides. While this is off, nothing is sent anywhere.',
    draft.enabled,
  );
  masterField.row.classList.add('ai-master');
  masterField.input.dataset.fk = 'ai-enabled';
  masterField.input.addEventListener('change', () => {
    draft = { ...draft, enabled: masterField.input.checked };
  });
  rows.push(masterField.row);

  const cloudField = ctx.makeCheckboxRow(
    'Allow cloud engines',
    'Lets tasks use engines outside this network, such as Anthropic or OpenAI. Local engines never need it.',
    draft.allowCloud,
  );
  cloudField.input.dataset.fk = 'ai-allow-cloud';
  cloudField.row.append(note('info', 'Even when allowed, each cloud engine asks once per workspace before its first request.', 'ai-row-note'));
  cloudField.input.addEventListener('change', () => {
    draft = { ...draft, allowCloud: cloudField.input.checked };
    renderEngines();
    renderRouting();
  });

  // ── Engines ───────────────────────────────────────────────────────────────
  const enginesRow = ctx.makeRow('Engines', 'Servers that run the models. Local engines keep your text on this network.');
  enginesRow.classList.add('ai-section');
  const enginesBody = el('div', 'ai-engines-body');
  const addWrap = el('div', 'ai-add');
  enginesRow.append(enginesBody, addWrap);

  const addMenu = buildAddMenu();
  addWrap.append(addMenu.root);

  function renderEngines(): void {
    keepFocus(enginesBody, () => {
      enginesBody.replaceChildren();
      addWrap.hidden = draft.engines.length === 0;
      if (draft.engines.length === 0) {
        enginesBody.append(buildEmptyState());
        return;
      }
      const list = el('div', 'ai-engines');
      list.setAttribute('role', 'list');
      list.setAttribute('aria-label', 'Engines');
      for (const engine of draft.engines) {list.append(buildEngineItem(engine));}
      enginesBody.append(list);
    });
  }

  function buildEmptyState(): HTMLElement {
    const box = el('div', 'ai-empty');
    const art = el('div', 'ai-empty-art');
    art.innerHTML = ICONS.servers;
    const title = el('div', 'ai-empty-title', 'No engines yet');
    const text = el('div', 'ai-empty-text', 'Add a model server on this computer or your network, such as oMLX, LM Studio or Ollama, or a cloud API. Nothing is sent until AI is on and a task is routed to an engine.');
    const actions = el('div', 'ai-empty-actions');
    for (const id of ['omlx', 'lmstudio', 'ollama']) {
      const preset = AI_ENGINE_PRESETS.find((p) => p.id === id);
      if (!preset) {continue;}
      const b = button('settings-btn ai-empty-preset', preset.name, { html: kindGlyphHtml(preset.kind, 'ai-glyph--sm'), fk: `empty:${id}`, ariaLabel: `Add ${preset.name}` });
      b.addEventListener('click', () => addEngine(preset));
      actions.append(b);
    }
    const more = button('settings-btn ai-empty-more', 'Other engines…', { fk: 'empty:more' });
    more.setAttribute('aria-haspopup', 'menu');
    more.addEventListener('click', () => addMenu.open(more));
    actions.append(more);
    box.append(art, title, text, actions);
    return box;
  }

  function kindGlyphHtml(kind: string, extra = ''): string {
    const known = isKnownEngineKind(kind);
    const inner = !known ? '?' : kind === 'openai-compatible' ? ICONS.braces : KIND_MONOGRAMS[kind] ?? '?';
    return `<span class="ai-glyph ${extra}" data-kind="${known ? kind : 'unknown'}" aria-hidden="true">${inner}</span>`;
  }

  function buildEngineItem(engine: AiEngineConfig): HTMLElement {
    const item = el('div', 'ai-engine');
    item.setAttribute('role', 'listitem');
    item.dataset.engineId = engine.id;
    const isOpen = openEngineId === engine.id;
    item.classList.toggle('is-open', isOpen);
    item.classList.toggle('is-disabled', !engine.enabled);

    const head = el('div', 'ai-engine-head');
    fillEngineHead(head, engine);
    item.append(head);

    // The pill already says "blocked"; an open editor shows URL and locality problems at their fields.
    const issues = engineIssues(engine, draft, hasKey(engine.id)).filter((i) => i.code !== 'cloudBlocked'
      && !(isOpen && (i.code === 'badUrl' || i.code === 'localityMismatch')));
    if (issues.length > 0) {
      const box = el('div', 'ai-engine-issues');
      for (const i of issues) {box.append(note(i.level, i.text));}
      item.append(box);
    }

    if (confirmDeleteId === engine.id) {item.append(buildDeleteConfirm(engine));}
    if (isOpen) {item.append(buildEngineEditor(engine));}
    return item;
  }

  function fillEngineHead(head: HTMLElement, engine: AiEngineConfig): void {
    head.replaceChildren();
    const name = engineDisplayName(engine);
    const info = engineLocalityInfo(engine, draft.localNetworks);
    const editorId = `ai-engine-editor-${engine.id}`;

    const glyph = el('span', 'ai-engine-glyph');
    glyph.innerHTML = kindGlyphHtml(engine.kind);

    const main = el('div', 'ai-engine-main');
    const titleLine = el('div', 'ai-engine-title');
    titleLine.append(el('span', 'ai-engine-name', name));
    const pill = el('span', `ai-pill ai-pill--${info.locality}`);
    pill.innerHTML = info.locality === 'local' ? ICONS.local : ICONS.cloud;
    pill.append(el('span', '', info.locality === 'local' ? 'local' : 'cloud'));
    if (info.mismatch) {
      pill.classList.add('ai-pill--mismatch');
      pill.title = info.locality === 'cloud' ? 'Pinned to cloud, but the address looks local.' : 'Pinned to local, but the address looks like a cloud server.';
    }
    titleLine.append(pill);
    if (info.locality === 'cloud' && !draft.allowCloud) {
      const blocked = el('span', 'ai-pill ai-pill--blocked', 'blocked by Allow cloud');
      blocked.title = 'Turn on Allow cloud engines to route tasks here.';
      titleLine.append(blocked);
    }
    const models = engine.models.filter((m) => !m.missing).length;
    const sub = el('div', 'ai-engine-sub');
    const subParts = [engineKindLabel(engine.kind), shortUrl(engine.baseUrl) || 'no address'];
    if (engine.models.length > 0) {subParts.push(`${models} ${models === 1 ? 'model' : 'models'}`);}
    sub.textContent = subParts.join(' · ');
    main.append(titleLine, sub);
    // Clicking the name area opens the editor, like a list of services.
    main.addEventListener('click', () => toggleEditor(engine.id));

    const status = buildStatusBadge(engine);

    const isDefault = draft.routing.default?.engineId === engine.id;
    const star = button(`ai-icon-btn ai-star${isDefault ? ' is-on' : ''}`, '', {
      html: isDefault ? ICONS.starOn : ICONS.starOff,
      ariaLabel: `Default engine: ${name}`,
      title: isDefault ? `Default: ${routeLabel(draft, draft.routing.default as AiRoute)}` : 'Make this the default engine',
      fk: `eng:${engine.id}:star`,
    });
    star.setAttribute('aria-pressed', String(isDefault));
    star.addEventListener('click', () => toggleDefault(engine.id));

    const enabled = switchInput(engine.enabled, `Enable ${name}`, `eng:${engine.id}:enabled-row`);
    enabled.addEventListener('change', () => updateEngine(engine.id, { enabled: enabled.checked }, { rerender: true }));

    const edit = button('settings-btn ai-edit-btn', openEngineId === engine.id ? 'Done' : 'Edit', {
      html: ICONS.chevron,
      ariaLabel: `Edit ${name}`,
      fk: `eng:${engine.id}:edit`,
    });
    edit.setAttribute('aria-expanded', String(openEngineId === engine.id));
    edit.setAttribute('aria-controls', editorId);
    edit.addEventListener('click', () => toggleEditor(engine.id));

    const del = button('ai-icon-btn ai-delete-btn', '', { html: ICONS.trash, ariaLabel: `Delete ${name}`, title: 'Delete engine', fk: `eng:${engine.id}:delete` });
    del.addEventListener('click', () => {
      confirmDeleteId = engine.id;
      renderEngines();
      focusKey(`eng:${engine.id}:confirm-cancel`);
    });

    const actions = el('div', 'ai-engine-actions');
    actions.append(status, star, enabled, edit, del);
    head.append(glyph, main, actions);
  }

  function buildStatusBadge(engine: AiEngineConfig): HTMLElement {
    const s = statuses.get(engine.id);
    const work = busy.get(engine.id);
    const badge = el('span', 'ai-status');
    const dot = el('span', 'ai-status-dot');
    dot.setAttribute('aria-hidden', 'true');
    const text = el('span', 'ai-status-text');
    let state: string;
    let label: string;
    let title: string;
    if (work) {
      state = 'busy';
      label = work === 'test' ? 'Testing…' : 'Discovering…';
      title = label;
    } else if (!s || s.ok === null) {
      state = 'unknown';
      label = 'Not tested';
      title = 'Never tested. Open the engine and choose Test connection.';
    } else if (s.ok) {
      state = 'ok';
      label = s.latencyMs !== undefined ? `${Math.round(s.latencyMs)} ms` : 'OK';
      title = `Connected${s.latencyMs !== undefined ? ` in ${Math.round(s.latencyMs)} ms` : ''} on the last test.`;
    } else {
      state = 'error';
      label = 'Failed';
      title = s.error ? `Last test failed: ${s.error}` : 'The last test failed.';
    }
    badge.dataset.state = state;
    badge.title = title;
    text.textContent = label;
    badge.append(dot, text);
    // The visible text is terse; screen readers get the tooltip.
    badge.setAttribute('aria-label', `Status: ${title}`);
    badge.setAttribute('role', 'img');
    return badge;
  }

  function buildDeleteConfirm(engine: AiEngineConfig): HTMLElement {
    const box = el('div', 'ai-confirm');
    box.setAttribute('role', 'group');
    const name = engineDisplayName(engine);
    box.setAttribute('aria-label', `Delete ${name}?`);
    const msg = el('span', 'ai-confirm-text', `Delete ${name}? Routes to it are cleared${ai.setSecret ? ' and its stored API key is removed' : ''} when you save.`);
    const yes = button('settings-btn ai-btn--danger', 'Delete', { fk: `eng:${engine.id}:confirm-delete` });
    const no = button('settings-btn', 'Cancel', { fk: `eng:${engine.id}:confirm-cancel` });
    yes.addEventListener('click', () => deleteEngine(engine.id));
    no.addEventListener('click', () => {
      confirmDeleteId = null;
      renderEngines();
      focusKey(`eng:${engine.id}:delete`);
    });
    box.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        // Cancel the confirmation, not the whole modal.
        e.preventDefault();
        e.stopPropagation();
        no.click();
      }
    });
    box.append(msg, yes, no);
    return box;
  }

  // ── Engine editor ─────────────────────────────────────────────────────────

  function buildEngineEditor(engine: AiEngineConfig): HTMLElement {
    const id = engine.id;
    const wrap = el('div', 'ai-engine-editor');
    wrap.id = `ai-engine-editor-${id}`;
    wrap.setAttribute('role', 'group');
    wrap.setAttribute('aria-label', `${engineDisplayName(engine)} settings`);
    const fk = (name: string) => `eng:${id}:${name}`;

    // Name
    const nameRow = ctx.makeFieldLabel('Name', 'Shown in pickers and the indicator.');
    const nameInput = el('input', 'settings-input settings-input--medium');
    nameInput.type = 'text';
    nameInput.value = engine.name;
    nameInput.dataset.fk = fk('name');
    nameInput.addEventListener('input', () => updateEngine(id, { name: nameInput.value }, { head: true, routing: true }));
    nameRow.append(nameInput);

    // Kind
    const kindRow = ctx.makeFieldLabel('Kind', 'How MikeDown talks to the server.');
    const kindSelect = el('select', 'settings-input');
    kindSelect.dataset.fk = fk('kind');
    for (const kind of AI_ENGINE_KINDS) {
      const o = el('option', '', AI_ENGINE_KIND_LABELS[kind]);
      o.value = kind;
      kindSelect.append(o);
    }
    if (!isKnownEngineKind(engine.kind)) {
      const o = el('option', '', engineKindLabel(engine.kind));
      o.value = engine.kind;
      kindSelect.prepend(o);
    }
    kindSelect.value = engine.kind;
    kindSelect.addEventListener('change', () => updateEngine(id, { kind: kindSelect.value as AiEngineConfig['kind'] }, { rerender: true }));
    kindRow.append(kindSelect);

    // Base URL, validated inline.
    const urlRow = ctx.makeFieldLabel('Base URL', 'The server address, usually ending in /v1.', 'stacked');
    urlRow.classList.add('ai-field');
    const urlInput = el('input', 'settings-input ai-mono');
    urlInput.type = 'url';
    urlInput.spellcheck = false;
    urlInput.autocomplete = 'off';
    urlInput.placeholder = 'http://127.0.0.1:8000/v1';
    urlInput.value = engine.baseUrl;
    urlInput.dataset.fk = fk('url');
    const urlError = el('div', 'ai-field-error');
    urlError.id = nextId('ai-url-error');
    urlError.setAttribute('aria-live', 'polite');
    urlInput.setAttribute('aria-describedby', urlError.id);
    const showUrlProblem = () => {
      const problem = baseUrlProblem(urlInput.value);
      urlError.textContent = problem;
      urlInput.setAttribute('aria-invalid', String(!!problem));
    };
    urlInput.addEventListener('input', () => {
      updateEngine(id, { baseUrl: urlInput.value.trim() }, { head: true });
      refreshLocality();
      // Keep a half-typed address quiet; flag it once it stops looking like one.
      if (urlError.textContent) {showUrlProblem();}
    });
    urlInput.addEventListener('change', () => { showUrlProblem(); renderRouting(); });
    urlRow.append(urlInput, urlError);
    if (engine.baseUrl) {showUrlProblem();}

    // Locality: auto shows what it detects.
    const locRow = ctx.makeFieldLabel('Locality', 'Auto decides from the address. Cloud engines need Allow cloud.');
    const locSelect = el('select', 'settings-input');
    locSelect.dataset.fk = fk('locality');
    const autoOption = el('option');
    autoOption.value = 'auto';
    locSelect.append(autoOption);
    for (const [value, label] of Object.entries(LOCALITY_LABELS)) {
      const o = el('option', '', label);
      o.value = value;
      locSelect.append(o);
    }
    locSelect.value = engine.locality;
    const locNote = el('div', 'ai-locality-note');
    const refreshLocality = () => {
      const current = getEngine(id);
      if (!current) {return;}
      const info = engineLocalityInfo(current, draft.localNetworks);
      autoOption.textContent = `Auto (detected: ${info.detected})`;
      locNote.replaceChildren();
      if (info.mismatch) {
        locNote.append(note('warning', info.locality === 'cloud' ? 'Pinned to cloud, but the address looks local.' : 'Pinned to local, but the address looks like a cloud server. Text sent to it leaves this network.'));
      }
    };
    locSelect.addEventListener('change', () => {
      updateEngine(id, { locality: locSelect.value as AiLocalitySetting }, { head: true, routing: true });
      refreshLocality();
    });
    locRow.append(locSelect, locNote);
    refreshLocality();

    const groupRows: HTMLElement[] = [nameRow, kindRow, urlRow, locRow];

    // API key: write-only. The field never shows a stored key.
    if (ai.setSecret) {
      const keyRow = ctx.makeRow('API key', 'Kept in the system’s secure storage, never in the settings file.', 'stacked');
      keyRow.classList.add('ai-key-row');
      const keyLine = el('div', 'ai-key');
      const keyInput = el('input', 'settings-input settings-input--grow ai-mono');
      keyInput.type = 'password';
      keyInput.autocomplete = 'off';
      keyInput.spellcheck = false;
      keyInput.dataset.fk = fk('key');
      keyInput.setAttribute('aria-label', `API key for ${engineDisplayName(engine)}`);
      keyInput.placeholder = hasKey(id) ? 'Stored' : 'Paste a key';
      const store = button('settings-btn', 'Store', { fk: fk('key-store') });
      const clear = button('settings-btn', 'Clear', { fk: fk('key-clear') });
      clear.hidden = !hasKey(id);
      const keyState = el('span', 'ai-key-state');
      if (hasKey(id)) {keyState.innerHTML = `${ICONS.check}<span>Stored</span>`;}
      const doStore = () => {
        const value = keyInput.value.trim();
        if (!value) {keyInput.focus(); return;}
        void setKey(id, value);
      };
      store.addEventListener('click', doStore);
      keyInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); doStore(); } });
      clear.addEventListener('click', () => { void setKey(id, null); });
      keyLine.append(keyInput, store, clear, keyState);
      keyRow.append(keyLine);
      groupRows.push(keyRow);
    }

    // Environment variable fallback.
    const envRow = ctx.makeFieldLabel('Key variable', 'Used when no key is stored, for example OMLX_API_KEY. Apps opened from the Dock or Start menu may not see variables set in a shell profile.', 'stacked');
    const envInput = el('input', 'settings-input settings-input--medium ai-mono');
    envInput.type = 'text';
    envInput.spellcheck = false;
    envInput.autocomplete = 'off';
    envInput.placeholder = 'NAME_OF_VARIABLE';
    envInput.value = engine.apiKeyEnv ?? '';
    envInput.dataset.fk = fk('env');
    envInput.addEventListener('input', () => {
      const v = envInput.value.trim();
      const current = getEngine(id);
      if (!current) {return;}
      const next: AiEngineConfig = { ...current };
      if (v) {next.apiKeyEnv = v;} else {delete next.apiKeyEnv;}
      replaceEngine(next, { head: true });
    });
    envRow.append(envInput);
    groupRows.push(envRow);

    const enabledField = ctx.makeCheckboxRow('Enabled', 'Engines that are off are never routed.', engine.enabled);
    enabledField.input.dataset.fk = fk('enabled');
    enabledField.input.addEventListener('change', () => updateEngine(id, { enabled: enabledField.input.checked }, { rerender: true }));
    groupRows.push(enabledField.row);

    const discoveryField = ctx.makeSelectRow<'auto' | 'manual'>(
      'Model list',
      'Ask the server which models it has (merged with any you add), or keep only the models you add by hand.',
      engine.discovery,
      [
        { value: 'auto', label: 'Ask the server' },
        { value: 'manual', label: 'Manual only' },
      ],
    );
    discoveryField.select.dataset.fk = fk('discovery');
    discoveryField.select.addEventListener('change', () => updateEngine(id, { discovery: discoveryField.select.value as 'auto' | 'manual' }, { rerender: true }));
    groupRows.push(discoveryField.row);

    // Test and Discover with an inline result.
    const actionsRow = el('div', 'settings-row ai-probe');
    const buttons = el('div', 'ai-probe-buttons');
    const work = busy.get(id);
    const urlBad = !!baseUrlProblem(engine.baseUrl);
    const testBtn = button('settings-btn settings-btn--secondary', work === 'test' ? 'Testing…' : 'Test connection', { fk: fk('test') });
    // Busy buttons stay focusable (aria-disabled) so the keyboard is not dropped mid-probe.
    if (work) {testBtn.setAttribute('aria-disabled', 'true');}
    testBtn.disabled = urlBad;
    testBtn.hidden = !ai.testEngine;
    testBtn.addEventListener('click', () => { void runProbe(id, 'test'); });
    const discoverBtn = button('settings-btn settings-btn--secondary', work === 'discover' ? 'Discovering…' : 'Discover models', { fk: fk('discover') });
    if (work) {discoverBtn.setAttribute('aria-disabled', 'true');}
    discoverBtn.disabled = engine.discovery === 'manual' || urlBad;
    discoverBtn.hidden = !ai.discoverModels;
    if (engine.discovery === 'manual') {discoverBtn.title = 'The model list is manual for this engine.';}
    discoverBtn.addEventListener('click', () => { void runProbe(id, 'discover'); });
    buttons.append(testBtn, discoverBtn);
    actionsRow.append(buttons);
    if (opts.saveNow && connectionDiffers(opts.getHostSettings().engines.find((e) => e.id === id), engine)) {
      actionsRow.append(el('div', 'settings-desc ai-probe-hint', 'Testing saves this engine first, so the app can reach it.'));
    }
    const result = results.get(id);
    if (result) {actionsRow.append(note(result.level, result.text, 'ai-result'));}
    groupRows.push(actionsRow);

    const group = ctx.makeGroup(...groupRows);
    group.classList.add('ai-editor-group');
    wrap.append(group, buildModelsSection(engine));
    return wrap;
  }

  async function setKey(id: string, value: string | null): Promise<void> {
    const engine = getEngine(id);
    if (!engine || !ai.setSecret) {return;}
    const name = engineDisplayName(engine);
    try {
      await ai.setSecret(id, value);
      keyOverride.set(id, value !== null);
      results.set(id, value !== null
        ? { level: 'ok', text: 'Key stored.' }
        : { level: 'info', text: engine.apiKeyEnv ? `Key cleared. ${engine.apiKeyEnv} is used if it is set.` : 'Key cleared.' });
      announce(value !== null ? `API key stored for ${name}.` : `API key cleared for ${name}.`);
    } catch (err) {
      const e = toAiError(err);
      results.set(id, { level: 'error', text: `The key could not be ${value !== null ? 'stored' : 'cleared'}: ${e.message}` });
      announce(`The key for ${name} could not be ${value !== null ? 'stored' : 'cleared'}.`);
    }
    renderEngines();
    focusKey(`eng:${id}:${value !== null ? 'key' : 'key-store'}`);
  }

  // ── Models table ──────────────────────────────────────────────────────────

  function buildModelsSection(engine: AiEngineConfig): HTMLElement {
    const id = engine.id;
    const box = el('div', 'ai-models');
    const head = el('div', 'ai-models-head');
    const missing = engine.models.filter((m) => m.missing).length;
    head.append(el('span', 'settings-label', 'Models'));
    head.append(el('span', 'ai-models-count', engine.models.length === 0
      ? 'none yet'
      : `${engine.models.length}${missing ? `, ${missing} not listed` : ''}`));
    box.append(head);

    if (engine.models.length === 0) {
      box.append(el('div', 'ai-models-empty', engine.discovery === 'auto' && ai.discoverModels
        ? 'Discover models to list what the server offers, or add one by id.'
        : 'Add the models this engine serves by id.'));
    } else {
      const list = el('div', 'ai-model-list');
      list.setAttribute('role', 'list');
      list.setAttribute('aria-label', `Models of ${engineDisplayName(engine)}`);
      const loaded = new Map((statuses.get(id)?.models ?? []).map((m) => [m.id, m.loaded]));
      for (const model of engine.models) {list.append(buildModelItem(engine, model, loaded.get(model.id)));}
      box.append(list);
    }

    // Add model manually.
    const add = el('div', 'ai-model-add');
    const addInput = el('input', 'settings-input settings-input--small settings-input--grow ai-mono');
    addInput.type = 'text';
    addInput.placeholder = 'Model id, such as qwen3-coder-30b';
    addInput.spellcheck = false;
    addInput.setAttribute('aria-label', `Add a model to ${engineDisplayName(engine)} by id`);
    addInput.dataset.fk = `eng:${id}:add-model`;
    const addBtn = button('settings-btn', 'Add model', { html: ICONS.plus, fk: `eng:${id}:add-model-btn` });
    const addError = el('div', 'ai-field-error');
    addError.id = nextId('ai-add-model-error');
    addInput.setAttribute('aria-describedby', addError.id);
    const doAdd = () => {
      const current = getEngine(id);
      if (!current) {return;}
      const r = addManualModel(current, addInput.value);
      if (!r.ok) {
        addError.textContent = r.error;
        addInput.setAttribute('aria-invalid', 'true');
        addInput.focus();
        return;
      }
      replaceEngine(r.engine, { rerender: true, routing: true });
      announce(`Added ${r.model.id}.`);
      focusKey(`eng:${id}:add-model`);
    };
    addBtn.addEventListener('click', doAdd);
    addInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); doAdd(); } });
    addInput.addEventListener('input', () => { addError.textContent = ''; addInput.removeAttribute('aria-invalid'); });
    add.append(addInput, addBtn);
    box.append(add, addError);
    return box;
  }

  function buildModelItem(engine: AiEngineConfig, model: AiModelConfig, loaded: boolean | undefined): HTMLElement {
    const engineId = engine.id;
    const mfk = (name: string) => `model:${engineId}:${model.id}:${name}`;
    const shown = modelDisplayName(model);
    const item = el('div', 'ai-model');
    item.setAttribute('role', 'listitem');
    item.classList.toggle('is-missing', !!model.missing);
    item.classList.toggle('is-off', !model.enabled);

    const top = el('div', 'ai-model-top');
    const enabled = el('input', 'ai-model-check');
    enabled.type = 'checkbox';
    enabled.checked = model.enabled;
    enabled.dataset.fk = mfk('enabled');
    enabled.setAttribute('aria-label', `Use ${shown}`);
    enabled.addEventListener('change', () => updateModel(engineId, model.id, (m) => ({ ...m, enabled: enabled.checked }), { item: true }));

    const names = el('div', 'ai-model-names');
    const label = el('input', 'ai-model-label');
    label.type = 'text';
    label.value = model.label ?? '';
    label.placeholder = model.id;
    label.spellcheck = false;
    label.dataset.fk = mfk('label');
    label.setAttribute('aria-label', `Display name for ${model.id}`);
    label.addEventListener('input', () => updateModel(engineId, model.id, (m) => {
      const next = { ...m };
      if (label.value.trim()) {next.label = label.value;} else {delete next.label;}
      return next;
    }, { routing: true }));
    names.append(label);
    if (model.label) {names.append(el('span', 'ai-model-id', model.id));}

    const tags = el('div', 'ai-model-tags');
    if (loaded) {
      const t = el('span', 'ai-tag ai-tag--loaded', 'loaded');
      t.title = 'Loaded in memory on the server right now.';
      tags.append(t);
    }
    if (model.missing) {
      const t = el('span', 'ai-tag ai-tag--missing', 'not listed');
      t.title = 'The last discovery did not list this model. It is kept, but never routed.';
      tags.append(t);
    }
    if (model.manual) {tags.append(el('span', 'ai-tag', 'added by hand'));}

    const ctxWrap = el('label', 'ai-model-context');
    const ctxInput = el('input', 'settings-input settings-input--small ai-context-input');
    ctxInput.type = 'text';
    ctxInput.inputMode = 'numeric';
    ctxInput.value = model.capabilities.contextTokens !== null ? String(model.capabilities.contextTokens) : '';
    ctxInput.placeholder = formatTokens(null);
    ctxInput.dataset.fk = mfk('context');
    ctxInput.setAttribute('aria-label', `Context window of ${shown}, in tokens`);
    ctxInput.title = `Context window in tokens (${formatTokens(model.capabilities.contextTokens)}). Blank means unknown.`;
    ctxInput.addEventListener('change', () => {
      const r = parseContextTokens(ctxInput.value);
      if (!r.ok) {
        ctxInput.setAttribute('aria-invalid', 'true');
        ctxInput.title = r.error;
        announce(r.error);
        return;
      }
      ctxInput.removeAttribute('aria-invalid');
      updateModel(engineId, model.id, (m) => setModelContextTokens(m, r.value), { item: true, routing: true });
    });
    ctxWrap.append(ctxInput, el('span', 'ai-context-unit', 'ctx'));

    const hasOverrides = !!model.requestOverrides && Object.keys(model.requestOverrides).length > 0;
    const ovKey = `${engineId}\u0000${model.id}`;
    const ovOpen = openOverrides.has(ovKey) || overrideErrors.has(ovKey);
    const overridesId = nextId('ai-overrides');
    const ovBtn = button(`ai-icon-btn ai-overrides-btn${hasOverrides ? ' has-value' : ''}`, '', {
      html: '<span aria-hidden="true">{ }</span>',
      ariaLabel: `Request overrides for ${shown}`,
      title: hasOverrides ? 'Request overrides (set)' : 'Request overrides',
      fk: mfk('overrides'),
    });
    ovBtn.setAttribute('aria-expanded', String(ovOpen));
    ovBtn.setAttribute('aria-controls', overridesId);
    ovBtn.addEventListener('click', () => {
      if (openOverrides.has(ovKey)) {openOverrides.delete(ovKey);} else {openOverrides.add(ovKey);}
      rerenderOpenEditor();
      if (openOverrides.has(ovKey)) {focusKey(mfk('overrides-text'));}
    });

    const right = el('div', 'ai-model-right');
    right.append(ctxWrap, ovBtn);
    if (model.manual || model.missing) {
      const remove = button('ai-icon-btn ai-model-remove', '', { html: ICONS.close, ariaLabel: `Remove ${shown}`, title: 'Remove model', fk: mfk('remove') });
      remove.addEventListener('click', () => {
        const current = getEngine(engineId);
        if (!current) {return;}
        const index = current.models.findIndex((m) => m.id === model.id);
        draft = removeRoutesTo(draft, engineId, model.id);
        replaceEngine({ ...current, models: current.models.filter((m) => m.id !== model.id) }, { rerender: true, routing: true });
        announce(`Removed ${shown}.`);
        const next = getEngine(engineId)?.models[Math.min(index, (getEngine(engineId)?.models.length ?? 1) - 1)];
        focusKey(next ? `model:${engineId}:${next.id}:enabled` : `eng:${engineId}:add-model`);
      });
      right.append(remove);
    }

    top.append(enabled, names, tags, right);

    // Capability chips. Toggling one makes the row a user edit.
    const chips = el('div', 'ai-chips');
    chips.setAttribute('role', 'group');
    chips.setAttribute('aria-label', `Capabilities of ${shown}`);
    for (const chip of AI_CAPABILITY_CHIPS) {
      const on = model.capabilities[chip.flag];
      const b = button(`ai-chip${on ? ' is-on' : ''}`, chip.label, { title: `${chip.title}. Click to ${on ? 'turn off' : 'turn on'}.`, fk: mfk(`chip-${chip.flag}`) });
      b.setAttribute('aria-pressed', String(on));
      b.setAttribute('aria-label', `${chip.label}: ${chip.title}`);
      b.addEventListener('click', () => updateModel(engineId, model.id, (m) => toggleModelCapability(m, chip.flag), { item: true, routing: true }));
      chips.append(b);
    }
    const source = el('span', `ai-source ai-source--${model.capabilitiesSource}`, model.capabilitiesSource === 'user' ? 'edited' : model.capabilitiesSource === 'endpoint' ? 'from server' : 'guessed');
    source.title = model.capabilitiesSource === 'user'
      ? 'You edited these; discovery leaves them alone.'
      : model.capabilitiesSource === 'endpoint'
        ? 'Reported by the server; refreshed on discovery.'
        : 'Guessed from the model id; refreshed on discovery.';
    chips.append(source);

    item.append(top, chips);

    if (ovOpen) {
      const ov = el('div', 'ai-overrides');
      ov.id = overridesId;
      const area = el('textarea', 'settings-input ai-mono ai-overrides-text');
      area.rows = 3;
      area.spellcheck = false;
      area.dataset.fk = mfk('overrides-text');
      area.placeholder = '{ "reasoning_effort": "low" }';
      const pending = overrideErrors.get(ovKey);
      area.value = pending ? pending.text : formatRequestOverrides(model.requestOverrides);
      const help = el('div', 'settings-desc', 'JSON merged into every request body for this model, last, so it wins. For thinking controls such as reasoning_effort or chat_template_kwargs.');
      const err = el('div', 'ai-field-error');
      err.id = nextId('ai-overrides-error');
      err.setAttribute('aria-live', 'polite');
      area.setAttribute('aria-describedby', err.id);
      area.setAttribute('aria-label', `Request overrides for ${shown}, as JSON`);
      if (pending) {
        err.textContent = pending.error;
        area.setAttribute('aria-invalid', 'true');
      }
      area.addEventListener('input', () => {
        const r = parseRequestOverrides(area.value);
        if (!r.ok) {
          overrideErrors.set(ovKey, { text: area.value, error: r.error });
          err.textContent = r.error;
          area.setAttribute('aria-invalid', 'true');
          return;
        }
        overrideErrors.delete(ovKey);
        err.textContent = '';
        area.removeAttribute('aria-invalid');
        updateModel(engineId, model.id, (m) => {
          const next = { ...m };
          if (r.value) {next.requestOverrides = r.value;} else {delete next.requestOverrides;}
          return next;
        }, {});
        ovBtn.classList.toggle('has-value', !!r.value);
      });
      ov.append(area, err, help);
      item.append(ov);
    }
    return item;
  }

  // ── Draft edits ───────────────────────────────────────────────────────────

  interface Refresh {
    /** Rebuild the whole engines list (structure changed). */
    rerender?: boolean;
    /** Only the engine's header line (name, url, pills). */
    head?: boolean;
    /** Only the models table of the open editor. */
    item?: boolean;
    /** The routing pickers. */
    routing?: boolean;
  }

  function replaceEngine(engine: AiEngineConfig, refresh: Refresh): void {
    draft = withEngine(draft, engine);
    applyRefresh(engine.id, refresh);
  }

  function updateEngine(id: string, patch: Partial<AiEngineConfig>, refresh: Refresh): void {
    const current = getEngine(id);
    if (!current) {return;}
    replaceEngine({ ...current, ...patch }, refresh);
  }

  function updateModel(engineId: string, modelId: string, fn: (m: AiModelConfig) => AiModelConfig, refresh: Refresh): void {
    const engine = getEngine(engineId);
    const model = engine?.models.find((m) => m.id === modelId);
    if (!engine || !model) {return;}
    replaceEngine(withModel(engine, fn(model)), refresh);
  }

  function applyRefresh(engineId: string, refresh: Refresh): void {
    if (refresh.rerender) {
      renderEngines();
    } else {
      if (refresh.head) {refreshHead(engineId);}
      if (refresh.item) {rerenderOpenEditor();}
    }
    if (refresh.routing || refresh.rerender) {scheduleRouting();}
  }

  function itemFor(engineId: string): HTMLElement | null {
    return Array.from(enginesBody.querySelectorAll<HTMLElement>('.ai-engine')).find((n) => n.dataset.engineId === engineId) ?? null;
  }

  function refreshHead(engineId: string): void {
    const engine = getEngine(engineId);
    const head = itemFor(engineId)?.querySelector<HTMLElement>('.ai-engine-head');
    if (!engine || !head) {return;}
    keepFocus(head, () => fillEngineHead(head, engine));
  }

  /** Rebuild the open editor's models table (chips, context, overrides) in place. */
  function rerenderOpenEditor(): void {
    if (!openEngineId) {return;}
    const engine = getEngine(openEngineId);
    const models = itemFor(openEngineId)?.querySelector<HTMLElement>('.ai-models');
    if (!engine || !models) {return;}
    keepFocus(models, () => {
      const fresh = buildModelsSection(engine);
      models.replaceWith(fresh);
      return fresh;
    });
  }

  function focusKey(key: string): void {
    const n = Array.from(enginesRow.querySelectorAll<HTMLElement>('[data-fk]')).find((x) => x.dataset.fk === key);
    n?.focus({ preventScroll: true });
  }

  function toggleEditor(id: string): void {
    openEngineId = openEngineId === id ? null : id;
    confirmDeleteId = null;
    renderEngines();
    if (openEngineId === id) {
      focusKey(`eng:${id}:name`);
      itemFor(id)?.scrollIntoView?.({ block: 'nearest' });
    } else {
      focusKey(`eng:${id}:edit`);
    }
  }

  function toggleDefault(engineId: string): void {
    const engine = getEngine(engineId);
    if (!engine) {return;}
    const name = engineDisplayName(engine);
    if (draft.routing.default?.engineId === engineId) {
      draft = { ...draft, routing: { ...draft.routing, default: null } };
      announce(`${name} is no longer the default.`);
    } else {
      const route = defaultRouteForEngine(draft, statusList(), engineId);
      if (!route) {
        results.set(engineId, { level: 'info', text: 'No model here can be the default yet. Discover or add a chat model first.' });
        announce(`${name} has no chat model to make the default yet.`);
        openEngineId = engineId;
        renderEngines();
        focusKey(`eng:${engineId}:star`);
        return;
      }
      draft = { ...draft, routing: { ...draft.routing, default: route } };
      announce(`Default model: ${routeLabel(draft, route)}.`);
    }
    renderEngines();
    renderRouting();
  }

  function addEngine(preset: AiEnginePreset): void {
    const engine = engineFromPreset(preset, draft.engines.map((e) => e.id));
    draft = { ...draft, engines: [...draft.engines, engine] };
    openEngineId = engine.id;
    confirmDeleteId = null;
    renderEngines();
    renderRouting();
    focusKey(`eng:${engine.id}:name`);
    itemFor(engine.id)?.scrollIntoView?.({ block: 'nearest' });
    announce(`Added ${engine.name}. Check the address, then test the connection.`);
  }

  function deleteEngine(id: string): void {
    const engine = getEngine(id);
    if (!engine) {return;}
    const index = draft.engines.findIndex((e) => e.id === id);
    draft = removeEngine(draft, id);
    deleted.add(id);
    results.delete(id);
    if (openEngineId === id) {openEngineId = null;}
    confirmDeleteId = null;
    renderEngines();
    renderRouting();
    announce(`Deleted ${engineDisplayName(engine)}. Save to apply.`);
    const next = draft.engines[Math.min(index, draft.engines.length - 1)];
    if (next) {focusKey(`eng:${next.id}:edit`);} else {focusKey('empty:omlx');}
  }

  // ── Test and Discover ─────────────────────────────────────────────────────

  /** Make sure the host has this engine's connection fields before asking it to reach it. */
  async function ensureSaved(id: string): Promise<void> {
    const engine = getEngine(id);
    if (!engine || !opts.saveNow) {return;}
    if (!connectionDiffers(opts.getHostSettings().engines.find((e) => e.id === id), engine)) {return;}
    const patch = serializeAiSettings(draft);
    opts.saveNow({ 'ai.engines': patch['ai.engines'] });
    await opts.waitForSettings((s) => !connectionDiffers(s.engines.find((e) => e.id === id), engine), SAVE_ECHO_TIMEOUT_MS);
  }

  async function runProbe(id: string, which: 'test' | 'discover'): Promise<void> {
    const engine = getEngine(id);
    const available = which === 'test' ? !!ai.testEngine : !!ai.discoverModels;
    if (!engine || !available || busy.has(id)) {return;}
    const name = engineDisplayName(engine);
    busy.set(id, which);
    results.delete(id);
    renderEngines();
    try {
      await ensureSaved(id);
      const status = which === 'test' ? await ai.testEngine!(id) : await ai.discoverModels!(id);
      statuses.set(id, status);
      opts.onStatuses(statusList());
      if (which === 'discover') {
        const current = getEngine(id) ?? engine;
        const before = new Map(current.models.map((m) => [m.id, m]));
        const merged = mergeDiscoveryStatus(current, status);
        draft = withEngine(draft, merged);
        const added = merged.models.filter((m) => !before.has(m.id)).length;
        const gone = merged.models.filter((m) => m.missing && !before.get(m.id)?.missing).length;
        const listed = merged.models.filter((m) => !m.missing).length;
        const text = status.ok === false
          ? `Discovery failed${status.error ? `: ${status.error}` : '.'}`
          : `Found ${listed} ${listed === 1 ? 'model' : 'models'}${added ? `, ${added} new` : ''}${gone ? `, ${gone} no longer listed` : ''}.`;
        results.set(id, { level: status.ok === false ? 'error' : 'ok', text });
        announce(`${name}: ${text}`);
      } else if (status.ok) {
        const ms = status.latencyMs !== undefined ? ` in ${Math.round(status.latencyMs)} ms` : '';
        const n = status.models.filter((m) => !m.missing).length;
        const text = `Connected${ms}${n ? `. The server lists ${n} ${n === 1 ? 'model' : 'models'}.` : '.'}`;
        results.set(id, { level: 'ok', text });
        announce(`${name}: ${text}`);
      } else {
        const text = `Failed${status.error ? `: ${status.error}` : '. The server did not answer.'}`;
        results.set(id, { level: 'error', text });
        announce(`${name}: connection ${text.toLowerCase()}`);
      }
    } catch (err) {
      const e = toAiError(err);
      const copy = aiErrorCopy(e.code);
      const text = `${copy.title}${e.message && e.message !== copy.title ? `: ${e.message}` : '.'}`;
      results.set(id, { level: 'error', text });
      announce(`${name}: ${text}`);
    } finally {
      busy.delete(id);
      renderEngines();
      renderRouting();
      focusKey(`eng:${id}:${which}`);
    }
  }

  // ── Add engine menu ───────────────────────────────────────────────────────

  function buildAddMenu(): { root: HTMLElement; open(anchor: HTMLElement): void } {
    const root = el('div', 'ai-add-menu-wrap');
    const trigger = button('settings-btn ai-add-btn', 'Add engine', { html: ICONS.plus, fk: 'add-engine' });
    trigger.setAttribute('aria-haspopup', 'menu');
    trigger.setAttribute('aria-expanded', 'false');
    const menu = el('div', 'ai-menu');
    menu.id = nextId('ai-add-menu');
    menu.setAttribute('role', 'menu');
    menu.setAttribute('aria-label', 'Add engine');
    menu.hidden = true;
    trigger.setAttribute('aria-controls', menu.id);

    const groups = groupPresets(AI_ENGINE_PRESETS);
    const items: HTMLButtonElement[] = [];
    const addGroup = (label: string, presets: AiEnginePreset[]) => {
      if (presets.length === 0) {return;}
      const heading = el('div', 'ai-menu-heading', label);
      heading.setAttribute('role', 'presentation');
      menu.append(heading);
      for (const preset of presets) {
        const item = el('button', 'ai-menu-item');
        item.type = 'button';
        item.setAttribute('role', 'menuitem');
        item.tabIndex = -1;
        item.innerHTML = kindGlyphHtml(preset.kind, 'ai-glyph--sm');
        const text = el('span', 'ai-menu-text');
        text.append(el('span', 'ai-menu-name', preset.name), el('span', 'ai-menu-url', shortUrl(preset.baseUrl)));
        item.append(text);
        item.addEventListener('click', () => {
          close(false);
          addEngine(preset);
        });
        items.push(item);
        menu.append(item);
      }
    };
    addGroup('On this computer or network', groups.local);
    addGroup('Cloud', groups.cloud);

    let anchor: HTMLElement = trigger;
    let outside: ((e: Event) => void) | null = null;
    function close(refocus: boolean): void {
      if (menu.hidden) {return;}
      menu.hidden = true;
      trigger.setAttribute('aria-expanded', 'false');
      if (outside) {
        document.removeEventListener('pointerdown', outside, true);
        outside = null;
      }
      if (refocus && anchor.isConnected) {anchor.focus();}
    }
    function open(from: HTMLElement): void {
      anchor = from;
      // The empty state's "Other engines…" opens the same menu under itself.
      (from === trigger ? root : from.parentElement ?? root).append(menu);
      menu.hidden = false;
      trigger.setAttribute('aria-expanded', 'true');
      items[0]?.focus();
      outside = (e: Event) => {
        if (!menu.contains(e.target as Node) && e.target !== from) {close(false);}
      };
      document.addEventListener('pointerdown', outside, true);
    }
    trigger.addEventListener('click', () => (menu.hidden ? open(trigger) : close(true)));
    menu.addEventListener('keydown', (e: KeyboardEvent) => {
      const i = items.indexOf(document.activeElement as HTMLButtonElement);
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        const next = e.key === 'ArrowDown' ? (i + 1) % items.length : (i - 1 + items.length) % items.length;
        items[next].focus();
      } else if (e.key === 'Home' || e.key === 'End') {
        e.preventDefault();
        items[e.key === 'Home' ? 0 : items.length - 1].focus();
      } else if (e.key === 'Escape') {
        // Close the menu, not the modal.
        e.preventDefault();
        e.stopPropagation();
        close(true);
      } else if (e.key === 'Tab') {
        close(false);
      }
    });
    root.append(trigger, menu);
    return { root, open };
  }

  // ── Routing ───────────────────────────────────────────────────────────────

  const routingRow = ctx.makeRow('Routing', 'Which model serves each kind of task. Tasks on Default use the default model.');
  routingRow.classList.add('ai-section');
  const routingBody = el('div', 'ai-routing');
  routingRow.append(routingBody);

  let routingQueued = false;
  function scheduleRouting(): void {
    if (routingQueued) {return;}
    routingQueued = true;
    queueMicrotask(() => {
      routingQueued = false;
      renderRouting();
    });
  }

  function buildRouteSelect(current: AiRoute | null | undefined, req: RouteRequirements, o: { fk: string; ariaLabel: string; defaultText?: string }): HTMLSelectElement {
    const select = el('select', 'settings-input ai-route-select');
    select.dataset.fk = o.fk;
    select.setAttribute('aria-label', o.ariaLabel);
    const pairs = routePairs(draft, statusList(), req);
    const first = el('option', '', o.defaultText ?? (pairs.some((p) => p.selectable) ? 'Choose a model…' : draft.engines.length === 0 ? 'Add an engine first' : 'No model can serve this'));
    first.value = '';
    select.append(first);

    const currentKey = routeKey(current);
    if (current && !pairs.some((p) => routeKey(p) === currentKey)) {
      const gone = el('option', '', `${routeLabel(draft, current)} (not found)`);
      gone.value = currentKey;
      select.append(gone);
    }
    const byEngine = new Map<string, typeof pairs>();
    for (const p of pairs) {
      const list = byEngine.get(p.engineId) ?? [];
      list.push(p);
      byEngine.set(p.engineId, list);
    }
    for (const list of byEngine.values()) {
      const group = el('optgroup');
      group.label = `${list[0].engineName} (${list[0].isLocal ? 'local' : 'cloud'})`;
      for (const p of list) {
        // The engine repeats in the text because a closed select shows only the option.
        const o2 = el('option', '', `${p.engineName} · ${p.modelName}${p.note ? ` (${p.note})` : ''}`);
        o2.value = routeKey(p);
        o2.disabled = !p.selectable && routeKey(p) !== currentKey;
        group.append(o2);
      }
      select.append(group);
    }
    select.value = currentKey;
    if (select.value !== currentKey) {select.value = '';}
    return select;
  }

  function renderRouting(): void {
    if (tier !== 2) {return;}
    // Nothing to route until there is an engine; the empty state says what to do.
    routingRow.hidden = draft.engines.length === 0;
    keepFocus(routingBody, () => {
      routingBody.replaceChildren();

      // Default route and fallback.
      const defRow = ctx.makeRow('Default model', 'Serves every task without its own route. Needs chat.', 'inline');
      const defSelect = buildRouteSelect(draft.routing.default, DEFAULT_ROUTE_REQUIREMENTS, { fk: 'route:default', ariaLabel: 'Default model' });
      defSelect.addEventListener('change', () => {
        draft = { ...draft, routing: { ...draft.routing, default: parseRouteKey(defSelect.value) } };
        renderEngines();
        renderRouting();
      });
      defRow.append(defSelect);
      const defNote = taskRouteNote({ ...draft, routing: { ...draft.routing, tasks: {} } }, statusList(), 'chat');
      if (draft.routing.default && defNote) {defRow.append(note(defNote.level, defNote.text, 'ai-row-note'));}

      const fbField = ctx.makeSelectRow<AiFallbackMode>(
        'When a route is unavailable',
        'What to try when a task’s model is off, unreachable or lacks what the task needs. Fallback never moves a local route to a cloud engine unless you pick the last option.',
        draft.routing.fallback,
        AI_FALLBACK_MODES.map((m) => ({ value: m, label: FALLBACK_LABELS[m] })),
      );
      fbField.select.dataset.fk = 'route:fallback';
      fbField.select.addEventListener('change', () => {
        draft = { ...draft, routing: { ...draft.routing, fallback: fbField.select.value as AiFallbackMode } };
        renderRouting();
      });
      const top = ctx.makeGroup(defRow, fbField.row);

      // One row per task, plus tasks a newer version saved.
      const defaultText = draft.routing.default ? `Default: ${routeLabel(draft, draft.routing.default)}` : 'Default (none set)';
      const taskRows: HTMLElement[] = [];
      const taskRow = (taskId: string, label: string, description: string, req: RouteRequirements, hostOnly: boolean) => {
        const row = ctx.makeRow(label, description, 'inline');
        row.classList.add('ai-task-row');
        if (hostOnly) {
          row.append(el('span', 'ai-muted', 'Handled by the app'));
          taskRows.push(row);
          return;
        }
        const select = buildRouteSelect(draft.routing.tasks[taskId], req, { fk: `route:task:${taskId}`, ariaLabel: `Model for ${label}`, defaultText });
        select.addEventListener('change', () => {
          const tasks = { ...draft.routing.tasks };
          const route = parseRouteKey(select.value);
          // Spread the saved route so keys a newer version added survive.
          if (route) {tasks[taskId] = { ...(tasks[taskId] ?? {}), ...route };} else {delete tasks[taskId];}
          draft = { ...draft, routing: { ...draft.routing, tasks } };
          renderRouting();
        });
        row.append(select);
        const n = taskRouteNote(draft, statusList(), taskId);
        if (n) {row.append(note(n.level, n.text, 'ai-row-note'));}
        taskRows.push(row);
      };
      for (const task of AI_TASKS) {
        taskRow(task.id, task.label, task.description, taskRequirements(task.id), task.hostMethod === 'transcribe');
      }
      for (const taskId of unknownRoutedTasks(draft)) {
        taskRow(taskId, taskId, 'Saved by a newer version of MikeDown. Kept as is.', { requires: {} }, false);
      }
      const tasksHead = el('div', 'ai-subhead', 'Tasks');
      routingBody.append(top, tasksHead, ctx.makeGroup(...taskRows));
    });
  }

  // ── Features ──────────────────────────────────────────────────────────────

  const featuresRow = ctx.makeRow(
    'Features',
    tier === 2 ? 'Turn each feature on or off. A feature can use a different task’s route if you like.' : 'Turn each feature on or off.',
  );
  featuresRow.classList.add('ai-section');
  const featureRows: HTMLElement[] = [];
  for (const def of AI_FEATURES) {
    const planned = def.status === 'planned';
    const resolved = resolveAiFeature(draft.features, def.id);
    const row = el('div', 'settings-row settings-row--inline ai-feature');
    row.classList.toggle('is-planned', planned);
    const text = el('div', 'settings-row-text');
    const labelId = nextId('ai-feature');
    const lbl = el('span', 'settings-label', def.label);
    lbl.id = labelId;
    text.append(lbl, el('span', 'settings-desc', def.description));
    const defaultTask = getAiTask(def.defaultTask);
    const controls = el('div', 'ai-feature-controls');
    if (planned) {
      controls.append(el('span', 'ai-pill ai-pill--soon', 'Coming later'));
      row.setAttribute('aria-disabled', 'true');
    } else {
      if (tier === 2) {
        const select = el('select', 'settings-input settings-input--small');
        select.dataset.fk = `feature:${def.id}:task`;
        select.setAttribute('aria-label', `Task route for ${def.label}`);
        const dflt = el('option', '', `Default task (${defaultTask?.label ?? def.defaultTask})`);
        dflt.value = '';
        select.append(dflt);
        for (const task of AI_TASKS) {
          if (task.hostMethod) {continue;}
          const o = el('option', '', task.label);
          o.value = task.id;
          select.append(o);
        }
        const saved = draft.features[def.id]?.task;
        if (saved && !AI_TASKS.some((t) => t.id === saved)) {
          const o = el('option', '', saved);
          o.value = saved;
          select.append(o);
        }
        select.value = saved ?? '';
        select.addEventListener('change', () => {
          const entry = { ...(draft.features[def.id] ?? {}) };
          if (select.value) {entry.task = select.value;} else {delete entry.task;}
          draft = { ...draft, features: { ...draft.features, [def.id]: entry } };
        });
        controls.append(select);
      }
      const toggle = switchInput(resolved.enabled, def.label, `feature:${def.id}:enabled`);
      toggle.setAttribute('aria-labelledby', labelId);
      toggle.removeAttribute('aria-label');
      toggle.addEventListener('change', () => {
        draft = { ...draft, features: { ...draft.features, [def.id]: { ...(draft.features[def.id] ?? {}), enabled: toggle.checked } } };
      });
      controls.append(toggle);
    }
    row.append(text, controls);
    featureRows.push(row);
  }
  featuresRow.append(ctx.makeGroup(...featureRows));

  // ── Assemble ──────────────────────────────────────────────────────────────

  if (tier === 2) {
    rows.push(cloudField.row, enginesRow, routingRow);
    renderEngines();
    renderRouting();
  }
  rows.push(featuresRow, live);

  // Fresh statuses as the tab opens: the dots should not be stale.
  if (tier === 2 && ai.listEngines) {
    ai.listEngines().then((list) => {
      for (const s of list) {statuses.set(s.engineId, s);}
      opts.onStatuses(statusList());
      if (enginesRow.isConnected) {
        renderEngines();
        renderRouting();
      }
    }).catch(() => { /* keep the last known statuses */ });
  }

  return {
    rows,
    collect: () => changedAiPatch(original, draft),
    onSaved: () => {
      window.clearTimeout(liveTimer);
      if (ai.setSecret) {
        for (const id of deleted) {
          if (draft.engines.some((e) => e.id === id)) {continue;}
          ai.setSecret(id, null).catch(() => { /* the host also drops orphaned keys */ });
        }
      }
      opts.onSaved(cloneAiSettings(draft));
    },
  };
}
