import { describe, it, expect, vi, afterEach } from 'vitest';
import * as path from 'path';
import * as fs from 'fs';
import * as vscode from 'vscode';
import { getSettings, readToolbarLayout } from '../../src/settings';

// Host-side coverage for `mikedown.toolbarLayout`: the reader (object or null,
// no other validation) and the package.json schema it must match.

vi.mock('vscode', () => ({
  workspace: {
    getConfiguration: vi.fn(),
  },
}));

function mockConfig(values: Record<string, unknown>): void {
  vi.mocked(vscode.workspace.getConfiguration).mockReturnValue({
    get: (key: string, defaultValue: unknown) => (key in values ? values[key] : defaultValue),
    inspect: () => undefined,
  } as any);
}

describe('getSettings().toolbarLayout', () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it('is null when nothing is configured', () => {
    mockConfig({});
    expect(getSettings().toolbarLayout).toBeNull();
  });

  it('passes a stored layout through untouched, including keys a newer version added', () => {
    const layout = { version: 2, items: ['textFormat', 'future', 'more'], seen: ['textFormat'], extra: { a: 1 } };
    mockConfig({ toolbarLayout: layout });
    expect(getSettings().toolbarLayout).toEqual(layout);
  });
});

describe('readToolbarLayout', () => {
  it('returns null for anything that is not a plain object', () => {
    for (const raw of [null, undefined, 'x', 3, true, ['textFormat']]) {
      expect(readToolbarLayout(raw)).toBeNull();
    }
  });

  it('returns a copy, not the configuration object itself', () => {
    const raw = { version: 1, items: [], seen: [] };
    const read = readToolbarLayout(raw);
    expect(read).toEqual(raw);
    expect(read).not.toBe(raw);
  });
});

describe('package.json declares mikedown.toolbarLayout', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, '../../package.json'), 'utf8'));
  const prop = pkg.contributes.configuration.properties['mikedown.toolbarLayout'];

  it('is an application-scoped object-or-null defaulting to null', () => {
    expect(prop).toBeDefined();
    expect(prop.type).toEqual(['object', 'null']);
    expect(prop.default).toBeNull();
    expect(prop.scope).toBe('application');
  });

  it('describes version, items and seen and keeps additionalProperties open', () => {
    expect(Object.keys(prop.properties).sort()).toEqual(['items', 'seen', 'version']);
    expect(prop.additionalProperties).toBe(true);
  });
});
