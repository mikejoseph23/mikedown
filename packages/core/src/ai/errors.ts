/**
 * `AiError` helpers and the user-facing copy for each `AiErrorCode`, kept in
 * one place so the rewrite popover, the AI tab and the indicator say the same
 * thing. Hosts reject with `{ code, message }`; `message` is the technical
 * detail, the copy here is what the user reads first.
 */

import { AI_ERROR_CODES } from './types';
import type { AiError, AiErrorCode } from './types';

export interface AiErrorCopy {
  title: string;
  message: string;
  /** Suggested next step, when there is one. */
  action?: 'openSettings' | 'retry' | 'shortenSelection';
}

export const AI_ERROR_COPY: Readonly<Record<AiErrorCode, AiErrorCopy>> = {
  unreachable: {
    title: 'Engine not reachable',
    message: 'The AI engine did not answer. Check that the server is running and the base URL is right.',
    action: 'openSettings',
  },
  auth: {
    title: 'Key rejected',
    message: 'The engine refused the API key. Store a new key in AI settings, or check the environment variable.',
    action: 'openSettings',
  },
  modelNotFound: {
    title: 'Model not found',
    message: 'The engine does not serve this model. Discover models again or pick another one in AI settings.',
    action: 'openSettings',
  },
  contextOverflow: {
    title: 'Too much text',
    message: "The text is longer than the model's context window. Try a shorter selection.",
    action: 'shortenSelection',
  },
  rateLimited: {
    title: 'Rate limited',
    message: 'The engine is busy or the rate limit was reached. Wait a moment and try again.',
    action: 'retry',
  },
  cloudBlocked: {
    title: 'Cloud engines are off',
    message: 'This task is routed to a cloud engine, and Allow cloud is off in AI settings.',
    action: 'openSettings',
  },
  consentDenied: {
    title: 'Not allowed in this workspace',
    message: 'Sending text to this cloud engine was not allowed for this workspace.',
    action: 'openSettings',
  },
  cancelled: {
    title: 'Cancelled',
    message: 'The request was cancelled.',
  },
  badOutput: {
    title: 'No usable answer',
    message: 'The model did not return a usable answer. Try again or pick another model.',
    action: 'retry',
  },
  unknown: {
    title: 'Something went wrong',
    message: 'The AI request failed.',
    action: 'retry',
  },
};

/**
 * A stream that stopped at its token limit (`finishReason: 'length'`). A
 * thinking model counts its reasoning against that limit, so with thinking
 * on the advice is to lower Thinking. `empty`: no answer text came back at
 * all (shown as the error); otherwise the answer is shown with `message` as
 * a note.
 */
export function aiLengthLimitCopy(opts: { thinking: boolean; empty: boolean }): AiErrorCopy {
  if (opts.empty) {
    return opts.thinking
      ? { title: 'No room left to answer', message: 'The model used its whole length budget thinking and sent no answer. Lower Thinking, or Retry.', action: 'retry' }
      : { title: 'No room left to answer', message: 'The model reached its length limit before it sent any text. Retry.', action: 'retry' };
  }
  return opts.thinking
    ? { title: 'Answer cut off', message: 'The answer was cut off at the length limit. Lower Thinking, or Retry, for a full answer.', action: 'retry' }
    : { title: 'Answer cut off', message: 'The answer was cut off at the length limit.', action: 'retry' };
}

export function isAiErrorCode(v: unknown): v is AiErrorCode {
  return typeof v === 'string' && (AI_ERROR_CODES as readonly string[]).includes(v);
}

export function isAiError(v: unknown): v is AiError {
  return typeof v === 'object' && v !== null && isAiErrorCode((v as AiError).code) && typeof (v as AiError).message === 'string';
}

export function makeAiError(code: AiErrorCode, message?: string): AiError {
  return { code, message: message ?? AI_ERROR_COPY[code].message };
}

/** Any rejection value as an `AiError`: an `AiError` as is, an `AbortError` as `cancelled`, the rest `unknown`. */
export function toAiError(err: unknown): AiError {
  if (isAiError(err)) {return { code: err.code, message: err.message };}
  if (typeof err === 'object' && err !== null && (err as { name?: unknown }).name === 'AbortError') {return makeAiError('cancelled');}
  const message = err instanceof Error ? err.message : typeof err === 'string' ? err : AI_ERROR_COPY.unknown.message;
  return { code: 'unknown', message };
}

export function aiErrorCopy(code: AiErrorCode): AiErrorCopy {
  return AI_ERROR_COPY[code] ?? AI_ERROR_COPY.unknown;
}

/**
 * Map an HTTP failure to a code (shared by both hosts): 401/403 auth, 404
 * modelNotFound, 413 or a 400 that mentions the context contextOverflow, 429
 * and 529 rateLimited, 502/503/504 unreachable, everything else unknown.
 */
export function aiErrorCodeFromHttp(status: number, bodyText = ''): AiErrorCode {
  if (status === 401 || status === 403) {return 'auth';}
  if (status === 404) {return 'modelNotFound';}
  if (status === 413) {return 'contextOverflow';}
  if (status === 429 || status === 529) {return 'rateLimited';}
  if (status === 400 && /context|too long|maximum.*tokens|token limit/i.test(bodyText)) {return 'contextOverflow';}
  if (status === 400 && /model.*(not found|does not exist|unknown)|no such model/i.test(bodyText)) {return 'modelNotFound';}
  if (status === 502 || status === 503 || status === 504) {return 'unreachable';}
  return 'unknown';
}
