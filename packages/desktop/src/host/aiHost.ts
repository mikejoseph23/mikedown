/**
 * `MikeDownAiHost` for MikeDown Desktop (tier 2: managed registry). The
 * network is the Rust side's business (`commands/ai.rs`); this module turns
 * its commands and events into the host contract core expects:
 *
 * - `complete` registers the request's three event listeners first, then
 *   invokes `ai_complete`, and removes the listeners when the request settles
 *   (done, error, abort or a failed invoke), so none leak. The request goes
 *   over whole, `requestOverrides` (the popover's thinking dial) included;
 *   Rust merges them over the model's own.
 * - `listEngines` / `testEngine` / `discoverModels` combine what Rust knows
 *   (reachability, key presence, locality) with the saved engines in settings,
 *   which own the model list. Discovery merges the endpoint's models into the
 *   saved engine with core's heuristics (new cloud models start off) and
 *   persists the result.
 * - `setSecret` and `requestCloudConsent` are plain commands; the key goes in
 *   and never comes back.
 */
import type { AiCompletionRequest, AiCompletionResult, AiEngineStatus, AiError, MikeDownAiHost } from '@mikedown/core';
import {
  engineLocality,
  makeAiError,
  mergeDiscoveredModels,
  toAiError,
  toWireCompletionRequest,
  type AiEngineConfig,
  type AiSettings,
} from '@mikedown/core/ai';
import type { UnlistenFn } from '@tauri-apps/api/event';
import type { AiApi, AiEngineInfo } from './aiApi';

export interface AiHostDeps {
  api: AiApi;
  /** The current typed AI settings (engines with their saved models). */
  settings(): AiSettings;
  /** Persist a new `ai.engines` list (discovery merged new models into one engine). */
  saveEngines(engines: AiEngineConfig[]): Promise<void>;
}

function statusFor(engine: AiEngineConfig, settings: AiSettings, info?: AiEngineInfo, loaded?: ReadonlySet<string>): AiEngineStatus {
  const status: AiEngineStatus = {
    engineId: engine.id,
    ok: info?.ok ?? null,
    isLocal: info ? info.isLocal : engineLocality(engine, settings.localNetworks) === 'local',
    hasKey: info?.hasKey ?? false,
    models: engine.models.map((m) => ({
      id: m.id,
      ...(m.label !== undefined ? { label: m.label } : {}),
      capabilities: m.capabilities,
      source: m.capabilitiesSource,
      ...(m.missing ? { missing: true } : {}),
      ...(loaded?.has(m.id) ? { loaded: true } : {}),
    })),
  };
  if (info?.latencyMs !== undefined) {status.latencyMs = info.latencyMs;}
  if (info?.error !== undefined) {status.error = info.error;}
  return status;
}

function findEngine(settings: AiSettings, engineId: string): AiEngineConfig {
  const engine = settings.engines.find((e) => e.id === engineId);
  if (!engine) {throw makeAiError('modelNotFound', 'That engine is not in your AI settings.');}
  return engine;
}

export function createAiHost(deps: AiHostDeps): MikeDownAiHost {
  const { api } = deps;

  async function complete(req: AiCompletionRequest, onToken: (delta: string) => void, signal: AbortSignal): Promise<AiCompletionResult> {
    if (signal.aborted) {throw makeAiError('cancelled');}
    return new Promise<AiCompletionResult>((resolve, reject) => {
      let settled = false;
      const unlisten: UnlistenFn[] = [];
      const cleanup = (): void => {
        signal.removeEventListener('abort', onAbort);
        for (const off of unlisten.splice(0)) {off();}
      };
      const settle = (run: () => void): void => {
        if (settled) {return;}
        settled = true;
        cleanup();
        run();
      };
      const onAbort = (): void => {
        void api.cancel(req.requestId).catch(() => { /* already finished */ });
        settle(() => reject(makeAiError('cancelled')));
      };
      signal.addEventListener('abort', onAbort);

      void (async () => {
        try {
          const offs = await Promise.all([
            api.onToken(req.requestId, (e) => { if (!settled) {onToken(e.delta);} }),
            api.onDone(req.requestId, (e) => settle(() => resolve(e.result))),
            api.onError(req.requestId, (e) => settle(() => reject({ code: e.code, message: e.message } satisfies AiError))),
          ]);
          unlisten.push(...offs);
          if (settled) {
            // Aborted while the listeners were being registered.
            cleanup();
            return;
          }
          await api.complete(toWireCompletionRequest(req));
        } catch (err) {
          settle(() => reject(toAiError(err)));
        }
      })();
    });
  }

  return {
    complete,

    async listEngines() {
      const settings = deps.settings();
      const infos = await api.listEngines();
      return settings.engines.map((engine) => statusFor(engine, settings, infos.find((i) => i.engineId === engine.id)));
    },

    async testEngine(engineId) {
      const settings = deps.settings();
      const engine = findEngine(settings, engineId);
      return statusFor(engine, settings, await api.testEngine(engineId).catch((err: unknown) => { throw toAiError(err); }));
    },

    async discoverModels(engineId) {
      const settings = deps.settings();
      const engine = findEngine(settings, engineId);
      let result;
      try {
        result = await api.discoverModels(engineId);
      } catch (err) {
        const failure = toAiError(err);
        return { ...statusFor(engine, settings), ok: false, error: failure.message };
      }
      // Cloud engines add new models off (OPEN-12); the user picks the ones they want.
      const models = mergeDiscoveredModels(engine.models, result.models, engine.kind, { addEnabled: engineLocality(engine, settings.localNetworks) === 'local' });
      const merged: AiEngineConfig = { ...engine, models };
      await deps.saveEngines(settings.engines.map((e) => (e.id === engineId ? merged : e)));
      const loaded = new Set(result.models.filter((m) => m.loaded).map((m) => m.id));
      return statusFor(merged, settings, result.info, loaded);
    },

    async setSecret(engineId, apiKey) {
      try {
        await api.setSecret(engineId, apiKey);
      } catch (err) {
        throw toAiError(err);
      }
    },

    async requestCloudConsent(engineId) {
      try {
        return await api.requestCloudConsent(engineId);
      } catch (err) {
        throw toAiError(err);
      }
    },
  };
}
