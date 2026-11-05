/**
 * One AI completion as the editor runs it: resolve the route, ask for cloud
 * consent when the router says so, send, and retry once on another engine
 * when the routed one turns out to be down before it sent a token.
 *
 * - Routing is recomputed on every request (`resolveRoute`, pure) from the
 *   current settings, the last engine statuses and this session's consent.
 * - Consent: a grant ("Allow for this workspace") is remembered for the
 *   session (the host persists it too). "Allow once" (`'once'`) covers only
 *   the request that asked. A refusal ("Don't allow") applies here to that
 *   request, so the fallback runs now; the host remembers it for the session
 *   and answers the next attempt without a dialog. A stored `'never'` (older
 *   versions) is kept for the session as a refusal, so the menu entries
 *   disable with the router's reason.
 * - A tier-1 host (no `listEngines`) routes by itself: no route is sent.
 * - Thinking: a per-request level becomes the request's `requestOverrides`
 *   (the kind's thinking fields only); the host merges them over the
 *   model's own, so the request wins. Only for a routed engine whose kind
 *   has a mapping (`thinkingChoices`). With no level ("Default") and none
 *   set on the model, the job's default applies (`resolveThinkingLevel`:
 *   Off for short edits). Such a model counts its reasoning
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
  resolveThinkingLevel,
  thinkingChoices,
  thinkingLevelFrom,
  thinkingMaxTokens,
  toAiError,
  withThinkingLevel,
  type AiThinkingJob,
  type AiThinkingLevel,
  type AiThinkingOptions,
} from './ai';
import { aiActivityResponse, type AiActivityEntry, type AiActivityLog } from './ai-activity';
import type {
  AiCompletionRequest,
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
  /** The editor's activity recorder; every request that is sent is recorded in it (while it is on). */
  activity?: AiActivityLog;
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
  /**
   * What the request is for, for the default thinking level when `thinking`
   * gives none (`taskThinkingDefault`); defaults to `feature`. `explain` and
   * `translate` run under the `rewrite` feature.
   */
  job?: AiThinkingJob;
}

