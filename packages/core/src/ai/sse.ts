/**
 * Server-sent events, reassembled from arbitrary network chunks (a line, or
 * a multi-byte character, may be split across chunks; the host decodes bytes
 * with a streaming `TextDecoder` before pushing text here), plus readers for
 * the two completion stream shapes:
 *
 * - OpenAI Chat Completions (OpenAI, oMLX, LM Studio, Ollama `/v1`, vLLM,
 *   llama.cpp): `data: {choices:[{delta:{content}}]}` chunks ending in
 *   `data: [DONE]`. `reasoning_content` deltas are thinking, not text.
 * - Anthropic Messages: `message_start`, `content_block_delta` with
 *   `text_delta`, `message_delta` with `stop_reason` and usage, `message_stop`,
 *   and an `error` event.
 *
 * A stream that ends without its terminator (`[DONE]` or `message_stop`) is
 * truncated: `finishReason: 'error'`.
 */

import type { AiEngineKind, AiErrorCode, AiFinishReason, AiUsage } from './types';

export interface SseEvent {
  /** `event:` field; absent means the default `message`. */
  event?: string;
  data: string;
  id?: string;
}

/** Incremental SSE parser (WHATWG event-stream rules: CRLF/CR/LF, `:` comments, multi-line `data`). */
export class SseParser {
  private buffer = '';
  private started = false;
  private dataLines: string[] = [];
  private eventName: string | undefined;
  private lastId: string | undefined;

  /** Feed decoded text; returns the events it completed. */
  push(chunk: string): SseEvent[] {
    let text = chunk;
    if (!this.started && text.length > 0) {
      this.started = true;
      if (text.charCodeAt(0) === 0xfeff) {text = text.slice(1);}
    }
    this.buffer += text;
    const events: SseEvent[] = [];
    for (;;) {
      const match = /\r\n|\r|\n/.exec(this.buffer);
      if (!match) {break;}
      // A lone CR at the very end may be the first half of a CRLF split across chunks.
      if (match[0] === '\r' && match.index === this.buffer.length - 1) {break;}
      const line = this.buffer.slice(0, match.index);
      this.buffer = this.buffer.slice(match.index + match[0].length);
      const event = this.line(line);
      if (event) {events.push(event);}
    }
    return events;
  }

  /** The stream closed: flush a final event that had no trailing blank line. */
  end(): SseEvent[] {
    const events: SseEvent[] = [];
    if (this.buffer.length > 0) {
      const rest = this.buffer.replace(/\r$/, '');
      this.buffer = '';
      const event = this.line(rest);
      if (event) {events.push(event);}
    }
    const last = this.line('');
    if (last) {events.push(last);}
    return events;
  }

  private line(line: string): SseEvent | null {
    if (line === '') {
      if (this.dataLines.length === 0) {
        this.eventName = undefined;
        return null;
      }
      const event: SseEvent = { data: this.dataLines.join('\n') };
      if (this.eventName) {event.event = this.eventName;}
      if (this.lastId !== undefined) {event.id = this.lastId;}
      this.dataLines = [];
      this.eventName = undefined;
      return event;
    }
    if (line.startsWith(':')) {return null;}
    const colon = line.indexOf(':');
    const field = colon === -1 ? line : line.slice(0, colon);
    let value = colon === -1 ? '' : line.slice(colon + 1);
    if (value.startsWith(' ')) {value = value.slice(1);}
    if (field === 'data') {
      this.dataLines.push(value);
    } else if (field === 'event') {
      this.eventName = value;
    } else if (field === 'id' && !value.includes('\u0000')) {
      this.lastId = value;
    }
    return null;
  }
}

/** Where a completion stream ended up. */
export interface StreamOutcome {
  text: string;
  finishReason: AiFinishReason;
  usage?: AiUsage;
  /** The provider's own stop reason (`end_turn`, `length`, `refusal`...). */
  stopReason?: string;
  /** A stream-level error event, mapped to a code. */
  error?: { code: AiErrorCode; message: string };
}

/** One completion stream: push decoded chunks, get text deltas back, then `finish`. */
export interface CompletionStreamReader {
  push(chunk: string): string[];
  finish(): StreamOutcome;
}

