/**
 * Inline suggestions ("ghost text"): the surface-agnostic controller
 * (decisions D1 to D13 in ghost-text-plan.md). It knows nothing about
 * ProseMirror or the DOM. The editor plugin feeds it document events and
 * shows whatever it hands to `onSuggestion`.
 *
 * - Timing (D1, D2): every text change aborts the request in flight, clears
 *   the suggestion and restarts one idle timer (`delayMs`, `trigger: 'manual'`
 *   turns the timer off). A selection move aborts and clears but starts no
 *   timer. There is never a queue: one request at a time.
 * - Streaming (D5): each token re-trims the text so far; a stop rule firing
 *   aborts the request so the model does not keep generating.
 * - Accept (D6): the whole text, or one word; typing a character that matches
 *   the start of the suggestion keeps the rest.
 * - Errors (D9): `cloudBlocked`, `capability`, `featureDisabled` and a refused
 *   consent are silent (the suggestion is just cleared) but reported once per
 *   session through `onError`; anything else backs off (delay doubles up to
 *   5 s, reset on success).
 * - Activity (D10): only an accepted suggestion or a failed request is
 *   recorded, by this controller, through `record`. Callers pass
 *   `activity: undefined` in the run context so dismissed ghosts do not flood
 *   the recorder.
 *
 * Lives in the lazy AI chunk (`ai-ui.ts`); the editor must not import it
 * statically.
 */

import {
  buildContinueMessages,
  continueMaxTokens,
  ghostAcceptWord,
  ghostContext,
  ghostPrefixMatch,
  makeAiError,
  trimGhostSuggestionDetailed,
  type AiError,
  type AiErrorCode,
  type AiGhostTextOptions,
  type AiCompletionRequest,
  type AiMessage,
  type AiRouteOk,
  type AiServedBy,
  type GhostBlockKind,
} from './ai';
import type { AiActivityEntry, AiActivityRoute } from './ai-activity';
import type { AiRunEvents, AiRunOutcome, AiRunRequest, AiRunThinking } from './ai-request';

/** What the plugin reports on every text change. */
export interface GhostChangeInput {
  /** Serialize lazily: called only when a request is about to fire, never per keystroke. */
  read: () => { markdown: string; caretOffset: number };
  atBlockEnd: boolean;
  eligible: boolean;          // false: abort, clear, no timer
  blockKind?: GhostBlockKind; // from ai/prompts/continue.ts
}

export interface GhostController {
  /** Document text changed: abort, clear, restart the idle timer. */
  noteChange(input: GhostChangeInput): void;
  /** Caret moved without a text change: abort, clear, cancel the timer, do NOT start one (D1). */
  noteSelectionMove(): void;
  /**
   * Manual: fires now from `input` (or the latest `noteChange` input when
   * omitted) if eligible, ignoring the trigger mode. `input` lets the caller
   * hand in a fresh snapshot when the caret moved since the last change.
   */
  triggerNow(input?: GhostChangeInput): void;
  /** The whole visible text to insert (null if none); clears, records one activity entry, calls `onServed`. */
  accept(): string | null;
  /** The next word per `ghostAcceptWord` (null if none); the rest stays visible via `onSuggestion`. */
  acceptWord(): string | null;
  /** Abort, clear, cancel the timer. */
  dismiss(): void;
  /** true: `char` matched (`ghostPrefixMatch`), the stream was aborted, the remainder stays via `onSuggestion`. false: no match, nothing else done. */
  typed(char: string): boolean;
  destroy(): void;
}

/** Why a ghost request failed; the first four are silent (no toast), the rest are the error codes. */
export type GhostErrorReason = AiErrorCode | 'capability' | 'featureDisabled';

export interface GhostErrorInfo {
  reason: GhostErrorReason;
  /** True for a reason that is shown nowhere but the toolbar menu; reported once per session. */
  silent: boolean;
  /** The router's or the engine's own message, for the menu's tooltip. */
  error: AiError;
}

