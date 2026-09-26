import { describe, it, expect, vi, afterEach } from 'vitest';
import * as path from 'path';
import * as fs from 'fs';
import * as vscode from 'vscode';
import { getSettings } from '../../src/settings';

// Host-side coverage for the "Support MikeDown" sidebar link setting (M6/M7):
// the reader default and the package.json schema entry it must match.

vi.mock('vscode', () => ({
  workspace: {
    getConfiguration: vi.fn(),
  },
}));

describe('getSettings — support.showSidebarLink', () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it('defaults to true when nothing is configured', () => {
    const get = vi.fn((_key: string, fallback: unknown) => fallback);
    vi.mocked(vscode.workspace.getConfiguration).mockReturnValue({ get } as any);

    const settings = getSettings();

    expect(settings.support.showSidebarLink).toBe(true);
    expect(get).toHaveBeenCalledWith('support.showSidebarLink', true);
  });

  it('reads an explicit false through', () => {
    const get = vi.fn((key: string, fallback: unknown) => (key === 'support.showSidebarLink' ? false : fallback));
    vi.mocked(vscode.workspace.getConfiguration).mockReturnValue({ get } as any);

    const settings = getSettings();

    expect(settings.support.showSidebarLink).toBe(false);
  });
});

describe('package.json declares mikedown.support.showSidebarLink', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, '../../package.json'), 'utf8'));
  const prop = pkg.contributes.configuration.properties['mikedown.support.showSidebarLink'];

  it('exists with type boolean and default true', () => {
    expect(prop).toBeDefined();
    expect(prop.type).toBe('boolean');
    expect(prop.default).toBe(true);
  });
});
