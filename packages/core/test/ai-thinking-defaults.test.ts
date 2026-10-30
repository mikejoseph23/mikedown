/**
 * "Default" on the thinking dial means MikeDown picks per task (Q6): short
 * edits send Off (each kind's nearest), explain and summarize leave it to the
 * model, and an explicit dial level or a level set on the model wins.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { buildCompletionBody, parseAiSettings, resolveThinkingLevel, taskThinkingDefault, thinkingLevelFrom, type AiCompletionRequest, type AiEngineKind, type AiThinkingLevel, type MikeDownAiHost } from '../src/ai';
import { runAiCompletion, type AiRunThinking } from '../src/ai-request';

interface DefaultsCase {
  name: string;
  kind: AiEngineKind;
  local: boolean;
  modelId: string;
  job: string;
  explicit: AiThinkingLevel | null;
  modelOverrides: Record<string, unknown> | null;
  expectedOverrides: Record<string, unknown> | null;
  expectedAuto: boolean;
  expectedBodyEffort?: string;
}

const fixture = JSON.parse(readFileSync(join(__dirname, '../../../test/ai-fixtures/requests/thinking-defaults.json'), 'utf8')) as { cases: DefaultsCase[] };

const CHAT = { chat: true, stream: true, vision: false, json: false, tools: false, fim: false, embed: false, contextTokens: 32768 };

describe('taskThinkingDefault', () => {
  it('is Off for the short edits and the model\'s own for the rest', () => {
    for (const job of ['rewrite', 'translate', 'title', 'frontmatter']) {expect(taskThinkingDefault(job), job).toBe('off');}
    for (const job of ['explain', 'summary', 'structureCheck', 'chat', undefined]) {expect(taskThinkingDefault(job), String(job)).toBeNull();}
  });
});

describe('resolveThinkingLevel', () => {
  it('an explicit level wins over the model and the job', () => {
    expect(resolveThinkingLevel('lmstudio', 'medium', null, 'rewrite')).toEqual({ level: 'medium', auto: false });
    expect(resolveThinkingLevel('openai-compatible', 'high', 'off', 'rewrite')).toEqual({ level: 'high', auto: false });
    expect(resolveThinkingLevel('openai-compatible', 'off', 'high', 'summary')).toEqual({ level: 'off', auto: false });
  });

  it('a level set on the model wins over the job\'s default', () => {
    expect(resolveThinkingLevel('openai-compatible', null, 'high', 'rewrite')).toEqual({ level: null, auto: false });
  });

  it('otherwise the job\'s default, at the kind\'s nearest level', () => {
    expect(resolveThinkingLevel('lmstudio', null, null, 'rewrite')).toEqual({ level: 'off', auto: true });
    expect(resolveThinkingLevel('anthropic', null, null, 'title')).toEqual({ level: 'low', auto: true });
    expect(resolveThinkingLevel('vscode-lm', null, null, 'rewrite')).toEqual({ level: null, auto: false });
    expect(resolveThinkingLevel('lmstudio', null, null, 'explain')).toEqual({ level: null, auto: false });
  });

  it('an OpenAI model that does not reason gets nothing', () => {
    expect(resolveThinkingLevel('openai', null, null, 'rewrite', { modelId: 'gpt-4.1' })).toEqual({ level: null, auto: false });
    expect(resolveThinkingLevel('openai', null, null, 'rewrite', { modelId: 'gpt-5.5' })).toEqual({ level: 'off', auto: true });
  });
});

describe('runAiCompletion on Default (shared fixture)', () => {
  it.each(fixture.cases.map((c) => [c.name, c] as const))('%s', async (_name, c) => {
    const settings = parseAiSettings({
      enabled: true,
      allowCloud: true,
      engines: [{ id: 'e', name: 'E', kind: c.kind, baseUrl: c.local ? 'http://127.0.0.1:1234/v1' : 'https://api.example.com/v1', models: [{ id: c.modelId, capabilities: CHAT, capabilitiesSource: 'user', ...(c.modelOverrides ? { requestOverrides: c.modelOverrides } : {}) }] }],
      routing: { default: { engineId: 'e', modelId: c.modelId }, fallback: 'none', tasks: {} },
    }, { onWarning: () => {} });
    const calls: AiCompletionRequest[] = [];
    const ai: MikeDownAiHost = {
      complete: async (req) => {
        calls.push(req);
        return { text: 'ok', served: { engineId: 'e', engineName: 'E', modelId: c.modelId, isLocal: c.local }, finishReason: 'stop' };
      },
      listEngines: async () => [],
    };
    const statuses = c.kind === 'vscode-lm' ? [{ engineId: 'e', ok: true, isLocal: false, hasKey: true, models: [] }] : [];
    const feature = c.job === 'explain' || c.job === 'translate' ? 'rewrite' : c.job;
    const out = await runAiCompletion(
      { ai, settings: () => settings, statuses: () => statuses, consent: { e: true } },
      { feature, job: c.job, messages: [{ role: 'user', content: 'x' }], maxTokens: 256, thinking: () => c.explicit },
      {},
      new AbortController().signal,
    );
    expect(calls[0].requestOverrides ?? null).toEqual(c.expectedOverrides);
    const thinking = out.thinking as AiRunThinking | null;
    expect(thinking?.auto ?? false).toBe(c.expectedAuto);
    if (c.expectedBodyEffort) {
      const body = buildCompletionBody(c.kind, { id: c.modelId, requestOverrides: c.modelOverrides ?? undefined }, calls[0]);
      expect(body.reasoning_effort).toBe(c.expectedBodyEffort);
    }
    // An Off sent automatically adds no reasoning headroom: the answer budget is the whole budget.
    if (c.expectedAuto && thinkingLevelFrom(c.kind, c.expectedOverrides ?? undefined) === 'off') {expect(calls[0].maxTokens).toBe(256);}
  });
});
