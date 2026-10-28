/**
 * Public types for the MikeDown editor core: settings, feature flags, the
 * factory options and the editor handle. The host adapter lives in host.ts.
 */

import type { Editor } from '@tiptap/core';
import type { AiEngineStatus, AiServedBy, AiSettings } from './ai/types';
import type { ToolbarLayout } from './toolbar-layout';
import type { BacklinkItem, ImageInsertResult, LinkSuggestion, MikeDownHost, TagCount } from './host';

// ── Settings ──────────────────────────────────────────────────────────────────

export interface NormalizationStyle {
  boldMarker: '**' | '__';
  italicMarker: '*' | '_';
  listMarker: '-' | '*' | '+';
  headingStyle: 'atx' | 'setext';
}

/** A webview-resolvable URL prefix and the on-disk folder it maps to. */
export interface ImagePathMapping {
  prefix: string;
  fsPath: string;
}

/**
 * Settings the editor core owns (decisions section 6). Field names match the
 * keys the editor sends to `host.saveSettings`.
 */
export interface MikeDownSettings {
  // Appearance
  fontFamily: string;
  headingFontFamily: string;
  /** Pixels. */
  fontSize: number;
  /** CSS max width of the content column, e.g. "100%" or "780px". */
  contentWidth: string;
  ctrlWheelZoom: boolean;
  editorTheme: 'auto' | 'light' | 'dark';
  headingNumbering: 'off' | 'fromH1' | 'fromH2';
  // Behavior
  linkClickBehavior: 'navigateCurrentTab' | 'openNewTab' | 'showContextMenu';
  slashCommandsEnabled: boolean;
  slashCommandsDateFormat: 'iso' | 'long';
  /** "local", "UTC" or an IANA zone. */
  slashCommandsTimeZone: string;
  // Markdown
  renderMermaidDiagrams: boolean;
  renderMath: boolean;
  tagsEnabled: boolean;
  /** What Insert > Table of Contents creates (existing TOCs keep their style). */
  tocStyle: 'list' | 'placeholder';
  markdownNormalization: 'preserve' | 'normalize';
  normalizationStyle: NormalizationStyle;
  // Spelling
  spellCheckEnabled: boolean;
  spellCheckLanguage: 'en' | 'en-GB';
  spellCheckIgnoreCodeBlocks: boolean;
  spellCheckUserWords: string[];
  // AI
  /**
   * `mikedown.ai.*`, parsed by `parseAiSettings` from `@mikedown/core/ai`.
   * Absent means the defaults (off). Saved as `ai.*` patch keys built by
   * `serializeAiSettings`; API keys are never part of it (`host.ai.setSecret`).
   */
  ai?: AiSettings;

  // ── Host policy ──────────────────────────────────────────────────────────
  // Inputs the core reads but never shows in its own Settings sections. A
  // host sets them through `updateSettings`; persistence is the host's job.

  /** Words accepted by the spell checker but owned elsewhere (read-only chips). */
  spellCheckExternalWords?: string[];
  /** Cmd/Ctrl+click on an unresolved wikilink calls `host.createWikilink`. */
  wikilinkCreateOnClick?: boolean;
  /** `never` turns off in-document link fixing and `onHeadingRenamed`. */
  headingRenameUpdateLinks?: 'ask' | 'always' | 'never';
  /** Image src rewriting for display in the image popover. */
  imagePathMappings?: ImagePathMapping[];
  /** On-disk folder of the current document (pairs with imagePathMappings). */
  docDir?: string;

  // ── Toolbar ──────────────────────────────────────────────────────────────
  /**
   * The customized toolbar layout: one self-contained, versioned blob
   * (`{ version, items, seen }`, see `ToolbarLayout`). `null`, absent or an
   * invalid value means the default layout. Saved through
   * `host.saveSettings({ toolbarLayout })`; `null` clears a stored layout
   * (Reset to Default). Hand-edited values are normalized on read.
   */
  toolbarLayout?: ToolbarLayout | null;
}

/**
 * A settings patch. Core-owned keys are typed; a host's own sections in the
 * Settings modal (see `extraSettingsSections`) add their own keys, which pass
 * through to `host.saveSettings` untouched.
 */
