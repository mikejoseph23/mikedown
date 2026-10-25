/**
 * Task routing: which engine and model serve a feature's request. Pure and
 * cheap, so the editor recomputes it on every request from the settings, the
 * status cache of the last `listEngines`, and the consent answers so far.
 *
 * 1. The master switch and the feature must be on.
 * 2. Route = `routing.tasks[task]`, else `routing.default`.
 * 3. A candidate is usable when the engine exists, is enabled and of a known
 *    kind; the model exists, is enabled and not `missing`; the model has every
 *    capability the task and feature need; the engine is local, or cloud with
 *    `allowCloud` on and consent not refused; and its last probe did not fail.
 * 4. Otherwise `routing.fallback`: `none` stops, `default` tries the default
 *    route, `anyLocal` then every local engine/model in registry order, `any`
 *    then cloud engines through the same gate. Fallback never moves a local
 *    route to a cloud engine unless the mode is `any`.
 * 5. The result names the pair and whether a fallback served it.
 *
 * Consent: a cloud candidate nobody has asked about yet is usable with
 * `needsConsent: true`; the caller asks (`host.ai.requestCloudConsent`),
 * records the answer and resolves again. A refusal (`false`) makes the
 * engine unusable, which lets the fallback run.
 */

import { resolveAiFeature } from './features';
import { engineLocality } from './locality';
import { isKnownEngineKind } from './schema';
import { combineRequirements, getAiTask, missingCapabilities } from './tasks';
import type { AiCapabilityRequirements } from './tasks';
import type { AiCapabilityFlag, AiEngineConfig, AiEngineStatus, AiModelConfig, AiRoute, AiSettings } from './types';

/** Consent answers by engine id: true granted, false refused ("Not now"), absent never asked. */
export type AiConsentState = Readonly<Record<string, boolean | undefined>>;

export type AiUnusableCode =
  | 'aiDisabled'
  | 'featureDisabled'
  | 'noRoute'
  | 'engineMissing'
  | 'engineDisabled'
  | 'engineUnsupported'
  | 'modelMissing'
  | 'modelDisabled'
  | 'modelNotListed'
  | 'capability'
  | 'cloudBlocked'
  | 'consentDenied'
  | 'probeFailed';

export interface AiRouteOk {
  engineId: string;
  modelId: string;
  viaFallback: boolean;
  /** Why the preferred route was passed over, when `viaFallback`. */
  reason?: string;
  /** The task that was routed. */
  task: string;
  isLocal: boolean;
  /** Cloud engine with no consent answer yet: ask before sending. */
  needsConsent: boolean;
}

export interface AiRouteUnusable {
  unusable: AiUnusableCode;
  /** Tooltip copy, e.g. "oMLX (Mac Studio) failed its last connection test". */
  reason: string;
  task?: string;
}

export type AiRouteResolution = AiRouteOk | AiRouteUnusable;

export function isRouteUsable(r: AiRouteResolution): r is AiRouteOk {
  return !('unusable' in r);
}

export interface ResolveRouteOptions {
  feature: string;
  /** Route this task instead of the feature's. */
  task?: string;
}

interface Rejection {
  code: AiUnusableCode;
  reason: string;
}

interface Candidate {
  engine: AiEngineConfig;
  model: AiModelConfig;
  isLocal: boolean;
  needsConsent: boolean;
}

const CAPABILITY_LABELS: Record<string, string> = {
  chat: 'chat',
  stream: 'streaming',
  vision: 'vision',
  json: 'JSON output',
  tools: 'tools',
  fim: 'fill-in-the-middle',
  embed: 'embeddings',
  contextTokens: 'a large enough context window',
};

function engineLabel(engine: AiEngineConfig): string {
  return engine.name || engine.id;
}

function modelLabel(model: AiModelConfig): string {
  return model.label || model.id;
}

