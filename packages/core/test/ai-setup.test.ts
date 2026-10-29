import { describe, expect, it } from 'vitest';
import {
  AI_ENGINE_PRESETS,
  aiConsentHost,
  aiProviderPolicy,
  engineLocality,
  isLocalCapable,
  modelParamsBillions,
  modelSizeHint,
  recommendSetupPath,
  resolveRoute,
  thinkingChoices,
  vscodeLmAvailability,
  type AiHardwareInfo,
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
