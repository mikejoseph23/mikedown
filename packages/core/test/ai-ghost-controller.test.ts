/**
 * The inline suggestions controller (ai-ghost.ts): idle timer, abort and
 * restart, manual mode, streaming with stop rules, accept and type-through,
 * silent and backing-off errors, and what reaches the activity recorder.
 * A fake `run` stands in for the editor's; time is faked.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { isRouteUsable, makeAiError, parseAiSettings, resolveRoute } from '../src/ai';
import type { AiError, AiGhostTextOptions, AiModelCapabilities, AiRouteOk, AiSettings } from '../src/ai';
import type { AiActivityEntry } from '../src/ai-activity';
import { GHOST_BACKOFF_MAX_MS, classifyGhostError, createGhostController } from '../src/ai-ghost';
import type { GhostChangeInput, GhostController, GhostControllerDeps, GhostErrorInfo } from '../src/ai-ghost';
import { routeUnusableError } from '../src/ai-request';
import type { AiRunEvents, AiRunOutcome, AiRunRequest } from '../src/ai-request';

// ── Harness ─────────────────────────────────────────────────────────────────

const ROUTE: AiRouteOk = { engineId: 'omlx', modelId: 'small', viaFallback: false, task: 'continue', isLocal: true, needsConsent: false };
const BEFORE = 'It was a quiet evening in the';

interface Call {
  req: AiRunRequest;
  events: AiRunEvents;
  signal: AbortSignal;
  /** Tokens as the engine would send them: the accumulated text so far. */
  token(text: string): void;
  resolve(text: string, over?: Partial<AiRunOutcome>): void;
  reject(err: unknown): void;
}

interface Harness {
  ctl: GhostController;
  calls: Call[];
  run: ReturnType<typeof vi.fn>;
  options: AiGhostTextOptions;
  suggestions: Array<string | null>;
  busy: boolean[];
  errors: GhostErrorInfo[];
  recorded: AiActivityEntry[];
  served: Array<[unknown, boolean]>;
  read: ReturnType<typeof vi.fn>;
  input(over?: Partial<GhostChangeInput>): GhostChangeInput;
  last(): Call;
  shown(): string | null;
}

function harness(opts: Partial<AiGhostTextOptions> = {}, depsOver: Partial<GhostControllerDeps> = {}): Harness {
  const options: AiGhostTextOptions = { delayMs: 400, maxTokens: 48, trigger: 'auto', localOnly: true, ...opts };
  const calls: Call[] = [];
  const suggestions: Array<string | null> = [];
  const busy: boolean[] = [];
  const errors: GhostErrorInfo[] = [];
  const recorded: AiActivityEntry[] = [];
  const served: Array<[unknown, boolean]> = [];
  const read = vi.fn(() => ({ markdown: BEFORE, caretOffset: BEFORE.length }));

  const run = vi.fn((req: AiRunRequest, events: AiRunEvents, signal: AbortSignal) =>
    new Promise<AiRunOutcome>((resolve, reject) => {
      const call: Call = {
        req,
        events,
        signal,
        token: (text) => events.onToken?.(text.slice(-1), text),
        resolve: (text, over = {}) =>
          resolve({
            result: { text, served: { engineId: 'omlx', engineName: 'oMLX', modelId: 'small', isLocal: true } },
            route: ROUTE,
            viaFallback: false,
            thinking: null,
            requestId: 'req-1',
            ...over,
          }),
        reject,
      };
      signal.addEventListener('abort', () => reject(makeAiError('cancelled')));
      events.onRoute?.(ROUTE, null);
      calls.push(call);
    }),
  );

  const deps: GhostControllerDeps = {
    run,
    options: () => options,
    contextTokens: () => 8192,
    onSuggestion: (t) => suggestions.push(t),
    onBusy: (b) => busy.push(b),
    onError: (e) => errors.push(e),
    onServed: (s, v) => served.push([s, v]),
    record: (e) => recorded.push(e),
    ...depsOver,
  };
  const ctl = createGhostController(deps);
  return {
    ctl,
    calls,
    run,
    options,
    suggestions,
    busy,
    errors,
    recorded,
    served,
    read,
    input: (over = {}) => ({ read, atBlockEnd: true, eligible: true, blockKind: 'paragraph', ...over }),
    last: () => calls[calls.length - 1],
    shown: () => (suggestions.length > 0 ? suggestions[suggestions.length - 1] : null),
  };
}

