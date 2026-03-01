import * as vscode from 'vscode';

export interface MikeDownSettings {
  defaultEditor: boolean;
  fontFamily: string;
  fontSize: number;
  linkClickBehavior: 'navigateCurrentTab' | 'openNewTab' | 'showContextMenu';
  autoReloadUnmodifiedFiles: boolean;
  markdownNormalization: 'preserve' | 'normalize';
  normalizationStyle: {
    boldMarker: '**' | '__';
    italicMarker: '*' | '_';
    listMarker: '-' | '*' | '+';
    headingStyle: 'atx' | 'setext';
  };
}

export function getSettings(): MikeDownSettings {
  const config = vscode.workspace.getConfiguration('mikedown');
  return {
    defaultEditor: config.get<boolean>('defaultEditor', false),
    fontFamily: config.get<string>('fontFamily', ''),
    fontSize: config.get<number>('fontSize', 16),
    linkClickBehavior: config.get<'navigateCurrentTab' | 'openNewTab' | 'showContextMenu'>('linkClickBehavior', 'openNewTab'),
    autoReloadUnmodifiedFiles: config.get<boolean>('autoReloadUnmodifiedFiles', true),
    markdownNormalization: config.get<'preserve' | 'normalize'>('markdownNormalization', 'preserve'),
    normalizationStyle: {
      boldMarker: config.get<'**' | '__'>('normalizationStyle.boldMarker', '**'),
      italicMarker: config.get<'*' | '_'>('normalizationStyle.italicMarker', '*'),
      listMarker: config.get<'-' | '*' | '+'>('normalizationStyle.listMarker', '-'),
      headingStyle: config.get<'atx' | 'setext'>('normalizationStyle.headingStyle', 'atx'),
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
