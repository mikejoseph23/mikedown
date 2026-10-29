import {
  aiErrorCodeFromHttp,
  createCompletionStreamReader,
  isAiError,
  makeAiError,
  unsupportedRequestParam,
  type AiEngineKind,
  type AiError,
  type AiFinishReason,
  type AiTiming,
  type AiUsage,
} from '@mikedown/core/ai';

/**
 * HTTP plumbing shared by the adapters: Node `fetch` with cancellation and
 * timeouts, failures mapped to `AiError`, and the streaming read loop that
 * feeds core's SSE readers. Every function rejects with a plain `AiError`
 * (`{ code, message }`), never a raw fetch error.
 */

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export interface AdapterOptions {
  /** Injected in tests; defaults to the global (Node) `fetch`. */
  fetch?: FetchLike;
  /** Test connection timeout. Default 10 s. */
  probeTimeoutMs?: number;
  /** Discovery timeout per HTTP call. Default 15 s. */
  discoveryTimeoutMs?: number;
}

export const DEFAULT_PROBE_TIMEOUT_MS = 10_000;
export const DEFAULT_DISCOVERY_TIMEOUT_MS = 15_000;

export function resolveFetch(opts: AdapterOptions): FetchLike {
  return opts.fetch ?? ((input, init) => fetch(input, init));
}

/** A signal that aborts with `parent` or after `ms`, and says which one fired. */
export function withTimeout(parent: AbortSignal, ms: number | undefined): { signal: AbortSignal; timedOut: () => boolean; dispose: () => void } {
  const controller = new AbortController();
  let timedOut = false;
  const onAbort = (): void => controller.abort();
  if (parent.aborted) {
    controller.abort();
  } else {
    parent.addEventListener('abort', onAbort, { once: true });
  }
  const timer = ms && ms > 0 ? setTimeout(() => { timedOut = true; controller.abort(); }, ms) : undefined;
  return {
    signal: controller.signal,
    timedOut: () => timedOut,
    dispose: () => {
      if (timer) {clearTimeout(timer);}
      parent.removeEventListener('abort', onAbort);
    },
  };
}

function isAbortError(err: unknown): boolean {
  return typeof err === 'object' && err !== null && (err as { name?: unknown }).name === 'AbortError';
}

/** A thrown fetch or read error as an `AiError`. */
export function networkError(err: unknown, url: string, timedOut = false): AiError {
  if (isAiError(err)) {return err;}
  if (timedOut) {return makeAiError('unreachable', `No answer from ${originOf(url)} (timed out).`);}
  if (isAbortError(err)) {return makeAiError('cancelled');}
  // Node's fetch rejects with TypeError('fetch failed') and the socket error as `cause`.
  const cause = (err as { cause?: { code?: unknown; message?: unknown } } | undefined)?.cause;
  const detail = typeof cause?.code === 'string' ? cause.code : typeof cause?.message === 'string' ? cause.message : err instanceof Error ? err.message : String(err);
  return makeAiError('unreachable', `Could not reach ${originOf(url)} (${detail}).`);
}

export function originOf(url: string): string {
  try {
    return new URL(url).origin;
  } catch {
    return url;
  }
}

/** The provider's own error text from a failed response, trimmed. */
function errorDetail(bodyText: string): string {
  try {
    const json = JSON.parse(bodyText) as Record<string, unknown>;
    const e = json.error;
    if (typeof e === 'string') {return e;}
    if (e && typeof e === 'object' && typeof (e as { message?: unknown }).message === 'string') {return (e as { message: string }).message;}
    if (typeof json.message === 'string') {return json.message;}
    if (typeof json.detail === 'string') {return json.detail;}
  } catch {
    // Not JSON: use the text itself.
  }
  return bodyText.trim().slice(0, 300);
}

/** An `AiError` from a failed response, with the request parameter the model rejected when the body names one. */
export interface HttpAiError extends AiError {
  unsupportedParam?: string;
}

/** A non-2xx response as an `AiError` (401/403 auth, 404 modelNotFound, 413 or a context 400 contextOverflow, 429 rateLimited). */
export async function httpError(res: Response): Promise<HttpAiError> {
  let text = '';
  try {
    text = (await res.text()).slice(0, 4000);
  } catch {
    // Body unreadable; the status alone decides.
  }
  const detail = errorDetail(text);
  const error: HttpAiError = makeAiError(aiErrorCodeFromHttp(res.status, text), `HTTP ${res.status}${detail ? `: ${detail}` : ''}`);
  const param = unsupportedRequestParam(res.status, text);
  if (param) {error.unsupportedParam = param;}
  return error;
}

