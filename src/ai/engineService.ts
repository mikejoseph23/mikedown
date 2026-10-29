import {
  AI_ENGINE_PRESETS,
  AI_LOCAL_DETECT_TIMEOUT_MS,
  aiTimingLogParts,
  buildAuthHeaders,
  countDetectedModels,
  engineLocality,
  isHostEngineKind,
  isKnownEngineKind,
  isRouteUsable,
  localDetectTarget,
  makeAiError,
  mergeDiscoveredModels,
  mergeRequestOverrides,
  resolveRoute,
  thinkingLevelFrom,
  toAiError,
  type AiCompletionRequest,
  type AiCompletionResult,
  type AiConsentRecord,
  type AiConsentReply,
  type AiConsentState,
  type AiEngineConfig,
  type AiEngineKind,
  type AiEngineStatus,
  type AiError,
  type AiHardwareInfo,
  type AiHostEngineProbe,
  type AiLocalServerProbe,
  type AiModelConfig,
  type AiSendsScope,
  type AiSettings,
  type ProviderAdapter,
} from '@mikedown/core/ai';
import type { AiSecrets } from './secrets';
import { hardwareLogLine } from './hardware';
import { createAdapters } from './providers';
import { requestJson, resolveFetch, type FetchLike } from './providers/http';

/**
 * The VS Code side of the AI layer, between the webview protocol and the
 * provider adapters. Owns:
 *
 * - the adapter map by engine kind;
 * - the status cache (last probe per engine, with a timestamp), refreshed by
 *   Test connection, by `listEngines` for local engines whose entry is stale,
 *   and by completions that find a server down;
 * - one in-flight completion per panel: a new request aborts the previous
 *   one, and closing the panel aborts whatever is running;
 * - the cloud gate, enforced here as well as in core's router (defence in
 *   depth): a cloud engine is refused with `cloudBlocked` while Allow cloud
 *   is off, and needs consent before any text leaves: a stored "Allow for
 *   this workspace" or an unused "Allow once"; a consent only counts while
 *   the engine still has the kind, base URL and locality it was given for;
 * - one output-channel line per request, never the prompt text;
 * - local server detection for the setup UI: asked for, never cached;
 * - VS Code's own models (`vscode-lm`) and this machine's hardware, for the
 *   setup wizard.
 *
 * No `vscode` import: the editor wiring passes its pieces in (vscodeAi.ts),
 * so tests run it against fakes.
 */

/**
 * A stored consent answer: `allow`, or `never` (written by older versions,
 * still honoured), with the fingerprint of the engine it was given for and
 * when. "Allow once" and "Don't allow" are never stored.
 */
export interface StoredConsent {
  fingerprint: string;
  answer: 'allow' | 'never';
  /** Unix milliseconds. */
  at: number;
}

/**
 * A consent answer. The modal gives `allow` (stored), `allowOnce` (this
 * request only) or `deny` (remembered for the session, so the user is not
 * asked again until VS Code restarts); `never` only comes from the store.
 */
export type ConsentAnswer = 'allow' | 'allowOnce' | 'deny' | 'never';

/** The answers the consent modal gives. */
export type ConsentDialogAnswer = Exclude<ConsentAnswer, 'never'>;

/** Per-workspace consent answers, stored as `mikedown.ai.consent.<engineId>`. */
export interface ConsentStore {
  get(engineId: string): StoredConsent | undefined;
  set(engineId: string, record: StoredConsent): PromiseLike<void>;
  forget(engineId: string): PromiseLike<void>;
  /** Engine ids with a stored answer. */
  ids(): string[];
}

export interface EngineServiceDeps {
  readSettings(): AiSettings;
  secrets: AiSecrets;
  consent: ConsentStore;
  /** Host UI (a modal) asking whether this workspace may send text to a cloud engine. `sends` overrides the feature's own scope. */
  askConsent(engine: AiEngineConfig, feature: string | undefined, sends?: AiSendsScope): PromiseLike<ConsentDialogAnswer>;
  /** Persist `mikedown.ai.engines` (after a discovery merged models in). */
  saveEngines(engines: AiEngineConfig[]): PromiseLike<void>;
  log(line: string): void;
  adapters?: Map<AiEngineKind, ProviderAdapter>;
  /** Local server detection's GETs; defaults to Node's `fetch`. */
  fetch?: FetchLike;
  now?: () => number;
  /** This machine's hardware, for the setup wizard (hardware.ts). Absent: `hardwareInfo` answers null. */
  readHardware?: () => AiHardwareInfo;
}