export interface GhostControllerDeps {
  /** The editor's run, built with `activity: undefined` (D10). */
  run(req: AiRunRequest, events: AiRunEvents, signal: AbortSignal): Promise<AiRunOutcome>;
  /** Read on every use, so a settings broadcast needs no rebuild. */
  options(): AiGhostTextOptions;
  /** The routed model's context window in tokens (a guess is fine). */
  contextTokens(): number;
  /** The text to show at the caret, or null for none. Called only when the text changes. */
  onSuggestion(text: string | null): void;
  /** A ghost request is streaming (the toolbar AI button pulses). Called only when the state changes. */
  onBusy?(busy: boolean): void;
  /** An accepted suggestion was served by this engine (the footer chip, D11). */
  onServed?(served: AiServedBy, viaFallback: boolean): void;
  /** See `GhostErrorInfo`. */
  onError?(info: GhostErrorInfo): void;
  /** The activity recorder (D10): one entry per accepted suggestion, one per failed request. */
  record?(entry: AiActivityEntry): void;
  /** The engine's display name for the activity entry and the footer chip (defaults to the engine id). */
  routeLabel?(route: AiRouteOk): string;
  /** Timer seam for tests. */
  setTimer?: (fn: () => void, ms: number) => unknown;
  clearTimer?: (handle: unknown) => void;
  now?: () => number;
}

/** The longest delay network backoff may reach (D2 note in the milestone). */
export const GHOST_BACKOFF_MAX_MS = 5000;

const SILENT_REASONS: ReadonlySet<GhostErrorReason> = new Set<GhostErrorReason>(['cloudBlocked', 'consentDenied', 'capability', 'featureDisabled']);

/**
 * Which reason an error stands for. `routeUnusableError` (ai-request.ts)
 * keeps `cloudBlocked` and `consentDenied` as codes but turns every other
 * unusable route into `unknown` with the router's sentence, so the two
 * silent ones that matter here are told apart by that sentence.
 */
export function classifyGhostError(error: AiError): GhostErrorReason {
  if (error.code !== 'unknown') {return error.code;}
  if (/\bis turned off\.?$/i.test(error.message) || /^No engine and model is chosen/i.test(error.message)) {return 'featureDisabled';}
  if (/\blacks\b/.test(error.message)) {return 'capability';}
  return 'unknown';
}

/** What the current (or last) suggestion came from; kept for the activity entry. */
interface Origin {
  id: string;
  startedAt: number;
  endedAt: number | null;
  request: AiCompletionRequest;
  route: AiRouteOk | null;
  thinking: AiRunThinking | null;
  served: AiServedBy | null;
  viaFallback: boolean;
  raw: string;
  /** The activity entry and `onServed` were already issued for this suggestion (a word was accepted). */
  recorded: boolean;
}

let originCounter = 0;

