// @vitest-environment node
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { SseParser, createAnthropicStreamReader, createCompletionStreamReader, createOpenAiStreamReader } from '@mikedown/core/ai';
import type { CompletionStreamReader } from '@mikedown/core/ai';

const FIXTURES = join(__dirname, '..', '..', '..', 'test', 'ai-fixtures', 'sse');
const load = (file: string): any => JSON.parse(readFileSync(join(FIXTURES, file), 'utf8'));

/** Run a whole stream through a reader, one chunk at a time. */
function run(reader: CompletionStreamReader, chunks: string[]) {
  const deltas = chunks.flatMap((c) => reader.push(c));
  return { deltas, outcome: reader.finish() };
}

const oa = (obj: unknown) => `data: ${JSON.stringify(obj)}\n\n`;
const delta = (content: string) => oa({ choices: [{ index: 0, delta: { content }, finish_reason: null }] });
const finish = (reason: string | null, extra: object = {}) => oa({ choices: [{ index: 0, delta: {}, finish_reason: reason }], ...extra });
const an = (type: string, body: object = {}) => `event: ${type}\ndata: ${JSON.stringify({ type, ...body })}\n\n`;
const anText = (text: string) => an('content_block_delta', { index: 0, delta: { type: 'text_delta', text } });

describe('SseParser', () => {
  it('parses events separated by blank lines, with LF, CRLF and CR endings', () => {
    for (const nl of ['\n', '\r\n', '\r']) {
      const p = new SseParser();
      // A trailing lone CR is held back (it may be half a CRLF), so end() flushes the last event.
      const events = [...p.push(`data: one${nl}${nl}data: two${nl}${nl}`), ...p.end()];
      expect(events.map((e) => e.data)).toEqual(['one', 'two']);
    }
  });

  it('joins multi-line data with newlines and reads event and id fields', () => {
    const events = new SseParser().push('event: ping\nid: 7\ndata: a\ndata: b\n\n');
    expect(events).toEqual([{ event: 'ping', id: '7', data: 'a\nb' }]);
  });

  it('skips comments and strips only one leading space', () => {
    const events = new SseParser().push(': keep-alive\ndata:  two spaces\n\ndata:none\n\n');
    expect(events.map((e) => e.data)).toEqual([' two spaces', 'none']);
  });

  it('reassembles a line split anywhere, one character at a time', () => {
    const text = 'event: x\ndata: {"a":"héllo"}\n\ndata: [DONE]\r\n\r\n';
    const p = new SseParser();
    const events = [...text].flatMap((ch) => p.push(ch));
    expect(events.map((e) => e.data)).toEqual(['{"a":"héllo"}', '[DONE]']);
    expect(events[0].event).toBe('x');
  });

  it('a CRLF split between CR and LF is one line break, not two', () => {
    const p = new SseParser();
    expect(p.push('data: a\r')).toEqual([]);
    // Had CR and LF counted as two breaks, the blank line would dispatch the event here.
    expect(p.push('\n')).toEqual([]);
    expect(p.push('\r\n')).toEqual([{ data: 'a' }]);
  });

  it('drops a leading BOM', () => {
    expect(new SseParser().push('﻿data: x\n\n')).toEqual([{ data: 'x' }]);
  });

  it('end() flushes a final event with no blank line, and nothing twice', () => {
    const p = new SseParser();
    expect(p.push('data: tail')).toEqual([]);
    expect(p.end()).toEqual([{ data: 'tail' }]);
    expect(p.end()).toEqual([]);
  });

  it('an event with no data lines produces nothing', () => {
    expect(new SseParser().push('event: only-name\n\n')).toEqual([]);
  });
});