interface ProbeEntry {
  ok: boolean;
  latencyMs?: number;
  error?: string;
  at: number;
  /** kind, base URL and key source at probe time; a change makes the entry void. */
  fingerprint: string;
}

/** A local engine's probe result is trusted this long by `listEngines`. */
export const PROBE_FRESH_MS = 60_000;
/** A failed local engine is probed again by `listEngines` after this long. */
export const PROBE_RETRY_MS = 15_000;
/** `listEngines` waits at most this long for a background probe. */
export const AUTO_PROBE_TIMEOUT_MS = 2_500;

function fingerprint(engine: AiEngineConfig): string {
  return [engine.kind, engine.baseUrl, engine.apiKeyEnv ?? '', engine.apiKeyFile ? `${engine.apiKeyFile.path}\u0001${engine.apiKeyFile.jsonPath}` : '', engine.locality].join('\u0000');
}

/**
 * What a consent answer is for: where the text goes (kind, base URL,
 * locality). Not the key source, so adding a key does not ask again.
 */
export function consentFingerprint(engine: AiEngineConfig): string {
  return [engine.kind, engine.baseUrl.trim().replace(/\/+$/, '').toLowerCase(), engine.locality].join('\u0000');
}

function engineName(engine: AiEngineConfig): string {
  return engine.name || engine.id;
}

export class AiEngineService {
  private readonly adapters: Map<AiEngineKind, ProviderAdapter>;
  private readonly now: () => number;
  private readonly probes = new Map<string, ProbeEntry>();
  private readonly probing = new Map<string, Promise<ProbeEntry>>();
  /** `loaded` per model id, from the last discovery (LM Studio, Ollama report it). */
  private readonly loaded = new Map<string, Map<string, boolean>>();
  private readonly inFlight = new Map<object, { requestId: string; controller: AbortController }>();
  private readonly consentPrompts = new Map<string, Promise<ConsentAnswer>>();
  /** "Allow once" grants not yet used, by engine id (the engine's fingerprint). The next completion takes it. */
  private readonly onceGrants = new Map<string, string>();
  /** This session's "Don't allow", by engine id: the fingerprint and when. */
  private readonly sessionDenied = new Map<string, { fingerprint: string; at: number }>();
  private readonly listeners = new Set<() => void>();
  /** `hardwareInfo`'s answer, read once (undefined: not asked yet). */
  private hardware: AiHardwareInfo | null | undefined;
  private knownEngines: AiEngineConfig[];

  constructor(private readonly deps: EngineServiceDeps) {
    this.adapters = deps.adapters ?? createAdapters();
    this.now = deps.now ?? Date.now;
    this.knownEngines = deps.readSettings().engines;
  }

  /** Called when engine statuses change (probe, discovery, key, a server found down). */
  onStatusesChanged(listener: () => void): { dispose(): void } {
    this.listeners.add(listener);
    return { dispose: () => this.listeners.delete(listener) };
  }

  private changed(): void {
    for (const l of this.listeners) {l();}
  }

  // ── Statuses ──────────────────────────────────────────────────────────────

  private engine(settings: AiSettings, engineId: string): AiEngineConfig {
    const engine = settings.engines.find((e) => e.id === engineId);
    if (!engine) {throw makeAiError('unknown', 'That engine is no longer in the AI settings.');}
    return engine;
  }

  private cached(engine: AiEngineConfig): ProbeEntry | undefined {
    const entry = this.probes.get(engine.id);
    return entry && entry.fingerprint === fingerprint(engine) ? entry : undefined;
  }

  private async status(settings: AiSettings, engine: AiEngineConfig): Promise<AiEngineStatus> {
    const entry = this.cached(engine);
    const loaded = this.loaded.get(engine.id);
    const key = await this.deps.secrets.resolveWithSource(engine);
    const status: AiEngineStatus = {
      engineId: engine.id,
      ok: entry ? entry.ok : null,
      isLocal: engineLocality(engine, settings.localNetworks) === 'local',
      hasKey: key !== null,
      models: engine.models.map((m) => {
        const model: AiEngineStatus['models'][number] = { id: m.id, capabilities: m.capabilities, source: m.capabilitiesSource };
        if (m.label !== undefined) {model.label = m.label;}
        if (m.missing) {model.missing = true;}
        const isLoaded = loaded?.get(m.id);
        if (isLoaded !== undefined) {model.loaded = isLoaded;}
        return model;
      }),
    };
    // Where the key came from (B1): the form says "Key found in ANTHROPIC_API_KEY" and offers no Clear for a variable or a file.
    if (key) {status.keySource = key.source;}
    if (entry?.latencyMs !== undefined) {status.latencyMs = entry.latencyMs;}
    if (entry?.error) {status.error = entry.error;}
    return status;
  }