/** The thinking dial's state for the route serving a request. */
export interface AiRunThinking {
  /** The routed engine's kind (`thinkingChoices(kind)` is non-empty). */
  kind: string;
  /** The level the model's own `requestOverrides` express (null: model default). */
  configured: AiThinkingLevel | null;
  /** The level this request sent (null: none, `configured` applies). */
  sent: AiThinkingLevel | null;
  /** `sent` is the job's default, not the user's choice: the dial still shows Default. */
  auto?: boolean;
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
function routeThinking(settings: AiSettings, route: AiRouteOk, req: Pick<AiRunRequest, 'thinking' | 'job' | 'feature'>): { info: AiRunThinking; overrides?: Json; contextTokens: number | null } | null {
  const engine = settings.engines.find((e) => e.id === route.engineId);
  if (!engine || thinkingChoices(engine.kind).length === 0) {return null;}
  const model = engine.models.find((m) => m.id === route.modelId);
  const configured = thinkingLevelFrom(engine.kind, model?.requestOverrides);
  const wanted = req.thinking;
  const explicit = typeof wanted === 'function' ? wanted(engine.kind) : wanted ?? null;
  const { level, auto } = resolveThinkingLevel(engine.kind, explicit, configured, req.job ?? req.feature, { modelId: route.modelId });
  const overrides = level ? thinkingRequestOverrides(engine.kind, model?.requestOverrides, level, { local: route.isLocal }) : undefined;
  return {
    info: { kind: engine.kind, configured, sent: overrides ? level : null, ...(overrides && auto ? { auto: true } : {}) },
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

/** The route as the activity log keeps it. */
function activityRoute(settings: AiSettings, route: AiRouteOk): NonNullable<AiActivityEntry['route']> {
  const engine = settings.engines.find((e) => e.id === route.engineId);
  return { engineId: route.engineId, modelId: route.modelId, label: engine?.name ?? route.engineId, isLocal: route.isLocal, viaFallback: route.viaFallback };
}

/** The recorder is a side channel: a failure in it never reaches the completion. */
function openActivity(ctx: AiRunContext, entry: AiActivityEntry): void {
  try { ctx.activity?.record(entry); } catch { /* ignore */ }
}

function patchActivity(ctx: AiRunContext, id: string, patch: Parameters<AiActivityLog['update']>[1]): void {
  try { ctx.activity?.update(id, patch); } catch { /* ignore */ }
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
  const e = makeAiError(map[r.unusable] ?? 'unknown', r.reason);
  return r.engineId ? { ...e, engineId: r.engineId } : e;
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
  /** "Allow once" grants: this run only, never written to the session. */
  const once: Record<string, boolean> = {};
  let retried = false;

  // Bounded: each pass either sends, records a consent answer, or marks one engine failed.
  for (let pass = 0; pass < 12; pass++) {
    if (signal.aborted) {throw makeAiError('cancelled');}

    let route: AiRouteOk | null = null;
    if (tier2) {
      const consent: AiConsentState = { ...ctx.consent, ...once, ...refused };
      const resolved = resolveRoute(ctx.settings(), withFailures(ctx.statuses(), failed), consent, { feature: req.feature, ...(req.task ? { task: req.task } : {}) });
      if (!isRouteUsable(resolved)) {throw routeUnusableError(resolved);}
      if (resolved.needsConsent) {
        const reply = ctx.ai.requestCloudConsent
          ? await ctx.ai.requestCloudConsent(resolved.engineId, { feature: req.feature, ...(req.sends ? { sends: req.sends } : {}) })
          : true;
        if (signal.aborted) {throw makeAiError('cancelled');}
        if (reply === true) {ctx.consent[resolved.engineId] = true;}
        else if (reply === 'once') {once[resolved.engineId] = true;}
        else {
          refused[resolved.engineId] = false;
          // A stored refusal from an older version: the host will not ask again, so the
          // menu entries disable with the router's reason for the rest of the session.
          if (reply === 'never') {ctx.consent[resolved.engineId] = false;}
        }
        continue;
      }
      route = resolved;
    }

    const thinking = route ? routeThinking(ctx.settings(), route, req) : null;
    const maxTokens = requestMaxTokens(req, thinking);
    events.onRoute?.(route, thinking?.info ?? null);
    let text = '';
    let gotToken = false;
    const request: AiCompletionRequest = {
      requestId: nextRequestId(req.feature),
      feature: req.feature,
      task: route?.task ?? req.task ?? resolveAiFeature(ctx.settings().features, req.feature).task,
      ...(route ? { route: { engineId: route.engineId, modelId: route.modelId } } : {}),
      messages: req.messages,
      ...(req.format ? { format: req.format } : {}),
      ...(maxTokens !== undefined ? { maxTokens } : {}),
      ...(req.temperature !== undefined ? { temperature: req.temperature } : {}),
      ...(thinking?.overrides ? { requestOverrides: thinking.overrides } : {}),
    };
    const entryId = request.requestId;
    openActivity(ctx, {
      id: entryId,
      startedAt: Date.now(),
      endedAt: null,
      feature: request.feature,
      ...(req.job ? { job: req.job } : {}),
      task: request.task,
      route: route ? activityRoute(ctx.settings(), route) : null,
      thinking: thinking?.info ?? null,
      request,
      response: { text: '' },
      error: null,
      attempt: retried ? 2 : 1,
    });
    try {
      const result = await ctx.ai.complete(request, (delta) => {
        if (signal.aborted) {return;}
        gotToken = true;
        text += delta;
        patchActivity(ctx, entryId, { response: { text } });
        events.onToken?.(delta, text);
      }, signal);
      patchActivity(ctx, entryId, { endedAt: Date.now(), response: aiActivityResponse(result) });
      return { result, route, viaFallback: route?.viaFallback ?? false, thinking: thinking?.info ?? null };
    } catch (err) {
      const e = signal.aborted ? makeAiError('cancelled') : toAiError(err);
      const retrying = e.code === 'unreachable' && !gotToken && !retried && !!route;
      patchActivity(ctx, entryId, {
        endedAt: Date.now(),
        error: route && !e.engineId && e.code !== 'cancelled' ? { ...e, engineId: route.engineId } : e,
        ...(retrying ? { retried: true as const } : {}),
      });
      // The routed engine is down and nothing was shown yet: the host has
      // marked it failed; pass it over and try the fallback once.
      if (retrying && route) {
        retried = true;
        failed.set(route.engineId, e.message);
        continue;
      }
      // The popover's "Open <engine>" goes to the engine that failed.
      throw route && !e.engineId && e.code !== 'cancelled' ? { ...e, engineId: route.engineId } : e;
    }
  }
  throw makeAiError('unknown', 'No engine answered.');
}

/**
 * The short notice for a launch (palette command, hotkey) that does nothing
 * because AI or the feature is switched off, so it never fails silently.
 * Null when that is not the reason: no AI host, or the feature is on.
 */
export function aiFeatureOffNotice(ai: MikeDownAiHost | undefined, settings: AiSettings, feature: string): string | null {
  if (!ai) {return null;}
  if (!settings.enabled) {return 'AI is turned off. Turn it on in the AI settings.';}
  const resolved = resolveAiFeature(settings.features, feature);
  if (resolved.enabled) {return null;}
  return `${resolved.definition?.label ?? feature} is turned off in the AI settings.`;
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
  // Grants and stored "never" answers count here ("Allow once" and "Don't allow"
  // are never written to the session, so the next attempt goes to the host).
  const answers: Record<string, boolean> = {};
  for (const [id, v] of Object.entries(consent)) {if (typeof v === 'boolean') {answers[id] = v;}}
  const r = resolveRoute(settings, statuses, answers, { feature });
  return isRouteUsable(r) ? { state: 'enabled' } : { state: 'disabled', reason: r.reason };
}
