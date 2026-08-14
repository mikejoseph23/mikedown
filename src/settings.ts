import * as vscode from 'vscode';

export interface MikeDownSettings {
  defaultEditor: boolean;
  fontFamily: string;
  fontSize: number;
  linkClickBehavior: 'navigateCurrentTab' | 'openNewTab' | 'showContextMenu';
  themeToggleScope: 'vscode' | 'editorOnly';
  editorTheme: 'auto' | 'light' | 'dark';
  autoReloadUnmodifiedFiles: boolean;
  renderMermaidDiagrams: boolean;
  markdownNormalization: 'preserve' | 'normalize';
  headingRename: {
    updateLinks: 'ask' | 'always' | 'never';
  };
  normalizationStyle: {
    boldMarker: '**' | '__';
    italicMarker: '*' | '_';
    listMarker: '-' | '*' | '+';
    headingStyle: 'atx' | 'setext';
  };
  imagePaste: ImagePasteSettings;
  imageResize: ImageResizeSettings;
  sidebar: SidebarSettings;
  wikilink: WikilinkSettings;
  spellCheck: SpellCheckSettings;
}

export interface SpellCheckSettings {
  /** Master switch. When off, the webview never loads a dictionary at all. */
  enabled: boolean;
  language: 'en' | 'en-GB';
  /** Skip fenced code blocks (incl. mermaid) and inline-code spans. */
  ignoreCodeBlocks: boolean;
  /** Custom dictionary, written by "Add to Dictionary" in the context menu.
   *  This is the only list MikeDown persists or lets the user edit. */
  userWords: string[];
  /** Words inherited read-only from other extensions (today: `cSpell.words`).
   *  Accepted by the checker but never shown in, or written back from, the
   *  MikeDown settings UI — otherwise saving would copy someone else's list
   *  into MikeDown's. */
  externalWords: string[];
}

export interface WikilinkSettings {
  /** Obsidian-style: Cmd/Ctrl+Click on an unresolved `[[Note]]` creates
   *  `Note.md` in the current document's folder and opens it. Default off. */
  createOnClick: boolean;
}

export interface SidebarSettings {
  visibility: 'always' | 'never';
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
    renderMermaidDiagrams: config.get<boolean>('renderMermaidDiagrams', true),
    markdownNormalization: config.get<'preserve' | 'normalize'>('markdownNormalization', 'preserve'),
    headingRename: {
      updateLinks: config.get<'ask' | 'always' | 'never'>('headingRename.updateLinks', 'ask'),
    },
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
    wikilink: {
      createOnClick: config.get<boolean>('wikilink.createOnClick', false),
    },
    spellCheck: {
      enabled: config.get<boolean>('spellCheck.enabled', false),
      language: config.get<'en' | 'en-GB'>('spellCheck.language', 'en') === 'en-GB' ? 'en-GB' : 'en',
      ignoreCodeBlocks: config.get<boolean>('spellCheck.ignoreCodeBlocks', true),
      ...readWordLists(config),
    },
    sidebar: {
      // Legacy 'remember' value collapses to 'never' — per-doc memory was
      // dropped when visibility went binary (pin on/off).
      visibility: config.get<string>('sidebar.visibility', 'never') === 'always' ? 'always' : 'never',
      width: config.get<number>('sidebar.width', 200),
      position: config.get<'left' | 'right'>('sidebar.position', 'right'),
    },
  };
}

function cleanWords(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const word of raw) {
    if (typeof word !== 'string') { continue; }
    const trimmed = word.trim();
    if (!trimmed) { continue; }
    const key = trimmed.toLowerCase();
    if (seen.has(key)) { continue; }
    seen.add(key);
    out.push(trimmed);
  }
  return out;
}

/**
 * Split the effective word list into MikeDown's own (editable, persisted) and
 * the words inherited from the Code Spell Checker extension (`cSpell.words`).
 * cSpell is read-only here — honouring it means a user who already curated a
 * word list doesn't have to build a second one, and keeping it in a separate
 * bucket stops MikeDown's settings UI from copying it into MikeDown's own list.
 * Exported for unit testing.
 */
export function splitWordLists(own: unknown, cspell: unknown): { userWords: string[]; externalWords: string[] } {
  const userWords = cleanWords(own);
  const ownKeys = new Set(userWords.map(w => w.toLowerCase()));
  const externalWords = cleanWords(cspell).filter(w => !ownKeys.has(w.toLowerCase()));
  return { userWords, externalWords };
}

function readWordLists(config: vscode.WorkspaceConfiguration): { userWords: string[]; externalWords: string[] } {
  let cspell: unknown = [];
  try {
    cspell = vscode.workspace.getConfiguration('cSpell').get<string[]>('words', []);
  } catch {
    // cSpell isn't installed — its config section simply isn't there.
  }
  return splitWordLists(config.get<string[]>('spellCheck.userWords', []), cspell);
}

export function onSettingsChange(callback: (settings: MikeDownSettings) => void): vscode.Disposable {
  return vscode.workspace.onDidChangeConfiguration((event) => {
    if (event.affectsConfiguration('mikedown')) {
      callback(getSettings());
    }
  });
}