export type MikeDownSettingsPatch = Partial<MikeDownSettings> & Record<string, unknown>;

// ── Features ──────────────────────────────────────────────────────────────────

/**
 * Feature switches. A feature that needs a host method (wikilinks, tags,
 * images, export) is also off when that method is absent.
 */
export interface MikeDownFeatures {
  /** Formatting toolbar. Default on. */
  toolbar: boolean;
  /** Outline / Properties / Backlinks / Tags sidebar. Default off. */
  sidebar: boolean;
  /** CodeMirror source view (Cmd+/). Default on. */
  sourceMode: boolean;
  /** `/` command menu. Default on. */
  slashCommands: boolean;
  /** Spell checking. Default on, but inert unless `spellcheckDictionaryUrl` is set. */
  spellcheck: boolean;
  /** KaTeX math rendering. Default on. */
  math: boolean;
  /** Mermaid diagram rendering. Default on. */
  mermaid: boolean;
  /** Support entry point in the sidebar footer (VS Code only). Default off. */
  supportCard: boolean;
  /** Find and replace bar (Cmd+F / Cmd+H). Default on. */
  findReplace: boolean;
  /** Collapsible frontmatter block above the document. Default on. */
  frontmatter: boolean;
  /** AI features and the AI settings tab. Default on, but inert unless `host.ai` is set. */
  ai: boolean;
  /**
   * "Customize Toolbar" entry points and the Toolbar section in Settings.
   * Default on. Off keeps the toolbar fixed for the user; a `toolbarLayout`
   * setting still applies.
   */
  customizeToolbar: boolean;
}

export const DEFAULT_FEATURES: MikeDownFeatures = {
  toolbar: true,
  sidebar: false,
  sourceMode: true,
  slashCommands: true,
  spellcheck: true,
  math: true,
  mermaid: true,
  supportCard: false,
  findReplace: true,
  frontmatter: true,
  ai: true,
  customizeToolbar: true,
};

// ── Settings modal extension ──────────────────────────────────────────────────

/** Row builders the Settings modal hands to host sections, so they match. */
export interface MikeDownSettingsSectionContext {
  makeRow(label: string, description: string, layout?: 'inline' | 'stacked'): HTMLElement;
  makeGroup(...rows: HTMLElement[]): HTMLDivElement;
  makeFieldLabel(text: string, hint: string, layout?: 'inline' | 'stacked'): HTMLLabelElement;
  makeCheckboxRow(label: string, description: string, current: boolean): { row: HTMLElement; input: HTMLInputElement };
  makeSelectRow<T extends string>(
    label: string,
    description: string,
    current: T,
    options: Array<{ value: T; label: string }>,
  ): { row: HTMLElement; select: HTMLSelectElement };
  /** Close the modal without saving. */
  close(): void;
}

export interface MikeDownSettingsSectionBuild {
  /** Rows appended to the tab, in order. */
  rows: HTMLElement[];
  /** Values merged into the patch sent to `host.saveSettings` on Save. */
  collect?(): Record<string, unknown>;
  /** Runs after Save, once the patch was sent. */
  onSaved?(): void;
  /** Runs when the modal closes without saving (close button, Escape, backdrop, reopen, destroy). */
  onDiscarded?(): void;
}

/** A host-owned block of rows in the Settings modal. */
export interface MikeDownSettingsSection {
  /** Core tab id ('appearance', 'behavior', 'markdown', 'spelling', 'hotkeys') or a new tab id. */
  tab: string;
  /** Label for a new tab. Ignored for core tabs. */
  tabLabel?: string;
  /** Insert a new tab after this tab id. Default: after the last tab. */
  afterTab?: string;
  /** Extra class on a new tab's panel (e.g. 'settings-panel--about'). */
  panelClassName?: string;
  /**
   * Where the rows go inside the tab: before the core rows, after them
   * (default), or after the core row with this setting key.
   */
  placement?: 'start' | 'end' | { after: keyof MikeDownSettings };
  build(ctx: MikeDownSettingsSectionContext): MikeDownSettingsSectionBuild;
}

