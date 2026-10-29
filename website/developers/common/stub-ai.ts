// A STUB `ai` host for the demos on these pages. It talks to no server and no
// model: `complete` streams a fixed piece of text, so the AI tab in Settings
// and the rewrite popover can be tried here without any setup. A real app
// supplies its own `complete` (see "Bring your own AI" on the developers page).
//
// There are two engines, so the AI tab and the AI Engines page have something
// to show: a local one that streams the canned text, and a cloud one (named
// after a provider, never called) whose "Fetch models" returns a list shaped
// like a real provider's. Pasting any key stores nothing and sends nothing.
import type { MikeDownAiHost, MikeDownSettings } from '@mikedown/core';
import { parseAiSettings } from '@mikedown/core/ai';

const ENGINE_ID = 'demo-stub';
const MODEL_ID = 'canned-text';
const ENGINE_NAME = 'Demo stub (canned text, no server)';
const CLOUD_ID = 'demo-cloud';

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
    // Fill in a key on the AI Engines page and the stub "fetches" a provider-shaped model list.
    { id: CLOUD_ID, name: 'Anthropic', kind: 'anthropic', baseUrl: 'https://api.anthropic.com', models: [] },
  ],
  routing: { default: { engineId: ENGINE_ID, modelId: MODEL_ID }, fallback: 'none', tasks: {} },
}) as NonNullable<MikeDownSettings['ai']>;

const status = (engineId = ENGINE_ID) => ({
  engineId,
  ok: true as const,
  isLocal: true,
  hasKey: false,
  latencyMs: 1,
  models: [{ id: MODEL_ID, label: 'Canned text (stub)', capabilities, source: 'user' as const }],
});

const cloudCapabilities = { ...capabilities, vision: true, json: true, tools: true, contextTokens: 200000 };

/** Ids shaped like each provider's list: current aliases first, dated snapshots after. No request is ever made with them. */
const CLOUD_MODEL_IDS: Record<string, string[]> = {
  anthropic: [
    'claude-sonnet-5-5', 'claude-opus-5-5', 'claude-haiku-5-5', 'claude-fable-5-1',
    'claude-sonnet-4-5-20250929', 'claude-opus-4-1-20250805', 'claude-haiku-4-5-20251001',
    'claude-sonnet-4-20250514', 'claude-opus-4-20250514', 'claude-3-7-sonnet-20250219',
    'claude-3-5-haiku-20241022', 'claude-3-haiku-20240307',
  ],
  openai: [
    'gpt-5.5', 'gpt-5.5-mini', 'gpt-5.5-nano', 'gpt-5', 'gpt-5-mini', 'gpt-4.1', 'gpt-4.1-mini',
    'gpt-4o', 'gpt-4o-mini', 'o4-mini', 'o3', 'o3-mini',
  ],
};

/** Engine ids are `<preset>` for the seeded one and `<preset>-<random>` for cards added on the page. */
function cloudFamily(engineId: string): string | undefined {
  if (engineId === CLOUD_ID) {return 'anthropic';}
  return Object.keys(CLOUD_MODEL_IDS).find((family) => engineId === family || engineId.startsWith(`${family}-`));
}

/** Which cloud engines the demo user "stored a key" for, and which it has "fetched". */
const keys = new Set<string>();
const fetched = new Set<string>();

function cloudStatus(engineId: string, family: string) {
  const listed = fetched.has(engineId);
  return {
    engineId,
    ok: listed ? (true as const) : null,
    isLocal: false,
    hasKey: keys.has(engineId),
    ...(listed ? { latencyMs: 1 } : {}),
    models: listed ? CLOUD_MODEL_IDS[family].map((id) => ({ id, capabilities: cloudCapabilities, source: 'endpoint' as const })) : [],
  };
}

function statusFor(engineId: string) {
  const family = cloudFamily(engineId);
  return family ? cloudStatus(engineId, family) : status(engineId);
}

const sleep = (ms: number, signal: AbortSignal) =>
  new Promise<void>((resolve) => {
    const timer = setTimeout(resolve, ms);
    signal.addEventListener('abort', () => { clearTimeout(timer); resolve(); }, { once: true });
  });

/**
 * A tier 2 host (so the AI tab lists engines) whose only engine streams canned
 * text. The request's `route`, `requestOverrides` (the thinking dial) and the
 * rest are ignored: the same text comes back whatever is asked.
 */
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
    return [status(), cloudStatus(CLOUD_ID, 'anthropic')];
  },
  async testEngine(engineId) {
    if (cloudFamily(engineId)) {fetched.add(engineId);}
    return statusFor(engineId);
  },
  async discoverModels(engineId) {
    if (cloudFamily(engineId)) {fetched.add(engineId);}
    return statusFor(engineId);
  },
  async setSecret(engineId, apiKey) {
    // Nothing is kept: only whether a key was "stored", so the field reads Stored.
    if (apiKey) {keys.add(engineId);} else {keys.delete(engineId);}
  },
};

function served() {
  return { engineId: ENGINE_ID, engineName: ENGINE_NAME, modelId: MODEL_ID, isLocal: true };
}
