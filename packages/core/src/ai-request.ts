/**
 * One AI completion as the editor runs it: resolve the route, ask for cloud
 * consent when the router says so, send, and retry once on another engine
 * when the routed one turns out to be down before it sent a token.
 *
 * - Routing is recomputed on every request (`resolveRoute`, pure) from the
 *   current settings, the last engine statuses and this session's consent.
 * - Consent: a grant is remembered for the session (the host persists it
 *   too). A refusal ("Not now") only applies to the request that asked, so
 *   the fallback runs now and the next explicit attempt asks again. A
 *   `'never'` reply ("Not for this workspace") is also kept for the session as
 *   a refusal, so the menu entries disable with the router's reason.
 * - A tier-1 host (no `listEngines`) routes by itself: no route is sent.
 * - Thinking: a per-request level becomes the request's `requestOverrides`
 *   (the kind's thinking fields only); the host merges them over the
 *   model's own, so the request wins. Only for a routed engine whose kind
 *   has a mapping (`thinkingChoices`). Such a model counts its reasoning
 *   against `maxTokens`, so unless the effective level is Off the answer
 *   budget gets reasoning headroom (`thinkingMaxTokens`).
 * - Cancellation is the caller's `AbortSignal`; the host aborts the request.
 */

import {
  CHARS_PER_TOKEN,
  isRouteUsable,
  makeAiError,
  resolveAiFeature,
  resolveRoute,
  thinkingChoices,
  thinkingLevelFrom,
  thinkingMaxTokens,
  toAiError,
  withThinkingLevel,
  type AiThinkingLevel,
  type AiThinkingOptions,
} from './ai';
import type {
  AiCompletionResult,
  AiConsentState,
  AiEngineStatus,
  AiError,
  AiErrorCode,
  AiMessage,
  AiRouteOk,
  AiRouteUnusable,
  AiSendsScope,
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
  /** What this request sends when it differs from the feature's own scope (whole-document Translate); for the consent dialog. */
  sends?: AiSendsScope;
  task?: string;
  messages: AiMessage[];
  maxTokens?: number;
  temperature?: number;
  format?: 'text' | 'json';
  /**
   * Thinking level for this request; null or absent sends none (the model's
   * configured overrides apply). A function is asked once the route's engine
   * kind is known, so a choice remembered per kind follows a fallback.
   */
  thinking?: AiThinkingLevel | null | ((kind: string) => AiThinkingLevel | null);
}

/** The thinking dial's state for the route serving a request. */
export interface AiRunThinking {
  /** The routed engine's kind (`thinkingChoices(kind)` is non-empty). */
  kind: string;
  /** The level the model's own `requestOverrides` express (null: model default). */
  configured: AiThinkingLevel | null;
  /** The level this request sent (null: none, `configured` applies). */
  sent: AiThinkingLevel | null;
}

/** Whether the model may have been thinking: a routed kind with a mapping whose effective level is not Off. */
export function aiRunThinkingOn(thinking: AiRunThinking | null): boolean {
  return !!thinking && (thinking.sent ?? thinking.configured) !== 'off';
}

export interface AiRunEvents {
  /**
   * The route about to be used (null for a tier-1 host), before any token.
   * Called again on a retry. `thinking` is null when the route's kind has no
   * thinking mapping (and always for a tier-1 host).
   */
  onRoute?(route: AiRouteOk | null, thinking: AiRunThinking | null): void;
  /** A text delta, and everything received so far for the current attempt. */
  onToken?(delta: string, text: string): void;
}

export interface AiRunOutcome {
  result: AiCompletionResult;
  route: AiRouteOk | null;
  viaFallback: boolean;
  thinking: AiRunThinking | null;
}

type Json = Record<string, unknown>;

const isObject = (v: unknown): v is Json => typeof v === 'object' && v !== null && !Array.isArray(v);

/**
 * The per-request `requestOverrides` for one thinking level: the kind's
 * thinking fields only (`withThinkingLevel` on nothing). The host merges
 * them over the model's overrides, and a merge cannot delete, so a thinking
 * field the model sets that this level leaves out is sent at its neutral
 * value: `reasoning_effort: "none"`, or `chat_template_kwargs.enable_thinking:
 * true` (a model set to Off on a local engine, asked for a tier). Undefined
 * when the kind cannot express the level.
 */
