/**
 * `ai.*` in the Desktop settings model: flat keys in the global file,
 * engines / cloud switch / local networks app-wide only (OPEN-4), typed
 * `settings.ai` for the editors, orphaned key cleanup.
 */
import { describe, expect, it, vi } from 'vitest';
import type { AiSettings } from '@mikedown/core/ai';
import { createPathOps } from '../../src/host/pathOps';
import { aiSettingsFromFlat, removedEngineIds } from '../../src/settings/aiSettings';
import { createDesktopSettingsStore } from '../../src/settings/desktopSettings';
import { sanitizeDesktopValue, SAVE_FOR_FOLDER_KEY, validateFolderOverride } from '../../src/settings/schema';
import type { SettingsApi, SettingsFileInfo, SettingsScope } from '../../src/settings/settingsApi';
import { createSettingsManager, type BannerItem } from '../../src/settings/store';

const path = createPathOps('posix');
const GLOBAL = '/appdata/settings.json';
const FOLDER = '/notes';
const folderFile = `${FOLDER}/.mikedown/settings.json`;

const ENGINE = { id: 'omlx', name: 'oMLX', kind: 'openai-compatible', baseUrl: 'http://127.0.0.1:8000/v1', models: [] };
const CLOUD = { id: 'claude', name: 'Anthropic', kind: 'anthropic', baseUrl: 'https://api.anthropic.com', models: [] };

function world(initial: Record<string, string> = {}) {
  const files = new Map<string, string>(Object.entries(initial));
  const api: SettingsApi = {
    async read(scope, folder): Promise<SettingsFileInfo> {
      const p = scope === 'global' ? GLOBAL : `${folder}/.mikedown/settings.json`;
      return { path: p, text: files.get(p) ?? null };
    },
    async write(scope: SettingsScope, folder, text): Promise<SettingsFileInfo> {
      const p = scope === 'global' ? GLOBAL : `${folder}/.mikedown/settings.json`;
      files.set(p, text);
      return { path: p, text };
    },
    async emitChanged() { /* single window */ },
    async onChanged() { return () => undefined; },
    async openDefaultAppsSettings() { return false; },
  };
  const applied: Array<Record<string, unknown>> = [];
  const banners: BannerItem[][] = [];
  const removed: string[][] = [];
  const manager = createSettingsManager({
    api,
    path,
    store: createDesktopSettingsStore(),
    folder: () => FOLDER,
    windowLabel: 'main',
    applyCore: (patch) => { applied.push({ ...patch }); },
    banner: { show: (items) => { banners.push(items); }, clear: () => { banners.push([]); } },
    notify: () => undefined,
    onEnginesRemoved: (ids) => { removed.push(ids); },
    openFile: vi.fn(),
  });
  const json = (p: string): Record<string, unknown> => JSON.parse(files.get(p) ?? '{}') as Record<string, unknown>;
  return { files, manager, applied, banners, removed, json };
}

describe('ai.* in the settings schema', () => {
  it('has off-by-default keys and only accepts the right container types', () => {
    const store = createDesktopSettingsStore();
    expect(store.flat()).toMatchObject({ 'ai.enabled': false, 'ai.allowCloud': false, 'ai.engines': [], 'ai.routing': {}, 'ai.features': {} });
    expect(store.flat()['ai.localNetworks']).toEqual(['10.0.0.0/8', '172.16.0.0/12', '192.168.0.0/16']);

    expect(sanitizeDesktopValue('ai.engines', [ENGINE])).toEqual({ ok: true, value: [ENGINE] });
    expect(sanitizeDesktopValue('ai.engines', 'nope')).toEqual({ ok: false });
    expect(sanitizeDesktopValue('ai.routing', { default: null })).toEqual({ ok: true, value: { default: null } });
    expect(sanitizeDesktopValue('ai.routing', [1])).toEqual({ ok: false });
    expect(sanitizeDesktopValue('ai.enabled', 'yes')).toEqual({ ok: false });
  });

  it('the store does not alias the arrays it was given', () => {
    const store = createDesktopSettingsStore();
    const engines = [{ ...ENGINE }];
    store.apply({ 'ai.engines': engines });
    engines.push({ ...CLOUD });
    expect((store.flat()['ai.engines'] as unknown[]).length).toBe(1);
  });

  it('builds typed AiSettings from the flat keys and leaves the consent answers out', () => {
    const ai: AiSettings = aiSettingsFromFlat({
      'ai.enabled': true,
      'ai.engines': [ENGINE],
      'ai.consent.claude': true,
      fontSize: 18,
    });
    expect(ai.enabled).toBe(true);
    expect(ai.engines.map((e) => e.id)).toEqual(['omlx']);
    expect(Object.keys(ai)).not.toContain('consent.claude');
  });

  it('lists the engine ids that left the list', () => {
    expect(removedEngineIds([{ id: 'a' }, { id: 'b' }], [{ id: 'b' }])).toEqual(['a']);
    expect(removedEngineIds([{ id: 'a' }], 'broken')).toEqual(['a']);
    expect(removedEngineIds(undefined, [{ id: 'a' }])).toEqual([]);
  });
});

