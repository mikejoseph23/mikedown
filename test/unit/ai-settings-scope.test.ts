/**
 * Scope of the AI settings in package.json: the ones that decide where text can
 * go are machine scope, so a repository's .vscode/settings.json cannot turn
 * cloud on or add an endpoint.
 */
import * as fs from 'fs';
import * as path from 'path';
import { describe, expect, it, vi } from 'vitest';

const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, '../../package.json'), 'utf8'));
const props: Record<string, any> = pkg.contributes.configuration.properties;

describe('package.json scopes for the AI settings', () => {
  it('mikedown.ai.allowCloud is machine scope and off by default', () => {
    expect(props['mikedown.ai.allowCloud'].scope).toBe('machine');
    expect(props['mikedown.ai.allowCloud'].default).toBe(false);
  });

  it('mikedown.ai.engines is machine scope', () => {
    expect(props['mikedown.ai.engines'].scope).toBe('machine');
  });

  it('mikedown.ai.localNetworks is machine scope', () => {
    expect(props['mikedown.ai.localNetworks'].scope).toBe('machine');
  });

  it('no AI setting stores a secret: key properties only name where to look', () => {
    const engineProps = props['mikedown.ai.engines'].items.properties as Record<string, unknown>;
    expect(Object.keys(engineProps)).not.toContain('apiKey');
    expect(Object.keys(props).filter((k) => /^mikedown\.ai\..*(apiKey|secret|token)$/i.test(k))).toEqual([]);
  });
});

describe('saving mikedown.ai.localNetworks', () => {
  it('writes the list to user settings even when a workspace value exists, and nothing else', async () => {
    vi.resetModules();
    const update = vi.fn(async () => {});
    vi.doMock('vscode', () => ({
      ConfigurationTarget: { Global: 1, Workspace: 2, WorkspaceFolder: 3 },
      window: { showErrorMessage: vi.fn(), showWarningMessage: vi.fn() },
      workspace: {
        getConfiguration: () => ({
          inspect: (key: string) => (key === 'ai.localNetworks' ? { globalValue: ['10.0.98.0/24'], workspaceValue: ['0.0.0.0/0'] } : undefined),
          update,
        }),
      },
    }));
    const { saveAiSettingsPatch } = await import('../../src/ai/vscodeAi');
    const written = await saveAiSettingsPatch({ 'ai.localNetworks': ['10.0.98.0/24', '.ts.net', '  '] });
    expect(written).toEqual(['localNetworks']);
    expect(update).toHaveBeenCalledTimes(1);
    expect(update).toHaveBeenCalledWith('ai.localNetworks', ['10.0.98.0/24', '.ts.net'], 1);
    vi.doUnmock('vscode');
  });
});

describe('saving features.ghostText.localOnly', () => {
  async function save(inspected: Record<string, unknown>, patch: Record<string, unknown>) {
    vi.resetModules();
    const update = vi.fn(async () => {});
    vi.doMock('vscode', () => ({
      ConfigurationTarget: { Global: 1, Workspace: 2, WorkspaceFolder: 3 },
      window: { showErrorMessage: vi.fn(), showWarningMessage: vi.fn() },
      workspace: { getConfiguration: () => ({ inspect: (key: string) => inspected[key.replace(/^ai\./, '')], update }) },
    }));
    const { saveAiSettingsPatch } = await import('../../src/ai/vscodeAi');
    await saveAiSettingsPatch(patch);
    vi.doUnmock('vscode');
    return update;
  }

  it('with no workspace features value, the whole value goes to user settings', async () => {
    const update = await save({ features: { globalValue: { ghostText: { delayMs: 500 } } } }, { 'ai.features': { ghostText: { delayMs: 500, localOnly: false } } });
    expect(update).toHaveBeenCalledTimes(1);
    expect(update).toHaveBeenCalledWith('ai.features', { ghostText: { delayMs: 500, localOnly: false } }, 1);
  });

  it('with a workspace features value, localOnly lands in user settings and not in the workspace file', async () => {
    const update = await save(
      { features: { globalValue: { ghostText: { delayMs: 900 } }, workspaceValue: { ghostText: { delayMs: 200, localOnly: false } } } },
      { 'ai.features': { ghostText: { delayMs: 200, localOnly: false } } },
    );
    expect(update).toHaveBeenCalledWith('ai.features', { ghostText: { delayMs: 900, localOnly: false } }, 1);
    expect(update).toHaveBeenCalledWith('ai.features', { ghostText: { delayMs: 200 } }, 2);
    expect(update).toHaveBeenCalledTimes(2);
  });

  it('a write-back never copies workspace values into user settings', async () => {
    // The user switches nothing: localOnly stays at the default, the workspace value is only re-saved to the workspace.
    const update = await save(
      { features: { workspaceValue: { rewrite: { enabled: true }, ghostText: { localOnly: false } } } },
      { 'ai.features': { rewrite: { enabled: true }, ghostText: { localOnly: true } } },
    );
    expect(update).toHaveBeenCalledTimes(1);
    expect(update).toHaveBeenCalledWith('ai.features', { rewrite: { enabled: true } }, 2);
  });
});