export function thinkingRequestOverrides(
  kind: string,
  modelOverrides: Json | undefined,
  level: AiThinkingLevel,
  opts: AiThinkingOptions = {},
): Json | undefined {
  const out = withThinkingLevel(kind, undefined, level, opts);
  if (!out || kind === 'anthropic' || !modelOverrides) {return out;}
  if (modelOverrides.reasoning_effort !== undefined && out.reasoning_effort === undefined) {out.reasoning_effort = 'none';}
  const modelKwargs = modelOverrides.chat_template_kwargs;
  const kwargs = isObject(out.chat_template_kwargs) ? out.chat_template_kwargs : {};
  if (isObject(modelKwargs) && modelKwargs.enable_thinking !== undefined && kwargs.enable_thinking === undefined) {
    out.chat_template_kwargs = { ...kwargs, enable_thinking: true };
  }
  return out;
}

/** The dial state and the overrides to send for `route`, or null when its kind has no mapping. */
function routeThinking(settings: AiSettings, route: AiRouteOk, wanted: AiRunRequest['thinking']): { info: AiRunThinking; overrides?: Json; contextTokens: number | null } | null {
  const engine = settings.engines.find((e) => e.id === route.engineId);
  if (!engine || thinkingChoices(engine.kind).length === 0) {return null;}
  const model = engine.models.find((m) => m.id === route.modelId);
  const configured = thinkingLevelFrom(engine.kind, model?.requestOverrides);
  const level = typeof wanted === 'function' ? wanted(engine.kind) : wanted ?? null;
  const overrides = level ? thinkingRequestOverrides(engine.kind, model?.requestOverrides, level, { local: route.isLocal }) : undefined;
  return {
    info: { kind: engine.kind, configured, sent: overrides ? level : null },
    ...(overrides ? { overrides } : {}),
    contextTokens: model?.capabilities.contextTokens ?? null,
  };
}

/** Rough prompt size in tokens (text parts only). */
function promptTokens(messages: readonly AiMessage[]): number {
  let chars = 0;
  for (const m of messages) {
    if (typeof m.content === 'string') {chars += m.content.length;} else {
      for (const part of m.content) {if (part.type === 'text') {chars += part.text.length;}}
    }
  }
  return Math.ceil(chars / CHARS_PER_TOKEN);
}

/**
 * `maxTokens` for the request: the answer budget, plus reasoning headroom
 * when the routed model can think and the effective level (sent, else the
 * model's own, else model default) is not Off.
 */
function requestMaxTokens(req: AiRunRequest, thinking: ReturnType<typeof routeThinking>): number | undefined {
  if (req.maxTokens === undefined || !thinking) {return req.maxTokens;}
  const level = thinking.info.sent ?? thinking.info.configured;
  return thinkingMaxTokens(req.maxTokens, level, { contextTokens: thinking.contextTokens, promptTokens: promptTokens(req.messages) });
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
        const reply = ctx.ai.requestCloudConsent
          ? await ctx.ai.requestCloudConsent(resolved.engineId, { feature: req.feature, ...(req.sends ? { sends: req.sends } : {}) })
          : true;
        if (signal.aborted) {throw makeAiError('cancelled');}
        if (reply === true) {ctx.consent[resolved.engineId] = true;}
        else {
          refused[resolved.engineId] = false;
          // "Not for this workspace": the host will not ask again, so the menu entries
          // disable with the router's reason for the rest of the session.
          if (reply === 'never') {ctx.consent[resolved.engineId] = false;}
        }
        continue;
      }
      route = resolved;
    }

    const thinking = route ? routeThinking(ctx.settings(), route, req.thinking) : null;
    const maxTokens = requestMaxTokens(req, thinking);
    events.onRoute?.(route, thinking?.info ?? null);
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
        ...(maxTokens !== undefined ? { maxTokens } : {}),
        ...(req.temperature !== undefined ? { temperature: req.temperature } : {}),
        ...(thinking?.overrides ? { requestOverrides: thinking.overrides } : {}),
      }, (delta) => {
        if (signal.aborted) {return;}
        gotToken = true;
        text += delta;
        events.onToken?.(delta, text);
      }, signal);
      return { result, route, viaFallback: route?.viaFallback ?? false, thinking: thinking?.info ?? null };
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
  // Grants and "never" answers count here (a "Not now" is never written to the
  // session, so the engine is asked again on the next attempt).
  const answers: Record<string, boolean> = {};
  for (const [id, v] of Object.entries(consent)) {if (typeof v === 'boolean') {answers[id] = v;}}
  const r = resolveRoute(settings, statuses, answers, { feature });
  return isRouteUsable(r) ? { state: 'enabled' } : { state: 'disabled', reason: r.reason };
}