  /** Statuses from the cache only, for routing; no I/O. */
  cachedStatuses(settings: AiSettings = this.deps.readSettings()): AiEngineStatus[] {
    return settings.engines.map((engine) => {
      const entry = this.cached(engine);
      const status: AiEngineStatus = {
        engineId: engine.id,
        ok: entry ? entry.ok : null,
        isLocal: engineLocality(engine, settings.localNetworks) === 'local',
        hasKey: false,
        models: [],
      };
      if (entry?.error) {status.error = entry.error;}
      return status;
    });
  }

  /**
   * Every engine's status. Local, enabled engines whose last probe is stale
   * (or never ran) are probed first, briefly; cloud engines are only probed
   * when the user asks (Test connection), never behind their back. A
   * `vscode-lm` engine counts as local here: its probe only asks VS Code
   * which Copilot models it has, nothing goes over the network.
   */
  async listEngines(): Promise<AiEngineStatus[]> {
    const settings = this.deps.readSettings();
    const now = this.now();
    const stale = settings.engines.filter((engine) => {
      if (!engine.enabled || !isKnownEngineKind(engine.kind)) {return false;}
      if (!isHostEngineKind(engine.kind) && engineLocality(engine, settings.localNetworks) !== 'local') {return false;}
      const entry = this.cached(engine);
      return !entry || now - entry.at > (entry.ok ? PROBE_FRESH_MS : PROBE_RETRY_MS);
    });
    if (stale.length > 0) {
      await Promise.all(stale.map((engine) => this.probe(engine, AUTO_PROBE_TIMEOUT_MS)));
    }
    return Promise.all(settings.engines.map((engine) => this.status(settings, engine)));
  }

  /** Test connection for one engine (any locality: the user asked). */
  async testEngine(engineId: string): Promise<AiEngineStatus> {
    const settings = this.deps.readSettings();
    const engine = this.engine(settings, engineId);
    await this.probe(engine);
    return this.status(settings, engine);
  }

  /** Test connection for every engine, one log line each. */
  async testAllEngines(): Promise<AiEngineStatus[]> {
    const settings = this.deps.readSettings();
    if (settings.engines.length === 0) {
      this.deps.log('Test all engines: no engines configured.');
      return [];
    }
    const statuses = await Promise.all(settings.engines.map(async (engine) => {
      await this.probe(engine);
      return this.status(settings, engine);
    }));
    for (const s of statuses) {
      const engine = settings.engines.find((e) => e.id === s.engineId)!;
      const where = s.isLocal ? 'local' : 'cloud';
      const result = s.ok ? `ok, ${s.latencyMs ?? 0} ms` : `failed: ${s.error ?? 'no answer'}`;
      this.deps.log(`Test ${engineName(engine)} (${engine.kind}, ${where}${engine.enabled ? '' : ', turned off'}): ${result}`);
    }
    return statuses;
  }

  private probe(engine: AiEngineConfig, timeoutMs?: number): Promise<ProbeEntry> {
    const running = this.probing.get(engine.id);
    if (running) {return running;}
    const task = (async (): Promise<ProbeEntry> => {
      const print = fingerprint(engine);
      const adapter = this.adapters.get(engine.kind);
      let entry: ProbeEntry;
      if (!adapter) {
        entry = { ok: false, error: `Engine kind "${engine.kind}" is not supported by this version.`, at: this.now(), fingerprint: print };
      } else {
        const controller = new AbortController();
        let timedOut = false;
        const timer = timeoutMs ? setTimeout(() => { timedOut = true; controller.abort(); }, timeoutMs) : undefined;
        try {
          const apiKey = await this.deps.secrets.resolve(engine);
          const result = await adapter.probe(engine, apiKey, controller.signal);
          entry = { ok: result.ok, latencyMs: result.latencyMs, at: this.now(), fingerprint: print };
          if (!result.ok) {entry.error = timedOut ? 'No answer (timed out).' : result.error?.message ?? 'No answer.';}
        } catch (err) {
          entry = { ok: false, error: timedOut ? 'No answer (timed out).' : toAiError(err).message, at: this.now(), fingerprint: print };
        } finally {
          if (timer) {clearTimeout(timer);}
        }
      }
      const before = this.probes.get(engine.id);
      this.probes.set(engine.id, entry);
      if (!before || before.ok !== entry.ok || before.error !== entry.error) {this.changed();}
      return entry;
    })();
    this.probing.set(engine.id, task);
    void task.finally(() => this.probing.delete(engine.id));
    return task;
  }

