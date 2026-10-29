import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  AI_ENGINE_PRESETS,
  AI_LOCAL_ROUGH_GUESS,
  AI_LOCAL_SMALL_MACHINE,
  aiConsentHost,
  aiProviderPolicy,
  engineLocality,
  isLocalCapable,
  localDefaultModel,
  modelActiveParamsBillions,
  modelMoeHint,
  modelParamsBillions,
  modelSizeHint,
  recommendSetupPath,
  resolveRoute,
  thinkingChoices,
  vscodeLmAvailability,
  type AiHardwareInfo,
  type AiLocalModelChoice,
  type AiLocalServerProbe,
  type AiSettings,
} from '../src/ai';
import { defaultAiSettings } from '../src/ai/defaults';

const GB = 1024 ** 3;
const mac = (gb: number): AiHardwareInfo => ({ arch: 'arm64', platform: 'darwin', totalMemoryBytes: gb * GB, appleSilicon: true });
const pc = (gb: number, vramGb?: number): AiHardwareInfo => ({
  arch: 'x64',
  platform: 'win32',
  totalMemoryBytes: gb * GB,
  appleSilicon: false,
  ...(vramGb ? { gpu: { vendor: 'nvidia' as const, vramBytes: vramGb * GB, name: 'NVIDIA GeForce RTX' } } : {}),
});
const lmStudio: AiLocalServerProbe = { presetId: 'lmstudio', baseUrl: 'http://127.0.0.1:1234/v1', ok: true, models: 3 };

describe('recommendSetupPath', () => {
  it('checks a running server, then Copilot, then the hardware, then cloud', () => {
    const copilot = { available: true, models: 4 };
    expect(recommendSetupPath({ running: [lmStudio], hardware: mac(8), vscodeLm: copilot })).toMatchObject({ path: 'runningLocal', running: lmStudio });
    expect(recommendSetupPath({ running: [], hardware: mac(64), vscodeLm: copilot }).path).toBe('vscodeLm');
    const capable = recommendSetupPath({ running: [], hardware: mac(32) });
    expect(capable).toMatchObject({ path: 'cloud', localCapable: true });
    expect(capable.hardwareLine).toBe('Local is an option on this machine: Apple Silicon, 32 GB. Models up to about 30B parameters run well.');
    const small = recommendSetupPath({ running: [], hardware: pc(16) });
    expect(small).toMatchObject({ path: 'cloud', localCapable: false });
    expect(small.hardwareLine).toMatch(/small side/);
    expect(recommendSetupPath({ running: [], hardware: null })).toMatchObject({ path: 'cloud', localCapable: false, localHint: '', hardwareLine: '' });
  });

  it('skips a server that lists no models, and offers the one with the most', () => {
    const empty = { ...lmStudio, models: 0 };
    expect(recommendSetupPath({ running: [empty], hardware: null }).path).toBe('cloud');
    const ollama: AiLocalServerProbe = { presetId: 'ollama', baseUrl: 'http://127.0.0.1:11434/v1', ok: true, models: 9 };
    expect(recommendSetupPath({ running: [lmStudio, ollama], hardware: null }).running?.presetId).toBe('ollama');
  });

  it('applies the OQ11 threshold', () => {
    expect(isLocalCapable(mac(16))).toBe(true);
    expect(isLocalCapable(mac(8))).toBe(false);
    expect(isLocalCapable(pc(32))).toBe(true);
    expect(isLocalCapable({ ...pc(32), totalMemoryBytes: 31.3 * GB })).toBe(true);
    expect(isLocalCapable(pc(16))).toBe(false);
    expect(isLocalCapable(pc(16, 8))).toBe(true);
    expect(isLocalCapable(pc(16, 6))).toBe(false);
  });

  it('gives the model-size sentence per memory band, and says when the GPU was not checked', () => {
    expect(recommendSetupPath({ running: [], hardware: mac(16) }).localHint).toBe('Models up to about 8B parameters run well.');
    expect(recommendSetupPath({ running: [], hardware: mac(36) }).localHint).toBe('Models up to about 30B parameters run well.');
    expect(recommendSetupPath({ running: [], hardware: mac(128) }).localHint).toMatch(/^Larger models work/);
    expect(recommendSetupPath({ running: [], hardware: pc(64) }).hardwareLine).toMatch(/graphics card was not checked/);
    expect(recommendSetupPath({ running: [], hardware: pc(16, 24) }).hardwareLine).toContain('NVIDIA GeForce RTX (24 GB)');
  });
});

