/**
 * Local server detection and the one-click local setup behind the first-run
 * panel (`ai-toolbar.ts`) and the quick-start cards (`ai-engines-page.ts`).
 *
 * Detection asks the host (`host.ai.detectLocalServers`) whether the local
 * presets' default addresses answer, and only when the user opens setup;
 * nothing here runs in the background or caches a result. The one-click
 * setup adds the preset's engine, fetches its models, makes the first chat
 * model the default route and returns one patch with engines, routing and
 * `ai.enabled`, for the caller to save. No DOM.
 */

import { AI_ENGINE_PRESETS, AI_LOCAL_DETECT_TIMEOUT_MS, localDetectCandidates, toAiError } from './ai';
import type { AiEngineConfig, AiLocalServerProbe, AiRoute, AiSettings, AiSettingsPatch, MikeDownAiHost } from './ai';
import { applyDiscoveryForFamily, defaultRouteForEngine, engineFromPreset, rankLocalCandidates, withEngine, type LocalServerCard } from './ai-settings-model';
import { createAiSettingsSession, type AiSettingsSessionOptions } from './ai-settings-session';

/** The status line while detection runs (first-run panel, cards). */
export const AI_DETECT_LOOKING = 'Looking for local AI servers…';
/** What both say when no local server answered. */
export const AI_DETECT_NONE = 'No local AI server found. Install LM Studio or Ollama, or use a cloud API key.';

/** Slack over the host's per-address cap for the round trip (postMessage, Tauri IPC). */
const DETECT_ROUND_TRIP_MS = 1500;

/**
 * Ask the host which local servers answer (rank them with
 * `rankLocalCandidates`). Null when the host cannot detect, the request
 * failed, or it took too long: the callers then say nothing rather than
 * "nothing found".
 */
export async function detectLocalServers(ai: MikeDownAiHost, signal?: AbortSignal): Promise<AiLocalServerProbe[] | null> {
  if (!ai.detectLocalServers || signal?.aborted) {return null;}
  const controller = new AbortController();
  const onAbort = (): void => controller.abort();
  signal?.addEventListener('abort', onAbort, { once: true });
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<null>((resolve) => {
    timer = setTimeout(() => {
      controller.abort();
      resolve(null);
    }, AI_LOCAL_DETECT_TIMEOUT_MS + DETECT_ROUND_TRIP_MS);
  });
  try {
    const probes = await Promise.race([ai.detectLocalServers(localDetectCandidates(), controller.signal), timeout]);
    return !probes || controller.signal.aborted || !Array.isArray(probes) ? null : probes;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', onAbort);
  }
}

/** What the first-run panel offers: the best running server that is not set up yet. */
export function bestLocalServer(probes: readonly AiLocalServerProbe[], engines: readonly AiEngineConfig[]): LocalServerCard | null {
  return rankLocalCandidates(probes, engines).find((c) => c.running && !c.alreadyAdded) ?? null;
}

export interface LocalSetupResult {
  /** Engines, routing and `ai.enabled`, in one patch. */
  patch: AiSettingsPatch;
  /** The settings that patch leads to. */
  settings: AiSettings;
  engineId: string;
  route: AiRoute;
}

/**
 * "Use LM Studio": add the preset's engine, fetch its models, make its first
 * chat model the default route and turn AI on. The host needs to know the
 * engine before it can fetch, so the engine is saved (quietly) first, as Test
 * and fetching do on the Engines page; when anything fails it is taken back
 * and this rejects with an `Error` whose message can be shown as is.
 */
export async function setUpLocalEngine(options: AiSettingsSessionOptions, presetId: string): Promise<LocalSetupResult> {
  const preset = AI_ENGINE_PRESETS.find((p) => p.id === presetId && p.family === 'local');
  if (!preset) {throw new Error('That local server is not one MikeDown knows.');}
  const { ai } = options;
  if (!ai.discoverModels) {throw new Error('This app cannot fetch models.');}
  const session = createAiSettingsSession(options);
  const engine = engineFromPreset(preset, session.draft.engines.map((e) => e.id));
  session.addEngine(engine);
  const fail = (message: string): never => {
    session.discard();
    throw new Error(message);
  };

  await session.ensureSaved(engine.id);
  let status;
  try {
    status = await ai.discoverModels(engine.id);
  } catch (err) {
    return fail(`Could not fetch the models from ${preset.name}: ${toAiError(err).message}`);
  }
  if (status.ok === false) {return fail(`Could not fetch the models from ${preset.name}${status.error ? `: ${status.error}` : '.'}`);}
  session.statuses.set(engine.id, status);
  options.onStatuses(session.statusList());
  session.draft = withEngine(session.draft, applyDiscoveryForFamily(engine, status, 'local'));

  const route = defaultRouteForEngine(session.draft, session.statusList(), engine.id);
  if (!route) {return fail(`${preset.name} has no chat model loaded or downloaded yet.`);}
  session.draft = { ...session.draft, routing: { ...session.draft.routing, default: route } };

  const patch: AiSettingsPatch = { ...session.collect(), 'ai.enabled': true };
  const settings = { ...session.commit(), enabled: true };
  return { patch, settings, engineId: engine.id, route };
}
