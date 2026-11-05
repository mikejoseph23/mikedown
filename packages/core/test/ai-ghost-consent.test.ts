/**
 * Inline suggestions against the real `runAiCompletion` and a fake host that
 * behaves as both real hosts do: a dialog is open until answered, a "Don't
 * allow" is remembered and returned without asking, an answer stored for the
 * workspace too. What matters is that a pause asks once.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { makeAiError, parseAiSettings } from '../src/ai';
import type { AiConsentReply, AiError, AiGhostTextOptions, AiSettings, MikeDownAiHost } from '../src/ai';
import { createGhostController } from '../src/ai-ghost';
import type { GhostChangeInput, GhostErrorInfo } from '../src/ai-ghost';
import { runAiCompletion } from '../src/ai-request';
import type { AiRunContext } from '../src/ai-request';

const CAPS = { chat: true, stream: true, vision: false, json: false, tools: false, fim: false, embed: false, contextTokens: 8192 };
const cloudModel = { id: 'claude', enabled: true, capabilities: CAPS, capabilitiesSource: 'user' };
const TEXT = 'It was a quiet evening in the';

function settings(engines: unknown[] = [{ id: 'cloud', name: 'Anthropic', kind: 'anthropic', baseUrl: 'https://api.anthropic.com', models: [cloudModel] }], fallback = 'none'): AiSettings {
  return parseAiSettings({
    enabled: true,
    allowCloud: true,
    engines,
    routing: { default: { engineId: 'cloud', modelId: 'claude' }, fallback, tasks: {} },
    features: { ghostText: { enabled: true, localOnly: false } },
  }, { onWarning: () => {} });
}

/** A host with one open dialog at a time, like the two real ones. */
function fakeHost() {
  let stored: AiConsentReply | undefined;
  let open: { promise: Promise<AiConsentReply>; answer(reply: AiConsentReply): void } | null = null;
  const dialogs = vi.fn();
  const complete = vi.fn(async (_req: unknown, onToken: (d: string) => void) => {
    onToken(' garden.');
    return { text: ' garden.', served: { engineId: 'cloud', engineName: 'Anthropic', modelId: 'claude', isLocal: false } };
  });
  const requestCloudConsent = vi.fn((): Promise<AiConsentReply> => {
    if (stored !== undefined) {return Promise.resolve(stored);}
    if (open) {return open.promise;}
    dialogs();
    let answer!: (reply: AiConsentReply) => void;
    const promise = new Promise<AiConsentReply>((resolve) => {
      answer = (reply) => {
        open = null;
        if (reply === true || reply === false) {stored = reply;}
        resolve(reply);
      };
    });
    open = { promise, answer };
    return promise;
  });
  const ai = { complete, listEngines: vi.fn(async () => []), requestCloudConsent } as unknown as MikeDownAiHost;
  return { ai, complete, requestCloudConsent, dialogs, answer: (reply: AiConsentReply) => open!.answer(reply) };
}

function setup(s: AiSettings = settings()) {
  const host = fakeHost();
  const ctx: AiRunContext = { ai: host.ai, settings: () => s, statuses: () => [], consent: {} };
  const errors: GhostErrorInfo[] = [];
  const options: AiGhostTextOptions = { delayMs: 400, maxTokens: 48, trigger: 'auto', localOnly: false };
  const ctl = createGhostController({
    run: (req, events, signal) => runAiCompletion(ctx, req, events, signal),
    options: () => options,
    contextTokens: () => 8192,
    onSuggestion: () => {},
    onError: (info) => errors.push(info),
  });
  const input = (): GhostChangeInput => ({ read: () => ({ markdown: TEXT, caretOffset: TEXT.length }), atBlockEnd: true, eligible: true });
  /** A pause: the text changed, then the idle delay passed. */
  const pause = async () => {
    ctl.noteChange(input());
    await vi.advanceTimersByTimeAsync(400);
  };
  return { ...host, ctx, ctl, errors, input, pause };
}

beforeEach(() => { vi.useFakeTimers(); });
afterEach(() => { vi.useRealTimers(); });