function parseJson(data: string): Record<string, unknown> | null {
  try {
    const v: unknown = JSON.parse(data);
    return typeof v === 'object' && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

function num(v: unknown): number | undefined {
  return typeof v === 'number' && Number.isFinite(v) ? v : undefined;
}

function errorCodeFromType(type: unknown): AiErrorCode {
  switch (type) {
    case 'authentication_error':
    case 'permission_error':
    case 'invalid_api_key':
      return 'auth';
    case 'not_found_error':
    case 'model_not_found':
      return 'modelNotFound';
    case 'rate_limit_error':
    case 'overloaded_error':
    case 'rate_limit_exceeded':
      return 'rateLimited';
    case 'context_length_exceeded':
    case 'request_too_large':
      return 'contextOverflow';
    default:
      return 'unknown';
  }
}

function streamError(raw: unknown): { code: AiErrorCode; message: string } {
  const e = typeof raw === 'object' && raw !== null ? (raw as Record<string, unknown>) : {};
  const message = typeof e.message === 'string' ? e.message : typeof raw === 'string' ? raw : 'The stream reported an error.';
  return { code: errorCodeFromType(e.type ?? e.code), message };
}

function mapOpenAiFinish(reason: string): AiFinishReason {
  if (reason === 'length') {return 'length';}
  if (reason === 'stop' || reason === 'tool_calls' || reason === 'function_call' || reason === 'eos') {return 'stop';}
  return 'error';
}

function mapAnthropicStop(reason: string): AiFinishReason {
  if (reason === 'max_tokens' || reason === 'model_context_window_exceeded') {return 'length';}
  if (reason === 'end_turn' || reason === 'stop_sequence' || reason === 'tool_use' || reason === 'pause_turn') {return 'stop';}
  return 'error';
}

/** Chat Completions stream (`openai-compatible`, `lmstudio`, `ollama`, `openai`). */
export function createOpenAiStreamReader(): CompletionStreamReader {
  const parser = new SseParser();
  let text = '';
  let done = false;
  let stopReason: string | undefined;
  let usage: AiUsage | undefined;
  let error: StreamOutcome['error'];

  const handle = (events: SseEvent[]): string[] => {
    const deltas: string[] = [];
    for (const ev of events) {
      const data = ev.data.trim();
      if (data === '[DONE]') {
        done = true;
        continue;
      }
      const json = parseJson(data);
      if (!json) {continue;}
      if (json.error !== undefined) {
        error = streamError(json.error);
        continue;
      }
      const u = json.usage as Record<string, unknown> | null | undefined;
      if (u && typeof u === 'object') {
        usage = { promptTokens: num(u.prompt_tokens), completionTokens: num(u.completion_tokens) };
      }
      const choices = Array.isArray(json.choices) ? (json.choices as Array<Record<string, unknown>>) : [];
      for (const choice of choices) {
        const delta = choice.delta as Record<string, unknown> | undefined;
        const content = delta?.content;
        if (typeof content === 'string' && content) {
          text += content;
          deltas.push(content);
        }
        if (typeof choice.finish_reason === 'string' && choice.finish_reason) {stopReason = choice.finish_reason;}
      }
    }
    return deltas;
  };

  return {
    push: (chunk) => handle(parser.push(chunk)),
    finish() {
      handle(parser.end());
      let finishReason: AiFinishReason;
      if (error) {
        finishReason = 'error';
      } else if (!done) {
        finishReason = 'error';
      } else {
        finishReason = stopReason ? mapOpenAiFinish(stopReason) : 'stop';
      }
      const outcome: StreamOutcome = { text, finishReason };
      if (usage) {outcome.usage = usage;}
      if (stopReason) {outcome.stopReason = stopReason;}
      if (error) {outcome.error = error;}
      return outcome;
    },
  };
}

/** Anthropic Messages stream. */
export function createAnthropicStreamReader(): CompletionStreamReader {
  const parser = new SseParser();
  let text = '';
  let done = false;
  let stopReason: string | undefined;
  let promptTokens: number | undefined;
  let completionTokens: number | undefined;
  let error: StreamOutcome['error'];

  const handle = (events: SseEvent[]): string[] => {
    const deltas: string[] = [];
    for (const ev of events) {
      const json = parseJson(ev.data);
      if (!json) {continue;}
      const type = typeof json.type === 'string' ? json.type : ev.event;
      switch (type) {
        case 'message_start': {
          const message = json.message as Record<string, unknown> | undefined;
          const u = message?.usage as Record<string, unknown> | undefined;
          promptTokens = num(u?.input_tokens) ?? promptTokens;
          completionTokens = num(u?.output_tokens) ?? completionTokens;
          break;
        }
        case 'content_block_delta': {
          const delta = json.delta as Record<string, unknown> | undefined;
          if (delta?.type === 'text_delta' && typeof delta.text === 'string' && delta.text) {
            text += delta.text;
            deltas.push(delta.text);
          }
          break;
        }
        case 'message_delta': {
          const delta = json.delta as Record<string, unknown> | undefined;
          if (typeof delta?.stop_reason === 'string') {stopReason = delta.stop_reason;}
          const u = json.usage as Record<string, unknown> | undefined;
          promptTokens = num(u?.input_tokens) ?? promptTokens;
          completionTokens = num(u?.output_tokens) ?? completionTokens;
          break;
        }
        case 'message_stop':
          done = true;
          break;
        case 'error':
          error = streamError(json.error);
          break;
        default:
          break;
      }
    }
    return deltas;
  };

  return {
    push: (chunk) => handle(parser.push(chunk)),
    finish() {
      handle(parser.end());
      let finishReason: AiFinishReason;
      if (error || !done) {
        finishReason = 'error';
      } else {
        finishReason = stopReason ? mapAnthropicStop(stopReason) : 'stop';
      }
      const outcome: StreamOutcome = { text, finishReason };
      if (promptTokens !== undefined || completionTokens !== undefined) {outcome.usage = { promptTokens, completionTokens };}
      if (stopReason) {outcome.stopReason = stopReason;}
      if (error) {outcome.error = error;}
      return outcome;
    },
  };
}

/** The reader for an engine kind. */
export function createCompletionStreamReader(kind: AiEngineKind): CompletionStreamReader {
  return kind === 'anthropic' ? createAnthropicStreamReader() : createOpenAiStreamReader();
}
