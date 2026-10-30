/**
 * The `AI: …` status bar badge follows the default engine (Q7): a settings
 * change shows where the next request goes, without waiting for one to run.
 */
import { describe, expect, it, vi } from 'vitest';

const item = { text: '', tooltip: '', name: '', command: '', show: vi.fn(), hide: vi.fn(), dispose: vi.fn() };
vi.mock('vscode', () => ({
  StatusBarAlignment: { Left: 1, Right: 2 },
  window: { createStatusBarItem: () => item },
}));

import { parseAiSettings, type AiSettings } from '@mikedown/core/ai';
import { AiStatusBar, routeLabel } from '../../src/ai/statusBar';

const CHAT = { chat: true, stream: true, vision: false, json: false, tools: false, fim: false, embed: false, contextTokens: 32768 };

function settings(defaultEngine: string | null): AiSettings {
  return parseAiSettings({
    enabled: true,
    engines: [
      { id: 'omlx', name: 'oMLX', kind: 'openai-compatible', baseUrl: 'http://127.0.0.1:8000/v1', models: [{ id: 'qwen', label: 'Qwen 30B', capabilities: CHAT, capabilitiesSource: 'user' }] },
      { id: 'lms', name: 'LM Studio', kind: 'lmstudio', baseUrl: 'http://127.0.0.1:1234/v1', models: [{ id: 'qwen/qwen3.8-27b', capabilities: CHAT, capabilitiesSource: 'user' }] },
    ],
    routing: { default: defaultEngine ? { engineId: defaultEngine, modelId: defaultEngine === 'omlx' ? 'qwen' : 'qwen/qwen3.8-27b' } : null, fallback: 'none', tasks: {} },
  }, { onWarning: () => {} });
}

describe('AI status bar route', () => {
  it('routeLabel names the engine the next request goes to, or null when none can serve it', () => {
    expect(routeLabel(settings('lms'))).toMatchObject({ text: '$(home) AI: local · LM Studio · qwen/qwen3.8-27b', engineId: 'lms' });
    expect(routeLabel(settings('lms'))!.tooltip).toMatch(/^Next AI request goes to LM Studio \(local\)/);
    expect(routeLabel(settings(null))).toBeNull();
  });

  it('a new default replaces the last served badge at once; the same route keeps it', () => {
    const bar = new AiStatusBar();
    bar.showServed({ text: 'ok', finishReason: 'stop', served: { engineId: 'omlx', engineName: 'oMLX', modelId: 'qwen', isLocal: true } }, settings('omlx'));
    expect(item.text).toBe('$(home) AI: local · oMLX · Qwen 30B');

    bar.showRoute(settings('omlx'));
    expect(item.text).toBe('$(home) AI: local · oMLX · Qwen 30B');
    expect(item.tooltip).toMatch(/^Last AI request served by oMLX/);

    bar.showRoute(settings('lms'));
    expect(item.text).toBe('$(home) AI: local · LM Studio · qwen/qwen3.8-27b');

    bar.showRoute(settings(null));
    expect(item.text).toBe('$(sparkle) AI');
  });
});