describe('ai.* app-wide keys (OPEN-4)', () => {
  it('a folder file cannot add engines, turn on the cloud or redefine local networks', () => {
    const { value, problems } = validateFolderOverride(
      { 'ai.engines': [CLOUD], 'ai.allowCloud': true, 'ai.localNetworks': ['0.0.0.0/0'], 'ai.enabled': false, 'ai.routing': {} },
      FOLDER,
      path,
    );
    expect(Object.keys(value).sort()).toEqual(['ai.enabled', 'ai.routing']);
    expect(problems.map((p) => p.key).sort()).toEqual(['ai.allowCloud', 'ai.engines', 'ai.localNetworks']);
  });

  it('loads engines from the global file only, still honouring a folder switch-off', async () => {
    const w = world({
      [GLOBAL]: JSON.stringify({ 'ai.enabled': true, 'ai.allowCloud': true, 'ai.engines': [ENGINE] }),
      [folderFile]: JSON.stringify({ 'ai.enabled': false, 'ai.engines': [CLOUD], 'ai.allowCloud': false, 'ai.consent.claude': true }),
    });
    await w.manager.load();
    const ai = w.manager.aiSettings();
    expect(ai.enabled).toBe(false);
    expect(ai.allowCloud).toBe(true);
    expect(ai.engines.map((e) => e.id)).toEqual(['omlx']);
    expect(w.applied.at(-1)?.ai).toBe(ai);
    expect(w.banners.at(-1)?.map((b) => b.message).join(' ')).toContain('ai.engines');
  });

  it('delivers settings.ai to new editors', async () => {
    const w = world({ [GLOBAL]: JSON.stringify({ 'ai.enabled': true, 'ai.engines': [ENGINE] }) });
    await w.manager.load();
    const ai = w.manager.coreSettings().ai;
    expect(ai?.enabled).toBe(true);
    expect(ai?.engines[0].id).toBe('omlx');
  });

  it('a Save for this folder patch puts engines in the global file and the rest in the folder file', async () => {
    const w = world();
    await w.manager.load();
    await w.manager.save({ 'ai.engines': [ENGINE], 'ai.enabled': true, [SAVE_FOR_FOLDER_KEY]: true });
    expect(w.json(GLOBAL)['ai.engines']).toEqual([ENGINE]);
    expect(w.json(GLOBAL)['ai.enabled']).toBeUndefined();
    expect(w.json(folderFile)).toEqual({ 'ai.enabled': true });
    expect(w.manager.aiSettings().engines.map((e) => e.id)).toEqual(['omlx']);
  });

  it('a folder save of only app-wide keys writes no folder file', async () => {
    const w = world();
    await w.manager.load();
    await w.manager.save({ 'ai.allowCloud': true, [SAVE_FOR_FOLDER_KEY]: true });
    expect(w.json(GLOBAL)['ai.allowCloud']).toBe(true);
    expect(w.files.has(folderFile)).toBe(false);
  });
});

describe('orphaned API keys', () => {
  it('deleting an engine in a save reports its id once the write succeeded', async () => {
    const w = world({ [GLOBAL]: JSON.stringify({ 'ai.engines': [ENGINE, CLOUD] }) });
    await w.manager.load();
    await w.manager.save({ 'ai.engines': [ENGINE] });
    expect(w.removed).toEqual([['claude']]);
    // Adding or editing an engine does not.
    await w.manager.save({ 'ai.engines': [{ ...ENGINE, name: 'renamed' }, CLOUD] });
    expect(w.removed).toEqual([['claude']]);
  });
});