  /** A completion learned something about an engine's health. */
  private recordHealth(engine: AiEngineConfig, ok: boolean, error?: string): void {
    const before = this.cached(engine);
    if (before && before.ok === ok && before.error === error) {return;}
    const entry: ProbeEntry = { ok, at: this.now(), fingerprint: fingerprint(engine) };
    if (before?.latencyMs !== undefined) {entry.latencyMs = before.latencyMs;}
    if (error) {entry.error = error;}
    this.probes.set(engine.id, entry);
    this.changed();
  }

  /** Discover models and merge them into the saved engine (new ones added, off on cloud engines; gone ones marked missing; user edits kept). */
  async discoverModels(engineId: string): Promise<AiEngineStatus> {
    const settings = this.deps.readSettings();
    const engine = this.engine(settings, engineId);
    const adapter = this.adapters.get(engine.kind);
    if (!adapter) {
      this.recordHealth(engine, false, `Engine kind "${engine.kind}" is not supported by this version.`);
      return this.status(settings, engine);
    }
    const started = this.now();
    try {
      const apiKey = await this.deps.secrets.resolve(engine);
      const discovered = await adapter.listModels(engine, apiKey, new AbortController().signal);
      const models = mergeDiscoveredModels(engine.models, discovered, engine.kind, { addEnabled: engineLocality(engine, settings.localNetworks) === 'local' });
      const next: AiEngineConfig = { ...engine, models };
      const engines = settings.engines.map((e) => (e.id === engine.id ? next : e));
      this.loaded.set(engine.id, new Map(discovered.filter((d) => d.loaded !== undefined).map((d) => [d.id, d.loaded!])));
      this.probes.set(engine.id, { ok: true, latencyMs: this.now() - started, at: this.now(), fingerprint: fingerprint(engine) });
      await this.deps.saveEngines(engines);
      this.deps.log(`Discover ${engineName(engine)}: ${discovered.length} model${discovered.length === 1 ? '' : 's'} listed, ${models.filter((m) => m.missing).length} missing.`);
      this.changed();
      return this.status({ ...settings, engines }, next);
    } catch (err) {
      const e = toAiError(err);
      this.deps.log(`Discover ${engineName(engine)}: failed, ${e.code}: ${e.message}`);
      this.recordHealth(engine, false, e.message);
      return this.status(settings, engine);
    }
  }

  async setSecret(engineId: string, apiKey: string | null): Promise<AiEngineStatus> {
    await this.deps.secrets.set(engineId, apiKey);
    // A new key can turn an auth failure into a pass: probe again next time.
    this.probes.delete(engineId);
    this.changed();
    const settings = this.deps.readSettings();
    const engine = settings.engines.find((e) => e.id === engineId);
    if (!engine) {
      // Stored before the engine was saved (a new engine in the modal): report the key alone.
      return { engineId, ok: null, isLocal: false, hasKey: !!apiKey?.trim(), models: [] };
    }
    return this.status(settings, engine);
  }

  // ── Local server detection ────────────────────────────────────────────────