describe('OpenAI Chat Completions stream', () => {
  it('emits content deltas and finishes with stop, usage and [DONE]', () => {
    const { deltas, outcome } = run(createOpenAiStreamReader(), [
      delta('Hel'),
      delta('lo'),
      finish('stop', { usage: { prompt_tokens: 3, completion_tokens: 2 } }),
      'data: [DONE]\n\n',
    ]);
    expect(deltas).toEqual(['Hel', 'lo']);
    expect(outcome).toEqual({ text: 'Hello', finishReason: 'stop', stopReason: 'stop', usage: { promptTokens: 3, completionTokens: 2 } });
  });

  it('ignores reasoning_content, empty deltas and the role chunk', () => {
    const { deltas, outcome } = run(createOpenAiStreamReader(), [
      oa({ choices: [{ delta: { role: 'assistant', content: '' } }] }),
      oa({ choices: [{ delta: { reasoning_content: 'thinking...' } }] }),
      delta('Answer'),
      finish('stop'),
      'data: [DONE]\n\n',
    ]);
    expect(deltas).toEqual(['Answer']);
    expect(outcome.text).toBe('Answer');
  });

  it('maps finish_reason: length, tool_calls and unknown values', () => {
    const reasonOf = (r: string) => run(createOpenAiStreamReader(), [delta('x'), finish(r), 'data: [DONE]\n\n']).outcome;
    expect(reasonOf('length')).toMatchObject({ finishReason: 'length', stopReason: 'length' });
    expect(reasonOf('tool_calls').finishReason).toBe('stop');
    expect(reasonOf('content_filter').finishReason).toBe('error');
  });

  it('[DONE] with no finish_reason is a normal stop', () => {
    const { outcome } = run(createOpenAiStreamReader(), [delta('x'), 'data: [DONE]\n\n']);
    expect(outcome).toEqual({ text: 'x', finishReason: 'stop' });
  });

  it('a truncated stream (no [DONE]) yields finishReason error, keeping the text so far', () => {
    const { outcome } = run(createOpenAiStreamReader(), [delta('par'), delta('tial'), 'data: {"choices":[{"delta":{"con']);
    expect(outcome.finishReason).toBe('error');
    expect(outcome.text).toBe('partial');
  });

  it('a stream that stops cleanly after finish_reason but before [DONE] is still an error', () => {
    const { outcome } = run(createOpenAiStreamReader(), [delta('x'), finish('stop')]);
    expect(outcome.finishReason).toBe('error');
  });

  it('an empty stream is an error', () => {
    expect(run(createOpenAiStreamReader(), []).outcome.finishReason).toBe('error');
  });

  it('a final event with no trailing blank line is still read', () => {
    const { deltas, outcome } = run(createOpenAiStreamReader(), [delta('a'), 'data: [DONE]']);
    expect(deltas).toEqual(['a']);
    expect(outcome.finishReason).toBe('stop');
  });

  it('an error object in the stream wins, with a mapped code', () => {
    const { outcome } = run(createOpenAiStreamReader(), [delta('a'), oa({ error: { type: 'rate_limit_exceeded', message: 'slow down' } }), 'data: [DONE]\n\n']);
    expect(outcome.finishReason).toBe('error');
    expect(outcome.error).toEqual({ code: 'rateLimited', message: 'slow down' });
  });

  it('skips unparsable data lines instead of throwing', () => {
    const { deltas } = run(createOpenAiStreamReader(), ['data: not json\n\n', delta('ok'), 'data: [DONE]\n\n']);
    expect(deltas).toEqual(['ok']);
  });

  it('splitting the same stream at every character gives the same result', () => {
    const whole = [delta('Hé'), ': keep-alive\n\n', delta('llo'), finish('stop', { usage: { prompt_tokens: 1, completion_tokens: 2 } }), 'data: [DONE]\r\n\r\n'].join('');
    const baseline = run(createOpenAiStreamReader(), [whole]);
    const split = run(createOpenAiStreamReader(), [...whole]);
    expect(split.deltas).toEqual(['Hé', 'llo']);
    expect(split).toEqual(baseline);
  });
});