export function resolveRoute(
  settings: AiSettings,
  statuses: readonly AiEngineStatus[],
  consent: AiConsentState,
  opts: ResolveRouteOptions,
): AiRouteResolution {
  // Step 1.
  if (!settings.enabled) {return { unusable: 'aiDisabled', reason: 'AI is turned off.' };}
  const feature = resolveAiFeature(settings.features, opts.feature);
  const task = opts.task ?? feature.task;
  if (!feature.enabled) {return { unusable: 'featureDisabled', reason: `${feature.definition?.label ?? opts.feature} is turned off.`, task };}

  const taskDef = getAiTask(task);
  const requires: AiCapabilityRequirements = combineRequirements(taskDef?.requires ?? {}, feature.requires);
  const requiresAny = taskDef?.requiresAny;
  const statusById = new Map(statuses.map((s) => [s.engineId, s]));

  const check = (route: AiRoute): Candidate | Rejection => checkCandidate(settings, statusById, consent, route, requires, requiresAny);

  // Step 2.
  const preferred = settings.routing.tasks[task] ?? settings.routing.default;
  if (!preferred) {
    return fallbackFrom(null, { code: 'noRoute', reason: 'No engine and model is chosen for this task.' });
  }
  const first = check(preferred);
  if (!('code' in first)) {return ok(first, false);}
  return fallbackFrom(preferred, first);

  function ok(c: Candidate, viaFallback: boolean, reason?: string): AiRouteOk {
    const result: AiRouteOk = { engineId: c.engine.id, modelId: c.model.id, viaFallback, task, isLocal: c.isLocal, needsConsent: c.needsConsent };
    if (reason) {result.reason = reason;}
    return result;
  }

  // Step 4.
  function fallbackFrom(primary: AiRoute | null, rejection: Rejection): AiRouteResolution {
    const mode = settings.routing.fallback;
    if (mode === 'none') {return { unusable: rejection.code, reason: rejection.reason, task };}

    // A primary that is not a configured engine counts as local: no silent hop to cloud.
    const primaryEngine = primary ? settings.engines.find((e) => e.id === primary.engineId) : undefined;
    const primaryIsLocal = primaryEngine ? engineLocality(primaryEngine, settings.localNetworks) === 'local' : true;
    const allowsCloud = (c: Candidate): boolean => c.isLocal || !primaryIsLocal || mode === 'any';
    const tried = new Set<string>();
    if (primary) {tried.add(routeKey(primary));}

    const def = settings.routing.default;
    if (def && !tried.has(routeKey(def))) {
      tried.add(routeKey(def));
      const c = check(def);
      if (!('code' in c) && allowsCloud(c)) {return ok(c, true, rejection.reason);}
    }
    if (mode === 'default') {return { unusable: rejection.code, reason: rejection.reason, task };}

    const scan = (wantLocal: boolean): Candidate | null => {
      for (const engine of settings.engines) {
        for (const model of engine.models) {
          const route = { engineId: engine.id, modelId: model.id };
          if (tried.has(routeKey(route))) {continue;}
          const c = check(route);
          if ('code' in c || c.isLocal !== wantLocal) {continue;}
          return c;
        }
      }
      return null;
    };

    const local = scan(true);
    if (local) {return ok(local, true, rejection.reason);}
    if (mode === 'any') {
      const cloud = scan(false);
      if (cloud) {return ok(cloud, true, rejection.reason);}
    }
    return { unusable: rejection.code, reason: rejection.reason, task };
  }
}

function routeKey(r: AiRoute): string {
  return `${r.engineId}\u0000${r.modelId}`;
}

function checkCandidate(
  settings: AiSettings,
  statusById: ReadonlyMap<string, AiEngineStatus>,
  consent: AiConsentState,
  route: AiRoute,
  requires: AiCapabilityRequirements,
  requiresAny: readonly AiCapabilityFlag[] | undefined,
): Candidate | Rejection {
  const engine = settings.engines.find((e) => e.id === route.engineId);
  if (!engine) {return { code: 'engineMissing', reason: 'The routed engine no longer exists.' };}
  const name = engineLabel(engine);
  if (!engine.enabled) {return { code: 'engineDisabled', reason: `${name} is turned off.` };}
  if (!isKnownEngineKind(engine.kind)) {return { code: 'engineUnsupported', reason: `${name} uses an engine kind this version does not support.` };}

  const model = engine.models.find((m) => m.id === route.modelId);
  if (!model) {return { code: 'modelMissing', reason: `${name} has no model "${route.modelId}".` };}
  if (!model.enabled) {return { code: 'modelDisabled', reason: `${modelLabel(model)} is turned off.` };}
  const status = statusById.get(engine.id);
  if (model.missing || status?.models.find((m) => m.id === model.id)?.missing) {
    return { code: 'modelNotListed', reason: `${name} no longer lists ${modelLabel(model)}.` };
  }

  const lacking = missingCapabilities(model.capabilities, requires, requiresAny);
  if (lacking.length > 0) {
    return { code: 'capability', reason: `${modelLabel(model)} lacks ${lacking.map((c) => CAPABILITY_LABELS[c] ?? c).join(', ')}.` };
  }

  const isLocal = engineLocality(engine, settings.localNetworks) === 'local';
  let needsConsent = false;
  if (!isLocal) {
    if (!settings.allowCloud) {return { code: 'cloudBlocked', reason: `${name} is a cloud engine and Allow cloud is off.` };}
    const answer = consent[engine.id];
    if (answer === false) {return { code: 'consentDenied', reason: `${name} was not allowed in this workspace.` };}
    needsConsent = answer !== true;
  }

  if (status?.ok === false) {
    return { code: 'probeFailed', reason: status.error ? `${name} failed its last connection test: ${status.error}` : `${name} failed its last connection test.` };
  }
  return { engine, model, isLocal, needsConsent };
}