  /**
   * Which local presets answer at their addresses: one GET each, in
   * parallel, capped at `AI_LOCAL_DETECT_TIMEOUT_MS`. Runs only when the
   * webview asks (the first-run panel, the quick-start cards); results are
   * not cached or saved. The first GET carries no key; only a server that
   * answers 401/403 is asked again with the preset's key (oMLX's key file),
   * and only at the preset's own address. One log line.
   */
  async detectLocalServers(candidates: readonly unknown[]): Promise<AiLocalServerProbe[]> {
    const doFetch = this.deps.fetch ?? resolveFetch({});
    const outcomes = await Promise.all(candidates.slice(0, 32).map(async (raw) => {
      const c = (typeof raw === 'object' && raw !== null ? raw : {}) as { presetId?: unknown; baseUrl?: unknown };
      const probe: AiLocalServerProbe = { presetId: typeof c.presetId === 'string' ? c.presetId : '', baseUrl: typeof c.baseUrl === 'string' ? c.baseUrl : '', ok: false };
      const target = localDetectTarget(probe);
      if (!target) {return { probe, note: 'not a local preset' };}
      const started = this.now();
      const deadline = new AbortController();
      const timer = setTimeout(() => deadline.abort(), AI_LOCAL_DETECT_TIMEOUT_MS);
      const get = (apiKey: string | null) => requestJson(doFetch, target.url, { headers: buildAuthHeaders(target.kind, apiKey) }, deadline.signal, AI_LOCAL_DETECT_TIMEOUT_MS);
      try {
        let body: unknown;
        try {
          body = await get(null);
        } catch (err) {
          const key = toAiError(err).code === 'auth' && (target.apiKeyEnv || target.apiKeyFile)
            ? await this.deps.secrets.resolve({ id: `detect:${target.presetId}`, apiKeyEnv: target.apiKeyEnv, apiKeyFile: target.apiKeyFile })
            : null;
          if (!key) {throw err;}
          body = await get(key);
        }
        probe.ok = true;
        probe.latencyMs = this.now() - started;
        const models = countDetectedModels(body);
        if (models !== undefined) {probe.models = models;}
        return { probe, note: models === undefined ? 'ok' : `ok (${models} model${models === 1 ? '' : 's'})` };
      } catch (err) {
        const e = toAiError(err);
        return { probe, note: e.code === 'unreachable' || e.code === 'cancelled' ? 'no answer' : e.code === 'auth' ? 'needs a key' : `failed (${e.code})` };
      } finally {
        clearTimeout(timer);
      }
    }));
    const name = (id: string) => AI_ENGINE_PRESETS.find((p) => p.id === id)?.name ?? (id || '?');
    this.deps.log(`Detect local servers: ${outcomes.map((o) => `${name(o.probe.presetId)} ${o.note}`).join(', ') || 'nothing asked'}.`);
    return outcomes.map((o) => o.probe);
  }

  /**
   * VS Code's own models (`vscode-lm`: GitHub Copilot) for the setup wizard:
   * how many chat models it offers right now. Lists only; sends no text, so
   * VS Code shows no permission prompt. One result per host kind this
   * service has an adapter for (none in tests without the `vscode` API).
   */
  async detectHostEngines(): Promise<AiHostEngineProbe[]> {
    const out: AiHostEngineProbe[] = [];
    for (const preset of AI_ENGINE_PRESETS) {
      if (preset.family !== 'host' || !isHostEngineKind(preset.kind)) {continue;}
      const adapter = this.adapters.get(preset.kind);
      if (!adapter) {continue;}
      const probe: AiHostEngineProbe = { presetId: preset.id, kind: preset.kind, ok: false, models: 0 };
      const engine: AiEngineConfig = { id: `detect:${preset.id}`, name: preset.name, kind: preset.kind, baseUrl: preset.baseUrl, enabled: true, locality: 'auto', discovery: 'auto', models: [] };
      try {
        const models = await adapter.listModels(engine, null, new AbortController().signal);
        probe.models = models.length;
        probe.ok = models.length > 0;
      } catch (err) {
        probe.error = toAiError(err).message;
      }
      out.push(probe);
    }
    this.deps.log(`Detect host engines: ${out.map((p) => `${p.presetId} ${p.ok ? `${p.models} model${p.models === 1 ? '' : 's'}` : 'none'}`).join(', ') || 'none supported'}.`);
    return out;
  }

  /** This machine's memory and CPU (static: read once, logged once per session). Null when it cannot be read. */
  hardwareInfo(): AiHardwareInfo | null {
    if (this.hardware !== undefined) {return this.hardware;}
    try {
      this.hardware = this.deps.readHardware?.() ?? null;
    } catch (err) {
      this.hardware = null;
      this.deps.log(`Hardware: could not read (${toAiError(err).message})`);
    }
    if (this.hardware) {this.deps.log(hardwareLogLine(this.hardware));}
    return this.hardware;
  }

  // ── Consent ───────────────────────────────────────────────────────────────

  /** The stored answer for an engine, if it still describes the engine as it is now. */
  private storedConsent(engine: AiEngineConfig): StoredConsent | undefined {
    const record = this.deps.consent.get(engine.id);
    return record && record.fingerprint === consentFingerprint(engine) ? record : undefined;
  }

