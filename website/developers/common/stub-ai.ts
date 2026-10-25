// A STUB `ai` host for the demos on these pages. It talks to no server and no
// model: `complete` streams a fixed piece of text, so the AI tab in Settings
// and the rewrite popover can be tried here without any setup. A real app
// supplies its own `complete` (see "Bring your own AI" on the developers page).
import type { MikeDownAiHost, MikeDownSettings } from '@mikedown/core';
import { parseAiSettings } from '@mikedown/core/ai';

const ENGINE_ID = 'demo-stub';
const MODEL_ID = 'canned-text';
const ENGINE_NAME = 'Demo stub (canned text, no server)';

/** What the stub streams back for every request. */
export const STUB_TEXT =
  'This is canned text from the demo stub. No model ran and nothing left your browser. ' +
  'In your own app, complete() calls a real model and this is where its answer would stream in.';

const capabilities = { chat: true, stream: true, vision: false, json: false, tools: false, fim: false, embed: false, contextTokens: 8192 };

/** Settings that tell the editor the stub engine exists and is the default. Pass as `settings.ai`. */
export const stubAiSettings = parseAiSettings({
  enabled: true,
  engines: [
    {
      id: ENGINE_ID,
      name: ENGINE_NAME,
      kind: 'openai-compatible',
      baseUrl: 'http://localhost/stub/v1',
      models: [{ id: MODEL_ID, label: 'Canned text (stub)', capabilities, capabilitiesSource: 'user' }],
    },
  ],
  routing: { default: { engineId: ENGINE_ID, modelId: MODEL_ID }, fallback: 'none', tasks: {} },
}) as NonNullable<MikeDownSettings['ai']>;

const status = () => ({
  engineId: ENGINE_ID,
  ok: true as const,
  isLocal: true,
  hasKey: false,
  latencyMs: 1,
  models: [{ id: MODEL_ID, label: 'Canned text (stub)', capabilities, source: 'user' as const }],
});

const sleep = (ms: number, signal: AbortSignal) =>
  new Promise<void>((resolve) => {
    const timer = setTimeout(resolve, ms);
    signal.addEventListener('abort', () => { clearTimeout(timer); resolve(); }, { once: true });
  });

/** A tier 2 host (so the AI tab lists engines) whose only engine streams canned text. */
export const stubAiHost: MikeDownAiHost = {
  async complete(_req, onToken, signal) {
    let text = '';
    for (const word of STUB_TEXT.split(/(?<=\s)/)) {
      await sleep(30, signal);
      if (signal.aborted) {
        return { text, served: served(), finishReason: 'cancelled' };
      }
      text += word;
      onToken(word);
    }
    return { text, served: served(), finishReason: 'stop' };
  },
  async listEngines() {
    return [status()];
  },
  async testEngine() {
    return status();
  },
  async discoverModels() {
    return status();
  },
  async setSecret() {
    // The stub has no key to keep.
  },
};

function served() {
  return { engineId: ENGINE_ID, engineName: ENGINE_NAME, modelId: MODEL_ID, isLocal: true };
}