describe('modelSizeHint', () => {
  it('reads the parameter count from the id', () => {
    expect(modelParamsBillions('qwen3-30b-a3b')).toBe(30);
    expect(modelParamsBillions('llama3.1:8b')).toBe(8);
    expect(modelParamsBillions('mixtral-8x7b-instruct')).toBe(56);
    expect(modelParamsBillions('gemma-3-270m')).toBeCloseTo(0.27);
    expect(modelParamsBillions('mlx-community/Qwen3-4bit')).toBeNull();
    expect(modelParamsBillions('gpt-4o')).toBeNull();
  });

  it('tags fits, tight and too large, and nothing without a count or hardware', () => {
    const m32 = mac(32);
    expect(modelSizeHint('qwen2.5-7b-instruct', m32)).toBe('fits');
    expect(modelSizeHint('qwen3-30b-a3b', m32)).toBe('fits');
    expect(modelSizeHint('qwen3-32b', mac(16))).toBe('too large');
    expect(modelSizeHint('phi-4-14b', mac(16))).toBe('tight');
    expect(modelSizeHint('llama-3.3-70b', m32)).toBe('too large');
    expect(modelSizeHint('llama-3.3-70b', mac(64))).toBe('fits');
    expect(modelSizeHint('gpt-4o', m32)).toBeUndefined();
    expect(modelSizeHint('qwen2.5-7b', null)).toBeUndefined();
  });

  it('a size the server reported wins over the count in the id', () => {
    // 60% of 32 GB fits, up to 80% is tight, more is too large.
    expect(modelSizeHint('qwen2.5-7b', mac(32), 25 * GB)).toBe('tight');
    expect(modelSizeHint('gpt-4o', mac(32), 10 * GB)).toBe('fits');
    expect(modelSizeHint('llama-3.3-70b', mac(32), 30 * GB)).toBe('too large');
    expect(modelSizeHint('qwen2.5-7b', null, 1 * GB)).toBeUndefined();
  });
});

describe('localDefaultModel: a new local engine\'s default', () => {
  const m = (id: string, over: Partial<AiLocalModelChoice> = {}): AiLocalModelChoice => ({ id, chat: true, ...over });

  it('a loaded chat model wins, whatever its size', () => {
    expect(localDefaultModel([m('small'), m('huge-400b', { loaded: true })])).toBe('huge-400b');
  });

  it('skips a loaded model that cannot chat (oMLX\'s MarkItDown converter, an embedder) or is gone', () => {
    const models = [m('MarkItDown', { chat: false, loaded: true }), m('nomic-embed', { chat: false, loaded: true }), m('gone', { missing: true, loaded: true }), m('gemma')];
    expect(localDefaultModel(models)).toBeNull();
    expect(localDefaultModel([...models, m('qwen', { loaded: true })])).toBe('qwen');
  });

  it('nothing loaded: no default, not the first model nor a guess by size', () => {
    expect(localDefaultModel([m('glm-5.3'), m('qwen3.6-35b-a3b'), m('nemotron-nano-4b')])).toBeNull();
    expect(localDefaultModel([])).toBeNull();
  });
});

describe('mixture-of-experts hints', () => {
  it('reads the active parameters from the id, case-insensitive', () => {
    expect(modelActiveParamsBillions('Qwen3.6-35B-A3B-Q8_0')).toBe(3);
    expect(modelActiveParamsBillions('qwen3.5-122b-a10b')).toBe(10);
    expect(modelActiveParamsBillions('NVIDIA-Nemotron-3-Super-120B-A12B-Q4_K_M')).toBe(12);
    expect(modelActiveParamsBillions('qwen3-235b-a22b')).toBe(22);
    expect(modelActiveParamsBillions('google/gemma-4-26b-a4b-qat')).toBe(4);
    expect(modelActiveParamsBillions('qwen3-30b-a3.3b')).toBe(3.3);
  });

  it('ignores ids without them', () => {
    for (const id of ['Qwen3.8-27B-MLX-4bit', 'llama-3.3-70b', 'gemma-4-31B-it-Q8_0', 'DeepSeek-V4-Flash-0731-MXFP4-MLX', 'kimi-k2.5', 'whisper-large-v3-turbo', 'llama3.1:8b', 'qwen-a3', 'xa3b']) {
      expect(modelActiveParamsBillions(id)).toBeNull();
    }
  });

  it('flags a model by its id or by the server\'s word, never by size', () => {
    expect(modelMoeHint('Qwen3.6-35B-A3B')).toEqual({ activeBillions: 3 });
    expect(modelMoeHint('glm-5.3', true)).toEqual({ activeBillions: null });
    expect(modelMoeHint('Qwen3.8-27B-MLX-4bit')).toBeNull();
    expect(modelMoeHint('Qwen3.8-27B-MLX-4bit', false)).toBeNull();
  });
});


