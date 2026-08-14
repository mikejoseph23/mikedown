import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as vscode from 'vscode';
import {
  shouldOfferDefaultEditorPrompt,
  isMikeDownDefaultEditor,
  applyMikeDownAsDefaultEditor,
} from '../../src/defaultEditorPrompt';

// Mock vscode module
vi.mock('vscode', () => ({
  workspace: {
    getConfiguration: vi.fn(),
  },
  ConfigurationTarget: {
    Global: 1,
  },
}));

describe('shouldOfferDefaultEditorPrompt', () => {
  let mockContext: vscode.ExtensionContext;
  let mockGlobalState: Record<string, any>;

  beforeEach(() => {
    mockGlobalState = {};
    mockContext = {
      globalState: {
        get: vi.fn((key: string) => mockGlobalState[key]),
        update: vi.fn(async (key: string, value: any) => {
          mockGlobalState[key] = value;
        }),
      },
    } as any;
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('should return true on fresh install (no globalState entry, not default)', () => {
    vi.mocked(vscode.workspace.getConfiguration).mockReturnValue({
      get: vi.fn(() => ({})),
    } as any);

    expect(shouldOfferDefaultEditorPrompt(mockContext)).toBe(true);
  });

  it('should return false if MikeDown is already the default editor', () => {
    vi.mocked(vscode.workspace.getConfiguration).mockReturnValue({
      get: vi.fn(() => ({ '*.md': 'mikedown.editor' })),
    } as any);

    expect(shouldOfferDefaultEditorPrompt(mockContext)).toBe(false);
  });

  it('should return false if prompt has already been offered (offeredAt is set)', () => {
    vi.mocked(vscode.workspace.getConfiguration).mockReturnValue({
      get: vi.fn(() => ({})),
    } as any);

    mockGlobalState['mikedown.defaultEditorPrompt.offeredAt'] = Date.now();

    expect(shouldOfferDefaultEditorPrompt(mockContext)).toBe(false);
  });

  it('should return false if MikeDown is already default (takes precedence)', () => {
    vi.mocked(vscode.workspace.getConfiguration).mockReturnValue({
      get: vi.fn(() => ({ '*.md': 'mikedown.editor' })),
    } as any);

    mockGlobalState['mikedown.defaultEditorPrompt.offeredAt'] = Date.now();

    expect(shouldOfferDefaultEditorPrompt(mockContext)).toBe(false);
  });
});

describe('isMikeDownDefaultEditor', () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it('should return true when workbench.editorAssociations["*.md"] === "mikedown.editor"', () => {
    vi.mocked(vscode.workspace.getConfiguration).mockReturnValue({
      get: vi.fn(() => ({ '*.md': 'mikedown.editor' })),
    } as any);

    expect(isMikeDownDefaultEditor()).toBe(true);
  });

  it('should return false when *.md is associated with a different editor', () => {
    vi.mocked(vscode.workspace.getConfiguration).mockReturnValue({
      get: vi.fn(() => ({ '*.md': 'default' })),
    } as any);

    expect(isMikeDownDefaultEditor()).toBe(false);
  });

  it('should return false when associations are empty', () => {
    vi.mocked(vscode.workspace.getConfiguration).mockReturnValue({
      get: vi.fn(() => ({})),
    } as any);

    expect(isMikeDownDefaultEditor()).toBe(false);
  });

  it('should return false when workbench.editorAssociations is undefined', () => {
    vi.mocked(vscode.workspace.getConfiguration).mockReturnValue({
      get: vi.fn(() => undefined),
    } as any);

    expect(isMikeDownDefaultEditor()).toBe(false);
  });

  it('should return false when MikeDown is in associations but with wrong key', () => {
    vi.mocked(vscode.workspace.getConfiguration).mockReturnValue({
      get: vi.fn(() => ({ '*.markdown': 'mikedown.editor' })),
    } as any);

    expect(isMikeDownDefaultEditor()).toBe(false);
  });
});

describe('applyMikeDownAsDefaultEditor', () => {
  let mockConfig: any;

  beforeEach(() => {
    mockConfig = {
      get: vi.fn(),
      update: vi.fn(async () => {}),
    };
    vi.mocked(vscode.workspace.getConfiguration).mockReturnValue(mockConfig);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('should update workbench.editorAssociations with mikedown.editor for *.md', async () => {
    mockConfig.get.mockReturnValue({});

    await applyMikeDownAsDefaultEditor();

    expect(mockConfig.update).toHaveBeenCalledWith(
      'workbench.editorAssociations',
      { '*.md': 'mikedown.editor' },
      vscode.ConfigurationTarget.Global
    );
  });

  it('should preserve existing associations when adding mikedown.editor', async () => {
    const existingAssociations = {
      '*.json': 'default',
      '*.ts': 'custom-editor',
    };
    mockConfig.get.mockReturnValue(existingAssociations);

    await applyMikeDownAsDefaultEditor();

    expect(mockConfig.update).toHaveBeenCalledWith(
      'workbench.editorAssociations',
      {
        '*.json': 'default',
        '*.ts': 'custom-editor',
        '*.md': 'mikedown.editor',
      },
      vscode.ConfigurationTarget.Global
    );
  });

  it('should update *.md association if it already exists with a different value', async () => {
    mockConfig.get.mockReturnValue({ '*.md': 'default' });

    await applyMikeDownAsDefaultEditor();

    expect(mockConfig.update).toHaveBeenCalledWith(
      'workbench.editorAssociations',
      { '*.md': 'mikedown.editor' },
      vscode.ConfigurationTarget.Global
    );
  });

  it('should call update at Global scope', async () => {
    mockConfig.get.mockReturnValue({});

    await applyMikeDownAsDefaultEditor();

    const calls = mockConfig.update.mock.calls;
    expect(calls.length).toBe(1);
    expect(calls[0][2]).toBe(vscode.ConfigurationTarget.Global);
  });
});