// ── Factory options ───────────────────────────────────────────────────────────

export interface MikeDownOptions {
  host: MikeDownHost;
  /** Loaded as the pristine baseline. */
  initialMarkdown?: string;
  /** Initial core settings. */
  settings?: Partial<MikeDownSettings>;
  features?: Partial<MikeDownFeatures>;
  /** Overrides `settings.editorTheme`. */
  theme?: 'light' | 'dark' | 'auto';
  readOnly?: boolean;
  /** Base URL of the spell-check dictionaries (contains `en/` and `en-GB/`). */
  spellcheckDictionaryUrl?: string;
  /** Host sections in the Settings modal. */
  extraSettingsSections?: MikeDownSettingsSection[];
  /** Text beside the Settings modal's Save button. */
  settingsFooterNote?: string;
  /**
   * True when the host binds editor shortcuts itself, as the VS Code
   * keybinding does for Cmd/Ctrl+/. The core then leaves `Mod-/` alone so the
   * source toggle never fires twice. Default false: the core binds it, in both
   * the rich editor and source mode.
   */
  hostOwnsShortcuts?: boolean;
  /** Empty-document placeholder. Default: "Type / for commands…" or "Start writing…". */
  placeholder?: string;
  /** `id` of the editable surface (the contenteditable, and the source view's content). */
  id?: string;
  /** Accessible name of the editable surface. Default "Document text". */
  ariaLabel?: string;
  /** Id of the element that names the editable surface. Wins over `ariaLabel`'s default. */
  ariaLabelledBy?: string;
  /**
   * Put `role="main"` on the editor container. Default true (VS Code, Desktop).
   * Embedded form fields pass false, since a field is not a page landmark.
   */
  landmark?: boolean;
}

// ── Handle ────────────────────────────────────────────────────────────────────

export type MikeDownCommand =
  | 'toggleBold'
  | 'toggleItalic'
  | 'toggleStrike'
  | 'toggleHighlight'
  | 'toggleCode'
  | 'toggleBulletList'
  | 'toggleOrderedList'
  | 'toggleTaskList'
  | 'pasteWithoutFormatting'
  | 'openEmojiPicker'
  | 'undo'
  | 'redo'
  | 'toggleSource'
  | 'toggleSidebar'
  | 'openSettings'
  /**
   * Open the Settings modal on the AI tab (no-op without `host.ai`). With
   * `{ page: true }`, open the full-window AI Engines page instead (engines
   * and routing; hosts with an engine registry only, others get the tab).
   */
  | 'openAiSettings'
  /** Rewrite the selection with AI: opens the rewrite popover's choices (no-op without `host.ai`). */
  | 'aiRewrite'
  | 'copyAsRichText'
  // Menu-bar commands for hosts with their own menus (MikeDown Desktop). Each
  // mirrors an existing toolbar action or keystroke; no-ops in source mode
  // where the action would edit the hidden rich-text document.
  | 'heading1'
  | 'heading2'
  | 'heading3'
  | 'heading4'
  | 'heading5'
  | 'heading6'
  | 'paragraph'
  | 'openFind'
  | 'openFindReplace'
  | 'insertTable'
  | 'insertLink'
  | 'insertImage'
  | 'zoomIn'
  | 'zoomOut'
  | 'zoomReset';

export type MikeDownEvent = 'change' | 'focus' | 'blur' | 'ready';

/**
 * Where the user is in the document: which view is showing, the caret and
 * the scroll offset of that view. A host that keeps several documents in one
 * editor (tabs) saves it when a tab deactivates and restores it when the tab
 * comes back, or across sessions.
 */
export interface MikeDownViewState {
  sourceMode: boolean;
  /** Caret position in the showing view: a ProseMirror position in rich text, a character offset in source mode. */
  cursor: number;
  /** Scroll offset of the showing view's scroller, in CSS pixels. */
  scrollTop: number;
}

/** Sidebar layout and per-document section state pushed by the host. */
export interface SidebarStateUpdate {
  pref?: 'always' | 'never';
  width?: number;
  position?: 'left' | 'right';
  sectionPrefs?: Record<string, boolean>;
}