/** Let promise reactions run (the fake `run`'s resolve and reject). */
const flush = async (): Promise<void> => {
  await vi.advanceTimersByTimeAsync(0);
};

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

// ── Timing ──────────────────────────────────────────────────────────────────

describe('the idle trigger', () => {
  it('fires once, 400 ms after a text change', async () => {
    const h = harness();
    h.ctl.noteChange(h.input());
    await vi.advanceTimersByTimeAsync(399);
    expect(h.run).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(h.run).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(h.run).toHaveBeenCalledTimes(1);
  });

  it('uses the delay from the options as they are now', async () => {
    const h = harness({ delayMs: 1000 });
    h.ctl.noteChange(h.input());
    await vi.advanceTimersByTimeAsync(999);
    expect(h.run).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(h.run).toHaveBeenCalledTimes(1);
  });

  it('a keystroke restarts the timer and aborts the request in flight', async () => {
    const h = harness();
    h.ctl.noteChange(h.input());
    await vi.advanceTimersByTimeAsync(300);
    h.ctl.noteChange(h.input());
    await vi.advanceTimersByTimeAsync(300);
    expect(h.run).not.toHaveBeenCalled(); // 600 ms since the first, 300 since the second
    await vi.advanceTimersByTimeAsync(100);
    expect(h.run).toHaveBeenCalledTimes(1);

    const first = h.last();
    first.token(' village');
    expect(h.shown()).toBe(' village');
    h.ctl.noteChange(h.input());
    expect(first.signal.aborted).toBe(true);
    expect(h.shown()).toBeNull();
    expect(h.busy).toEqual([true, false]);

    await vi.advanceTimersByTimeAsync(400);
    expect(h.run).toHaveBeenCalledTimes(2);
    expect(h.calls[1].signal.aborted).toBe(false);
  });

  it('reads the document only when a request fires, never per keystroke', async () => {
    const h = harness();
    for (let i = 0; i < 6; i++) {
      h.ctl.noteChange(h.input());
      await vi.advanceTimersByTimeAsync(100);
    }
    expect(h.read).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(400);
    expect(h.read).toHaveBeenCalledTimes(1);
    expect(h.run).toHaveBeenCalledTimes(1);
  });

  it('an ineligible change aborts and clears and starts no timer', async () => {
    const h = harness();
    h.ctl.noteChange(h.input());
    await vi.advanceTimersByTimeAsync(400);
    h.last().token(' village');
    h.ctl.noteChange(h.input({ eligible: false }));
    expect(h.last().signal.aborted).toBe(true);
    expect(h.shown()).toBeNull();
    await vi.advanceTimersByTimeAsync(10_000);
    expect(h.run).toHaveBeenCalledTimes(1);
  });

  it('an empty document has nothing to continue and sends nothing', async () => {
    const h = harness();
    h.read.mockReturnValue({ markdown: '', caretOffset: 0 });
    h.ctl.noteChange(h.input());
    await vi.advanceTimersByTimeAsync(400);
    expect(h.read).toHaveBeenCalledTimes(1);
    expect(h.run).not.toHaveBeenCalled();
  });

  it('a read that throws is swallowed', async () => {
    const h = harness();
    h.read.mockImplementation(() => {
      throw new Error('editor gone');
    });
    h.ctl.noteChange(h.input());
    await vi.advanceTimersByTimeAsync(400);
    expect(h.run).not.toHaveBeenCalled();
  });
});