  /** This session's "Don't allow" for an engine, if it still describes the engine. */
  private deniedThisSession(engine: AiEngineConfig): { at: number } | undefined {
    const denied = this.sessionDenied.get(engine.id);
    return denied && denied.fingerprint === consentFingerprint(engine) ? denied : undefined;
  }

  /** Use up an "Allow once" grant for the engine. True when there was one for it as it is now. */
  private takeOnceGrant(engine: AiEngineConfig): boolean {
    const print = this.onceGrants.get(engine.id);
    this.onceGrants.delete(engine.id);
    return print === consentFingerprint(engine);
  }

  /**
   * Consents for the host-side router (requests that come without a route):
   * `true` stored allow, `false` stored never or this session's "Don't allow".
   */
  consentState(settings: AiSettings = this.deps.readSettings()): AiConsentState {
    const state: Record<string, boolean> = {};
    for (const engine of settings.engines) {
      const record = this.storedConsent(engine);
      if (record) {state[engine.id] = record.answer === 'allow';}
      else if (this.deniedThisSession(engine)) {state[engine.id] = false;}
    }
    return state;
  }

  /**
   * The answers, newest first, for the Cloud consents list: the stored ones
   * and this session's "Don't allow" (so it can be forgotten without a
   * restart). Answers for engines that are gone or point somewhere else now
   * are not listed.
   */
  listConsents(): AiConsentRecord[] {
    const out: AiConsentRecord[] = [];
    for (const engine of this.deps.readSettings().engines) {
      const record = this.storedConsent(engine);
      const denied = record ? undefined : this.deniedThisSession(engine);
      if (record) {out.push({ engineId: engine.id, answer: record.answer, at: record.at, scope: 'workspace' });}
      else if (denied) {out.push({ engineId: engine.id, answer: 'deny', at: denied.at, scope: 'workspace' });}
    }
    return out.sort((a, b) => b.at - a.at);
  }

  /** Forget the answer (stored and this session's), so the next request asks again. */
  async forgetConsent(engineId: string): Promise<void> {
    this.sessionDenied.delete(engineId);
    this.onceGrants.delete(engineId);
    await this.deps.consent.forget(engineId);
    this.deps.log(`Consent ${engineId}: forgotten`);
  }

  /**
   * True (allowed for the workspace), `'once'` (this request only), false
   * ("Don't allow") or `'never'` (stored by an older version) for a cloud
   * engine in this workspace; local engines are always true. Rejects with
   * `cloudBlocked` while Allow cloud is off, like Desktop. A stored answer
   * and this session's "Don't allow" are returned without asking. "Allow
   * once" leaves a grant the next completion for the engine uses up; an
   * unused one is replaced by the next answer.
   */
  async requestCloudConsent(engineId: string, feature?: string, sends?: AiSendsScope): Promise<AiConsentReply> {
    const settings = this.deps.readSettings();
    const engine = settings.engines.find((e) => e.id === engineId);
    if (!engine) {return false;}
    if (engineLocality(engine, settings.localNetworks) === 'local') {return true;}
    if (!settings.allowCloud) {throw makeAiError('cloudBlocked', `${engineName(engine)} is a cloud engine and Allow cloud is off.`);}
    this.onceGrants.delete(engine.id);
    const answer = await this.ensureConsent(engine, feature, sends);
    if (answer === 'allowOnce') {this.onceGrants.set(engine.id, consentFingerprint(engine));}
    return answer === 'allow' ? true : answer === 'allowOnce' ? 'once' : answer === 'never' ? 'never' : false;
  }

  /** The answer that holds (stored, then this session's "Don't allow"), else the modal's. */
  private ensureConsent(engine: AiEngineConfig, feature: string | undefined, sends?: AiSendsScope): Promise<ConsentAnswer> {
    const stored = this.storedConsent(engine);
    if (stored) {return Promise.resolve(stored.answer);}
    if (this.deniedThisSession(engine)) {return Promise.resolve('deny');}
    const pending = this.consentPrompts.get(engine.id);
    if (pending) {return pending;}
    const prompt = (async (): Promise<ConsentAnswer> => {
      const answer = await this.deps.askConsent(engine, feature, sends);
      if (answer === 'allow') {
        await this.deps.consent.set(engine.id, { fingerprint: consentFingerprint(engine), answer, at: this.now() });
      } else if (answer === 'deny') {
        this.sessionDenied.set(engine.id, { fingerprint: consentFingerprint(engine), at: this.now() });
      }
      this.deps.log(`Consent ${engineName(engine)}: ${answer === 'allow' ? 'allowed for this workspace' : answer === 'allowOnce' ? 'allowed once' : 'not allowed until restart'}`);
      return answer;
    })();
    this.consentPrompts.set(engine.id, prompt);
    void prompt.finally(() => this.consentPrompts.delete(engine.id));
    return prompt;
  }

