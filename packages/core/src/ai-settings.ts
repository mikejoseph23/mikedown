/**
 * The Settings modal's AI tab. Built only when the host has an `ai` group
 * (see `editor.ts#showSettingsModal`), with the modal's own row builders so
 * it sits flush with the other tabs.
 *
 * Tier 1 hosts (`complete` only, they route by themselves) get the master
 * switch and the feature toggles. Tier 2 hosts (an engine registry) also get
 * Allow cloud, the engine list, routing, and quick-start cards for adding an
 * engine. Opening an engine shows its Express form (`ai-engine-form.ts`),
 * which owns fetching models, the models picker and the Advanced fold.
 *
 * Everything edits a draft copy of the settings; Save sends only the `ai.*`
 * keys that changed, through the modal's normal `saveSettings` patch. API
 * keys never touch the draft: the form stores them through
 * `host.ai.setSecret` as soon as the field settles, and a deleted engine's
 * key is dropped when the modal saves. Test connection and fetching models
 * need the host to know the engine, so when its connection fields differ
 * from what the host has they save the engines first and wait for the
 * host's settings echo. Closing without saving takes back engines added in
 * this session that were saved that way, and their keys.
 *
 * Modal UI only: nothing here touches the editor document or its DOM.
 */

import {
  AI_ENGINE_PRESETS,
  AI_FALLBACK_MODES,
  AI_FEATURES,
  AI_PRESET_FAMILIES,
  AI_TASKS,
  getAiTask,
  resolveAiFeature,
  serializeAiSettings,
  toAiError,
} from './ai';
import type {
  AiEngineConfig,
  AiEnginePreset,
  AiEngineStatus,
  AiFallbackMode,
  AiRoute,
  AiSettings,
  AiSettingsPatch,
  MikeDownAiHost,
} from './ai';
import {
  DEFAULT_ROUTE_REQUIREMENTS,
  aiHostTier,
  changedAiPatch,
  cloneAiSettings,
  connectionDiffers,
  defaultRouteForEngine,
  engineDisplayName,
  engineFromPreset,
  engineIssues,
  engineKindLabel,
  engineLocalityInfo,
  groupPresets,
  parseRouteKey,
  removeEngine,
  routeKey,
  routeLabel,
  routePairs,
  shortUrl,
  taskRequirements,
  taskRouteNote,
  unknownRoutedTasks,
  withEngine,
} from './ai-settings-model';
import type { RouteRequirements } from './ai-settings-model';
import { createEngineFormController } from './ai-engine-form';
import type { EngineFormRefresh } from './ai-engine-form';
import { ICONS, button, el, keepFocus, kindGlyphHtml, nextId, note, switchInput } from './ai-settings-dom';
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
  /** Statuses that arrive without the tab asking (a host push, a settings refresh). Returns an unsubscribe. */
  subscribeStatuses?(listener: (statuses: AiEngineStatus[]) => void): () => void;
  /** The modal saved; the draft is the new settings. */
  onSaved(draft: AiSettings): void;
}

/** How long Test and fetching models wait for the host to echo engines the tab just saved. */
const SAVE_ECHO_TIMEOUT_MS = 4000;