describe('selection moves', () => {
  it('abort and clear and start no timer', async () => {
    const h = harness();
    h.ctl.noteChange(h.input());
    await vi.advanceTimersByTimeAsync(400);
    h.last().token(' village');
    expect(h.shown()).toBe(' village');
    h.ctl.noteSelectionMove();
    expect(h.last().signal.aborted).toBe(true);
    expect(h.shown()).toBeNull();
    await vi.advanceTimersByTimeAsync(10_000);
    expect(h.run).toHaveBeenCalledTimes(1);
  });

  it('cancel a pending timer', async () => {
    const h = harness();
    h.ctl.noteChange(h.input());
    await vi.advanceTimersByTimeAsync(200);
    h.ctl.noteSelectionMove();
    await vi.advanceTimersByTimeAsync(10_000);
    expect(h.run).not.toHaveBeenCalled();
  });
});

describe('manual mode', () => {
  it('never auto-fires', async () => {
    const h = harness({ trigger: 'manual' });
    h.ctl.noteChange(h.input());
    await vi.advanceTimersByTimeAsync(60_000);
    expect(h.run).not.toHaveBeenCalled();
  });

  it('triggerNow fires at once, from the latest change or a fresh snapshot', async () => {
    const h = harness({ trigger: 'manual' });
    h.ctl.noteChange(h.input());
    h.ctl.triggerNow();
    expect(h.run).toHaveBeenCalledTimes(1);

    const fresh = vi.fn(() => ({ markdown: 'Fresh text', caretOffset: 10 }));
    h.ctl.triggerNow(h.input({ read: fresh }));
    expect(fresh).toHaveBeenCalledTimes(1);
    expect(h.run).toHaveBeenCalledTimes(2);
    expect(h.calls[0].signal.aborted).toBe(true);
  });

  it('triggerNow works in auto mode too, and does nothing when ineligible or before any change', () => {
    const h = harness();
    h.ctl.triggerNow();
    expect(h.run).not.toHaveBeenCalled();
    h.ctl.triggerNow(h.input({ eligible: false }));
    expect(h.run).not.toHaveBeenCalled();
    h.ctl.triggerNow(h.input());
    expect(h.run).toHaveBeenCalledTimes(1);
  });
});

// ── The request ─────────────────────────────────────────────────────────────

describe('the request', () => {
  it('is a local-only ghostText continue with the budget from the options and no activity of its own', async () => {
    const h = harness({ maxTokens: 96, localOnly: true });
    h.ctl.noteChange(h.input({ blockKind: 'listItem' }));
    await vi.advanceTimersByTimeAsync(400);
    const { req } = h.last();
    expect(req).toMatchObject({ feature: 'ghostText', task: 'continue', sends: 'selection', maxTokens: 96, thinking: 'off', job: 'ghostText', localOnly: true });
    expect(req.messages.map((m) => m.role)).toEqual(['system', 'user']);
    const user = req.messages[1].content as string;
    expect(user).toContain(BEFORE);
    expect(user).toContain('list item');
    // The recorder is the controller's business (D10), never the run's.
    expect('activity' in req).toBe(false);
  });

  it('passes localOnly: false through', async () => {
    const h = harness({ localOnly: false });
    h.ctl.noteChange(h.input());
    await vi.advanceTimersByTimeAsync(400);
    expect(h.last().req.localOnly).toBe(false);
  });
});

// ── Streaming ───────────────────────────────────────────────────────────────