export function createGhostController(deps: GhostControllerDeps): GhostController {
  const setTimer = deps.setTimer ?? ((fn: () => void, ms: number): unknown => setTimeout(fn, ms));
  const clearTimer = deps.clearTimer ?? ((h: unknown): void => clearTimeout(h as ReturnType<typeof setTimeout>));
  const now = deps.now ?? ((): number => Date.now());

  let destroyed = false;
  let latest: GhostChangeInput | null = null;
  let timer: unknown = null;
  let controller: AbortController | null = null;
  /** Bumped on every abort and every new request; a late reply from an older one is ignored. */
  let seq = 0;
  let busy = false;
  /** The text on screen (what `onSuggestion` last received), or null. */
  let visible: string | null = null;
  let origin: Origin | null = null;
  /** Extra delay after network failures: 0 means none. */
  let backoffMs = 0;
  const reported = new Set<GhostErrorReason>();
  /** The user refused cloud consent: no more requests this session (D9). */
  let silenced = false;
  /** "Allow once" covers one request, so a pause stops asking on every stop; the shortcut still can. */
  let idleStopped = false;

  function setBusy(next: boolean): void {
    if (busy === next) {return;}
    busy = next;
    try { deps.onBusy?.(next); } catch { /* a UI callback never breaks the controller */ }
  }

  function show(text: string | null): void {
    const next = text === null || text === '' ? null : text;
    if (next === visible) {return;}
    visible = next;
    if (destroyed) {return;}
    deps.onSuggestion(next);
  }

  function cancelTimer(): void {
    if (timer !== null) {
      clearTimer(timer);
      timer = null;
    }
  }

  /** Abort the request in flight (if any) and ignore whatever it still sends. */
  function stopStream(): void {
    seq += 1;
    const c = controller;
    controller = null;
    if (c && !c.signal.aborted) {c.abort();}
    setBusy(false);
  }

  /** Stop everything and clear the suggestion. */
  function clearAll(): void {
    cancelTimer();
    stopStream();
    origin = null;
    show(null);
  }

  function delay(): number {
    return Math.max(deps.options().delayMs, backoffMs);
  }

  function bumpBackoff(): void {
    backoffMs = Math.min(GHOST_BACKOFF_MAX_MS, Math.max(deps.options().delayMs, backoffMs) * 2);
  }

  function activityRoute(route: AiRouteOk): AiActivityRoute {
    let label = route.engineId;
    try { label = deps.routeLabel?.(route) ?? label; } catch { /* keep the id */ }
    return { engineId: route.engineId, modelId: route.modelId, label, isLocal: route.isLocal, viaFallback: route.viaFallback };
  }

  function servedOf(o: Origin): AiServedBy | null {
    if (o.served) {return o.served;}
    if (!o.route) {return null;}
    return { engineId: o.route.engineId, engineName: activityRoute(o.route).label, modelId: o.route.modelId, isLocal: o.route.isLocal };
  }

  function record(entry: AiActivityEntry): void {
    try { deps.record?.(entry); } catch { /* the recorder is a side channel */ }
  }

  function entryFor(o: Origin, response: string, error: AiError | null): AiActivityEntry {
    return {
      id: o.id,
      startedAt: o.startedAt,
      endedAt: o.endedAt ?? now(),
      feature: 'ghostText',
      job: 'ghostText',
      task: o.request.task,
      route: o.route ? activityRoute(o.route) : null,
      thinking: o.thinking,
      request: o.request,
      response: { text: response, ...(o.served ? { served: o.served } : {}) },
      error,
      attempt: 1,
    };
  }

  /** The first accept of a suggestion: one activity entry (the trimmed text on screen, not the raw stream), and the footer chip. */
  function markAccepted(): void {
    const o = origin;
    if (!o || o.recorded) {return;}
    o.recorded = true;
    record(entryFor(o, visible ?? o.raw, null));
    const served = servedOf(o);
    if (served) {
      try { deps.onServed?.(served, o.viaFallback); } catch { /* ignore */ }
    }
  }

  function handleError(err: unknown, o: Origin): void {
    const error = toError(err);
    if (error.code === 'cancelled') {return;}
    const reason = classifyGhostError(error);
    const silent = SILENT_REASONS.has(reason);
    show(null);
    if (reason === 'consentDenied') {silenced = true;}
    if (silent) {
      if (!reported.has(reason)) {
        reported.add(reason);
        report({ reason, silent: true, error });
      }
      return;
    }
    bumpBackoff();
    o.endedAt = now();
    record(entryFor(o, o.raw, error));
    report({ reason, silent: false, error });
  }

  function report(info: GhostErrorInfo): void {
    if (destroyed) {return;}
    try { deps.onError?.(info); } catch { /* ignore */ }
  }

  function fire(input: GhostChangeInput): void {
    if (destroyed || silenced || !input.eligible) {return;}
    cancelTimer();
    stopStream();
    show(null);
    origin = null;

    const options = deps.options();
    let snapshot: { markdown: string; caretOffset: number };
    try { snapshot = input.read(); } catch { return; }
    const maxTokens = continueMaxTokens(options.maxTokens);
    const ctx = ghostContext(snapshot.markdown, snapshot.caretOffset, deps.contextTokens(), { outputTokens: maxTokens });
    // Nothing to continue (empty document, caret in the frontmatter).
    if (ctx.before.trim() === '') {return;}

    const messages: AiMessage[] = buildContinueMessages({ before: ctx.before, after: ctx.after, ...(input.blockKind ? { blockKind: input.blockKind } : {}) });
    const req: AiRunRequest = {
      feature: 'ghostText',
      task: 'continue',
      sends: 'cursor',
      messages,
      maxTokens,
      temperature: 0.3,
      thinking: 'off',
      job: 'ghostText',
      localOnly: options.localOnly,
    };

    const ac = new AbortController();
    controller = ac;
    const mySeq = ++seq;
    originCounter += 1;
    const o: Origin = {
      id: `ai-ghostText-${now().toString(36)}-g${originCounter}`,
      startedAt: now(),
      endedAt: null,
      request: { requestId: '', feature: req.feature, task: req.task ?? 'continue', messages, maxTokens, temperature: 0.3 },
      route: null,
      thinking: null,
      served: null,
      viaFallback: false,
      raw: '',
      recorded: false,
    };
    o.request.requestId = o.id;
    origin = o;
    setBusy(true);

    const events: AiRunEvents = {
      onRoute(route, thinking) {
        if (mySeq !== seq) {return;}
        o.route = route;
        o.thinking = thinking;
        o.viaFallback = route?.viaFallback ?? false;
      },
      onToken(_delta, text) {
        if (mySeq !== seq) {return;}
        o.raw = text;
        const r = trimGhostSuggestionDetailed(text, { atBlockEnd: input.atBlockEnd, before: ctx.before });
        show(r.text);
        if (r.stopped) {
          // A stop rule fired: more tokens cannot change the suggestion, so stop generating.
          o.endedAt = now();
          succeeded();
          stopStream();
        }
      },
      // Not tied to `seq`: an answer given after this request was aborted counts too.
      onConsent(reply) {
        if (reply === 'once') {idleStopped = true;}
      },
    };

    let pending: Promise<AiRunOutcome>;
    try {
      pending = deps.run(req, events, ac.signal);
    } catch (err) {
      stopStream();
      handleError(err, o);
      return;
    }
    pending.then(
      (outcome) => {
        if (mySeq !== seq) {return;}
        o.endedAt = now();
        o.served = outcome.result.served ?? null;
        o.viaFallback = outcome.viaFallback;
        if (outcome.route) {o.route = outcome.route;}
        if (outcome.thinking) {o.thinking = outcome.thinking;}
        if (outcome.requestId) {
          o.id = outcome.requestId;
          o.request.requestId = outcome.requestId;
        }
        o.raw = outcome.result.text || o.raw;
        const r = trimGhostSuggestionDetailed(o.raw, { atBlockEnd: input.atBlockEnd, before: ctx.before });
        show(r.text);
        succeeded();
        controller = null;
        setBusy(false);
      },
      (err) => {
        if (mySeq !== seq) {return;}
        controller = null;
        setBusy(false);
        handleError(err, o);
      },
    );
  }

  /** A request produced an answer: the delay returns to normal and silent reasons can be reported again. */
  function succeeded(): void {
    backoffMs = 0;
    reported.clear();
  }

  function startTimer(input: GhostChangeInput): void {
    timer = setTimer(() => {
      timer = null;
      if (!idleStopped) {fire(input);}
    }, delay());
  }

  return {
    noteChange(input) {
      if (destroyed) {return;}
      latest = input;
      clearAll();
      if (!input.eligible || silenced || idleStopped) {return;}
      if (deps.options().trigger === 'manual') {return;}
      startTimer(input);
    },

    noteSelectionMove() {
      if (destroyed) {return;}
      clearAll();
    },

    triggerNow(input) {
      if (destroyed) {return;}
      if (input) {latest = input;}
      const target = latest;
      clearAll();
      if (!target || !target.eligible) {return;}
      fire(target);
    },

    accept() {
      const text = visible;
      if (text === null) {return null;}
      markAccepted();
      cancelTimer();
      stopStream();
      origin = null;
      show(null);
      return text;
    },

    acceptWord() {
      const text = visible;
      if (text === null) {return null;}
      const word = ghostAcceptWord(text);
      markAccepted();
      // The rest is what is left of the text as it stands; further tokens would no longer line up with the caret.
      stopStream();
      show(text.slice(word.length));
      return word;
    },

    dismiss() {
      if (destroyed) {return;}
      clearAll();
    },

    typed(char) {
      const text = visible;
      if (text === null || char === '') {return false;}
      const rest = ghostPrefixMatch(text, char);
      if (rest === null) {return false;}
      stopStream();
      if (rest === '') {origin = null;}
      show(rest);
      return true;
    },

    destroy() {
      if (destroyed) {return;}
      cancelTimer();
      stopStream();
      destroyed = true;
      latest = null;
      origin = null;
      visible = null;
    },
  };
}

function toError(err: unknown): AiError {
  if (typeof err === 'object' && err !== null && typeof (err as AiError).code === 'string' && typeof (err as AiError).message === 'string') {
    return err as AiError;
  }
  if (typeof err === 'object' && err !== null && (err as { name?: unknown }).name === 'AbortError') {return makeAiError('cancelled');}
  return makeAiError('unknown', err instanceof Error ? err.message : undefined);
}
