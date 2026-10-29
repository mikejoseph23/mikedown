/**
 * The Express engine form (M3b): one engine's settings as a short sheet,
 * like a macOS "Add Account" form, with everything else folded under
 * Advanced.
 *
 * Express (design call 1): Name, API key (cloud, or a local server that
 * expects one), Base URL (local), Models (auto-fetched, a pick-or-type
 * combobox with a Popular group on cloud engines), Default model with its
 * Thinking level, Enabled. Advanced: kind, Base URL (cloud), locality, the key
 * on local servers that do not need one, key variable, key file, discovery
 * mode and the full M3 models table.
 *
 * Self-contained so the AI Engines page (M3c) can host it: the controller
 * owns the form's own state (fetches in flight, the Advanced fold, picker
 * filters, results) and reads and writes the settings draft only through
 * `EngineFormDeps`. It never touches the modal's layout or the editor.
 *
 * Fetching (design call 3): cloud engines store the key and fetch 600 ms
 * after the key field settles; local engines fetch when the URL changes and
 * when the form opens for an engine the host never probed. One discovery
 * runs per engine at a time; a newer trigger supersedes the running one,
 * whose result is dropped, and runs as soon as it settles.
 */

import { AI_ENGINE_KINDS, aiErrorCopy, aiProviderPolicy, isKnownEngineKind, thinkingChoices, thinkingLevelFrom, toAiError } from './ai';
import type { AiEngineConfig, AiEngineStatus, AiLocalitySetting, AiModelConfig, AiSettings, AiThinkingLevel, MikeDownAiHost } from './ai';
import {
  AI_CAPABILITY_CHIPS,
  AI_ENGINE_KIND_LABELS,
  addManualModel,
  applyDiscoveryForFamily,
  autoFetchDecision,
  autoPickDefault,
  baseUrlProblem,
  defaultRouteForEngine,
  discoveryProblem,
  engineDefaultModelId,
  engineDisplayName,
  engineKindLabel,
  engineLocalityInfo,
  enginePreset,
  expressFields,
  fetchFingerprint,
  formatRequestOverrides,
  formatTokens,
  modelCountLine,
  modelDisplayName,
  modelPickerOptions,
  parseContextTokens,
  parseRequestOverrides,
  popularModels,
  removeRoutesTo,
  setEngineDefaultModel,
  setModelContextTokens,
  setModelPicked,
  setModelThinking,
  toggleModelCapability,
  withEngine,
  withModel,
} from './ai-settings-model';
import type { AutoFetchEvent, AutoFetchState, DiscoveryProblem, EngineFormPreset, ModelPickerOption } from './ai-settings-model';
import { ICONS, button, el, keepFocus, nextId, note, privacyCard, switchInput } from './ai-settings-dom';

/** What else must re-render after a draft change made by the form. */
export interface EngineFormRefresh {
  /** The engine's row in the list (name, address, pills). */
  head?: boolean;
  /** The form itself (structure changed). */
  form?: boolean;
  /** The whole engine list (the enabled switch, the star). */
  list?: boolean;
  /** Routing pickers. */
  routing?: boolean;
}

export interface EngineFormDeps {
  ai: MikeDownAiHost;
  getDraft(): AiSettings;
  setDraft(next: AiSettings, refresh: EngineFormRefresh): void;
  /** Re-render without a draft change (busy dots, results). */
  refresh(engineId: string, refresh: EngineFormRefresh): void;
  /** Last known statuses, shared with the host of the form (it reads them for the row dots). */
  statuses: Map<string, AiEngineStatus>;
  /** `statuses` changed; tell the editor's cache and the indicator. */
  onStatuses(): void;
  hasKey(engineId: string): boolean;
  /** Where the key came from, when the host said; without it the form guesses from the engine's settings. */
  keySource?(engineId: string): 'file' | 'stored' | undefined;
  /** Store (or with null, clear) a key through `host.ai.setSecret`. Resolves with an error message, or null when it worked. */
  setKey(engineId: string, value: string | null): Promise<string | null>;
  /** Make sure the host has this engine's connection fields before reaching it. */
  ensureSaved(engineId: string): Promise<void>;
  /** True when Test and Fetch will save the engine first (the host has different connection fields). */
  savesFirst(engineId: string): boolean;
  announce(text: string): void;
  /** Focus the control with this `data-fk` inside the mounted form. */
  focusKey(key: string): void;
  /** Open an external link through the host (the provider's policy). Absent: a plain anchor. */
  openLink?: (href: string) => void;
}

export interface EngineFormController {
  /** The form for one engine. Rebuilt on every render; state lives in the controller. */
  build(engineId: string): HTMLElement;
  /**
   * The form was just opened: fetch models when design call 3 says so, and
   * return the `data-fk` to focus (key for a new cloud engine, URL for a new
   * local one, the name otherwise).
   */
  opened(engineId: string, opts?: { isNew?: boolean }): string;
  /** What the engine is busy with, for the row's status dot. */
  busy(engineId: string): 'test' | 'discover' | undefined;
  /** The engine was deleted: drop its timers and state. */
  forget(engineId: string): void;
  /** Stop every timer (the modal closed). */
  dispose(): void;
}

/** More models than this and the picker gets a filter field. */
const FILTER_THRESHOLD = 8;

const LOCALITY_LABELS: Record<Exclude<AiLocalitySetting, 'auto'>, string> = {
  local: 'Local',
  cloud: 'Cloud',
};

interface FetchState {
  /** Bumped by every trigger; a fetch whose number is stale drops its result. */
  seq: number;
  running: boolean;
  /** A newer trigger arrived while running: run again when it settles. */
  again: AutoFetchEvent | null;
  /** Pending settle timer (key field). */
  timer?: number;
  /** URL or key the last fetch ran for (see `autoFetchDecision`). */
  fetchedFor?: string;
  /** The event that set off the last fetch, for Retry. */
  lastEvent?: AutoFetchEvent;
  problem: DiscoveryProblem | null;
  /** The previous `autoFetchDecision` input. */
  prev: AutoFetchState | null;
}