describe('streaming', () => {
  async function started(h: Harness): Promise<Call> {
    h.ctl.noteChange(h.input());
    await vi.advanceTimersByTimeAsync(400);
    return h.last();
  }

  it('shows the trimmed text so far and pulses busy while streaming', async () => {
    const h = harness();
    const call = await started(h);
    expect(h.busy).toEqual([true]);
    call.token(' vill');
    call.token(' village, and');
    expect(h.suggestions).toEqual([' vill', ' village, and']);
    call.resolve(' village, and the lamps.');
    await flush();
    expect(h.shown()).toBe(' village, and the lamps.');
    expect(h.busy).toEqual([true, false]);
    expect(h.errors).toEqual([]);
  });

  it('a stop rule aborts the stream so the model stops generating', async () => {
    const h = harness();
    const call = await started(h);
    call.token(' village.');
    expect(call.signal.aborted).toBe(false);
    call.token(' village.\n\nA new para');
    expect(h.shown()).toBe(' village.');
    expect(call.signal.aborted).toBe(true);
    expect(h.busy).toEqual([true, false]);
    // Whatever the engine still sends is ignored.
    call.token(' village.\n\nA new paragraph about other things');
    await flush();
    expect(h.shown()).toBe(' village.');
    expect(h.errors).toEqual([]);
  });

  it('a mid-block caret stops at the first newline', async () => {
    const h = harness();
    h.ctl.noteChange(h.input({ atBlockEnd: false }));
    await vi.advanceTimersByTimeAsync(400);
    const call = h.last();
    call.token(' village\nsecond line');
    expect(h.shown()).toBe(' village');
    expect(call.signal.aborted).toBe(true);
  });

  it('a suggestion that repeats the text before the caret is discarded and stops the stream', async () => {
    const h = harness();
    h.read.mockReturnValue({ markdown: 'The quick brown fox jumps over', caretOffset: 30 });
    const call = await started(h);
    call.token('brown fox jumps over the lazy');
    expect(h.shown()).toBeNull();
    expect(call.signal.aborted).toBe(true);
  });

  it('a reply from a request that was already replaced is ignored', async () => {
    const h = harness();
    const old = await started(h);
    h.ctl.noteChange(h.input());
    await vi.advanceTimersByTimeAsync(400);
    old.resolve('stale text');
    await flush();
    expect(h.shown()).toBeNull();
    expect(h.calls).toHaveLength(2);
    h.calls[1].resolve(' fresh');
    await flush();
    expect(h.shown()).toBe(' fresh');
  });
});

// ── Accept, dismiss, type through ───────────────────────────────────────────

describe('accept and dismiss', () => {
  async function showing(h: Harness, text = ' village.'): Promise<Call> {
    h.ctl.noteChange(h.input());
    await vi.advanceTimersByTimeAsync(400);
    const call = h.last();
    call.token(text);
    return call;
  }

  it('accept returns the text, clears it and records exactly one activity entry', async () => {
    const h = harness();
    const call = await showing(h, ' village.\n\nA second paragraph');
    expect(h.shown()).toBe(' village.');
    expect(h.ctl.accept()).toBe(' village.');
    expect(h.shown()).toBeNull();
    expect(h.recorded).toHaveLength(1);
    expect(call.signal.aborted).toBe(true);

    const entry = h.recorded[0];
    expect(entry).toMatchObject({ feature: 'ghostText', job: 'ghostText', task: 'continue', error: null, attempt: 1 });
    expect(entry.route).toMatchObject({ engineId: 'omlx', modelId: 'small', isLocal: true, viaFallback: false });
    expect(entry.request.messages).toBe(call.req.messages);
    // The panel lists the accepted text: the trimmed suggestion, not the raw stream.
    expect(entry.response.text).toBe(' village.');
    expect(h.ctl.accept()).toBeNull();
    expect(h.recorded).toHaveLength(1);
  });

  it('accept tells the footer chip what served it', async () => {
    const h = harness();
    await showing(h);
    h.ctl.accept();
    expect(h.served).toHaveLength(1);
    expect(h.served[0][0]).toMatchObject({ engineId: 'omlx', modelId: 'small', isLocal: true });
    expect(h.served[0][1]).toBe(false);
  });

  it('records the engine that finished a completed request', async () => {
    const h = harness();
    const call = await showing(h, ' village, and');
    call.resolve(' village, and the lamps.', { requestId: 'real-id' });
    await flush();
    h.ctl.accept();
    expect(h.recorded[0].id).toBe('real-id');
    expect(h.recorded[0].request.requestId).toBe('real-id');
    expect(h.recorded[0].response.text).toBe(' village, and the lamps.');
    expect(h.recorded[0].response.served).toMatchObject({ engineName: 'oMLX' });
  });

  it('dismiss clears, aborts and records nothing', async () => {
    const h = harness();
    const call = await showing(h);
    h.ctl.dismiss();
    expect(h.shown()).toBeNull();
    expect(call.signal.aborted).toBe(true);
    expect(h.ctl.accept()).toBeNull();
    expect(h.recorded).toEqual([]);
    expect(h.served).toEqual([]);
  });

  it('a suggestion replaced by typing elsewhere is never recorded', async () => {
    const h = harness();
    await showing(h);
    h.ctl.noteChange(h.input());
    await vi.advanceTimersByTimeAsync(400);
    h.last().resolve(' other');
    await flush();
    h.ctl.dismiss();
    expect(h.recorded).toEqual([]);
  });

  it('acceptWord leaves the rest showing and records only once', async () => {
    const h = harness();
    const call = await showing(h, ' hello big world');
    expect(h.ctl.acceptWord()).toBe(' hello ');
    expect(h.shown()).toBe('big world');
    expect(call.signal.aborted).toBe(true);
    expect(h.recorded).toHaveLength(1);
    expect(h.served).toHaveLength(1);

    expect(h.ctl.acceptWord()).toBe('big ');
    expect(h.shown()).toBe('world');
    expect(h.ctl.accept()).toBe('world');
    expect(h.recorded).toHaveLength(1);
    expect(h.served).toHaveLength(1);
    // The entry shows what was on screen when the first word was taken.
    expect(h.recorded[0].response.text).toBe(' hello big world');
  });

  it('acceptWord on the last word takes all of it', async () => {
    const h = harness();
    await showing(h, ' end');
    expect(h.ctl.acceptWord()).toBe(' end');
    expect(h.shown()).toBeNull();
  });

  it('accept and acceptWord with nothing showing return null', () => {
    const h = harness();
    expect(h.ctl.accept()).toBeNull();
    expect(h.ctl.acceptWord()).toBeNull();
  });
});

