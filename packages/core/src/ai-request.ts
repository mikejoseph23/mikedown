/**
 * One AI completion as the editor runs it: resolve the route, ask for cloud
 * consent when the router says so, send, and retry once on another engine
 * when the routed one turns out to be down before it sent a token.
 *
 * - Routing is recomputed on every request (`resolveRoute`, pure) from the
 *   current settings, the last engine statuses and this session's consent.
 * - Consent: a grant is remembered for the session (the host persists it
 *   too). A refusal ("Not now") only applies to the request that asked, so
 *   the fallback runs now and the next explicit attempt asks again.
 * - A tier-1 host (no `listEngines`) routes by itself: no route is sent.
 * - Cancellation is the caller's `AbortSignal`; the host aborts the request.
 */

import { isRouteUsable, makeAiError, resolveAiFeature, resolveRoute, toAiError } from './ai';
import type {
  AiCompletionResult,
  AiConsentState,
  AiEngineStatus,
  AiError,
  AiErrorCode,
  AiMessage,
  AiRouteOk,
  AiRouteUnusable,
  AiSettings,
  MikeDownAiHost,
} from './ai';

export interface AiRunContext {
  ai: MikeDownAiHost;
  settings: () => AiSettings;
  statuses: () => readonly AiEngineStatus[];
  /** Session consent answers by engine id (grants only are written back). */
  consent: Record<string, boolean | undefined>;
}

export interface AiRunRequest {
  feature: string;
  task?: string;
  messages: AiMessage[];
  maxTokens?: number;
  temperature?: number;
  format?: 'text' | 'json';
}

export interface AiRunEvents {
  /** The route about to be used (null for a tier-1 host), before any token. Called again on a retry. */
  onRoute?(route: AiRouteOk | null): void;
  /** A text delta, and everything received so far for the current attempt. */
  onToken?(delta: string, text: string): void;
}

export interface AiRunOutcome {
  result: AiCompletionResult;
  route: AiRouteOk | null;
  viaFallback: boolean;
}

let requestCounter = 0;

function nextRequestId(feature: string): string {
  requestCounter += 1;
  return `ai-${feature}-${Date.now().toString(36)}-${requestCounter}`;
}

/** An unusable route as the error the popover shows. */
export function routeUnusableError(r: AiRouteUnusable): AiError {
  const map: Partial<Record<AiRouteUnusable['unusable'], AiErrorCode>> = {
    cloudBlocked: 'cloudBlocked',
    consentDenied: 'consentDenied',
    probeFailed: 'unreachable',
    modelMissing: 'modelNotFound',
    modelNotListed: 'modelNotFound',
  };
  return makeAiError(map[r.unusable] ?? 'unknown', r.reason);
}

function isTier2(ai: MikeDownAiHost): boolean {
  return typeof ai.listEngines === 'function';
}

/** Statuses with the engines that failed during this run marked down, so the router passes them over. */
function withFailures(statuses: readonly AiEngineStatus[], failed: ReadonlyMap<string, string>): AiEngineStatus[] {
  if (failed.size === 0) {return [...statuses];}
  const out = statuses.map((s) => (failed.has(s.engineId) ? { ...s, ok: false, error: failed.get(s.engineId) } : s));
  for (const [engineId, error] of failed) {
    if (!out.some((s) => s.engineId === engineId)) {out.push({ engineId, ok: false, isLocal: true, hasKey: false, error, models: [] });}
  }
  return out;
}

export async function runAiCompletion(ctx: AiRunContext, req: AiRunRequest, events: AiRunEvents, signal: AbortSignal): Promise<AiRunOutcome> {
  const tier2 = isTier2(ctx.ai);
  const failed = new Map<string, string>();
  const refused: Record<string, boolean> = {};
  let retried = false;

  // Bounded: each pass either sends, records a consent answer, or marks one engine failed.
  for (let pass = 0; pass < 12; pass++) {
    if (signal.aborted) {throw makeAiError('cancelled');}

    let route: AiRouteOk | null = null;
    if (tier2) {
      const consent: AiConsentState = { ...ctx.consent, ...refused };
      const resolved = resolveRoute(ctx.settings(), withFailures(ctx.statuses(), failed), consent, { feature: req.feature, ...(req.task ? { task: req.task } : {}) });
      if (!isRouteUsable(resolved)) {throw routeUnusableError(resolved);}
      if (resolved.needsConsent) {
        const granted = ctx.ai.requestCloudConsent ? await ctx.ai.requestCloudConsent(resolved.engineId) : true;
        if (signal.aborted) {throw makeAiError('cancelled');}
        if (granted) {ctx.consent[resolved.engineId] = true;} else {refused[resolved.engineId] = false;}
        continue;
      }
      route = resolved;
    }

    events.onRoute?.(route);
    let text = '';
    let gotToken = false;
    try {
      const result = await ctx.ai.complete({
        requestId: nextRequestId(req.feature),
        feature: req.feature,
        task: route?.task ?? req.task ?? resolveAiFeature(ctx.settings().features, req.feature).task,
        ...(route ? { route: { engineId: route.engineId, modelId: route.modelId } } : {}),
        messages: req.messages,
        ...(req.format ? { format: req.format } : {}),
        ...(req.maxTokens !== undefined ? { maxTokens: req.maxTokens } : {}),
        ...(req.temperature !== undefined ? { temperature: req.temperature } : {}),
      }, (delta) => {
        if (signal.aborted) {return;}
        gotToken = true;
        text += delta;
        events.onToken?.(delta, text);
      }, signal);
      return { result, route, viaFallback: route?.viaFallback ?? false };
    } catch (err) {
      const e = signal.aborted ? makeAiError('cancelled') : toAiError(err);
      // The routed engine is down and nothing was shown yet: the host has
      // marked it failed; pass it over and try the fallback once.
      if (e.code === 'unreachable' && !gotToken && !retried && route) {
        retried = true;
        failed.set(route.engineId, e.message);
        continue;
      }
      throw e;
    }
  }
  throw makeAiError('unknown', 'No engine answered.');
}

export type AiFeatureAvailability =
  | { state: 'hidden' }
  | { state: 'disabled'; reason: string }
  | { state: 'enabled' };

/**
 * Whether a feature's entry points show: hidden without an AI host, with the
 * master switch or the feature off; disabled (with the router's reason) when
 * AI is on but nothing can serve it; enabled otherwise. A tier-1 host routes
 * by itself, so it is always enabled.
 */
export function aiFeatureAvailability(
  ai: MikeDownAiHost | undefined,
  settings: AiSettings,
  statuses: readonly AiEngineStatus[],
  consent: AiConsentState,
  feature: string,
): AiFeatureAvailability {
  if (!ai || !settings.enabled) {return { state: 'hidden' };}
  if (!resolveAiFeature(settings.features, feature).enabled) {return { state: 'hidden' };}
  if (!isTier2(ai)) {return { state: 'enabled' };}
  // Only grants count here: a refused engine is asked again on the next attempt.
  const grants: Record<string, boolean> = {};
  for (const [id, v] of Object.entries(consent)) {if (v === true) {grants[id] = true;}}
  const r = resolveRoute(settings, statuses, grants, { feature });
  return isRouteUsable(r) ? { state: 'enabled' } : { state: 'disabled', reason: r.reason };
}
