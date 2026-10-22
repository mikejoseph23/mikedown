/**
 * MikeDown host adapter.
 *
 * The editor core never talks to its environment directly. Everything that
 * needs the outside world (saving, file system, workspace search, opening
 * links, persisting settings) goes through a `MikeDownHost` the embedding
 * application passes to `createMikeDownEditor`.
 *
 * Rules (see core-extraction-decisions.md section 5):
 *
 * - `onChange` is the only required method.
 * - Every other method is optional. An absent method turns its feature off
 *   and hides its UI (toolbar button, slash command, sidebar section,
 *   settings control).
 * - Request/response pairs are Promise-returning methods. Correlation ids,
 *   retries and transport details stay inside the host implementation.
 */

import type { MikeDownSettingsPatch } from './types';

/** How a link should open. Absent means the host's default. */
export type LinkOpenBehavior = 'navigateCurrentTab' | 'openNewTab';

/** A link target offered by the link dialog autocomplete. */
export interface LinkSuggestion {
  label: string;
  href: string;
  type: 'file' | 'anchor' | 'inDoc' | 'external';
  /** Heading level (1-6) for anchor items, used for hierarchical indentation. */
  level?: number;
}

/**
 * Result of resolving one `[[wikilink]]` target. `href` is null when no
 * document matches. `count` is how many documents share the name: 0 means
 * unresolved, 1 unique, more than 1 ambiguous (the host picked the nearest).
 */
export interface WikilinkResolution {
  target: string;
  href: string | null;
  count?: number;
}

/** One workspace tag with the number of documents that carry it. */
export interface TagCount {
  tag: string;
  count: number;
}

/** A backlink to the current document, rendered in the sidebar. */
export interface BacklinkItem {
  uri: string;
  displayPath: string;
  line: number;
  lineText?: string;
  /** Href of the link in the source doc, so the opened doc can scroll to it. */
  linkHref?: string;
  /** Which occurrence of linkHref this is (0-based). */
  occurrence?: number;
}

/** Image bytes from a paste or drop. */
export interface ImageUploadRequest {
  mime: string;
  bytes: Uint8Array;
  name?: string;
}

/** Where an uploaded or picked image lives, as the editor should render it. */
export interface ImageInsertResult {
  src: string;
  alt?: string;
}

/** A downscaled copy of an image already in the document. */
export interface ImageResizeRequest {
  /** The image's current `src` attribute. */
  currentSrc: string;
  mime: string;
  bytes: Uint8Array;
  /** Percentage of the natural size (1 to 200). */
  percent: number;
}

export interface ImageResizeResult {
  /** The `src` to render the resized image from. */
  src: string;
  /** True when the original file was replaced (the editor cache-busts the src). */
  overwritten: boolean;
}

/** A link the editor asks the host to validate. */
export interface LinkCheckRequest {
  href: string;
  type: 'anchor' | 'file' | 'fileAnchor';
}

/** The committed version of the document, for change highlighting. */
export interface DiffBaseline {
  headContent: string | null;
  hasChanges: boolean;
}

/** Status-bar style statistics. Either field may be present. */
export interface MikeDownStats {
  /** Full plain text of the document (for word count and reading time). */
  document?: string;
  /** Selection size, or null when nothing is selected. */
  selection?: { words: number; chars: number } | null;
}

/** Sidebar preference persistence. Absent means in-memory defaults. */
export interface MikeDownSidebarPrefs {
  /** Ask for the persisted sidebar state; the host answers with `handle.setSidebarState`. */
  requestState(): void;
  /** The pin toggle changed the default visibility for new documents. */
  setPref(pref: 'always' | 'never'): void;
  /** "Apply to open documents" in Settings. */
  applyDefaults(): void;
  /** A sidebar section was collapsed or expanded by the user. */
  sectionCollapsed(section: string, collapsed: boolean): void;
}

export interface MikeDownHost {
  // ── Document ──────────────────────────────────────────────────────────────
  /**
   * The document changed. `pristine` is true when the content matches the
   * last load or save exactly (the user undid every change), in which case
   * `markdown` is the original text byte for byte.
   */
  onChange(markdown: string, meta: { pristine: boolean }): void;
  /** Word count and selection statistics. */
  onStats?(stats: MikeDownStats): void;