describe('typing through', () => {
  async function showing(h: Harness, text: string): Promise<Call> {
    h.ctl.noteChange(h.input());
    await vi.advanceTimersByTimeAsync(400);
    const call = h.last();
    call.token(text);
    return call;
  }

  it('a matching character keeps the rest and aborts the stream', async () => {
    const h = harness();
    const call = await showing(h, ' village');
    expect(h.ctl.typed(' ')).toBe(true);
    expect(h.shown()).toBe('village');
    expect(call.signal.aborted).toBe(true);
    // Later tokens from the aborted stream do not bring the old text back.
    call.token(' village, and more');
    expect(h.shown()).toBe('village');
    expect(h.ctl.typed('v')).toBe(true);
    expect(h.shown()).toBe('illage');
  });

  it('typing the whole suggestion clears it', async () => {
    const h = harness();
    await showing(h, ' ab');
    expect(h.ctl.typed(' a')).toBe(true);
    expect(h.ctl.typed('b')).toBe(true);
    expect(h.shown()).toBeNull();
    expect(h.ctl.typed('c')).toBe(false);
  });

  it('a mismatch returns false and changes nothing (the caller then reports a text change)', async () => {
    const h = harness();
    const call = await showing(h, ' village');
    const before = h.suggestions.length;
    expect(h.ctl.typed('x')).toBe(false);
    expect(h.ctl.typed('')).toBe(false);
    expect(h.shown()).toBe(' village');
    expect(h.suggestions).toHaveLength(before);
    expect(call.signal.aborted).toBe(false);
  });

  it('with nothing showing it is false', () => {
    expect(harness().ctl.typed('a')).toBe(false);
  });
});

// ── Errors ──────────────────────────────────────────────────────────────────