  // ── Completions ───────────────────────────────────────────────────────────

  private target(settings: AiSettings, req: AiCompletionRequest): { engine: AiEngineConfig; model: AiModelConfig } {
    let route = req.route;
    if (!route) {
      const resolved = resolveRoute(settings, this.cachedStatuses(settings), this.consentState(settings), { feature: req.feature, ...(req.task ? { task: req.task } : {}) });
      if (!isRouteUsable(resolved)) {
        const code = resolved.unusable === 'cloudBlocked' || resolved.unusable === 'consentDenied' ? resolved.unusable : 'unknown';
        throw makeAiError(code, resolved.reason);
      }
      route = { engineId: resolved.engineId, modelId: resolved.modelId };
    }
    const engine = settings.engines.find((e) => e.id === route.engineId);
    if (!engine) {throw makeAiError('unknown', 'The routed engine is no longer in the AI settings.');}
    if (!engine.enabled) {throw makeAiError('unknown', `${engineName(engine)} is turned off.`);}
    if (!isKnownEngineKind(engine.kind)) {throw makeAiError('unknown', `${engineName(engine)} uses an engine kind this version does not support.`);}
    const model = engine.models.find((m) => m.id === route.modelId);
    if (!model) {throw makeAiError('modelNotFound', `${engineName(engine)} has no model "${route.modelId}" in the AI settings.`);}
    return { engine, model };
  }

  /**
   * Run one completion for `panel`. A request already running for the same
   * panel is aborted first (it rejects with `cancelled`).
   */
  async complete(panel: object, req: AiCompletionRequest, onToken: (delta: string) => void): Promise<AiCompletionResult> {
    this.inFlight.get(panel)?.controller.abort();
    const controller = new AbortController();
    this.inFlight.set(panel, { requestId: req.requestId, controller });
    const started = this.now();
    let picked: { engine: AiEngineConfig; model: AiModelConfig; isLocal: boolean } | undefined;
    try {
      const settings = this.deps.readSettings();
      if (!settings.enabled) {throw makeAiError('unknown', 'AI is turned off in MikeDown settings.');}
      const { engine, model } = this.target(settings, req);
      const isLocal = engineLocality(engine, settings.localNetworks) === 'local';
      picked = { engine, model, isLocal };

      if (!isLocal) {
        if (!settings.allowCloud) {throw makeAiError('cloudBlocked', `${engineName(engine)} is a cloud engine and Allow cloud is off.`);}
        // A stored allow, an unused "Allow once" from the consent request, or ask now.
        const answer = this.storedConsent(engine)?.answer === 'allow' || this.takeOnceGrant(engine) ? 'allow' : await this.ensureConsent(engine, req.feature);
        if (answer !== 'allow' && answer !== 'allowOnce') {
          throw makeAiError('consentDenied', answer === 'never'
            ? `Sending text to ${engineName(engine)} was turned off for this workspace.`
            : `Sending text to ${engineName(engine)} was not allowed for this workspace.`);
        }
      }
      const adapter = this.adapters.get(engine.kind);
      if (!adapter) {throw makeAiError('unknown', `Engine kind "${engine.kind}" is not supported by this version.`);}
      const apiKey = await this.deps.secrets.resolve(engine);
      if (controller.signal.aborted) {throw makeAiError('cancelled');}

      // Adapters that stream over HTTP time the request themselves; VS Code's LM API is timed here.
      const sentAt = this.now();
      let firstAt: number | undefined;
      const result = await adapter.complete(engine, apiKey, model, req, (delta) => {
        firstAt ??= this.now();
        if (!controller.signal.aborted) {onToken(delta);}
      }, controller.signal);
      result.served = { engineId: engine.id, engineName: engineName(engine), modelId: model.id, isLocal };
      if (!result.timing) {
        result.timing = { totalMs: this.now() - sentAt, outputChars: result.text.length };
        if (firstAt !== undefined) {result.timing.firstTokenMs = firstAt - sentAt;}
      }
      this.recordHealth(engine, true);
      this.logRequest(req, picked, started, result.finishReason ?? 'stop', result);
      return result;
    } catch (err) {
      const error: AiError = controller.signal.aborted ? makeAiError('cancelled') : toAiError(err);
      if (error.code === 'unreachable' && picked) {this.recordHealth(picked.engine, false, error.message);}
      this.logRequest(req, picked, started, error.code === 'cancelled' ? 'cancelled' : `error ${error.code}`);
      throw error;
    } finally {
      if (this.inFlight.get(panel)?.controller === controller) {this.inFlight.delete(panel);}
    }
  }