  // ── Navigation ────────────────────────────────────────────────────────────
  /**
   * Open a link. Absent means external links open in a new browser tab and
   * relative links are ignored. `reveal` asks the target document to scroll
   * to a link back to this one (sidebar backlinks).
   */
  openLink?(href: string, behavior?: LinkOpenBehavior, reveal?: { href?: string; occurrence?: number }): void;

  // ── Settings ──────────────────────────────────────────────────────────────
  /**
   * Persist settings. Absent means changes made in the Settings modal last
   * for the session only. `source: 'slashMenu'` marks the slash menu's
   * "Turn off slash commands" row; `silent` marks background saves (wheel
   * zoom, Add to Dictionary) that should not show a confirmation.
   */
  saveSettings?(patch: MikeDownSettingsPatch, opts?: { source?: 'slashMenu'; silent?: boolean }): void;
  /** Flip light and dark. Absent means the editor flips its own theme. */
  toggleTheme?(): void;
  /** "Customize" button on the Hotkeys settings tab. Hidden when absent. */
  openKeybindings?(): void;

  // ── Images (absent = feature off) ─────────────────────────────────────────
  /** Store pasted or dropped image bytes. Absent disables image paste and drop. */
  uploadImage?(file: ImageUploadRequest): Promise<ImageInsertResult>;
  /** Native file picker. Resolves null when cancelled. Absent hides `/image`. */
  pickImage?(): Promise<ImageInsertResult | null>;
  /** Save a resized copy of an image. Absent hides the resize menu items. */
  resizeImage?(req: ImageResizeRequest): Promise<ImageResizeResult>;

  /**
   * Image source policy. The core renders `http:`, `https:`, `data:` and
   * `blob:` sources as they are. For any other source (a relative or
   * absolute path) it calls this and renders the non-null result. Absent, or
   * returning null, the image shows the missing-image placeholder with the raw
   * path. Only the rendered `<img src>` changes; the stored `src`, and so the
   * markdown, is never rewritten.
   */
  resolveImageSrc?(src: string): string | null;

  // ── Knowledge-base features (absent = feature off) ────────────────────────
  /** Files and anchors for link autocomplete and `[[` wikilink autocomplete. */
  getLinkSuggestions?(): Promise<LinkSuggestion[]>;
  /** Heading anchors of another document, for `file.md#` completion. */
  getFileHeadings?(path: string): Promise<LinkSuggestion[]>;
  /** Resolve `[[wikilink]]` targets to hrefs. */
  resolveWikilinks?(targets: string[]): Promise<WikilinkResolution[]>;
  /**
   * Cmd/Ctrl+click on an unresolved wikilink (only when the
   * `wikilinkCreateOnClick` setting is on). May resolve with the new
   * resolution so the link lights up without a reload.
   */
  createWikilink?(target: string): Promise<WikilinkResolution[] | void> | void;
  /** Validate relative links. Resolves with the hrefs that are broken. */
  checkLinks?(links: LinkCheckRequest[]): Promise<string[]>;
  /** Workspace tag index. Also enables the sidebar Tags section and `#` autocomplete. */
  getTags?(): Promise<TagCount[]>;
  /** Tag click (sidebar or Cmd/Ctrl+click in the document). */
  openTag?(tag: string): void;
  /** Committed version of the document for change highlighting. */
  getDiffBaseline?(): Promise<DiffBaseline>;
  /** A heading's anchor slug changed; in-document links are already fixed. */
  onHeadingRenamed?(oldSlug: string, newSlug: string): void;
  /** A renamed heading's slug is duplicated in the document; nothing was fixed. */
  onHeadingRenameAmbiguous?(baseName: string): void;

  // ── Output (absent = toolbar entries hidden) ──────────────────────────────
  exportHtml?(html: string): void;
  printDocument?(html: string): void;
  viewInBrowser?(html: string): void;

  // ── Sidebar ───────────────────────────────────────────────────────────────
  sidebarPrefs?: MikeDownSidebarPrefs;
}

/** A host with every optional method absent. `onChange` does nothing. */
export class NoopHost implements MikeDownHost {
  onChange(_markdown: string, _meta: { pristine: boolean }): void {
    // Intentionally empty.
  }
}
