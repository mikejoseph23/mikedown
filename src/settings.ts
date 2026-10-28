import * as vscode from 'vscode';
import { parseHeadingNumbering, type HeadingNumbering } from '@mikedown/core/shared/headingNumbering';
import type { ImagePasteSettings } from '@mikedown/core/shared/imagePaste';
import { DEFAULT_LOCAL_NETWORKS, parseAiSettings, type AiSettings } from '@mikedown/core/ai';

export type { ImagePasteSettings };

export interface MikeDownSettings {
  defaultEditor: boolean;
  fontFamily: string;
  fontSize: number;
  ctrlWheelZoom: boolean;
  linkClickBehavior: 'navigateCurrentTab' | 'openNewTab' | 'showContextMenu';
  themeToggleScope: 'vscode' | 'editorOnly';
  editorTheme: 'auto' | 'light' | 'dark';
  autoReloadUnmodifiedFiles: boolean;
  renderMermaidDiagrams: boolean;
  renderMath: boolean;
  tags: TagSettings;
  markdownNormalization: 'preserve' | 'normalize';
  headingRename: {
    updateLinks: 'ask' | 'always' | 'never';
  };
  headingNumbering: HeadingNumbering;
  tocStyle: 'list' | 'placeholder';
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
  support: SupportSettings;
  slashCommands: SlashCommandsSettings;
  /** `mikedown.ai.*`, parsed. Never holds a secret (keys live in SecretStorage). */
  ai: AiSettings;
}

export interface TagSettings {
  /** Inline `#tag` highlighting, `#` autocomplete, and the sidebar Tags section. */
  enabled: boolean;
}

export interface SupportSettings {
  /** Show the "Support MikeDown" link in the sidebar footer (M6). */
  showSidebarLink: boolean;
}

export interface SlashCommandsSettings {
  enabled: boolean;
  dateFormat: 'iso' | 'long';
  /** `'local'` (default), `'UTC'`, or an IANA zone name. Never empty. */
  timeZone: string;
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


export interface ImageResizeSettings {
  overwrite: boolean;
}

export function getSettings(): MikeDownSettings {
  const config = vscode.workspace.getConfiguration('mikedown');
  return {
    defaultEditor: config.get<boolean>('defaultEditor', false),
    fontFamily: config.get<string>('fontFamily', ''),
    fontSize: config.get<number>('fontSize', 15),
    ctrlWheelZoom: config.get<boolean>('ctrlWheelZoom', true),
    linkClickBehavior: config.get<'navigateCurrentTab' | 'openNewTab' | 'showContextMenu'>('linkClickBehavior', 'openNewTab'),
    themeToggleScope: config.get<'vscode' | 'editorOnly'>('themeToggleScope', 'editorOnly'),
    editorTheme: config.get<'auto' | 'light' | 'dark'>('editorTheme', 'auto'),
    autoReloadUnmodifiedFiles: config.get<boolean>('autoReloadUnmodifiedFiles', true),
    renderMermaidDiagrams: config.get<boolean>('renderMermaidDiagrams', true),
    renderMath: config.get<boolean>('renderMath', true),
    tags: {
      enabled: config.get<boolean>('tags.enabled', true),
    },
    markdownNormalization: config.get<'preserve' | 'normalize'>('markdownNormalization', 'preserve'),
    headingRename: {
      updateLinks: config.get<'ask' | 'always' | 'never'>('headingRename.updateLinks', 'ask'),
    },
    headingNumbering: parseHeadingNumbering(config.get<string>('headingNumbering', 'off')),
    tocStyle: config.get<string>('tocStyle', 'list') === 'placeholder' ? 'placeholder' : 'list',
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
    support: {
      showSidebarLink: config.get<boolean>('support.showSidebarLink', true),
    },
    sidebar: {
      // Legacy 'remember' value collapses to 'never' — per-doc memory was
      // dropped when visibility went binary (pin on/off).
      visibility: config.get<string>('sidebar.visibility', 'never') === 'always' ? 'always' : 'never',
      width: config.get<number>('sidebar.width', 200),
      position: config.get<'left' | 'right'>('sidebar.position', 'right'),
    },
    slashCommands: {
      enabled: config.get<boolean>('slashCommands.enabled', true),
      dateFormat: config.get<'iso' | 'long'>('slashCommands.dateFormat', 'iso') === 'long' ? 'long' : 'iso',
      timeZone: config.get<string>('slashCommands.timeZone', 'local').trim() || 'local',
    },
    ai: readAiSettings(config),
  };
}

/** What `WorkspaceConfiguration.inspect` returns, reduced to the scopes MikeDown reads. */
export interface InspectedValue<T = unknown> {
  defaultValue?: T;
  globalValue?: T;
  workspaceValue?: T;
  workspaceFolderValue?: T;
}

/**
 * The raw `mikedown.ai` object, with the scope rules applied (OPEN-3):
 *
 * - `engines` and `localNetworks` come from user settings only, so a
 *   repository can neither add an endpoint nor make a cloud host count as
 *   local. package.json scopes them `machine`; this is the second fence.
 * - `allowCloud` can be turned off by a workspace but never on.
 * - `enabled`, `routing`, `features` and `showToolbarButton` follow the
 *   normal precedence.
 *
 * Exported for unit testing.
 */
export function effectiveAiRaw(inspect: (key: string) => InspectedValue | undefined): Record<string, unknown> {
  const effective = (key: string): unknown => {
    const i = inspect(key);
    return i?.workspaceFolderValue ?? i?.workspaceValue ?? i?.globalValue ?? i?.defaultValue;
  };
  const cloud = inspect('allowCloud');
  const workspaceCloud = cloud?.workspaceFolderValue ?? cloud?.workspaceValue;
  return {
    enabled: effective('enabled'),
    allowCloud: cloud?.globalValue === true && workspaceCloud !== false,
    engines: inspect('engines')?.globalValue ?? [],
    routing: effective('routing'),
    features: effective('features'),
    localNetworks: inspect('localNetworks')?.globalValue ?? [...DEFAULT_LOCAL_NETWORKS],
    showToolbarButton: effective('showToolbarButton'),
  };
}

/**
 * Deterministic id for an engine saved without one (hand-written in
 * settings.json): its name plus its position, so every parse gives the same
 * id until the engine service writes it back. Exported for unit testing.
 */
export function stableEngineIdGenerator(): (name: string) => string {
  let n = 0;
  return (name: string) => {
    const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 24) || 'engine';
    let h = 0x811c9dc5;
    for (const ch of `${name}#${n++}`) {
      h ^= ch.charCodeAt(0);
      h = Math.imul(h, 0x01000193) >>> 0;
    }
    return `${slug}-${h.toString(36)}`;
  };
}

const seenAiWarnings = new Set<string>();

function readAiSettings(config: vscode.WorkspaceConfiguration): AiSettings {
  const raw = effectiveAiRaw((key) => config.inspect(`ai.${key}`));
  return parseAiSettings(raw, {
    generateId: stableEngineIdGenerator(),
    // getSettings runs on every broadcast; say each problem once.
    onWarning: (m) => {
      if (seenAiWarnings.has(m)) {return;}
      seenAiWarnings.add(m);
      console.warn(`MikeDown AI settings: ${m}`);
    },
  });
}

function cleanWords(raw: unknown): string[] {
  if (!Array.isArray(raw)) {return [];}
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