describe('errors that back off', () => {
  async function failOnce(h: Harness, err: AiError = makeAiError('unreachable')): Promise<void> {
    h.ctl.noteChange(h.input());
    await vi.advanceTimersByTimeAsync(h.options.delayMs);
    h.last().reject(err);
    await flush();
  }

  it('double the delay up to 5 s, and a success resets it', async () => {
    const h = harness();
    await failOnce(h);
    expect(h.errors).toHaveLength(1);
    expect(h.errors[0]).toMatchObject({ reason: 'unreachable', silent: false });

    // Next delay: 800 ms.
    h.ctl.noteChange(h.input());
    await vi.advanceTimersByTimeAsync(799);
    expect(h.run).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(h.run).toHaveBeenCalledTimes(2);
    h.last().reject(makeAiError('unreachable'));
    await flush();

    // Then 1600.
    h.ctl.noteChange(h.input());
    await vi.advanceTimersByTimeAsync(1599);
    expect(h.run).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(1);
    expect(h.run).toHaveBeenCalledTimes(3);
    h.last().reject(makeAiError('unreachable'));
    await flush();

    // 3200, then capped.
    h.ctl.noteChange(h.input());
    await vi.advanceTimersByTimeAsync(3200);
    expect(h.run).toHaveBeenCalledTimes(4);
    h.last().reject(makeAiError('unreachable'));
    await flush();
    expect(GHOST_BACKOFF_MAX_MS).toBe(5000);
    h.ctl.noteChange(h.input());
    await vi.advanceTimersByTimeAsync(4999);
    expect(h.run).toHaveBeenCalledTimes(4);
    await vi.advanceTimersByTimeAsync(1);
    expect(h.run).toHaveBeenCalledTimes(5);

    // A good answer puts the delay back to 400.
    h.last().resolve(' fine');
    await flush();
    h.ctl.noteChange(h.input());
    await vi.advanceTimersByTimeAsync(400);
    expect(h.run).toHaveBeenCalledTimes(6);
  });

  it('records a failed request (one entry with the error), and shows no suggestion', async () => {
    const h = harness();
    await failOnce(h, makeAiError('unreachable', 'oMLX did not answer.'));
    expect(h.shown()).toBeNull();
    expect(h.recorded).toHaveLength(1);
    expect(h.recorded[0]).toMatchObject({ feature: 'ghostText', error: { code: 'unreachable', message: 'oMLX did not answer.' } });
    expect(h.busy).toEqual([true, false]);
  });

  it('every failure is reported, not just the first', async () => {
    const h = harness();
    await failOnce(h);
    h.ctl.noteChange(h.input());
    await vi.advanceTimersByTimeAsync(800);
    h.last().reject(makeAiError('unreachable'));
    await flush();
    expect(h.errors).toHaveLength(2);
  });

  it('a plain Error becomes unknown', async () => {
    const h = harness();
    await failOnce(h, new Error('socket hang up') as unknown as AiError);
    expect(h.errors[0]).toMatchObject({ reason: 'unknown', silent: false });
    expect(h.errors[0].error.message).toBe('socket hang up');
  });

  it('a run that throws synchronously is handled the same way', async () => {
    const h = harness({}, {
      run: () => {
        throw makeAiError('unreachable');
      },
    });
    h.ctl.noteChange(h.input());
    await vi.advanceTimersByTimeAsync(400);
    expect(h.errors[0]).toMatchObject({ reason: 'unreachable', silent: false });
    expect(h.busy).toEqual([true, false]);
  });

  it('a cancel is neither reported nor recorded', async () => {
    const h = harness();
    h.ctl.noteChange(h.input());
    await vi.advanceTimersByTimeAsync(400);
    h.last().reject(makeAiError('cancelled'));
    await flush();
    expect(h.errors).toEqual([]);
    expect(h.recorded).toEqual([]);
  });
});

