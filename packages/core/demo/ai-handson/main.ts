// Throwaway T3 harness: the built core editor against the real oMLX server.
// Not committed. Serve from packages/core: OMLX_API_KEY=... npx vite . --port 5198 --config demo/ai-handson/vite.config.mjs
import { createMikeDownEditor } from '../../dist/index.js';
import type { MikeDownHost } from '../../dist/index.js';
import {
  parseAiSettings, buildCompletionBody, createCompletionStreamReader, detectCapabilities,
} from '../../dist/ai/index.js';
import doc from '../../../../test/workspace/ai-writing-handson.md?raw';

declare const __OMLX_KEY__: string;
const BASE = 'http://127.0.0.1:8000/v1';
const ENGINE_ID = 'omlx';
const ENGINE_NAME = 'oMLX';
const params = new URLSearchParams(location.search);

async function main() {
  const list = await (await fetch(`${BASE}/models`, { headers: { Authorization: `Bearer ${__OMLX_KEY__}` } })).json();
  const ids: string[] = list.data.map((m: { id: string }) => m.id);
  const modelId = params.get('model') ?? (ids.includes('Qwen3.8-Flash-Next-oQ5e-mtp') ? 'Qwen3.8-Flash-Next-oQ5e-mtp' : ids[0]);
  const detected = detectCapabilities(modelId, 'openai-compatible') as any;
  const capabilities = { chat: true, stream: true, vision: false, json: false, tools: false, fim: false, embed: false, contextTokens: 262144, ...(detected.capabilities ?? detected) };
  console.log('[harness] model', modelId, JSON.stringify(capabilities));

  const routedSettings = (enabled: boolean, routed: boolean) => parseAiSettings({
    enabled,
    engines: [{
      id: ENGINE_ID, name: ENGINE_NAME, kind: 'openai-compatible', baseUrl: BASE, enabled: true, locality: 'auto',
      models: [{ id: modelId, enabled: true, capabilities, capabilitiesSource: 'user' }],
    }],
    routing: routed ? { default: { engineId: ENGINE_ID, modelId }, fallback: 'none', tasks: {} } : { default: null, fallback: 'none', tasks: {} },
  });
  let aiSettings = routedSettings(true, true);
  const modelCfg = () => aiSettings.engines[0].models[0];

  const status = () => ({
    engineId: ENGINE_ID, ok: true as const, isLocal: true, hasKey: true, latencyMs: 5,
    models: [{ id: modelId, capabilities, source: 'user' as const }],
  });

  const ai = {
    async complete(req: any, onToken: (d: string) => void, signal: AbortSignal) {
      const body = buildCompletionBody('openai-compatible', modelCfg(), req);
      (window as any).__reqs = [...((window as any).__reqs ?? []), req];
      const { messages, ...rest } = body as any;
      console.log('[aiwire]', JSON.stringify({ feature: req.feature, task: req.task, ...rest }));
      const t0 = performance.now();
      const res = await fetch(`${BASE}/chat/completions`, {
        method: 'POST', signal,
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${__OMLX_KEY__}` },
        body: JSON.stringify(body),
      });
      const served = { engineId: ENGINE_ID, engineName: ENGINE_NAME, modelId, isLocal: true };
      if (!res.ok || !res.body) { throw new Error(`HTTP ${res.status}: ${await res.text()}`); }
      const reader = createCompletionStreamReader('openai-compatible');
      const dec = new TextDecoder();
      const r = res.body.getReader();
      let first = 0;
      try {
        for (;;) {
          const { done, value } = await r.read();
          if (done) { break; }
          for (const d of reader.push(dec.decode(value, { stream: true }))) {
            if (!first) { first = performance.now() - t0; }
            onToken(d);
          }
        }
      } catch (e) {
        if (signal.aborted) { return { text: '', served, finishReason: 'cancelled' as const }; }
        throw e;
      }
      const out = reader.finish();
      (window as any).__outs = [...((window as any).__outs ?? []), out.text];
      console.log('[ailatency]', JSON.stringify({ feature: req.feature, task: req.task, firstTokenMs: Math.round(first), totalMs: Math.round(performance.now() - t0), finish: out.finishReason, chars: out.text.length }));
      return { text: out.text, served, finishReason: out.finishReason, usage: out.usage };
    },
    async listEngines() { return [status()]; },
    async testEngine() { return status(); },
    async discoverModels() { return status(); },
    async setSecret() {},
  };

  const tags = [
    { tag: 'planning', count: 12 }, { tag: 'team', count: 9 }, { tag: 'engineering', count: 7 }, { tag: 'schedule', count: 4 },
  ];
  const host: MikeDownHost = {
    onChange() {},
    saveSettings(patch: any) {
      console.log('[harness] saveSettings', Object.keys(patch).join(','));
      if (patch.ai) { aiSettings = parseAiSettings({ ...aiSettings, ...patch.ai }); }
    },
    async getTags() { return tags; },
    openTag() {},
    ai,
  } as MikeDownHost;

  const handle = createMikeDownEditor(document.getElementById('editor')!, {
    host,
    initialMarkdown: doc,
    settings: { ai: aiSettings, tagsEnabled: true } as any,
    features: { sidebar: true },
  });
  handle.setTags(tags as any);
  handle.setSidebarState({ pref: 'always' });
  (window as any).mikedown = handle;
  (window as any).__original = doc;
  // Select the whole textblock containing `needle` (QA helper).
  (window as any).selPara = (needle: string) => {
    const ed = handle.tiptap; let r: { from: number; to: number } | null = null;
    ed.state.doc.descendants((n, pos) => { if (!r && n.isTextblock && n.textContent.includes(needle)) { r = { from: pos + 1, to: pos + 1 + n.content.size }; return false; } return true; });
    if (r) { ed.chain().focus().setTextSelection(r).run(); }
    return r;
  };

  const setAi = (enabled: boolean, routed: boolean, label: string) => {
    aiSettings = routedSettings(enabled, routed);
    handle.updateSettings({ ai: aiSettings } as any);
    document.getElementById('status')!.textContent = label;
  };
  document.getElementById('ai-off')!.addEventListener('click', () => setAi(false, true, 'AI off'));
  document.getElementById('ai-noroute')!.addEventListener('click', () => setAi(true, false, 'AI on, no route'));
  document.getElementById('ai-on')!.addEventListener('click', () => setAi(true, true, 'AI on, routed'));
  document.getElementById('status')!.textContent = `model ${modelId}`;
}

main().catch((e) => { console.error('[harness] failed', e); document.getElementById('status')!.textContent = String(e); });
