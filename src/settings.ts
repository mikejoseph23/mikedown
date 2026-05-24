import * as vscode from 'vscode';

export interface MikeDownSettings {
  defaultEditor: boolean;
  fontFamily: string;
  fontSize: number;
  linkClickBehavior: 'navigateCurrentTab' | 'openNewTab' | 'showContextMenu';
  themeToggleScope: 'vscode' | 'editorOnly';
  editorTheme: 'auto' | 'light' | 'dark';
  autoReloadUnmodifiedFiles: boolean;
  markdownNormalization: 'preserve' | 'normalize';
  normalizationStyle: {
    boldMarker: '**' | '__';
    italicMarker: '*' | '_';
    listMarker: '-' | '*' | '+';
    headingStyle: 'atx' | 'setext';
  };
  imagePaste: ImagePasteSettings;
  imageResize: ImageResizeSettings;
  outline: OutlineSettings;
}

export interface OutlineSettings {
  visibility: 'always' | 'never' | 'remember';
  width: number;
  position: 'left' | 'right';
}

export interface ImagePasteSettings {
  enabled: boolean;
  folder: string;
  folderRelativeTo: 'document' | 'workspace';
  filenamePattern: string;
  pathStyle: 'relative' | 'workspace-absolute';
  altText: 'empty' | 'filename' | 'prompt';
  maxSizeMB: number;
  cleanupUnreferenced: boolean;
}

export interface ImageResizeSettings {
  overwrite: boolean;
}

export function getSettings(): MikeDownSettings {
  const config = vscode.workspace.getConfiguration('mikedown');
  return {
    defaultEditor: config.get<boolean>('defaultEditor', false),
    fontFamily: config.get<string>('fontFamily', ''),
    fontSize: config.get<number>('fontSize', 16),
    linkClickBehavior: config.get<'navigateCurrentTab' | 'openNewTab' | 'showContextMenu'>('linkClickBehavior', 'openNewTab'),
    themeToggleScope: config.get<'vscode' | 'editorOnly'>('themeToggleScope', 'editorOnly'),
    editorTheme: config.get<'auto' | 'light' | 'dark'>('editorTheme', 'auto'),
    autoReloadUnmodifiedFiles: config.get<boolean>('autoReloadUnmodifiedFiles', true),
    markdownNormalization: config.get<'preserve' | 'normalize'>('markdownNormalization', 'preserve'),
    normalizationStyle: {
      boldMarker: config.get<'**' | '__'>('normalizationStyle.boldMarker', '**'),
      italicMarker: config.get<'*' | '_'>('normalizationStyle.italicMarker', '*'),
      listMarker: config.get<'-' | '*' | '+'>('normalizationStyle.listMarker', '-'),
      headingStyle: config.get<'atx' | 'setext'>('normalizationStyle.headingStyle', 'atx'),
    },
    imagePaste: {
      enabled: config.get<boolean>('imagePaste.enabled', true),
      folder: config.get<string>('imagePaste.folder', 'images'),
      folderRelativeTo: config.get<'document' | 'workspace'>('imagePaste.folderRelativeTo', 'document'),
      filenamePattern: config.get<string>('imagePaste.filenamePattern', '${docName}-${timestamp}'),
      pathStyle: config.get<'relative' | 'workspace-absolute'>('imagePaste.pathStyle', 'relative'),
      altText: config.get<'empty' | 'filename' | 'prompt'>('imagePaste.altText', 'empty'),
      maxSizeMB: config.get<number>('imagePaste.maxSizeMB', 10),
      cleanupUnreferenced: config.get<boolean>('imagePaste.cleanupUnreferenced', true),
    },
    imageResize: {
      overwrite: config.get<boolean>('imageResize.overwrite', true),
    },
    outline: {
      visibility: config.get<'always' | 'never' | 'remember'>('outline.visibility', 'never'),
      width: config.get<number>('outline.width', 200),
      position: config.get<'left' | 'right'>('outline.position', 'right'),
    },
  };
}

export function onSettingsChange(callback: (settings: MikeDownSettings) => void): vscode.Disposable {
  return vscode.workspace.onDidChangeConfiguration((event) => {
    if (event.affectsConfiguration('mikedown')) {
      callback(getSettings());
    }
  });
}