/** One JSON request with a timeout. Rejects with `AiError`. */
export async function requestJson(
  doFetch: FetchLike,
  url: string,
  init: { method?: string; headers: Record<string, string>; body?: unknown },
  signal: AbortSignal,
  timeoutMs: number,
): Promise<unknown> {
  const t = withTimeout(signal, timeoutMs);
  try {
    const res = await doFetch(url, {
      method: init.method ?? 'GET',
      headers: init.headers,
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
      signal: t.signal,
    });
    if (!res.ok) {throw await httpError(res);}
    const text = await res.text();
    try {
      return JSON.parse(text) as unknown;
    } catch {
      throw makeAiError('unknown', `${originOf(url)} did not answer with JSON.`);
    }
  } catch (err) {
    throw networkError(err, url, t.timedOut());
  } finally {
    t.dispose();
  }
}

export interface StreamResult {
  text: string;
  finishReason: AiFinishReason;
  usage?: AiUsage;
  timing?: AiTiming;
}

type Json = Record<string, unknown>;

function obj(v: unknown): Json {
  return typeof v === 'object' && v !== null && !Array.isArray(v) ? (v as Json) : {};
}

function num(v: unknown): number | undefined {
  return typeof v === 'number' && Number.isFinite(v) ? v : undefined;
}

/** Text and usage from a non-streamed answer (a server that ignored `stream: true`). */
function parseWholeCompletion(kind: AiEngineKind, json: unknown): StreamResult {
  const body = obj(json);
  const usageOf = (prompt: unknown, completion: unknown): { usage?: AiUsage } =>
    body.usage ? { usage: { promptTokens: num(prompt), completionTokens: num(completion) } } : {};
  if (kind === 'anthropic') {
    const blocks = Array.isArray(body.content) ? (body.content as unknown[]).map(obj) : [];
    const text = blocks.filter((b) => b.type === 'text' && typeof b.text === 'string').map((b) => b.text as string).join('');
    const usage = obj(body.usage);
    return { text, finishReason: body.stop_reason === 'max_tokens' ? 'length' : 'stop', ...usageOf(usage.input_tokens, usage.output_tokens) };
  }
  const choice = obj(Array.isArray(body.choices) ? (body.choices as unknown[])[0] : undefined);
  const content = obj(choice.message).content;
  const usage = obj(body.usage);
  return {
    text: typeof content === 'string' ? content : '',
    finishReason: choice.finish_reason === 'length' ? 'length' : 'stop',
    ...usageOf(usage.prompt_tokens, usage.completion_tokens),
  };
}

/**
 * POST a streaming completion and feed the SSE body through core's reader for
 * `kind`, calling `onToken` per text delta. A stream that reports an error, or
 * ends without its terminator, rejects: half an answer is not an answer.
 *
 * Timing runs from the POST: the first token is the first output the reader
 * sees (reasoning included), the total is the end of the stream.
 */
export async function streamCompletion(
  doFetch: FetchLike,
  kind: AiEngineKind,
  url: string,
  headers: Record<string, string>,
  body: unknown,
  onToken: (delta: string) => void,
  signal: AbortSignal,
  now: () => number = () => performance.now(),
): Promise<StreamResult> {
  const sent = now();
  let res: Response;
  try {
    res = await doFetch(url, { method: 'POST', headers: { ...headers, accept: 'text/event-stream' }, body: JSON.stringify(body), signal });
  } catch (err) {
    throw networkError(err, url);
  }
  if (!res.ok) {throw await httpError(res);}

  try {
    const contentType = res.headers.get('content-type') ?? '';
    if (contentType.includes('application/json')) {
      const whole = parseWholeCompletion(kind, await res.json());
      if (whole.text) {onToken(whole.text);}
      return { ...whole, timing: { totalMs: Math.round(now() - sent), outputChars: whole.text.length } };
    }
    if (!res.body) {throw makeAiError('unknown', `${originOf(url)} sent an empty response.`);}

    const reader = createCompletionStreamReader(kind);
    const decoder = new TextDecoder();
    const stream = res.body.getReader() as ReadableStreamDefaultReader<Uint8Array>;
    let firstAt: number | undefined;
    const feed = (text: string): void => {
      for (const delta of reader.push(text)) {onToken(delta);}
      if (firstAt === undefined && reader.outputChars() > 0) {firstAt = now();}
    };
    for (;;) {
      const { done, value } = await stream.read();
      if (done) {break;}
      feed(decoder.decode(value, { stream: true }));
    }
    feed(decoder.decode());

    const outcome = reader.finish();
    if (outcome.error) {throw makeAiError(outcome.error.code, outcome.error.message);}
    if (outcome.finishReason === 'error') {
      throw makeAiError('unknown', `${originOf(url)} closed the stream before the answer was complete.`);
    }
    const timing: AiTiming = { totalMs: Math.round(now() - sent), outputChars: reader.outputChars() };
    if (firstAt !== undefined) {timing.firstTokenMs = Math.round(firstAt - sent);}
    return { text: outcome.text, finishReason: outcome.finishReason, ...(outcome.usage ? { usage: outcome.usage } : {}), timing };
  } catch (err) {
    throw networkError(err, url);
  }
}

/** Run `fn` over `items` with at most `limit` in flight, keeping order. */
export async function mapLimit<T, R>(items: readonly T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out = new Array<R>(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i]);
    }
  });
  await Promise.all(workers);
  return out;
}