describe('preset links', () => {
  it('every cloud preset has an https pricing page and every local server an https install page', () => {
    for (const p of AI_ENGINE_PRESETS.filter((x) => x.family === 'cloud')) {expect(p.pricingUrl, p.id).toMatch(/^https:\/\//);}
    for (const p of AI_ENGINE_PRESETS.filter((x) => x.family === 'local' && x.id !== 'custom')) {expect(p.installUrl, p.id).toMatch(/^https:\/\//);}
  });
});

describe('vscode-lm engine kind', () => {
  const copilot = { id: 'c', name: 'GitHub Copilot', kind: 'vscode-lm' as const, baseUrl: '', enabled: true, locality: 'local' as const, discovery: 'auto' as const, models: [] };

  it('is cloud whatever its pin, names GitHub Copilot in consent, and finds its policy by kind', () => {
    expect(engineLocality(copilot)).toBe('cloud');
    expect(aiConsentHost(copilot)).toBe('GitHub Copilot');
    expect(aiConsentHost({ baseUrl: 'https://api.anthropic.com' })).toBe('api.anthropic.com');
    expect(aiProviderPolicy(copilot)?.url).toBe('https://copilot.github.trust.page/');
    expect(thinkingChoices('vscode-lm')).toEqual([]);
  });

  it('routes only where the host reports a status for it', () => {
    const model = { id: 'copilot/gpt-4o', enabled: true, capabilities: { chat: true, stream: true, vision: false, json: false, tools: false, fim: false, embed: false, contextTokens: 64000 }, capabilitiesSource: 'endpoint' as const };
    const settings: AiSettings = {
      ...defaultAiSettings(),
      enabled: true,
      allowCloud: true,
      engines: [{ ...copilot, locality: 'auto', models: [model] }],
      routing: { default: { engineId: 'c', modelId: model.id }, fallback: 'none', tasks: {} },
    };
    expect(resolveRoute(settings, [], { c: true }, { feature: 'rewrite' })).toMatchObject({ unusable: 'engineUnsupported' });
    const status = { engineId: 'c', ok: true, isLocal: false, hasKey: false, models: [] };
    expect(resolveRoute(settings, [status], { c: true }, { feature: 'rewrite' })).toMatchObject({ engineId: 'c', isLocal: false });
  });

  it('reads detectHostEngines results', () => {
    expect(vscodeLmAvailability([{ presetId: 'vscodelm', kind: 'vscode-lm', ok: true, models: 3 }])).toEqual({ available: true, models: 3 });
    expect(vscodeLmAvailability([{ presetId: 'vscodelm', kind: 'vscode-lm', ok: false, models: 0, error: 'signed out' }])).toEqual({ available: false, models: 0 });
    expect(vscodeLmAvailability(undefined)).toEqual({ available: false, models: 0 });
  });
});

// ── T1 additions ────────────────────────────────────────────────────────────

describe('recommendSetupPath: order and reasons (T1)', () => {
  const copilot = { available: true, models: 1 };
  const idle: AiLocalServerProbe = { presetId: 'ollama', baseUrl: 'http://127.0.0.1:11434/v1', ok: true, models: 0 };
  const down: AiLocalServerProbe = { presetId: 'omlx', baseUrl: 'http://127.0.0.1:8000/v1', ok: false };

  it('a running server beats Copilot beats a capable machine beats cloud, whatever else is true', () => {
    expect(recommendSetupPath({ running: [down, lmStudio], hardware: pc(8), vscodeLm: copilot }).path).toBe('runningLocal');
    expect(recommendSetupPath({ running: [down], hardware: mac(128), vscodeLm: copilot }).path).toBe('vscodeLm');
    // A capable machine is not a path of its own: cloud leads and local is only mentioned.
    expect(recommendSetupPath({ running: [down], hardware: mac(128), vscodeLm: { available: false, models: 0 } })).toMatchObject({ path: 'cloud', localCapable: true });
    expect(recommendSetupPath({ running: [], hardware: pc(8) })).toMatchObject({ path: 'cloud', localCapable: false });
  });

  it('a server that answers with no models does not count, and Copilot signed out does not either', () => {
    expect(recommendSetupPath({ running: [idle], hardware: null, vscodeLm: copilot }).path).toBe('vscodeLm');
    expect(recommendSetupPath({ running: [idle], hardware: null, vscodeLm: { available: true, models: 0 } }).path).toBe('cloud');
    expect(recommendSetupPath({ running: [idle], hardware: null }).reasons[0]).toBe('Ollama answered but lists no models.');
  });

  it('keeps localHint, hardwareLine and localCapable filled on every path', () => {
    const running = recommendSetupPath({ running: [lmStudio], hardware: mac(32) });
    expect(running).toMatchObject({ path: 'runningLocal', localCapable: true, localHint: 'Models up to about 30B parameters run well.' });
    expect(running.hardwareLine).toMatch(/^Local is an option on this machine: Apple Silicon, 32 GB\./);
    expect(recommendSetupPath({ running: [], hardware: mac(32), vscodeLm: copilot }).localHint).toBe('Models up to about 30B parameters run well.');
  });

  it('says why, one sentence per signal checked, in order', () => {
    expect(recommendSetupPath({ running: [lmStudio], hardware: mac(32) }).reasons).toEqual(['LM Studio is running on this machine with 3 models.']);
    expect(recommendSetupPath({ running: [], hardware: mac(32), vscodeLm: copilot }).reasons).toEqual([
      'No local model server is running.',
      'GitHub Copilot offers 1 model in VS Code.',
    ]);
    expect(recommendSetupPath({ running: [], hardware: mac(32), vscodeLm: { available: false, models: 0 } }).reasons).toEqual([
      'No local model server is running.',
      'GitHub Copilot offers no model in VS Code.',
      'Apple Silicon, 32 GB can run local models.',
    ]);
    expect(recommendSetupPath({ running: [], hardware: pc(8) }).reasons[1]).toBe('8 GB of memory is below the threshold for local models.');
    expect(recommendSetupPath({ running: [], hardware: null }).reasons[1]).toBe('The host did not report this machine’s hardware.');
  });
});

describe('the OQ11 threshold edges (T1)', () => {
  it('Apple Silicon: 16 GB yes, 8 GB no, with the reported memory a little under nominal still counting', () => {
    expect(isLocalCapable(mac(16))).toBe(true);
    expect(isLocalCapable(mac(8))).toBe(false);
    expect(isLocalCapable(mac(15.5))).toBe(true);
    expect(isLocalCapable(mac(14))).toBe(false);
    expect(isLocalCapable(mac(24))).toBe(true);
  });

  it('other machines: 32 GB yes, 16 GB no; an NVIDIA card with 8 GB of video memory yes, 6 GB no, whatever the system memory', () => {
    expect(isLocalCapable(pc(32))).toBe(true);
    // Reported memory runs a little under nominal: 31 GB is a 32 GB machine, 30 GB is not.
    expect(isLocalCapable(pc(31))).toBe(true);
    expect(isLocalCapable(pc(30))).toBe(false);
    expect(isLocalCapable(pc(16))).toBe(false);
    expect(isLocalCapable(pc(8, 8))).toBe(true);
    expect(isLocalCapable(pc(64, 4))).toBe(true);
    expect(isLocalCapable(pc(16, 6))).toBe(false);
    // Only NVIDIA counts: an AMD card's memory is not read as VRAM for the threshold.
    expect(isLocalCapable({ ...pc(16), gpu: { vendor: 'amd', vramBytes: 24 * GB } })).toBe(false);
  });

  it('a card with 24 GB of video memory sets the model size, not the system memory', () => {
    expect(recommendSetupPath({ running: [], hardware: pc(16, 24) }).localHint).toBe('Models up to about 30B parameters run well.');
    expect(recommendSetupPath({ running: [], hardware: pc(64, 8) }).localHint).toBe('Models up to about 8B parameters run well.');
  });

  it('localHint covers the three memory bands and nothing without hardware', () => {
    const hint = (hw: AiHardwareInfo | null) => recommendSetupPath({ running: [], hardware: hw }).localHint;
    expect(hint(mac(16))).toBe('Models up to about 8B parameters run well.');
    expect(hint(mac(24))).toBe('Models up to about 30B parameters run well.');
    expect(hint(mac(36))).toBe('Models up to about 30B parameters run well.');
    expect(hint(mac(48))).toMatch(/^Larger models work/);
    expect(hint(mac(8))).toBe('Models up to about 8B parameters run well.');
    expect(hint(null)).toBe('');
  });
});

describe('modelSizeHint: 7b, 30b, 70b and ids without a size (T1)', () => {
  const tag = (id: string, hw: AiHardwareInfo | null) => modelSizeHint(id, hw);

  it('7b: fits from 16 GB, tight on 8 GB; an 8b is too large on 8 GB', () => {
    expect(tag('qwen2.5-7b-instruct', mac(16))).toBe('fits');
    expect(tag('qwen2.5-7b-instruct', mac(32))).toBe('fits');
    expect(tag('qwen2.5-7b-instruct', mac(8))).toBe('tight');
    expect(tag('llama-3.1-8b', mac(8))).toBe('too large');
    expect(tag('llama-3.1-8b', mac(16))).toBe('fits');
  });

  it('30b: too large on 16 GB, fits on 32 GB', () => {
    expect(tag('qwen3-30b-a3b', mac(16))).toBe('too large');
    expect(tag('qwen3-30b-a3b', mac(32))).toBe('fits');
  });

  it('70b: too large on 32 GB, tight on 48 GB, fits on 64 GB', () => {
    expect(tag('llama-3.3-70b-instruct', mac(32))).toBe('too large');
    expect(tag('llama-3.3-70b-instruct', mac(48))).toBe('tight');
    expect(tag('llama-3.3-70b-instruct', mac(64))).toBe('fits');
  });

  it('gives no tag for an id without a size, or when the machine is unknown', () => {
    for (const id of ['gpt-4o', 'claude-sonnet-5-5', 'mlx-community/Qwen3-4bit', 'default', '']) {expect(tag(id, mac(32)), id).toBeUndefined();}
    expect(tag('qwen3-30b-a3b', null)).toBeUndefined();
  });

  it('judges an NVIDIA machine by its video memory, not its system memory', () => {
    expect(tag('qwen3-30b-a3b', pc(64, 8))).toBe('too large');
    expect(tag('qwen3-30b-a3b', pc(16, 24))).toBe('fits');
    // An 8 GB card is above the threshold: the band's 8B fits, as its hint says; a 14b is tight.
    expect(tag('qwen2.5-7b', pc(64, 8))).toBe('fits');
    expect(tag('llama-3.1-8b', pc(64, 8))).toBe('fits');
    expect(tag('phi-4-14b', pc(64, 8))).toBe('tight');
  });

  it('an 8 GB NVIDIA card tags a 7b model "fits", as its "up to about 8B run well" sentence says', () => {
    expect(recommendSetupPath({ running: [], hardware: pc(16, 8) }).localHint).toBe('Models up to about 8B parameters run well.');
    expect(modelSizeHint('qwen2.5-7b', pc(16, 8))).toBe('fits');
    expect(modelSizeHint('llama-3.1-8b', pc(16, 8))).toBe('fits');
  });
});

describe('links and wording (T1)', () => {
  it('every cloud and Copilot preset has a pricing page and every local preset but Custom an install page, each a plain https URL', () => {
    for (const p of AI_ENGINE_PRESETS.filter((x) => x.family === 'cloud' || x.family === 'host')) {
      const url = new URL(p.pricingUrl ?? 'nope');
      expect(url.protocol, p.id).toBe('https:');
      expect(url.username + url.password, p.id).toBe('');
    }
    for (const p of AI_ENGINE_PRESETS.filter((x) => x.family === 'local' && x.id !== 'custom')) {
      expect(new URL(p.installUrl ?? 'nope').protocol, p.id).toBe('https:');
    }
    expect(AI_ENGINE_PRESETS.find((p) => p.id === 'custom')?.installUrl).toBeUndefined();
  });

  it('no string in setup.ts, and no preset line, says a subscription includes API access', () => {
    const source = readFileSync(join(__dirname, '..', 'src', 'ai', 'setup.ts'), 'utf8');
    // Wording that would promise it: "subscription ... includes/covers/comes with", "API access is included".
    const promises = /subscription[^.\n]{0,80}\b(include|includes|included|cover|covers|covered|comes with|come with|get you|gets you)\b|\bAPI (access|key)s? (is|are) (included|free|covered)/i;
    expect(source).not.toMatch(promises);
    // Nor does any sentence the recommendation produces, on any path.
    const sentences = [
      ...recommendSetupPath({ running: [lmStudio], hardware: mac(32) }).reasons,
      ...recommendSetupPath({ running: [], hardware: mac(32), vscodeLm: { available: true, models: 2 } }).reasons,
      ...recommendSetupPath({ running: [], hardware: pc(8) }).reasons,
      recommendSetupPath({ running: [], hardware: pc(64) }).hardwareLine,
      recommendSetupPath({ running: [], hardware: mac(32) }).hardwareLine,
      recommendSetupPath({ running: [], hardware: pc(8) }).hardwareLine,
      AI_LOCAL_SMALL_MACHINE,
      AI_LOCAL_ROUGH_GUESS,
    ];
    for (const s of sentences) {expect(s).not.toMatch(promises);}
    for (const p of AI_ENGINE_PRESETS) {expect(`${p.caption} ${p.keyHint}`, p.id).not.toMatch(promises);}
  });
});