describe('silent errors', () => {
  async function failWith(h: Harness, err: AiError): Promise<void> {
    h.ctl.noteChange(h.input());
    await vi.advanceTimersByTimeAsync(400);
    h.last().reject(err);
    await flush();
  }

  it('cloudBlocked, capability and featureDisabled are reported once per session, with no backoff and no activity entry', async () => {
    for (const reason of ['cloudBlocked', 'capability', 'featureDisabled'] as const) {
      const h = harness();
      const err = reason === 'cloudBlocked' ? makeAiError('cloudBlocked', 'Inline suggestions use local engines only.') : makeAiError('unknown', reason === 'capability' ? 'Foo lacks chat.' : 'Inline suggestions is turned off.');
      await failWith(h, err);
      await failWith(h, err);
      expect(h.errors, reason).toHaveLength(1);
      expect(h.errors[0]).toMatchObject({ reason, silent: true });
      expect(h.shown()).toBeNull();
      expect(h.recorded).toEqual([]);
      // No backoff: the next request still waits only 400 ms.
      h.ctl.noteChange(h.input());
      await vi.advanceTimersByTimeAsync(400);
      expect(h.run, reason).toHaveBeenCalledTimes(3);
    }
  });

  it('a silent reason is reported again after a request succeeds', async () => {
    const h = harness();
    const err = makeAiError('cloudBlocked');
    await failWith(h, err);
    h.ctl.noteChange(h.input());
    await vi.advanceTimersByTimeAsync(400);
    h.last().resolve(' ok');
    await flush();
    await failWith(h, err);
    expect(h.errors).toHaveLength(2);
  });

  it('a refused consent silences the controller for the rest of the session', async () => {
    const h = harness();
    await failWith(h, makeAiError('consentDenied', 'Anthropic was not allowed in this workspace.'));
    expect(h.errors).toEqual([{ reason: 'consentDenied', silent: true, error: expect.objectContaining({ code: 'consentDenied' }) }]);
    expect(h.recorded).toEqual([]);

    h.ctl.noteChange(h.input());
    await vi.advanceTimersByTimeAsync(60_000);
    expect(h.run).toHaveBeenCalledTimes(1);
    h.ctl.triggerNow(h.input());
    expect(h.run).toHaveBeenCalledTimes(1);
  });
});

// ── Real router messages ────────────────────────────────────────────────────