const FALLBACK_LABELS: Record<AiFallbackMode, string> = {
  none: 'Nothing (the feature is unavailable)',
  default: 'Use the default model',
  anyLocal: 'Default, then any local model',
  any: 'Default, any local, then cloud',
};

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
  /** Engines this session stored a key for; dropped again if the modal closes before the engine is saved. */
  const keysStored = new Set<string>();
  /** Engines added in this session (taken back from the host if the modal closes unsaved). */
  const added = new Set<string>();
  /** One-line notes under an engine row (the star found no model to make the default). */
  const rowNotes = new Map<string, { level: 'info' | 'warning'; text: string }>();
  let openEngineId: string | null = null;
  let confirmDeleteId: string | null = null;

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

  // The Express form for the open engine (ai-engine-form.ts); it owns fetching, the fold and the picker.
  const form = createEngineFormController({
    ai,
    getDraft: () => draft,
    setDraft: (next, refresh) => {
      draft = next;
      // Only the open engine's form edits the draft; a late fetch result may belong to another row.
      if (refresh.head && !refresh.list) {for (const e of draft.engines) {refreshHead(e.id);}}
      applyRefresh(openEngineId, { ...refresh, head: false });
    },
    refresh: (engineId, refresh) => applyRefresh(engineId, refresh),
    statuses,
    onStatuses: () => opts.onStatuses(statusList()),
    hasKey,
    setKey,
    ensureSaved,
    savesFirst: (engineId) => {
      const engine = getEngine(engineId);
      return !!opts.saveNow && !!engine && connectionDiffers(opts.getHostSettings().engines.find((e) => e.id === engineId), engine);
    },
    announce,
    focusKey,
  });

  let addOpen = false;
  function renderAdd(): void {
    keepFocus(addWrap, () => {
      addWrap.replaceChildren();
      addWrap.hidden = draft.engines.length === 0;
      if (draft.engines.length === 0) {return;}
      const trigger = button('settings-btn ai-add-btn', 'Add engine', { html: ICONS.plus, fk: 'add-engine' });
      const panelId = 'ai-add-panel';
      trigger.setAttribute('aria-expanded', String(addOpen));
      trigger.setAttribute('aria-controls', panelId);
      trigger.addEventListener('click', () => {
        addOpen = !addOpen;
        renderAdd();
        if (addOpen) {focusKey(`card:${AI_ENGINE_PRESETS[0].id}`);}
      });
      addWrap.append(trigger);
      if (addOpen) {
        const panel = buildPresetCards();
        panel.id = panelId;
        panel.addEventListener('keydown', (e) => {
          if (e.key === 'Escape') {
            // Close the cards, not the modal.
            e.preventDefault();
            e.stopPropagation();
            addOpen = false;
            renderAdd();
            focusKey('add-engine');
          }
        });
        addWrap.append(panel);
      }
    });
  }

  function renderEngines(): void {
    keepFocus(enginesBody, () => {
      enginesBody.replaceChildren();
      if (draft.engines.length === 0) {
        enginesBody.append(buildEmptyState());
      } else {
        const list = el('div', 'ai-engines');
        list.setAttribute('role', 'list');
        list.setAttribute('aria-label', 'Engines');
        for (const engine of draft.engines) {list.append(buildEngineItem(engine));}
        enginesBody.append(list);
      }
    });
    renderAdd();
  }

  /** The quick-start cards in two groups, with the "two ways to connect" line over each (design call 2). */
  function buildPresetCards(): HTMLElement {
    const groups = groupPresets(AI_ENGINE_PRESETS);
    const box = el('div', 'ai-cards');
    for (const family of AI_PRESET_FAMILIES) {
      const presets = groups[family.family];
      if (presets.length === 0) {continue;}
      const section = el('section', 'ai-cards-group');
      const headingId = nextId('ai-cards-heading');
      const heading = el('div', 'ai-cards-heading');
      heading.id = headingId;
      heading.innerHTML = family.family === 'local' ? ICONS.local : ICONS.cloud;
      heading.append(el('span', '', family.label));
      section.setAttribute('aria-labelledby', headingId);
      const grid = el('div', 'ai-cards-grid');
      grid.setAttribute('role', 'group');
      grid.setAttribute('aria-labelledby', headingId);
      for (const preset of presets) {
        const card = button('ai-card', '', { fk: `card:${preset.id}`, ariaLabel: `Add ${preset.name}` });
        card.innerHTML = kindGlyphHtml(preset.kind);
        const text = el('span', 'ai-card-text');
        text.append(el('span', 'ai-card-name', preset.name), el('span', 'ai-card-caption', preset.caption));
        card.append(text);
        card.title = preset.caption;
        card.addEventListener('click', () => addEngine(preset));
        grid.append(card);
      }
      section.append(heading, el('div', 'ai-cards-explainer', family.explainer), grid);
      box.append(section);
    }
    return box;
  }

  function buildEmptyState(): HTMLElement {
    const box = el('div', 'ai-empty');
    const lead = el('div', 'ai-empty-lead');
    lead.append(
      el('div', 'ai-empty-title', 'No engines yet'),
      el('div', 'ai-empty-text', 'Two ways to connect: run models on your own machine, or paste a cloud API key. Nothing is sent until AI is on.'),
    );
    box.append(lead, buildPresetCards());
    return box;
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

    // The pill already says "blocked"; an open form shows key, URL and locality problems at their fields.
    const issues = engineIssues(engine, draft, hasKey(engine.id)).filter((i) => i.code !== 'cloudBlocked'
      && !(isOpen && (i.code === 'badUrl' || i.code === 'localityMismatch' || i.code === 'noKey')));
    const rowNote = rowNotes.get(engine.id);
    if (issues.length > 0 || rowNote) {
      const box = el('div', 'ai-engine-issues');
      for (const i of issues) {box.append(note(i.level, i.text));}
      if (rowNote) {box.append(note(rowNote.level, rowNote.text, 'ai-result'));}
      item.append(box);
    }

    if (confirmDeleteId === engine.id) {item.append(buildDeleteConfirm(engine));}
    if (isOpen) {item.append(form.build(engine.id));}
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
    const picked = engine.models.filter((m) => !m.missing && m.enabled).length;
    const sub = el('div', 'ai-engine-sub');
    const subParts = [engineKindLabel(engine.kind), shortUrl(engine.baseUrl) || 'no address'];
    if (engine.models.length > 0) {subParts.push(picked === models ? `${models} ${models === 1 ? 'model' : 'models'}` : `${picked} of ${models} models`);}
    sub.textContent = subParts.join(' · ');
    main.append(titleLine, sub);
    // Clicking the name area opens the form, like a list of services.
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
    enabled.addEventListener('change', () => updateEngine(engine.id, { enabled: enabled.checked }, { list: true, routing: true }));

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
    const work = form.busy(engine.id);
    const badge = el('span', 'ai-status');
    const dot = el('span', 'ai-status-dot');
    dot.setAttribute('aria-hidden', 'true');
    const text = el('span', 'ai-status-text');
    let state: string;
    let label: string;
    let title: string;
    if (work) {
      state = 'busy';
      label = work === 'test' ? 'Testing…' : 'Fetching…';
      title = work === 'test' ? 'Testing the connection…' : 'Fetching models…';
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

  /** Store or clear a key; resolves with an error message, or null when it worked. */
  async function setKey(id: string, value: string | null): Promise<string | null> {
    const engine = getEngine(id);
    if (!engine || !ai.setSecret) {return 'This app cannot store keys.';}
    const name = engineDisplayName(engine);
    try {
      await ai.setSecret(id, value);
      keyOverride.set(id, value !== null);
      if (value !== null) {keysStored.add(id);} else {keysStored.delete(id);}
      announce(value !== null ? `API key stored for ${name}.` : `API key cleared for ${name}.`);
      refreshHead(id);
      return null;
    } catch (err) {
      const e = toAiError(err);
      announce(`The key for ${name} could not be ${value !== null ? 'stored' : 'cleared'}.`);
      return `The key could not be ${value !== null ? 'stored' : 'cleared'}: ${e.message}`;
    }
  }

  // ── Draft edits ───────────────────────────────────────────────────────────

  function updateEngine(id: string, patch: Partial<AiEngineConfig>, refresh: EngineFormRefresh): void {
    const current = getEngine(id);
    if (!current) {return;}
    draft = withEngine(draft, { ...current, ...patch });
    applyRefresh(id, refresh);
  }

  function applyRefresh(engineId: string | null, refresh: EngineFormRefresh): void {
    if (refresh.list) {
      renderEngines();
    } else {
      if (refresh.head && engineId) {refreshHead(engineId);}
      if (refresh.form && engineId) {rerenderForm(engineId);}
    }
    if (refresh.routing || refresh.list) {scheduleRouting();}
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

  /** Rebuild the open engine's form in place, keeping focus. */
  function rerenderForm(engineId: string): void {
    if (openEngineId !== engineId) {return;}
    const current = itemFor(engineId)?.querySelector<HTMLElement>('.ai-form');
    if (!current) {return;}
    keepFocus(current, () => {
      const fresh = form.build(engineId);
      current.replaceWith(fresh);
      return fresh;
    });
  }

  function focusKey(key: string): void {
    const n = Array.from(enginesRow.querySelectorAll<HTMLElement>('[data-fk]')).find((x) => x.dataset.fk === key);
    n?.focus({ preventScroll: true });
  }

  function toggleEditor(id: string, opts: { isNew?: boolean } = {}): void {
    openEngineId = openEngineId === id && !opts.isNew ? null : id;
    confirmDeleteId = null;
    rowNotes.delete(id);
    renderEngines();
    if (openEngineId === id) {
      const first = form.opened(id, opts);
      focusKey(first);
      if (opts.isNew && first.endsWith(':url')) {
        const input = document.activeElement;
        if (input instanceof HTMLInputElement) {input.select();}
      }
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
        rowNotes.set(engineId, { level: 'info', text: 'No model here can be the default yet. Pick or add a chat model first.' });
        announce(`${name} has no chat model to make the default yet.`);
        renderEngines();
        focusKey(`eng:${engineId}:star`);
        return;
      }
      draft = { ...draft, routing: { ...draft.routing, default: route } };
      announce(`Default model: ${routeLabel(draft, route)}.`);
    }
    rowNotes.delete(engineId);
    renderEngines();
    renderRouting();
  }

  function addEngine(preset: AiEnginePreset): void {
    const engine = engineFromPreset(preset, draft.engines.map((e) => e.id));
    draft = { ...draft, engines: [...draft.engines, engine] };
    added.add(engine.id);
    addOpen = false;
    renderRouting();
    toggleEditor(engine.id, { isNew: true });
    announce(preset.family === 'cloud' ? `Added ${engine.name}. Paste your API key.` : `Added ${engine.name}. Check the address; models are fetched from it.`);
  }

  function deleteEngine(id: string): void {
    const engine = getEngine(id);
    if (!engine) {return;}
    const index = draft.engines.findIndex((e) => e.id === id);
    draft = removeEngine(draft, id);
    deleted.add(id);
    rowNotes.delete(id);
    form.forget(id);
    if (openEngineId === id) {openEngineId = null;}
    confirmDeleteId = null;
    renderEngines();
    renderRouting();
    announce(`Deleted ${engineDisplayName(engine)}. Save to apply.`);
    const next = draft.engines[Math.min(index, draft.engines.length - 1)];
    if (next) {focusKey(`eng:${next.id}:edit`);} else {focusKey(`card:${AI_ENGINE_PRESETS[0].id}`);}
  }

  // ── Saving before the host reaches an engine ──────────────────────────────

  /** Make sure the host has this engine's connection fields before asking it to reach it. */
  async function ensureSaved(id: string): Promise<void> {
    const engine = getEngine(id);
    if (!engine || !opts.saveNow) {return;}
    if (!connectionDiffers(opts.getHostSettings().engines.find((e) => e.id === id), engine)) {return;}
    const patch = serializeAiSettings(draft);
    opts.saveNow({ 'ai.engines': patch['ai.engines'] });
    await opts.waitForSettings((s) => !connectionDiffers(s.engines.find((e) => e.id === id), engine), SAVE_ECHO_TIMEOUT_MS);
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

  // Statuses pushed while the tab is open refresh the dots and pickers in
  // place (no full rebuild, so typing is never interrupted).
  const unsubscribe = opts.subscribeStatuses?.((list) => {
    if (!enginesRow.isConnected) {return;}
    for (const s of list) {
      if (!form.busy(s.engineId)) {statuses.set(s.engineId, s);}
    }
    for (const engine of draft.engines) {refreshHead(engine.id);}
    scheduleRouting();
  });

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
    onDiscarded: () => {
      window.clearTimeout(liveTimer);
      unsubscribe?.();
      form.dispose();
      // Engines added in this session reach the host early (Test and fetching
      // save them first). Closing without saving takes them back.
      const host = opts.getHostSettings();
      if (opts.saveNow && host.engines.some((e) => added.has(e.id))) {
        const kept = { ...host, engines: host.engines.filter((e) => !added.has(e.id)) };
        opts.saveNow({ 'ai.engines': serializeAiSettings(kept)['ai.engines'] });
      }
      // The host keeps a key for an engine id it has never seen; if that
      // engine was never saved, nothing would ever clean it up.
      if (!ai.setSecret) {return;}
      const saved = new Set(host.engines.filter((e) => !added.has(e.id)).map((e) => e.id));
      for (const id of keysStored) {
        if (!saved.has(id)) {ai.setSecret(id, null).catch(() => { /* best effort */ });}
      }
    },
    onSaved: () => {
      window.clearTimeout(liveTimer);
      unsubscribe?.();
      form.dispose();
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