describe('Anthropic Messages stream', () => {
  const full = (stop = 'end_turn') => [
    an('message_start', { message: { usage: { input_tokens: 25, output_tokens: 1 } } }),
    an('ping'),
    an('content_block_start', { index: 0, content_block: { type: 'text', text: '' } }),
    anText('Hi'),
    anText(' there'),
    an('content_block_stop', { index: 0 }),
    an('message_delta', { delta: { stop_reason: stop }, usage: { output_tokens: 9 } }),
    an('message_stop'),
  ];

  it('emits text_delta text, takes usage from message_start and message_delta, ends on message_stop', () => {
    const { deltas, outcome } = run(createAnthropicStreamReader(), full());
    expect(deltas).toEqual(['Hi', ' there']);
    expect(outcome).toEqual({ text: 'Hi there', finishReason: 'stop', stopReason: 'end_turn', usage: { promptTokens: 25, completionTokens: 9 } });
  });

  it('ignores thinking deltas', () => {
    const { deltas } = run(createAnthropicStreamReader(), [
      an('content_block_delta', { index: 0, delta: { type: 'thinking_delta', thinking: 'hmm' } }),
      an('content_block_delta', { index: 0, delta: { type: 'signature_delta', signature: 'abc' } }),
      anText('x'),
      an('message_stop'),
    ]);
    expect(deltas).toEqual(['x']);
  });

  it('maps stop reasons', () => {
    const reasonOf = (r: string) => run(createAnthropicStreamReader(), full(r)).outcome.finishReason;
    expect(reasonOf('end_turn')).toBe('stop');
    expect(reasonOf('stop_sequence')).toBe('stop');
    expect(reasonOf('max_tokens')).toBe('length');
    expect(reasonOf('refusal')).toBe('error');
  });

  it('a truncated stream (no message_stop) is an error', () => {
    const { outcome } = run(createAnthropicStreamReader(), full().slice(0, 4));
    expect(outcome.finishReason).toBe('error');
    expect(outcome.text).toBe('Hi');
  });

  it('an error event maps overloaded_error to rateLimited and keeps the earlier text', () => {
    const { outcome } = run(createAnthropicStreamReader(), [anText('par'), an('error', { error: { type: 'overloaded_error', message: 'Overloaded' } })]);
    expect(outcome.finishReason).toBe('error');
    expect(outcome.error).toEqual({ code: 'rateLimited', message: 'Overloaded' });
    expect(outcome.text).toBe('par');
  });

  it('maps other error types', () => {
    const codeOf = (type: string) => run(createAnthropicStreamReader(), [an('error', { error: { type, message: 'm' } })]).outcome.error?.code;
    expect(codeOf('authentication_error')).toBe('auth');
    expect(codeOf('not_found_error')).toBe('modelNotFound');
    expect(codeOf('request_too_large')).toBe('contextOverflow');
    expect(codeOf('api_error')).toBe('unknown');
  });

  it('splitting the stream at every character gives the same result', () => {
    const whole = full().join('');
    expect(run(createAnthropicStreamReader(), [...whole])).toEqual(run(createAnthropicStreamReader(), [whole]));
  });
});

describe('createCompletionStreamReader', () => {
  it('picks the Anthropic reader for anthropic and the Chat Completions reader for everything else', () => {
    expect(run(createCompletionStreamReader('anthropic'), full2()).outcome.text).toBe('A');
    for (const kind of ['openai-compatible', 'lmstudio', 'ollama', 'openai'] as const) {
      expect(run(createCompletionStreamReader(kind), [delta('B'), 'data: [DONE]\n\n']).outcome.text).toBe('B');
    }
  });
  function full2() {
    return [anText('A'), an('message_stop')];
  }
});

describe('shared fixtures, split at every character', () => {
  for (const file of ['openai-chat-stream.json', 'openai-reasoning-length-stream.json', 'openai-truncated-stream.json', 'anthropic-messages-stream.json', 'anthropic-error-stream.json']) {
    it(file, () => {
      const fx = load(file);
      const { deltas: expectedDeltas, ...expectedOutcome } = fx.expected;
      const { deltas, outcome } = run(createCompletionStreamReader(fx.kind), [...(fx.chunks as string[]).join('')]);
      expect(deltas).toEqual(expectedDeltas);
      expect(outcome).toEqual(expectedOutcome);
    });
  }

  it('the truncated fixture really is finishReason error', () => {
    expect(load('openai-truncated-stream.json').expected.finishReason).toBe('error');
  });
});