describe('classifyGhostError against the real router', () => {
  const CAPS: AiModelCapabilities = { chat: true, stream: true, vision: false, json: false, tools: false, fim: false, embed: false, contextTokens: 8192 };
  const model = (id: string, caps: Partial<AiModelCapabilities> = {}, extra: Record<string, unknown> = {}) => ({ id, enabled: true, capabilities: { ...CAPS, ...caps }, capabilitiesSource: 'user', ...extra });
  const settings = (over: Record<string, unknown> = {}, ghost: Record<string, unknown> = { enabled: true }): AiSettings =>
    parseAiSettings(
      {
        enabled: true,
        engines: [
          { id: 'a', name: 'oMLX', kind: 'openai-compatible', baseUrl: 'http://127.0.0.1:8000/v1', models: [model('m'), model('embedder', { chat: false, fim: false })] },
          { id: 'cloud', name: 'Anthropic', kind: 'anthropic', baseUrl: 'https://api.anthropic.com', models: [model('claude')] },
        ],
        routing: { default: { engineId: 'a', modelId: 'm' }, fallback: 'none', tasks: {} },
        features: { ghostText: ghost },
        ...over,
      },
      { onWarning: () => {} },
    );

  /** The error the editor's run would throw for these settings. */
  function errorFor(s: AiSettings, consent: Record<string, boolean> = {}, localOnly = true): AiError {
    const r = resolveRoute(s, [], consent, { feature: 'ghostText', localOnly });
    if (isRouteUsable(r)) {throw new Error('expected an unusable route');}
    return routeUnusableError(r);
  }

  it('the feature turned off is featureDisabled (silent)', () => {
    const e = errorFor(settings({}, { enabled: false }));
    expect(classifyGhostError(e)).toBe('featureDisabled');
  });

  it('the master switch off is featureDisabled (silent)', () => {
    expect(classifyGhostError(errorFor(settings({ enabled: false })))).toBe('featureDisabled');
  });

  it('no route chosen is featureDisabled (silent)', () => {
    expect(classifyGhostError(errorFor(settings({ routing: { default: null, fallback: 'none', tasks: {} } })))).toBe('featureDisabled');
  });

  it('an engine or model turned off is featureDisabled (silent)', () => {
    const s = settings();
    s.engines[0].enabled = false;
    expect(classifyGhostError(errorFor(s))).toBe('featureDisabled');
  });

  it('a model with neither fim nor chat is capability (silent)', () => {
    const s = settings({ routing: { default: { engineId: 'a', modelId: 'embedder' }, fallback: 'none', tasks: {} } });
    const e = errorFor(s);
    expect(e.message).toMatch(/lacks/);
    expect(classifyGhostError(e)).toBe('capability');
  });

  it('a cloud route under localOnly is cloudBlocked (silent)', () => {
    const s = settings({ allowCloud: true, routing: { default: { engineId: 'cloud', modelId: 'claude' }, fallback: 'none', tasks: {} } });
    expect(classifyGhostError(errorFor(s))).toBe('cloudBlocked');
  });

  it('a refused cloud consent is consentDenied (silent)', () => {
    const s = settings({ allowCloud: true, routing: { default: { engineId: 'cloud', modelId: 'claude' }, fallback: 'none', tasks: {} } }, { enabled: true, localOnly: false });
    expect(classifyGhostError(errorFor(s, { cloud: false }, false))).toBe('consentDenied');
  });

  it('a failed probe is a real error (unreachable), not silent', () => {
    const r = resolveRoute(settings(), [{ engineId: 'a', ok: false, isLocal: true, hasKey: false, models: [], error: 'ECONNREFUSED' }], {}, { feature: 'ghostText', localOnly: true });
    if (isRouteUsable(r)) {throw new Error('expected an unusable route');}
    expect(classifyGhostError(routeUnusableError(r))).toBe('unreachable');
  });

  it('driven through the controller: the router sentences stay silent and do not back off', async () => {
    const cases: Array<[string, AiError]> = [
      ['featureDisabled', errorFor(settings({}, { enabled: false }))],
      ['capability', errorFor(settings({ routing: { default: { engineId: 'a', modelId: 'embedder' }, fallback: 'none', tasks: {} } }))],
    ];
    for (const [reason, err] of cases) {
      const h = harness();
      h.ctl.noteChange(h.input());
      await vi.advanceTimersByTimeAsync(400);
      h.last().reject(err);
      await flush();
      expect(h.errors, reason).toEqual([{ reason, silent: true, error: err }]);
      expect(h.recorded, reason).toEqual([]);
      h.ctl.noteChange(h.input());
      await vi.advanceTimersByTimeAsync(400);
      expect(h.run, reason).toHaveBeenCalledTimes(2);
    }
  });

  it('an error the router never sends stays unknown', () => {
    expect(classifyGhostError(makeAiError('unknown', 'Something odd happened.'))).toBe('unknown');
    expect(classifyGhostError(makeAiError('auth'))).toBe('auth');
  });
});

// ── Lifecycle ───────────────────────────────────────────────────────────────

describe('destroy', () => {
  it('cancels the timer and the request and goes quiet', async () => {
    const h = harness();
    h.ctl.noteChange(h.input());
    await vi.advanceTimersByTimeAsync(400);
    const call = h.last();
    call.token(' village');
    const shown = h.suggestions.length;
    h.ctl.destroy();
    expect(call.signal.aborted).toBe(true);
    h.ctl.noteChange(h.input());
    h.ctl.triggerNow(h.input());
    await vi.advanceTimersByTimeAsync(10_000);
    expect(h.run).toHaveBeenCalledTimes(1);
    expect(h.suggestions).toHaveLength(shown);
    expect(h.ctl.accept()).toBeNull();
  });
});

describe('timer seams', () => {
  it('use the injected timer instead of setTimeout', () => {
    const set = vi.fn(() => 'handle');
    const clear = vi.fn();
    const h = harness({}, { setTimer: set, clearTimer: clear });
    h.ctl.noteChange(h.input());
    expect(set).toHaveBeenCalledWith(expect.any(Function), 400);
    h.ctl.noteChange(h.input());
    expect(clear).toHaveBeenCalledWith('handle');
    expect(h.run).not.toHaveBeenCalled();
  });
});
