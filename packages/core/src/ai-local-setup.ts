/**
 * Local server detection and the one-click local setup behind the first-run
 * panel (`ai-toolbar.ts`) and the quick-start cards (`ai-engines-page.ts`).
 *
 * Detection asks the host (`host.ai.detectLocalServers`) whether the local
 * presets' default addresses answer, and only when the user opens setup;
 * nothing here runs in the background or caches a result. The one-click
 * setup adds the preset's engine, fetches its models, makes its default
 * model (`applyDiscoveryForFamily`: the loaded one) the default route and
 * returns one patch with engines, routing and
 * `ai.enabled`, for the caller to save.
 *
 * The setup wizard's scan (`scanForSetup`) adds the hardware and VS Code's
 * Copilot models to a detection and asks `recommendSetupPath` which path to
 * lead with. The hardware is read once per host (it does not change); the
 * last scan is kept for the editor session, so the wizard opened from the
 * first-run panel lays out at once and freshens when its own scan lands.
 * No DOM.
 */

import { AI_ENGINE_PRESETS, AI_LOCAL_DETECT_TIMEOUT_MS, localDetectCandidates, recommendSetupPath, toAiError, vscodeLmAvailability } from './ai';
import type { AiEngineConfig, AiHardwareInfo, AiLocalServerProbe, AiRoute, AiSettings, AiSettingsPatch, AiSetupRecommendation, MikeDownAiHost } from './ai';
import { applyDiscoveryForFamily, defaultRouteForEngine, engineFromPreset, rankLocalCandidates, withEngine, type LocalServerCard } from './ai-settings-model';
import { createAiSettingsSession, type AiSettingsSessionOptions } from './ai-settings-session';

/** The status line while detection runs (first-run panel, cards). */
export const AI_DETECT_LOOKING = 'Looking for local AI servers…';
/** What both say when no local server answered. */
export const AI_DETECT_NONE = 'No local AI server found. Start LM Studio, Ollama or oMLX, then choose Look again.';

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
 * "Use LM Studio": add the preset's engine, fetch its models, make its
 * default model the default route and turn AI on (none loaded: it fails and
 * asks for a pick in Set up). The host needs to know the
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
  if (!route) {
    // Chat models, but none loaded: no guess, the user picks one in Set up.
    const canChat = session.getEngine(engine.id)?.models.some((m) => !m.missing && m.capabilities.chat);
    return fail(canChat
      ? `${preset.name} has no model loaded. Load one there, or choose Set up to pick one.`
      : `${preset.name} has no chat model loaded or downloaded yet.`);
  }
  session.draft = { ...session.draft, routing: { ...session.draft.routing, default: route } };

  const patch: AiSettingsPatch = { ...session.collect(), 'ai.enabled': true };
  const settings = { ...session.commit(), enabled: true };
  return { patch, settings, engineId: engine.id, route };
}

// ── The setup wizard's scan ─────────────────────────────────────────────────

/** What the wizard knows about this machine when it lays out its first step. */
export interface AiSetupScan {
  recommendation: AiSetupRecommendation;
  /** Every local candidate as detection found it; null when the host cannot look, or the look failed. */
  probes: AiLocalServerProbe[] | null;
  hardware: AiHardwareInfo | null;
  /** VS Code's Copilot models (`vscodeLmAvailability`); null on a host without them. */
  vscodeLm: { available: boolean; models: number } | null;
}

/** How long the wizard waits for VS Code to list its Copilot models. */
const HOST_ENGINES_TIMEOUT_MS = 3000;

const hardwareByHost = new WeakMap<MikeDownAiHost, Promise<AiHardwareInfo | null>>();
const scanByHost = new WeakMap<MikeDownAiHost, AiSetupScan>();

/** True when the host can tell the wizard anything (servers, hardware or Copilot); otherwise the scan is instant. */
export function canScanForSetup(ai: MikeDownAiHost): boolean {
  return !!(ai.detectLocalServers || ai.hardwareInfo || ai.detectHostEngines);
}

/** The answers `setupHardware` already has, so a view built later reads them at once. */
const hardwareKnown = new WeakMap<MikeDownAiHost, AiHardwareInfo>();

/** This machine's hardware, asked once per host (it does not change); null when the host cannot tell. */
export function setupHardware(ai: MikeDownAiHost): Promise<AiHardwareInfo | null> {
  let info = hardwareByHost.get(ai);
  if (!info) {
    info = ai.hardwareInfo
      ? ai.hardwareInfo().then((h) => (h && typeof h === 'object' ? h : null), () => null)
      : Promise.resolve(null);
    info = info.then((h) => {
      if (h) {hardwareKnown.set(ai, h);}
      return h;
    });
    hardwareByHost.set(ai, info);
  }
  return info;
}

/**
 * The hardware `setupHardware` already answered with, or null before it has
 * (or when the host cannot tell). Synchronous, so the models picker of a form
 * opened later groups by size on its first render, like the first open (Q5).
 */
export function knownHardware(ai: MikeDownAiHost): AiHardwareInfo | null {
  return hardwareKnown.get(ai) ?? null;
}

/** Whether VS Code offers a Copilot model; null on a host without the method, or when it did not answer in time. */
export async function hostEngineAvailability(ai: MikeDownAiHost, signal?: AbortSignal): Promise<{ available: boolean; models: number } | null> {
  if (!ai.detectHostEngines || signal?.aborted) {return null;}
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<null>((resolve) => { timer = setTimeout(() => resolve(null), HOST_ENGINES_TIMEOUT_MS); });
  try {
    const probes = await Promise.race([ai.detectHostEngines(), timeout]);
    return probes && Array.isArray(probes) && !signal?.aborted ? vscodeLmAvailability(probes) : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/** The last scan in this editor session, if any (the wizard lays out from it while a fresh one runs). */
export function lastSetupScan(ai: MikeDownAiHost): AiSetupScan | null {
  return scanByHost.get(ai) ?? null;
}

/** The recommendation from what is known without asking the host anything (no servers, no hardware). */
export function plainSetupScan(): AiSetupScan {
  return { recommendation: recommendSetupPath({ running: [], hardware: null }), probes: null, hardware: null, vscodeLm: null };
}

/**
 * Look for local servers (unless `probes` is given: the first-run panel
 * already looked), read the hardware (cached) and ask for Copilot's models,
 * then recommend a path. Kept as the session's last scan.
 */
export async function scanForSetup(ai: MikeDownAiHost, signal?: AbortSignal, probes?: AiLocalServerProbe[] | null): Promise<AiSetupScan> {
  const [found, hardware, vscodeLm] = await Promise.all([
    probes !== undefined ? Promise.resolve(probes) : detectLocalServers(ai, signal),
    setupHardware(ai),
    hostEngineAvailability(ai, signal),
  ]);
  const recommendation = recommendSetupPath({ running: found ?? [], hardware, ...(vscodeLm ? { vscodeLm } : {}) });
  const scan: AiSetupScan = { recommendation, probes: found, hardware, vscodeLm };
  if (!signal?.aborted) {scanByHost.set(ai, scan);}
  return scan;
}