  /** Abort `requestId` if it is the panel's running request. */
  cancel(panel: object, requestId: string): void {
    const running = this.inFlight.get(panel);
    if (running && running.requestId === requestId) {running.controller.abort();}
  }

  /** The panel closed: abort its request. */
  disposePanel(panel: object): void {
    this.inFlight.get(panel)?.controller.abort();
    this.inFlight.delete(panel);
  }

  /** True while `panel` has a request running (tests, status). */
  hasInFlight(panel: object): boolean {
    return this.inFlight.has(panel);
  }

  /**
   * One line per request: feature, task, engine, model, locality, latency,
   * finish, then the thinking level and `max_tokens` when the effective
   * overrides (model's, then the request's) set a level, the token counts,
   * the time to the first token and the speed. Never the prompt.
   */
  private logRequest(
    req: AiCompletionRequest,
    picked: { engine: AiEngineConfig; model: AiModelConfig; isLocal: boolean } | undefined,
    started: number,
    finish: string,
    result?: AiCompletionResult,
  ): void {
    const parts = [
      `${req.feature}/${req.task}`,
      picked ? engineName(picked.engine) : 'no engine',
      picked ? picked.model.id : '-',
      picked ? (picked.isLocal ? 'local' : 'cloud') : '-',
      `${this.now() - started} ms`,
      finish,
    ];
    const thinking = picked ? thinkingLogParts(picked.engine.kind, picked.model, req) : [];
    parts.push(...thinking);
    const usage = result?.usage;
    if (usage && (usage.promptTokens !== undefined || usage.completionTokens !== undefined)) {
      parts.push(`${usage.promptTokens ?? '?'} in, ${usage.completionTokens ?? '?'} out`);
    }
    if (result) {parts.push(...aiTimingLogParts(result));}
    this.deps.log(parts.join(' · '));
  }

  // ── Settings changes ──────────────────────────────────────────────────────

  /**
   * `mikedown.ai.*` changed: delete the keys (and this workspace's consent)
   * of engines that are gone, forget consents and probe results that no
   * longer describe the engine (it points somewhere else now).
   */
  async settingsChanged(): Promise<string[]> {
    const engines = this.deps.readSettings().engines;
    const removed = await this.deps.secrets.pruneRemoved(this.knownEngines, engines);
    for (const id of removed) {
      this.probes.delete(id);
      this.loaded.delete(id);
      this.sessionDenied.delete(id);
      this.onceGrants.delete(id);
      await this.deps.consent.forget(id);
    }
    for (const id of this.deps.consent.ids()) {
      const engine = engines.find((e) => e.id === id);
      const record = this.deps.consent.get(id);
      if (engine && record && record.fingerprint !== consentFingerprint(engine)) {
        await this.deps.consent.forget(id);
        this.deps.log(`Consent ${engineName(engine)}: forgotten, the engine changed`);
      }
    }
    for (const engine of engines) {
      const entry = this.probes.get(engine.id);
      if (entry && entry.fingerprint !== fingerprint(engine)) {this.probes.delete(engine.id);}
    }
    this.knownEngines = engines;
    this.changed();
    return removed;
  }

  dispose(): void {
    for (const { controller } of this.inFlight.values()) {controller.abort();}
    this.inFlight.clear();
    this.listeners.clear();
  }
}

/** `thinking <level>` and `max_tokens <n>` for the request log, or nothing when no thinking level applies. */
function thinkingLogParts(kind: AiEngineKind, model: AiModelConfig, req: AiCompletionRequest): string[] {
  const effective = mergeRequestOverrides({}, model.requestOverrides);
  const overrides = req.requestOverrides ? mergeRequestOverrides(effective, req.requestOverrides) : effective;
  const level = thinkingLevelFrom(kind, overrides);
  if (!level) {return [];}
  const parts = [`thinking ${level}`];
  const max = overrides.max_tokens ?? overrides.max_completion_tokens ?? req.maxTokens;
  if (typeof max === 'number') {parts.push(`max_tokens ${max}`);}
  return parts;
}
