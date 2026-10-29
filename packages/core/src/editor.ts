/**
 * createMikeDownEditor — the editor factory.
 *
 * Builds the editor's DOM inside `container` (toolbar, WYSIWYG surface,
 * source view, optional sidebar) without ids, so several editors can share
 * a page, and wires it to the host adapter in `options.host`. Nothing in
 * here talks to VS Code: every outside effect is a `MikeDownHost` call, and
 * every push from the host arrives through the returned handle.
 *
 * TipTap (ProseMirror) renders the WYSIWYG surface with tiptap-markdown for
 * parse/serialize; CodeMirror 6 is the source view (Cmd+/).
 */
import { Editor, Extension, mergeAttributes, posToDOMRect } from '@tiptap/core';
import { Selection, TextSelection, EditorState as PmEditorState } from '@tiptap/pm/state';
import { undoDepth as pmUndoDepth, closeHistory } from '@tiptap/pm/history';
import { StarterKit } from '@tiptap/starter-kit';
import { TaskList } from '@tiptap/extension-task-list';
import { DraggableTaskItem as TaskItem } from './taskitem-drag';
import { TableRow } from '@tiptap/extension-table-row';
import { TableAligned, TableCellAligned, TableHeaderAligned } from './table-align';
import { LinkWithAutolink, shouldAutolinkText } from './linkAutolink';
import { Image } from '@tiptap/extension-image';
import { Placeholder } from '@tiptap/extension-placeholder';
import { Markdown } from 'tiptap-markdown';
import { MarkdownText, MarkdownHardBreak } from './markdownText';
import { SourceModeSync } from './sourceSync';
import { CodeBlockLowlight } from '@tiptap/extension-code-block-lowlight';
import { createLowlight, all } from 'lowlight';
import { SmartPasteExtension } from './smartpaste';
import { PlainPasteExtension, requestPlainPaste } from './plainpaste';
import { ImagePasteExtension, insertImageAt } from './imagepaste';
import { TableCheckboxExtension } from './tablecheckbox';
import { HtmlAnchor } from './htmlanchor';
import { Emoji } from './emoji';
import { EmojiAutocomplete } from './emojiautocomplete';
import { Highlight } from './highlight';
import { TagDecorator, setTagsEnabled } from './tag';
import { TagAutocomplete, receiveTagCandidates, setTagCandidateRequester } from './tagautocomplete';
import { extractTags } from './shared/tagExtract';
import { Callout, CALLOUT_KINDS, type CalloutKind } from './callout-node';
import { Wikilink } from './wikilink-node';
import { WikilinkAutocomplete, receiveWikilinkCandidates, setWikilinkCandidateRequester } from './wikilinkautocomplete';
import { SlashCommands, closeSlashMenu, setSlashFrontmatterProvider, setSlashDisableHandler, setSlashHiddenCommands, setSlashSourceMode, setSlashCommandsConfig } from './slashcommands';
import { initSlashCommandActions } from './slashcommands-actions';
import { AI_SLASH_COMMANDS } from './slashcommands-registry';
import { MermaidPreview, setMermaidEnabled, refreshMermaidTheme } from './mermaid';
import { MathInline, MathBlock, setMathRenderingEnabled } from './math';
import { FootnoteRef, FootnoteDef } from './footnote';
import { TableOfContents, syncTableOfContents, TOC_DISPLAY_ONLY_META } from './toc-node';
import { parseTocStyle, type TocStyle } from './toc';
import { createOutlineSidebar, type OutlineSidebar, type SuggestPropertiesAvailability } from './outlineSidebar';
import { FrontmatterHistory, frontmatterAfterTransition, frontmatterEditTransaction } from './frontmatterHistory';
import { mergePropertySuggestion, type PropertySuggestionPick } from './propertySuggestions';
import {
  parseFrontmatter,
  serializeFrontmatter,
  isSimpleFrontmatter,
  type ParsedEntry,
} from './shared/frontmatterYaml';
import { countWords } from './shared/wordCount';
import {
  FindReplaceExtension, updateSearch, clearSearch, findNext, findPrev,
  replaceCurrentMatch, replaceAllMatches,
  cmFindReplaceExtension, cmUpdateSearch, cmClearSearch, cmFindNext, cmFindPrev,
  cmReplaceCurrent, cmReplaceAll,
} from './findreplace';
import { showContextMenu, hideContextMenu, buildTextMenu, buildLinkMenu, buildTableMenu, buildImageMenu, buildCodeBlockMenu, buildSpellingMenu, type ContextMenuActions } from './contextmenu';
import {
  SpellCheckExtension, configureSpellCheck, getMisspellingAt, getSuggestions,
  addWordToDictionary, ignoreWord,
  buildDictionaryView, removeWordFromList, addWordToList,
  setSpellCheckDictionaryBase,
  type SpellCheckLanguage,
} from './spellcheck';
import { showTableGridPicker, hideTableGridPicker, updateTableToolbar, hideTableToolbar } from './tablepicker';
import { initTableDrag, clearCellSelection } from './tabledrag';
import { locateInSource, findInDoc } from './revealText';
import { initLinkAutocomplete, receiveSuggestions, receiveFileHeadings, destroyLinkAutocomplete, isDropdownActive, collectDocLinks, type LinkSuggestion } from './linkautocomplete';
import { showToolbarDropdown, hideToolbarDropdown, isToolbarDropdownOpen, updateDropdownActiveStates, type ToolbarDropdownEntry } from './toolbar-dropdown';
import { layoutToolbarOverflow } from './toolbar-overflow';
import { DEFAULT_TOOLBAR_ITEMS, TOOLBAR_ITEM_IDS, type ToolbarLayoutToken } from './toolbar-ids';
import { resolveToolbarLayout } from './toolbar-layout';
import { renderToolbar, resolveToolbarTokens, type ToolbarItemDef } from './toolbar-registry';
import { enterToolbarEditMode as startToolbarEditMode, type ToolbarEditSession } from './toolbar-customize';
import { showLanguagePicker } from './languagepicker';
import { showEmojiPicker, hideEmojiPicker, isEmojiPickerOpen } from './emojipicker';
import { resolveImageRenderSrc } from './imageSrcPolicy';
import { unresolveSrcForDisplay, resolveSrcForEditor, type ImagePathPrefix } from './shared/imageDisplayPath';
import { githubAnchorId } from './shared/anchoring';
import {
  applyPrefixEdit,
  isNumbered,
  parseHeadingNumbering,
  renumberEdits,
  stripEdits,
  type HeadingInfo,
  type HeadingNumbering,
  type PrefixEdit,
} from './shared/headingNumbering';
import { detectHeadingRename, isRenameAmbiguous } from './headingRename';
import { MIKEDOWN_HOTKEYS } from './hotkeys';
import type { MikeDownHost, LinkOpenBehavior, BacklinkItem } from './host';
import {
  CHARS_PER_TOKEN, DEFAULT_CONTEXT_TOKENS, PROPERTY_VOCABULARY_MAX, aiErrorCopy, aiLengthLimitCopy, budgetDocument, buildPropertiesMessages,
  defaultAiSettings, headingsOutline, isRouteUsable, jsonRepairMessages, makeAiError, parseAiSettings,
  parsePropertySuggestions, propertiesMaxTokens, renderHeadingOutline, resolveRoute, rewriteVisibleText, toAiError,
  type AiSummaryKind,
} from './ai';
import type { AiEngineStatus, AiMessage, AiRouteOk, AiServedBy, AiSettings, AiSettingsPatch, MikeDownAiHost } from './ai';
import { sessionThinkingLevel } from './ai-prefs';
import { buildAiSettingsSection } from './ai-settings';
import { mountAiEnginesPage } from './ai-engines-page';
import type { AiEnginesPageHandle, AiEnginesPageSection } from './ai-engines-page';
import { withSavedAiKeys } from './ai-settings-session';
import type { AiSettingsSessionOptions } from './ai-settings-session';
import { makeCheckboxRow, makeGroup, makeRow, makeSelectRow, settingsSectionContext } from './settings-rows';
import { aiHostTier, aiIndicatorState } from './ai-settings-model';
import { experimentalBadge } from './ai-settings-dom';
import {
  AI_TURN_ON_PATCH, aiSetupTarget, aiToolbarButtonMode, aiToolbarMenuEntries,
  hideAiFirstRunPanel, isAiFirstRunPanelOpen, showAiFirstRunPanel,
} from './ai-toolbar';
import { aiFeatureAvailability, aiRunThinkingOn, runAiCompletion, type AiFeatureAvailability, type AiRunOutcome } from './ai-request';
import {
  AiRewriteHighlight, aiRewriteMenuGroups, applyRichTitle, applySourceTitle, cmAiRewriteHighlight, createAiRewriteBubble,
  createAiRewritePopover, cursorInsertTarget, richDocumentTarget, richRewriteTarget, setYamlTitle, sourceCursorTarget,
  sourceDocumentTarget, sourceRewriteTarget, yamlHasTitle, type AiCursorTarget, type AiRewriteBadge,
  type AiRewriteTarget, type AiTitleEffect,
} from './ai-rewrite';
import type { AiRewriteParams, AiRewriteVariant } from './ai/prompts/rewrite';
import type {
  MikeDownEditorHandle,
  MikeDownEvent,
  MikeDownFeatures,
  MikeDownOptions,
  MikeDownSettings,
  MikeDownSettingsSection,
  MikeDownSettingsSectionContext,
  MikeDownViewState,
  NormalizationStyle,
  SidebarFooterLink,
  SidebarStateUpdate,
} from './types';
import { DEFAULT_FEATURES } from './types';

// ── CodeMirror 6 — Source Mode (M4) ───────────────────────────────────────────
import { Compartment, EditorState, Transaction as CmTransaction, type Extension as CmExtension } from '@codemirror/state';
import { EditorView, keymap, lineNumbers, highlightActiveLine } from '@codemirror/view';
import { defaultKeymap, historyKeymap, history, undo as cmUndo, redo as cmRedo } from '@codemirror/commands';
import { markdown as cmMarkdown, markdownLanguage } from '@codemirror/lang-markdown';
import { syntaxHighlighting, defaultHighlightStyle } from '@codemirror/language';
import { oneDarkHighlightStyle } from '@codemirror/theme-one-dark';
import { createFontZoom, installWheelZoom, DEFAULT_FONT_SIZE, WHEEL_ZOOM_MIN, WHEEL_ZOOM_MAX } from './wheelZoom';

/** The structural elements every editor instance owns. */
export interface EditorShell {
  root: HTMLElement;
  toolbar: HTMLElement | null;
  sidebar: HTMLElement | null;
  sidebarToggle: HTMLButtonElement | null;
  editorContainer: HTMLElement;
  sourceContainer: HTMLElement;
}

/** Resolve feature flags against the defaults. */
export function resolveFeatures(partial?: Partial<MikeDownFeatures>): MikeDownFeatures {
  return { ...DEFAULT_FEATURES, ...(partial ?? {}) };
}

/**
 * Build the editor DOM inside `container`. Elements are found again by class
 * (`.mikedown-toolbar`, `.mikedown-editor-container`, ...) scoped to the root,
 * never by id.
 */
export function buildEditorShell(container: HTMLElement, features: MikeDownFeatures, landmark = true): EditorShell {
  const root = document.createElement('div');
  root.className = 'mikedown-root';
  root.setAttribute('data-mikedown-root', '');

  let toolbar: HTMLElement | null = null;
  if (features.toolbar) {
    toolbar = document.createElement('div');
    toolbar.className = 'mikedown-toolbar';
    toolbar.setAttribute('role', 'toolbar');
    toolbar.setAttribute('aria-label', 'Formatting toolbar');
    root.appendChild(toolbar);
  } else {
    root.classList.add('mikedown-no-toolbar');
  }

  let sidebar: HTMLElement | null = null;
  let sidebarToggle: HTMLButtonElement | null = null;
  if (features.sidebar) {
    sidebar = document.createElement('aside');
    sidebar.className = 'mikedown-outline-sidebar';
    sidebar.setAttribute('aria-label', 'Document sidebar');
    sidebar.hidden = true;
    sidebarToggle = document.createElement('button');
    sidebarToggle.type = 'button';
    sidebarToggle.className = 'mikedown-outline-toggle';
    sidebarToggle.setAttribute('aria-label', 'Show sidebar');
    sidebarToggle.title = 'Show sidebar';
    sidebarToggle.setAttribute('aria-expanded', 'false');
    root.append(sidebar, sidebarToggle);
  }

  const editorContainer = document.createElement('div');
  editorContainer.className = 'mikedown-editor-container';
  if (landmark) {
    editorContainer.setAttribute('role', 'main');
    editorContainer.setAttribute('aria-label', 'Markdown editor');
  }

  const sourceContainer = document.createElement('div');
  sourceContainer.className = 'mikedown-source-container';
  sourceContainer.style.display = 'none';

  root.append(editorContainer, sourceContainer);
  container.appendChild(root);

  return { root, toolbar, sidebar, sidebarToggle, editorContainer, sourceContainer };
}

import { getPortal, setPortalSource, releasePortalSource, syncPortal } from './portal';
import { isDarkScheme } from './theme';

const lowlight = createLowlight(all);
// Reinitialize the PM state with the current doc and plugins so the undo
// history starts empty. Called after full-document loads (initial open,
// external reloads, and source→WYSIWYG switch with changes) so the first
// Cmd+Z doesn't revert the document to blank.
function resetPmHistory(editor: Editor): void {
  // Place the selection at the start of the doc instead of preserving it —
  // TipTap's setContent leaves the cursor at the end of the document, and a
  // subsequent `.focus()` (e.g. from the toolbar Undo button) would scroll
  // the viewport to the bottom on an otherwise no-op undo.
  const { doc } = editor.state;
  const startSel = TextSelection.atStart(doc);
  editor.view.updateState(
    PmEditorState.create({
      doc,
      plugins: editor.state.plugins,
      selection: startSel,
    })
  );
}

// ── M15: Frontmatter helpers ───────────────────────────────────────────────────

function extractFrontmatter(markdown: string): { frontmatter: string | null; body: string } {
  // Match YAML frontmatter: --- at start of file (with optional BOM)
  const match = markdown.match(/^(?:---\n)([\s\S]*?)\n---\n?/);
  if (match) {
    return { frontmatter: match[1], body: markdown.slice(match[0].length) };
  }
  return { frontmatter: null, body: markdown };
}

/**
 * Reduce GFM table rows in a markdown prefix to the text ProseMirror's
 * `textBetween(…, '\n')` gives for the same cells: delimiter rows dropped,
 * outer pipes removed, each cell boundary a newline. Used to map the source
 * caret back into the rich view. On the last (partial) line a trailing pipe
 * is a boundary too, so a caret just past it lands in the next cell.
 */
function stripTableSyntax(prefix: string): string {
  const lines = prefix.split('\n');
  const out: string[] = [];
  lines.forEach((line, i) => {
    if (!/^[ \t]*\|/.test(line)) { out.push(line); return; }
    if (/^[ \t]*\|?[ \t]*:?-+:?[ \t]*(\|[ \t]*:?-+:?[ \t]*)*\|?[ \t]*$/.test(line)) {return;}
    let row = line.replace(/^[ \t]*\|[ \t]*/, '');
    if (i < lines.length - 1) {row = row.replace(/[ \t]*(?<!\\)\|[ \t]*$/, '');}
    out.push(row.replace(/[ \t]*(?<!\\)\|[ \t]*/g, '\n'));
  });
  return out.join('\n');
}

function restoreFrontmatter(frontmatter: string | null, body: string): string {
  if (frontmatter === null) {return body;}
  return `---\n${frontmatter}\n---\n${body}`;
}

/** Renders a package.json key chord ("ctrl+shift+s") as "Ctrl+Shift+S". */
function formatHotkeyChord(chord: string): string {
  return chord
    .split('+')
    .map(part => (part.length === 1 ? part.toUpperCase() : part.charAt(0).toUpperCase() + part.slice(1)))
    .join('+');
}

// ── Toolbar icons (shared across all toolbar modes) ─────────────────────────

const toolbarSvg = (d: string, sw = 1.8) => `<svg aria-hidden="true" focusable="false" width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="${sw}" stroke-linecap="round" stroke-linejoin="round">${d}</svg>`;
const toolbarIcons = {
  bold: toolbarSvg('<path d="M4 2.5h5a3 3 0 0 1 0 6H4zM4 8.5h6a3 3 0 0 1 0 6H4z" fill="none"/>', 2),
  italic: toolbarSvg('<line x1="10" y1="2" x2="6" y2="14"/><line x1="7" y1="2" x2="12" y2="2"/><line x1="4" y1="14" x2="9" y2="14"/>'),
  strike: toolbarSvg('<line x1="2" y1="8" x2="14" y2="8"/><path d="M10.5 3H6.5a2.5 2.5 0 0 0 0 5h3a2.5 2.5 0 0 1 0 5H5"/>'),
  highlight: toolbarSvg('<path d="M4 12h8" stroke-width="2.4"/><path d="M5 9.5l2-6h2l2 6"/><line x1="6" y1="7" x2="10" y2="7"/>'),
  code: toolbarSvg('<polyline points="5 4 2 8 5 12"/><polyline points="11 4 14 8 11 12"/>'),
  ul: toolbarSvg('<line x1="6" y1="4" x2="14" y2="4"/><line x1="6" y1="8" x2="14" y2="8"/><line x1="6" y1="12" x2="14" y2="12"/><circle cx="3" cy="4" r="1" fill="currentColor" stroke="none"/><circle cx="3" cy="8" r="1" fill="currentColor" stroke="none"/><circle cx="3" cy="12" r="1" fill="currentColor" stroke="none"/>'),
  ol: toolbarSvg('<line x1="6" y1="4" x2="14" y2="4"/><line x1="6" y1="8" x2="14" y2="8"/><line x1="6" y1="12" x2="14" y2="12"/><text x="2" y="5.5" font-size="5" fill="currentColor" stroke="none" font-family="sans-serif">1</text><text x="2" y="9.5" font-size="5" fill="currentColor" stroke="none" font-family="sans-serif">2</text><text x="2" y="13.5" font-size="5" fill="currentColor" stroke="none" font-family="sans-serif">3</text>'),
  task: toolbarSvg('<rect x="2" y="4" width="5" height="5" rx="1"/><polyline points="3.5 6.5 4.5 7.5 6 5.5"/><line x1="9" y1="5" x2="14" y2="5"/><line x1="9" y1="9" x2="14" y2="9"/><line x1="9" y1="13" x2="12" y2="13"/>'),
  quote: toolbarSvg('<line x1="3" y1="3" x2="3" y2="13"/><line x1="6" y1="5" x2="13" y2="5"/><line x1="6" y1="8" x2="13" y2="8"/><line x1="6" y1="11" x2="10" y2="11"/>'),
  callout: toolbarSvg('<rect x="2" y="3" width="12" height="10" rx="1.5"/><line x1="5" y1="6.5" x2="11" y2="6.5"/><line x1="5" y1="9.5" x2="9" y2="9.5"/><circle cx="3.5" cy="6.5" r="0.6" fill="currentColor" stroke="none"/><circle cx="3.5" cy="9.5" r="0.6" fill="currentColor" stroke="none"/>'),
  codeBlock: toolbarSvg('<rect x="2" y="2" width="12" height="12" rx="2"/><polyline points="5.5 5.5 4 8 5.5 10.5"/><polyline points="10.5 5.5 12 8 10.5 10.5"/>'),
  link: toolbarSvg('<path d="M6.5 9.5l3-3"/><path d="M9 5l1.5-1.5a2.12 2.12 0 0 1 3 3L12 8"/><path d="M7 11l-1.5 1.5a2.12 2.12 0 0 1-3-3L4 8"/>'),
  image: toolbarSvg('<rect x="2" y="3" width="12" height="10" rx="1.5"/><circle cx="5.5" cy="6.5" r="1.2" fill="currentColor" stroke="none"/><polyline points="14 10.5 10.5 7 6 11.5 4.5 10 2 12.5"/>'),
  table: toolbarSvg('<rect x="2" y="2" width="12" height="12" rx="1.5"/><line x1="2" y1="6" x2="14" y2="6"/><line x1="2" y1="10" x2="14" y2="10"/><line x1="6" y1="2" x2="6" y2="14"/><line x1="10" y1="2" x2="10" y2="14"/>'),
  hr: toolbarSvg('<line x1="2" y1="8" x2="14" y2="8"/><circle cx="5" cy="8" r="0.5" fill="currentColor" stroke="none"/><circle cx="8" cy="8" r="0.5" fill="currentColor" stroke="none"/><circle cx="11" cy="8" r="0.5" fill="currentColor" stroke="none"/>'),
  toc: toolbarSvg('<line x1="2" y1="4" x2="14" y2="4"/><line x1="5" y1="8" x2="14" y2="8"/><line x1="8" y1="12" x2="14" y2="12"/><circle cx="2.5" cy="8" r="0.6" fill="currentColor" stroke="none"/><circle cx="5.5" cy="12" r="0.6" fill="currentColor" stroke="none"/>'),
  undo: toolbarSvg('<polyline points="4 7 2 5 4 3"/><path d="M2 5h8a4 4 0 0 1 0 8H7"/>'),
  redo: toolbarSvg('<polyline points="12 7 14 5 12 3"/><path d="M14 5H6a4 4 0 0 0 0 8h3"/>'),
  source: toolbarSvg('<polyline points="5 4 2 8 5 12"/><polyline points="11 4 14 8 11 12"/><line x1="9" y1="3" x2="7" y2="13"/>'),
  gear: `<svg aria-hidden="true" focusable="false" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"/><circle cx="12" cy="12" r="3"/></svg>`,
  diff: toolbarSvg('<path d="M4 3v10"/><path d="M12 3v10"/><path d="M7 5h2" stroke-opacity="0.5"/><path d="M7 8h2"/><path d="M7 11h2" stroke-opacity="0.5"/>'),
  sun: toolbarSvg('<circle cx="8" cy="8" r="3"/><path d="M8 1.5v1.5M8 13v1.5M1.5 8H3M13 8h1.5M3.4 3.4l1.06 1.06M11.54 11.54l1.06 1.06M3.4 12.6l1.06-1.06M11.54 4.46l1.06-1.06"/>'),
  moon: toolbarSvg('<path d="M13.5 8a5.5 5.5 0 0 1-8.38 4.68A5.5 5.5 0 0 1 8 2.5c0 .5.05 1 .16 1.47A4.5 4.5 0 0 0 13.5 8z"/>'),
  chevron: toolbarSvg('<polyline points="5 6.5 8 9.5 11 6.5"/>', 1.6),
  print: toolbarSvg('<path d="M4 6V2h8v4"/><rect x="2" y="6" width="12" height="6" rx="1"/><rect x="4" y="10" width="8" height="4"/><circle cx="12" cy="8" r="0.5" fill="currentColor" stroke="none"/>'),
  browser: toolbarSvg('<rect x="1.5" y="2.5" width="13" height="11" rx="1.5"/><line x1="1.5" y1="6" x2="14.5" y2="6"/><circle cx="3.5" cy="4.25" r="0.5" fill="currentColor" stroke="none"/><circle cx="5" cy="4.25" r="0.5" fill="currentColor" stroke="none"/><circle cx="6.5" cy="4.25" r="0.5" fill="currentColor" stroke="none"/>'),
  selectAll: toolbarSvg('<rect x="2" y="2" width="12" height="12" rx="1" stroke-dasharray="2 1.5"/><rect x="5" y="5" width="6" height="6" fill="currentColor" stroke="none"/>'),
  share: toolbarSvg('<path d="M8 2v9"/><polyline points="5 5 8 2 11 5"/><path d="M3.5 8.5v4a1 1 0 0 0 1 1h7a1 1 0 0 0 1-1v-4"/>'),
  headingNumbers: toolbarSvg('<text x="8" y="11.5" text-anchor="middle" font-size="8" font-weight="700" fill="currentColor" stroke="none" font-family="sans-serif">1.2</text>', 0),
  zoomIn: toolbarSvg('<circle cx="7" cy="7" r="4.5"/><line x1="10.2" y1="10.2" x2="14" y2="14"/><line x1="5" y1="7" x2="9" y2="7"/><line x1="7" y1="5" x2="7" y2="9"/>'),
  zoomOut: toolbarSvg('<circle cx="7" cy="7" r="4.5"/><line x1="10.2" y1="10.2" x2="14" y2="14"/><line x1="5" y1="7" x2="9" y2="7"/>'),
  more: toolbarSvg('<circle cx="3.5" cy="8" r="1.2" fill="currentColor" stroke="none"/><circle cx="8" cy="8" r="1.2" fill="currentColor" stroke="none"/><circle cx="12.5" cy="8" r="1.2" fill="currentColor" stroke="none"/>'),
  ai: toolbarSvg('<path d="M7 2.5l1.25 3.25L11.5 7 8.25 8.25 7 11.5 5.75 8.25 2.5 7l3.25-1.25z"/><path d="M12.5 10v3.5M10.75 11.75h3.5"/>', 1.5),
  rewrite: toolbarSvg('<path d="M10.5 2.5l3 3L6 13H3v-3z"/><path d="M9 4l3 3"/>', 1.5),
  emoji: toolbarSvg('<circle cx="8" cy="8" r="6"/><circle cx="6" cy="6.5" r="0.6" fill="currentColor" stroke="none"/><circle cx="10" cy="6.5" r="0.6" fill="currentColor" stroke="none"/><path d="M5.5 9.5c.7 1.2 1.7 1.8 2.5 1.8s1.8-.6 2.5-1.8"/>'),
};

// ── Callout helpers ────────────────────────────────────────────────────────────
// Tiny utilities shared by the toolbar Lists & Blocks dropdown and the
// editor-canvas right-click menu so both surface the five GFM kinds the
// same way.

const CALLOUT_KIND_LABEL: Record<CalloutKind, string> = {
  note: 'Note',
  tip: 'Tip',
  important: 'Important',
  warning: 'Warning',
  caution: 'Caution',
};

const CALLOUT_KIND_ICON_CHAR: Record<CalloutKind, string> = {
  note: 'i',
  tip: '★',
  important: '!',
  warning: '!',
  caution: '×',
};

function calloutKindLabel(kind: CalloutKind): string {
  return CALLOUT_KIND_LABEL[kind];
}

function calloutBadgeIcon(kind: CalloutKind): string {
  // Render each kind as a small colored circle badge with a glyph so the
  // mini-row reads at a glance ("blue ⓘ", "amber ⚠", etc.) without needing
  // a separate dropdown level.
  const char = CALLOUT_KIND_ICON_CHAR[kind];
  return `<span class="mikedown-callout-badge mikedown-callout-badge--${kind}" aria-hidden="true">${char}</span>`;
}

// Editing actions disabled in source mode — the WYSIWYG operates on the
// (hidden) ProseMirror doc, so firing these while CodeMirror is showing would
// mutate the wrong view. Anything that produces a doc change belongs here.
const SOURCE_MODE_DISABLED_ACTIONS = new Set([
  'textFormat', 'listBlock', 'link', 'insert',           // condensed dropdowns
  'bold', 'italic', 'strike', 'highlight', 'code', 'emoji',
  'h1', 'h2', 'h3',
  'bulletList', 'orderedList', 'taskList', 'blockquote', 'codeBlock',
  'image', 'table', 'hr', 'headingNumbers',
]);

// ── Select-all helper ─────────────────────────────────────────────────────────
//
// Selects the entire rendered document as a plain TextSelection so Cmd+C
// copies rendered HTML to the clipboard. We deliberately do NOT use
// `editor.commands.selectAll()` (or PM's `Mod-a` keymap, which calls the
// same thing): that command builds an `AllSelection`, which round-trips
// badly through ProseMirror's DOM-sync pipeline inside the VS Code webview
// and ends up collapsed inside the first heading.
//
// ⚠️ `TextSelection.create(doc, 0, doc.content.size)` is ALSO broken:
// `TextSelection` endpoints must point into a textblock (a node with
// `inlineContent: true`). Positions 0 and doc.content.size point at the
// top-level `doc` node's boundary, which is NOT inline content. Passing
// them to `TextSelection.create` produces the warning
// `"TextSelection endpoint not pointing into a node with inline content
// (doc)"` and a malformed selection. PM's view then can't DOM-sync it
// cleanly, PM's own MutationObserver fires on the class churn from
// `view.update()`, `readDOMChange` re-parses the broken DOM selection
// and collapses everything to (1, 1). One frame of flash, then caret
// lands in the first H1.
//
// The right way: use `Selection.atStart(doc)` / `Selection.atEnd(doc)` to
// walk the doc to the first and last valid inline cursor positions, then
// build a `TextSelection` between them. Those positions are guaranteed to
// sit inside textblocks, so PM can represent them in the DOM and the
// MutationObserver round-trip is a no-op.
function selectAllDocument(editor: Editor): void {
  const { state, view } = editor;
  const start = Selection.atStart(state.doc);
  const end = Selection.atEnd(state.doc);
  const tr = state.tr.setSelection(new TextSelection(start.$from, end.$to));
  view.dispatch(tr);
  view.focus();
}


export function createMikeDownEditor(container: HTMLElement, options: MikeDownOptions): MikeDownEditorHandle {
  const host: MikeDownHost = options.host;
  /** True when the host binds Mod-/ itself (VS Code keybinding). */
  const hostOwnsShortcuts = options.hostOwnsShortcuts === true;
  const features = resolveFeatures(options.features);
  const shell = buildEditorShell(container, features, options.landmark !== false);
  /** Accessible name and id for the editable surface (rich and source view). */
  const surfaceAttrs: Record<string, string> = {};
  if (options.id) {surfaceAttrs.id = options.id;}
  if (options.ariaLabelledBy) {surfaceAttrs['aria-labelledby'] = options.ariaLabelledBy;}
  surfaceAttrs['aria-label'] = options.ariaLabel || (options.ariaLabelledBy ? '' : 'Document text');
  if (!surfaceAttrs['aria-label']) {delete surfaceAttrs['aria-label'];}
  const { root, editorContainer, sourceContainer } = shell;

  // ── Teardown bookkeeping ───────────────────────────────────────────────────
  // Every listener on window/document, observer and timer this instance owns
  // is registered here so destroy() can undo it.
  const disposers: Array<() => void> = [];
  function listen<E extends Event>(
    target: EventTarget,
    type: string,
    fn: (event: E) => void,
    opts?: boolean | AddEventListenerOptions,
  ): void {
    const listener = fn as EventListener;
    target.addEventListener(type, listener, opts);
    disposers.push(() => target.removeEventListener(type, listener, opts));
  }
  function observe(mo: MutationObserver, target: Node, init: MutationObserverInit): void {
    mo.observe(target, init);
    disposers.push(() => mo.disconnect());
  }

  // ── Per-instance CSS state ─────────────────────────────────────────────────
  // Theme, fonts and widths are set on this editor's .mikedown-root (never on
  // <html>/<body>) so two editors on a page stay independent. Overlays in the
  // shared portal mirror the focused editor's values.
  function setRootVar(name: string, value: string): void {
    root.style.setProperty(name, value);
    syncPortal();
  }
  // Light until options.theme / settings.editorTheme say otherwise.
  root.setAttribute('data-mikedown-theme', 'light');
  setPortalSource(root);
  listen(root, 'focusin', () => setPortalSource(root));
  listen(root, 'pointerdown', () => setPortalSource(root));
  disposers.push(() => releasePortalSource(root));

  // ── Events ─────────────────────────────────────────────────────────────────
  const eventListeners = new Map<MikeDownEvent, Set<(...args: any[]) => void>>();
  function emit(event: MikeDownEvent, ...args: unknown[]): void {
    eventListeners.get(event)?.forEach((fn) => {
      try { fn(...args); } catch (err) { console.error('MikeDown: event listener failed —', err); }
    });
  }

  /** Every document change goes to the host and to `on('change')` listeners. */
  function notifyChange(markdown: string, meta: { pristine: boolean }): void {
    host.onChange(markdown, meta);
    emit('change', markdown, meta);
  }

  // ── Feature availability (feature flag AND the host method it needs) ───────
  const spellcheckAvailable = features.spellcheck && !!options.spellcheckDictionaryUrl;
  const tagsAvailable = !!host.getTags;
  setSpellCheckDictionaryBase(spellcheckAvailable ? options.spellcheckDictionaryUrl ?? '' : '');
  const hiddenSlashCommands: string[] = [];
  if (!host.pickImage) {hiddenSlashCommands.push('image');}
  if (!features.sidebar) {hiddenSlashCommands.push('properties');}
  // The AI group stays hidden until syncAiSlashCommands knows the AI state.
  setSlashHiddenCommands([...hiddenSlashCommands, ...AI_SLASH_COMMANDS.summary, ...AI_SLASH_COMMANDS.title]);

  // Find bar entry points (wired by buildFindReplaceBar when the feature is on).
  let openFindBar: (replace?: boolean) => void = () => {};
  let resyncFind: () => void = () => {};

  /**
   * Open a link through the host. Without `host.openLink`, external links open
   * in a new browser tab and everything else is ignored.
   */
  function openLinkViaHost(href: string, behavior?: LinkOpenBehavior): void {
    if (host.openLink) {
      host.openLink(href, behavior);
      return;
    }
    if (/^(https?:|mailto:|tel:)/i.test(href)) {
      window.open(href, '_blank', 'noopener');
    }
  }

  /** Fetch workspace link suggestions and feed both autocompletes. */
  function requestLinkSuggestions(): void {
    host.getLinkSuggestions?.().then(applyLinkSuggestions, () => { /* host failed: keep in-doc links only */ });
  }

  /** Link dialog autocomplete + `[[` wikilink candidates from one suggestion list. */
  function applyLinkSuggestions(list: LinkSuggestion[]): void {
    receiveSuggestions(list);
    // Also feed the wikilink autocomplete: file suggestions only, mapped to
    // bare basenames without the .md/.markdown extension, deduped.
    const rawSuggestions = (list || []) as Array<{ label: string; type: string }>;
    const seen = new Set<string>();
    const wikiNames: string[] = [];
    for (const s of rawSuggestions) {
      if (!s || s.type !== 'file' || typeof s.label !== 'string') {continue;}
      const base = s.label.replace(/^.*[\\/]/, '').replace(/\.(md|markdown)$/i, '');
      if (seen.has(base)) {continue;}
      seen.add(base);
      wikiNames.push(base);
    }
    receiveWikilinkCandidates(wikiNames);
  }

  const linkSuggestionSources = {
    requestSuggestions: requestLinkSuggestions,
    requestFileHeadings: (filePath: string) => {
      host.getFileHeadings?.(filePath).then(receiveFileHeadings, () => { /* missing file: no anchors */ });
    },
  };

  // Slash menu "Turn off slash commands": persist with the slashMenu source so
  // the host shows its Open Settings / Undo toast.
  setSlashDisableHandler(() => {
    currentSlashCommandsEnabled = false;
    host.saveSettings?.({ slashCommandsEnabled: false }, { source: 'slashMenu' });
  });


  // ── Loading flag — prevents onUpdate from firing during programmatic content load ──

  /**
   * Set to `true` while applying an extension-host `update` message so that the
   * TipTap `onUpdate` callback does not echo the content back as an `edit` event
   * (which would create an unnecessary dirty-state on the TextDocument).
   */
  let isLoading = false;

  // ── Document integrity tracking (M2d) ─────────────────────────────────────────

  /**
   * The raw markdown content most recently loaded from disk (via `update` message).
   * Used as the baseline for dirty-state detection: the document is considered
   * modified only when the serialized markdown differs from this value.
   */
  let originalContent: string = '';

  /**
   * Tracks whether the document has unsaved changes relative to `originalContent`.
   */
  let isDirty = false;

  /**
   * PM undo-stack depth at the moment the document was last saved. Compared
   * against the current undo depth to detect the "pristine" state (i.e. PM
   * content matches whatever is currently on disk). `null` means there is no
   * valid saved baseline for the current PM history (e.g. after switching
   * modes with unsaved changes, which reset history but didn't save). Updated
   * on load (→ 0) and every time the extension host reports a successful save.
   */
  let lastSavedUndoDepth: number | null = 0;

  /**
   * Whether the markdown last loaded into the rich view ended with a newline.
   * prosemirror-markdown never emits a final newline, so `serializeDocument`
   * puts it back: a file that had one keeps it after an edit, and a file
   * without one doesn't gain one.
   */
  let trailingNewline = false;

  // ── M4: Source mode state ──────────────────────────────────────────────────────

  /**
   * Whether the editor is currently in source (CodeMirror) mode.
   */
  let sourceMode = false;


  /**
   * The CodeMirror EditorView instance (created lazily on first toggle to source).
   */
  let cmView: EditorView | null = null;

  /**
   * Set to `true` while programmatically replacing CodeMirror's content (during
   * switchToSource) so that the updateListener does not echo the change back as
   * an 'edit' message (which would dirty the document on mode toggle).
   */
  let cmLoading = false;

  /**
   * Tracks the markdown CodeMirror was seeded with, so leaving source mode can
   * tell a real source edit from a no-op toggle (issue #5). See sourceSync.ts for
   * why `originalContent` is the wrong thing to compare against.
   */
  const sourceSync = new SourceModeSync();

  /**
   * Post the latest stats to the host status bar. Either or both fields may be
   * present:
   *   document — full plaintext for word/char/read-time
   *   selection — selected text; `null` (or empty string) hides the selection item
   */
  function postStats(opts: { document?: string; selection?: string | null }): void {
    const payload: { document?: string; selection?: { words: number; chars: number } | null } = {};
    if (typeof opts.document === 'string') {payload.document = opts.document;}
    if (opts.selection !== undefined) {
      if (opts.selection === null || opts.selection === '') {
        payload.selection = null;
      } else {
        payload.selection = { words: countWords(opts.selection), chars: opts.selection.length };
      }
    }
    host.onStats?.(payload);
  }

  // ── Undo / redo routing ───────────────────────────────────────────────────────
  //
  // Cmd+Z / Cmd+Shift+Z are registered as VS Code keybindings (see package.json)
  // that post `command` messages into the webview. The toolbar Undo/Redo buttons
  // call the same path. We MUST route to the editor that owns the visible doc,
  // otherwise Cmd+Z in source mode would silently undo against the (invisible)
  // TipTap history and desync the two views.
  function doUndo(editor: Editor): void {
    if (sourceMode && cmView) {
      cmUndo({ state: cmView.state, dispatch: cmView.dispatch.bind(cmView) });
      cmView.focus();
    } else {
      editor.chain().focus().undo().run();
    }
  }

  function doRedo(editor: Editor): void {
    if (sourceMode && cmView) {
      cmRedo({ state: cmView.state, dispatch: cmView.dispatch.bind(cmView) });
      cmView.focus();
    } else {
      editor.chain().focus().redo().run();
    }
  }

  // ── Diff highlighting state ───────────────────────────────────────────────────

  /** Whether diff highlighting is currently active in the WYSIWYG view. */
  let diffHighlightActive = false;

  /** Whether the current file has uncommitted git changes. */
  let fileHasGitChanges = false;

  /** HEAD content received from the extension host for diff computation. */
  let headContent: string | null = null;

  // ── M6a: Link tooltip state ────────────────────────────────────────────────────

  let linkTooltip: HTMLDivElement | null = null;

  /** Toolbar / command entry point for the source-mode toggle (wired in the editor setup). */
  let toggleSourceMode: () => void = () => {};

  // ── M15: Frontmatter state ─────────────────────────────────────────────────────

  /**
   * Stores raw YAML content between the --- delimiters of a frontmatter block.
   * `null` when the document has no frontmatter block at all; `''` when a
   * block is present but has no entries yet (e.g. right after `/properties` —
   * see `insertEmptyFrontmatter` below). Keeping these distinct matters:
   * collapsing "empty" into "absent" (as a plain `string` default would) means
   * `restoreFrontmatter` strips the `---` delimiters on the very next edit.
   */
  let frontmatterContent: string | null = null;
  setSlashFrontmatterProvider(() => frontmatterContent !== null);

  /**
   * Tracks whether the frontmatter UI block is expanded or collapsed.
   */
  let frontmatterExpanded = false;


  // ── M6a: Anchor ID generation helpers ─────────────────────────────────────────

  /**
   * Compute the anchor ID for a specific heading element by walking all
   * headings (to handle collision deduplication) up to and including it.
   * Returns the anchor ID or empty string if the heading isn't found.
   */
  function computeAnchorIdFor(targetHeading: HTMLElement): string {
    const container = editorContainer;
    const headings = container.querySelectorAll<HTMLElement>('h1,h2,h3,h4,h5,h6');
    const seenIds = new Map<string, number>();
    for (const h of headings) {
      const base = githubAnchorId(h.textContent || '');
      const count = seenIds.get(base) ?? 0;
      const id = count === 0 ? base : `${base}-${count}`;
      seenIds.set(base, count + 1);
      if (h === targetHeading) {return id;}
    }
    return '';
  }

  /**
   * Smoothly scroll a heading to the top of the editor viewport.
   *
   * Native `scrollIntoView({ behavior: 'smooth' })` picks its own duration that
   * grows with distance, so jumping to the bottom of a long document crawls.
   * This eases over a fixed, distance-capped duration instead, so the animation
   * feels the same whether the target is one screen away or fifty. Honors
   * `prefers-reduced-motion` by jumping instantly.
   */
  function smoothScrollHeadingIntoView(target: HTMLElement): void {
    const container = editorContainer;

    const TOP_PADDING = 8; // small breathing room above the heading
    const destination = Math.max(
      0,
      Math.min(
        container.scrollTop + target.getBoundingClientRect().top - container.getBoundingClientRect().top - TOP_PADDING,
        container.scrollHeight - container.clientHeight,
      ),
    );
    const start = container.scrollTop;
    const distance = destination - start;
    if (Math.abs(distance) < 1) {return;}

    const reduceMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    if (reduceMotion) { container.scrollTop = destination; return; }

    // Duration scales with distance but is clamped so long jumps stay snappy.
    const duration = Math.min(420, Math.max(180, Math.abs(distance) * 0.4));
    const easeInOutQuad = (t: number) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2);

    let startTime: number | null = null;
    const step = (now: number) => {
      if (startTime === null) {startTime = now;}
      const elapsed = now - startTime;
      const t = Math.min(1, elapsed / duration);
      container.scrollTop = start + distance * easeInOutQuad(t);
      if (t < 1) {requestAnimationFrame(step);}
    };
    requestAnimationFrame(step);
  }

  // ── M3: Link and image dialog helpers ─────────────────────────────────────────

  function showLinkDialog(editor: Editor, slashRange?: { from: number; to: number }): void {
    const existing = editor.getAttributes('link').href as string | undefined;

    // Build modal overlay
    const overlay = document.createElement('div');
    overlay.id = 'mikedown-link-dialog-overlay';
    overlay.style.cssText = [
      'position:fixed', 'inset:0', 'z-index:1050',
      'display:flex', 'align-items:center', 'justify-content:center',
      'background:rgba(0,0,0,0.45)'
    ].join(';');

    const dialog = document.createElement('div');
    dialog.setAttribute('role', 'dialog');
    dialog.setAttribute('aria-modal', 'true');
    dialog.setAttribute('aria-label', 'Insert Link');
    dialog.style.cssText = [
      'background:var(--mikedown-surface-raised,var(--mikedown-surface,#252526))',
      'border:1px solid var(--mikedown-border,rgba(128,128,128,0.35))',
      'border-radius:8px',
      'padding:16px 20px',
      'min-width:420px',
      'box-shadow:0 8px 24px rgba(0,0,0,0.4)',
      'display:flex',
      'flex-direction:column',
      'gap:12px'
    ].join(';');

    const title = document.createElement('div');
    title.textContent = 'Insert Link';
    title.style.cssText = 'font-weight:600;font-size:14px;color:var(--mikedown-text,#d4d4d4)';

    const fieldWrapper = document.createElement('div');
    const fieldLabel = document.createElement('label');
    fieldLabel.textContent = 'URL';
    fieldLabel.style.cssText = 'display:block;font-size:12px;font-weight:500;margin-bottom:4px;color:var(--mikedown-text-muted)';

    const urlInput = document.createElement('input');
    urlInput.type = 'text';
    urlInput.placeholder = 'https:// or ./relative.md or #anchor';
    urlInput.value = existing ?? '';
    urlInput.style.cssText = [
      'width:100%',
      'padding:5px 8px',
      'background:var(--mikedown-input-bg,#3c3c3c)',
      'color:var(--mikedown-text-ui,#d4d4d4)',
      'border:1px solid var(--mikedown-input-border,rgba(128,128,128,0.35))',
      'border-radius:4px',
      'font-size:13px',
      'outline:none',
      'box-sizing:border-box'
    ].join(';');

    fieldWrapper.appendChild(fieldLabel);
    fieldWrapper.appendChild(urlInput);

    const btnRow = document.createElement('div');
    btnRow.style.cssText = 'display:flex;gap:8px;justify-content:flex-end;padding-top:4px';

    const cancelBtn = document.createElement('button');
    cancelBtn.textContent = 'Cancel';
    cancelBtn.style.cssText = [
      'padding:5px 14px',
      'background:transparent',
      'color:var(--mikedown-button-text,#d4d4d4)',
      'border:1px solid var(--mikedown-button-bg,rgba(128,128,128,0.35))',
      'border-radius:4px',
      'cursor:pointer',
      'font-size:13px'
    ].join(';');

    const confirmBtn = document.createElement('button');
    confirmBtn.textContent = existing ? 'Update' : 'Insert';
    confirmBtn.style.cssText = [
      'padding:5px 14px',
      'background:var(--mikedown-accent,#0e639c)',
      'color:var(--mikedown-accent-text,#ffffff)',
      'border:none',
      'border-radius:4px',
      'cursor:pointer',
      'font-size:13px',
      'font-weight:500'
    ].join(';');

    btnRow.appendChild(cancelBtn);
    btnRow.appendChild(confirmBtn);
    dialog.appendChild(title);
    dialog.appendChild(fieldWrapper);
    dialog.appendChild(btnRow);
    overlay.appendChild(dialog);
    getPortal().appendChild(overlay);

    // Wire autocomplete with links already in the document
    const existingDocLinks = collectDocLinks(editorContainer);
    initLinkAutocomplete(urlInput, (href) => {
      urlInput.value = href;
    }, existingDocLinks, linkSuggestionSources);

    // Focus the input
    setTimeout(() => urlInput.focus(), 0);

    function cleanup(): void {
      destroyLinkAutocomplete();
      overlay.remove();
    }

    function confirm(): void {
      const url = urlInput.value.trim();
      cleanup();
      if (slashRange) {
        // The slash `/link` command: `/query` stays in the doc until Save is
        // actually clicked (Cancel/Escape/click-away never reach this
        // function, so it's untouched then). Remove it inline, right here, so
        // the removal and the link mark below land in one undo group.
        const tr = closeHistory(editor.view.state.tr);
        tr.delete(slashRange.from, slashRange.to);
        editor.view.dispatch(tr);
      }
      if (url === '') {
        editor.chain().focus().unsetLink().run();
      } else {
        editor.chain().focus().setLink({ href: url }).run();
      }
    }

    confirmBtn.addEventListener('click', confirm);
    cancelBtn.addEventListener('click', () => { cleanup(); editor.commands.focus(); });
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) { cleanup(); editor.commands.focus(); }
    });
    urlInput.addEventListener('keydown', (e) => {
      // Let autocomplete handle Enter/Escape when its dropdown is active
      if (e.key === 'Enter' && !isDropdownActive()) { e.preventDefault(); confirm(); }
      if (e.key === 'Escape' && !isDropdownActive()) { cleanup(); editor.commands.focus(); }
    });
  }

  function showImageInsertDialog(editor: Editor): void {
    const overlay = document.createElement('div');
    overlay.id = 'mikedown-image-dialog-overlay';
    overlay.style.cssText = [
      'position:fixed', 'inset:0', 'z-index:1050',
      'display:flex', 'align-items:center', 'justify-content:center',
      'background:rgba(0,0,0,0.45)'
    ].join(';');

    const dialog = document.createElement('div');
    dialog.setAttribute('role', 'dialog');
    dialog.setAttribute('aria-modal', 'true');
    dialog.setAttribute('aria-label', 'Insert Image');
    dialog.style.cssText = [
      'background:var(--mikedown-surface-raised,var(--mikedown-surface,#252526))',
      'border:1px solid var(--mikedown-border,rgba(128,128,128,0.35))',
      'border-radius:8px',
      'padding:16px 20px',
      'min-width:360px',
      'box-shadow:0 8px 24px rgba(0,0,0,0.4)',
      'display:flex',
      'flex-direction:column',
      'gap:12px'
    ].join(';');

    const title = document.createElement('div');
    title.textContent = 'Insert Image';
    title.style.cssText = 'font-weight:600;font-size:14px;color:var(--mikedown-text,#d4d4d4)';

    const makeField = (label: string, placeholder: string, value: string): { wrapper: HTMLElement; input: HTMLInputElement } => {
      const wrapper = document.createElement('div');
      const lbl = document.createElement('label');
      lbl.textContent = label;
      lbl.style.cssText = 'display:block;font-size:12px;font-weight:500;margin-bottom:4px;color:var(--mikedown-text-muted)';
      const input = document.createElement('input');
      input.type = 'text';
      input.placeholder = placeholder;
      input.value = value;
      input.style.cssText = [
        'width:100%',
        'padding:5px 8px',
        'background:var(--mikedown-input-bg,#3c3c3c)',
        'color:var(--mikedown-text-ui,#d4d4d4)',
        'border:1px solid var(--mikedown-input-border,rgba(128,128,128,0.35))',
        'border-radius:4px',
        'font-size:13px',
        'outline:none',
        'box-sizing:border-box'
      ].join(';');
      wrapper.appendChild(lbl);
      wrapper.appendChild(input);
      return { wrapper, input };
    };

    const srcField = makeField('Path or URL', './image.png or https://...', '');
    const altField = makeField('Alt text', 'Describe the image (optional)', '');

    const btnRow = document.createElement('div');
    btnRow.style.cssText = 'display:flex;gap:8px;justify-content:flex-end;padding-top:4px';

    const cancelBtn = document.createElement('button');
    cancelBtn.textContent = 'Cancel';
    cancelBtn.style.cssText = [
      'padding:5px 14px',
      'background:transparent',
      'color:var(--mikedown-button-text,#d4d4d4)',
      'border:1px solid var(--mikedown-button-bg,rgba(128,128,128,0.35))',
      'border-radius:4px',
      'cursor:pointer',
      'font-size:13px'
    ].join(';');

    const confirmBtn = document.createElement('button');
    confirmBtn.textContent = 'Insert';
    confirmBtn.style.cssText = [
      'padding:5px 14px',
      'background:var(--mikedown-accent,#0e639c)',
      'color:var(--mikedown-accent-text,#ffffff)',
      'border:none',
      'border-radius:4px',
      'cursor:pointer',
      'font-size:13px',
      'font-weight:500'
    ].join(';');

    btnRow.appendChild(cancelBtn);
    btnRow.appendChild(confirmBtn);
    dialog.appendChild(title);
    dialog.appendChild(srcField.wrapper);
    dialog.appendChild(altField.wrapper);
    dialog.appendChild(btnRow);
    overlay.appendChild(dialog);
    getPortal().appendChild(overlay);

    setTimeout(() => srcField.input.focus(), 0);

    function cleanup(): void { overlay.remove(); }

    function confirm(): void {
      const src = srcField.input.value.trim();
      const alt = altField.input.value.trim();
      cleanup();
      if (src) {
        editor.chain().focus().setImage({ src, alt }).run();
      } else {
        editor.commands.focus();
      }
    }

    confirmBtn.addEventListener('click', confirm);
    cancelBtn.addEventListener('click', () => { cleanup(); editor.commands.focus(); });
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) { cleanup(); editor.commands.focus(); }
    });
    srcField.input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); confirm(); }
      if (e.key === 'Escape') { cleanup(); editor.commands.focus(); }
    });
    altField.input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); confirm(); }
      if (e.key === 'Escape') { cleanup(); editor.commands.focus(); }
    });
  }

  // ── Settings Modal ──────────────────────────────────────────────────────────────

  /** Core tab ids, plus any tab a host section adds. */
  type SettingsTabId = string;
  let lastSettingsTab: SettingsTabId = 'appearance';

  /**
   * Build the Hotkeys settings tab. Read-only reference table — MikeDown
   * cannot rewrite the user's keybindings.json (there is no API for it, and
   * `contributes.keybindings` is static), so this shows what's bound today and
   * links out to VS Code's own Keyboard Shortcuts UI for remapping.
   */
  function buildHotkeysPanel(): HTMLDivElement {
    const panel = document.createElement('div');
    panel.setAttribute('role', 'tabpanel');
    panel.className = 'settings-panel settings-panel--hotkeys';

    if (host.openKeybindings) {
      const intro = document.createElement('div');
      intro.className = 'settings-desc';
      intro.textContent = 'To remap any of these, use VS Code’s own Keyboard Shortcuts UI — MikeDown can’t rewrite keybindings.json itself.';
      panel.appendChild(intro);
    }

    const table = document.createElement('table');
    table.className = 'settings-hotkeys-table';

    const thead = document.createElement('thead');
    const headRow = document.createElement('tr');
    for (const label of ['Action', 'Shortcut']) {
      const th = document.createElement('th');
      th.textContent = label;
      headRow.appendChild(th);
    }
    thead.appendChild(headRow);
    table.appendChild(thead);

    // The webview has no reliable platform check elsewhere in this file, so
    // rather than invent one here, show a single Mac/Win combined format
    // (e.g. "Cmd+B / Ctrl+B") consistent for every viewer.
    const tbody = document.createElement('tbody');
    for (const hk of MIKEDOWN_HOTKEYS) {
      const row = document.createElement('tr');
      const labelCell = document.createElement('td');
      labelCell.textContent = hk.label;
      const keyCell = document.createElement('td');
      keyCell.textContent = `${formatHotkeyChord(hk.mac)} / ${formatHotkeyChord(hk.win)}`;
      row.append(labelCell, keyCell);
      tbody.appendChild(row);
    }
    table.appendChild(tbody);
    panel.appendChild(table);

    if (host.openKeybindings) {
      const customizeBtn = document.createElement('button');
      customizeBtn.type = 'button';
      customizeBtn.textContent = 'Customize in VS Code…';
      customizeBtn.className = 'settings-btn';
      customizeBtn.addEventListener('click', () => {
        host.openKeybindings?.();
      });
      panel.appendChild(customizeBtn);
    }

    return panel;
  }


  /** This editor's open Settings modal, if any (appended to document.body). */
  let settingsOverlay: HTMLElement | null = null;
  /** Tells the open modal's sections it closed unsaved. Null once saved or closed. */
  let discardSettings: (() => void) | null = null;

  /** Close the Settings modal without saving. */
  function closeSettingsModal(): void {
    // A page opened from the modal works on the modal's draft: it goes too.
    if (aiPage?.fromModal) {closeAiEnginesPage();}
    const discard = discardSettings;
    discardSettings = null;
    refreshToolbarSettingsRows = null;
    settingsOverlay?.remove();
    discard?.();
  }

  function showSettingsModal(initialTab?: SettingsTabId): void {
    // Remove existing modal if open
    closeSettingsModal();

    const overlay = document.createElement('div');
    overlay.id = 'mikedown-settings-overlay';
    settingsOverlay = overlay;

    const modal = document.createElement('div');
    modal.setAttribute('role', 'dialog');
    modal.setAttribute('aria-modal', 'true');
    modal.setAttribute('aria-label', 'MikeDown Settings');
    modal.className = 'settings-modal';

    // Read current values from CSS custom properties
    const computed = getComputedStyle(root);
    const currentFontSize = parseInt(computed.getPropertyValue('--mikedown-font-size') || String(DEFAULT_FONT_SIZE), 10);
    const currentFontFamily = computed.getPropertyValue('--mikedown-font-family').trim();
    const currentMaxWidth = computed.getPropertyValue('--mikedown-content-width').trim() || '100%';

    // ── Title
    const title = document.createElement('div');
    title.className = 'settings-header';
    const titleText = document.createElement('h2');
    titleText.textContent = 'Settings';
    titleText.className = 'settings-title';
    const closeBtn = document.createElement('button');
    closeBtn.innerHTML = '&times;';
    closeBtn.className = 'settings-close';
    closeBtn.addEventListener('click', () => closeSettingsModal());
    title.appendChild(titleText);
    title.appendChild(closeBtn);

    // ── Font Size
    const fontSizeRow = makeRow('Font Size', 'Size in pixels for the editor content.', 'inline');
    const fontSizeInput = document.createElement('input');
    fontSizeInput.type = 'range';
    fontSizeInput.min = String(WHEEL_ZOOM_MIN);
    fontSizeInput.max = String(WHEEL_ZOOM_MAX);
    fontSizeInput.value = String(currentFontSize);
    const fontSizeLabel = document.createElement('span');
    fontSizeLabel.className = 'settings-range-value';
    fontSizeLabel.textContent = `${currentFontSize}px`;
    const fontSizeControl = document.createElement('div');
    fontSizeControl.className = 'settings-range-control';
    fontSizeControl.appendChild(fontSizeInput);
    fontSizeControl.appendChild(fontSizeLabel);
    fontSizeRow.appendChild(fontSizeControl);
    fontSizeInput.addEventListener('input', () => {
      fontSizeLabel.textContent = `${fontSizeInput.value}px`;
      setRootVar('--mikedown-font-size', `${fontSizeInput.value}px`);
      refreshZoomControl();
    });

    // ── Font Theme
    const isMacSettings = navigator.platform?.startsWith('Mac') || navigator.userAgent.includes('Macintosh');

    const macSans = "'Avenir Next', Avenir, sans-serif";
    const macSans2 = "'Helvetica Neue', Helvetica, sans-serif";
    const macSerif = "Charter, 'Bitstream Charter', Georgia, serif";
    const macSerif2 = "Palatino, 'Palatino Linotype', 'Book Antiqua', serif";
    const macMono = "'SF Mono', Menlo, Monaco, monospace";
    const winSans = "'Segoe UI', sans-serif";
    const winSans2 = "Calibri, sans-serif";
    const winSerif = "Cambria, Georgia, serif";
    const winSerif2 = "'Palatino Linotype', Palatino, 'Book Antiqua', serif";
    const winMono = "Consolas, 'Cascadia Code', monospace";

    const fontThemes = [
      { label: 'Editorial', heading: isMacSettings ? macSans : winSans, body: isMacSettings ? macSerif : winSerif, desc: 'Sans headings, serif body' },
      { label: 'Magazine', heading: isMacSettings ? macSans2 : winSans2, body: isMacSettings ? macSerif2 : winSerif2, desc: 'Sans headings, serif body' },
      { label: 'Notebook', heading: "Georgia, 'Times New Roman', serif", body: isMacSettings ? macSans : winSans2, desc: 'Serif headings, sans body' },
      { label: 'Academic', heading: isMacSettings ? macSerif2 : winSerif2, body: isMacSettings ? macSans : winSans, desc: 'Serif headings, sans body' },
      { label: 'Technical', heading: isMacSettings ? macSans : winSans, body: isMacSettings ? macMono : winMono, desc: 'Sans headings, mono body' },
      { label: 'Manuscript', heading: "Georgia, 'Times New Roman', serif", body: isMacSettings ? macMono : winMono, desc: 'Serif headings, mono body' },
      { label: 'Modern', heading: isMacSettings ? macSans : winSans, body: isMacSettings ? macSans : winSans, desc: 'Clean sans throughout' },
      { label: 'Classic', heading: "Georgia, 'Times New Roman', serif", body: "Georgia, 'Times New Roman', serif", desc: 'Traditional serif throughout' },
      { label: 'Literary', heading: isMacSettings ? macSerif2 : winSerif2, body: isMacSettings ? macSerif : winSerif, desc: 'Two-serif pairing' },
      { label: 'Developer', heading: isMacSettings ? macMono : winMono, body: isMacSettings ? macMono : winMono, desc: 'Monospace everything' },
    ];

    const fontThemeRow = makeRow('Font Theme', 'Choose a heading + body font pairing. Click to preview live.');

    const currentBodyFont = currentFontFamily || fontThemes[0].body;
    const currentHeadingFont = computed.getPropertyValue('--mikedown-heading-font-family').trim() || fontThemes[0].heading;
    const originalBody = currentBodyFont;
    const originalHeading = currentHeadingFont;
    let selectedBody = currentBodyFont;
    let selectedHeading = currentHeadingFont;

    // Find current theme
    const currentTheme = fontThemes.find(t => t.body === currentBodyFont && t.heading === currentHeadingFont);
    const currentThemeLabel = currentTheme ? currentTheme.label : 'Custom';

    // Current indicator + revert
    const themeCurrentRow = document.createElement('div');
    themeCurrentRow.className = 'settings-theme-current';
    const themeIndicator = document.createElement('span');
    themeIndicator.textContent = `Current: ${currentThemeLabel}`;
    const themeRevertBtn = document.createElement('button');
    themeRevertBtn.textContent = 'Revert';
    themeRevertBtn.className = 'settings-btn';
    themeRevertBtn.style.display = 'none';
    themeRevertBtn.addEventListener('click', () => {
      selectedBody = originalBody;
      selectedHeading = originalHeading;
      setRootVar('--mikedown-font-family', originalBody);
      setRootVar('--mikedown-heading-font-family', originalHeading);
      themeRevertBtn.style.display = 'none';
      updateThemeItems();
    });
    themeCurrentRow.appendChild(themeIndicator);
    themeCurrentRow.appendChild(themeRevertBtn);
    fontThemeRow.appendChild(themeCurrentRow);

    // Theme list
    const themeList = document.createElement('div');
    themeList.setAttribute('tabindex', '0');
    themeList.className = 'settings-theme-list';

    const themeItems: Array<{ el: HTMLElement; theme: typeof fontThemes[0] }> = [];

    function updateThemeItems(): void {
      themeItems.forEach(({ el, theme }) => {
        const isActive = selectedBody === theme.body && selectedHeading === theme.heading;
        el.classList.toggle('is-active', isActive);
      });
    }

    fontThemes.forEach(theme => {
      const item = document.createElement('div');
      item.className = 'settings-theme-item';

      const topRow = document.createElement('div');
      topRow.className = 'settings-theme-item-top';
      const nameSpan = document.createElement('span');
      nameSpan.setAttribute('data-role', 'name');
      nameSpan.textContent = theme.label;
      nameSpan.className = 'settings-theme-name';
      const descSpan = document.createElement('span');
      descSpan.setAttribute('data-role', 'desc');
      descSpan.textContent = theme.desc;
      descSpan.className = 'settings-theme-desc';
      topRow.appendChild(nameSpan);
      topRow.appendChild(descSpan);

      const preview = document.createElement('div');
      preview.className = 'settings-theme-preview';

      const headingSample = document.createElement('div');
      headingSample.setAttribute('data-role', 'heading');
      headingSample.textContent = 'The Quick Brown Fox Jumps';
      headingSample.className = 'settings-theme-heading';
      headingSample.style.fontFamily = theme.heading;
      const bodySample = document.createElement('div');
      bodySample.setAttribute('data-role', 'body');
      bodySample.textContent = 'Pack my box with five dozen liquor jugs. How vexingly quick daft zebras jump! 0123456789 — "quotes" & more.';
      bodySample.className = 'settings-theme-body';
      bodySample.style.fontFamily = theme.body;

      preview.appendChild(headingSample);
      preview.appendChild(bodySample);

      item.appendChild(topRow);
      item.appendChild(preview);

      item.addEventListener('click', () => {
        selectedBody = theme.body;
        selectedHeading = theme.heading;
        setRootVar('--mikedown-font-family', theme.body);
        setRootVar('--mikedown-heading-font-family', theme.heading);
        themeRevertBtn.style.display = (selectedBody !== originalBody || selectedHeading !== originalHeading) ? '' : 'none';
        updateThemeItems();
      });

      themeItems.push({ el: item, theme });
      themeList.appendChild(item);
    });

    // Keyboard navigation
    let themeFocusIdx = themeItems.findIndex(ti => ti.theme.body === selectedBody && ti.theme.heading === selectedHeading);
    if (themeFocusIdx < 0) {themeFocusIdx = 0;}

    themeList.addEventListener('keydown', (e: KeyboardEvent) => {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        themeFocusIdx = e.key === 'ArrowDown'
          ? Math.min(themeFocusIdx + 1, themeItems.length - 1)
          : Math.max(themeFocusIdx - 1, 0);
        const { el, theme } = themeItems[themeFocusIdx];
        selectedBody = theme.body;
        selectedHeading = theme.heading;
        setRootVar('--mikedown-font-family', theme.body);
        setRootVar('--mikedown-heading-font-family', theme.heading);
        themeRevertBtn.style.display = (selectedBody !== originalBody || selectedHeading !== originalHeading) ? '' : 'none';
        updateThemeItems();
        el.scrollIntoView({ block: 'nearest' });
      }
    });

    themeList.addEventListener('click', () => {
      themeList.focus();
      themeFocusIdx = themeItems.findIndex(ti => ti.theme.body === selectedBody && ti.theme.heading === selectedHeading);
      if (themeFocusIdx < 0) {themeFocusIdx = 0;}
    });

    fontThemeRow.appendChild(themeList);

    // Apply initial styling
    updateThemeItems();

    // ── Content Width
    const widthRow = makeRow('Content Width', 'Max width of the editor content area. Use "100%" for full width or a value like "800px".', 'inline');
    const widthSelect = document.createElement('select');
    widthSelect.className = 'settings-input';
    const widthOptions = [
      { value: '100%', label: 'Full Width' },
      { value: '900px', label: 'Wide (900px)' },
      { value: '780px', label: 'Medium (780px)' },
      { value: '650px', label: 'Narrow (650px)' },
    ];
    widthOptions.forEach(opt => {
      const option = document.createElement('option');
      option.value = opt.value;
      option.textContent = opt.label;
      if (currentMaxWidth === opt.value || (currentMaxWidth === '' && opt.value === '100%')) {option.selected = true;}
      widthSelect.appendChild(option);
    });
    widthRow.appendChild(widthSelect);
    widthSelect.addEventListener('change', () => {
      setRootVar('--mikedown-content-width', widthSelect.value);
    });

    // ── Behavior tab fields
    const ctrlWheelZoomField = makeCheckboxRow(
      'Ctrl + scroll changes font size',
      'Hold Ctrl (Cmd on macOS) and scroll, or pinch on a trackpad, to resize editor text.',
      currentCtrlWheelZoom,
    );
    const mermaidField = makeCheckboxRow(
      'Render Mermaid diagrams',
      'Display ```mermaid code blocks as rendered diagrams. Click a diagram to edit its source.',
      currentRenderMermaidDiagrams,
    );
    const mathField = makeCheckboxRow(
      'Render math',
      'Display $inline$ and $$display$$ LaTeX as formulas (KaTeX). Click a formula to edit it.',
      currentRenderMath,
    );
    const tagsField = makeCheckboxRow(
      'Tags',
      'Highlight inline #tags and list them in the sidebar.'
        + (tagsAvailable ? ' Known tags are suggested as you type #.' : '')
        + (host.openTag ? ' Cmd/Ctrl+click a tag to find other documents that use it.' : ''),
      currentTagsEnabled,
    );
    const tocStyleField = makeSelectRow<TocStyle>(
      'Table of contents style',
      'What Insert > Table of Contents (and /toc) adds. Existing tables of contents keep their style.',
      currentTocStyle,
      [
        { value: 'list', label: 'Linked list (shows on GitHub)' },
        { value: 'placeholder', label: '[toc] placeholder line' },
      ],
    );
    const linkClickField = makeSelectRow<'navigateCurrentTab' | 'openNewTab' | 'showContextMenu'>(
      'Link click behavior',
      'What happens when you Cmd/Ctrl+click a link in the editor.',
      currentLinkClickBehavior,
      [
        { value: 'openNewTab', label: 'Open in new tab' },
        { value: 'navigateCurrentTab', label: 'Navigate in current tab' },
        { value: 'showContextMenu', label: 'Show context menu' },
      ],
    );
    const headingNumberingField = makeSelectRow<HeadingNumbering>(
      'Heading numbering',
      'Adds a toolbar button that writes section numbers (1, 1.1, 1.1.1) into heading text and keeps them updated as you edit. The numbers are part of the markdown, so they show everywhere.',
      currentHeadingNumbering,
      [
        { value: 'off', label: 'Off' },
        { value: 'fromH1', label: 'Number from Heading 1' },
        { value: 'fromH2', label: 'Number from Heading 2 (Heading 1 is the title)' },
      ],
    );

    // ── Slash commands subsection (Behavior tab, M5) ────────────────────────────
    const slashCommandsSectionRow = makeRow(
      'Slash commands',
      'Type / at the start of a line (or after whitespace) to insert dates, links, tables, and more.',
    );
    const slashCommandsEnabledField = makeCheckboxRow(
      'Slash command menu',
      'Show the popup menu when typing / at the start of a line or after whitespace.',
      currentSlashCommandsEnabled,
    );
    slashCommandsEnabledField.input.id = 'mikedown-slashcommands-enabled';
    const slashCommandsDateFormatField = makeSelectRow<'iso' | 'long'>(
      'Date format',
      'Used by the /date and /datetime commands.',
      currentSlashCommandsDateFormat,
      [
        { value: 'iso', label: 'ISO (2026-09-26)' },
        { value: 'long', label: 'Long (September 26, 2026)' },
      ],
    );
    slashCommandsDateFormatField.select.id = 'mikedown-slashcommands-dateformat';
    const slashCommandsTimeZoneRow = makeRow('Time zone', 'Used by the /date and /datetime commands.', 'inline');
    const slashCommandsTimeZoneInput = document.createElement('input');
    slashCommandsTimeZoneInput.id = 'mikedown-slashcommands-timezone';
    slashCommandsTimeZoneInput.type = 'text';
    slashCommandsTimeZoneInput.placeholder = 'local, UTC, or e.g. America/New_York';
    slashCommandsTimeZoneInput.value = currentSlashCommandsTimeZone;
    slashCommandsTimeZoneInput.className = 'settings-input settings-input--medium';
    slashCommandsTimeZoneRow.appendChild(slashCommandsTimeZoneInput);
    // Date format / time zone only matter when the menu is on — grey them out
    // (and disable interaction) while it's off, toggling live on the checkbox.
    function updateSlashCommandsDependentDisabled(): void {
      const enabled = slashCommandsEnabledField.input.checked;
      slashCommandsDateFormatField.select.disabled = !enabled;
      slashCommandsTimeZoneInput.disabled = !enabled;
    }
    slashCommandsEnabledField.input.addEventListener('change', updateSlashCommandsDependentDisabled);
    updateSlashCommandsDependentDisabled();
    slashCommandsSectionRow.append(makeGroup(
      slashCommandsEnabledField.row,
      slashCommandsDateFormatField.row,
      slashCommandsTimeZoneRow,
    ));

    // ── Markdown tab fields
    const normalizationField = makeSelectRow<'preserve' | 'normalize'>(
      'Markdown normalization',
      'Preserve keeps the source markdown verbatim where possible. Normalize rewrites markers to the styles below on save.',
      currentMarkdownNormalization,
      [
        { value: 'preserve', label: 'Preserve original (recommended)' },
        { value: 'normalize', label: 'Normalize to chosen style' },
      ],
    );
    const boldMarkerField = makeSelectRow<'**' | '__'>(
      'Bold marker',
      'Character pair used to wrap bold text when normalizing.',
      currentNormalizationStyle.boldMarker,
      [
        { value: '**', label: '** (double asterisks)' },
        { value: '__', label: '__ (double underscores)' },
      ],
    );
    const italicMarkerField = makeSelectRow<'*' | '_'>(
      'Italic marker',
      'Character used to wrap italic text when normalizing.',
      currentNormalizationStyle.italicMarker,
      [
        { value: '*', label: '* (asterisk)' },
        { value: '_', label: '_ (underscore)' },
      ],
    );
    const listMarkerField = makeSelectRow<'-' | '*' | '+'>(
      'List bullet marker',
      'Character used for unordered list bullets when normalizing.',
      currentNormalizationStyle.listMarker,
      [
        { value: '-', label: '- (hyphen)' },
        { value: '*', label: '* (asterisk)' },
        { value: '+', label: '+ (plus)' },
      ],
    );
    const headingStyleField = makeSelectRow<'atx' | 'setext'>(
      'Heading style',
      'ATX uses # prefixes (always). Setext underlines H1/H2 with === / ---.',
      currentNormalizationStyle.headingStyle,
      [
        { value: 'atx', label: 'ATX (# Heading)' },
        { value: 'setext', label: 'Setext (underlined H1/H2)' },
      ],
    );

    // ── Spelling tab fields
    const spellEnabledField = makeCheckboxRow(
      'Check spelling',
      'Underline misspelled words in the editor, using the dictionary that ships with MikeDown.',
      currentSpellCheckEnabled,
    );
    const spellLanguageField = makeSelectRow<SpellCheckLanguage>(
      'Dictionary',
      'Which English dictionary to check against.',
      currentSpellCheckLanguage,
      [
        { value: 'en', label: 'English (United States)' },
        { value: 'en-GB', label: 'English (United Kingdom)' },
      ],
    );
    const spellIgnoreCodeField = makeCheckboxRow(
      'Skip code blocks and inline code',
      'Leave fenced code blocks, mermaid diagrams, and `inline code` unchecked. Links and [[wikilinks]] are always skipped.',
      currentSpellCheckIgnoreCodeBlocks,
    );

    // Custom dictionary — an editable list. "Add to Dictionary" in the
    // right-click menu writes to the same setting.
    //
    // Two sources share one list: MikeDown's own words (removable) and the
    // words inherited from the Code Spell Checker extension (`cSpell.words`,
    // read-only — dashed chips). Rendering is sorted + filtered, so *nothing*
    // here may address a word by its position in the rendered list; removal
    // goes by value through `removeWordFromList`.
    let spellWords: string[] = [...currentSpellCheckUserWords];
    // Below this many total words a filter box is just clutter.
    const SPELL_FILTER_THRESHOLD = 8;
    // Past this many words the wrapped chip cloud stops being scannable —
    // variable-width chips wrapping mid-row defeat an alphabetical scan — so the
    // list switches to fixed columns, one word per row.
    const SPELL_DENSE_THRESHOLD = 25;
    const CLOUD_LIST_CLASS = 'settings-words settings-words--cloud';
    const DENSE_LIST_CLASS = 'settings-words settings-words--dense';
    const spellWordsRow = makeRow(
      'Custom dictionary',
      'Words MikeDown should always accept. Right-clicking a squiggle and choosing “Add to Dictionary” adds to this list.',
    );

    const spellWordsHeader = document.createElement('div');
    spellWordsHeader.className = 'settings-words-header';
    const spellWordsFilter = document.createElement('input');
    spellWordsFilter.type = 'search';
    spellWordsFilter.placeholder = 'Filter words…';
    spellWordsFilter.setAttribute('aria-label', 'Filter the custom dictionary');
    spellWordsFilter.className = 'settings-input settings-input--small settings-input--grow';
    const spellWordsCount = document.createElement('span');
    spellWordsCount.setAttribute('aria-live', 'polite');
    spellWordsCount.className = 'settings-words-count';
    spellWordsHeader.append(spellWordsFilter, spellWordsCount);

    const spellWordsList = document.createElement('div');
    spellWordsList.setAttribute('role', 'list');
    spellWordsList.className = CLOUD_LIST_CLASS;

    const spellWordsLegend = document.createElement('div');
    spellWordsLegend.className = 'settings-words-legend';

    function renderSpellWords(): void {
      const external = currentSpellCheckExternalWords;
      const view = buildDictionaryView(spellWords, external, spellWordsFilter.value);

      // The filter only earns its space once the list is long. If words were
      // removed down past the threshold, drop the (now hidden) filter text too,
      // otherwise it would silently keep hiding words.
      const showFilter = view.total >= SPELL_FILTER_THRESHOLD;
      if (!showFilter && spellWordsFilter.value) {
        spellWordsFilter.value = '';
        renderSpellWords();
        return;
      }
      spellWordsFilter.style.display = showFilter ? '' : 'none';
      spellWordsCount.textContent = view.filter
        ? `${view.entries.length} of ${view.total}`
        : `${view.total} ${view.total === 1 ? 'word' : 'words'}`;
      spellWordsCount.style.display = view.total === 0 ? 'none' : '';

      // Layout keys off the *unfiltered* total so typing in the filter never
      // reshuffles the list under the user's eyes.
      const dense = view.total >= SPELL_DENSE_THRESHOLD;
      spellWordsList.className = dense ? DENSE_LIST_CLASS : CLOUD_LIST_CLASS;
      spellWordsLegend.textContent = dense
        ? 'Greyed, italic words come from the Code Spell Checker extension (cSpell.words) and are honoured here but edited there.'
        : 'Dashed words come from the Code Spell Checker extension (cSpell.words) and are honoured here but edited there.';
      spellWordsLegend.style.display = external.length > 0 ? '' : 'none';

      spellWordsList.textContent = '';
      if (view.entries.length === 0) {
        const empty = document.createElement('span');
        empty.className = 'settings-words-empty';
        // Distinct empty states: an empty dictionary and a filter that matched
        // nothing look identical otherwise, and the second reads as data loss.
        empty.textContent = view.total === 0
          ? 'No custom words yet.'
          : `No words match “${view.filter}”.`;
        spellWordsList.appendChild(empty);
        return;
      }

      // Position of each removable chip among the removable chips only —
      // used to put focus back on the neighbouring × after a removal.
      let removableIndex = -1;
      for (const entry of view.entries) {
        const chip = document.createElement('span');
        chip.setAttribute('role', 'listitem');
        const isExternal = entry.source === 'external';
        // Pill chips in the cloud, plain one-per-row entries when dense — the
        // list's modifier class picks the look (settings-modal.css).
        chip.className = isExternal ? 'settings-word settings-word--external' : 'settings-word';
        const label = document.createElement('span');
        label.textContent = entry.word;
        chip.appendChild(label);

        if (isExternal) {
          chip.title = `“${entry.word}” comes from the Code Spell Checker extension (cSpell.words). Remove it there.`;
          label.setAttribute('aria-label', `${entry.word} (from Code Spell Checker, read-only)`);
          // Dense rows are a grid: without a spacer the word would stretch
          // across the cell and stop aligning with the removable rows above it.
          if (dense) {chip.appendChild(document.createElement('span'));}
        } else {
          const myIndex = ++removableIndex;
          const remove = document.createElement('button');
          remove.type = 'button';
          remove.textContent = '×';
          remove.setAttribute('aria-label', `Remove ${entry.word} from the custom dictionary`);
          remove.className = 'settings-word-remove';
          remove.addEventListener('click', () => {
            // By value, never by index — the rendered order is sorted/filtered.
            spellWords = removeWordFromList(spellWords, entry.word);
            renderSpellWords();
            // Keep the keyboard where the user left it: the × that slid into
            // this slot (or the last one), else the nearest input if the list
            // just emptied out.
            const buttons = spellWordsList.querySelectorAll('button');
            const next = buttons[Math.min(myIndex, buttons.length - 1)];
            (next ?? (spellWordsFilter.style.display === 'none' ? spellWordInput : spellWordsFilter)).focus();
          });
          chip.appendChild(remove);
        }
        spellWordsList.appendChild(chip);
      }
    }

    spellWordsFilter.addEventListener('input', () => renderSpellWords());
    spellWordsFilter.addEventListener('keydown', (e: KeyboardEvent) => {
      if (e.key === 'Escape' && spellWordsFilter.value) {
        // Clear the filter without closing the whole modal.
        e.preventDefault();
        e.stopPropagation();
        spellWordsFilter.value = '';
        renderSpellWords();
      }
    });

    const spellWordsAddRow = document.createElement('div');
    spellWordsAddRow.className = 'settings-words-add';
    const spellWordInput = document.createElement('input');
    spellWordInput.type = 'text';
    spellWordInput.placeholder = 'Add a word…';
    spellWordInput.setAttribute('aria-label', 'Add a word to the custom dictionary');
    spellWordInput.className = 'settings-input settings-input--grow';
    const spellWordAddBtn = document.createElement('button');
    spellWordAddBtn.type = 'button';
    spellWordAddBtn.textContent = 'Add';
    spellWordAddBtn.className = 'settings-btn';
    const addSpellWord = (): void => {
      const next = addWordToList(spellWords, spellWordInput.value);
      spellWordInput.value = '';
      if (next === spellWords) {return;} // blank or already in the list
      spellWords = next;
      // A stale filter would hide the word that was just added.
      spellWordsFilter.value = '';
      renderSpellWords();
    };
    spellWordAddBtn.addEventListener('click', addSpellWord);
    spellWordInput.addEventListener('keydown', (e: KeyboardEvent) => {
      if (e.key === 'Enter') { e.preventDefault(); addSpellWord(); }
    });
    spellWordsAddRow.append(spellWordInput, spellWordAddBtn);
    spellWordsRow.append(spellWordsHeader, spellWordsList, spellWordsLegend, spellWordsAddRow);
    renderSpellWords();

    // ── Host sections (extraSettingsSections) ──────────────────────────────────
    // Built after the core rows so a section can be placed after a specific
    // core row. Each section returns rows plus an optional collect() whose
    // values join the saveSettings patch.
    const sectionCtx: MikeDownSettingsSectionContext = settingsSectionContext(() => closeSettingsModal());
    // The AI tab is core's own section, built only for a host with an `ai`
    // group. Listed after the host's sections and placed last in the nav,
    // below any host tab (About, App).
    const aiSections: MikeDownSettingsSection[] = aiHost ? [{
      tab: 'ai',
      tabLabel: 'AI',
      panelClassName: 'settings-panel--ai',
      build: (ctx) => buildAiSettingsSection(ctx, {
        ...aiSessionOptions(aiHost),
        onSaved: (saved) => {
          currentAiSettings = saved;
          renderAiIndicator();
          refreshAiToolbarButton();
          scheduleAiStatusRefresh();
        },
        // "Manage engines…" and "Change…" open the page over the modal.
        openEnginesPage: (request) => showAiEnginesPage({
          initial: request.initial,
          session: request.session,
          onDone: (patch, saved) => request.onDone(patch, saved),
          fromModal: true,
        }),
      }),
    }] : [];
    // ── Toolbar tab: Customize… and Reset to Default (hidden when the host
    // turns customizing off). Reset applies at once and is not part of the
    // modal's draft, like the font-pair revert.
    const toolbarRows: HTMLElement[] = [];
    // Set once the modal is built: true when any field differs from when it opened.
    let isModalDirty: () => boolean = () => false;
    if (features.customizeToolbar) {
      const customizeRow = makeRow('Customize Toolbar', 'Drag buttons to reorder them, remove the ones you do not use and add separators and spacers.', 'inline');
      const customizeToolbarBtn = document.createElement('button');
      customizeToolbarBtn.type = 'button';
      customizeToolbarBtn.className = 'settings-btn';
      customizeToolbarBtn.textContent = 'Customize Toolbar…';
      // Edit mode works on the live toolbar, so the modal closes first. Unsaved
      // changes in it are discarded, after a confirm (OQ2).
      customizeToolbarBtn.addEventListener('click', () => {
        const proceed = (): void => { closeSettingsModal(); enterToolbarEditMode(); };
        if (isModalDirty()) {confirmDiscardChanges(customizeToolbarBtn, proceed);} else {proceed();}
      });
      customizeRow.appendChild(customizeToolbarBtn);

      const resetRow = makeRow('Reset Toolbar', 'Go back to the default toolbar layout.', 'inline');
      const resetToolbarBtn = document.createElement('button');
      resetToolbarBtn.type = 'button';
      resetToolbarBtn.className = 'settings-btn';
      resetToolbarBtn.textContent = 'Reset to Default';
      resetToolbarBtn.addEventListener('click', () => {
        host.saveSettings?.({ toolbarLayout: null });
        applyToolbarLayout(null);
      });
      resetRow.appendChild(resetToolbarBtn);

      const syncToolbarRows = (): void => { resetToolbarBtn.disabled = toolbarResolved.isDefault; };
      syncToolbarRows();
      refreshToolbarSettingsRows = syncToolbarRows;
      toolbarRows.push(customizeRow, resetRow);
    }

    const builtSections = [...(options.extraSettingsSections ?? []), ...aiSections].map((section) => ({
      section,
      build: section.build(sectionCtx),
    }));

    // ── Save button + note
    const footer = document.createElement('div');
    footer.className = 'settings-footer';
    const note = document.createElement('span');
    note.className = 'settings-footer-note';
    note.textContent = options.settingsFooterNote
      ?? (host.saveSettings ? 'Changes apply instantly.' : 'Changes apply for this session only.');
    const saveBtn = document.createElement('button');
    saveBtn.textContent = host.saveSettings ? 'Save to Settings' : 'Apply';
    saveBtn.className = 'settings-btn settings-btn--primary';
    /** The settings the modal's fields hold now: what Save sends, and what the dirty check compares. */
    function collectModalSettings(): Partial<MikeDownSettings> & { normalizationStyle: NormalizationStyleSettings } {
      const normalizationStyle: NormalizationStyleSettings = {
        boldMarker: boldMarkerField.select.value as '**' | '__',
        italicMarker: italicMarkerField.select.value as '*' | '_',
        listMarker: listMarkerField.select.value as '-' | '*' | '+',
        headingStyle: headingStyleField.select.value as 'atx' | 'setext',
      };
      const extraValues: Record<string, unknown> = {};
      for (const { build } of builtSections) {
        Object.assign(extraValues, build.collect?.() ?? {});
      }
      return {
        fontSize: parseInt(fontSizeInput.value, 10),
        ctrlWheelZoom: ctrlWheelZoomField.input.checked,
        fontFamily: selectedBody,
        headingFontFamily: selectedHeading,
        contentWidth: widthSelect.value,
        // Behavior
        renderMermaidDiagrams: mermaidField.input.checked,
        renderMath: mathField.input.checked,
        tagsEnabled: tagsField.input.checked,
        tocStyle: tocStyleField.select.value as TocStyle,
        linkClickBehavior: linkClickField.select.value as MikeDownSettings['linkClickBehavior'],
        headingNumbering: headingNumberingField.select.value as MikeDownSettings['headingNumbering'],
        slashCommandsEnabled: slashCommandsEnabledField.input.checked,
        slashCommandsDateFormat: slashCommandsDateFormatField.select.value as MikeDownSettings['slashCommandsDateFormat'],
        slashCommandsTimeZone: slashCommandsTimeZoneInput.value.trim() || 'local',
        // Markdown
        markdownNormalization: normalizationField.select.value as MikeDownSettings['markdownNormalization'],
        normalizationStyle,
        // Spelling
        spellCheckEnabled: spellEnabledField.input.checked,
        spellCheckLanguage: spellLanguageField.select.value as MikeDownSettings['spellCheckLanguage'],
        spellCheckIgnoreCodeBlocks: spellIgnoreCodeField.input.checked,
        spellCheckUserWords: [...spellWords],
        // Host sections
        ...extraValues,
      };
    }
    saveBtn.addEventListener('click', () => {
      const patch = collectModalSettings();
      const { normalizationStyle } = patch;
      host.saveSettings?.(patch);
      // Mirror into local state so subsequent reads don't wait on the broadcast.
      currentCtrlWheelZoom = ctrlWheelZoomField.input.checked;
      currentRenderMermaidDiagrams = mermaidField.input.checked;
      currentRenderMath = mathField.input.checked;
      setMathRenderingEnabled(features.math && currentRenderMath);
      currentTagsEnabled = tagsField.input.checked;
      applyTocStyle(parseTocStyle(tocStyleField.select.value));
      currentLinkClickBehavior = linkClickField.select.value as typeof currentLinkClickBehavior;
      applyHeadingNumbering(parseHeadingNumbering(headingNumberingField.select.value));
      currentSlashCommandsEnabled = slashCommandsEnabledField.input.checked;
      currentSlashCommandsDateFormat = slashCommandsDateFormatField.select.value as typeof currentSlashCommandsDateFormat;
      currentSlashCommandsTimeZone = slashCommandsTimeZoneInput.value.trim() || 'local';
      currentMarkdownNormalization = normalizationField.select.value as typeof currentMarkdownNormalization;
      currentNormalizationStyle = normalizationStyle;
      currentSpellCheckEnabled = spellEnabledField.input.checked;
      currentSpellCheckLanguage = spellLanguageField.select.value as SpellCheckLanguage;
      currentSpellCheckIgnoreCodeBlocks = spellIgnoreCodeField.input.checked;
      currentSpellCheckUserWords = [...spellWords];
      // Apply immediately rather than waiting on the host's echo, so toggling
      // spell check off in the modal clears the squiggles the moment you save.
      // `null` — the modal has no editor handle; the plugin falls back to the
      // view it bound on mount.
      configureSpellCheck(null, {
        enabled: spellcheckAvailable && currentSpellCheckEnabled,
        language: currentSpellCheckLanguage,
        ignoreCodeBlocks: currentSpellCheckIgnoreCodeBlocks,
        userWords: [...currentSpellCheckUserWords, ...currentSpellCheckExternalWords],
      });
      discardSettings = null;
      for (const { build } of builtSections) {build.onSaved?.();}
      overlay.remove();
    });
    footer.appendChild(note);
    footer.appendChild(saveBtn);

    // ── Tabs scaffold ────────────────────────────────────────────────────────────
    const body = document.createElement('div');
    body.className = 'settings-body';

    const nav = document.createElement('div');
    nav.setAttribute('role', 'tablist');
    nav.setAttribute('aria-orientation', 'vertical');
    nav.className = 'settings-nav';

    const content = document.createElement('div');
    content.className = 'settings-content';

    function makePanel(): HTMLDivElement {
      const p = document.createElement('div');
      p.setAttribute('role', 'tabpanel');
      p.className = 'settings-panel';
      return p;
    }

    // Core rows per tab, keyed by the setting they edit so host sections can
    // be placed after a specific row. Rows for features that are off (or
    // that need a host method the host lacks) are left out.
    type CoreRow = { key: string; row: HTMLElement };
    const coreRows: Record<string, CoreRow[]> = {
      appearance: [
        { key: 'fontSize', row: fontSizeRow },
        { key: 'ctrlWheelZoom', row: ctrlWheelZoomField.row },
        { key: 'fontFamily', row: fontThemeRow },
        { key: 'contentWidth', row: widthRow },
        { key: 'headingNumbering', row: headingNumberingField.row },
      ],
      behavior: [
        { key: 'linkClickBehavior', row: linkClickField.row },
        ...(features.slashCommands ? [{ key: 'slashCommandsEnabled', row: slashCommandsSectionRow }] : []),
      ],
      markdown: [
        ...(features.mermaid ? [{ key: 'renderMermaidDiagrams', row: mermaidField.row }] : []),
        ...(features.math ? [{ key: 'renderMath', row: mathField.row }] : []),
        { key: 'tagsEnabled', row: tagsField.row },
        { key: 'tocStyle', row: tocStyleField.row },
        { key: 'markdownNormalization', row: normalizationField.row },
        { key: 'normalizationStyle.boldMarker', row: boldMarkerField.row },
        { key: 'normalizationStyle.italicMarker', row: italicMarkerField.row },
        { key: 'normalizationStyle.listMarker', row: listMarkerField.row },
        { key: 'normalizationStyle.headingStyle', row: headingStyleField.row },
      ],
      toolbar: toolbarRows.map((row, i) => ({ key: i === 0 ? 'toolbarCustomize' : 'toolbarReset', row })),
      spelling: [
        { key: 'spellCheckEnabled', row: spellEnabledField.row },
        { key: 'spellCheckLanguage', row: spellLanguageField.row },
        { key: 'spellCheckIgnoreCodeBlocks', row: spellIgnoreCodeField.row },
        { key: 'spellCheckUserWords', row: spellWordsRow },
      ],
    };

    const tabDefs: Array<{ id: SettingsTabId; label: string; experimental?: boolean }> = [
      { id: 'appearance', label: 'Appearance' },
      ...(toolbarRows.length ? [{ id: 'toolbar', label: 'Toolbar' }] : []),
      { id: 'behavior', label: 'Behavior' },
      { id: 'markdown', label: 'Markdown' },
      ...(spellcheckAvailable ? [{ id: 'spelling', label: 'Spelling' }] : []),
      { id: 'hotkeys', label: 'Hotkeys' },
    ];

    // New tabs from host sections, inserted after `afterTab` (default: last).
    for (const { section } of builtSections) {
      if (tabDefs.some((t) => t.id === section.tab) || coreRows[section.tab]) {continue;}
      const at = section.afterTab ? tabDefs.findIndex((t) => t.id === section.afterTab) : -1;
      const def = { id: section.tab, label: section.tabLabel ?? section.tab };
      if (at >= 0) {tabDefs.splice(at + 1, 0, def);} else {tabDefs.push(def);}
    }
    // AI goes at the very bottom, marked Experimental.
    const aiTabAt = tabDefs.findIndex((t) => t.id === 'ai');
    if (aiTabAt >= 0) {tabDefs.push({ ...tabDefs.splice(aiTabAt, 1)[0], experimental: true });}

    // Lay out each tab: host 'start' rows, core rows with any 'after' rows
    // spliced in, then host 'end' rows.
    const panels: Record<SettingsTabId, HTMLElement> = {};
    for (const tab of tabDefs) {
      if (tab.id === 'hotkeys') {
        panels[tab.id] = buildHotkeysPanel();
        continue;
      }
      const panel = makePanel();
      const forTab = builtSections.filter(({ section }) => section.tab === tab.id);
      for (const { section } of forTab) {
        if (section.panelClassName && !coreRows[tab.id]) {panel.classList.add(section.panelClassName);}
      }
      const placed = (where: 'start' | 'end') => forTab
        .filter(({ section }) => (section.placement ?? 'end') === where)
        .flatMap(({ build }) => build.rows);
      panel.append(...placed('start'));
      for (const { key, row } of coreRows[tab.id] ?? []) {
        panel.append(row);
        for (const { section, build } of forTab) {
          const p = section.placement;
          if (p && typeof p === 'object' && p.after === key) {panel.append(...build.rows);}
        }
      }
      panel.append(...placed('end'));
      panels[tab.id] = panel;
    }
    // Hotkeys can take host rows too (appended after the table).
    for (const { section, build } of builtSections) {
      if (section.tab === 'hotkeys') {panels.hotkeys.append(...build.rows);}
    }

    const tabButtons: HTMLButtonElement[] = [];
    let activeTab: SettingsTabId = initialTab && panels[initialTab]
      ? initialTab
      : (panels[lastSettingsTab] ? lastSettingsTab : 'appearance');

    function setActiveTab(id: SettingsTabId): void {
      activeTab = id;
      lastSettingsTab = id;
      tabButtons.forEach((btn) => {
        const isActive = btn.dataset.tabId === id;
        btn.setAttribute('aria-selected', String(isActive));
        btn.tabIndex = isActive ? 0 : -1;
      });
      Object.keys(panels).forEach((pid) => {
        panels[pid].style.display = pid === id ? '' : 'none';
      });
      content.scrollTop = 0;
    }

    tabDefs.forEach((tab, idx) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.setAttribute('role', 'tab');
      btn.dataset.tabId = tab.id;
      btn.textContent = tab.label;
      // The space keeps the accessible name "AI Experimental".
      if (tab.experimental) {btn.append(' ', experimentalBadge());}
      btn.className = 'settings-tab';
      btn.addEventListener('click', () => { setActiveTab(tab.id); btn.focus(); });
      btn.addEventListener('keydown', (e: KeyboardEvent) => {
        if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
          e.preventDefault();
          const next = e.key === 'ArrowDown'
            ? Math.min(idx + 1, tabDefs.length - 1)
            : Math.max(idx - 1, 0);
          setActiveTab(tabDefs[next].id);
          tabButtons[next].focus();
        } else if (e.key === 'Home') {
          e.preventDefault();
          setActiveTab(tabDefs[0].id);
          tabButtons[0].focus();
        } else if (e.key === 'End') {
          e.preventDefault();
          setActiveTab(tabDefs[tabDefs.length - 1].id);
          tabButtons[tabDefs.length - 1].focus();
        }
      });
      tabButtons.push(btn);
      nav.appendChild(btn);
    });

    // Derived from tabDefs so a newly registered tab can never be left unmounted
    // (a tab whose panel isn't appended renders as a blank pane).
    content.append(...tabDefs.map((t) => panels[t.id]));
    body.append(nav, content);

    setActiveTab(activeTab);

    // Assemble
    modal.appendChild(title);
    modal.appendChild(body);
    modal.appendChild(footer);
    overlay.appendChild(modal);
    getPortal().appendChild(overlay);

    // Dirty check for "Customize Toolbar…": compare with the values at open.
    const pristineSettings = JSON.stringify(collectModalSettings());
    isModalDirty = () => JSON.stringify(collectModalSettings()) !== pristineSettings;

    /** A small in-modal confirm: "Discard unsaved changes?" Discard runs `proceed`; Keep Editing stays. */
    function confirmDiscardChanges(returnFocus: HTMLElement, proceed: () => void): void {
      modal.querySelector('.settings-confirm-backdrop')?.remove();
      const backdrop = document.createElement('div');
      backdrop.className = 'settings-confirm-backdrop';
      const box = document.createElement('div');
      box.className = 'settings-confirm';
      box.setAttribute('role', 'alertdialog');
      box.setAttribute('aria-modal', 'true');
      const boxTitle = document.createElement('div');
      boxTitle.className = 'settings-confirm-title';
      boxTitle.id = `settings-confirm-title-${Math.random().toString(36).slice(2, 8)}`;
      boxTitle.textContent = 'Discard unsaved changes?';
      const boxText = document.createElement('div');
      boxText.className = 'settings-confirm-text';
      boxText.id = `${boxTitle.id}-text`;
      boxText.textContent = 'Customizing the toolbar closes Settings. Changes you have not saved will be lost.';
      box.setAttribute('aria-labelledby', boxTitle.id);
      box.setAttribute('aria-describedby', boxText.id);
      const actions = document.createElement('div');
      actions.className = 'settings-confirm-actions';
      const keepBtn = document.createElement('button');
      keepBtn.type = 'button';
      keepBtn.className = 'settings-btn settings-btn--secondary';
      keepBtn.textContent = 'Keep Editing';
      const discardBtn = document.createElement('button');
      discardBtn.type = 'button';
      discardBtn.className = 'settings-btn settings-btn--primary';
      discardBtn.textContent = 'Discard';
      actions.append(keepBtn, discardBtn);
      box.append(boxTitle, boxText, actions);
      backdrop.appendChild(box);
      const dismiss = (): void => { backdrop.remove(); returnFocus.focus(); };
      keepBtn.addEventListener('click', dismiss);
      discardBtn.addEventListener('click', () => { backdrop.remove(); proceed(); });
      backdrop.addEventListener('click', (e) => { if (e.target === backdrop) {dismiss();} });
      box.addEventListener('keydown', (e: KeyboardEvent) => {
        // Escape closes the confirm, not the whole modal.
        if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); dismiss(); return; }
        if (e.key === 'Tab') {
          // Keep focus on the two buttons.
          const next = document.activeElement === keepBtn ? discardBtn : keepBtn;
          e.preventDefault();
          next.focus();
        }
      });
      modal.appendChild(backdrop);
      keepBtn.focus();
    }

    // Close on backdrop click or Escape
    discardSettings = () => {
      for (const { build } of builtSections) {
        try { build.onDiscarded?.(); } catch (err) { console.error('MikeDown: settings section discard failed —', err); }
      }
    };
    overlay.addEventListener('click', (e) => { if (e.target === overlay) {closeSettingsModal();} });
    listen(document, 'keydown', function escHandler(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        // A handler left over from an earlier modal must not close this one.
        if (overlay === settingsOverlay && overlay.isConnected) {closeSettingsModal();}
        document.removeEventListener('keydown', escHandler);
      }
    });
  }

  // Behavior + Markdown tab state (seeded from the host's 'settings' broadcast).
  let currentLinkClickBehavior: 'navigateCurrentTab' | 'openNewTab' | 'showContextMenu' = 'openNewTab';
  let currentCtrlWheelZoom = true;
  let currentRenderMermaidDiagrams = true;
  let currentRenderMath = true;
  let currentTagsEnabled = true;
  let currentWikilinkCreateOnClick = false;
  let currentMarkdownNormalization: 'preserve' | 'normalize' = 'preserve';
  let currentHeadingNumbering: HeadingNumbering = 'off';

  // The stored toolbar layout (`settings.toolbarLayout`) and what it resolves
  // to: the tokens the toolbar renders and whether it is the default layout.
  let toolbarResolved = resolveToolbarLayout(options.settings?.toolbarLayout, TOOLBAR_ITEM_IDS, DEFAULT_TOOLBAR_ITEMS);
  // Toolbar edit mode state, per instance. The edit mode sets `isToolbarEditing`
  // while it runs; an incoming `toolbarLayout` is then held in
  // `pendingToolbarLayout` instead of applied (D8) and dropped when editing ends.
  const toolbarEdit: { isToolbarEditing: boolean; pendingToolbarLayout: { value: unknown } | null } = {
    isToolbarEditing: false,
    pendingToolbarLayout: null,
  };
  // Set by the open Settings modal so its Toolbar rows follow layout changes.
  let refreshToolbarSettingsRows: (() => void) | null = null;

  // The toolbar's item definitions and the layout tokens they render from
  // (see toolbar-registry.ts); set when buildCondensedToolbar runs.
  let toolbarRegistry: { defs: ToolbarItemDef[]; tokens: readonly ToolbarLayoutToken[]; rendered: string } | null = null;

  /**
   * Re-sync the toolbar with whatever decides which items exist: the host,
   * feature flags and settings (heading numbering, the AI button). Items that
   * are unavailable are not in the DOM; the toolbar is rendered again only
   * when the set of items changed, and the overflow is re-flowed either way.
   */
  function refreshToolbarAvailability(): void {
    const toolbar = shell.toolbar;
    const registry = toolbarRegistry;
    if (!toolbar || !registry) {return;}
    for (const def of registry.defs) {def.update?.();}
    // While customizing, the edit session renders from its working layout.
    if (toolbarEditSession) { toolbarEditSession.refresh(); return; }
    const next = resolveToolbarTokens(registry.defs, registry.tokens).join(' ');
    if (next !== registry.rendered) {
      registry.rendered = renderToolbar(toolbar, registry.defs, registry.tokens).join(' ');
    }
    layoutToolbarOverflow(toolbar);
  }

  /**
   * Apply a `toolbarLayout` setting: `null`, absent or invalid means the
   * default layout. Re-renders the toolbar when the visible items changed
   * (open dropdowns closed first), then re-flows the overflow. While this
   * instance is in edit mode the value is held back for when editing ends.
   */
  function applyToolbarLayout(value: unknown): void {
    if (toolbarEdit.isToolbarEditing) {
      toolbarEdit.pendingToolbarLayout = { value };
      return;
    }
    toolbarResolved = resolveToolbarLayout(value, TOOLBAR_ITEM_IDS, DEFAULT_TOOLBAR_ITEMS);
    const registry = toolbarRegistry;
    if (registry) {
      if (registry.tokens.join(' ') !== toolbarResolved.tokens.join(' ')) {hideToolbarDropdown();}
      registry.tokens = toolbarResolved.tokens;
      refreshToolbarAvailability();
    }
    refreshToolbarSettingsRows?.();
  }

  /** This instance's toolbar edit session (Customize Toolbar…), if one is running. */
  let toolbarEditSession: ToolbarEditSession | null = null;
  // destroy() while customizing: drop the tray and its listeners, save nothing.
  disposers.push(() => {
    const session = toolbarEditSession;
    toolbarEditSession = null;
    toolbarEdit.isToolbarEditing = false;
    session?.dispose();
  });

  /**
   * Turn the live toolbar into the drag-and-drop editor (toolbar-customize.ts).
   * Entry points: the Settings modal's Toolbar tab, the last entry of More ⋯
   * and the toolbar's right-click menu; all absent when
   * `features.customizeToolbar` is false. `opener` is where focus goes back on
   * Done. Done saves once (only when the layout changed) and applies the new
   * layout; without changes, a `toolbarLayout` that arrived while editing is
   * applied instead (D8).
   */
  function enterToolbarEditMode(opener: HTMLElement | null = null): void {
    const toolbar = shell.toolbar;
    const registry = toolbarRegistry;
    if (!features.customizeToolbar || !toolbar || !registry || toolbarEditSession || destroyed) {return;}
    hideToolbarDropdown();
    hideContextMenu();
    hideEmojiPicker();
    toolbarEdit.isToolbarEditing = true;
    toolbarEdit.pendingToolbarLayout = null;
    const startedFrom = toolbarResolved;
    toolbarEditSession = startToolbarEditMode({
      root,
      toolbar,
      defs: registry.defs,
      layout: startedFrom.layout,
      opener,
      onRender: (rendered, items) => {
        registry.tokens = items as ToolbarLayoutToken[];
        registry.rendered = rendered.join(' ');
      },
      save: (value) => { host.saveSettings?.({ toolbarLayout: value }); },
      onExit: ({ changed, value }) => {
        toolbarEditSession = null;
        toolbarEdit.isToolbarEditing = false;
        const pending = toolbarEdit.pendingToolbarLayout;
        toolbarEdit.pendingToolbarLayout = null;
        if (changed) {
          applyToolbarLayout(value);
        } else if (pending) {
          applyToolbarLayout(pending.value);
        } else {
          applyToolbarLayout(startedFrom.isDefault ? null : startedFrom.layout);
        }
      },
    });
  }

  // Heading numbering (#6). Wired up next to the heading-rename detector in
  // initEditor, which shares its rename tracking; these are the entry points
  // the toolbar button uses before and after that wiring runs.
  let toggleHeadingNumbers: () => void = () => {};
  // Table of contents (#11): wired next to the TOC sync in initEditor.
  let refreshTocAfterLoad: () => void = () => {};
  let currentTocStyle: TocStyle = 'list';
  let documentIsNumbered: () => boolean = () => false;

  /**
   * Apply `mikedown.headingNumbering`: remember the scheme and show the
   * toolbar toggle only while numbering is enabled.
   */
  function applyHeadingNumbering(mode: HeadingNumbering): void {
    currentHeadingNumbering = mode;
    refreshToolbarAvailability();
  }

  /** Apply `mikedown.tocStyle`: what inserting a table of contents creates. */
  function applyTocStyle(style: TocStyle): void {
    currentTocStyle = style;
    (editor.storage as unknown as Record<string, { style: TocStyle }>).tableOfContents.style = style;
  }

  // Sidebar footer link (the VS Code support appeal). Null hides it.
  let sidebarFooterLink: SidebarFooterLink | null = null;

  // ── AI (host.ai): settings, engine statuses and the footer chip ────────────
  // Inert without host.ai. Settings arrive as `settings.ai`; statuses come
  // from host.ai.listEngines (tier 2) or handle.setAiEngineStatuses; the chip
  // shows what served the last request (handle.setAiServed).
  const aiHost = features.ai ? host.ai : undefined;
  let currentAiSettings: AiSettings = defaultAiSettings();
  let aiStatuses: AiEngineStatus[] = [];
  let aiServed: { served: AiServedBy; viaFallback: boolean } | null = null;
  /** This session's cloud consent answers (grants), shared by every AI request in this editor. */
  const aiConsent: Record<string, boolean | undefined> = {};
  /** Pending waiters for a settings echo (the AI tab saving engines before a test). */
  const aiSettingsWaiters = new Set<(s: AiSettings) => void>();
  let aiStatusTimer: number | undefined;
  disposers.push(() => window.clearTimeout(aiStatusTimer));
  /** The open AI tab, listening for statuses that arrive without it asking. */
  const aiStatusListeners = new Set<(list: AiEngineStatus[]) => void>();

  function setAiStatuses(list: AiEngineStatus[]): void {
    aiStatuses = list;
    renderAiIndicator();
    for (const fn of aiStatusListeners) {fn(list);}
  }

  // VsCodeHost pushes statuses after probes and settings changes. Not part of
  // MikeDownAiHost, so only used when the host happens to offer it.
  const aiPushSource = host as MikeDownHost & { onAiEngines?: (fn: (list: AiEngineStatus[]) => void) => () => void };
  if (aiHost && typeof aiPushSource.onAiEngines === 'function') {
    const off = aiPushSource.onAiEngines((list) => { if (Array.isArray(list)) {setAiStatuses(list);} });
    if (typeof off === 'function') {disposers.push(off);}
  }

  function renderAiIndicator(): void {
    syncAiSlashCommands();
    syncAiPropertiesAvailability();
    outlineSidebar?.applyAiIndicator(aiHost
      ? aiIndicatorState({
        settings: currentAiSettings,
        statuses: aiStatuses,
        tier: aiHostTier(aiHost),
        served: aiServed?.served ?? null,
        viaFallback: aiServed?.viaFallback ?? false,
      })
      : null);
  }

  function applyAiSettings(raw: unknown): void {
    // Hosts send parsed settings; parsing again is cheap and keeps a sloppy host safe.
    currentAiSettings = parseAiSettings(raw, { onWarning: () => { /* the host already warned */ } });
    for (const waiter of [...aiSettingsWaiters]) {waiter(currentAiSettings);}
    renderAiIndicator();
    refreshAiToolbarButton();
    scheduleAiStatusRefresh();
  }

  /** Refresh engine statuses from the host (debounced: settings broadcasts come in bursts). */
  function scheduleAiStatusRefresh(): void {
    const ai = aiHost;
    if (!ai?.listEngines) {return;}
    window.clearTimeout(aiStatusTimer);
    aiStatusTimer = window.setTimeout(() => {
      ai.listEngines?.().then((list) => {
        if (destroyed) {return;}
        setAiStatuses(list);
      }).catch(() => { /* keep the last statuses */ });
    }, 150);
  }

  function waitForAiSettings(accept: (s: AiSettings) => boolean, timeoutMs: number): Promise<AiSettings | null> {
    return new Promise((resolve) => {
      const waiter = (s: AiSettings) => {
        if (!accept(s)) {return;}
        window.clearTimeout(timer);
        aiSettingsWaiters.delete(waiter);
        resolve(s);
      };
      const timer = window.setTimeout(() => {
        aiSettingsWaiters.delete(waiter);
        resolve(null);
      }, timeoutMs);
      aiSettingsWaiters.add(waiter);
    });
  }

  /** What an AI settings session (the AI tab, the AI Engines page) needs from the editor. */
  function aiSessionOptions(ai: MikeDownAiHost): AiSettingsSessionOptions {
    return {
      ai,
      settings: currentAiSettings,
      statuses: aiStatuses,
      getHostSettings: () => currentAiSettings,
      saveNow: host.saveSettings ? (patch) => host.saveSettings?.(patch, { silent: true }) : undefined,
      waitForSettings: waitForAiSettings,
      onStatuses: (list) => { aiStatuses = list; renderAiIndicator(); },
      subscribeStatuses: (fn) => {
        aiStatusListeners.add(fn);
        return () => { aiStatusListeners.delete(fn); };
      },
    };
  }

  // ── AI Engines page (overlay) ──────────────────────────────────────────────
  // ai-engines-page.ts mounted full-window in the portal, above the Settings
  // modal when opened from it. This host owns the dialog semantics: focus
  // trap, focus restore to the opener; the page owns Escape (= Back).

  /** The open AI Engines page, if any. */
  let aiPage: { overlay: HTMLElement; handle: AiEnginesPageHandle; fromModal: boolean } | null = null;

  /** Tear the page down without saving (it discards what it added). */
  function closeAiEnginesPage(): void {
    const page = aiPage;
    aiPage = null;
    if (!page) {return;}
    page.handle.dispose();
    page.overlay.remove();
  }

  function showAiEnginesPage(o: {
    initial?: { engineId?: string; section?: AiEnginesPageSection };
    /** Start from a parent session (the AI tab's draft) instead of the host's settings. */
    session?: AiSettingsSessionOptions & { keyOverride?: Map<string, boolean> };
    onDone?(patch: AiSettingsPatch, settings: AiSettings): void;
    fromModal?: boolean;
  } = {}): void {
    const ai = aiHost;
    if (!ai || aiHostTier(ai) !== 2) {return;}
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    closeAiEnginesPage();

    const overlay = document.createElement('div');
    overlay.id = 'mikedown-ai-page-overlay';
    const frame = document.createElement('div');
    frame.className = 'ai-page-frame';
    frame.setAttribute('role', 'dialog');
    frame.setAttribute('aria-modal', 'true');
    overlay.appendChild(frame);
    getPortal().appendChild(overlay);

    const finish = (): void => {
      closeAiEnginesPage();
      restoreFocus(opener);
    };
    const handle = mountAiEnginesPage(frame, settingsSectionContext(finish), {
      ...(o.session ?? aiSessionOptions(ai)),
      initial: o.initial,
      onDone: (patch, settings) => {
        if (Object.keys(patch).length > 0) {
          // The normal save path. The page may start from the tab's unsaved
          // draft, so only the keys it sends count as saved.
          host.saveSettings?.(patch);
          currentAiSettings = withSavedAiKeys(currentAiSettings, settings, patch);
          renderAiIndicator();
          scheduleAiStatusRefresh();
        }
        o.onDone?.(patch, settings);
        finish();
      },
      onCancel: finish,
    });
    aiPage = { overlay, handle, fromModal: !!o.fromModal };
    const titleId = frame.querySelector('.ai-page-title')?.id;
    if (titleId) {frame.setAttribute('aria-labelledby', titleId);}
    frame.addEventListener('keydown', (e) => { if (e.key === 'Tab') {trapTab(frame, e);} });
    handle.focus();
  }

  /** Keep Tab inside `scope` (the page is modal). */
  function trapTab(scope: HTMLElement, e: KeyboardEvent): void {
    const focusables = Array.from(scope.querySelectorAll<HTMLElement>(
      'a[href], button, input, select, textarea, [tabindex]:not([tabindex="-1"])',
    )).filter((n) => !(n as HTMLButtonElement).disabled && !n.closest('[inert], [hidden]') && n.getClientRects().length > 0);
    if (focusables.length === 0) {
      e.preventDefault();
      return;
    }
    const first = focusables[0];
    const last = focusables[focusables.length - 1];
    const active = document.activeElement;
    if (e.shiftKey && (active === first || !scope.contains(active))) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && (active === last || !scope.contains(active))) {
      e.preventDefault();
      first.focus();
    }
  }

  /** Focus back where the page was opened from; a re-rendered opener is found again by its `data-fk`. */
  function restoreFocus(opener: HTMLElement | null): void {
    if (!opener) {return;}
    if (opener.isConnected) {
      opener.focus({ preventScroll: true });
      return;
    }
    const fk = opener.dataset.fk;
    const again = fk && settingsOverlay?.isConnected
      ? Array.from(settingsOverlay.querySelectorAll<HTMLElement>('[data-fk]')).find((n) => n.dataset.fk === fk)
      : undefined;
    again?.focus({ preventScroll: true });
  }

  /** The sidebar chip: the AI tab, or the page when nothing can be routed. */
  function openAiFromChip(): void {
    const ai = aiHost;
    if (!ai) {return;}
    const state = aiIndicatorState({ settings: currentAiSettings, statuses: aiStatuses, tier: aiHostTier(ai), served: aiServed?.served ?? null, viaFallback: aiServed?.viaFallback ?? false });
    if (state?.tone === 'none' && aiHostTier(ai) === 2) {
      showAiEnginesPage({ initial: currentAiSettings.engines.length > 0 ? { section: 'routing' } : undefined });
    } else {
      showSettingsModal('ai');
    }
  }

  /** Whether the rewrite entry points show: hidden, disabled with a reason, or enabled. */
  function aiRewriteAvailability(): AiFeatureAvailability {
    if (readOnly) {return { state: 'hidden' };}
    return aiFeatureAvailability(aiHost, currentAiSettings, aiStatuses, aiConsent, 'rewrite');
  }

  /** Whether `/summary` or `/title` can run (read-only is the callers' to check). */
  function aiDocAvailability(feature: 'summary' | 'title' | 'frontmatter'): AiFeatureAvailability {
    return aiFeatureAvailability(aiHost, currentAiSettings, aiStatuses, aiConsent, feature);
  }

  /**
   * The `ai` slash group shows only while its feature is available (D15:
   * hidden and disabled both hide; the reason is in the AI menu). The hidden
   * set is shared by every editor on the page, so focus syncs it again.
   */
  function syncAiSlashCommands(): void {
    const hidden = [...hiddenSlashCommands];
    for (const feature of ['summary', 'title'] as const) {
      if (aiDocAvailability(feature).state !== 'enabled') {hidden.push(...AI_SLASH_COMMANDS[feature]);}
    }
    setSlashHiddenCommands(hidden);
  }

  // ── Toolbar AI button ──────────────────────────────────────────────────────
  // Only for a host with AI support; ai.showToolbarButton hides it. AI off:
  // the first-run panel. AI on: a menu of AI actions and Manage engines….

  /** Match the button's popup type to the current settings (first-run panel or menu). */
  function syncAiToolbarPopup(btn: HTMLButtonElement): void {
    const popup = aiToolbarButtonMode(!!aiHost, currentAiSettings) === 'firstRun' ? 'dialog' : 'menu';
    if (btn.getAttribute('aria-haspopup') !== popup) {btn.setAttribute('aria-haspopup', popup);}
  }

  /** Show or hide the button for the current settings, and reflow the toolbar. */
  function refreshAiToolbarButton(): void {
    if (aiToolbarButtonMode(!!aiHost, currentAiSettings) === 'hidden') {hideAiFirstRunPanel();}
    refreshToolbarAvailability();
  }

  /** "Turn on and set up": AI on through the normal save path, then setup. */
  function turnOnAiAndSetUp(): void {
    const ai = aiHost;
    if (!ai || destroyed) {return;}
    host.saveSettings?.({ ...AI_TURN_ON_PATCH });
    currentAiSettings = { ...currentAiSettings, enabled: true };
    renderAiIndicator();
    refreshAiToolbarButton();
    scheduleAiStatusRefresh();
    const target = aiSetupTarget(aiHostTier(ai), currentAiSettings);
    if (target.kind === 'page') {
      showAiEnginesPage(target.engineId ? { initial: { engineId: target.engineId } } : {});
    } else {
      showSettingsModal('ai');
    }
  }

  /** Whether the editor (or source view) has a non-empty selection. */
  function hasTextSelection(): boolean {
    if (sourceMode) {return !!cmView && !cmView.state.selection.main.empty;}
    return !editor.state.selection.empty;
  }

  /** The AI button's click, anchored to `anchor` (the More button when it overflowed). */
  function openAiToolbar(anchor: HTMLElement): void {
    const ai = aiHost;
    if (!ai) {return;}
    if (isAiFirstRunPanelOpen()) { hideAiFirstRunPanel(); return; }
    if (isToolbarDropdownOpen()) { hideToolbarDropdown(); return; }
    const mode = aiToolbarButtonMode(true, currentAiSettings);
    if (mode === 'firstRun') {
      showAiFirstRunPanel({ anchor, onTurnOn: turnOnAiAndSetUp });
      return;
    }
    const availability = aiRewriteAvailability();
    const rewrite = readOnly ? null
      : availability.state === 'hidden' ? { enabled: false as const, hint: 'Off in AI settings' }
        : availability.state === 'disabled' ? { enabled: false as const, hint: 'No engine available' }
          : !hasTextSelection() ? { enabled: false as const, hint: 'Select text first' }
            : { enabled: true as const };
    // Summarize and Suggest titles: left out when off, disabled with the router's reason (D15).
    const docEntry = (feature: 'summary' | 'title') => {
      if (readOnly) {return null;}
      const a = aiDocAvailability(feature);
      return a.state === 'hidden' ? null
        : a.state === 'disabled' ? { enabled: false as const, hint: a.reason }
          : { enabled: true as const };
    };
    const tier2 = aiHostTier(ai) === 2;
    showToolbarDropdown(anchor, aiToolbarMenuEntries({
      rewrite,
      summarize: docEntry('summary'),
      titles: docEntry('title'),
      canManageEngines: tier2,
      icons: { rewrite: toolbarIcons.rewrite, manage: toolbarIcons.gear, summarize: toolbarIcons.toc, titles: toolbarIcons.ai },
      onRewrite: () => { startAiRewrite(); },
      onSummarize: () => { startAiSummary(); },
      onSuggestTitles: () => { startAiTitles(); },
      onManage: () => { if (tier2) {showAiEnginesPage();} else {showSettingsModal('ai');} },
    }));
  }
  disposers.push(() => hideAiFirstRunPanel());
  // This editor's own sidebar (null when features.sidebar is off).
  let outlineSidebar: OutlineSidebar | null = null;

  // Slash-commands settings (M5). Matches the `mikedown.slashCommands.*`
  // defaults in package.json until the host's first 'settings' broadcast.
  let currentSlashCommandsEnabled = true;
  let currentSlashCommandsDateFormat: 'iso' | 'long' = 'iso';
  let currentSlashCommandsTimeZone = 'local';

  // Spelling tab state. `userWords` is the persisted custom dictionary; the
  // checker keeps its own copy so "Add to Dictionary" takes effect immediately
  // instead of waiting for the settings round-trip.
  // Matches the `mikedown.spellCheck.enabled` default in package.json — off
  // until the host's first `settings` broadcast says otherwise, so a disabled
  // user never sees a flash of squiggles on open.
  let currentSpellCheckEnabled = false;
  let currentSpellCheckLanguage: SpellCheckLanguage = 'en';
  let currentSpellCheckIgnoreCodeBlocks = true;
  let currentSpellCheckUserWords: string[] = [];
  /** Read-only words inherited from cSpell — accepted by the checker, but never
   *  shown in the Spelling tab or written back to MikeDown's own list. */
  let currentSpellCheckExternalWords: string[] = [];
  type NormalizationStyleSettings = NormalizationStyle;
  let currentNormalizationStyle: NormalizationStyleSettings = {
    boldMarker: '**',
    italicMarker: '*',
    listMarker: '-',
    headingStyle: 'atx',
  };

// Webview-URI → fs-path mappings broadcast by the host with each 'settings'
  // message. Used to display image srcs in their on-disk relative form (the
  // image popover in particular). Empty until the first broadcast lands.
  const createPolicyImage = () => Image.extend({
    addAttributes() {
      return {
        ...this.parent?.(),
        src: {
          default: null,
          // Prefer the raw path a prior render recorded, so copy and paste
          // never bakes a resolved URL into the stored markdown.
          parseHTML: (el: HTMLElement) => el.getAttribute('data-mikedown-src') ?? el.getAttribute('src'),
          renderHTML: (attrs: Record<string, unknown>) => {
            const raw = typeof attrs.src === 'string' ? attrs.src : '';
            const rendered = resolveImageRenderSrc(raw, host);
            if (rendered === null) {
              return { 'data-mikedown-src': raw, class: 'broken-image' };
            }
            return rendered === raw ? { src: raw } : { src: rendered, 'data-mikedown-src': raw };
          },
        },
        // The image's own title wins; an unresolved image falls back to a
        // "not found" tooltip carrying the raw path.
        title: {
          default: null,
          parseHTML: (el: HTMLElement) => el.getAttribute('title'),
          renderHTML: (attrs: Record<string, unknown>) => {
            if (attrs.title) {return { title: attrs.title };}
            const raw = typeof attrs.src === 'string' ? attrs.src : '';
            return resolveImageRenderSrc(raw, host) === null ? { title: `Image not found: ${raw}` } : {};
          },
        },
      };
    },
  });
  let imagePathMappings: ImagePathPrefix[] = [];
  let docDirFsPath = '';

  function isDarkTheme(): boolean {
    return isDarkScheme(root);
  }

  function toggleTheme(): void {
    // Delegate to the host when it can (VS Code handles both scopes, persists
    // the setting and broadcasts to all open tabs); otherwise flip locally.
    if (host.toggleTheme) {
      host.toggleTheme();
      return;
    }
    const next = isDarkTheme() ? 'light' : 'dark';
    applyEditorTheme(next);
    host.saveSettings?.({ editorTheme: next }, { silent: true });
  }

  /**
   * Apply the editorTheme setting ('auto' | 'light' | 'dark') as
   * data-mikedown-theme on the root. 'auto' follows the host: the OS
   * preference by default, the VS Code theme in the VS Code shell.
   */
  function applyEditorTheme(editorTheme: string): void {
    const theme = editorTheme === 'light' || editorTheme === 'dark' ? editorTheme : 'auto';
    root.setAttribute('data-mikedown-theme', theme);
    syncPortal();
    updateThemeToggleIcon();
    refreshCmScheme();
  }

  function updateThemeToggleIcon(): void {
    const btn = shell.toolbar?.querySelector('button[data-action="themeToggle"]');
    if (!btn) {return;}
    const dark = isDarkTheme();
    const mkSvg = (d: string, sw = 1.8) => `<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="${sw}" stroke-linecap="round" stroke-linejoin="round">${d}</svg>`;
    btn.innerHTML = dark
      ? mkSvg('<circle cx="8" cy="8" r="3"/><path d="M8 1.5v1.5M8 13v1.5M1.5 8H3M13 8h1.5M3.4 3.4l1.06 1.06M11.54 11.54l1.06 1.06M3.4 12.6l1.06-1.06M11.54 4.46l1.06-1.06"/>')
      : mkSvg('<path d="M13.5 8a5.5 5.5 0 0 1-8.38 4.68A5.5 5.5 0 0 1 8 2.5c0 .5.05 1 .16 1.47A4.5 4.5 0 0 0 13.5 8z"/>');
    (btn as HTMLElement).title = dark ? 'Switch to Light Mode' : 'Switch to Dark Mode';
  }

  // Host theme changes ('auto'): hosts such as VS Code swap a theme class on
  // <body>. OS color-scheme flips are handled with the Mermaid refresh below.
  observe(new MutationObserver(updateThemeToggleIcon), document.body, {
    attributes: true,
    attributeFilter: ['class'],
  });

  // ── M3: Toolbar builder ────────────────────────────────────────────────────────

  type ToolbarButtonDef =
    | { separator: true }
    | {
        id: string;
        title: string;
        icon: string;
        action: () => void;
        isActive: () => boolean;
      };

  // eslint-disable-next-line @typescript-eslint/no-unused-vars -- superseded by buildCondensedToolbar below (no call sites); left in place for reference rather than deleted
  function buildToolbar(editor: Editor): void {
    const toolbar = shell.toolbar;
    if (!toolbar) {return;}
    toolbar.classList.remove('toolbar-condensed');

    const icons = toolbarIcons;

    const buttons: ToolbarButtonDef[] = [
      { id: 'bold', title: 'Bold (Cmd+B)', icon: icons.bold, action: () => editor.chain().focus().toggleBold().run(), isActive: () => editor.isActive('bold') },
      { id: 'italic', title: 'Italic (Cmd+I)', icon: icons.italic, action: () => editor.chain().focus().toggleItalic().run(), isActive: () => editor.isActive('italic') },
      { id: 'strike', title: 'Strikethrough', icon: icons.strike, action: () => editor.chain().focus().toggleStrike().run(), isActive: () => editor.isActive('strike') },
      { id: 'highlight', title: 'Highlight (Cmd+Shift+H)', icon: icons.highlight, action: () => editor.chain().focus().toggleHighlight().run(), isActive: () => editor.isActive('highlight') },
      { id: 'code', title: 'Inline Code', icon: icons.code, action: () => editor.chain().focus().toggleCode().run(), isActive: () => editor.isActive('code') },
      { id: 'emoji', title: 'Insert Emoji (Cmd+;)', icon: icons.emoji, action: () => {
        const btn = toolbar.querySelector('button[data-action="emoji"]');
        if (isEmojiPickerOpen()) { hideEmojiPicker(); return; }
        showEmojiPicker(editor, btn ? { anchorRect: btn.getBoundingClientRect() } : {});
      }, isActive: () => isEmojiPickerOpen() },
      { separator: true },
      { id: 'h1', title: 'Heading 1', icon: '<span style="font-weight:700;font-size:14px">H<sub style="font-size:9px">1</sub></span>', action: () => editor.chain().focus().toggleHeading({ level: 1 }).run(), isActive: () => editor.isActive('heading', { level: 1 }) },
      { id: 'h2', title: 'Heading 2', icon: '<span style="font-weight:600;font-size:13px">H<sub style="font-size:9px">2</sub></span>', action: () => editor.chain().focus().toggleHeading({ level: 2 }).run(), isActive: () => editor.isActive('heading', { level: 2 }) },
      { id: 'h3', title: 'Heading 3', icon: '<span style="font-weight:500;font-size:12px">H<sub style="font-size:8px">3</sub></span>', action: () => editor.chain().focus().toggleHeading({ level: 3 }).run(), isActive: () => editor.isActive('heading', { level: 3 }) },
      { separator: true },
      { id: 'bulletList', title: 'Bullet List', icon: icons.ul, action: () => editor.chain().focus().toggleBulletList().run(), isActive: () => editor.isActive('bulletList') },
      { id: 'orderedList', title: 'Ordered List', icon: icons.ol, action: () => editor.chain().focus().toggleOrderedList().run(), isActive: () => editor.isActive('orderedList') },
      { id: 'taskList', title: 'Task List', icon: icons.task, action: () => editor.chain().focus().toggleTaskList().run(), isActive: () => editor.isActive('taskList') },
      { id: 'blockquote', title: 'Blockquote', icon: icons.quote, action: () => editor.chain().focus().toggleBlockquote().run(), isActive: () => editor.isActive('blockquote') },
      { id: 'codeBlock', title: 'Code Block', icon: icons.codeBlock, action: () => editor.chain().focus().toggleCodeBlock().run(), isActive: () => editor.isActive('codeBlock') },
      { separator: true },
      { id: 'link', title: 'Insert Link (Cmd+K)', icon: icons.link, action: () => showLinkDialog(editor), isActive: () => editor.isActive('link') },
      { id: 'image', title: 'Insert Image', icon: icons.image, action: () => showImageInsertDialog(editor), isActive: () => false },
      { id: 'table', title: 'Insert Table', icon: icons.table, action: () => editor.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run(), isActive: () => editor.isActive('table') },
      { id: 'hr', title: 'Horizontal Rule', icon: icons.hr, action: () => editor.chain().focus().setHorizontalRule().run(), isActive: () => false },
      { separator: true },
      { id: 'undo', title: 'Undo (Cmd+Z)', icon: icons.undo, action: () => doUndo(editor), isActive: () => false },
      { id: 'redo', title: 'Redo (Cmd+Shift+Z)', icon: icons.redo, action: () => doRedo(editor), isActive: () => false },
      { separator: true },
      { id: 'sourceToggle', title: 'Toggle Source Mode (Cmd+/)', icon: icons.source, action: () => toggleSourceMode(), isActive: () => false },
      { separator: true },
      { id: 'viewInBrowser', title: 'View in Browser', icon: icons.browser, action: () => host.viewInBrowser?.(getHtml()), isActive: () => false },
      { id: 'print', title: 'Print / Export as PDF', icon: icons.print, action: () => host.printDocument?.(getHtml()), isActive: () => false },
      { separator: true },
      { id: 'themeToggle', title: 'Toggle Light/Dark Mode', icon: icons.sun, action: () => toggleTheme(), isActive: () => false },
      { id: 'settings', title: 'Settings', icon: icons.gear, action: () => showSettingsModal(), isActive: () => false },
    ];

    toolbar.innerHTML = buttons.map(btn => {
      if ((btn as { separator?: boolean }).separator) {
        return '<div class="toolbar-separator" role="separator"></div>';
      }
      const b = btn as { id: string; title: string; icon: string };
      return `<button data-action="${b.id}" data-tip="${b.title}" aria-label="${b.title}" tabindex="0">${b.icon}</button>`;
    }).join('');

    // Wire click handlers
    toolbar.addEventListener('click', (e) => {
      const target = (e.target as HTMLElement).closest('button[data-action]') as HTMLButtonElement | null; // eslint-disable-line @typescript-eslint/no-unnecessary-type-assertion -- dead code (buildToolbar is unused, superseded by buildCondensedToolbar); leaving assertions as-is rather than risk-editing unreachable code
      if (!target) {return;}
      // M5b — Table button opens grid picker instead of directly inserting
      if (target.dataset.action === 'table') {
        showTableGridPicker(editor, target);
        return;
      }
      const btn = buttons.find(b => !('separator' in b) && (b as { id: string }).id === target.dataset.action);
      if (btn && 'action' in btn) {btn.action();}
    });

    // Keyboard accessibility: activate buttons via Enter or Space
    toolbar.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter' && e.key !== ' ') {return;}
      const target = (e.target as HTMLElement).closest('button[data-action]') as HTMLButtonElement | null; // eslint-disable-line @typescript-eslint/no-unnecessary-type-assertion -- dead code (buildToolbar is unused, superseded by buildCondensedToolbar); leaving assertions as-is rather than risk-editing unreachable code
      if (!target) {return;}
      e.preventDefault();
      target.click();
    });
  }

  // ── Condensed Toolbar (Apple Notes-style) ───────────────────────────────────

  function buildCondensedToolbar(editor: Editor): void {
    const toolbar = shell.toolbar;
    if (!toolbar) {return;}
    toolbar.classList.add('toolbar-condensed');
    toolbar.innerHTML = '';

    const icons = toolbarIcons;

    // Helper: get current block type label for the text format button
    function getBlockLabel(): string {
      for (let level = 1; level <= 6; level++) {
        if (editor.isActive('heading', { level })) {return `H${level}`;}
      }
      return 'Aa';
    }

    // Helper: check if any inline mark or heading is active (for text format button highlight)
    function isTextFormatActive(): boolean {
      return editor.isActive('bold') || editor.isActive('italic') ||
             editor.isActive('strike') || editor.isActive('code') ||
             editor.isActive('heading');
    }

    // Helper: check if any list/block type is active
    function isBlockActive(): boolean {
      return editor.isActive('bulletList') || editor.isActive('orderedList') ||
             editor.isActive('taskList') || editor.isActive('blockquote') ||
             editor.isActive('codeBlock');
    }

    // Helper to create a toolbar button
    function makeBtn(id: string, title: string, innerHTML: string): HTMLButtonElement {
      const btn = document.createElement('button');
      btn.dataset.action = id;
      btn.dataset.tip = title;
      btn.setAttribute('aria-label', title);
      btn.tabIndex = 0;
      btn.innerHTML = innerHTML;
      return btn;
    }

    // Helper to make a dropdown trigger (button with chevron)
    function makeDropdownTrigger(id: string, title: string, labelHtml: string): HTMLButtonElement {
      const btn = makeBtn(id, title, `<span class="condensed-btn-label">${labelHtml}</span><span class="condensed-chevron">${icons.chevron}</span>`);
      btn.classList.add('condensed-dropdown-trigger');
      return btn;
    }

    // How a button runs from the More menu when it has overflowed: dropdown
    // triggers and the emoji picker open against the More button (their own
    // button is hidden), everything else is a plain click.
    const overflowOpeners = new Map<HTMLElement, (anchor: HTMLElement) => void>();

    /** A dropdown trigger: click toggles its menu, anchored to `anchor`. */
    function wireDropdown(btn: HTMLButtonElement, open: (anchor: HTMLElement) => void): void {
      overflowOpeners.set(btn, open);
      btn.addEventListener('click', () => {
        if (isToolbarDropdownOpen()) { hideToolbarDropdown(); return; }
        open(btn);
      });
    }

    // Elements the selection-change refresh touches (set when an item renders).
    const refs: { textFormat?: HTMLButtonElement; listBlock?: HTMLButtonElement; link?: HTMLButtonElement; headingNumbers?: HTMLButtonElement; ai?: HTMLButtonElement } = {};

    const textFormatDef: ToolbarItemDef = {
      id: 'textFormat', label: 'Text Format', kind: 'dropdown',
      pinned: 'first', removable: false,
      render: () => {
        // ── Text Format dropdown (Aa ▾) ─────────────────────────────────────────
        const textFormatBtn = makeDropdownTrigger('textFormat', 'Text Format', getBlockLabel());
        // The accessible name includes the visible label ("Aa", "H1"; WCAG 2.5.3).
        textFormatBtn.setAttribute('aria-label', `${getBlockLabel()} Text Format`);
        wireDropdown(textFormatBtn, (anchor) => {
          showToolbarDropdown(anchor, [
            { type: 'action', id: 'h1', label: 'Heading 1', icon: '<span style="font-weight:700;font-size:14px">H1</span>', isActive: () => editor.isActive('heading', { level: 1 }), action: () => editor.chain().focus().toggleHeading({ level: 1 }).run() },
            { type: 'action', id: 'h2', label: 'Heading 2', icon: '<span style="font-weight:600;font-size:13px">H2</span>', isActive: () => editor.isActive('heading', { level: 2 }), action: () => editor.chain().focus().toggleHeading({ level: 2 }).run() },
            { type: 'action', id: 'h3', label: 'Heading 3', icon: '<span style="font-weight:500;font-size:12px">H3</span>', isActive: () => editor.isActive('heading', { level: 3 }), action: () => editor.chain().focus().toggleHeading({ level: 3 }).run() },
            { type: 'action', id: 'h4', label: 'Heading 4', icon: '<span style="font-weight:500;font-size:11px">H4</span>', isActive: () => editor.isActive('heading', { level: 4 }), action: () => editor.chain().focus().toggleHeading({ level: 4 }).run() },
            { type: 'action', id: 'h5', label: 'Heading 5', icon: '<span style="font-weight:500;font-size:11px">H5</span>', isActive: () => editor.isActive('heading', { level: 5 }), action: () => editor.chain().focus().toggleHeading({ level: 5 }).run() },
            { type: 'action', id: 'h6', label: 'Heading 6', icon: '<span style="font-weight:500;font-size:11px">H6</span>', isActive: () => editor.isActive('heading', { level: 6 }), action: () => editor.chain().focus().toggleHeading({ level: 6 }).run() },
            { type: 'action', id: 'paragraph', label: 'Paragraph', action: () => editor.chain().focus().setParagraph().run(), isActive: () => !editor.isActive('heading') && !editor.isActive('codeBlock') },
            { type: 'separator' },
            { type: 'mini-row', items: [
              { id: 'bold', icon: icons.bold, title: 'Bold', isActive: () => editor.isActive('bold'), action: () => editor.chain().focus().toggleBold().run() },
              { id: 'italic', icon: icons.italic, title: 'Italic', isActive: () => editor.isActive('italic'), action: () => editor.chain().focus().toggleItalic().run() },
              { id: 'strike', icon: icons.strike, title: 'Strikethrough', isActive: () => editor.isActive('strike'), action: () => editor.chain().focus().toggleStrike().run() },
              { id: 'highlight', icon: icons.highlight, title: 'Highlight', isActive: () => editor.isActive('highlight'), action: () => editor.chain().focus().toggleHighlight().run() },
              { id: 'code', icon: icons.code, title: 'Inline Code', isActive: () => editor.isActive('code'), action: () => editor.chain().focus().toggleCode().run() },
            ]},
          ]);
        });
        refs.textFormat = textFormatBtn;
        return textFormatBtn;
      },
      update: () => {
        const btn = refs.textFormat;
        if (!btn) {return;}
        // Update the text format button label to reflect current block type
        const labelEl = btn.querySelector('.condensed-btn-label');
        const blockLabel = getBlockLabel();
        if (labelEl && labelEl.innerHTML !== blockLabel) {labelEl.innerHTML = blockLabel;}
        btn.setAttribute('aria-label', `${blockLabel} Text Format`);
        btn.classList.toggle('active', isTextFormatActive());
      },
    };

    const listBlockDef: ToolbarItemDef = {
      id: 'listBlock', label: 'Lists & Blocks', kind: 'dropdown',
      removable: true,
      render: () => {
        // ── List & Block dropdown (≡ ▾) ─────────────────────────────────────────
        const listBlockBtn = makeDropdownTrigger('listBlock', 'Lists & Blocks', icons.ul);
        wireDropdown(listBlockBtn, (anchor) => {
          showToolbarDropdown(anchor, [
            { type: 'action', id: 'bulletList', label: 'Bullet List', icon: icons.ul, isActive: () => editor.isActive('bulletList'), action: () => editor.chain().focus().toggleBulletList().run() },
            { type: 'action', id: 'orderedList', label: 'Ordered List', icon: icons.ol, isActive: () => editor.isActive('orderedList'), action: () => editor.chain().focus().toggleOrderedList().run() },
            { type: 'action', id: 'taskList', label: 'Task List', icon: icons.task, isActive: () => editor.isActive('taskList'), action: () => editor.chain().focus().toggleTaskList().run() },
            { type: 'separator' },
            { type: 'action', id: 'blockquote', label: 'Blockquote', icon: icons.quote, isActive: () => editor.isActive('blockquote'), action: () => editor.chain().focus().toggleBlockquote().run() },
            { type: 'action', id: 'codeBlock', label: 'Code Block', icon: icons.codeBlock, isActive: () => editor.isActive('codeBlock'), action: () => editor.chain().focus().toggleCodeBlock().run() },
            { type: 'separator' },
            // Five GitHub-style callouts — one click each, kind picked via the
            // mini-row of badge-style buttons so the user doesn't have to remember
            // the marker syntax.
            { type: 'action', id: 'callout', label: 'Callout', icon: icons.callout, isActive: () => editor.isActive('callout'), action: () => editor.chain().focus().toggleCallout('note').run() },
            { type: 'mini-row', items: CALLOUT_KINDS.map((kind) => ({
              id: `callout-${kind}`,
              icon: calloutBadgeIcon(kind),
              title: calloutKindLabel(kind),
              isActive: () => editor.isActive('callout', { kind }),
              action: () => editor.chain().focus().toggleCallout(kind).run(),
            })) },
          ]);
        });
        refs.listBlock = listBlockBtn;
        return listBlockBtn;
      },
      update: () => {
        refs.listBlock?.classList.toggle('active', isBlockActive());
      },
    };

    const linkDef: ToolbarItemDef = {
      id: 'link', label: 'Insert Link', kind: 'button',
      removable: true,
      render: () => {
        // ── Link (direct action) ────────────────────────────────────────────────
        const linkBtn = makeBtn('link', 'Insert Link (Cmd+K)', icons.link);
        linkBtn.addEventListener('click', () => showLinkDialog(editor));
        refs.link = linkBtn;
        return linkBtn;
      },
      update: () => {
        refs.link?.classList.toggle('active', editor.isActive('link'));
      },
    };

    const insertDef: ToolbarItemDef = {
      id: 'insert', label: 'Insert', kind: 'dropdown',
      removable: true,
      render: () => {
        // ── Insert dropdown (Image, Table, HR) ──────────────────────────────────
        const insertBtn = makeDropdownTrigger('insert', 'Insert', icons.image);
        wireDropdown(insertBtn, (anchor) => {
          showToolbarDropdown(anchor, [
            { type: 'action', id: 'image', label: 'Image', icon: icons.image, action: () => showImageInsertDialog(editor) },
            { type: 'action', id: 'table', label: 'Table', icon: icons.table, isActive: () => editor.isActive('table'), action: () => showTableGridPicker(editor, anchor) },
            { type: 'action', id: 'hr', label: 'Horizontal Rule', icon: icons.hr, action: () => editor.chain().focus().setHorizontalRule().run() },
            { type: 'action', id: 'toc', label: 'Table of Contents', icon: icons.toc, action: () => editor.chain().focus().insertTableOfContents().run() },
          ]);
        });
        return insertBtn;
      },
    };

    const emojiDef: ToolbarItemDef = {
      id: 'emoji', label: 'Insert Emoji', kind: 'button',
      removable: true,
      render: () => {
        const emojiBtn = makeBtn('emoji', 'Insert Emoji (Cmd+;)', icons.emoji);
        emojiBtn.addEventListener('mousedown', (e) => e.preventDefault());
        const openEmoji = (anchor: HTMLElement) => {
          if (isEmojiPickerOpen()) { hideEmojiPicker(); return; }
          showEmojiPicker(editor, { anchorRect: anchor.getBoundingClientRect() });
        };
        overflowOpeners.set(emojiBtn, openEmoji);
        emojiBtn.addEventListener('click', () => openEmoji(emojiBtn));
        return emojiBtn;
      },
    };

    // ── Number headings (only while mikedown.headingNumbering is on) ─────────
    const headingNumbersDef: ToolbarItemDef = {
      id: 'headingNumbers', label: 'Number Headings', kind: 'button', removable: true,
      available: () => currentHeadingNumbering !== 'off',
      render: () => {
        const headingNumbersBtn = makeBtn('headingNumbers', 'Number Headings', icons.headingNumbers);
        headingNumbersBtn.addEventListener('mousedown', (e) => e.preventDefault());
        headingNumbersBtn.addEventListener('click', () => toggleHeadingNumbers());
        refs.headingNumbers = headingNumbersBtn;
        return headingNumbersBtn;
      },
      update: () => {
        refs.headingNumbers?.classList.toggle('active', currentHeadingNumbering !== 'off' && documentIsNumbered());
      },
    };

    // ── AI (hosts with AI support; see refreshAiToolbarButton) ──────────────
    const aiDef: ToolbarItemDef = {
      id: 'ai', label: 'AI Actions', kind: 'button', removable: true,
      // Never there for a host without AI support; ai.showToolbarButton hides it.
      available: () => !!aiHost && aiToolbarButtonMode(!!aiHost, currentAiSettings) !== 'hidden',
      render: () => {
        const aiBtn = makeBtn('ai', 'AI Actions', icons.ai);
        // Keep the editor's selection: Rewrite selection acts on it.
        aiBtn.addEventListener('mousedown', (e) => e.preventDefault());
        overflowOpeners.set(aiBtn, (anchor) => openAiToolbar(anchor));
        aiBtn.addEventListener('click', () => openAiToolbar(aiBtn));
        syncAiToolbarPopup(aiBtn);
        refs.ai = aiBtn;
        return aiBtn;
      },
      update: () => { if (refs.ai) {syncAiToolbarPopup(refs.ai);} },
    };

    const undoDef: ToolbarItemDef = {
      id: 'undo', label: 'Undo', kind: 'button',
      removable: true,
      render: () => {
        const undoBtn = makeBtn('undo', 'Undo (Cmd+Z)', icons.undo);
        undoBtn.addEventListener('click', () => doUndo(editor));
        return undoBtn;
      },
    };

    const redoDef: ToolbarItemDef = {
      id: 'redo', label: 'Redo', kind: 'button',
      removable: true,
      render: () => {
        const redoBtn = makeBtn('redo', 'Redo (Cmd+Shift+Z)', icons.redo);
        redoBtn.addEventListener('click', () => doRedo(editor));
        return redoBtn;
      },
    };

    const sourceToggleDef: ToolbarItemDef = {
      id: 'sourceToggle', label: 'Toggle Source Mode', kind: 'button',
      removable: true,
      available: () => features.sourceMode,
      render: () => {
        const sourceBtn = makeBtn('sourceToggle', 'Toggle Source Mode (Cmd+/)', icons.source);
        // The core toggles locally (the old host round-trip was a pure echo).
        sourceBtn.addEventListener('click', () => toggleSourceMode());
        return sourceBtn;
      },
    };

    const shareDef: ToolbarItemDef = {
      id: 'share', label: 'Share', kind: 'dropdown',
      removable: true,
      available: () => !!(host.viewInBrowser || host.printDocument),
      render: () => {
        // ── Share dropdown (View in Browser, Print / Export as PDF) ─────────────
        const shareBtn = makeDropdownTrigger('share', 'Share', icons.share);
        wireDropdown(shareBtn, (anchor) => {
          // Only the outputs the host can handle.
          showToolbarDropdown(anchor, [
            ...(host.viewInBrowser ? [{ type: 'action' as const, id: 'viewInBrowser', label: 'View in Browser', icon: icons.browser, action: () => {
              host.viewInBrowser?.(getHtml());
            }}] : []),
            ...(host.printDocument ? [{ type: 'action' as const, id: 'print', label: 'Print / Export as PDF', icon: icons.print, action: () => {
              host.printDocument?.(getHtml());
            }}] : []),
          ]);
        });
        return shareBtn;
      },
    };

    const selectAllDef: ToolbarItemDef = {
      id: 'selectAll', label: 'Select All', kind: 'button',
      removable: true,
      render: () => {
        // Select All toolbar button — calls the same TextSelection helper the
        // Cmd+A keydown handler uses. Added as a keyboard-free way to trigger
        // select-all: if this button works but Cmd+A still fails, we know the
        // failure is in keystroke routing (VS Code eating the event, or PM's
        // Mod-a keymap still running behind our back), not in the select-all
        // command itself.
        const selectAllBtn = makeBtn('selectAll', 'Select All', icons.selectAll);
        // Stop mousedown from stealing focus out of the editor — otherwise the
        // click lands on the button, the editor blurs, and focus handling gets
        // messy afterwards.
        selectAllBtn.addEventListener('mousedown', (e) => e.preventDefault());
        selectAllBtn.addEventListener('click', () => {
          selectAllDocument(editor);
        });
        return selectAllBtn;
      },
    };

    // ── Zoom control (− size +) — same controller as Ctrl/Cmd + wheel ───────
    // One item: a wrapper holding the three buttons, so it moves and overflows as one.
    const zoomDef: ToolbarItemDef = {
      id: 'zoom', label: 'Zoom', kind: 'group', removable: true,
      render: () => {
        const zoomOutBtn = makeBtn('zoomOut', 'Zoom Out', icons.zoomOut);
        zoomOutBtn.addEventListener('mousedown', (e) => e.preventDefault());
        zoomOutBtn.addEventListener('click', () => fontZoom.stepBy(-1));
        const zoomResetBtn = makeBtn('zoomReset', 'Reset Zoom', '');
        zoomResetBtn.classList.add('toolbar-zoom-size');
        zoomResetBtn.addEventListener('mousedown', (e) => e.preventDefault());
        zoomResetBtn.addEventListener('click', () => fontZoom.reset());
        const zoomInBtn = makeBtn('zoomIn', 'Zoom In', icons.zoomIn);
        zoomInBtn.addEventListener('mousedown', (e) => e.preventDefault());
        zoomInBtn.addEventListener('click', () => fontZoom.stepBy(1));
        const group = document.createElement('div');
        group.className = 'toolbar-group';
        group.dataset.action = 'zoom';
        group.setAttribute('role', 'group');
        group.setAttribute('aria-label', 'Zoom');
        group.append(zoomOutBtn, zoomResetBtn, zoomInBtn);
        return group;
      },
    };

    const themeToggleDef: ToolbarItemDef = {
      id: 'themeToggle', label: 'Toggle Light/Dark Mode', kind: 'button',
      removable: true,
      render: () => {
        const themeBtn = makeBtn('themeToggle', 'Toggle Light/Dark Mode', icons.sun);
        themeBtn.addEventListener('click', () => toggleTheme());
        return themeBtn;
      },
    };

    const settingsDef: ToolbarItemDef = {
      id: 'settings', label: 'Settings', kind: 'button',
      removable: false,
      render: () => {
        const settingsBtn = makeBtn('settings', 'Settings', icons.gear);
        settingsBtn.addEventListener('click', () => showSettingsModal());
        return settingsBtn;
      },
    };

    // ── Font quick-switcher button ──────────────────────────────────────────
    const fontIcon = toolbarSvg('<text x="3" y="12" font-size="11" font-weight="700" fill="currentColor" stroke="none" font-family="serif">A</text><text x="10" y="12" font-size="8" fill="currentColor" stroke="none" font-family="sans-serif">a</text>', 0);
    const fontBtn = makeBtn('fontPicker', 'Font Theme', fontIcon);
    let fontPicker: HTMLElement | null = null;
    fontBtn.addEventListener('click', () => {
      // Remove existing dropdown if open
      fontPicker?.remove();

      const isMac = navigator.platform?.startsWith('Mac') || navigator.userAgent.includes('Macintosh');

      // Font themes — curated heading + body pairings with serif/sans contrast
      const macSans = "'Avenir Next', Avenir, sans-serif";
      const macSans2 = "'Helvetica Neue', Helvetica, sans-serif";
      const macSerif = "Charter, 'Bitstream Charter', Georgia, serif";
      const macSerif2 = "Palatino, 'Palatino Linotype', 'Book Antiqua', serif";
      const macMono = "'SF Mono', Menlo, Monaco, monospace";
      const winSans = "'Segoe UI', sans-serif";
      const winSans2 = "Calibri, sans-serif";
      const winSerif = "Cambria, Georgia, serif";
      const winSerif2 = "'Palatino Linotype', Palatino, 'Book Antiqua', serif";
      const winMono = "Consolas, 'Cascadia Code', monospace";

      const fontThemes: Array<{ label: string; heading: string; body: string; desc: string }> = [
        // ── Mixed: sans headings + serif body
        {
          label: 'Editorial',
          heading: isMac ? macSans : winSans,
          body: isMac ? macSerif : winSerif,
          desc: 'Sans headings, serif body',
        },
        {
          label: 'Magazine',
          heading: isMac ? macSans2 : winSans2,
          body: isMac ? macSerif2 : winSerif2,
          desc: 'Sans headings, serif body',
        },
        // ── Mixed: serif headings + sans body
        {
          label: 'Notebook',
          heading: "Georgia, 'Times New Roman', serif",
          body: isMac ? macSans : winSans2,
          desc: 'Serif headings, sans body',
        },
        {
          label: 'Academic',
          heading: isMac ? macSerif2 : winSerif2,
          body: isMac ? macSans : winSans,
          desc: 'Serif headings, sans body',
        },
        // ── Mixed: sans headings + mono body
        {
          label: 'Technical',
          heading: isMac ? macSans : winSans,
          body: isMac ? macMono : winMono,
          desc: 'Sans headings, mono body',
        },
        // ── Mixed: serif headings + mono body
        {
          label: 'Manuscript',
          heading: "Georgia, 'Times New Roman', serif",
          body: isMac ? macMono : winMono,
          desc: 'Serif headings, mono body',
        },
        // ── Uniform: all same family
        {
          label: 'Modern',
          heading: isMac ? macSans : winSans,
          body: isMac ? macSans : winSans,
          desc: 'Clean sans throughout',
        },
        {
          label: 'Classic',
          heading: "Georgia, 'Times New Roman', serif",
          body: "Georgia, 'Times New Roman', serif",
          desc: 'Traditional serif throughout',
        },
        {
          label: 'Literary',
          heading: isMac ? macSerif2 : winSerif2,
          body: isMac ? macSerif : winSerif,
          desc: 'Two-serif pairing',
        },
        {
          label: 'Developer',
          heading: isMac ? macMono : winMono,
          body: isMac ? macMono : winMono,
          desc: 'Monospace everything',
        },
      ];

      const dropdown = document.createElement('div');
      dropdown.className = 'mikedown-font-quick-picker';
      fontPicker = dropdown;
      dropdown.style.cssText = 'position:absolute;top:100%;right:0;z-index:1100;background:var(--mikedown-surface-raised,#252526);border:1px solid var(--mikedown-border,rgba(128,128,128,0.3));border-radius:var(--mikedown-radius,6px);box-shadow:0 6px 20px var(--mikedown-shadow,rgba(0,0,0,0.3));padding:4px;min-width:300px;max-height:400px;overflow-y:auto';

      const currentBody = getComputedStyle(root).getPropertyValue('--mikedown-font-family').trim();
      const currentHeading = getComputedStyle(root).getPropertyValue('--mikedown-heading-font-family').trim();

      fontThemes.forEach(theme => {
        const isActive = currentBody === theme.body && (currentHeading === theme.heading || (!currentHeading && theme.heading === theme.body));
        const item = document.createElement('div');
        item.style.cssText = `padding:10px 12px;cursor:pointer;border-radius:var(--mikedown-radius-sm,4px);margin:2px 0;color:${isActive ? 'var(--mikedown-selected-text,#ffffff)' : 'var(--mikedown-text-ui,#e0e0e0)'};background:${isActive ? 'var(--mikedown-selected-bg,#0e639c)' : 'transparent'}`;

        // Theme name + description
        const topRow = document.createElement('div');
        topRow.style.cssText = 'display:flex;justify-content:space-between;align-items:baseline;margin-bottom:4px';
        const nameSpan = document.createElement('span');
        nameSpan.textContent = theme.label;
        nameSpan.style.cssText = 'font-size:13px;font-weight:600';
        const descSpan = document.createElement('span');
        descSpan.textContent = theme.desc;
        descSpan.style.cssText = `font-size:11px;opacity:0.75;color:${isActive ? 'inherit' : 'var(--mikedown-text-muted,#888)'}`;
        topRow.appendChild(nameSpan);
        topRow.appendChild(descSpan);

        // Preview: heading sample + body sample
        const preview = document.createElement('div');
        const headingSample = document.createElement('div');
        headingSample.textContent = 'Heading Preview';
        headingSample.style.cssText = `font-family:${theme.heading};font-size:15px;font-weight:600;color:inherit`;
        const bodySample = document.createElement('div');
        bodySample.textContent = 'Body text looks like this in the editor.';
        bodySample.style.cssText = `font-family:${theme.body};font-size:13px;opacity:0.8;color:inherit`;
        preview.appendChild(headingSample);
        preview.appendChild(bodySample);

        item.appendChild(topRow);
        item.appendChild(preview);

        item.addEventListener('mouseenter', () => {
          if (!isActive) {item.style.background = 'var(--mikedown-hover,rgba(255,255,255,0.08))';}
        });
        item.addEventListener('mouseleave', () => {
          if (!isActive) {item.style.background = 'transparent';}
        });
        item.addEventListener('click', () => {
          setRootVar('--mikedown-font-family', theme.body);
          setRootVar('--mikedown-heading-font-family', theme.heading);
          dropdown.remove();
          host.saveSettings?.({ fontFamily: theme.body, headingFontFamily: theme.heading });
        });
        dropdown.appendChild(item);
      });

      // Position relative to font button
      fontBtn.style.position = 'relative';
      fontBtn.appendChild(dropdown);

      // Close on click outside
      const closeHandler = (e: MouseEvent) => {
        if (!dropdown.contains(e.target as Node) && e.target !== fontBtn) {
          dropdown.remove();
          document.removeEventListener('click', closeHandler, true);
        }
      };
      setTimeout(() => document.addEventListener('click', closeHandler, true), 0);
    });

    // ── More (⋯): holds whatever doesn't fit (layoutToolbarOverflow) ────────
    const moreDef: ToolbarItemDef = {
      id: 'more', label: 'More', kind: 'button', pinned: 'last', removable: false,
      render: () => {
        const moreBtn = makeBtn('more', 'More', icons.more);
        moreBtn.classList.add('toolbar-more');
        moreBtn.setAttribute('aria-haspopup', 'menu');
        moreBtn.hidden = true;
        // Keep the editor's selection: the overflowed commands act on it.
        moreBtn.addEventListener('mousedown', (e) => e.preventDefault());
        moreBtn.addEventListener('click', () => {
          if (isToolbarDropdownOpen()) { hideToolbarDropdown(); return; }
          const entries: ToolbarDropdownEntry[] = [];
          for (const el of Array.from(toolbar.children) as HTMLElement[]) {
            if (!el.classList.contains('toolbar-overflowed')) {continue;}
            if (el.classList.contains('toolbar-separator')) {
              if (entries.length && entries[entries.length - 1].type !== 'separator') {entries.push({ type: 'separator' });}
              continue;
            }
            // A group overflows as one child; the menu lists the buttons inside it.
            const buttons = el instanceof HTMLButtonElement ? [el]
              : el.classList.contains('toolbar-group') ? Array.from(el.querySelectorAll('button')) : [];
            for (const btn of buttons) {
              if (btn.style.display === 'none') {continue;}
              const svg = btn.querySelector('svg');
              const opener = overflowOpeners.get(btn);
              entries.push({
                type: 'action',
                id: `more-${btn.dataset.action ?? ''}`,
                label: btn.dataset.menuLabel ?? btn.dataset.tip ?? btn.getAttribute('aria-label') ?? '',
                // An empty icon slot keeps text-only entries (the size readout) aligned.
                icon: svg ? svg.outerHTML : '<span aria-hidden="true"></span>',
                isActive: () => btn.classList.contains('active'),
                isDisabled: () => btn.disabled,
                action: () => { if (opener) {opener(moreBtn);} else {btn.click();} },
              });
            }
          }
          while (entries.length && entries[entries.length - 1].type === 'separator') {entries.pop();}
          if (features.customizeToolbar) {
            if (entries.length) {entries.push({ type: 'separator' });}
            entries.push({
              type: 'action',
              id: 'more-customizeToolbar',
              label: 'Customize Toolbar…',
              icon: '<span aria-hidden="true"></span>',
              action: () => enterToolbarEditMode(moreBtn),
            });
          }
          if (entries.length) {showToolbarDropdown(moreBtn, entries);}
        });
        return moreBtn;
      },
    };

    // ── Assemble ────────────────────────────────────────────────────────────
    const defs: ToolbarItemDef[] = [
      textFormatDef, listBlockDef, linkDef, insertDef, emojiDef, headingNumbersDef, aiDef,
      undoDef, redoDef, sourceToggleDef, shareDef, selectAllDef, zoomDef,
      themeToggleDef, settingsDef, moreDef,
    ];
    const tokens = toolbarResolved.tokens;
    toolbarRegistry = { defs, tokens, rendered: renderToolbar(toolbar, defs, tokens).join(' ') };
    refreshZoomControl();

    // Keep the toolbar on one row at any width: buttons that don't fit move,
    // from the right, into the More menu. Rerun whenever the toolbar resizes.
    if (typeof ResizeObserver !== 'undefined') {
      let frame = 0;
      const ro = new ResizeObserver(() => {
        // Customizing suspends overflow: the toolbar wraps instead (D9).
        if (toolbarEdit.isToolbarEditing) {return;}
        cancelAnimationFrame(frame);
        frame = requestAnimationFrame(() => layoutToolbarOverflow(toolbar));
      });
      ro.observe(toolbar);
      disposers.push(() => { cancelAnimationFrame(frame); ro.disconnect(); });
    }
    layoutToolbarOverflow(toolbar);

    // Right-click anywhere on the toolbar: a one-item menu into edit mode (D5).
    if (features.customizeToolbar) {
      listen(toolbar, 'contextmenu', (e: MouseEvent) => {
        e.preventDefault();
        if (toolbarEdit.isToolbarEditing) {return;}
        hideToolbarDropdown();
        showContextMenu(editor, e.clientX, e.clientY, [
          { label: 'Customize Toolbar…', action: () => enterToolbarEditMode(toolbar) },
        ]);
      });
    }

    // ── Update dynamic label on selection changes ──────────────────────────
    (toolbar as any).__condensedUpdate = () => {
      for (const def of defs) {def.update?.();}

      // Update dropdown active states if one is open
      updateDropdownActiveStates();
    };
  }


  function currentFontSize(): number {
    return parseInt(getComputedStyle(root).getPropertyValue('--mikedown-font-size') || String(DEFAULT_FONT_SIZE), 10);
  }

  /** Sync the toolbar zoom control with the live font size. */
  function refreshZoomControl(): void {
    const toolbar = shell.toolbar;
    if (!toolbar) {return;}
    const size = currentFontSize();
    const resetBtn = toolbar.querySelector<HTMLButtonElement>('button[data-action="zoomReset"]');
    if (resetBtn) {
      const sizeChanged = resetBtn.textContent !== String(size);
      resetBtn.textContent = String(size);
      resetBtn.dataset.menuLabel = `Reset Font Size (${size}px)`;
      const tip = `Font size ${size}px (click to reset to ${DEFAULT_FONT_SIZE}px)`;
      resetBtn.dataset.tip = tip;
      // The accessible name starts with the visible number (WCAG 2.5.3).
      resetBtn.setAttribute('aria-label', `${size} px font size (click to reset to ${DEFAULT_FONT_SIZE}px)`);
      // A wider readout (9 → 24) can push the row past the edge.
      if (sizeChanged && resetBtn.isConnected) {layoutToolbarOverflow(toolbar);}
    }
    const outBtn = toolbar.querySelector<HTMLButtonElement>('button[data-action="zoomOut"]');
    if (outBtn) {outBtn.disabled = size <= WHEEL_ZOOM_MIN;}
    const inBtn = toolbar.querySelector<HTMLButtonElement>('button[data-action="zoomIn"]');
    if (inBtn) {inBtn.disabled = size >= WHEEL_ZOOM_MAX;}
  }

  function updateToolbarState(editor: Editor): void {
    const toolbar = shell.toolbar;
    if (!toolbar) {return;}
    const inCodeBlock = editor.isActive('codeBlock');
    toolbar.querySelectorAll('button[data-action]').forEach(el => {
      const btn = el as HTMLButtonElement;
      const action = btn.dataset.action!;
      // Active state
      btn.classList.toggle('active', (() => {
        if (action === 'sourceToggle') {return sourceMode;}
        switch (action) {
          case 'bold': return editor.isActive('bold');
          case 'italic': return editor.isActive('italic');
          case 'strike': return editor.isActive('strike');
          case 'code': return editor.isActive('code');
          case 'h1': return editor.isActive('heading', { level: 1 });
          case 'h2': return editor.isActive('heading', { level: 2 });
          case 'h3': return editor.isActive('heading', { level: 3 });
          case 'bulletList': return editor.isActive('bulletList');
          case 'orderedList': return editor.isActive('orderedList');
          case 'taskList': return editor.isActive('taskList');
          case 'blockquote': return editor.isActive('blockquote');
          case 'codeBlock': return editor.isActive('codeBlock');
          case 'link': return editor.isActive('link');
          case 'table': return editor.isActive('table');
          default: return false;
        }
      })());
      // Disabled state: in source mode, lock out anything that edits the doc;
      // otherwise, only disable inline formatting inside a code block.
      btn.disabled = sourceMode
        ? SOURCE_MODE_DISABLED_ACTIONS.has(action)
        : inCodeBlock && ['bold', 'italic', 'strike', 'code', 'link'].includes(action);
    });
    // The loop above cleared the zoom buttons' min/max disabled state.
    refreshZoomControl();
    // Condensed mode: update dynamic labels and dropdown trigger highlights
    if ((toolbar as any).__condensedUpdate) {
      (toolbar as any).__condensedUpdate();
    }
  }

  // ── M13: Find & Replace Bar ────────────────────────────────────────────────────

  function buildFindReplaceBar(editor: Editor): void {
    const bar = document.createElement('div');
    bar.className = 'mikedown-find-replace-bar';
    bar.style.display = 'none';
    bar.innerHTML = `
      <div class="fr-row">
        <input data-fr="fr-find-input" type="text" placeholder="Find…" autocomplete="off" spellcheck="false" />
        <button data-fr="fr-prev-btn" title="Previous (Shift+Enter)">↑</button>
        <button data-fr="fr-next-btn" title="Next (Enter)">↓</button>
        <span data-fr="fr-match-count" class="fr-count"></span>
        <div class="fr-options">
          <label title="Match Case" aria-label="Match Case"><input type="checkbox" data-fr="fr-case" /><span title="Match Case">Aa</span></label>
          <label title="Whole Word" aria-label="Whole Word"><input type="checkbox" data-fr="fr-word" /><span title="Whole Word">|W|</span></label>
          <label title="Use Regex" aria-label="Use Regex"><input type="checkbox" data-fr="fr-regex" /><span title="Use Regex">.*</span></label>
        </div>
        <button data-fr="fr-replace-toggle" title="Toggle replace">≡</button>
        <button data-fr="fr-close-btn" title="Close (Escape)">✕</button>
      </div>
      <div class="fr-row" data-fr="fr-replace-row" style="display:none">
        <input data-fr="fr-replace-input" type="text" placeholder="Replace…" autocomplete="off" spellcheck="false" />
        <button data-fr="fr-replace-btn" class="fr-replace-btn">Replace</button>
        <button data-fr="fr-replace-all-btn" class="fr-replace-all-btn">Replace All</button>
      </div>
    `;
    root.appendChild(bar);
    const fr = <T extends HTMLElement = HTMLElement>(name: string): T => bar.querySelector(`[data-fr="${name}"]`) as T;

    const findInput = fr<HTMLInputElement>('fr-find-input');
    const replaceInput = fr<HTMLInputElement>('fr-replace-input');
    const matchCount = fr<HTMLSpanElement>('fr-match-count');

    function getCurrentOptions() {
      return {
        matchCase: (fr<HTMLInputElement>('fr-case')).checked,
        wholeWord: (fr<HTMLInputElement>('fr-word')).checked,
        useRegex: (fr<HTMLInputElement>('fr-regex')).checked,
      };
    }

    function doSearch() {
      const opts = { query: findInput.value, ...getCurrentOptions() };
      const matches = sourceMode && cmView
        ? cmUpdateSearch(cmView, opts)
        : updateSearch(editor, opts);
      matchCount.textContent = matches.length > 0 ? `${matches.length} match${matches.length === 1 ? '' : 'es'}` : 'No matches';
    }

    function doNext() { if (sourceMode && cmView) {cmFindNext(cmView);} else {findNext(editor);} }
    function doPrev() { if (sourceMode && cmView) {cmFindPrev(cmView);} else {findPrev(editor);} }

    findInput.addEventListener('input', doSearch);
    ['fr-case', 'fr-word', 'fr-regex'].forEach(id => {
      fr(id).addEventListener('change', doSearch);
    });

    // Prevent the ↑ / ↓ buttons from stealing focus from the find input on
    // mousedown. Without this, clicking the arrows moves focus to the button,
    // which breaks subsequent Enter / Shift+Enter navigation and can leave the
    // user focused in the toolbar area.
    const nextBtn = fr('fr-next-btn');
    const prevBtn = fr('fr-prev-btn');
    nextBtn?.addEventListener('mousedown', (e) => e.preventDefault());
    prevBtn?.addEventListener('mousedown', (e) => e.preventDefault());
    nextBtn?.addEventListener('click', doNext);
    prevBtn?.addEventListener('click', doPrev);

    findInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); if (e.shiftKey) {doPrev();} else {doNext();} }
      if (e.key === 'Escape') { closeFindBar(); }
    });

    fr('fr-replace-toggle')?.addEventListener('click', () => {
      const row = fr<HTMLElement>('fr-replace-row');
      row.style.display = row.style.display === 'none' ? '' : 'none';
    });

    fr('fr-replace-btn')?.addEventListener('click', () => {
      if (sourceMode && cmView) {cmReplaceCurrent(cmView, replaceInput.value);}
      else {replaceCurrentMatch(editor, replaceInput.value);}
      doSearch();
    });

    fr('fr-replace-all-btn')?.addEventListener('click', () => {
      const n = sourceMode && cmView
        ? cmReplaceAll(cmView, replaceInput.value)
        : replaceAllMatches(editor, replaceInput.value);
      matchCount.textContent = `Replaced ${n}`;
      doSearch();
    });

    fr('fr-close-btn')?.addEventListener('click', closeFindBar);

    function closeFindBar() {
      bar.style.display = 'none';
      if (sourceMode && cmView) { cmClearSearch(cmView); cmView.focus(); }
      else { clearSearch(editor); editor.commands.focus(); }
      matchCount.textContent = '';
    }

    // Expose openFindBar to the keyboard handlers
    openFindBar = (replace = false) => {
      bar.style.display = '';
      if (replace) {
        fr('fr-replace-row').style.display = '';
      }
      findInput.focus();
      findInput.select();
      doSearch();
    };

    // Called by switchToSource / switchToWysiwyg after a mode toggle. Clears
    // decorations left on the now-hidden editor and re-runs the current query
    // against the newly active one so matches stay in sync with the visible view.
    resyncFind = () => {
      // Always clear both sides first — only the side that just became active
      // should show highlights after the resync.
      clearSearch(editor);
      if (cmView) {cmClearSearch(cmView);}
      if (bar.style.display === 'none') {return;} // Bar closed; no query to reapply.
      if (!findInput.value) { matchCount.textContent = ''; return; }
      doSearch();
    };
  }

  // ── TipTap Initialisation ──────────────────────────────────────────────────────

  const editor = new Editor({
    element: editorContainer,
    extensions: [
      // ── StarterKit (M2b/M2c/M2d verification) ───────────────────────────────
      //
      // StarterKit bundles the following extensions that handle GFM input rules:
      //
      // M2b — Inline marks (verified: StarterKit includes these by default):
      //   • Bold:          **text** and __text__ → <strong> (Bold extension)
      //   • Italic:        *text* and _text_     → <em>     (Italic extension)
      //   • Strike:        ~~text~~               → <s>      (Strike extension)
      //   • Code (inline): `code`                → <code>   (Code extension)
      //
      // M2c — Block nodes (verified: StarterKit includes these by default):
      //   • Headings:        # through ###### at line start → h1–h6 (Heading)
      //   • BulletList:      -, *, + at line start → <ul>            (BulletList)
      //   • OrderedList:     1. at line start       → <ol>            (OrderedList)
      //   • Blockquote:      > at line start        → <blockquote>    (Blockquote)
      //   • HorizontalRule:  --- on own line        → <hr>            (HorizontalRule)
      //
      // Note: StarterKit's codeBlock is disabled here because tiptap-markdown
      // manages fenced code blocks (``` / ```lang) via its own CodeBlock node.
      // This avoids conflicts between the two implementations.
      //
      // M2c — Cross-block selection handled natively by ProseMirror.
      // ProseMirror's selection model supports selections that span multiple
      // block nodes (paragraphs, headings, lists, etc.) without additional code.
      //
      // M2c — Inline formatting across incompatible block types: TipTap/ProseMirror
      // applies marks only to ranges where the schema allows them, skipping
      // incompatible nodes (e.g., code blocks reject rich-text marks). No extra
      // code is needed to enforce this boundary.
      //
      // M2d — History configured with depth: 100 and newGroupDelay: 500 ms so
      // that rapid keystrokes are grouped into a single undo step (500 ms window)
      // while keeping up to 100 steps in the undo stack.
      StarterKit.configure({
        // Disable the built-in codeBlock — tiptap-markdown provides its own code
        // fenced-block handling and conflicts with StarterKit's codeBlock node.
        codeBlock: false,
        // Disable the built-in text / hardBreak nodes — MarkdownText and
        // MarkdownHardBreak (registered below) are the same nodes plus markdown
        // serializers that override tiptap-markdown's broken defaults (issue #5:
        // `<` serialised as `&lt;`, and a stray `\\` on every soft-wrapped line).
        // Registering both copies would trip TipTap's duplicate-name check.
        text: false,
        hardBreak: false,
        // Disable the built-in link — we register a standalone Link.configure
        // below with openOnClick: false. Registering both produces a
        // "Duplicate extension names found: ['link']" warning and double-binds
        // ProseMirror plugins/keymaps.
        link: false,
        // M2d: Configure undo history with grouping delay and stack depth.
        // (StarterKit v3 names this option `undoRedo`, not `history`.)
        undoRedo: { depth: 100, newGroupDelay: 500 },
      }),

      // ── Markdown-correct text + hard break (issue #5) ─────────────────────
      // Replaces StarterKit's text/hardBreak nodes with identical nodes that
      // carry MikeDown's markdown serializers. See src/webview/markdownText.ts.
      MarkdownText,
      MarkdownHardBreak,
      // Tracked frontmatter edits ride PM history as a doc attribute (one undo step each).
      FrontmatterHistory,

      // ── Code Blocks with Syntax Highlighting (M15) ────────────────────────────
      // CodeBlockLowlight extends the base CodeBlock node with lowlight (highlight.js
      // wrapper) for offline syntax highlighting. StarterKit has codeBlock: false,
      // so this extension provides the codeBlock node type without conflict.
      // tiptap-markdown serialises codeBlock nodes as fenced code blocks (```lang).
      // .extend() adds a `data-language` attribute to the rendered <pre> so the
      // CSS ::before label can show the language (CodeBlockLowlight's default
      // renderHTML only puts the language on the inner <code> as a class).
      // mergeAttributes() is critical — without it the configured
      // HTMLAttributes ({ class: 'mikedown-code-block' }) is dropped, which
      // breaks the copy-button hover selector and the language-label ::before.
      CodeBlockLowlight.extend({
        // A fence with no info string stays bare: the attribute defaults to
        // null (not the `defaultLanguage` option, which would serialize as
        // ```plaintext). Highlighting still falls back to defaultLanguage.
        addAttributes() {
          const parent: Record<string, any> = this.parent?.() ?? {};
          return { ...parent, language: { ...parent.language, default: null } };
        },
        renderHTML({ node, HTMLAttributes }) {
          const lang = node.attrs.language || '';
          return [
            'pre',
            mergeAttributes(this.options.HTMLAttributes, HTMLAttributes, { 'data-language': lang }),
            ['code', { class: lang ? `language-${lang}` : null }, 0],
          ];
        },
      }).configure({
        lowlight,
        defaultLanguage: 'plaintext',
        HTMLAttributes: {
          class: 'mikedown-code-block',
        },
      }),

      // ── Mermaid diagrams ──────────────────────────────────────────────────────
      // Renders ```mermaid blocks as live SVG diagrams via decoration widgets,
      // leaving every other code block on the default CodeBlockLowlight path.
      MermaidPreview,

      // ── Math ──────────────────────────────────────────────────────────────────
      // `$inline$` and `$$display$$` LaTeX rendered with KaTeX; click to edit.
      MathInline,
      MathBlock,

      // ── Footnotes ─────────────────────────────────────────────────────────────
      // `[^1]` references and `[^1]: text` definitions, kept in place on save.
      FootnoteRef,
      FootnoteDef,

      // ── Table of contents ─────────────────────────────────────────────────────
      // `<!-- toc -->` … `<!-- tocstop -->` around a list of heading links,
      // kept current as headings change (see the TOC sync below).
      TableOfContents.configure({ onNavigate: (anchor) => scrollToAnchor(anchor) }),

      // ── Task Lists (M2c) ──────────────────────────────────────────────────────
      // "- [ ] " and "- [x] " input rules convert to checkable task list items.
      // TaskItem is configured with nested: true to allow sub-tasks.
      // Auto-continuation (Enter → new item) and list-exit (Enter on empty item
      // → paragraph) are handled natively by ProseMirror's list commands.
      // `tight` mirrors the attribute tiptap-markdown gives bullet/ordered
      // lists (its MarkdownTightLists skips taskList), without which every
      // task list serialized loose, a blank line between items.
      TaskList.extend({
        addAttributes() {
          return {
            ...this.parent?.(),
            tight: {
              default: true,
              parseHTML: (element: HTMLElement) =>
                element.getAttribute('data-tight') === 'true' || !element.querySelector('p'),
              renderHTML: (attributes: { tight?: boolean }) => ({
                class: attributes.tight ? 'tight' : null,
                'data-tight': attributes.tight ? 'true' : null,
              }),
            },
          };
        },
      }),
      TaskItem.configure({ nested: true }),

      // ── Tables ────────────────────────────────────────────────────────────────
      TableAligned.configure({ resizable: false }),
      TableRow,
      TableHeaderAligned,
      TableCellAligned,

      // ── Links (M2b) ───────────────────────────────────────────────────────────
      // tiptap-markdown handles "[text](url)" syntax via its paste/input rules,
      // converting typed or pasted markdown link syntax to Link marks.
      // openOnClick: false keeps the editor from navigating on Ctrl+click so
      // the user can edit the link text.
      // isAllowedUri: TipTap's default validator has a regex bug where
      // `[a-z+.-:]` treats `.-:` as a range that includes `/`, so relative
      // paths like "Planning/README.md" are rejected and the Link mark is
      // dropped during markdown → HTML → PM parsing. Allow any non-empty URI.
      // addStorage: override the default markdown serializer so CommonMark
      // email autolinks (`<user@host>`) round-trip cleanly. The default only
      // emits `<…>` form when the link text equals the href verbatim, which
      // misses mailto: links whose text is the email without the prefix —
      // those would otherwise be re-serialized as `[user@host](mailto:user@host)`,
      // marking the file dirty on open.
      // shouldAutoLink: don't turn bare filenames (`build.sh`, `notes.md`) into
      // links just because the extension collides with a ccTLD — issue #4.
      LinkWithAutolink.configure({ openOnClick: false, isAllowedUri: () => true, shouldAutoLink: shouldAutolinkText }),

      // ── Images (M2b) ──────────────────────────────────────────────────────────
      // tiptap-markdown handles "![alt](src)" syntax and creates Image nodes.
      // `inline: true` matches CommonMark — multiple `![]()` on one line stay in
      // a single paragraph (e.g. shields.io badge rows) instead of each becoming
      // its own block. A solo image on its own paragraph still renders the same.
      // Rendering goes through the image source policy (host.ts
      // `resolveImageSrc`); the stored `src` attribute is never rewritten.
      createPolicyImage().configure({ inline: true }),

      // ── Mod-/ source toggle ───────────────────────────────────────────────────
      // Off when the host binds the shortcut itself (VS Code keybinding), so
      // one keystroke never toggles twice.
      Extension.create({
        name: 'mikedownSourceShortcut',
        addKeyboardShortcuts(): Record<string, () => boolean> {
          if (hostOwnsShortcuts) {return {};}
          return { 'Mod-/': () => { toggleSourceMode(); return true; } };
        },
      }),

      // ── AI rewrite (host.ai) ──────────────────────────────────────────────────
      // The target highlight while the popover is open, and Mod-Alt-K unless
      // the host binds it (VS Code: mikedown.ai.rewrite).
      ...(aiHost ? [AiRewriteHighlight, Extension.create({
        name: 'mikedownAiRewriteShortcut',
        addKeyboardShortcuts(): Record<string, () => boolean> {
          if (hostOwnsShortcuts) {return {};}
          return { 'Mod-Alt-k': () => startAiRewrite() };
        },
      })] : []),

      // ── Placeholder (M2c / M5) ────────────────────────────────────────────────
      // "Type / for commands…" is shown when the slash-command menu is enabled;
      // "Start writing…" otherwise. The CSS rule
      // `.ProseMirror p.is-editor-empty:first-child::before` renders this via
      // the data-placeholder attribute injected by the extension. `placeholder`
      // is a function so it re-reads currentSlashCommandsEnabled on every
      // decoration rebuild; the settings handler forces a rebuild on toggle by
      // dispatching a no-op transaction (tr.setMeta('slashPlaceholder', true))
      // rather than touching editor.view.dom directly.
      Placeholder.configure({
        placeholder: () => options.placeholder ?? (features.slashCommands && currentSlashCommandsEnabled ? 'Type / for commands…' : 'Start writing…'),
      }),

      // ── Markdown serialiser / input rules (M2b / M2c) ─────────────────────────
      // tiptap-markdown provides:
      //   • Input rules for fenced code blocks (``` / ```lang)
      //   • Paste rules that convert pasted markdown (bold, italic, links, etc.)
      //     to rich TipTap nodes/marks — verified working for GFM content.
      //   • storage.markdown.getMarkdown() for round-trip GFM serialisation.
      //
      // TODO (future): With html: false, raw HTML blocks (e.g. <details>, <div>)
      // inside markdown appear as plain text. A future enhancement could render
      // them as styled "HTML block" nodes with a monospace / light-gray background
      // and an "HTML" label (similar to raw-HTML block rendering in Typora).
      Markdown.configure({
        html: false,
        tightLists: true,
        tightListClass: 'tight',
        bulletListMarker: '-',
        linkify: false,
        // breaks: true treats a single newline within a paragraph as a hard
        // line break (rendered as <br>) rather than a CommonMark soft break
        // (rendered as a space). This matches the behavior most users expect
        // from editors like Typora, Obsidian, and GitHub-flavored renderers.
        breaks: true,
        transformPastedText: false,
        transformCopiedText: false,
      }),

      // ── Image Paste (v1.6.0) ──────────────────────────────────────────────
      // Intercepts paste/drop events with image bytes, sends them to the
      // extension host which writes the file to <docDir>/images/ (per
      // mikedown.imagePaste.* settings) and returns the resolved path. Higher
      // priority than SmartPaste so it wins when the clipboard carries both
      // image bytes and HTML (some screenshot apps include both).
      ImagePasteExtension.configure({
        upload: host.uploadImage ? (file) => host.uploadImage!(file) : null,
      }),

      // ── Smart Paste (M12a) ─────────────────────────────────────────────────
      // Intercepts paste events that carry text/html clipboard data, cleans the
      // HTML (strips Word/Google Docs noise, converts style-based bold/italic to
      // semantic elements) and converts it to ProseMirror nodes via PM's own
      // DOMParser. Falls back to tiptap-markdown's built-in paste handling when
      // no HTML data is present or when the payload exceeds 500 KB.
      PlainPasteExtension,
      SmartPasteExtension,

      // ── Find & Replace (M13) ───────────────────────────────────────────────
      // ProseMirror decoration plugin that highlights all search matches in the
      // WYSIWYG view. Keyboard intercept (Cmd+F / Cmd+H) is wired below.
      FindReplaceExtension,

      // ── Spell check ───────────────────────────────────────────────────────
      // Hunspell dictionaries checked in the webview (VS Code disables
      // Chromium's native spellchecker window-wide), squiggles rendered as
      // inline decorations. Dictionary loads lazily after first render.
      SpellCheckExtension,

      // ── Table Checkboxes ──────────────────────────────────────────────────
      // Renders [ ] and [x] inside table cells as interactive checkboxes.
      // The underlying markdown text is preserved for round-trip fidelity.
      TableCheckboxExtension,

      // ── Inline HTML anchor targets ────────────────────────────────────────
      // Preserves `<a id="foo"></a>` / `<a name="foo"></a>` as stable
      // fragment identifiers (CommonMark raw-HTML slice) so `[link](#foo)`
      // resolves even when the target isn't a heading.
      HtmlAnchor,

      // ── GitHub `:shortcode:` emoji ─────────────────────────────────────────
      // Renders `:smile:` as 😄 in WYSIWYG while preserving the shortcode
      // form in saved markdown for GitHub/GitLab server-side rendering.
      Emoji,
      EmojiAutocomplete,
      // `[[` and `#` autocompletes need the host's file list / tag index.
      // The wikilink one is always registered: its candidates come from
      // `host.getLinkSuggestions`, looked up when the popup first opens, so a
      // host that gains the method after construction (the desktop app when
      // a window opens a folder) gets the popup; without it there are never
      // candidates and the popup never renders.
      WikilinkAutocomplete,
      ...(tagsAvailable ? [TagAutocomplete] : []),
      // "/" command menu. Priority 1000 so its keys win over the autocompletes.
      SlashCommands,

      // ── Highlight / mark (==text==) ────────────────────────────────────────
      // Inline `<mark>` mark; round-trips to `==text==` via markdown-it-mark.
      Highlight,

      // ── Inline #tags ───────────────────────────────────────────────────────
      // Decoration-only: paints `.mikedown-tag` spans over `#tag` text without
      // touching the doc model, so markdown round-trips untouched. Cmd/Ctrl+
      // click navigation is wired in the link mousedown handler below.
      TagDecorator,

      // ── GitHub-style callouts / admonitions ────────────────────────────────
      // `> [!NOTE]` / `[!TIP]` / `[!IMPORTANT]` / `[!WARNING]` / `[!CAUTION]`
      // render as styled, icon-prefixed panels. Round-trips to canonical GFM
      // source on save. Registered after StarterKit so its parseHTML priority
      // (70) wins for `<blockquote data-callout>` over the bare blockquote rule.
      Callout,

      // ── Obsidian-style `[[wikilink]]` ──────────────────────────────────────
      // Inline atomic node. Name-based (basename) resolution is done host-side;
      // see resolveWikilinksInDoc() / the 'wikilinksResolved' handler below.
      Wikilink,
    ],
    content: '',

    // ── Keyboard shortcuts ──────────────────────────────────────────────────────
    editorProps: {
      // axe aria-input-field-name: the contenteditable textbox needs an accessible name.
      attributes: { ...surfaceAttrs, role: 'textbox', 'aria-multiline': 'true' },
      handleKeyDown(view, event) {
        // M13 — Cmd+F / Ctrl+F: Open find bar.
        if (features.findReplace && (event.metaKey || event.ctrlKey) && event.key === 'f') {
          event.preventDefault();
          openFindBar(false);
          return true;
        }
        // M13 — Cmd+H / Ctrl+H: Open find & replace bar.
        if (features.findReplace && (event.metaKey || event.ctrlKey) && event.key === 'h') {
          event.preventDefault();
          openFindBar(true);
          return true;
        }

        // M3 — Cmd+K / Ctrl+K: Insert/edit link (not inside a table).
        // (Not with Alt: Ctrl+Alt+K is the AI rewrite.)
        if ((event.metaKey || event.ctrlKey) && !event.altKey && event.key === 'k' && !editor.isActive('table')) {
          event.preventDefault();
          showLinkDialog(editor);
          return true;
        }

        // M5a — Table keyboard navigation.
        // Tab/Shift+Tab move between cells. Tab on the last cell of the last row
        // creates a new row. Escape exits the table.
        // Ctrl/Cmd/Alt+Tab is a VS Code tab-switching shortcut, not ours — bail
        // out so the event propagates to the host (see issue #3).
        if (
          event.key === 'Tab' &&
          !event.ctrlKey &&
          !event.metaKey &&
          !event.altKey &&
          editor.isActive('table')
        ) {
          event.preventDefault();
          if (event.shiftKey) {
            editor.commands.goToPreviousCell();
          } else {
            // goToNextCell returns false when the cursor is already in the last cell.
            const canGoNext = editor.commands.goToNextCell();
            if (!canGoNext) {
              // Last cell — create a new row and move into its first cell.
              editor.chain().addRowAfter().goToNextCell().run();
            }
          }
          return true;
        }

        if (event.key === 'Escape' && editor.isActive('table')) {
          // Move cursor to the paragraph immediately after the table.
          const { state } = editor;
          const { $head } = state.selection;
          // Walk up the node tree until we reach the table node.
          let tableDepth = $head.depth;
          while (tableDepth > 0 && $head.node(tableDepth).type.name !== 'table') {
            tableDepth--;
          }
          if (tableDepth > 0) {
            const posAfterTable = $head.after(tableDepth);
            if (posAfterTable < state.doc.content.size) {
              editor.commands.setTextSelection(posAfterTable + 1);
            }
          }
          return true;
        }

        // M2c — Tab to indent list item (sink one level deeper).
        // TipTap's BulletList / OrderedList extensions do not add Tab bindings by
        // default; we add them here so Tab behaves as expected inside lists.
        // Ctrl/Cmd/Alt+Tab is a VS Code tab-switching shortcut, not ours — bail
        // out so the event propagates to the host (see issue #3).
        if (
          event.key === 'Tab' &&
          !event.shiftKey &&
          !event.ctrlKey &&
          !event.metaKey &&
          !event.altKey
        ) {
          const { state } = view;
          const { selection } = state;
          const { $from } = selection;
          // Only intercept Tab when the cursor is inside a list item.
          let inList = false;
          for (let depth = $from.depth; depth > 0; depth--) {
            const nodeType = $from.node(depth).type.name;
            if (nodeType === 'listItem' || nodeType === 'taskItem') {
              inList = true;
              break;
            }
          }
          if (inList) {
            // Use TipTap's sinkListItem command for both regular and task items.
            const handled =
              (view.state.schema.nodes.listItem &&
                (view as unknown as { editorView?: unknown }).editorView === undefined &&
                false) ||
              false;
            void handled;
            // Dispatch via the editor command API (accessed through the editor
            // instance captured in the outer closure).
            // We use a custom event to bridge to the editor commands below.
            editorContainer.dispatchEvent(
              new CustomEvent('mikedown:sinkListItem', { bubbles: false })
            );
            event.preventDefault();
            return true;
          }
        }

        // M2c — Shift+Tab to un-indent list item (lift one level up).
        // Ctrl/Cmd/Alt+Shift+Tab is a VS Code tab-switching shortcut, not ours —
        // bail out so the event propagates to the host (see issue #3).
        if (
          event.key === 'Tab' &&
          event.shiftKey &&
          !event.ctrlKey &&
          !event.metaKey &&
          !event.altKey
        ) {
          const { state } = view;
          const { selection } = state;
          const { $from } = selection;
          let inList = false;
          for (let depth = $from.depth; depth > 0; depth--) {
            const nodeType = $from.node(depth).type.name;
            if (nodeType === 'listItem' || nodeType === 'taskItem') {
              inList = true;
              break;
            }
          }
          if (inList) {
            editorContainer.dispatchEvent(
              new CustomEvent('mikedown:liftListItem', { bubbles: false })
            );
            event.preventDefault();
            return true;
          }
        }

        return false;
      },
    },

    onUpdate: ({ editor: updatedEditor, transaction }) => {
      // Guard: do not send an edit event while we are loading content from the
      // extension host — that would incorrectly mark the document as modified.
      // Same for a placeholder TOC refresh: the saved markdown didn't change.
      if (isLoading || transaction.getMeta(TOC_DISPLAY_ONLY_META)) {
        return;
      }

      // M15 — Re-attach frontmatter when serializing so saved content is complete.
      const markdown = serializeDocument();

      // "Pristine" = PM's current undo depth matches the depth captured at
      // the last save (0 at initial load). When pristine we send the
      // `originalContent` baseline verbatim so the extension host can
      // restore the TextDocument to an exact byte-match of the saved file
      // and clear the dirty flag via document.save().
      const isPristine = lastSavedUndoDepth !== null
        && pmUndoDepth(editor.state) === lastSavedUndoDepth;
      const contentToSend = isPristine ? originalContent : markdown;

      const newDirty = contentToSend !== originalContent;
      if (newDirty !== isDirty) {isDirty = newDirty;}

      notifyChange(contentToSend, { pristine: isPristine });

      // Mirror plain text into the sidebar footer + status bar so word count
      // and reading time update live without an extra round-trip.
      const plainText = updatedEditor.getText();
      outlineSidebar?.applyPlainText(plainText);
      postStats({ document: plainText });

      // Resolve any newly-typed `[[wikilinks]]` (debounced; cached names skip
      // the round-trip). scheduleWikilinkResolution is hoisted from the setup
      // scope below.
      scheduleWikilinkResolution();
    },
  });

  // M3/M4/M6: wire the slash-command action map (quote/lists/callouts/divider,
  // code/mermaid/table, link/wikilink/emoji/image/properties/date/datetime).
  initSlashCommandActions(editor, {
    showLinkDialog,
    insertEmptyFrontmatter,
    focusPropertiesSection: () => outlineSidebar?.focusPropertiesSection(),
    pickImage: host.pickImage ? () => host.pickImage!() : undefined,
    aiSummarize: (kind, range) => startAiSummary(kind, range),
    aiSuggestTitle: (range) => startAiTitles(range),
  });
  // Hidden slash commands (`/image`, `/properties`) are set once, near the top
  // of the factory, from the host's capabilities and the enabled features.

  // Entry point for the code-block context menu's "Set language…" (wired by
  // the code block overlay below).
  let showLanguagePickerForSelection: () => void = () => {};

  // Actions the right-click menus trigger on this editor.
  const menuActions: ContextMenuActions = {
    showLinkDialog: () => showLinkDialog(editor),
    showImageDialog: () => showImageInsertDialog(editor),
    showEmojiPicker: () => showEmojiPicker(editor, {}),
    showLanguagePicker: () => showLanguagePickerForSelection(),
    openLink: (href, behavior) => openLinkViaHost(href, behavior),
    aiRewrite: () => {
      const a = aiRewriteAvailability();
      if (a.state === 'hidden') {return null;}
      return a.state === 'enabled'
        ? { enabled: true, groups: aiRewriteMenuGroups(), run: (variant) => { startAiRewrite(variant); } }
        : { enabled: false, reason: a.reason, groups: [], run: () => {} };
    },
  };

  // ── AI rewrite: popover, selection bubble, entry point ─────────────────────
  // Inert without host.ai. Every request resolves its route afresh
  // (runAiCompletion); the popover previews, Accept replaces in one transaction.
  const aiRewrite = aiHost ? createAiRewritePopover({
    run: (req, events, signal) => runAiCompletion({
      ai: aiHost,
      settings: () => currentAiSettings,
      statuses: () => aiStatuses,
      consent: aiConsent,
    }, req, events, signal),
    badge: aiBadge,
    onServed: (served, viaFallback) => {
      aiServed = { served, viaFallback };
      renderAiIndicator();
    },
    openSettings: () => showSettingsModal('ai'),
    documentTarget: aiDocumentTarget,
    routeInfo: aiRouteInfo,
  }) : null;
  if (aiRewrite) {disposers.push(() => aiRewrite.destroy());}

  /** The engine badge for a request: the route about to be used, or who served it. */
  function aiBadge(route: AiRouteOk | null, served: AiServedBy | null, viaFallback: boolean): AiRewriteBadge | null {
    const by: AiServedBy | null = served ?? (route ? {
      engineId: route.engineId,
      engineName: currentAiSettings.engines.find((e) => e.id === route.engineId)?.name ?? route.engineId,
      modelId: route.modelId,
      isLocal: route.isLocal,
    } : null);
    if (!by || !aiHost) {return null;}
    const s = aiIndicatorState({ settings: { ...currentAiSettings, enabled: true }, statuses: aiStatuses, tier: aiHostTier(aiHost), served: by, viaFallback: false });
    if (!s) {return null;}
    return {
      where: by.isLocal ? 'local' : 'cloud',
      text: s.text.replace(/^AI: /, ''),
      title: served ? s.title.replace(/ Click to open AI settings\.$/, '') : `Sending to ${s.text.replace(/^AI: (local|cloud) · /, '')}.`,
      fallback: viaFallback,
    };
  }

  /** The whole body (frontmatter left out and untouched) as a rewrite target. */
  function aiDocumentTarget(): AiRewriteTarget | null {
    if (sourceMode) {
      return cmView ? sourceDocumentTarget(cmView, (md) => md.length - extractFrontmatter(md).body.length) : null;
    }
    return richDocumentTarget(editor, { scrollToTop: () => { editorContainer.scrollTop = 0; } });
  }

  /** The model the router would pick for `feature` now: its context window and JSON mode. */
  function aiRouteInfo(feature: string): { contextTokens: number | null; json: boolean } {
    const ai = aiHost;
    // A tier-1 host routes by itself: nothing known about its model.
    if (!ai || aiHostTier(ai) !== 2) {return { contextTokens: null, json: false };}
    const r = resolveRoute(currentAiSettings, aiStatuses, aiConsent, { feature });
    if (!isRouteUsable(r)) {return { contextTokens: null, json: false };}
    const model = currentAiSettings.engines.find((e) => e.id === r.engineId)?.models.find((m) => m.id === r.modelId);
    return { contextTokens: model?.capabilities.contextTokens ?? null, json: model?.capabilities.json === true };
  }

  /** The body as markdown (frontmatter left out), from whichever view shows. */
  function aiBodyMarkdown(): string {
    if (sourceMode && cmView) {return extractFrontmatter(cmView.state.doc.toString()).body;}
    return editor.storage.markdown.getMarkdown();
  }

  /** Where a summary goes: the `/query` (rich text) or the caret. */
  function aiCursorTarget(slash?: { from: number; to: number }): AiCursorTarget | null {
    if (sourceMode) {
      return cmView ? sourceCursorTarget(cmView, (md) => md.length - extractFrontmatter(md).body.length) : null;
    }
    return cursorInsertTarget(editor, slash);
  }

  /**
   * `/summary`, `/outline` and "Summarize document…": the popover in insert
   * mode at the cursor (or on `/query`, which Insert removes). False when
   * the feature is not available or there is nothing to summarise.
   */
  function startAiSummary(kind: AiSummaryKind = 'tldr', slash?: { from: number; to: number }): boolean {
    if (!aiRewrite || destroyed || readOnly) {return false;}
    if (aiDocAvailability('summary').state !== 'enabled') {return false;}
    const markdown = aiBodyMarkdown();
    if (!markdown.trim()) {return false;}
    aiBubble?.hide();
    aiRewrite.close();
    const target = aiCursorTarget(slash);
    if (!target) {return false;}
    aiRewrite.openSummary(target, { markdown, kind });
    return true;
  }

  /** What a picked title changes (D12): frontmatter `title:`, else the first H1, else a new H1. */
  function aiTitleEffect(): AiTitleEffect {
    if (sourceMode && cmView) {
      const { frontmatter, body } = extractFrontmatter(cmView.state.doc.toString());
      if (yamlHasTitle(frontmatter)) {return 'frontmatter';}
      return /^ {0,3}#[ \t]+\S/m.test(body) ? 'h1' : 'insertH1';
    }
    if (yamlHasTitle(frontmatterContent)) {return 'frontmatter';}
    let h1 = false;
    editor.state.doc.descendants((node) => {
      if (h1) {return false;}
      if (node.type.name === 'heading' && node.attrs.level === 1) {h1 = true;}
      return !node.isTextblock;
    });
    return h1 ? 'h1' : 'insertH1';
  }

  /**
   * Set a picked title, `/query` removal included, as one undo step. Rich
   * text with a frontmatter `title:`: only the title line changes
   * (`setYamlTitle`), recorded with the `/query` deletion in one PM
   * transaction (`editFrontmatterUndoable`).
   */
  function applyAiTitle(target: AiCursorTarget, title: string): boolean {
    const effect = aiTitleEffect();
    if (sourceMode) {
      if (!cmView) {return false;}
      const full = cmView.state.doc.toString();
      const { frontmatter, body } = extractFrontmatter(full);
      return applySourceTitle(cmView, effect, title, { yaml: frontmatter, bodyStart: full.length - body.length });
    }
    const r = target.range();
    const query = r && r.to > r.from ? r : null;
    if (effect !== 'frontmatter' || frontmatterContent === null) {return applyRichTitle(editor, effect === 'frontmatter' ? 'insertH1' : effect, title, query);}
    return editFrontmatterUndoable(setYamlTitle(frontmatterContent, title), query);
  }

  /**
   * One undoable frontmatter edit (Properties suggestion chips, a picked
   * title): the change is a doc-attribute step in PM history
   * (frontmatterHistory.ts), with `remove` (a `/query`) deleted in the same
   * step. The transaction listener below applies the YAML, so undo and redo
   * take the same path. Rich text only.
   */
  function editFrontmatterUndoable(next: string, remove?: { from: number; to: number } | null): boolean {
    if (sourceMode || editor.isDestroyed) {return false;}
    const removing = !!remove && remove.to > remove.from;
    if (next === frontmatterContent && !removing) {return true;}
    const tr = frontmatterEditTransaction(editor.state, frontmatterContent, next, remove);
    editor.view.dispatch(removing ? tr.scrollIntoView() : tr);
    return true;
  }

  // Any transaction that moves the frontmatter record (an edit above, undo,
  // redo) sets the YAML before `onUpdate` serialises the document.
  editor.on('transaction', ({ transaction }) => {
    const yaml = frontmatterAfterTransition(transaction.before, editor.state.doc);
    if (yaml === undefined || yaml === frontmatterContent) {return;}
    // A block that appears is shown open, as `/properties` does.
    if (frontmatterContent === null) {frontmatterExpanded = true;}
    frontmatterContent = yaml;
    renderFrontmatterBlock();
    refreshPropertiesSidebar();
  });

  // ── AI Properties suggestions (D5) ─────────────────────────────────────────
  // On demand only: the sidebar's Suggest button or the aiSuggestProperties
  // command. Chips apply one at a time, each one undo step.

  /** Tokens kept for the system prompt, instructions and slack (the document gets the rest). */
  const PROPERTIES_RESERVE_TOKENS = 768;
  let propertiesController: AbortController | null = null;

  function aiPropertiesAvailability(): SuggestPropertiesAvailability {
    // `editor.isEditable`, not `readOnly`: this runs from the sidebar's setup, before that is declared.
    if (!editor.isEditable) {return { state: 'hidden' };}
    const a = aiDocAvailability('frontmatter');
    if (a.state !== 'enabled') {return a;}
    if (sourceMode) {return { state: 'disabled', reason: 'Switch to rich text to apply suggestions' };}
    if (!isSimpleFrontmatter(frontmatterContent ?? '')) {
      return { state: 'disabled', reason: 'These properties use YAML the sidebar cannot edit. Edit them in the frontmatter block.' };
    }
    return { state: 'enabled' };
  }

  function syncAiPropertiesAvailability(): void {
    if (!outlineSidebar) {return;}
    outlineSidebar.applySuggestAvailability(aiPropertiesAvailability());
  }

  /** Abort a running request; `clear` also empties the chips row. */
  function cancelAiPropertySuggestions(clear = false): void {
    propertiesController?.abort();
    propertiesController = null;
    if (clear) {outlineSidebar?.applyPropertySuggestions(null, 'idle');}
  }

  /**
   * Ask for a title, a description and tags (the `frontmatter` feature), with
   * one JSON repair round trip (D16), and show the result as chips. A new run
   * aborts the previous one. False when Suggest is not available.
   */
  function startAiPropertySuggestions(): boolean {
    const ai = aiHost;
    const sidebar = outlineSidebar;
    if (!ai || !sidebar || destroyed) {return false;}
    if (aiPropertiesAvailability().state !== 'enabled') {return false;}
    cancelAiPropertySuggestions();
    const controller = new AbortController();
    propertiesController = controller;
    const live = (): boolean => propertiesController === controller && !destroyed;

    const markdown = aiBodyMarkdown();
    const existing = parseFrontmatter(frontmatterContent ?? '');
    const vocabulary = [...workspaceTags].sort((a, b) => b.count - a.count).map((t) => t.tag);
    const outline = headingsOutline(markdown);
    const info = aiRouteInfo('frontmatter');
    const maxTokens = propertiesMaxTokens();
    const promptChars = renderHeadingOutline(outline).length
      + vocabulary.slice(0, PROPERTY_VOCABULARY_MAX).join(', ').length
      + (frontmatterContent ?? '').length;
    const budget = budgetDocument(markdown, {
      contextTokens: info.contextTokens ?? DEFAULT_CONTEXT_TOKENS,
      outputTokens: maxTokens,
      reserveTokens: PROPERTIES_RESERVE_TOKENS + Math.ceil(promptChars / CHARS_PER_TOKEN),
    });
    const messages = buildPropertiesMessages({ document: budget.text, outline, existing, vocabulary });

    let badge = '';
    let repairing = false;
    let streamed = '';
    const showRunning = (): void => sidebar.applyPropertySuggestions(null, 'running', repairing ? 'Fixing the answer format…' : badge);
    const request = (msgs: AiMessage[]): Promise<AiRunOutcome> => runAiCompletion({
      ai,
      settings: () => currentAiSettings,
      statuses: () => aiStatuses,
      consent: aiConsent,
    }, {
      feature: 'frontmatter',
      messages: msgs,
      maxTokens,
      temperature: 0.3,
      thinking: sessionThinkingLevel,
      ...(info.json ? { format: 'json' as const } : {}),
    }, {
      onRoute: (route) => {
        streamed = '';
        if (!live()) {return;}
        badge = aiBadge(route, null, false)?.text ?? '';
        showRunning();
      },
      onToken: (_delta, text) => { streamed = text; },
    }, controller.signal);
    const served = (o: AiRunOutcome): void => {
      aiServed = { served: o.result.served, viaFallback: o.viaFallback };
      renderAiIndicator();
    };

    // An answer that stopped at the length limit: why, in the row's own words.
    let lengthMessage = '';
    const outOfRoom = (o: AiRunOutcome, empty: boolean): string => (o.result.finishReason === 'length'
      ? aiLengthLimitCopy({ thinking: aiRunThinkingOn(o.thinking), empty }).message : '');

    showRunning();
    void (async () => {
      try {
        const first = await request(messages);
        if (!live()) {return;}
        served(first);
        const firstText = first.result.text || streamed;
        // Nothing to repair: the model ran out of room before it answered.
        if (!rewriteVisibleText(firstText).trim() && first.result.finishReason === 'length') {
          lengthMessage = outOfRoom(first, true);
          throw makeAiError('badOutput', lengthMessage);
        }
        let last = first;
        let parsed = parsePropertySuggestions(firstText, existing, vocabulary);
        if (!parsed.ok) {
          // D16: one repair round trip, abortable like the first request.
          repairing = true;
          showRunning();
          const second = await request([...messages, ...jsonRepairMessages(firstText, parsed.error)]);
          if (!live()) {return;}
          served(second);
          last = second;
          parsed = parsePropertySuggestions(second.result.text || streamed, existing, vocabulary);
          if (!parsed.ok) {
            lengthMessage = outOfRoom(second, !rewriteVisibleText(second.result.text || streamed).trim());
            throw makeAiError('badOutput', parsed.error);
          }
        }
        propertiesController = null;
        const cut = outOfRoom(last, false);
        sidebar.applyPropertySuggestions(parsed.suggestions, 'idle', cut || undefined);
      } catch (err) {
        if (!live()) {return;}
        propertiesController = null;
        const e = toAiError(err);
        if (e.code === 'cancelled') {
          sidebar.applyPropertySuggestions(null, 'idle');
          return;
        }
        sidebar.applyPropertySuggestions(null, 'error', lengthMessage || aiErrorCopy(e.code).message);
      }
    })();
    return true;
  }

  /** A chip click: merge it into the entries and record it as one undo step. */
  function applyAiPropertySuggestion(pick: PropertySuggestionPick): boolean {
    if (sourceMode || readOnly || destroyed) {return false;}
    const yaml = frontmatterContent ?? '';
    if (!isSimpleFrontmatter(yaml)) {return false;}
    return editFrontmatterUndoable(serializeFrontmatter(mergePropertySuggestion(parseFrontmatter(yaml), pick)));
  }

  /**
   * `/title` and "Suggest titles…": the popover in choose mode. False when
   * the feature is not available or the document is empty.
   */
  function startAiTitles(slash?: { from: number; to: number }): boolean {
    if (!aiRewrite || destroyed || readOnly) {return false;}
    if (aiDocAvailability('title').state !== 'enabled') {return false;}
    const markdown = aiBodyMarkdown();
    if (!markdown.trim()) {return false;}
    aiBubble?.hide();
    aiRewrite.close();
    const target = aiCursorTarget(slash);
    if (!target) {return false;}
    aiRewrite.openTitles(target, {
      markdown,
      existingTitle: aiDocumentTitle() || undefined,
      effect: aiTitleEffect(),
      apply: (title) => applyAiTitle(target, title),
    });
    return true;
  }

  /** The document title for Explain's context: frontmatter `title:`, else the first heading. */
  function aiDocumentTitle(): string {
    const markdown = sourceMode && cmView ? cmView.state.doc.toString() : '';
    const yaml = sourceMode ? extractFrontmatter(markdown).frontmatter : frontmatterContent;
    const fromYaml = /^title:[ \t]*(.+)$/m.exec(yaml ?? '')?.[1]?.trim().replace(/^(["'])(.*)\1$/, '$2');
    if (fromYaml) {return fromYaml;}
    if (sourceMode) {return /^ {0,3}#{1,6}[ \t]+(.+?)[ \t#]*$/m.exec(extractFrontmatter(markdown).body)?.[1] ?? '';}
    let heading = '';
    editor.state.doc.forEach((node) => {
      if (!heading && node.type.name === 'heading') {heading = node.textContent.trim();}
    });
    return heading;
  }

  /**
   * Open the rewrite popover on the selection (or the block at the caret).
   * With a variant it runs at once, or opens its picker when it needs a
   * parameter that `params` does not give (Translate…, Reading level…);
   * without one (hotkey, command, Custom prompt…) it shows the choices.
   * Translate with nothing to select offers the whole document. False when
   * AI rewrite is not offered.
   */
  function startAiRewrite(variant?: AiRewriteVariant, params?: AiRewriteParams, opts: { wholeDocument?: boolean } = {}): boolean {
    if (!aiRewrite || destroyed) {return false;}
    const availability = aiRewriteAvailability();
    if (availability.state === 'hidden') {return false;}
    aiBubble?.hide();
    aiRewrite.close();
    const target = (sourceMode
      ? (cmView ? sourceRewriteTarget(cmView) : null)
      : richRewriteTarget(editor))
      ?? (variant === 'translate' ? aiDocumentTarget() : null);
    if (!target) {return true;}
    if (availability.state === 'disabled') {
      aiRewrite.openUnavailable(target, availability.reason);
    } else {
      // Explain's context (also reachable from the choices).
      if (target.scope === 'selection') {target.title = aiDocumentTitle();}
      aiRewrite.open(target, variant ? { variant, params, wholeDocument: opts.wholeDocument } : undefined);
    }
    return true;
  }

  /** The selection's rect when the bubble may show over it. */
  function aiBubbleSelectionRect(): DOMRect | null {
    if (aiRewrite?.isOpen() || settingsOverlay?.isConnected || aiPage || aiPointerDown) {return null;}
    if (sourceMode) {
      if (!cmView || !cmView.hasFocus) {return null;}
      const sel = cmView.state.selection.main;
      if (sel.empty || !cmView.state.sliceDoc(sel.from, sel.to).trim()) {return null;}
      const a = cmView.coordsAtPos(sel.from);
      const b = cmView.coordsAtPos(sel.to, -1);
      if (!a) {return null;}
      return new DOMRect(a.left, a.top, Math.max(1, (b?.right ?? a.right) - a.left), Math.max(1, (b?.bottom ?? a.bottom) - a.top));
    }
    if (!editor.view.hasFocus()) {return null;}
    const sel = editor.state.selection;
    if (sel.empty || '$anchorCell' in sel || !editor.state.doc.textBetween(sel.from, sel.to, ' ').trim()) {return null;}
    // Code is not prose: no bubble inside a code block (the hotkey still works).
    if (sel.$from.parent.type.spec.code && sel.$from.sameParent(sel.$to)) {return null;}
    try {
      const startCoords = editor.view.coordsAtPos(sel.from);
      const box = posToDOMRect(editor.view, sel.from, sel.to);
      return new DOMRect(startCoords.left, box.top, Math.max(1, box.right - startCoords.left), box.height);
    } catch { return null; }
  }

  let aiPointerDown = false;
  const aiBubble = aiRewrite ? createAiRewriteBubble({
    availability: aiRewriteAvailability,
    selectionRect: aiBubbleSelectionRect,
    run: (variant) => { startAiRewrite(variant); },
  }) : null;
  if (aiBubble) {
    disposers.push(() => aiBubble.destroy());
    editor.on('selectionUpdate', () => aiBubble.schedule());
    editor.on('focus', () => aiBubble.schedule());
    editor.on('focus', () => syncAiSlashCommands());
    editor.on('blur', () => aiBubble.schedule());
    const onDown = (): void => { aiPointerDown = true; aiBubble.hide(); };
    listen(editorContainer, 'mousedown', onDown);
    listen(sourceContainer, 'mousedown', onDown);
    listen(document, 'mouseup', () => {
      if (!aiPointerDown) {return;}
      aiPointerDown = false;
      aiBubble.schedule();
    });
    listen(root, 'scroll', () => aiBubble.schedule(), true);
  }

  // Wikilink autocomplete: lazily ask the host for the workspace file list the
  // first time the `[[` popup opens with an empty candidate cache.
  setWikilinkCandidateRequester(() => requestLinkSuggestions());

  // Tag autocomplete: the host pushes the tag list on ready + index changes;
  // ask once if the `#` popup opens before that lands.
  setTagCandidateRequester(() => {
    host.getTags?.().then(applyWorkspaceTags, () => { /* keep document tags only */ });
  });

  // Re-render Mermaid diagrams when the color theme flips (VS Code light↔dark
  // toggles the <body> class). Mermaid bakes theme colors into the SVG, so
  // cached output would otherwise keep stale colors. Debounced to coalesce the
  // burst of class mutations VS Code emits during a theme switch.
  let mermaidThemeTimer: ReturnType<typeof setTimeout> | null = null;
  function onHostSchemeChange(): void {
    if (mermaidThemeTimer) {clearTimeout(mermaidThemeTimer);}
    mermaidThemeTimer = setTimeout(() => refreshMermaidTheme(editor), 120);
    refreshCmScheme();
  }
  let lastBodyClass = document.body.className;
  observe(new MutationObserver(() => {
    if (document.body.className === lastBodyClass) {return;}
    lastBodyClass = document.body.className;
    onHostSchemeChange();
  }), document.body, { attributes: true, attributeFilter: ['class'] });
  // 'auto' outside VS Code follows the OS color scheme.
  const darkQuery = window.matchMedia?.('(prefers-color-scheme: dark)');
  if (darkQuery?.addEventListener) {
    const onOsScheme = (): void => {
      if (root.getAttribute('data-mikedown-theme') !== 'auto') {return;}
      updateThemeToggleIcon();
      onHostSchemeChange();
    };
    darkQuery.addEventListener('change', onOsScheme);
    disposers.push(() => darkQuery.removeEventListener('change', onOsScheme));
  }

  // Build condensed toolbar (Apple Notes-style) and wire active-state updates.
  if (shell.toolbar) {
    buildCondensedToolbar(editor);
    updateThemeToggleIcon();
    editor.on('selectionUpdate', () => updateToolbarState(editor));
    editor.on('transaction', () => updateToolbarState(editor));
  }

  // M13 — Build find/replace bar and wire global keyboard shortcut.
  if (features.findReplace) {buildFindReplaceBar(editor);}

  // M5c — Initialize table drag handles and multi-cell selection
  disposers.push(initTableDrag(editor, editorContainer));

  // Spell check — start the (lazy, idle-scheduled) dictionary load with the
  // defaults. The host's `settings` broadcast reconfigures it moments later.
  configureSpellCheck(editor, {
    enabled: spellcheckAvailable && currentSpellCheckEnabled,
    language: currentSpellCheckLanguage,
    ignoreCodeBlocks: currentSpellCheckIgnoreCodeBlocks,
    userWords: [...currentSpellCheckUserWords, ...currentSpellCheckExternalWords],
  });

  // M10 — Custom context menu: prevent browser default; show custom one.
  editorContainer.addEventListener('contextmenu', (event) => {
    event.preventDefault();
    const target = event.target as HTMLElement;

    let items;
    const linkEl = target.closest<HTMLAnchorElement>('a[href]');
    const tableEl = target.closest('table');
    const imgEl = target.closest<HTMLImageElement>('img');
    const preEl = target.closest<HTMLElement>('pre.mikedown-code-block');

    // Spelling takes priority: a squiggled word is the most specific thing
    // under the pointer, and the corrections menu appends the normal text menu
    // so nothing is lost.
    const spellHit = (() => {
      if (linkEl || imgEl || preEl) {return null;}
      const coords = editor.view.posAtCoords({ left: event.clientX, top: event.clientY });
      if (!coords) {return null;}
      return getMisspellingAt(editor, coords.pos);
    })();

    if (spellHit) {
      items = buildSpellingMenu(editor, spellHit, {
        suggestions: getSuggestions(spellHit.word, 5),
        replace: (from, to, replacement) => {
          // A proper transaction — never a DOM write. insertContentAt keeps
          // the surrounding marks (bold, emphasis) on the replacement.
          editor.chain().focus().insertContentAt({ from, to }, replacement).run();
        },
        addToDictionary: (word) => {
          if (!currentSpellCheckUserWords.includes(word)) {
            currentSpellCheckUserWords = [...currentSpellCheckUserWords, word];
          }
          addWordToDictionary(editor, word);
          host.saveSettings?.({ spellCheckUserWords: currentSpellCheckUserWords }, { silent: true });
        },
        ignore: (word) => ignoreWord(editor, word),
      }, menuActions);
    } else if (linkEl) {
      items = buildLinkMenu(editor, linkEl.getAttribute('href') || '', menuActions);
    } else if (imgEl) {
      items = buildImageMenu(editor, imgEl, imageMenuActions);
    } else if (preEl || editor.isActive('codeBlock')) {
      if (preEl && !editor.isActive('codeBlock')) {
        const pos = editor.view.posAtDOM(preEl, 0);
        if (typeof pos === 'number' && pos >= 0) {
          editor.commands.setTextSelection(pos + 1);
        }
      }
      items = buildCodeBlockMenu(editor, menuActions);
    } else if (tableEl) {
      items = buildTableMenu(editor);
    } else {
      items = buildTextMenu(editor, menuActions);
    }

    showContextMenu(editor, event.clientX, event.clientY, items);
  });

  // Hide context menu on click elsewhere
  listen(document, 'mousedown', (event: MouseEvent) => {
    const targetEl = event.target as HTMLElement;
    if (!targetEl.closest('#mikedown-context-menu') && !targetEl.closest('#mikedown-context-submenu')) {
      hideContextMenu();
    }
    // M5c — Clear multi-cell selection when clicking outside a table
    if (!targetEl.closest('table')) {
      clearCellSelection();
    }
  });


  // M5b — Wire table toolbar to selection updates
  editor.on('selectionUpdate', () => {
    updateTableToolbar(editor);
    if (sourceMode) {return;} // CM listener handles selection in source mode.
    const { from, to } = editor.state.selection;
    postStats({ selection: from === to ? null : editor.state.doc.textBetween(from, to, '\n') });
  });
  // Focusing the editor with the cursor already in a table shows the toolbar.
  editor.on('focus', () => updateTableToolbar(editor));
  editor.on('blur', () => {
    // Delay hiding to allow toolbar button clicks to register
    setTimeout(() => {
      if (!document.activeElement?.closest('#mikedown-table-toolbar')) {
        hideTableToolbar();
      }
    }, 150);
  });

  // M5b — Hide grid picker on click outside
  listen(document, 'mousedown', (event: MouseEvent) => {
    if (!(event.target as HTMLElement).closest('#mikedown-table-picker')) {
      hideTableGridPicker();
    }
  });

// M13 — Global keydown listener for Cmd+F / Cmd+H when editor doesn't have focus.
  listen(document, 'keydown', (event: KeyboardEvent) => {
    if (!features.findReplace) {return;}
    if ((event.metaKey || event.ctrlKey) && event.key === 'f') {
      event.preventDefault();
      openFindBar(false);
    } else if ((event.metaKey || event.ctrlKey) && event.key === 'h') {
      event.preventDefault();
      openFindBar(true);
    }
  });

  // Cmd+A / Ctrl+A: route to the WYSIWYG editor regardless of focus state.
  //
  // We cannot delegate to ProseMirror's built-in Mod-a keymap because that
  // command builds an `AllSelection`, and AllSelection round-trips badly
  // through the view's DOM-sync pipeline inside the VS Code webview:
  //
  //   1. `Mod-a` dispatches AllSelection(0, doc.size).
  //   2. PM syncs the DOM selection, but DOM text ranges can't sit on node
  //      boundaries, so `onSelectionChange` reads it back as a TextSelection
  //      one step inside either end and dispatches a replacement tr.
  //   3. PM's `view.update()` then mutates the editor DOM to reflect the new
  //      selection class state. That mutation is visible to PM's own
  //      MutationObserver, which calls `readDOMChange`, re-parses the DOM,
  //      and finally collapses the selection to the first text position
  //      (inside the first heading). The editor also blurs along the way.
  //   4. Net effect: Cmd+A flashes for one frame, then the caret lands
  //      inside the first H1 and nothing is selected.
  //
  // TipTap's own StarterKit source has a comment noting that AllSelection
  // "doesn't work well with many other commands", and provides its own
  // alternative for the clear-document case. We sidestep the whole problem
  // by setting a plain TextSelection spanning 0..doc.size directly, which
  // round-trips through the DOM pipeline cleanly.
  //
  // Registered in the capture phase so we win over both PM's bubble-phase
  // Mod-a keymap handler and any VS Code / browser default, and we call
  // stopImmediatePropagation so neither of them see the event at all.
  listen(document, 'keydown', (event: KeyboardEvent) => {
    if (!(event.metaKey || event.ctrlKey)) {return;}
    if (event.key !== 'a' && event.key !== 'A') {return;}
    if (sourceMode) {return;} // CodeMirror has its own selectAll in source mode.

    const target = event.target as HTMLElement | null;
    // Let native Cmd+A run inside form fields (find bar, dialogs).
    if (target) {
      if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA') {return;}
      // Let native Cmd+A run inside other contenteditable regions (e.g. the
      // frontmatter block), but NOT inside the main ProseMirror editor —
      // that one must go through our TextSelection path below.
      const editorDom = editor.view.dom;
      if (target.isContentEditable && !editorDom.contains(target)) {return;}
    }

    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation();
    selectAllDocument(editor);
  }, true);

  // Cmd+F / Cmd+H — open the find (replace) bar. PM's handleKeyDown covers
  // WYSIWYG; this capture-phase listener handles source mode, where CodeMirror
  // owns the keyboard.
  listen(document, 'keydown', (event: KeyboardEvent) => {
    if (!(event.metaKey || event.ctrlKey)) {return;}
    if (event.key !== 'f' && event.key !== 'h' && event.key !== 'F' && event.key !== 'H') {return;}
    if (!features.findReplace) {return;}
    if (!sourceMode) {return;} // WYSIWYG path is handled by PM.
    // Cmd+Shift+F is the host's (desktop folder search), not the find bar.
    if (hostOwnsShortcuts && event.shiftKey) {return;}
    const target = event.target as HTMLElement | null;
    // Don't hijack the shortcut when focus is already in a form field (e.g.
    // the find bar itself) — native behavior there is fine.
    if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA')) {return;}
    event.preventDefault();
    event.stopPropagation();
    const replace = event.key === 'h' || event.key === 'H';
    openFindBar(replace);
  }, true);

  // M2c — Wire Tab/Shift+Tab custom events to editor commands.
  // These events are dispatched by the handleKeyDown prop above and executed
  // here where we have a reference to the editor instance.
  editorContainer.addEventListener('mikedown:sinkListItem', () => {
    // Attempt to sink a regular listItem; fall back to taskItem.
    const sunk =
      editor.commands.sinkListItem('listItem') ||
      editor.commands.sinkListItem('taskItem');
    void sunk;
  });

  editorContainer.addEventListener('mikedown:liftListItem', () => {
    // Attempt to lift a regular listItem; fall back to taskItem.
    const lifted =
      editor.commands.liftListItem('listItem') ||
      editor.commands.liftListItem('taskItem');
    void lifted;
  });

  // ── M7 — Image error handling: mark broken images ──────────────────────────

  if (editorContainer) {
    editorContainer.addEventListener('error', (e) => {
      const target = e.target as HTMLElement;
      if (target.tagName === 'IMG') {
        const img = target as HTMLImageElement;
        img.classList.add('broken-image');
        img.title = `Image not found: ${img.getAttribute('src') ?? ''}`;
      }
    }, true);
  }

  // ── M7 — Image popover for editing alt/src on click ────────────────────────

  const imagePopover = document.createElement('div');
  imagePopover.className = 'mikedown-image-edit-popover';
  imagePopover.innerHTML = `
  <label>Alt text</label>
  <input data-img="alt" type="text" placeholder="Describe the image">
  <label>Path or URL</label>
  <input data-img="src" type="text" placeholder="./image.png or https://...">
  <div class="popover-actions">
    <button class="secondary" data-img="cancel">Cancel</button>
    <button data-img="ok">Update</button>
  </div>
  `;
  root.appendChild(imagePopover);
  const imgAltInput = imagePopover.querySelector('[data-img="alt"]') as HTMLInputElement;
  const imgSrcInput = imagePopover.querySelector('[data-img="src"]') as HTMLInputElement;

  let editingImagePos: number | null = null;

  function hideImagePopover(): void {
    imagePopover.style.display = 'none';
    editingImagePos = null;
  }

  if (editorContainer) {
    editorContainer.addEventListener('click', (e) => {
      const target = e.target as HTMLElement;
      if (target.tagName !== 'IMG') { return; }
      const img = target as HTMLImageElement;
      const pos = editor.view.posAtDOM(img, 0);
      if (pos < 0) { return; }
      editingImagePos = pos;
      imgAltInput.value = img.alt ?? '';
      // Show the on-disk relative form (e.g. `images/foo.png`) rather than
      // the session-scoped webview URI. The Update handler re-resolves it
      // back to a webview URI before writing — done via a PM transaction so
      // PM's MutationObserver isn't poisoned by an out-of-band DOM write.
      const rawSrc = (editor.state.doc.nodeAt(pos)?.attrs.src as string | undefined) ?? img.getAttribute('src') ?? '';
      imgSrcInput.value =
        unresolveSrcForDisplay(rawSrc, imagePathMappings, docDirFsPath);
      const rect = img.getBoundingClientRect();
      imagePopover.style.display = 'block';
      imagePopover.style.top = `${rect.bottom + 8}px`;
      imagePopover.style.left = `${Math.min(rect.left, window.innerWidth - 300)}px`;
    });
  }

  // Close the popover if the image being edited is deleted (e.g. backspace
  // on a NodeSelection), or if the doc mutates such that the position no
  // longer points to an image.
  editor.on('update', () => {
    if (editingImagePos === null) {return;}
    const node = editor.state.doc.nodeAt(editingImagePos);
    if (!node || node.type.name !== 'image') {
      hideImagePopover();
    }
  });

  imagePopover.querySelector('[data-img="ok"]')?.addEventListener('click', () => {
    if (editingImagePos === null) { return; }
    const rawSrc = imgSrcInput.value;
    const alt = imgAltInput.value;
    const src = resolveSrcForEditor(rawSrc, imagePathMappings, docDirFsPath);
    editor.commands.setNodeSelection(editingImagePos);
    editor.commands.updateAttributes('image', { src, alt });
    hideImagePopover();
  });

  imagePopover.querySelector('[data-img="cancel"]')?.addEventListener('click', () => {
    hideImagePopover();
  });

  // ── Image resize: canvas downscale + host write ────────────────────────────

  function inferOutputMime(src: string): string {
    const ext = (src.split('?')[0].split('#')[0].split('.').pop() || '').toLowerCase();
    if (ext === 'jpg' || ext === 'jpeg') {return 'image/jpeg';}
    if (ext === 'webp') {return 'image/webp';}
    return 'image/png';
  }

  function isUnsupportedForCanvasResize(src: string): string | null {
    const ext = (src.split('?')[0].split('#')[0].split('.').pop() || '').toLowerCase();
    if (ext === 'svg') {return 'SVG';}
    if (ext === 'gif') {return 'GIF';}
    return null;
  }

  let toastEl: HTMLElement | null = null;
  let toastTimer: number | undefined;
  function showTransientToast(msg: string, isError = false): void {
    if (!toastEl) {
      toastEl = document.createElement('div');
      toastEl.className = 'mikedown-toast';
      root.appendChild(toastEl);
    }
    const toast = toastEl;
    toast.textContent = msg;
    toast.classList.toggle('error', isError);
    toast.classList.add('visible');
    window.clearTimeout(toastTimer);
    toastTimer = window.setTimeout(() => {
      toast.classList.remove('visible');
    }, 3000);
  }

  async function applyResizeFromMenu(img: HTMLImageElement, percent: number): Promise<void> {
    if (!Number.isFinite(percent) || percent < 1 || percent > 200) {return;}
    const pos = editor.view.posAtDOM(img, 0);
    if (pos < 0) {return;}
    const rawSrc = img.getAttribute('src') ?? '';
    const unsupported = isUnsupportedForCanvasResize(rawSrc);
    if (unsupported) {
      showTransientToast(`Cannot resize ${unsupported} images in place.`, true);
      return;
    }
    const naturalW = img.naturalWidth;
    const naturalH = img.naturalHeight;
    if (!naturalW || !naturalH) {
      showTransientToast('Image has not finished loading yet.', true);
      return;
    }
    const targetW = Math.max(1, Math.round(naturalW * (percent / 100)));
    const targetH = Math.max(1, Math.round(naturalH * (percent / 100)));
    const canvas = document.createElement('canvas');
    canvas.width = targetW;
    canvas.height = targetH;
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      showTransientToast('Canvas unavailable.', true);
      return;
    }
    try {
      ctx.drawImage(img, 0, 0, targetW, targetH);
    } catch (err) {
      showTransientToast(`Render failed: ${(err as Error).message}`, true);
      return;
    }
    const mime = inferOutputMime(rawSrc);
    const quality = mime === 'image/jpeg' ? 0.92 : undefined;
    const blob: Blob | null = await new Promise(resolve => {
      canvas.toBlob(b => resolve(b), mime, quality);
    });
    if (!blob) {
      showTransientToast('Failed to encode resized image.', true);
      return;
    }
    if (!host.resizeImage) {return;}
    const bytes = new Uint8Array(await blob.arrayBuffer());
    let result: { src: string; overwritten: boolean };
    try {
      result = await host.resizeImage({ currentSrc: rawSrc, mime, bytes, percent });
    } catch (err) {
      showTransientToast(`Resize failed: ${(err as Error)?.message || 'unknown error'}`, true);
      return;
    }
    // Replace the in-editor image's src (via PM transaction, never direct DOM
    // writes) so the new bytes render. For overwrite, append a `?v=…`
    // cache-bust so the browser re-fetches; the host strips the query.
    if (typeof result.src !== 'string') {return;}
    const newSrc = result.overwritten ? `${result.src}?v=${Date.now()}` : result.src;
    try {
      editor.commands.setNodeSelection(pos);
      editor.commands.updateAttributes('image', { src: newSrc });
    } catch { /* node may have been removed */ }
    showTransientToast(
      result.overwritten
        ? `Resized to ${percent}% — original overwritten.`
        : `Resized to ${percent}% — saved as a new file.`
    );
  }

  // Resize items in the image context menu; absent when the host can't save.
  const imageMenuActions = host.resizeImage
    ? { resize: (img: HTMLImageElement, percent: number) => { void applyResizeFromMenu(img, percent); } }
    : undefined;

  // Close popover when clicking outside
  listen(document, 'click', (e: MouseEvent) => {
    if (!imagePopover.contains(e.target as Node) && (e.target as HTMLElement).tagName !== 'IMG') {
      hideImagePopover();
    }
  }, true);

  // ── M6a: Anchor ID generation ───────────────────────────────────────────────
  //
  // There used to be an `updateHeadingAnchors` helper here that wrote
  // `data-anchor-id` onto every H1..H6 on every transaction (debounced
  // 300 ms). It was dead code — nothing ever read `data-anchor-id`. Both
  // `computeAnchorIdFor` (see top of file) and the `scrollToAnchor` handler
  // below walk the headings and compute IDs from `textContent` on demand.
  //
  // It was ALSO the root cause of a nasty select-all bug: writing attributes
  // inside `editor.view.dom` poisoned ProseMirror's MutationObserver queue
  // with mutations that weren't real content changes. On the next
  // transaction, PM's `DOMObserver.stop()` drained those pending mutations
  // and scheduled a 20 ms-delayed `flush()` → `readDOMChange`, which would
  // then land *after* a select-all selection was dispatched, re-parse the
  // now-current DOM with stale mutation data, and collapse the selection
  // back to (1, 1). Deleting this helper is the fix.

  // ── M6c: Broken link scanning ───────────────────────────────────────────────

  /**
   * Scan all links in the editor and send them to the extension host for
   * validation. The host replies with a 'brokenLinks' message listing hrefs
   * that could not be resolved.
   */
  function scanAndCheckLinks(): void {
    const links: Array<{ href: string; type: 'anchor' | 'file' | 'fileAnchor' }> = [];
    editorContainer.querySelectorAll('.ProseMirror a[href]').forEach(el => {
      const href = el.getAttribute('href') || '';
      if (!href || href.startsWith('http://') || href.startsWith('https://')) {return;}
      // Non-resolvable schemes — let the OS handle them, don't flag as broken.
      if (/^(mailto|tel|sms|ftp|ftps|news|nntp|magnet|irc|xmpp|skype|callto|geo|bitcoin):/i.test(href)) {return;}
      if (href.startsWith('#')) {
        links.push({ href, type: 'anchor' });
      } else if (href.includes('#')) {
        links.push({ href, type: 'fileAnchor' });
      } else {
        links.push({ href, type: 'file' });
      }
    });
    if (links.length > 0 && host.checkLinks) {
      host.checkLinks(links).then(applyBrokenLinks, () => { /* host failed: leave marks as they are */ });
    }
  }

  let linkCheckTimer: ReturnType<typeof setTimeout> | undefined;
  function scheduleLinkCheck(): void {
    clearTimeout(linkCheckTimer);
    linkCheckTimer = setTimeout(() => {
      scanAndCheckLinks();
    }, 500);
  }

  // Wire link scan on editor updates (debounced) so heading renames are caught.
  editor.on('update', scheduleLinkCheck);

  if (shell.sidebar && shell.sidebarToggle) {outlineSidebar = createOutlineSidebar({
    editor,
    sidebarEl: shell.sidebar,
    toggleEl: shell.sidebarToggle,
    scrollContainer: editorContainer,
    prefs: host.sidebarPrefs,
    onOpenTag: host.openTag ? (tag) => host.openTag?.(tag) : undefined,
    onOpenBacklink: (item) => {
      // A backlinks panel is a reference tool: open the source beside the
      // current doc and scroll it to the link back here.
      host.openLink?.(item.uri, 'openNewTab', { href: item.linkHref, occurrence: item.occurrence });
    },
    anchorFn: githubAnchorId,
    onPropertiesChange: applyFrontmatterEdit,
    // Footer link (VS Code: the support appeal). The host owns what opening
    // and dismissing do; see handle.setSidebarFooterLink.
    onSupportOpen: () => sidebarFooterLink?.onOpen(),
    onSupportDismiss: () => sidebarFooterLink?.onDismiss(),
    onAiIndicatorClick: () => openAiFromChip(),
    onSuggestProperties: () => { startAiPropertySuggestions(); },
    onApplyPropertySuggestion: applyAiPropertySuggestion,
    onCancelPropertySuggestions: () => cancelAiPropertySuggestions(),
  });
  disposers.push(() => outlineSidebar?.destroy());
  syncAiPropertiesAvailability();
  }

  // ── Heading Rename → Fix Links (2.7.0) ─────────────────────────────────────
  // Detect heading renames via selection-scoped baselining: snapshot the slug
  // when the cursor enters a heading, recompute when it leaves (or after an
  // ~800ms idle debounce). A changed slug emits a single rename event — keystroke
  // noise collapses because we only compare at the boundaries. See
  // planning/HEADING-RENAME-LINKS.md and src/webview/headingRename.ts.

  // Preference broadcast from the host (mikedown.headingRename.updateLinks).
  // Gates the whole detector: `never` means we never touch links.
  let headingRenamePref: 'ask' | 'always' | 'never' = 'ask';

  // The heading currently under the cursor. `startPos` is the node's start
  // position — stable while editing within the heading (only content *before*
  // it shifts it, which can't happen while the cursor is inside).
  let trackedHeading: { startPos: number; baselineText: string } | null = null;
  let headingIdleTimer: ReturnType<typeof setTimeout> | null = null;

  // Find the heading node containing the selection head, if any.
  function headingAtSelection(): { startPos: number; text: string } | null {
    const { $head } = editor.state.selection;
    for (let depth = $head.depth; depth > 0; depth--) {
      const node = $head.node(depth);
      if (node.type.name === 'heading') {
        return { startPos: $head.before(depth), text: node.textContent };
      }
    }
    return null;
  }

  // Read the current text of the heading node that starts at `pos`, or null if
  // it is no longer a heading there (e.g. the heading was deleted).
  function headingTextAt(pos: number): string | null {
    if (pos < 0 || pos > editor.state.doc.content.size) {return null;}
    const node = editor.state.doc.nodeAt(pos);
    return node && node.type.name === 'heading' ? node.textContent : null;
  }

  // Every heading's text in document order — for the duplicate-slug guard.
  function allHeadingTexts(): string[] {
    const texts: string[] = [];
    editor.state.doc.descendants((node) => {
      if (node.type.name === 'heading') {
        texts.push(node.textContent);
        return false;
      }
      return true;
    });
    return texts;
  }

  // Rewrite every in-doc link whose href is `#oldSlug` → `#newSlug` in a single
  // ProseMirror transaction. (Never mutate editor.view.dom directly — see
  // feedback_prosemirror_dom_writes.) Returns the number of links rewritten.
  function rewriteInDocLinks(oldSlug: string, newSlug: string): number {
    const { state } = editor;
    const linkType = state.schema.marks.link;
    if (!linkType) {return 0;}
    const oldHref = `#${oldSlug}`;
    const newHref = `#${newSlug}`;
    let tr = state.tr;
    let count = 0;
    state.doc.descendants((node, pos) => {
      if (!node.isText) {return;}
      for (const mark of node.marks) {
        if (mark.type === linkType && mark.attrs.href === oldHref) {
          const end = pos + node.nodeSize;
          tr = tr
            .removeMark(pos, end, linkType)
            .addMark(pos, end, linkType.create({ ...mark.attrs, href: newHref }));
          count++;
        }
      }
    });
    if (tr.docChanged) {editor.view.dispatch(tr);}
    return count;
  }

  // A settled rename: fix in-doc links, guard duplicates, ask host for cross-file.
  function handleHeadingRename(oldSlug: string, newSlug: string): void {
    if (headingRenamePref === 'never') {return;}
    // Duplicate-slug guard — refuse to guess when anchors are ambiguous.
    if (isRenameAmbiguous(allHeadingTexts(), oldSlug, newSlug)) {
      host.onHeadingRenameAmbiguous?.(oldSlug);
      return;
    }
    // In-doc TOC links are low-risk and self-contained: fix them immediately.
    rewriteInDocLinks(oldSlug, newSlug);
    // Cross-file backlinks live in files the host owns — hand off for the
    // count + (per pref) the prompt + WorkspaceEdit.
    host.onHeadingRenamed?.(oldSlug, newSlug);
  }

  // Compare the tracked heading's current text against its baseline; if the slug
  // changed, emit a rename and re-baseline so chained renames keep working.
  function settleTrackedHeading(): void {
    if (!trackedHeading) {return;}
    const current = headingTextAt(trackedHeading.startPos);
    if (current === null) {
      trackedHeading = null;
      return;
    }
    const event = detectHeadingRename(trackedHeading.baselineText, current);
    if (event) {
      handleHeadingRename(event.oldSlug, event.newSlug);
      trackedHeading.baselineText = current; // re-baseline for the next rename
    }
  }

  // Keep `trackedHeading` in sync with the selection: settle on leave/move,
  // baseline on enter.
  function syncHeadingTracking(): void {
    if (headingRenamePref === 'never') {
      trackedHeading = null;
      return;
    }
    const here = headingAtSelection();
    if (trackedHeading && (!here || here.startPos !== trackedHeading.startPos)) {
      settleTrackedHeading(); // left this heading (or moved to another)
      trackedHeading = null;
    }
    if (here && !trackedHeading) {
      trackedHeading = { startPos: here.startPos, baselineText: here.text };
    }
  }

  editor.on('selectionUpdate', syncHeadingTracking);
  editor.on('update', () => {
    // Idle-settle so a rename applies promptly even without moving the cursor.
    if (headingIdleTimer) {clearTimeout(headingIdleTimer);}
    headingIdleTimer = setTimeout(settleTrackedHeading, 800);
  });

  // ── Heading numbering (#6) ────────────────────────────────────────────────
  // Section numbers are real heading text, so every change goes through a
  // transaction. Only top-level headings count: headings inside blockquotes,
  // callouts, or list items are quoted content (the outline skips them too).
  // A document counts as numbered when its headings already carry numbers
  // (see isNumbered), so the toolbar toggle needs no per-file state.

  const RENUMBER_META = 'mikedownRenumber';
  let renumberTimer: ReturnType<typeof setTimeout> | null = null;
  // Set by a user edit, cleared once a pass has caught up. Keeps cursor moves
  // (including the one a fresh load makes) from renumbering untouched files.
  let numbersStale = false;

  function topLevelHeadings(): Array<{ pos: number; info: HeadingInfo; firstText: string | null }> {
    const list: Array<{ pos: number; info: HeadingInfo; firstText: string | null }> = [];
    editor.state.doc.forEach((node, pos) => {
      if (node.type.name !== 'heading') {return;}
      const first = node.firstChild;
      list.push({
        pos,
        info: { level: node.attrs.level as number, text: node.textContent },
        firstText: first?.isText ? first.text ?? '' : null,
      });
    });
    return list;
  }

  // Apply prefix edits in one transaction, and repoint in-doc `#slug` links
  // at the renumbered headings. `live` edits stay out of the undo history so
  // Cmd+Z undoes the user's own change (which then renumbers again).
  function applyNumberingEdits(
    edits: PrefixEdit[],
    list: ReturnType<typeof topLevelHeadings>,
    live: boolean,
  ): void {
    if (!edits.length) {return;}
    const { state } = editor;
    const tr = state.tr;
    const slugMap = new Map<string, string>();
    // Last heading first, so earlier positions stay valid.
    for (const edit of [...edits].reverse()) {
      const h = list[edit.index];
      // The prefix must sit in the heading's first text node; skip headings
      // that open with an emoji, image, or a mark boundary inside the number.
      if (edit.oldPrefix && !(h.firstText ?? '').startsWith(edit.oldPrefix)) {continue;}
      const from = h.pos + 1;
      const to = from + edit.oldPrefix.length;
      if (edit.newPrefix) {
        tr.replaceWith(from, to, state.schema.text(edit.newPrefix));
      } else {
        tr.delete(from, to);
      }
      const oldSlug = githubAnchorId(h.info.text);
      const newSlug = githubAnchorId(applyPrefixEdit(h.info.text, edit));
      if (oldSlug && newSlug && oldSlug !== newSlug) {slugMap.set(oldSlug, newSlug);}
    }
    if (!tr.docChanged) {return;}

    const linkType = state.schema.marks.link;
    if (linkType && slugMap.size && headingRenamePref !== 'never') {
      tr.doc.descendants((node, pos) => {
        if (!node.isText) {return;}
        for (const mark of node.marks) {
          const href = mark.attrs.href as unknown;
          if (mark.type !== linkType || typeof href !== 'string' || !href.startsWith('#')) {continue;}
          const target = slugMap.get(href.slice(1));
          if (target) {
            const end = pos + node.nodeSize;
            tr.removeMark(pos, end, linkType).addMark(pos, end, linkType.create({ ...mark.attrs, href: `#${target}` }));
          }
        }
      });
    }

    // Keep the rename detector in step, or it would read our prefix change
    // as the user renaming the heading.
    if (trackedHeading) {
      const tracked = trackedHeading;
      const index = list.findIndex((h) => h.pos === tracked.startPos);
      const edit = edits.find((e) => e.index === index);
      if (edit && tracked.baselineText.startsWith(edit.oldPrefix)) {
        tracked.baselineText = applyPrefixEdit(tracked.baselineText, edit);
      }
      tracked.startPos = tr.mapping.map(tracked.startPos);
    }

    tr.setMeta(RENUMBER_META, true);
    if (live) {tr.setMeta('addToHistory', false);}
    editor.view.dispatch(tr);
  }

  // Renumber after edits settle. The heading under the cursor is left alone
  // so typing a new heading isn't interrupted; it gets its number on leave.
  function renumberLive(): void {
    renumberTimer = null;
    if (!numbersStale || isLoading || sourceMode || currentHeadingNumbering === 'off') {return;}
    const list = topLevelHeadings();
    const infos = list.map((h) => h.info);
    if (!isNumbered(infos, currentHeadingNumbering)) {
      numbersStale = false;
      return;
    }
    const here = headingAtSelection();
    const skip = here ? list.findIndex((h) => h.pos === here.startPos) : -1;
    // Still stale while the cursor sits in a heading we skipped.
    numbersStale = skip !== -1;
    applyNumberingEdits(renumberEdits(infos, currentHeadingNumbering, skip), list, true);
  }

  editor.on('update', ({ transaction }) => {
    // isLoading: a document opened from disk is never renumbered on load,
    // which would mark it dirty before the user touched it.
    if (isLoading || currentHeadingNumbering === 'off' || transaction.getMeta(RENUMBER_META)) {return;}
    numbersStale = true;
    if (renumberTimer) {clearTimeout(renumberTimer);}
    renumberTimer = setTimeout(renumberLive, 400);
  });
  // Leaving a heading lets its number catch up.
  editor.on('selectionUpdate', () => {
    if (numbersStale && !renumberTimer) {renumberTimer = setTimeout(renumberLive, 400);}
  });

  // ── Table of contents sync (#11) ──────────────────────────────────────────
  // A TOC block follows the headings: after edits settle, rewrite any TOC
  // whose list no longer matches. Outside the undo history, so Cmd+Z undoes
  // the user's edit and the TOC follows it again. A load also runs it once
  // (refreshTocAfterLoad), for headings edited in another editor: an
  // up-to-date TOC is a no-op, a stale one is rewritten and dirties the file.
  const TOC_SYNC_META = 'mikedownTocSync';
  let tocSyncTimer: ReturnType<typeof setTimeout> | null = null;
  let tocLoadRefreshPending = false;

  const runTocSync = (): void => {
    tocSyncTimer = null;
    if (isLoading || sourceMode || editor.isDestroyed || !editor.isEditable) {return;}
    const fromLoad = tocLoadRefreshPending;
    tocLoadRefreshPending = false;
    const tr = syncTableOfContents(editor.state);
    if (!tr) {return;}
    // The refresh isn't undoable, so after an on-open rewrite the loaded undo
    // depth no longer means "matches the file" (that would send the stale
    // original back as pristine).
    if (fromLoad && !tr.getMeta(TOC_DISPLAY_ONLY_META)) {lastSavedUndoDepth = null;}
    tr.setMeta(TOC_SYNC_META, true).setMeta('addToHistory', false);
    editor.view.dispatch(tr);
  };

  const scheduleTocSync = (delay: number): void => {
    if (tocSyncTimer) {clearTimeout(tocSyncTimer);}
    tocSyncTimer = setTimeout(runTocSync, delay);
  };

  refreshTocAfterLoad = () => {
    tocLoadRefreshPending = true;
    scheduleTocSync(0);
  };

  editor.on('update', ({ transaction }) => {
    if (isLoading || transaction.getMeta(TOC_SYNC_META)) {return;}
    scheduleTocSync(300);
  });

  documentIsNumbered = () => isNumbered(topLevelHeadings().map((h) => h.info), currentHeadingNumbering);

  toggleHeadingNumbers = () => {
    if (sourceMode || currentHeadingNumbering === 'off') {return;}
    const list = topLevelHeadings();
    const infos = list.map((h) => h.info);
    const edits = isNumbered(infos, currentHeadingNumbering)
      ? stripEdits(infos, currentHeadingNumbering)
      : renumberEdits(infos, currentHeadingNumbering, -1, true);
    applyNumberingEdits(edits, list, false);
  };

  // 2.4.0 — Sidebar inline editing: serialize the new entries back to YAML,
  // splice into the full doc, and post via the existing `edit` channel.
  // The WYSIWYG frontmatter block + sidebar both re-render off the same
  // refreshed frontmatterContent so they stay in lockstep. In source mode
  // the user edits YAML directly in CodeMirror; the sidebar reflects but
  // doesn't drive (see refreshPropertiesEditable below).
  function applyFrontmatterEdit(entries: ParsedEntry[]): void {
    applyFrontmatterYaml(serializeFrontmatter(entries));
  }

  /** The persist-and-re-render half of `applyFrontmatterEdit`, for YAML built elsewhere. */
  function applyFrontmatterYaml(newYaml: string): void {
    if (sourceMode) {return;}
    if (newYaml === frontmatterContent) {return;}
    frontmatterContent = newYaml;
    const markdown = serializeDocument();
    isDirty = markdown !== originalContent;
    notifyChange(markdown, { pristine: false });
    renderFrontmatterBlock();
    refreshPropertiesSidebar();
  }

  function refreshPropertiesSidebar(): void {
    outlineSidebar?.applyProperties(parseFrontmatter(frontmatterContent ?? ''), {
      editable: !sourceMode && isSimpleFrontmatter(frontmatterContent ?? ''),
    });
    syncAiPropertiesAvailability();
  }

  // M6 — `/properties`: insert an empty frontmatter block (no entries yet;
  // the user fills them in via the sidebar's "+ Add property") and persist
  // it exactly like a sidebar edit would (`applyFrontmatterEdit` above is
  // the same shape, but that one always has entries — this is the one path
  // that goes from "no frontmatter" to "frontmatter present" with zero of
  // them). Returns a `revert` that undoes exactly this side effect; the
  // slash-command action calls it when it detects the paired PM-doc
  // deletion of `/query` was undone (frontmatterContent lives outside the
  // ProseMirror doc, so PM's own undo can't reach it — see slashcommands-
  // actions.ts's actionProperties).
  function insertEmptyFrontmatter(): { revert: () => void } {
    const hadFrontmatter = frontmatterContent !== null;
    const previousContent = frontmatterContent;
    const previousExpanded = frontmatterExpanded;

    frontmatterContent = '';
    frontmatterExpanded = true;
    const markdown = serializeDocument();
    isDirty = markdown !== originalContent;
    notifyChange(markdown, { pristine: false });
    renderFrontmatterBlock();
    refreshPropertiesSidebar();

    return {
      revert: () => {
        // Should never fire when frontmatter already existed (`/properties`
        // is only offered when it doesn't — see requiresNoFrontmatter in the
        // registry), but don't clobber real content if it somehow does.
        if (hadFrontmatter) {return;}
        frontmatterContent = previousContent;
        frontmatterExpanded = previousExpanded;
        const reverted = serializeDocument();
        isDirty = reverted !== originalContent;
        notifyChange(reverted, { pristine: false });
        renderFrontmatterBlock();
        refreshPropertiesSidebar();
      },
    };
  }

  // ── M6a: Link click handler (Cmd+Click to navigate) ────────────────────────
  // Use mousedown in capture phase so it fires before ProseMirror's own
  // mousedown handler (which would consume the event for cursor placement).
  // This ensures Cmd+Click / Ctrl+Click reliably navigates links.

  editorContainer.addEventListener('mousedown', (event) => {
    if (!event.metaKey && !event.ctrlKey) {return;}
    if (event.button !== 0) {return;} // left-click only

    const target = event.target as HTMLElement;

    // Inline #tag → find documents carrying it (Cmd/Ctrl+click, like links).
    const tagEl = target.closest<HTMLElement>('.mikedown-tag');
    if (tagEl) {
      event.preventDefault();
      event.stopPropagation();
      const tag = tagEl.getAttribute('data-tag');
      if (tag) {host.openTag?.(tag);}
      return;
    }

    // Phase 6 — Unresolved wikilink (no href): ask the host to create the
    // target file (Obsidian-style). The host no-ops unless the user has opted
    // in via mikedown.wikilink.createOnClick. Resolved wikilinks carry an href
    // and fall through to the normal openLink path below.
    const wikiEl = target.closest('a[data-wikilink]');
    if (wikiEl && !wikiEl.getAttribute('href')) {
      if (!currentWikilinkCreateOnClick) {return;} // opt-in only
      event.preventDefault();
      event.stopPropagation();
      const wikiTarget = wikiEl.getAttribute('data-target') || '';
      if (wikiTarget && host.createWikilink) {
        void Promise.resolve(host.createWikilink(wikiTarget)).then((results) => {
          if (results) {applyWikilinkResults(results);}
        }, () => { /* host could not create the file */ });
      }
      return;
    }

    const linkEl = target.closest('a[href]');
    if (!linkEl) {return;}

    event.preventDefault();
    event.stopPropagation();

    const href = linkEl.getAttribute('href') || '';

    if (currentLinkClickBehavior === 'showContextMenu') {
      // Show a mini context menu with navigation options
      const items = buildLinkMenu(editor, href, menuActions);
      showContextMenu(editor, event.clientX, event.clientY, items);
    } else {
      openLinkViaHost(href);
    }
  }, true);

  // ── Wikilink resolution ─────────────────────────────────────────────────────
  // `[[Note]]` targets are name-based; the host resolves each bare name to a
  // relative href by basename search. We cache target → href|null (constant for
  // the life of this webview since the doc dir never changes) and stamp the
  // resolved `href`/`resolved` attrs onto matching nodes via an
  // `addToHistory:false` transaction — so navigation lights up without dirtying
  // the document, pushing an undo step, or mutating PM's DOM directly.

  // target(lowercased) → resolution. `count` is how many workspace files share
  // the basename: 0 = unresolved, 1 = unique, >1 = ambiguous (resolved to the
  // nearest, flagged with a hint).
  const wikilinkResolutionCache = new Map<string, { href: string | null; count: number }>();
  let wikilinkResolveTimer: ReturnType<typeof setTimeout> | null = null;

  function collectWikilinkTargets(): string[] {
    const targets = new Set<string>();
    editor.state.doc.descendants((node) => {
      if (node.type.name === 'wikilink' && node.attrs.target) {
        targets.add(String(node.attrs.target));
      }
    });
    return [...targets];
  }

  // Stamp cached resolution onto every wikilink node whose target is known.
  function applyWikilinkResolution(): void {
    const { state } = editor;
    let tr = state.tr;
    let changed = false;
    state.doc.descendants((node, pos) => {
      if (node.type.name !== 'wikilink') {return;}
      const key = String(node.attrs.target || '').toLowerCase();
      const entry = wikilinkResolutionCache.get(key);
      if (!entry) {return;}
      const base = entry.href;
      const resolved = base !== null;
      const ambiguous = resolved && entry.count > 1;
      const href = resolved
        ? base + (node.attrs.anchor ? '#' + node.attrs.anchor : '')
        : null;
      if (
        node.attrs.href === href &&
        node.attrs.resolved === resolved &&
        node.attrs.ambiguous === ambiguous
      ) {return;}
      tr = tr.setNodeMarkup(pos, undefined, { ...node.attrs, href, resolved, ambiguous });
      changed = true;
    });
    if (changed) {
      tr.setMeta('addToHistory', false);
      editor.view.dispatch(tr);
    }
  }

  // Ask the host for any target we haven't resolved yet, then (re)apply.
  function requestWikilinkResolution(): void {
    const need = collectWikilinkTargets().filter(
      (t) => !wikilinkResolutionCache.has(t.toLowerCase())
    );
    if (need.length > 0 && host.resolveWikilinks) {
      host.resolveWikilinks(need).then(applyWikilinkResults, () => { /* leave unresolved */ });
    } else {
      applyWikilinkResolution();
    }
  }

  function scheduleWikilinkResolution(): void {
    if (wikilinkResolveTimer) {clearTimeout(wikilinkResolveTimer);}
    wikilinkResolveTimer = setTimeout(() => requestWikilinkResolution(), 250);
  }

  // ── M6a: Heading anchor icon click handler ──────────────────────────────────

  editorContainer.addEventListener('click', (event) => {
    const target = event.target as HTMLElement;
    const heading = target.closest<HTMLElement>('h1,h2,h3,h4,h5,h6');
    if (!heading) {return;}

    // Only trigger if click is in the left margin area (before the text)
    const rect = heading.getBoundingClientRect();
    if (event.clientX < rect.left) {
      // Compute anchor ID dynamically from heading text
      const anchorId = computeAnchorIdFor(heading);
      if (anchorId) {
        navigator.clipboard?.writeText(`#${anchorId}`).catch(() => {});
        // Brief visual feedback
        heading.style.outline = '1px solid var(--mikedown-focus-ring)';
        setTimeout(() => { heading.style.outline = ''; }, 600);
      }
    }
  });

  // ── M6a: Link tooltip on hover ──────────────────────────────────────────────

  editorContainer.addEventListener('mouseover', (event) => {
    const target = event.target as HTMLElement;
    const linkEl = target.closest<HTMLAnchorElement>('a[data-wikilink], a[href]');
    if (!linkEl) {
      if (linkTooltip) { linkTooltip.style.display = 'none'; }
      return;
    }

    const href = linkEl.getAttribute('href') || '';
    if (!linkTooltip) {
      linkTooltip = document.createElement('div');
      linkTooltip.className = 'mikedown-link-tooltip';
      root.appendChild(linkTooltip);
    }
    const mod = navigator.platform.includes('Mac') ? 'Cmd' : 'Ctrl';
    if (linkEl.hasAttribute('data-wikilink')) {
      // Wikilink-specific hints: ambiguity, unresolved, or plain open.
      const wt = linkEl.getAttribute('data-target') || '';
      const entry = wikilinkResolutionCache.get(wt.toLowerCase());
      if (linkEl.classList.contains('mikedown-wikilink-ambiguous')) {
        const n = entry?.count ?? 0;
        linkTooltip.textContent = `${n} notes named “${wt}” — linked to the nearest. Rename to disambiguate.`;
      } else if (linkEl.classList.contains('mikedown-unresolved')) {
        linkTooltip.textContent = currentWikilinkCreateOnClick
          ? `${mod}+Click to create “${wt}.md”`
          : `No file named “${wt}” in the workspace`;
      } else {
        linkTooltip.textContent = `${mod}+Click to open`;
      }
    } else if (linkEl.classList.contains('mikedown-broken-link')) {
      // M6c — Show broken link tooltip if this link is marked as broken.
      linkTooltip.textContent = linkEl.title || `Broken link: ${href}`;
    } else {
      linkTooltip.textContent = `${mod}+Click to open`;
    }
    linkTooltip.style.display = 'block';
    const r = linkEl.getBoundingClientRect();
    linkTooltip.style.left = `${r.left}px`;
    linkTooltip.style.top = `${r.bottom + 4}px`;
  });

  editorContainer.addEventListener('mouseout', (event) => {
    const target = event.target as HTMLElement;
    if (target.closest('a[href]') && !linkTooltip?.contains(event.relatedTarget as Node)) {
      if (linkTooltip) {linkTooltip.style.display = 'none';}
    }
  });

  // ── Code block floating overlay (copy + language pill) ───────────────────
  // Floating buttons that appear in the top-right of a hovered code block.
  // Live in document.body to avoid mutating ProseMirror's managed DOM.
  {
    let copyBtn: HTMLButtonElement | null = null;
    let langBtn: HTMLButtonElement | null = null;
    let hoveredPre: HTMLElement | null = null;
    let hideTimer: number | null = null;

    const copyIconSvg = '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="5" y="5" width="9" height="9" rx="1.5"/><path d="M11 5V3a1 1 0 0 0-1-1H3a1 1 0 0 0-1 1v7a1 1 0 0 0 1 1h2"/></svg>';
    const checkIconSvg = '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="3 8.5 6.5 12 13 4"/></svg>';

    const openPickerForPre = (pre: HTMLElement): void => {
      if (!editor.isActive('codeBlock')) {
        const pos = editor.view.posAtDOM(pre, 0);
        if (typeof pos === 'number' && pos >= 0) {
          editor.commands.setTextSelection(pos + 1);
        }
      }
      const currentLanguage = pre.getAttribute('data-language') || '';
      const allLanguages = lowlight.listLanguages();
      const anchorRect = (langBtn && langBtn.classList.contains('visible')
        ? langBtn.getBoundingClientRect()
        : pre.getBoundingClientRect());
      showLanguagePicker(editor, {
        anchorRect,
        currentLanguage,
        allLanguages,
      });
    };

    const ensureCopyBtn = (): HTMLButtonElement => {
      if (copyBtn) {return copyBtn;}
      copyBtn = document.createElement('button');
      copyBtn.className = 'mikedown-code-copy-btn';
      copyBtn.type = 'button';
      copyBtn.title = 'Copy code';
      copyBtn.setAttribute('aria-label', 'Copy code');
      copyBtn.innerHTML = copyIconSvg;
      copyBtn.addEventListener('mouseenter', () => {
        if (hideTimer) { clearTimeout(hideTimer); hideTimer = null; }
      });
      copyBtn.addEventListener('mouseleave', () => scheduleHide());
      // eslint-disable-next-line @typescript-eslint/no-misused-promises -- fire-and-forget by design; addEventListener ignores the returned promise
      copyBtn.addEventListener('click', async (e) => {
        e.preventDefault();
        e.stopPropagation();
        if (!hoveredPre) {return;}
        const codeEl = hoveredPre.querySelector('code') ?? hoveredPre;
        const text = codeEl.textContent ?? '';
        try {
          await navigator.clipboard.writeText(text);
          copyBtn!.innerHTML = checkIconSvg;
          copyBtn!.classList.add('copied');
          setTimeout(() => {
            if (copyBtn) {
              copyBtn.innerHTML = copyIconSvg;
              copyBtn.classList.remove('copied');
            }
          }, 1200);
        } catch {
          // Clipboard write failed (permissions, etc.) — silent.
        }
      });
      root.appendChild(copyBtn);
      return copyBtn;
    };

    const ensureLangBtn = (): HTMLButtonElement => {
      if (langBtn) {return langBtn;}
      langBtn = document.createElement('button');
      langBtn.className = 'mikedown-code-language-btn';
      langBtn.type = 'button';
      langBtn.title = 'Change language';
      langBtn.setAttribute('aria-label', 'Change code block language');
      langBtn.addEventListener('mouseenter', () => {
        if (hideTimer) { clearTimeout(hideTimer); hideTimer = null; }
      });
      langBtn.addEventListener('mouseleave', () => scheduleHide());
      langBtn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        if (!hoveredPre) {return;}
        openPickerForPre(hoveredPre);
      });
      root.appendChild(langBtn);
      return langBtn;
    };

    const positionFor = (pre: HTMLElement): void => {
      const lBtn = ensureLangBtn();
      const cBtn = ensureCopyBtn();

      const lang = (pre.getAttribute('data-language') || '').trim();
      const hasLang = lang && lang !== 'plaintext' && lang !== 'null';
      lBtn.textContent = hasLang ? lang : 'plaintext';
      lBtn.classList.toggle('placeholder', !hasLang);
      lBtn.classList.add('visible');
      cBtn.classList.add('visible');

      const r = pre.getBoundingClientRect();
      lBtn.style.top = `${r.top}px`;
      lBtn.style.left = `${r.right - lBtn.offsetWidth}px`;
      cBtn.style.top = `${r.top + 4}px`;
      cBtn.style.left = `${r.right - cBtn.offsetWidth - lBtn.offsetWidth - 4}px`;
    };

    const scheduleHide = (): void => {
      if (hideTimer) {clearTimeout(hideTimer);}
      hideTimer = window.setTimeout(() => {
        if (copyBtn) {copyBtn.classList.remove('visible');}
        if (langBtn) {langBtn.classList.remove('visible');}
        hoveredPre = null;
        hideTimer = null;
      }, 150);
    };

    editorContainer.addEventListener('mouseover', (event) => {
      const target = event.target as HTMLElement;
      const pre = target.closest<HTMLElement>('pre.mikedown-code-block');
      if (!pre) {return;}
      if (hideTimer) { clearTimeout(hideTimer); hideTimer = null; }
      hoveredPre = pre;
      positionFor(pre);
    });

    editorContainer.addEventListener('mouseout', (event) => {
      const target = event.target as HTMLElement;
      const pre = target.closest<HTMLElement>('pre.mikedown-code-block');
      if (!pre) {return;}
      const related = event.relatedTarget as Node | null;
      if (related && (pre.contains(related) || copyBtn?.contains(related) || langBtn?.contains(related))) {return;}
      scheduleHide();
    });

    // Hide when the code block scrolls or the window resizes (position would be stale).
    listen(window, 'scroll', () => {
      if (copyBtn) {copyBtn.classList.remove('visible');}
      if (langBtn) {langBtn.classList.remove('visible');}
      hoveredPre = null;
    }, true);

    // Reposition pill after editor updates (language attr may have changed).
    editor.on('transaction', () => {
      if (hoveredPre && hoveredPre.isConnected) {positionFor(hoveredPre);}
    });

    // Expose entry point for the context menu "Set language…" action.
    showLanguagePickerForSelection = () => {
      let pre: HTMLElement | null = hoveredPre;
      if (!pre) {
        // Fall back to the code block at the current selection.
        const $from = editor.state.selection.$from;
        for (let depth = $from.depth; depth > 0; depth--) {
          const node = $from.node(depth);
          if (node.type.name === 'codeBlock') {
            const start = $from.before(depth);
            const dom = editor.view.nodeDOM(start) as HTMLElement | null;
            if (dom) {pre = dom.closest('pre.mikedown-code-block') || dom;}
            break;
          }
        }
      }
      if (pre) {
        openPickerForPre(pre);
      } else {
        // Last resort: open centered with no anchor.
        showLanguagePicker(editor, {
          currentLanguage: '',
          allLanguages: lowlight.listLanguages(),
        });
      }
    };
  }

  // ── M6a: Cmd-held class tracking (changes link cursor on hover) ─────────────

  listen(document, 'keydown', (e: KeyboardEvent) => {
    if (e.metaKey || e.ctrlKey) {root.classList.add('cmd-held');}
  });
  listen(document, 'keyup', (e: KeyboardEvent) => {
    if (!e.metaKey && !e.ctrlKey) {root.classList.remove('cmd-held');}
  });

  // ── M15: Frontmatter UI block renderer ─────────────────────────────────────

  let frontmatterBlockEl: HTMLElement | null = null;

  function renderFrontmatterBlock(): void {
    // Remove existing frontmatter block if any
    frontmatterBlockEl?.remove();
    frontmatterBlockEl = null;

    if (frontmatterContent === null || !features.frontmatter) {return;}

    const block = document.createElement('div');
    frontmatterBlockEl = block;
    block.className = frontmatterExpanded ? 'frontmatter-block expanded' : 'frontmatter-block collapsed';

    const header = document.createElement('div');
    header.className = 'frontmatter-header';
    header.innerHTML = `<span class="frontmatter-icon">▶</span> <span class="frontmatter-label">Frontmatter</span>`;
    header.addEventListener('click', () => {
      frontmatterExpanded = !frontmatterExpanded;
      renderFrontmatterBlock();
    });

    block.appendChild(header);

    if (frontmatterExpanded) {
      const content = document.createElement('pre');
      content.className = 'frontmatter-content';
      content.contentEditable = 'true';
      content.textContent = frontmatterContent;
      content.addEventListener('input', () => {
        frontmatterContent = content.textContent || '';
        // Trigger an edit to propagate changes
        const markdown = serializeDocument();
        notifyChange(markdown, { pristine: false });
      });
      block.appendChild(content);
    }

    // Insert frontmatter block BEFORE the editor container
    editorContainer.parentNode?.insertBefore(block, editorContainer);
  }

  // ── Diff Highlighting ────────────────────────────────────────────────────────

  /**
   * Simple line-level diff: returns the set of 0-based line indices in `current`
   * that were added or changed relative to `original`.
   * Uses a longest-common-subsequence approach on blocks (paragraph-separated).
   */
  function computeChangedBlocks(original: string, current: string): Set<number> {
    const origBlocks = original.split(/\n{2,}/);
    const curBlocks = current.split(/\n{2,}/);
    const origSet = new Set(origBlocks.map(b => b.trim()));
    const changed = new Set<number>();

    // Walk current blocks and mark any that don't exist in HEAD
    let lineIdx = 0;
    for (const block of curBlocks) {
      const trimmed = block.trim();
      const lineCount = block.split('\n').length;
      if (trimmed && !origSet.has(trimmed)) {
        for (let i = 0; i < lineCount; i++) {
          changed.add(lineIdx + i);
        }
      }
      lineIdx += lineCount + 1; // +1 for the blank separator line
    }
    return changed;
  }

  /**
   * Apply or clear diff decorations on the WYSIWYG editor.
   */
  function applyDiffDecorations(): void {
    // Remove existing diff classes from all top-level nodes
    const proseMirrorEl = editor.view.dom;
    if (proseMirrorEl) {
      proseMirrorEl.querySelectorAll('.mikedown-diff-changed').forEach(el => {
        el.classList.remove('mikedown-diff-changed');
      });
    }

    if (!diffHighlightActive || !headContent) {return;}

    // Get current markdown from the editor
    const currentMarkdown = editor.storage.markdown.getMarkdown();
    const changedLines = computeChangedBlocks(headContent, currentMarkdown);

    if (changedLines.size === 0) {return;}

    // Map changed source lines to top-level ProseMirror nodes.
    // Walk the doc's top-level children and track which markdown lines they span.
    const doc = editor.state.doc;
    let sourceLine = 0;

    doc.forEach((node, offset) => {
      // Serialize this node to markdown to count its lines
      // Use a simpler approach: estimate lines from node text content
      let nodeLineCount = 1;
      if (node.isTextblock) {
        nodeLineCount = 1;
      } else if (node.type.name === 'table') {
        // Tables span multiple lines
        nodeLineCount = 0;
        node.descendants((child) => {
          if (child.type.name === 'tableRow') {nodeLineCount++;}
          return true;
        });
        nodeLineCount += 1; // header separator line
      } else if (node.type.name === 'bulletList' || node.type.name === 'orderedList' || node.type.name === 'taskList') {
        nodeLineCount = 0;
        node.descendants((child) => {
          if (child.type.name === 'listItem' || child.type.name === 'taskItem') {nodeLineCount++;}
          return true;
        });
      } else if (node.type.name === 'codeBlock') {
        const text = node.textContent;
        nodeLineCount = text.split('\n').length + 2; // +2 for fences
      } else if (node.type.name === 'blockquote') {
        nodeLineCount = 0;
        node.descendants((child) => {
          if (child.isTextblock) {nodeLineCount++;}
          return true;
        });
      }

      // Check if any of this node's source lines are in the changed set
      let isChanged = false;
      for (let l = sourceLine; l < sourceLine + nodeLineCount; l++) {
        if (changedLines.has(l)) { isChanged = true; break; }
      }

      if (isChanged) {
        // Find the DOM element for this node and add the highlight class
        const domNode = editor.view.nodeDOM(offset);
        if (domNode instanceof HTMLElement) {
          domNode.classList.add('mikedown-diff-changed');
        }
      }

      sourceLine += nodeLineCount + 1; // +1 for blank line between blocks
    });
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars -- not wired to any command/keybinding yet; diffHighlightActive is still read elsewhere, so this looks like an incomplete feature rather than dead code. Left in place for review rather than deleted.
  function toggleDiffHighlight(): void {
    if (!fileHasGitChanges) {return;}

    diffHighlightActive = !diffHighlightActive;

    if (diffHighlightActive && !headContent) {
      // Request HEAD content from the host
      host.getDiffBaseline?.().then((baseline) => {
        headContent = baseline.headContent;
        fileHasGitChanges = baseline.hasChanges;
        if (diffHighlightActive) {applyDiffDecorations();}
      }, () => { /* no baseline available */ });
    } else {
      applyDiffDecorations();
    }
  }

  // ── M4: CodeMirror source editor ───────────────────────────────────────────


  /** Source view read-only switch (handle.setReadOnly). */
  const cmReadOnly = new Compartment();

  /** Source view light/dark (highlight style + CodeMirror's dark flag). */
  const cmScheme = new Compartment();

  function buildCmScheme(): CmExtension[] {
    const dark = isDarkTheme();
    return [
      syntaxHighlighting(dark ? oneDarkHighlightStyle : defaultHighlightStyle),
      EditorView.theme({
        '.cm-activeLine': { backgroundColor: `var(--mikedown-line-highlight, ${dark ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.06)'})` },
      }, { dark }),
    ];
  }

  /** Re-pick the source view's highlight style after a theme change. */
  function refreshCmScheme(): void {
    cmView?.dispatch({ effects: cmScheme.reconfigure(buildCmScheme()) });
  }

  function buildCmTheme(): CmExtension {
    // Colors come from the theme tokens, so they follow theme changes live.
    return EditorView.theme({
      '&': { backgroundColor: 'var(--mikedown-surface, #1e1e1e)', color: 'var(--mikedown-text, #d4d4d4)', height: '100%' },
      '.cm-scroller': { fontFamily: 'var(--mikedown-font-mono, monospace)', overflow: 'auto', height: '100%' },
      '.cm-content': { padding: '8px 0' },
      '&.cm-focused .cm-selectionBackground, .cm-selectionBackground': { backgroundColor: 'var(--mikedown-selection, #264f78)' },
      '.cm-gutters': { backgroundColor: 'var(--mikedown-surface, #1e1e1e)', color: 'var(--mikedown-text-muted, #858585)', border: 'none' },
    });
  }

  function initCmView(): EditorView {
    const state = EditorState.create({
      doc: '',
      extensions: [
        history(),
        // Strip Mod-/ from the default keymap — VS Code binds Cmd+/ to
        // `mikedown.toggleSourceMode`, and CM's own toggleLineComment would
        // otherwise ALSO run on the same keystroke, wrapping the current line
        // with <!-- --> before the mode switch fires.
        keymap.of([
          // Without a host-owned shortcut the core handles Mod-/ itself.
          ...(hostOwnsShortcuts ? [] : [{ key: 'Mod-/', run: () => { toggleSourceMode(); return true; } }]),
          // Same for the AI rewrite (VS Code binds it as mikedown.ai.rewrite).
          ...(hostOwnsShortcuts || !aiHost ? [] : [{ key: 'Mod-Alt-k', run: () => startAiRewrite() }]),
          ...defaultKeymap.filter(b => b.key !== 'Mod-/' && b.mac !== 'Mod-/'),
          ...historyKeymap,
        ]),
        ...cmFindReplaceExtension,
        ...(aiHost ? cmAiRewriteHighlight : []),
        lineNumbers(),
        highlightActiveLine(),
        cmMarkdown({ base: markdownLanguage }),
        cmScheme.of(buildCmScheme()),
        buildCmTheme(),
        cmReadOnly.of(EditorState.readOnly.of(readOnly)),
        EditorView.lineWrapping,
        EditorView.contentAttributes.of(options.id || options.ariaLabel || options.ariaLabelledBy ? { ...surfaceAttrs, 'aria-multiline': 'true' } : {}),
        EditorView.updateListener.of((update) => {
          if (update.docChanged && !cmLoading) {
            const md = update.state.doc.toString();
            const isPristine = md === originalContent;
            const newDirty = !isPristine;
            if (newDirty !== isDirty) {isDirty = newDirty;}
            notifyChange(md, { pristine: isPristine });
            // Source mode is markdown text directly — fine to send as document
            // stats. ATX symbols/etc. get stripped by countWords on the host.
            postStats({ document: md });
          }
          if (update.selectionSet || update.docChanged) {
            const sel = update.state.selection.main;
            postStats({ selection: sel.empty ? null : update.state.sliceDoc(sel.from, sel.to) });
          }
          if (update.selectionSet || update.focusChanged) {aiBubble?.schedule();}
        }),
      ],
    });
    return new EditorView({ state, parent: sourceContainer });
  }

  function switchToSource(): void {
    if (sourceMode) {return;}
    aiRewrite?.close();
    aiBubble?.hide();
    // Chips apply in rich text only.
    cancelAiPropertySuggestions(true);

    // Serialize TipTap content (re-attach frontmatter for complete markdown).
    // When the document is pristine (no PM edits since last load/save), prefer
    // the verbatim originalContent so soft breaks and other syntax that doesn't
    // round-trip through PM are preserved in source view.
    const serialized = serializeDocument();
    const isPristine = lastSavedUndoDepth !== null
      && pmUndoDepth(editor.state) === lastSavedUndoDepth;
    const md = isPristine ? originalContent : serialized;

    // Record scroll percentage before hiding
    const editorEl = editorContainer;
    const scrollPct = editorEl.scrollTop / (editorEl.scrollHeight || 1);

    // Init CodeMirror view lazily
    if (!cmView) {
      cmView = initCmView();
    }

    // Only replace CodeMirror's content if it differs from the WYSIWYG-serialized
    // markdown. Skipping the dispatch on a no-op roundtrip (WYSIWYG → source →
    // WYSIWYG with no source-side edits) preserves CM's undo history.
    if (cmView.state.doc.toString() !== md) {
      cmLoading = true;
      // Exclude the full-content load from CM's undo history so Cmd+Z right
      // after entering source mode doesn't revert the doc to empty.
      cmView.dispatch({
        changes: { from: 0, to: cmView.state.doc.length, insert: md },
        annotations: CmTransaction.addToHistory.of(false),
      });
      cmLoading = false;
    }

    // Baseline for the divergence check on the way back out. Recorded from `md`
    // (not from cmView) so it matches exactly what CodeMirror now holds.
    sourceSync.enter(md);

    // Map PM cursor → CM offset. Counting plain-text chars underestimates
    // because markdown syntax (##, **, [link](url), `code`) isn't present
    // in PM's text. Instead, grab the last ~40 plain-text chars before the
    // cursor and locate that snippet in the markdown source; position CM
    // just past the match. This places the cursor at the correct column
    // even inside headings, bold, links, code, etc.
    try {
      const from = editor.state.selection.from;
      const plainBefore = editor.state.doc.textBetween(0, from, '\n');
      let cmPos = 0;
      if (plainBefore.length > 0) {
        const snippet = plainBefore.slice(-40);
        const docText = cmView.state.doc.toString();
        // Expected md offset ≈ plainBefore.length + (syntax chars before cursor).
        // We don't know the exact syntax count, but using plainBefore.length as
        // the expected offset biases matches toward the earliest viable region
        // and lets the closest-occurrence logic compensate.
        const expected = plainBefore.length;
        let bestEnd = -1;
        let bestDist = Infinity;
        let searchFrom = 0;
        while (searchFrom <= docText.length && snippet.length > 0) {
          const found = docText.indexOf(snippet, searchFrom);
          if (found === -1) {break;}
          const end = found + snippet.length;
          // Bias toward matches AT OR AFTER expected (markdown offset is
          // always >= plaintext offset because of syntax chars).
          const dist = end >= expected ? (end - expected) : (expected - end) * 2;
          if (dist < bestDist) { bestDist = dist; bestEnd = end; }
          searchFrom = found + 1;
        }
        if (bestEnd >= 0) {
          cmPos = bestEnd;
        } else {
          // Fallback: shorter snippet
          const shorter = plainBefore.slice(-10);
          const idx2 = shorter ? docText.lastIndexOf(shorter) : -1;
          cmPos = idx2 >= 0 ? idx2 + shorter.length : Math.min(plainBefore.length, docText.length);
        }
      }
      cmView.dispatch({
        selection: { anchor: cmPos },
        effects: EditorView.scrollIntoView(cmPos, { y: 'center' }),
      });
    } catch (_) { /* ignore cursor mapping errors */ }

    // Restore approximate scroll position (unless the editor was destroyed
    // in the meantime, as a host that swaps documents quickly may do).
    setTimeout(() => {
      if (!cmView) {return;}
      const scroller = cmView.scrollDOM;
      scroller.scrollTop = scrollPct * scroller.scrollHeight;
    }, 10);

    // Show source, hide WYSIWYG
    editorEl.style.display = 'none';
    sourceContainer.style.display = 'block';
    sourceMode = true;
    setSlashSourceMode(true);

    // Lock out doc-editing toolbar buttons + mark source toggle active.
    updateToolbarState(editor);

    cmView.focus();
    resyncFind();
    refreshPropertiesSidebar();
  }

  function switchToWysiwyg(): void {
    if (!sourceMode || !cmView) {return;}
    aiRewrite?.close();
    aiBubble?.hide();

    const md = cmView.state.doc.toString();

    // Record scroll percentage
    const scroller = cmView.scrollDOM;
    const scrollPct = scroller.scrollTop / (scroller.scrollHeight || 1);

    // Capture CM cursor before we potentially swap content so we can place
    // PM's selection at a comparable location after the switch.
    const cmCursorOffset = cmView.state.selection.main.from;

    // Extract frontmatter from source content
    const { frontmatter, body } = extractFrontmatter(md);

    // Only reload TipTap if the source markdown actually diverged from what
    // TipTap currently holds. Skipping setContent on a no-op roundtrip
    // (source → WYSIWYG with no source-side edits) preserves PM's undo history
    // so Cmd+Z can still reach edits made before the last mode toggle.
    //
    // When source still equals originalContent verbatim (user hasn't edited
    // source), skip the PM reload even if PM's serialized form differs — that
    // difference is just round-trip lossiness (e.g. soft-break newlines), not
    // a real edit, and reloading would needlessly discard PM's undo history
    // and invalidate the saved-state baseline.
    // The rich view's body as the source would spell it, final newline included.
    const pmBody = editor.storage.markdown.getMarkdown();
    const currentPmBody = trailingNewline && pmBody !== '' ? `${pmBody}\n` : pmBody;
    const sourceUnchanged = !sourceSync.hasSourceEdits(md);
    // A lazy load (`setMarkdown` while in source mode) left the rich view
    // stale: it must be rebuilt whatever the divergence check says.
    const pmStale = sourceSync.isStale();
    if (pmStale || (!sourceUnchanged && (body !== currentPmBody || frontmatter !== frontmatterContent))) {
      frontmatterContent = frontmatter;
      isLoading = true;
      const wasPristine = pmStale && md === originalContent;
      originalContent = md; // reset baseline to avoid false dirty
      trailingNewline = md.endsWith('\n');
      editor.commands.setContent(body);
      // The setContent above is on the undo stack by default; clear it so
      // Cmd+Z after switching from source can't undo past the full reload.
      resetPmHistory(editor);
      // History is back to depth 0 but the doc doesn't match the last saved
      // state — it matches unsaved source-mode edits. Invalidate the baseline
      // so isPristine can't falsely fire and overwrite disk via save(). A
      // lazily loaded document that was not edited in source IS the saved
      // text, so there depth 0 stays the pristine mark.
      lastSavedUndoDepth = wasPristine ? 0 : null;
      isLoading = false;
      refreshTocAfterLoad();
    } else if (!sourceUnchanged) {
      // Source was edited but parses to what the rich view already holds —
      // the baseline tracks the current markdown verbatim (trailing-newline etc).
      originalContent = md;
      trailingNewline = md.endsWith('\n');
    }
    // else: an unedited round trip. `md` is only the seed (the re-serialized
    // rich view when edits were pending), not the saved text, so the baseline
    // and the dirty state stay as they were.
    sourceSync.exit();

    // Show WYSIWYG, hide source
    const editorEl = editorContainer;
    sourceContainer.style.display = 'none';
    editorEl.style.display = '';
    sourceMode = false;
    setSlashSourceMode(false);

    // Map CM cursor (markdown char offset) → PM position using snippet search.
    // Grab the last ~40 chars of markdown before the cursor, strip out common
    // syntax (headings, emphasis, links, etc.) to approximate what PM's plain
    // text holds, and find that snippet in PM's full plain text. Walking PM's
    // doc to the matched plain-text offset lands the cursor accurately even
    // when markdown syntax chars shift column positions.
    try {
      const mdPrefix = md.substring(0, cmCursorOffset);
      // Strip the frontmatter block entirely — it isn't in the PM doc.
      const frontmatterStripped = mdPrefix.replace(/^---\n[\s\S]*?\n---\n?/, '');
      const syntaxStripped = stripTableSyntax(frontmatterStripped)
        .replace(/^#{1,6}\s+/gm, '')
        .replace(/^>\s?/gm, '')
        .replace(/^[ \t]*[*+-][ \t]+(?:\[[ xX]\][ \t]+)?/gm, '')
        .replace(/^[ \t]*\d+[.)][ \t]+(?:\[[ xX]\][ \t]+)?/gm, '')
        .replace(/\*\*([^*]+)\*\*/g, '$1')
        .replace(/__([^_]+)__/g, '$1')
        .replace(/(?<!\*)\*([^*\n]+)\*(?!\*)/g, '$1')
        .replace(/(?<!_)_([^_\n]+)_(?!_)/g, '$1')
        .replace(/`([^`\n]+)`/g, '$1')
        .replace(/!\[([^\]]*)\]\([^)]+\)/g, '$1')
        .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1');

      const snippet = syntaxStripped.slice(-40);
      const docSize = editor.state.doc.content.size;
      const pmPlain = editor.state.doc.textBetween(0, docSize, '\n');
      const expectedPt = syntaxStripped.length;

      let targetPt: number;
      if (snippet.length === 0) {
        targetPt = 0;
      } else {
        // Pick the occurrence whose end is closest to our expected plaintext
        // offset — `lastIndexOf` alone can match an earlier duplicate.
        let bestEnd = -1;
        let bestDist = Infinity;
        let searchFrom = 0;
        while (searchFrom <= pmPlain.length) {
          const found = pmPlain.indexOf(snippet, searchFrom);
          if (found === -1) {break;}
          const end = found + snippet.length;
          const dist = Math.abs(end - expectedPt);
          if (dist < bestDist) { bestDist = dist; bestEnd = end; }
          searchFrom = found + 1;
        }
        targetPt = bestEnd >= 0 ? bestEnd : Math.min(expectedPt, pmPlain.length);
      }

      // Binary-search for the smallest PM position whose textBetween prefix
      // length reaches targetPt. This matches `textBetween`'s own block-join
      // semantics exactly, so we don't drift at block boundaries.
      let lo = 0, hi = docSize;
      while (lo < hi) {
        const mid = (lo + hi) >> 1;
        const len = editor.state.doc.textBetween(0, mid, '\n').length;
        if (len < targetPt) {lo = mid + 1;}
        else {hi = mid;}
      }
      const safePos = Math.max(1, Math.min(lo, docSize));
      const sel = TextSelection.near(editor.state.doc.resolve(safePos));
      editor.view.dispatch(editor.state.tr.setSelection(sel).scrollIntoView());
    } catch (_) { /* ignore cursor mapping errors */ }

    // Restore approximate scroll position only if cursor mapping didn't
    // already scroll us — the scrollIntoView above is preferable when it works.
    setTimeout(() => {
      if (cmCursorOffset === 0) {
        editorEl.scrollTop = scrollPct * editorEl.scrollHeight;
      }
    }, 10);

    // Re-render frontmatter block in case it changed
    renderFrontmatterBlock();
    refreshPropertiesSidebar();

    // Re-enables toolbar buttons (sourceMode is now false) and clears the
    // sourceToggle active class.
    updateToolbarState(editor);
    editor.commands.focus();
    resyncFind();
  }

  toggleSourceMode = () => {
    if (!features.sourceMode) {return;}
    if (sourceMode) { switchToWysiwyg(); } else { switchToSource(); }
  };

  // ── Message Handling — Extension → Webview ─────────────────────────────────

  // ── Live tags ─────────────────────────────────────────────────────────────
  // The host's index only changes on save and never includes this document
  // (see `sendTagsToWebview`), so merge in the tags from the current text.
  // Otherwise typed tags wouldn't reach the sidebar or `#` autocomplete until
  // the file was saved — or ever, for a file outside the workspace.
  let workspaceTags: Array<{ tag: string; count: number }> = [];
  let liveTagsTimer: ReturnType<typeof setTimeout> | null = null;
  const refreshLiveTags = (): void => {
    const body = editor.storage.markdown.getMarkdown();
    const counts = new Map(workspaceTags.map((t) => [t.tag, t.count]));
    for (const t of extractTags(restoreFrontmatter(frontmatterContent, body))) {
      counts.set(t, (counts.get(t) ?? 0) + 1);
    }
    const merged = [...counts]
      .map(([tag, count]) => ({ tag, count }))
      .sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag));
    outlineSidebar?.applyTags(merged);
    receiveTagCandidates(merged);
  };
  const scheduleLiveTags = (): void => {
    if (liveTagsTimer) {clearTimeout(liveTagsTimer);}
    liveTagsTimer = setTimeout(refreshLiveTags, 300);
  };
  editor.on('update', scheduleLiveTags);

  /** Workspace tag index from the host (push or getTags reply). */
  function applyWorkspaceTags(tags: Array<{ tag: string; count: number }>): void {
    workspaceTags = tags || [];
    refreshLiveTags();
  }

  /** Cache host wikilink resolutions and stamp them onto matching nodes. */
  function applyWikilinkResults(results: Array<{ target: string; href: string | null; count?: number }>): void {
    for (const r of results || []) {
      wikilinkResolutionCache.set(String(r.target).toLowerCase(), {
        href: r.href ?? null,
        count: typeof r.count === 'number' ? r.count : (r.href ? 1 : 0),
      });
    }
    applyWikilinkResolution();
  }

  /**
   * The files around the document changed (created, renamed, deleted): drop
   * cached wikilink resolutions, re-resolve them, re-check relative links and
   * refresh the `[[` / link-dialog file suggestions.
   */
  function refreshLinks(): void {
    wikilinkResolutionCache.clear();
    scheduleWikilinkResolution();
    scheduleLinkCheck();
    if (host.getLinkSuggestions) {requestLinkSuggestions();}
  }

  /** Markdown link destination: `<…>` when it holds spaces or parentheses. */
  function markdownDestination(href: string): string {
    return /[\s()<>]/.test(href) ? `<${href.replace(/[<>]/g, encodeURIComponent)}>` : href;
  }

  /** Insert text at the cursor of whichever view is showing (CodeMirror in source mode). */
  function insertSourceText(text: string): void {
    if (!cmView) {return;}
    const sel = cmView.state.selection.main;
    cmView.dispatch({
      changes: { from: sel.from, to: sel.to, insert: text },
      selection: { anchor: sel.from + text.length },
      scrollIntoView: true,
    });
  }

  /** Host-driven link insertion at the cursor (a file dropped onto the editor). */
  function insertLink(href: string, text?: string): void {
    const label = text && text.length > 0 ? text : href;
    if (sourceMode && cmView) {
      insertSourceText(`[${label.replace(/([[\]])/g, '\\$1')}](${markdownDestination(href)})`);
      return;
    }
    const { state } = editor;
    const linkType = state.schema.marks.link;
    const node = state.schema.text(label, linkType ? [linkType.create({ href })] : []);
    // Transaction only (never touch editor.view.dom directly, commit f5415e0).
    editor.view.dispatch(state.tr.replaceSelectionWith(node, false).scrollIntoView());
  }

  /** Host-driven image insertion at the cursor (an image file dropped onto the editor). */
  function insertImage(image: { src: string; alt?: string }): void {
    if (sourceMode && cmView) {
      insertSourceText(`![${image.alt ?? ''}](${markdownDestination(image.src)})`);
      return;
    }
    insertImageAt(editor.view, editor.state.selection.from, image);
  }

  /** M6c — Broken link indicator: apply/remove CSS class to broken links. */
  function applyBrokenLinks(hrefs: string[]): void {
    // Remove old broken link classes
    editorContainer.querySelectorAll('.mikedown-broken-link').forEach(el => {
      el.classList.remove('mikedown-broken-link');
      (el as HTMLElement).title = '';
    });
    // Apply broken link class to matching anchors
    const brokenSet = new Set<string>(hrefs || []);
    editorContainer.querySelectorAll('.ProseMirror a[href]').forEach(el => {
      const href = el.getAttribute('href') || '';
      if (brokenSet.has(href)) {
        el.classList.add('mikedown-broken-link');
        (el as HTMLElement).title = `Broken link: ${href}`;
      }
    });
  }

  // Ctrl/Cmd + wheel (issue #8) and the toolbar zoom control resize editor
  // text. Persisted silently so every step doesn't pop a "settings saved" toast.
  const fontZoom = createFontZoom({
    getSize: currentFontSize,
    setSize: (px) => {
      setRootVar('--mikedown-font-size', `${px}px`);
      refreshZoomControl();
    },
    persist: (px) => host.saveSettings?.({ fontSize: px }, { silent: true }),
  });
  disposers.push(() => fontZoom.dispose());
  disposers.push(installWheelZoom(window, {
    isEnabled: () => currentCtrlWheelZoom,
    zoom: fontZoom,
  }));

  // ── Editor handle: push methods the host calls ─────────────────────────────

  /** Load a document. Pristine loads become the clean baseline. */
  function setMarkdown(markdown: string, opts?: { pristine?: boolean }): void {
    if (opts?.pristine === false) {
      // A host-driven edit: replace the content as if the user typed it, so
      // the change reaches onChange and the undo history.
      const { frontmatter, body } = extractFrontmatter(markdown);
      frontmatterContent = frontmatter;
      if (sourceMode && cmView) {
        cmView.dispatch({ changes: { from: 0, to: cmView.state.doc.length, insert: markdown } });
      } else {
        editor.commands.setContent(body, { emitUpdate: true });
      }
      renderFrontmatterBlock();
      refreshPropertiesSidebar();
      return;
    }
    // Another document: suggestions for the old one go.
    cancelAiPropertySuggestions(true);
    // In source mode only CodeMirror is loaded; the rich view is rebuilt from
    // the source text on the way back (`switchToWysiwyg`). A host that opens a
    // large file straight into source mode (edge case: files over 2 MB) then
    // never pays for the ProseMirror parse unless the user asks for rich text.
    if (sourceMode && cmView) {
      closeSlashMenu({ reload: true });
      originalContent = markdown ?? '';
      trailingNewline = originalContent.endsWith('\n');
      frontmatterContent = extractFrontmatter(originalContent).frontmatter;
      cmLoading = true;
      cmView.dispatch({
        changes: { from: 0, to: cmView.state.doc.length, insert: originalContent },
        annotations: CmTransaction.addToHistory.of(false),
        selection: { anchor: 0 },
      });
      cmLoading = false;
      sourceSync.markStale(originalContent);
      isDirty = false;
      lastSavedUndoDepth = null;
      wikilinkResolutionCache.clear();
      outlineSidebar?.applyPlainText(originalContent);
      postStats({ document: originalContent, selection: null });
      return;
    }

    // M2d — Load content from disk and establish the originalContent baseline.
    // isLoading prevents the onUpdate handler from echoing this back as an
    // 'edit' message, which would incorrectly mark the document as dirty.
    closeSlashMenu({ reload: true });
    isLoading = true;
    originalContent = markdown ?? '';
    trailingNewline = originalContent.endsWith('\n');

    // M15 — Extract frontmatter before passing body to TipTap.
    const { frontmatter, body } = extractFrontmatter(originalContent);
    frontmatterContent = frontmatter;

    editor.commands.setContent(body);

    // Clear the undo history so pressing Cmd+Z right after opening a file
    // doesn't revert the document to empty (setContent adds to history by
    // default).
    resetPmHistory(editor);
    lastSavedUndoDepth = 0;

    // M2d — After TipTap parses and re-sets the content, immediately serialize
    // back to check for round-trip fidelity. If the serialized form differs from
    // the original, log a warning but continue using originalContent as the
    // dirty-detection baseline so the document is not marked as modified on open.
    const reserialized = serializeDocument();
    if (reserialized !== originalContent) {
      console.warn(
        'MikeDown: serialization round-trip mismatch — using original as baseline'
      );
      // Still use originalContent as baseline, not the reserialized version.
    }

    isDirty = false;
    isLoading = false;
    // Headings may have changed in another editor since the TOC was written.
    refreshTocAfterLoad();

    // Mirror external updates into CodeMirror when source mode is active.
    if (sourceMode && cmView) {
      cmLoading = true;
      cmView.dispatch({
        changes: { from: 0, to: cmView.state.doc.length, insert: originalContent },
        annotations: CmTransaction.addToHistory.of(false),
      });
      cmLoading = false;
      // TipTap was just reloaded from the same content, so CodeMirror and the
      // PM doc agree again — rebaseline or the next toggle back would treat
      // this reload as a source-side edit.
      sourceSync.rebaseline(originalContent);
    }

    // M15 — Render frontmatter UI block (collapsed by default above editor).
    renderFrontmatterBlock();

    // 2.3.0 — Push parsed frontmatter entries to the sidebar Properties section.
    // 2.4.0 — Gate inline editing on whether the YAML round-trips cleanly;
    // anything we'd silently drop on save stays read-only.
    refreshPropertiesSidebar();

    // M6c — Trigger broken link check after content loads (debounced 500ms).
    scheduleLinkCheck();

    // Resolve `[[wikilinks]]` present in the freshly-loaded document. The
    // cached hrefs are relative to the previous document, which may live in
    // another folder (a host that reuses one editor for many files), so start
    // over.
    wikilinkResolutionCache.clear();
    scheduleWikilinkResolution();

    // Seed the sidebar footer + status bar with the initial document text.
    // No selection on first load.
    const initialText = editor.getText();
    outlineSidebar?.applyPlainText(initialText);
    postStats({ document: initialText, selection: null });
  }

  /** Current markdown, including frontmatter, from whichever view is showing. */
  function getMarkdown(): string {
    if (sourceMode && cmView) {return cmView.state.doc.toString();}
    return serializeDocument();
  }

  /** The rich view's document as markdown: frontmatter, body and final newline. */
  function serializeDocument(): string {
    const md = restoreFrontmatter(frontmatterContent, editor.storage.markdown.getMarkdown());
    return trailingNewline && md !== '' && !md.endsWith('\n') ? `${md}\n` : md;
  }

  /** Rendered HTML of the WYSIWYG surface (export, print, view in browser). */
  function getHtml(): string {
    return editor.view.dom.innerHTML;
  }

  /**
   * Host reports the document has been saved. Rebaseline pristine detection
   * so later undos compare against the newly saved content instead of the
   * pre-load content — otherwise undoing back to the old load state would
   * silently revert the saved file (we'd send the stale `originalContent`
   * with pristine:true and the host would save() over the real saved state).
   */
  function markSaved(content?: string): void {
    originalContent = content ?? getMarkdown();
    // Seal the open undo group: otherwise typing within newGroupDelay of the
    // save joins the saved group, the depth still equals the baseline, and
    // those keystrokes are treated as pristine (and dropped by the next save).
    // A metadata-only transaction, so the DOM is never touched directly.
    editor.view.dispatch(closeHistory(editor.view.state.tr));
    lastSavedUndoDepth = pmUndoDepth(editor.state);
  }

  /** Which view is showing, where its caret is and how far it is scrolled. */
  function getViewState(): MikeDownViewState {
    if (sourceMode && cmView) {
      return { sourceMode: true, cursor: cmView.state.selection.main.head, scrollTop: cmView.scrollDOM.scrollTop };
    }
    return { sourceMode: false, cursor: editor.state.selection.head, scrollTop: editorContainer.scrollTop };
  }

  /**
   * Restore a view state saved by `getViewState`: switch views first when
   * asked, then place the caret (clamped) and the scroll offset. The scroll
   * is applied now and once more on the next frame, since a view that was
   * just filled or shown may not have its final height yet.
   */
  function setViewState(state: Partial<MikeDownViewState>): void {
    if (state.sourceMode !== undefined && state.sourceMode !== sourceMode && features.sourceMode) {
      toggleSourceMode();
    }
    const scroller = sourceMode && cmView ? cmView.scrollDOM : editorContainer;
    if (state.cursor !== undefined) {
      if (sourceMode && cmView) {
        const pos = Math.max(0, Math.min(state.cursor, cmView.state.doc.length));
        cmView.dispatch({ selection: { anchor: pos }, scrollIntoView: false });
      } else {
        const max = editor.state.doc.content.size;
        const pos = Math.max(0, Math.min(state.cursor, max));
        try {
          editor.view.dispatch(editor.state.tr.setSelection(Selection.near(editor.state.doc.resolve(pos))));
        } catch { /* the position does not resolve in this document; keep the current caret */ }
      }
    }
    if (state.scrollTop !== undefined) {
      const top = Math.max(0, state.scrollTop);
      scroller.scrollTop = top;
      if (typeof requestAnimationFrame === 'function') {
        requestAnimationFrame(() => { if (!destroyed) {scroller.scrollTop = top;} });
      }
    }
  }

  let readOnly = false;
  function setReadOnly(next: boolean): void {
    if (next === readOnly) {return;}
    readOnly = next;
    // emitUpdate=false: toggling editability is not a document change.
    editor.setEditable(!next, false);
    if (cmView) {cmView.dispatch({ effects: cmReadOnly.reconfigure(EditorState.readOnly.of(next)) });}
    root.classList.toggle('mikedown-readonly', next);
    if (next) {cancelAiPropertySuggestions(true);}
    syncAiPropertiesAvailability();
  }

  /** Run a toolbar / keybinding command (M3). */
  function runCommand(name: string, args?: { tab?: string; page?: boolean }): void {
    switch (name) {
      // Same desync hazard as the list toggles below: no-op in source mode.
      case 'toggleBold': if (!sourceMode) {editor.chain().focus().toggleBold().run();} break;
      case 'toggleItalic': if (!sourceMode) {editor.chain().focus().toggleItalic().run();} break;
      case 'toggleStrike': if (!sourceMode) {editor.chain().focus().toggleStrike().run();} break;
      case 'toggleHighlight': if (!sourceMode) {editor.chain().focus().toggleHighlight().run();} break;
      case 'toggleCode': if (!sourceMode) {editor.chain().focus().toggleCode().run();} break;
      case 'pasteWithoutFormatting': editor.commands.focus(); requestPlainPaste(editor.view); break;
      case 'openEmojiPicker':
        if (isEmojiPickerOpen()) { hideEmojiPicker(); } else { showEmojiPicker(editor, {}); }
        break;
      case 'undo': doUndo(editor); break;
      case 'redo': doRedo(editor); break;
      case 'toggleSource':
        toggleSourceMode();
        break;
      // M2 — list-toggle keybindings mirror the toolbar's bulletList/
      // orderedList/taskList buttons, which are disabled in source mode
      // (SOURCE_MODE_DISABLED_ACTIONS) because CodeMirror owns the visible
      // doc there; firing a TipTap command would silently edit the hidden
      // PM doc and desync the two views. No-op rather than throw.
      case 'toggleBulletList':
        if (!sourceMode) {editor.chain().focus().toggleBulletList().run();}
        break;
      case 'toggleOrderedList':
        if (!sourceMode) {editor.chain().focus().toggleOrderedList().run();}
        break;
      case 'toggleTaskList':
        if (!sourceMode) {editor.chain().focus().toggleTaskList().run();}
        break;
      // Sidebar toggle isn't a doc edit, so it stays available in source
      // mode too. Routes through the same setVisible the header
      // discovery/close buttons use — no duplicated open/close state.
      case 'toggleSidebar':
        outlineSidebar?.toggleSidebarVisible();
        break;
      // M5 — the slash-menu footer row's "Turn off slash commands" toast
      // posts this from the host after a saveSettings round-trip so the
      // user can jump straight to the Behavior tab to re-enable it.
      case 'openSettings':
        showSettingsModal(args?.tab);
        break;
      // The host's "Open AI settings" (VS Code: mikedown.openAiSettings, the AI
      // status bar item). `page: true` opens the AI Engines page directly
      // (tier 2 hosts); otherwise, or for a tier 1 host, the AI tab.
      case 'openAiSettings':
        if (!aiHost) {break;}
        if (args?.page && aiHostTier(aiHost) === 2) {showAiEnginesPage();} else {showSettingsModal('ai');}
        break;
      // Rewrite the selection with AI (VS Code: mikedown.ai.rewrite). Opens the choices.
      case 'aiRewrite':
        startAiRewrite();
        break;
      // Explain the selection (read-only popover; Insert below adds it as a quote).
      case 'aiExplain':
        startAiRewrite('explain');
        break;
      // Translate the selection: opens the language picker (with "Whole document").
      case 'aiTranslate':
        startAiRewrite('translate');
        break;
      // Summarize the document: the popover in insert mode at the cursor.
      case 'aiSummarize':
        startAiSummary();
        break;
      // Suggest titles: three candidates; a pick sets title:, the H1 or a new H1.
      case 'aiSuggestTitle':
        startAiTitles();
        break;
      // Suggest properties: the sidebar's Suggest, Properties shown and expanded.
      case 'aiSuggestProperties':
        startAiPropertySuggestions();
        break;
      // M11 — Copy as rich text: write HTML + plain text to clipboard.
      case 'copyAsRichText':
        copyAsRichText();
        break;
      // Menu-bar commands (hosts with native menus). Same actions as the
      // toolbar buttons and the TipTap keymap; rich-text edits are no-ops in
      // source mode for the desync reason above.
      case 'heading1': case 'heading2': case 'heading3':
      case 'heading4': case 'heading5': case 'heading6': {
        const level = Number(name.slice(7)) as 1 | 2 | 3 | 4 | 5 | 6;
        if (!sourceMode) {editor.chain().focus().toggleHeading({ level }).run();}
        break;
      }
      case 'paragraph': if (!sourceMode) {editor.chain().focus().setParagraph().run();} break;
      case 'openFind': if (features.findReplace) {openFindBar(false);} break;
      case 'openFindReplace': if (features.findReplace) {openFindBar(true);} break;
      case 'insertTable':
        if (!sourceMode) {editor.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run();}
        break;
      case 'insertLink': if (!sourceMode) {showLinkDialog(editor);} break;
      case 'insertImage': if (!sourceMode) {showImageInsertDialog(editor);} break;
      case 'zoomIn': fontZoom.stepBy(1); break;
      case 'zoomOut': fontZoom.stepBy(-1); break;
      case 'zoomReset': fontZoom.reset(); break;
    }
  }

  function copyAsRichText(): void {
    const editorEl2 = editor.view.dom;
    if (!navigator.clipboard) {return;}
    (async () => {
      try {
        const htmlBlob = new Blob([editorEl2.innerHTML], { type: 'text/html' });
        const textBlob = new Blob([editorEl2.innerText], { type: 'text/plain' });
        await navigator.clipboard.write([
          new ClipboardItem({ 'text/html': htmlBlob, 'text/plain': textBlob })
        ]);
      } catch {
        // Fallback: copy plain text only
        await navigator.clipboard.writeText(editorEl2.innerText).catch(() => {});
      }
    })().catch(() => {});
  }

  /** Apply core settings (no persistence). Keys absent from the patch are left alone. */
  function updateSettings(patch: Partial<MikeDownSettings>): void {
    if (patch.fontFamily !== undefined) {setRootVar('--mikedown-font-family', patch.fontFamily || '');}
    if (patch.headingFontFamily !== undefined) {setRootVar('--mikedown-heading-font-family', patch.headingFontFamily || '');}
    if (patch.fontSize !== undefined) {
      setRootVar('--mikedown-font-size', `${patch.fontSize || DEFAULT_FONT_SIZE}px`);
      refreshZoomControl();
    }
    if (patch.contentWidth !== undefined) {setRootVar('--mikedown-content-width', patch.contentWidth);}
    if (patch.linkClickBehavior) {
      currentLinkClickBehavior = patch.linkClickBehavior;
    }
    if (patch.headingRenameUpdateLinks) {
      headingRenamePref = patch.headingRenameUpdateLinks;
    }
    if (typeof patch.headingNumbering === 'string') {
      applyHeadingNumbering(parseHeadingNumbering(patch.headingNumbering));
    }
    if (typeof patch.tocStyle === 'string') {
      applyTocStyle(parseTocStyle(patch.tocStyle));
    }
    if (
      typeof patch.slashCommandsEnabled === 'boolean'
      || patch.slashCommandsDateFormat === 'iso' || patch.slashCommandsDateFormat === 'long'
      || typeof patch.slashCommandsTimeZone === 'string'
    ) {
      if (typeof patch.slashCommandsEnabled === 'boolean') {
        currentSlashCommandsEnabled = patch.slashCommandsEnabled;
      }
      if (patch.slashCommandsDateFormat === 'iso' || patch.slashCommandsDateFormat === 'long') {
        currentSlashCommandsDateFormat = patch.slashCommandsDateFormat;
      }
      if (typeof patch.slashCommandsTimeZone === 'string' && patch.slashCommandsTimeZone.trim()) {
        currentSlashCommandsTimeZone = patch.slashCommandsTimeZone.trim();
      }
      // The trigger/popup plugin (M2/M3) is expected to close its own
      // popup (no document transaction) if `enabled` just flipped false
      // while it was open — this call is its single live-config entry point.
      setSlashCommandsConfig({
        enabled: features.slashCommands && currentSlashCommandsEnabled,
        dateFormat: currentSlashCommandsDateFormat,
        timeZone: currentSlashCommandsTimeZone,
      });
      // Force the placeholder decoration to recompute with the new "Type /
      // for commands…" / "Start writing…" text. ProseMirror re-evaluates a
      // plugin's `decorations` prop on every dispatched transaction, so a
      // no-op transaction is enough — never touch editor.view.dom directly.
      editor.view.dispatch(editor.state.tr.setMeta('slashPlaceholder', true));
    }
    if (patch.editorTheme) {
      applyEditorTheme(patch.editorTheme);
      refreshMermaidTheme(editor);
    }
    if (typeof patch.renderMermaidDiagrams === 'boolean') {
      currentRenderMermaidDiagrams = patch.renderMermaidDiagrams;
      setMermaidEnabled(editor, features.mermaid && patch.renderMermaidDiagrams);
    }
    if (typeof patch.renderMath === 'boolean') {
      currentRenderMath = patch.renderMath;
      setMathRenderingEnabled(features.math && patch.renderMath);
    }
    if (typeof patch.tagsEnabled === 'boolean') {
      currentTagsEnabled = patch.tagsEnabled;
      setTagsEnabled(editor, patch.tagsEnabled);
      outlineSidebar?.setTagsSectionEnabled(tagsAvailable && patch.tagsEnabled);
    }
    if (typeof patch.ctrlWheelZoom === 'boolean') {
      currentCtrlWheelZoom = patch.ctrlWheelZoom;
    }
    if (typeof patch.wikilinkCreateOnClick === 'boolean') {
      currentWikilinkCreateOnClick = patch.wikilinkCreateOnClick;
    }
    if (patch.markdownNormalization === 'preserve' || patch.markdownNormalization === 'normalize') {
      currentMarkdownNormalization = patch.markdownNormalization;
    }
    if (patch.normalizationStyle && typeof patch.normalizationStyle === 'object') {
      currentNormalizationStyle = { ...currentNormalizationStyle, ...patch.normalizationStyle };
    }
    if (Array.isArray(patch.imagePathMappings)) {
      imagePathMappings = patch.imagePathMappings as ImagePathPrefix[];
    }
    if (typeof patch.docDir === 'string') {
      docDirFsPath = patch.docDir;
    }
    if (patch.ai !== undefined && aiHost) {applyAiSettings(patch.ai);}
    if (patch.toolbarLayout !== undefined) {applyToolbarLayout(patch.toolbarLayout);}
    const spellKeys: Array<keyof MikeDownSettings> = [
      'spellCheckEnabled', 'spellCheckLanguage', 'spellCheckIgnoreCodeBlocks', 'spellCheckUserWords', 'spellCheckExternalWords',
    ];
    if (spellKeys.some(k => patch[k] !== undefined)) {
      if (typeof patch.spellCheckEnabled === 'boolean') {currentSpellCheckEnabled = patch.spellCheckEnabled;}
      if (patch.spellCheckLanguage === 'en' || patch.spellCheckLanguage === 'en-GB') {currentSpellCheckLanguage = patch.spellCheckLanguage;}
      if (typeof patch.spellCheckIgnoreCodeBlocks === 'boolean') {currentSpellCheckIgnoreCodeBlocks = patch.spellCheckIgnoreCodeBlocks;}
      if (Array.isArray(patch.spellCheckUserWords)) {
        currentSpellCheckUserWords = patch.spellCheckUserWords.filter((w: unknown) => typeof w === 'string');
      }
      if (Array.isArray(patch.spellCheckExternalWords)) {
        currentSpellCheckExternalWords = patch.spellCheckExternalWords.filter((w: unknown) => typeof w === 'string');
      }
      // Toggles live: off clears the decorations and never loads a
      // dictionary; a language change rebuilds and re-scans.
      configureSpellCheck(editor, {
        enabled: spellcheckAvailable && currentSpellCheckEnabled,
        language: currentSpellCheckLanguage,
        ignoreCodeBlocks: currentSpellCheckIgnoreCodeBlocks,
        userWords: [...currentSpellCheckUserWords, ...currentSpellCheckExternalWords],
      });
    }
  }

  /**
   * Show a match found in the markdown source (folder search): select it and
   * scroll it to the middle. `line` and `column` are 1-based, `column` in
   * UTF-16 units. Source mode maps exactly; rich text finds the same text
   * again, and falls back to a proportional scroll when it is not rendered
   * (frontmatter, link targets).
   */
  function revealText(line: number, column: number, length = 0): void {
    if (sourceMode && cmView) {
      const doc = cmView.state.doc;
      const ln = doc.line(Math.max(1, Math.min(doc.lines, Math.floor(line) || 1)));
      const from = Math.min(ln.to, ln.from + Math.max(0, column - 1));
      const to = Math.min(ln.to, from + Math.max(0, length));
      cmView.dispatch({ selection: { anchor: from, head: to }, effects: EditorView.scrollIntoView(from, { y: 'center' }) });
      return;
    }
    const target = locateInSource(getMarkdown(), line, column, length);
    const hit = findInDoc(editor.state.doc, target.text, target.occurrence);
    if (hit) {
      try {
        editor.view.dispatch(editor.state.tr.setSelection(TextSelection.create(editor.state.doc, hit.from, hit.to)));
      } catch { /* not a textblock position; scroll only */ }
      try {
        const coords = editor.view.coordsAtPos(hit.from);
        const box = editorContainer.getBoundingClientRect();
        editorContainer.scrollTop += coords.top - box.top - editorContainer.clientHeight / 2;
      } catch { /* no layout (jsdom) */ }
      return;
    }
    editorContainer.scrollTop = Math.max(0, (editorContainer.scrollHeight - editorContainer.clientHeight) * target.fraction);
  }

  /** M6a — Scroll to an anchor (heading slug or a raw HTML `<a id|name>`). */
  function scrollToAnchor(anchor: string): void {
    // Compute anchor IDs dynamically from heading text instead of relying
    // on data-anchor-id attributes (ProseMirror's DOM patching strips them).
    const headings = editorContainer.querySelectorAll<HTMLElement>('h1,h2,h3,h4,h5,h6');
    const seenIds = new Map<string, number>();
    let targetEl: HTMLElement | null = null;
    for (const h of headings) {
      const base = githubAnchorId(h.textContent || '');
      const count = seenIds.get(base) ?? 0;
      const id = count === 0 ? base : `${base}-${count}`;
      seenIds.set(base, count + 1);
      if (id === anchor) { targetEl = h; break; }
    }
    // Fallback: custom HTML anchors (`<a id="foo"></a>` / `<a name="foo"></a>`)
    // rendered by the HtmlAnchor node.
    if (!targetEl) {
      const cssAnchor = (window as any).CSS?.escape ? (window as any).CSS.escape(anchor) : anchor.replace(/"/g, '\\"');
      targetEl = editorContainer.querySelector<HTMLElement>(
        `.ProseMirror a[id="${cssAnchor}"], .ProseMirror a[name="${cssAnchor}"]`
      );
    }
    if (targetEl) {
      smoothScrollHeadingIntoView(targetEl);
    }
  }

  /**
   * Backlink reveal — scroll the rendered body to the `<a>` that links back
   * to the doc the user came from. The href matches what's written in source
   * (TipTap preserves it), so we match on the raw `href` attribute. Retries a
   * few times because the doc may still be rendering right after open.
   */
  function revealLink(want: string, occurrence?: number): void {
    if (!want) {return;}
    const norm = (h: string) => h.replace(/^\.\//, '');
    const want0 = occurrence ?? 0;
    let tries = 0;
    const tryFind = (): void => {
      const anchors = editorContainer.querySelectorAll<HTMLElement>('.ProseMirror a[href]');
      const matches: HTMLElement[] = [];
      for (const a of anchors) {
        const raw = a.getAttribute('href') || '';
        if (raw === want || norm(raw) === norm(want)) {matches.push(a);}
      }
      // Wait until the wanted occurrence has rendered; only after retries
      // run out do we settle for whatever's available (fall back to first).
      const exhausted = tries++ >= 6;
      if (matches.length <= want0 && !exhausted) {
        setTimeout(tryFind, 150);
        return;
      }
      const hit: HTMLElement | null = matches[want0] ?? matches[0] ?? null;
      if (hit) {
        smoothScrollHeadingIntoView(hit);
        hit.classList.add('mikedown-backlink-flash');
        setTimeout(() => hit?.classList.remove('mikedown-backlink-flash'), 1600);
      }
    };
    tryFind();
  }

  /**
   * v1.6.0 — A watched image file went missing or came back. Missing flags
   * every <img> rendered from `src` as broken; found only clears the class
   * (no src mutation: writing to an <img> attribute inside ProseMirror's
   * managed DOM poisons its MutationObserver). The browser keeps its
   * failed-fetch state, so the image won't re-appear until a reload — but
   * the warning chrome stops showing once the file is back.
   */
  function setImageStatus(targetUri: string, status: 'found' | 'missing', detail?: string): void {
    if (!targetUri) {return;}
    if (status === 'missing') {
      editorContainer.querySelectorAll<HTMLImageElement>('.ProseMirror img').forEach(img => {
        const src = img.getAttribute('src') ?? '';
        if (src === targetUri || src.startsWith(targetUri + '?')) {
          img.classList.add('broken-image');
          img.title = `Image not found on disk: ${detail ?? src}`;
        }
      });
    } else {
      editorContainer.querySelectorAll<HTMLImageElement>('.ProseMirror img.broken-image').forEach(img => {
        const src = img.getAttribute('src') ?? '';
        if (src === targetUri || src.startsWith(targetUri + '?')) {
          img.classList.remove('broken-image');
          img.title = '';
        }
      });
    }
  }

  /** Sidebar — host push of width/pref/position/per-doc state. */
  function setSidebarState(state: SidebarStateUpdate): void {
    outlineSidebar?.applyOutlineState({
      pref: state.pref,
      width: state.width,
      position: state.position,
      sectionPrefs: state.sectionPrefs,
    });
  }

  /** Show or hide the sidebar footer link (VS Code: the support appeal). */
  function setSidebarFooterLink(link: SidebarFooterLink | null): void {
    if (!features.supportCard || !shell.sidebar) {return;}
    sidebarFooterLink = link;
    outlineSidebar?.applySupportLink({
      visible: !!link,
      copy: link
        ? { sidebarLink: link.label, dismissLabel: link.dismissLabel, dismissConfirmation: link.dismissConfirmation }
        : null,
    });
  }

  function setTheme(theme: 'light' | 'dark' | 'auto'): void {
    applyEditorTheme(theme);
    refreshMermaidTheme(editor);
  }

  let destroyed = false;
  function destroy(): void {
    if (destroyed) {return;}
    destroyed = true;
    cancelAiPropertySuggestions();
    // Close any shared popups this editor may have opened.
    closeSlashMenu();
    hideContextMenu();
    hideToolbarDropdown();
    hideEmojiPicker();
    hideTableGridPicker();
    hideTableToolbar();
    destroyLinkAutocomplete();
    clearTimeout(linkCheckTimer);
    clearTimeout(wikilinkResolveTimer ?? undefined);
    clearTimeout(liveTagsTimer ?? undefined);
    clearTimeout(headingIdleTimer ?? undefined);
    clearTimeout(renumberTimer ?? undefined);
    clearTimeout(tocSyncTimer ?? undefined);
    clearTimeout(mermaidThemeTimer ?? undefined);
    window.clearTimeout(toastTimer);
    while (disposers.length) {
      try { disposers.pop()?.(); } catch (err) { console.error('MikeDown: dispose failed —', err); }
    }
    setSlashDisableHandler(null);
    closeAiEnginesPage();
    closeSettingsModal();
    cmView?.destroy();
    cmView = null;
    editor.destroy();
    eventListeners.clear();
    root.remove();
  }

  const handle: MikeDownEditorHandle = {
    setMarkdown,
    getMarkdown,
    getHtml,
    markSaved,
    setReadOnly,
    setTheme,
    command: (name, args) => runCommand(name, args),
    updateSettings,
    scrollToAnchor,
    revealLink,
    revealText,
    setImageStatus,
    insertLink,
    insertImage,
    refreshLinks,
    setTags: applyWorkspaceTags,
    setLinkSuggestions: applyLinkSuggestions,
    setBacklinks: (items: BacklinkItem[]) => outlineSidebar?.applyBacklinks(items || []),
    setDocMeta: (meta: { mtimeMs?: number | null }) => outlineSidebar?.applyDocMeta({ mtimeMs: meta.mtimeMs }),
    setSidebarState,
    setSidebarFooterLink,
    setDiffAvailable: (available: boolean) => { fileHasGitChanges = available; },
    setAiServed: (served, o) => {
      aiServed = served ? { served, viaFallback: !!o?.viaFallback } : null;
      renderAiIndicator();
    },
    setAiEngineStatuses: (list) => setAiStatuses(Array.isArray(list) ? list : []),
    isModalOpen: () => !!settingsOverlay?.isConnected || !!aiPage?.overlay.isConnected,
    getViewState,
    setViewState,
    focus: () => { if (sourceMode && cmView) {cmView.focus();} else {editor.commands.focus();} },
    on: (event, fn) => {
      let set = eventListeners.get(event);
      if (!set) {
        set = new Set();
        eventListeners.set(event, set);
      }
      set.add(fn);
      return () => { set?.delete(fn); };
    },
    destroy,
    get tiptap() { return editor; },
  };

  editor.on('focus', () => emit('focus'));
  editor.on('blur', () => emit('blur'));

  // ── Initial state from options ─────────────────────────────────────────────
  // Feature-off renderers stay off whatever the settings say.
  if (!features.mermaid) {setMermaidEnabled(editor, false);}
  if (!features.math) {setMathRenderingEnabled(false);}
  if (!features.slashCommands) {setSlashCommandsConfig({ enabled: false });}
  outlineSidebar?.setTagsSectionEnabled(tagsAvailable && currentTagsEnabled);
  if (options.settings) {updateSettings(options.settings);}
  if (aiHost) {
    renderAiIndicator();
    scheduleAiStatusRefresh();
  }
  if (options.theme) {setTheme(options.theme);}
  if (options.readOnly) {setReadOnly(true);}
  if (options.initialMarkdown !== undefined) {setMarkdown(options.initialMarkdown, { pristine: true });}

  // `ready` fires after the caller has had a chance to subscribe.
  queueMicrotask(() => { if (!destroyed) {emit('ready');} });

  return handle;
}