describe('runAiCompletion with a refused consent', () => {
  it('rejects with consentDenied when no other engine can serve it', async () => {
    const h = setup();
    const run = runAiCompletion(h.ctx, { feature: 'ghostText', task: 'continue', messages: [{ role: 'user', content: 'x' }] }, {}, new AbortController().signal);
    await vi.advanceTimersByTimeAsync(0);
    h.answer(false);
    await expect(run).rejects.toMatchObject({ code: 'consentDenied' } satisfies Partial<AiError>);
    expect(h.complete).not.toHaveBeenCalled();
  });

  it('asks with the ghost scope, which is what the dialog words come from', async () => {
    const h = setup();
    await h.pause();
    expect(h.requestCloudConsent).toHaveBeenCalledWith('cloud', { feature: 'ghostText', sends: 'cursor' });
  });

  it('an abort while the dialog is open sends nothing, whatever the answer', async () => {
    const h = setup();
    const ac = new AbortController();
    const run = runAiCompletion(h.ctx, { feature: 'ghostText', task: 'continue', messages: [{ role: 'user', content: 'x' }] }, {}, ac.signal);
    await vi.advanceTimersByTimeAsync(0);
    ac.abort();
    h.answer(true);
    await expect(run).rejects.toEqual(makeAiError('cancelled'));
    expect(h.complete).not.toHaveBeenCalled();
  });
});

describe('a pause asks once', () => {
  it('"Don\'t allow" silences ghost text: no more requests, no more dialogs', async () => {
    const h = setup();
    await h.pause();
    h.answer(false);
    await vi.advanceTimersByTimeAsync(0);
    expect(h.errors.map((e) => e.reason)).toEqual(['consentDenied']);

    await h.pause();
    await h.pause();
    expect(h.dialogs).toHaveBeenCalledTimes(1);
    expect(h.requestCloudConsent).toHaveBeenCalledTimes(1);
    expect(h.complete).not.toHaveBeenCalled();
  });

  it('typing while the dialog is open shares that dialog; the refusal then silences', async () => {
    const h = setup();
    await h.pause();
    // The editor's text changed behind the dialog: the first run is aborted, the next pause asks again.
    await h.pause();
    await h.pause();
    expect(h.dialogs).toHaveBeenCalledTimes(1);
    h.answer(false);
    await vi.advanceTimersByTimeAsync(0);
    expect(h.errors.map((e) => e.reason)).toEqual(['consentDenied']);

    await h.pause();
    expect(h.dialogs).toHaveBeenCalledTimes(1);
    expect(h.complete).not.toHaveBeenCalled();
  });

  it('a refusal answered after the only run was aborted still silences at the next pause, without a dialog', async () => {
    const h = setup();
    await h.pause();
    h.ctl.noteSelectionMove();
    h.answer(false);
    await vi.advanceTimersByTimeAsync(0);
    expect(h.errors).toEqual([]);

    await h.pause();
    expect(h.dialogs).toHaveBeenCalledTimes(1);
    expect(h.errors.map((e) => e.reason)).toEqual(['consentDenied']);
    const asked = h.requestCloudConsent.mock.calls.length;
    await h.pause();
    expect(h.requestCloudConsent).toHaveBeenCalledTimes(asked);
  });

  it('"Allow for this workspace" is one dialog, then suggestions flow', async () => {
    const h = setup();
    await h.pause();
    h.answer(true);
    await vi.advanceTimersByTimeAsync(0);
    expect(h.complete).toHaveBeenCalledTimes(1);

    await h.pause();
    await vi.advanceTimersByTimeAsync(0);
    expect(h.dialogs).toHaveBeenCalledTimes(1);
    expect(h.complete).toHaveBeenCalledTimes(2);
  });

  it('"Allow once" sends one request; later pauses neither send nor ask', async () => {
    const h = setup();
    await h.pause();
    h.answer('once');
    await vi.advanceTimersByTimeAsync(0);
    expect(h.complete).toHaveBeenCalledTimes(1);

    await h.pause();
    await h.pause();
    expect(h.dialogs).toHaveBeenCalledTimes(1);
    expect(h.complete).toHaveBeenCalledTimes(1);
  });

  it('the shortcut can still ask after "Allow once": the person asked for it', async () => {
    const h = setup();
    await h.pause();
    h.answer('once');
    await vi.advanceTimersByTimeAsync(0);
    h.ctl.triggerNow(h.input());
    await vi.advanceTimersByTimeAsync(0);
    expect(h.dialogs).toHaveBeenCalledTimes(2);
  });
});