/** Sidebar footer link (the VS Code support appeal uses it). */
export interface SidebarFooterLink {
  label: string;
  dismissLabel: string;
  dismissConfirmation: string;
  onOpen(): void;
  onDismiss(): void;
}

export interface MikeDownEditorHandle {
  /** Replace the document. `pristine` (default true) makes it the clean baseline. */
  setMarkdown(markdown: string, opts?: { pristine?: boolean }): void;
  getMarkdown(): string;
  focus(): void;
  setReadOnly(readOnly: boolean): void;
  setTheme(theme: 'light' | 'dark' | 'auto'): void;
  /** Run a toolbar or keybinding command. `openSettings` takes `{ tab }`, `openAiSettings` takes `{ page }`. */
  command(name: MikeDownCommand, args?: { tab?: string; page?: boolean }): void;
  /** Apply settings without persisting them. */
  updateSettings(patch: Partial<MikeDownSettings>): void;
  /** The host saved the document; `content` (default: current markdown) is the new baseline. */
  markSaved(content?: string): void;
  /** Rendered HTML of the document (for export and print). */
  getHtml(): string;
  scrollToAnchor(slug: string): void;
  /** Scroll to and flash the Nth link with this href. */
  revealLink(href: string, occurrence?: number): void;
  /**
   * Select and scroll to a match in the markdown source: 1-based `line`,
   * 1-based `column` in UTF-16 units, `length` of the match. Exact in source
   * mode; in rich text the matched string is found again in the rendered text.
   */
  revealText(line: number, column: number, length?: number): void;
  /** Mark images rendered from `src` as missing or present again. */
  setImageStatus(src: string, status: 'found' | 'missing', detail?: string): void;
  /** Insert a link at the cursor (rich text or source mode). `text` defaults to the href. */
  insertLink(href: string, text?: string): void;
  /** Insert an image at the cursor, e.g. the result of `host.uploadImage` for a dropped file. */
  insertImage(image: ImageInsertResult): void;
  /**
   * Files around the document changed: re-resolve `[[wikilinks]]`, re-check
   * relative links and refresh file suggestions. Also call it after adding
   * the knowledge-base host methods to a host that started without them.
   */
  refreshLinks(): void;
  setTags(tags: TagCount[]): void;
  /** Push link suggestions without being asked (same data as `host.getLinkSuggestions`). */
  setLinkSuggestions(suggestions: LinkSuggestion[]): void;
  setBacklinks(items: BacklinkItem[]): void;
  setDocMeta(meta: { mtimeMs?: number | null }): void;
  setSidebarState(state: SidebarStateUpdate): void;
  /** Show or hide the sidebar footer link (requires `features.supportCard`). */
  setSidebarFooterLink(link: SidebarFooterLink | null): void;
  setDiffAvailable(available: boolean): void;
  /**
   * Show which engine served the last AI request in the sidebar's AI chip
   * (`AI: local · oMLX · Qwen 3.8 Flash Next`). `viaFallback` adds
   * "(fallback)". Null forgets it, so the chip shows the route again.
   */
  setAiServed(served: AiServedBy | null, opts?: { viaFallback?: boolean }): void;
  /** Push engine statuses the host learned on its own (VS Code's `aiEngines` broadcast). */
  setAiEngineStatuses(statuses: AiEngineStatus[]): void;
  /** True while the Settings modal or another core modal is open. */
  isModalOpen(): boolean;
  /** Which view is showing, where the caret is and how far it is scrolled. */
  getViewState(): MikeDownViewState;
  /**
   * Restore a saved view state: switches views when `sourceMode` differs,
   * then places the caret (clamped to the document) and the scroll offset.
   * Call it after `setMarkdown`. Missing fields keep their current value.
   */
  setViewState(state: Partial<MikeDownViewState>): void;
  /** Subscribe to an event. Returns an unsubscribe function. */
  on(event: MikeDownEvent, fn: (...args: any[]) => void): () => void;
  /** Tear down the editor and every listener it attached to window or document. */
  destroy(): void;
  /** The underlying TipTap editor. Escape hatch for tests and advanced hosts; not a stable API. */
  readonly tiptap: Editor;
}