export function createEngineFormController(deps: EngineFormDeps): EngineFormController {
  const { ai } = deps;
  const fetches = new Map<string, FetchState>();
  const testing = new Set<string>();
  /** Test connection results per engine. */
  const results = new Map<string, { level: 'ok' | 'error' | 'info'; text: string }>();
  /** Key store and clear messages per engine, shown under the key field. */
  const keyResults = new Map<string, { level: 'error' | 'info'; text: string }>();
  /** Advanced folds opened while the modal is open. */
  const advancedOpen = new Set<string>();
  /** "What is sent" disclosures opened while the modal is open. */
  const privacyOpen = new Set<string>();
  /** What the user typed into a key field (kept across rebuilds until the modal closes). */
  const keyText = new Map<string, string>();
  /** Last key text stored per engine, so a settle that changed nothing does not store again. */
  const keyStored = new Map<string, string>();
  const keyTimers = new Map<string, number>();
  const pickerFilter = new Map<string, string>();
  /** Engines whose "type a model id" field was opened (small lists hide it). */
  const typeOpen = new Set<string>();
  const openOverrides = new Set<string>();
  const overrideErrors = new Map<string, { text: string; error: string }>();

  const getEngine = (id: string) => deps.getDraft().engines.find((e) => e.id === id);
  const presetOf = (engine: AiEngineConfig): EngineFormPreset => enginePreset(engine, deps.getDraft().localNetworks);
  const isLocal = (engine: AiEngineConfig) => engineLocalityInfo(engine, deps.getDraft().localNetworks).locality === 'local';

  function fetchState(id: string): FetchState {
    let st = fetches.get(id);
    if (!st) {
      st = { seq: 0, running: false, again: null, problem: null, prev: null };
      fetches.set(id, st);
    }
    return st;
  }

  // ── Draft edits ───────────────────────────────────────────────────────────

  function replaceEngine(engine: AiEngineConfig, refresh: EngineFormRefresh): void {
    deps.setDraft(withEngine(deps.getDraft(), engine), refresh);
  }

  function updateEngine(id: string, patch: Partial<AiEngineConfig>, refresh: EngineFormRefresh): void {
    const current = getEngine(id);
    if (current) {replaceEngine({ ...current, ...patch }, refresh);}
  }

  function updateModel(engineId: string, modelId: string, fn: (m: AiModelConfig) => AiModelConfig, refresh: EngineFormRefresh): void {
    const engine = getEngine(engineId);
    const model = engine?.models.find((m) => m.id === modelId);
    if (engine && model) {replaceEngine(withModel(engine, fn(model)), refresh);}
  }

  // ── Fetching ──────────────────────────────────────────────────────────────

  function snapshot(engine: AiEngineConfig, event: AutoFetchEvent): AutoFetchState {
    const st = fetchState(engine.id);
    const status = deps.statuses.get(engine.id);
    return {
      event,
      family: presetOf(engine).family,
      key: keyText.get(engine.id) ?? '',
      baseUrl: engine.baseUrl,
      discovery: engine.discovery,
      neverProbed: !status || status.ok === null,
      fetchedFor: st.fetchedFor,
    };
  }

  /** Run `autoFetchDecision` for an event and act on it. */
  function trigger(id: string, event: AutoFetchEvent): void {
    const engine = getEngine(id);
    if (!engine || !ai.discoverModels) {return;}
    const st = fetchState(id);
    const next = snapshot(engine, event);
    const decision = autoFetchDecision(st.prev, next);
    st.prev = next;
    if (decision.cancelPending) {
      window.clearTimeout(st.timer);
      st.timer = undefined;
    }
    if (!decision.fetch) {return;}
    if (decision.delayMs > 0) {
      st.timer = window.setTimeout(() => {
        st.timer = undefined;
        void runFetch(id, event);
      }, decision.delayMs);
    } else {
      void runFetch(id, event);
    }
  }

  async function runFetch(id: string, event: AutoFetchEvent): Promise<void> {
    const st = fetchState(id);
    const seq = ++st.seq;
    st.lastEvent = event;
    if (st.running) {
      // One discovery per engine: this one runs when the current one settles.
      st.again = event;
      return;
    }
    const engine = getEngine(id);
    if (!engine || !ai.discoverModels) {return;}
    st.running = true;
    st.problem = null;
    deps.refresh(id, { form: true, head: true });
    const preset = presetOf(engine);
    const name = engineDisplayName(engine);
    try {
      // Discovery runs host side against the stored key, so a key still in the field goes first.
      const typed = (keyText.get(id) ?? '').trim();
      if (ai.setSecret && typed && keyStored.get(id) !== typed) {
        const error = await deps.setKey(id, typed);
        if (error) {throw new Error(error);}
        keyStored.set(id, typed);
      }
      await deps.ensureSaved(id);
      const status = await ai.discoverModels(id);
      if (!status || typeof status !== 'object') {throw new Error('The app returned no model list.');}
      deps.statuses.set(id, status);
      deps.onStatuses();
      if (seq !== st.seq) {return;}
      const current = getEngine(id) ?? engine;
      if (status.ok === false) {
        st.problem = discoveryProblem({ family: preset.family, presetName: preset.name, baseUrl: current.baseUrl, ok: false, message: status.error, listed: 0 });
      } else {
        const hadPick = current.models.some((m) => m.enabled && !m.missing);
        let draft = withEngine(deps.getDraft(), applyDiscoveryForFamily(current, status, preset.family));
        const merged = draft.engines.find((e) => e.id === id) ?? current;
        let picked: string | null = null;
        // OPEN-12: key = done. The first fetch with nothing picked picks the usual default.
        if (preset.family === 'cloud' && !hadPick) {
          picked = autoPickDefault(preset, merged.models);
          if (picked) {draft = setEngineDefaultModel(draft, id, picked);}
        }
        // The first engine that can chat becomes the default route, so it works without a trip to the star.
        if (!draft.routing.default) {
          const route = defaultRouteForEngine(draft, [...deps.statuses.values()], id);
          if (route) {draft = setEngineDefaultModel(draft, id, route.modelId);}
        }
        const listed = merged.models.filter((m) => !m.missing).length;
        st.problem = discoveryProblem({ family: preset.family, presetName: preset.name, baseUrl: current.baseUrl, ok: true, listed });
        st.fetchedFor = fetchFingerprint(preset.family, keyText.get(id) ?? '', current.baseUrl);
        forgetStoredText(id);
        deps.setDraft(draft, { head: true, routing: true, list: !hadPick && !!picked });
        const pickedName = picked ? modelDisplayName(merged.models.find((m) => m.id === picked) ?? { id: picked }) : '';
        deps.announce(`${name}: ${listed} ${listed === 1 ? 'model' : 'models'} found${pickedName ? `. ${pickedName} picked as the default model` : ''}.`);
      }
    } catch (err) {
      if (seq !== st.seq) {return;}
      const e = toAiError(err);
      const current = getEngine(id) ?? engine;
      st.problem = discoveryProblem({ family: preset.family, presetName: preset.name, baseUrl: current.baseUrl, ok: false, code: e.code, message: e.message, listed: 0 });
    } finally {
      st.running = false;
      const again = st.again;
      st.again = null;
      if (again && seq !== st.seq) {
        void runFetch(id, again);
      } else if (getEngine(id)) {
        if (st.problem && st.problem.kind !== 'empty') {deps.announce(`${name}: ${st.problem.text}`);}
        deps.refresh(id, { form: true, head: true });
        if (st.problem?.focus === 'key') {
          deps.focusKey(`eng:${id}:key`);
          const active = document.activeElement;
          if (active instanceof HTMLInputElement) {active.select();}
        }
      }
    }
  }

  /**
   * Once a key is stored and working, the field goes back to its "Stored"
   * placeholder (the field is write-only). Text typed since is kept.
   */
  function forgetStoredText(id: string): void {
    const typed = keyText.get(id);
    if (typed !== undefined && typed.trim() === keyStored.get(id)) {keyText.delete(id);}
  }

  /** The key field settled (or Enter / blur): store it, then fetch when the decision says so. */
  async function settleKey(id: string): Promise<void> {
    window.clearTimeout(keyTimers.get(id));
    keyTimers.delete(id);
    const engine = getEngine(id);
    const typed = (keyText.get(id) ?? '').trim();
    if (!engine || !typed || keyStored.get(id) === typed || !ai.setSecret) {return;}
    const error = await deps.setKey(id, typed);
    if (error) {
      keyResults.set(id, { level: 'error', text: error });
      deps.refresh(id, { form: true });
      return;
    }
    keyStored.set(id, typed);
    keyResults.delete(id);
    const st = fetchState(id);
    if (st.problem?.kind !== 'auth') {forgetStoredText(id);}
    // A local server that rejected the key gets a fresh fetch with the new one.
    if (presetOf(engine).family === 'local') {
      if (st.problem?.kind === 'auth') {void runFetch(id, 'retry');} else {deps.refresh(id, { form: true });}
      return;
    }
    deps.refresh(id, { form: true });
  }

  async function runTest(id: string): Promise<void> {
    const engine = getEngine(id);
    if (!engine || !ai.testEngine || testing.has(id)) {return;}
    const name = engineDisplayName(engine);
    testing.add(id);
    results.delete(id);
    deps.refresh(id, { form: true, head: true });
    try {
      await deps.ensureSaved(id);
      const status = await ai.testEngine(id);
      deps.statuses.set(id, status);
      deps.onStatuses();
      if (status.ok) {
        const ms = status.latencyMs !== undefined ? ` in ${Math.round(status.latencyMs)} ms` : '';
        const n = status.models.filter((m) => !m.missing).length;
        const text = `Connected${ms}${n ? `. The server lists ${n} ${n === 1 ? 'model' : 'models'}.` : '.'}`;
        results.set(id, { level: 'ok', text });
        deps.announce(`${name}: ${text}`);
      } else {
        const text = `Failed${status.error ? `: ${status.error}` : '. The server did not answer.'}`;
        results.set(id, { level: 'error', text });
        deps.announce(`${name}: connection ${text.toLowerCase()}`);
      }
    } catch (err) {
      const e = toAiError(err);
      const copy = aiErrorCopy(e.code);
      const text = `${copy.title}${e.message && e.message !== copy.title ? `: ${e.message}` : '.'}`;
      results.set(id, { level: 'error', text });
      deps.announce(`${name}: ${text}`);
    } finally {
      testing.delete(id);
      deps.refresh(id, { form: true, head: true, routing: true });
      deps.focusKey(`eng:${id}:test`);
    }
  }

  // ── The form ──────────────────────────────────────────────────────────────

  function build(id: string): HTMLElement {
    const engine = getEngine(id);
    const wrap = el('div', 'ai-form');
    wrap.id = `ai-engine-editor-${id}`;
    if (!engine) {return wrap;}
    const preset = presetOf(engine);
    const fields = expressFields(preset);
    wrap.dataset.family = preset.family;
    wrap.setAttribute('role', 'group');
    wrap.setAttribute('aria-label', `${engineDisplayName(engine)} settings`);

    // Cloud: what happens to the text, folded at the head of the form.
    if (preset.family === 'cloud') {
      wrap.append(privacyCard({ policy: aiProviderPolicy(engine) }, {
        collapsed: 'What is sent',
        open: privacyOpen.has(id),
        onToggle: (open) => { if (open) {privacyOpen.add(id);} else {privacyOpen.delete(id);} },
        openLink: deps.openLink,
        className: 'ai-form-privacy',
      }));
    }

    const sheet = el('div', 'ai-sheet');
    for (const field of fields.express) {
      const row = buildExpressField(engine, preset, field);
      if (row) {sheet.append(row);}
    }
    wrap.append(sheet, buildActions(engine), ...buildAdvanced(engine, preset, fields.advanced));
    return wrap;
  }

  /** One labelled line of the sheet: label column, control, optional caption. */
  function sheetRow(label: string, control: HTMLElement, opts: { forId?: string; caption?: HTMLElement | string; className?: string } = {}): HTMLElement {
    const row = el('div', `ai-sheet-row${opts.className ? ` ${opts.className}` : ''}`);
    const lbl = el('label', 'ai-sheet-label', label);
    if (opts.forId) {lbl.htmlFor = opts.forId;}
    const body = el('div', 'ai-sheet-body');
    body.append(control);
    if (opts.caption) {
      body.append(typeof opts.caption === 'string' ? el('div', 'ai-caption', opts.caption) : opts.caption);
    }
    row.append(lbl, body);
    return row;
  }

  function buildExpressField(engine: AiEngineConfig, preset: EngineFormPreset, field: string): HTMLElement | null {
    switch (field) {
      case 'name': return buildName(engine);
      case 'key': return buildKey(engine, preset);
      case 'baseUrl': return buildUrl(engine, preset, 'express');
      case 'models': return buildModelsPicker(engine, preset);
      case 'defaultModel': return buildDefaultModel(engine);
      case 'enabled': return buildEnabled(engine);
      default: return null; // `thinking` sits next to Default model.
    }
  }

  function buildName(engine: AiEngineConfig): HTMLElement {
    const id = engine.id;
    const input = el('input', 'settings-input ai-sheet-input');
    input.type = 'text';
    input.id = nextId('ai-name');
    input.value = engine.name;
    input.placeholder = 'Shown in pickers and the indicator';
    input.dataset.fk = `eng:${id}:name`;
    input.addEventListener('input', () => updateEngine(id, { name: input.value }, { head: true, routing: true }));
    return sheetRow('Name', input, { forId: input.id });
  }

  // ── API key ───────────────────────────────────────────────────────────────

  function buildKey(engine: AiEngineConfig, preset: EngineFormPreset): HTMLElement | null {
    if (!ai.setSecret) {return null;}
    const id = engine.id;
    const has = deps.hasKey(id);
    const line = el('div', 'ai-key');
    const input = el('input', 'settings-input settings-input--grow ai-mono');
    input.type = 'password';
    input.id = nextId('ai-key');
    input.autocomplete = 'off';
    input.spellcheck = false;
    input.dataset.fk = `eng:${id}:key`;
    input.setAttribute('aria-label', `API key for ${engineDisplayName(engine)}`);
    input.value = keyText.get(id) ?? '';
    const source = has ? deps.keySource?.(id) : undefined;
    const fromFile = has && (source ? source === 'file' : !keyStored.has(id) && !!engine.apiKeyFile?.path);
    input.placeholder = fromFile ? 'Found' : has ? 'Stored' : 'Paste your key';
    const problem = fetchState(id).problem;
    if (problem?.kind === 'auth') {input.setAttribute('aria-invalid', 'true');}
    input.addEventListener('input', () => {
      keyText.set(id, input.value);
      input.removeAttribute('aria-invalid');
      window.clearTimeout(keyTimers.get(id));
      const st = fetchState(id);
      if (presetOf(getEngine(id) ?? engine).family === 'cloud') {
        // Cloud: the decision stores the key and fetches once the field settles.
        trigger(id, 'key');
        if (!st.timer && input.value.trim()) {keyTimers.set(id, window.setTimeout(() => { void settleKey(id); }, 600));}
      } else if (input.value.trim()) {
        keyTimers.set(id, window.setTimeout(() => { void settleKey(id); }, 600));
      }
    });
    const flush = () => {
      const st = fetchState(id);
      if (st.timer) {
        // A cloud fetch was waiting for the field to settle: run it now.
        window.clearTimeout(st.timer);
        st.timer = undefined;
        void runFetch(id, 'key');
      } else if (keyTimers.has(id)) {
        void settleKey(id);
      }
    };
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); flush(); } });
    input.addEventListener('blur', flush);
    line.append(input);
    if (has) {
      const clear = button('settings-btn', 'Clear', { fk: `eng:${id}:key-clear`, ariaLabel: `Clear the stored API key for ${engineDisplayName(engine)}` });
      clear.addEventListener('click', () => { void clearKey(id); });
      line.append(clear);
    }

    const caption = el('div', 'ai-caption ai-key-caption');
    const result = keyResults.get(id);
    if (result) {
      caption.append(note(result.level, result.text));
    } else if (fromFile) {
      caption.innerHTML = `<span class="ai-key-state">${ICONS.check}<span>Key found</span></span>`;
      caption.append(` in ${engine.apiKeyFile?.path ?? 'the key file'}${source ? '' : ' (or stored here)'}. Paste a key to use another one.`);
    } else if (has) {
      caption.innerHTML = `<span class="ai-key-state">${ICONS.check}<span>Stored</span></span>`;
      caption.append(' in the system’s secure storage. Paste a new key to replace it.');
    } else {
      caption.textContent = preset.keyHint;
    }
    return sheetRow('API key', line, { forId: input.id, caption, className: 'ai-key-row' });
  }

  async function clearKey(id: string): Promise<void> {
    const engine = getEngine(id);
    if (!engine) {return;}
    keyText.delete(id);
    keyStored.delete(id);
    const error = await deps.setKey(id, null);
    keyResults.set(id, error
      ? { level: 'error', text: error }
      : { level: 'info', text: engine.apiKeyEnv ? `Key cleared. ${engine.apiKeyEnv} is used if it is set.` : engine.apiKeyFile ? 'Key cleared. The key file is used if it has a key.' : 'Key cleared.' });
    deps.refresh(id, { form: true, head: true });
    deps.focusKey(`eng:${id}:key`);
  }

  // ── Base URL ──────────────────────────────────────────────────────────────

  function buildUrl(engine: AiEngineConfig, preset: EngineFormPreset, where: 'express' | 'advanced'): HTMLElement {
    const id = engine.id;
    const input = el('input', 'settings-input ai-sheet-input ai-mono');
    input.type = 'url';
    input.id = nextId('ai-url');
    input.spellcheck = false;
    input.autocomplete = 'off';
    input.placeholder = 'http://127.0.0.1:8000/v1';
    input.value = engine.baseUrl;
    input.dataset.fk = `eng:${id}:url`;
    const error = el('div', 'ai-field-error');
    error.id = nextId('ai-url-error');
    error.setAttribute('aria-live', 'polite');
    input.setAttribute('aria-describedby', error.id);
    const show = () => {
      const problem = baseUrlProblem(input.value);
      error.textContent = problem;
      input.setAttribute('aria-invalid', String(!!problem));
    };
    input.addEventListener('input', () => {
      updateEngine(id, { baseUrl: input.value.trim() }, { head: true });
      // Keep a half-typed address quiet; flag it once it stops looking like one.
      if (error.textContent) {show();}
    });
    // `change` fires on blur after an edit: the URL settled, so fetch from it.
    input.addEventListener('change', () => {
      show();
      deps.refresh(id, { routing: true });
      if (preset.family === 'local') {trigger(id, 'url');}
    });
    if (engine.baseUrl) {show();}
    const body = el('div', 'ai-url');
    body.append(input, error);
    const caption = where === 'express' ? 'The one thing that changes per machine. Usually ends in /v1.' : 'The server address. Cloud presets fill it in.';
    return sheetRow('Base URL', body, { forId: input.id, caption });
  }

  // ── Models picker ─────────────────────────────────────────────────────────

  function buildModelsPicker(engine: AiEngineConfig, preset: EngineFormPreset): HTMLElement {
    const id = engine.id;
    const st = fetchState(id);
    const box = el('div', 'ai-picker');
    const labelId = nextId('ai-models-label');
    const listId = nextId('ai-models-list');

    // Head: label with a spinner while fetching, the count, Fetch models.
    const head = el('div', 'ai-picker-head');
    const label = el('span', 'ai-picker-label', 'Models');
    label.id = labelId;
    if (st.running) {
      const spin = el('span', 'ai-spinner');
      spin.setAttribute('aria-hidden', 'true');
      label.append(spin);
      box.setAttribute('aria-busy', 'true');
    }
    const count = el('span', 'ai-models-count', st.running ? 'Fetching…' : modelCountLine(engine));
    head.append(label, count);
    if (ai.discoverModels) {
      const fetchBtn = button('ai-link-btn', 'Fetch models', { html: ICONS.refresh, fk: `eng:${id}:fetch` });
      const urlBad = !!baseUrlProblem(engine.baseUrl);
      if (st.running) {fetchBtn.setAttribute('aria-disabled', 'true');}
      fetchBtn.disabled = engine.discovery === 'manual' || urlBad;
      if (engine.discovery === 'manual') {fetchBtn.title = 'The model list is manual for this engine (see Advanced).';}
      fetchBtn.addEventListener('click', () => {
        if (!st.running) {trigger(id, 'manual');}
      });
      head.append(fetchBtn);
    }
    box.append(head);

    const listed = engine.models.filter((m) => !m.missing).length;
    const showInput = engine.models.length > FILTER_THRESHOLD || engine.models.length === 0 || typeOpen.has(id) || !!pickerFilter.get(id);
    const popularIds = preset.family === 'cloud' ? popularModels(preset, engine.models).map((m) => m.id) : [];

    // Combobox: filter, pick or type (design call 6).
    let input: HTMLInputElement | null = null;
    if (showInput) {
      const field = el('div', 'ai-combo');
      const icon = el('span', 'ai-combo-icon');
      icon.innerHTML = ICONS.search;
      input = el('input', 'settings-input ai-combo-input');
      input.type = 'text';
      input.spellcheck = false;
      input.autocomplete = 'off';
      input.dataset.fk = `eng:${id}:pick`;
      input.setAttribute('role', 'combobox');
      input.setAttribute('aria-expanded', 'true');
      input.setAttribute('aria-controls', listId);
      input.setAttribute('aria-autocomplete', 'list');
      input.setAttribute('aria-label', engine.models.length > 0 ? `Filter models of ${engineDisplayName(engine)}, or type a model id to add it` : `Type a model id for ${engineDisplayName(engine)}`);
      input.placeholder = engine.models.length > FILTER_THRESHOLD ? `Search ${listed} models, or type an id` : 'Type a model id, then Enter';
      input.value = pickerFilter.get(id) ?? '';
      field.append(icon, input);
      box.append(field);
    }

    const list = el('ul', 'ai-listbox');
    list.id = listId;
    list.setAttribute('role', 'listbox');
    list.setAttribute('aria-multiselectable', 'true');
    list.setAttribute('aria-labelledby', labelId);
    // Without the text field the list takes focus itself.
    if (!input) {
      list.tabIndex = 0;
      list.dataset.fk = `eng:${id}:models`;
    }
    box.append(list);

    let active = -1;
    let options: ModelPickerOption[] = [];
    const optionId = (i: number) => `${listId}-o${i}`;
    const focusTarget = () => input ?? list;

    /** Highlight option `i` (-1: none). */
    function setActive(i: number): void {
      active = i >= 0 && i < options.length ? i : -1;
      list.querySelectorAll('.ai-option.is-active').forEach((n) => n.classList.remove('is-active'));
      const target = focusTarget();
      if (active < 0) {
        target.removeAttribute('aria-activedescendant');
        return;
      }
      const node = Array.from(list.querySelectorAll<HTMLElement>('.ai-option')).find((n) => n.id === optionId(active));
      node?.classList.add('is-active');
      node?.scrollIntoView?.({ block: 'nearest' });
      target.setAttribute('aria-activedescendant', optionId(active));
    }

    function renderList(): void {
      const filter = pickerFilter.get(id) ?? '';
      const current = getEngine(id) ?? engine;
      const all = modelPickerOptions(current, deps.statuses.get(id), filter);
      const popular = all.filter((o) => popularIds.includes(o.id)).sort((a, b) => popularIds.indexOf(a.id) - popularIds.indexOf(b.id));
      const rest = all.filter((o) => !popularIds.includes(o.id));
      options = [...popular, ...rest];
      list.replaceChildren();
      let index = 0;
      const group = (title: string, items: ModelPickerOption[]) => {
        if (items.length === 0) {return;}
        const g = el('li', 'ai-listbox-group');
        g.setAttribute('role', 'presentation');
        const heading = el('div', 'ai-listbox-heading', title);
        heading.id = nextId('ai-group');
        const ul = el('ul', 'ai-listbox-items');
        ul.setAttribute('role', 'group');
        ul.setAttribute('aria-labelledby', heading.id);
        for (const o of items) {ul.append(optionNode(o, index++));}
        g.append(heading, ul);
        list.append(g);
      };
      if (popular.length > 0) {
        group('Popular', popular);
        group('All models', rest);
      } else {
        for (const o of rest) {list.append(optionNode(o, index++));}
      }
      if (options.length === 0) {
        const empty = el('li', 'ai-listbox-empty');
        empty.setAttribute('role', 'presentation');
        empty.textContent = filter.trim()
          ? `No model matches “${filter.trim()}”. Press Enter to add it by id.`
          : st.running
            ? 'Fetching models…'
            : preset.family === 'cloud' && !deps.hasKey(id) && !(keyText.get(id) ?? '').trim()
              ? 'Paste your key and the models appear here.'
              : 'No models yet. Fetch them from the server, or type an id.';
        list.append(empty);
      }
      setActive(Math.min(active, options.length - 1));
    }

    function optionNode(o: ModelPickerOption, i: number): HTMLElement {
      const li = el('li', 'ai-option');
      li.id = optionId(i);
      li.setAttribute('role', 'option');
      li.setAttribute('aria-selected', String(o.enabled));
      li.dataset.modelId = o.id;
      li.classList.toggle('is-missing', o.missing);
      li.classList.toggle('is-on', o.enabled);
      const check = el('span', 'ai-option-check');
      check.setAttribute('aria-hidden', 'true');
      check.innerHTML = ICONS.check;
      const names = el('span', 'ai-option-names');
      names.append(el('span', 'ai-option-name', o.name));
      if (o.hasLabel) {names.append(el('span', 'ai-option-id', o.id));}
      li.append(check, names);
      const tags = el('span', 'ai-option-tags');
      if (o.loaded) {
        const t = el('span', 'ai-tag ai-tag--loaded', 'loaded');
        t.title = 'Loaded in memory on the server right now.';
        tags.append(t);
      }
      if (o.missing) {
        const t = el('span', 'ai-tag ai-tag--missing', 'not listed');
        t.title = 'The last fetch did not list this model. It is kept, but never routed.';
        tags.append(t);
      }
      if (o.manual) {tags.append(el('span', 'ai-tag', 'typed in'));}
      if (tags.childElementCount > 0) {li.append(tags);}
      // Keep focus in the field while clicking a row.
      li.addEventListener('mousedown', (e) => e.preventDefault());
      li.addEventListener('click', () => {
        active = i;
        toggle(o.id);
      });
      return li;
    }

    function toggle(modelId: string): void {
      const current = getEngine(id);
      const model = current?.models.find((m) => m.id === modelId);
      if (!current || !model) {return;}
      const enabled = !model.enabled;
      deps.setDraft(setModelPicked(deps.getDraft(), id, modelId, enabled), { head: true, routing: true });
      deps.announce(`${modelDisplayName(model)} ${enabled ? 'picked' : 'removed'}.`);
      refreshAfterPick();
    }

    /** Rebuild the parts a pick changes (count, Default model) without dropping focus or the scroll position. */
    function refreshAfterPick(): void {
      const scroll = list.scrollTop;
      const current = getEngine(id) ?? engine;
      count.textContent = modelCountLine(current);
      renderList();
      list.scrollTop = scroll;
      const form = box.closest('.ai-form');
      const def = form?.querySelector('.ai-default-row');
      const fresh = buildDefaultModel(current);
      if (def && fresh) {keepFocus(def as HTMLElement, () => { def.replaceWith(fresh); return fresh; });}
      focusTarget().focus({ preventScroll: true });
    }

    function addTyped(text: string): void {
      const current = getEngine(id);
      if (!current) {return;}
      const exact = current.models.find((m) => m.id === text);
      if (exact) {
        if (!exact.enabled) {toggle(exact.id);}
        return;
      }
      const r = addManualModel(current, text);
      if (!r.ok) {
        deps.announce(r.error);
        return;
      }
      let next = withEngine(deps.getDraft(), r.engine);
      // Like a pick: with no default route yet, a typed chat model becomes it.
      if (!next.routing.default && r.model.capabilities.chat && r.engine.enabled) {next = setEngineDefaultModel(next, id, r.model.id);}
      deps.setDraft(next, { head: true, list: !deps.getDraft().routing.default && !!next.routing.default, routing: true });
      pickerFilter.delete(id);
      // Keep the field after a typed id, even on a short list, so the next one can follow.
      typeOpen.add(id);
      deps.announce(`Added ${r.model.id}.`);
      deps.refresh(id, { form: true });
      deps.focusKey(`eng:${id}:pick`);
    }

    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        if (options.length === 0) {return;}
        const step = e.key === 'ArrowDown' ? 1 : -1;
        setActive(active < 0 ? (step > 0 ? 0 : options.length - 1) : (active + step + options.length) % options.length);
      } else if (e.key === 'Home' && !input) {
        e.preventDefault();
        setActive(0);
      } else if (e.key === 'End' && !input) {
        e.preventDefault();
        setActive(options.length - 1);
      } else if (e.key === 'Enter' || (e.key === ' ' && !input)) {
        e.preventDefault();
        const typed = input?.value.trim() ?? '';
        if (active >= 0 && options[active]) {toggle(options[active].id);} else if (typed) {addTyped(typed);}
      } else if (e.key === 'Escape') {
        // Clear the filter or the highlight first; only a calm field lets Escape close the modal.
        if (input?.value) {
          e.preventDefault();
          e.stopPropagation();
          input.value = '';
          pickerFilter.delete(id);
          active = -1;
          renderList();
        } else if (active >= 0) {
          e.preventDefault();
          e.stopPropagation();
          setActive(-1);
        }
      }
    };
    if (input) {
      const field = input;
      field.addEventListener('keydown', onKey);
      field.addEventListener('input', () => {
        pickerFilter.set(id, field.value);
        active = field.value.trim() ? 0 : -1;
        renderList();
      });
    } else {
      list.addEventListener('keydown', onKey);
      list.addEventListener('focus', () => { if (active < 0 && options.length > 0) {setActive(0);} });
    }
    renderList();

    // Small lists hide the field; typing an id is one click away.
    if (!input) {
      const typeBtn = button('ai-link-btn ai-type-btn', 'Type a model id…', { fk: `eng:${id}:type-open` });
      typeBtn.addEventListener('click', () => {
        typeOpen.add(id);
        deps.refresh(id, { form: true });
        deps.focusKey(`eng:${id}:pick`);
      });
      box.append(typeBtn);
    }

    // Failures and the empty list (design call 4).
    const problem = st.problem;
    if (problem && !st.running) {
      const line = el('div', `ai-fetch-note ai-fetch-note--${problem.kind}`);
      line.setAttribute('role', 'status');
      line.append(note(problem.kind === 'empty' ? 'info' : 'error', problem.text));
      if (problem.retry && ai.discoverModels) {
        const retry = button('ai-link-btn', 'Retry', { fk: `eng:${id}:retry` });
        retry.addEventListener('click', () => {
          // Retry re-runs the same trigger (a key fetch stores the field first, as before).
          void runFetch(id, st.lastEvent ?? 'retry');
        });
        line.append(retry);
      }
      box.append(line);
    }

    const row = el('div', 'ai-sheet-row ai-sheet-row--block');
    row.append(box);
    return row;
  }

  // ── Default model and thinking ────────────────────────────────────────────

  function buildDefaultModel(engine: AiEngineConfig): HTMLElement | null {
    const id = engine.id;
    const draft = deps.getDraft();
    const enabled = engine.models.filter((m) => m.enabled && !m.missing);
    const current = engineDefaultModelId(draft, id);
    const line = el('div', 'ai-default');
    const select = el('select', 'settings-input ai-default-select');
    select.id = nextId('ai-default');
    select.dataset.fk = `eng:${id}:default-model`;
    if (enabled.length === 0) {
      const o = el('option', '', 'Pick a model above');
      o.value = '';
      select.append(o);
      select.disabled = true;
    } else {
      for (const m of enabled) {
        const o = el('option', '', modelDisplayName(m));
        o.value = m.id;
        select.append(o);
      }
      select.value = current ?? enabled[0].id;
    }
    select.addEventListener('change', () => {
      deps.setDraft(setEngineDefaultModel(deps.getDraft(), id, select.value), { head: true, list: true, routing: true });
      const model = getEngine(id)?.models.find((m) => m.id === select.value);
      if (model) {deps.announce(`Default model: ${modelDisplayName(model)}.`);}
    });
    line.append(select);

    // Thinking applies to the default model; kinds with no known mapping hide it.
    const model = engine.models.find((m) => m.id === (current ?? enabled[0]?.id));
    const thinking = model ? buildThinkingSelect(engine, model, 'express') : null;
    if (thinking) {
      const wrap = el('label', 'ai-thinking');
      wrap.append(el('span', 'ai-thinking-label', 'Thinking'), thinking);
      line.append(wrap);
    }
    const isDefaultEngine = draft.routing.default?.engineId === id;
    const caption = enabled.length === 0
      ? 'Pick at least one model to use this engine.'
      : isDefaultEngine
        ? 'Serves every task without its own route.'
        : draft.routing.default
          ? 'Used when this engine is picked for a task, or made the default (the star).'
          : 'Becomes the default route once you pick it.';
    return sheetRow('Default model', line, { forId: select.id, caption, className: 'ai-default-row' });
  }

  function buildThinkingSelect(engine: AiEngineConfig, model: AiModelConfig, where: 'express' | 'table'): HTMLSelectElement | null {
    const choices = thinkingChoices(engine.kind);
    if (choices.length === 0) {return null;}
    const id = engine.id;
    const select = el('select', `settings-input ${where === 'table' ? 'settings-input--small ' : ''}ai-thinking-select`);
    select.dataset.fk = where === 'express' ? `eng:${id}:thinking` : `model:${id}:${model.id}:thinking`;
    select.setAttribute('aria-label', `Thinking for ${modelDisplayName(model)}`);
    select.title = 'How hard the model thinks before it answers. Model default sends nothing.';
    const dflt = el('option', '', where === 'table' ? 'Default' : 'Model default');
    dflt.value = '';
    select.append(dflt);
    for (const c of choices) {
      const o = el('option', '', c.label);
      o.value = c.level;
      select.append(o);
    }
    select.value = thinkingLevelFrom(engine.kind, model.requestOverrides) ?? '';
    select.addEventListener('change', () => {
      const level = (select.value || null) as AiThinkingLevel | null;
      const current = getEngine(id);
      if (!current) {return;}
      updateModel(id, model.id, (m) => setModelThinking(m, current.kind, level, isLocal(current)), {});
      // The overrides editor under Advanced shows the same JSON.
      if (advancedOpen.has(id)) {deps.refresh(id, { form: true });}
    });
    return select;
  }

  function buildEnabled(engine: AiEngineConfig): HTMLElement {
    const id = engine.id;
    const toggle = switchInput(engine.enabled, `Enable ${engineDisplayName(engine)}`, `eng:${id}:enabled`);
    toggle.id = nextId('ai-enabled');
    toggle.addEventListener('change', () => updateEngine(id, { enabled: toggle.checked }, { list: true, routing: true }));
    const line = el('div', 'ai-enabled-line');
    line.append(toggle, el('span', 'ai-caption', 'Engines that are off are never routed.'));
    return sheetRow('Enabled', line, { forId: toggle.id });
  }

  // ── Test connection ───────────────────────────────────────────────────────

  function buildActions(engine: AiEngineConfig): HTMLElement {
    const id = engine.id;
    const row = el('div', 'ai-form-actions');
    if (ai.testEngine) {
      const busy = testing.has(id);
      const test = button('settings-btn settings-btn--secondary', busy ? 'Testing…' : 'Test connection', { fk: `eng:${id}:test` });
      // Busy buttons stay focusable (aria-disabled) so the keyboard is not dropped mid-probe.
      if (busy) {test.setAttribute('aria-disabled', 'true');}
      test.disabled = !!baseUrlProblem(engine.baseUrl);
      test.addEventListener('click', () => { void runTest(id); });
      row.append(test);
      if (deps.savesFirst(id)) {row.append(el('span', 'ai-caption', 'Testing saves this engine first, so the app can reach it.'));}
    }
    const result = results.get(id);
    if (result) {row.append(note(result.level, result.text, 'ai-result'));}
    return row;
  }

  // ── Advanced ──────────────────────────────────────────────────────────────

  function buildAdvanced(engine: AiEngineConfig, preset: EngineFormPreset, fields: string[]): HTMLElement[] {
    const id = engine.id;
    const open = advancedOpen.has(id);
    const panelId = `ai-advanced-${id}`;
    const toggle = button('ai-disclosure', 'Advanced', { html: ICONS.chevron, fk: `eng:${id}:advanced` });
    toggle.setAttribute('aria-expanded', String(open));
    toggle.setAttribute('aria-controls', panelId);
    toggle.addEventListener('click', () => {
      if (advancedOpen.has(id)) {advancedOpen.delete(id);} else {advancedOpen.add(id);}
      deps.refresh(id, { form: true });
      deps.focusKey(`eng:${id}:advanced`);
    });
    const panel = el('div', 'ai-advanced');
    panel.id = panelId;
    panel.hidden = !open;
    if (!open) {return [toggle, panel];}

    const rows: HTMLElement[] = [];
    for (const field of fields) {
      if (field === 'kind') {rows.push(buildKind(engine));}
      if (field === 'baseUrl') {rows.push(buildUrl(engine, preset, 'advanced'));}
      if (field === 'locality') {rows.push(buildLocality(engine));}
      if (field === 'key') {
        const key = buildKey(engine, preset);
        if (key) {rows.push(key);}
      }
      if (field === 'keyEnv') {rows.push(buildKeyEnv(engine));}
      if (field === 'keyFile') {rows.push(buildKeyFile(engine));}
      if (field === 'discovery') {rows.push(buildDiscovery(engine));}
    }
    const sheet = el('div', 'ai-sheet ai-sheet--advanced');
    sheet.append(...rows);
    panel.append(sheet);
    if (fields.includes('modelsTable')) {panel.append(buildModelsTable(engine));}
    return [toggle, panel];
  }

  function buildKind(engine: AiEngineConfig): HTMLElement {
    const id = engine.id;
    const select = el('select', 'settings-input');
    select.id = nextId('ai-kind');
    select.dataset.fk = `eng:${id}:kind`;
    for (const kind of AI_ENGINE_KINDS) {
      const o = el('option', '', AI_ENGINE_KIND_LABELS[kind]);
      o.value = kind;
      select.append(o);
    }
    if (!isKnownEngineKind(engine.kind)) {
      const o = el('option', '', engineKindLabel(engine.kind));
      o.value = engine.kind;
      select.prepend(o);
    }
    select.value = engine.kind;
    select.addEventListener('change', () => updateEngine(id, { kind: select.value as AiEngineConfig['kind'] }, { form: true, head: true, routing: true }));
    return sheetRow('Kind', select, { forId: select.id, caption: 'How MikeDown talks to the server.' });
  }

  function buildLocality(engine: AiEngineConfig): HTMLElement {
    const id = engine.id;
    const select = el('select', 'settings-input');
    select.id = nextId('ai-locality');
    select.dataset.fk = `eng:${id}:locality`;
    const autoOption = el('option');
    autoOption.value = 'auto';
    select.append(autoOption);
    for (const [value, label] of Object.entries(LOCALITY_LABELS)) {
      const o = el('option', '', label);
      o.value = value;
      select.append(o);
    }
    select.value = engine.locality;
    const info = engineLocalityInfo(engine, deps.getDraft().localNetworks);
    autoOption.textContent = `Auto (detected: ${info.detected})`;
    const body = el('div', 'ai-locality');
    body.append(select);
    if (info.mismatch) {
      body.append(note('warning', info.locality === 'cloud' ? 'Pinned to cloud, but the address looks local.' : 'Pinned to local, but the address looks like a cloud server. Text sent to it leaves this network.', 'ai-locality-note'));
    }
    select.addEventListener('change', () => updateEngine(id, { locality: select.value as AiLocalitySetting }, { form: true, head: true, routing: true }));
    return sheetRow('Locality', body, { forId: select.id, caption: 'Auto decides from the address. Cloud engines need Allow cloud.' });
  }

  function buildKeyEnv(engine: AiEngineConfig): HTMLElement {
    const id = engine.id;
    const input = el('input', 'settings-input settings-input--medium ai-mono');
    input.type = 'text';
    input.id = nextId('ai-env');
    input.spellcheck = false;
    input.autocomplete = 'off';
    input.placeholder = 'NAME_OF_VARIABLE';
    input.value = engine.apiKeyEnv ?? '';
    input.dataset.fk = `eng:${id}:env`;
    input.addEventListener('input', () => {
      const v = input.value.trim();
      const current = getEngine(id);
      if (!current) {return;}
      const next: AiEngineConfig = { ...current };
      if (v) {next.apiKeyEnv = v;} else {delete next.apiKeyEnv;}
      replaceEngine(next, { head: true });
    });
    return sheetRow('Key from variable', input, {
      forId: input.id,
      caption: 'Used when no key is stored, for example OMLX_API_KEY. Apps opened from the Dock or Start menu may not see variables set in a shell profile.',
    });
  }

  function buildKeyFile(engine: AiEngineConfig): HTMLElement {
    const id = engine.id;
    const line = el('div', 'ai-key');
    const path = el('input', 'settings-input settings-input--grow ai-mono');
    const json = el('input', 'settings-input settings-input--medium ai-mono');
    for (const input of [path, json]) {
      input.type = 'text';
      input.spellcheck = false;
      input.autocomplete = 'off';
    }
    path.id = nextId('ai-keyfile');
    path.placeholder = '~/path/to/settings.json';
    json.placeholder = 'auth.api_key';
    path.value = engine.apiKeyFile?.path ?? '';
    json.value = engine.apiKeyFile?.jsonPath ?? '';
    path.dataset.fk = `eng:${id}:keyfile-path`;
    json.dataset.fk = `eng:${id}:keyfile-json`;
    path.setAttribute('aria-label', `Key file path for ${engineDisplayName(engine)}`);
    json.setAttribute('aria-label', `Key file JSON path for ${engineDisplayName(engine)}`);
    const save = () => {
      const current = getEngine(id);
      if (!current) {return;}
      const p = path.value.trim();
      const j = json.value.trim();
      const next: AiEngineConfig = { ...current };
      // Both parts are needed; a half-filled pair is not saved.
      if (p && j) {next.apiKeyFile = { ...current.apiKeyFile, path: p, jsonPath: j };} else {delete next.apiKeyFile;}
      replaceEngine(next, { head: true });
    };
    path.addEventListener('input', save);
    json.addEventListener('input', save);
    line.append(path, json);
    return sheetRow('Key file', line, {
      forId: path.id,
      caption: 'Used when no key is stored and the variable is unset: a JSON file in your home folder and the dotted path to the key inside it. Works for apps opened from the Dock or Start menu.',
    });
  }

  function buildDiscovery(engine: AiEngineConfig): HTMLElement {
    const id = engine.id;
    const select = el('select', 'settings-input');
    select.id = nextId('ai-discovery');
    select.dataset.fk = `eng:${id}:discovery`;
    for (const [value, label] of [['auto', 'Ask the server'], ['manual', 'Manual only']] as const) {
      const o = el('option', '', label);
      o.value = value;
      select.append(o);
    }
    select.value = engine.discovery;
    select.addEventListener('change', () => updateEngine(id, { discovery: select.value as 'auto' | 'manual' }, { form: true }));
    return sheetRow('Model list', select, { forId: select.id, caption: 'Ask the server which models it has (merged with any you add), or keep only the models you add by hand.' });
  }

  // ── Full models table (M3, under Advanced) ────────────────────────────────

  function buildModelsTable(engine: AiEngineConfig): HTMLElement {
    const id = engine.id;
    const box = el('div', 'ai-models');
    const head = el('div', 'ai-models-head');
    const missing = engine.models.filter((m) => m.missing).length;
    head.append(el('span', 'settings-label', 'All models'));
    head.append(el('span', 'ai-models-count', engine.models.length === 0
      ? 'none yet'
      : `${engine.models.length}${missing ? `, ${missing} not listed` : ''}`));
    box.append(head);

    if (engine.models.length === 0) {
      box.append(el('div', 'ai-models-empty', engine.discovery === 'auto' && ai.discoverModels
        ? 'Fetch models to list what the server offers, or add one by id.'
        : 'Add the models this engine serves by id.'));
    } else {
      const list = el('div', 'ai-model-list');
      list.setAttribute('role', 'list');
      list.setAttribute('aria-label', `Models of ${engineDisplayName(engine)}`);
      const loaded = new Map((deps.statuses.get(id)?.models ?? []).map((m) => [m.id, m.loaded]));
      for (const model of engine.models) {list.append(buildModelItem(engine, model, loaded.get(model.id)));}
      box.append(list);
    }

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
      replaceEngine(r.engine, { form: true, routing: true });
      deps.announce(`Added ${r.model.id}.`);
      deps.focusKey(`eng:${id}:add-model`);
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
    enabled.addEventListener('change', () => {
      deps.setDraft(setModelPicked(deps.getDraft(), engineId, model.id, enabled.checked), { form: true, head: true, routing: true });
    });

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
        deps.announce(r.error);
        return;
      }
      ctxInput.removeAttribute('aria-invalid');
      updateModel(engineId, model.id, (m) => setModelContextTokens(m, r.value), { form: true, routing: true });
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
      deps.refresh(engineId, { form: true });
      if (openOverrides.has(ovKey)) {deps.focusKey(mfk('overrides-text'));}
    });

    const right = el('div', 'ai-model-right');
    const thinking = buildThinkingSelect(engine, model, 'table');
    if (thinking) {right.append(thinking);}
    right.append(ctxWrap, ovBtn);
    if (model.manual || model.missing) {
      const remove = button('ai-icon-btn ai-model-remove', '', { html: ICONS.close, ariaLabel: `Remove ${shown}`, title: 'Remove model', fk: mfk('remove') });
      remove.addEventListener('click', () => {
        const current = getEngine(engineId);
        if (!current) {return;}
        const index = current.models.findIndex((m) => m.id === model.id);
        const draft = removeRoutesTo(deps.getDraft(), engineId, model.id);
        deps.setDraft(withEngine(draft, { ...current, models: current.models.filter((m) => m.id !== model.id) }), { form: true, head: true, routing: true });
        deps.announce(`Removed ${shown}.`);
        const rest = getEngine(engineId)?.models ?? [];
        const next = rest[Math.min(index, rest.length - 1)];
        deps.focusKey(next ? `model:${engineId}:${next.id}:enabled` : `eng:${engineId}:add-model`);
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
      b.addEventListener('click', () => updateModel(engineId, model.id, (m) => toggleModelCapability(m, chip.flag), { form: true, routing: true }));
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
      const help = el('div', 'settings-desc', 'JSON merged into every request body for this model, last, so it wins. The Thinking menu writes its fields here too.');
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

  // ── Lifecycle ─────────────────────────────────────────────────────────────

  return {
    build,
    opened(id, opts = {}) {
      const engine = getEngine(id);
      if (!engine) {return `eng:${id}:name`;}
      const family = presetOf(engine).family;
      trigger(id, 'open');
      if (!opts.isNew) {return `eng:${id}:name`;}
      // Design call 2: the first field a new engine needs.
      if (family === 'cloud' && ai.setSecret) {return `eng:${id}:key`;}
      return family === 'local' ? `eng:${id}:url` : `eng:${id}:name`;
    },
    busy(id) {
      if (testing.has(id)) {return 'test';}
      return fetches.get(id)?.running ? 'discover' : undefined;
    },
    forget(id) {
      const st = fetches.get(id);
      if (st) {
        window.clearTimeout(st.timer);
        st.seq++;
      }
      window.clearTimeout(keyTimers.get(id));
      for (const map of [fetches, keyText, keyStored, keyTimers, pickerFilter, results] as Array<Map<string, unknown>>) {map.delete(id);}
      advancedOpen.delete(id);
      typeOpen.delete(id);
    },
    dispose() {
      for (const st of fetches.values()) {
        window.clearTimeout(st.timer);
        st.seq++;
      }
      for (const t of keyTimers.values()) {window.clearTimeout(t);}
      keyTimers.clear();
      keyText.clear();
    },
  };
}
