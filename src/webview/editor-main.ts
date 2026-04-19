/**
 * MikeDown Editor — Webview Entry Point (TipTap)
 *
 * This script is compiled by webpack (browser/web target) and runs inside the
 * VS Code webview. It initialises TipTap with the tiptap-markdown extension so
 * the editor can parse GFM on load and serialise back to GFM on every change.
 *
 * Extension → Webview messages:
 *   { type: 'update', content: string }  — full document markdown text to load
 *   { type: 'command', command: string } — formatting command from extension host
 *
 * Webview → Extension messages:
 *   { type: 'ready' }                    — webview is ready to receive content
 *   { type: 'edit', content: string }    — new full markdown text after user edit
 *   { type: 'stats', plainText: string } — plain text for word/char count (M14 hook)
 *   { type: 'toggleSource' }             — request to toggle source mode (M4 hook)
 */

import { Editor } from '@tiptap/core';
import { Selection, TextSelection } from '@tiptap/pm/state';
import { StarterKit } from '@tiptap/starter-kit';
import { TaskList } from '@tiptap/extension-task-list';
import { TaskItem } from '@tiptap/extension-task-item';
import { Table } from '@tiptap/extension-table';
import { TableRow } from '@tiptap/extension-table-row';
import { TableHeader } from '@tiptap/extension-table-header';
import { TableCell } from '@tiptap/extension-table-cell';
import { Link } from '@tiptap/extension-link';
import { Image } from '@tiptap/extension-image';
import { Placeholder } from '@tiptap/extension-placeholder';
import { Markdown } from 'tiptap-markdown';
import { CodeBlockLowlight } from '@tiptap/extension-code-block-lowlight';
import { createLowlight, all } from 'lowlight';
import { SmartPasteExtension } from './smartpaste';
import { TableCheckboxExtension } from './tablecheckbox';
import { HtmlAnchor } from './htmlanchor';
import { Emoji } from './emoji';
import {
  FindReplaceExtension, updateSearch, clearSearch, findNext, findPrev,
  replaceCurrentMatch, replaceAllMatches
} from './findreplace';
import { showContextMenu, hideContextMenu, buildTextMenu, buildLinkMenu, buildTableMenu, buildImageMenu } from './contextmenu';
import { showTableGridPicker, hideTableGridPicker, updateTableToolbar, hideTableToolbar } from './tablepicker';
import { initTableDrag, clearCellSelection, clearDragHandles } from './tabledrag';
import { initLinkAutocomplete, receiveSuggestions, receiveFileHeadings, destroyLinkAutocomplete, isDropdownActive, collectDocLinks } from './linkautocomplete';
import { showToolbarDropdown, hideToolbarDropdown, isToolbarDropdownOpen, updateDropdownActiveStates } from './toolbar-dropdown';

// ── CodeMirror 6 — Source Mode (M4) ───────────────────────────────────────────
import { EditorState } from '@codemirror/state';
import { EditorView, keymap, lineNumbers, highlightActiveLine } from '@codemirror/view';
import { defaultKeymap, historyKeymap, history } from '@codemirror/commands';
import { markdown as cmMarkdown, markdownLanguage } from '@codemirror/lang-markdown';
import { syntaxHighlighting, defaultHighlightStyle } from '@codemirror/language';
import { oneDarkHighlightStyle } from '@codemirror/theme-one-dark';

const lowlight = createLowlight(all);

// ── VS Code Webview API ────────────────────────────────────────────────────────

declare const acquireVsCodeApi: () => {
  postMessage: (msg: unknown) => void;
  getState: () => unknown;
  setState: (state: unknown) => void;
};

const vscode = acquireVsCodeApi();

console.log('MikeDown: editor-main.ts script executing');

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

// ── Diff highlighting state ───────────────────────────────────────────────────

/** Whether diff highlighting is currently active in the WYSIWYG view. */
let diffHighlightActive = false;

/** Whether the current file has uncommitted git changes. */
let fileHasGitChanges = false;

/** HEAD content received from the extension host for diff computation. */
let headContent: string | null = null;

// ── M6a: Link tooltip state ────────────────────────────────────────────────────

let linkTooltip: HTMLDivElement | null = null;

// ── M15: Frontmatter state ─────────────────────────────────────────────────────

/**
 * Stores raw YAML content between the --- delimiters of a frontmatter block.
 * Empty string when the document has no frontmatter.
 */
let frontmatterContent: string = '';

/**
 * Tracks whether the frontmatter UI block is expanded or collapsed.
 */
let frontmatterExpanded = false;

// ── M15: Frontmatter helpers ───────────────────────────────────────────────────

function extractFrontmatter(markdown: string): { frontmatter: string; body: string } {
  // Match YAML frontmatter: --- at start of file (with optional BOM)
  const match = markdown.match(/^(?:---\n)([\s\S]*?)\n---\n?/);
  if (match) {
    return { frontmatter: match[1], body: markdown.slice(match[0].length) };
  }
  return { frontmatter: '', body: markdown };
}

function restoreFrontmatter(frontmatter: string, body: string): string {
  if (!frontmatter) return body;
  return `---\n${frontmatter}\n---\n${body}`;
}

// ── M6a: Anchor ID generation helpers ─────────────────────────────────────────

/**
 * Generate a GitHub-style anchor ID from a heading's text content.
 */
function githubAnchorId(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\w\s-]/g, '')    // remove non-alphanumeric except hyphens
    .replace(/\s+/g, '-')        // spaces → hyphens
    .replace(/-+/g, '-')         // collapse consecutive hyphens
    .replace(/^-|-$/g, '');      // trim leading/trailing hyphens
}

/**
 * Compute the anchor ID for a specific heading element by walking all
 * headings (to handle collision deduplication) up to and including it.
 * Returns the anchor ID or empty string if the heading isn't found.
 */
function computeAnchorIdFor(targetHeading: HTMLElement): string {
  const container = document.getElementById('editor-container');
  if (!container) return '';
  const headings = container.querySelectorAll<HTMLElement>('h1,h2,h3,h4,h5,h6');
  const seenIds = new Map<string, number>();
  for (const h of headings) {
    const base = githubAnchorId(h.textContent || '');
    const count = seenIds.get(base) ?? 0;
    const id = count === 0 ? base : `${base}-${count}`;
    seenIds.set(base, count + 1);
    if (h === targetHeading) return id;
  }
  return '';
}

// ── M3: Link and image dialog helpers ─────────────────────────────────────────

function showLinkDialog(editor: Editor): void {
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
    'background:var(--vscode-editorWidget-background,var(--vscode-editor-background,#252526))',
    'border:1px solid var(--vscode-editorWidget-border,rgba(128,128,128,0.35))',
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
  title.style.cssText = 'font-weight:600;font-size:14px;color:var(--vscode-editor-foreground,#d4d4d4)';

  const fieldWrapper = document.createElement('div');
  const fieldLabel = document.createElement('label');
  fieldLabel.textContent = 'URL';
  fieldLabel.style.cssText = 'display:block;font-size:12px;font-weight:500;margin-bottom:4px;color:var(--vscode-descriptionForeground)';

  const urlInput = document.createElement('input');
  urlInput.type = 'text';
  urlInput.placeholder = 'https:// or ./relative.md or #anchor';
  urlInput.value = existing ?? '';
  urlInput.style.cssText = [
    'width:100%',
    'padding:5px 8px',
    'background:var(--vscode-input-background,#3c3c3c)',
    'color:var(--vscode-input-foreground,#d4d4d4)',
    'border:1px solid var(--vscode-input-border,rgba(128,128,128,0.35))',
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
    'color:var(--vscode-button-secondaryForeground,#d4d4d4)',
    'border:1px solid var(--vscode-button-secondaryBackground,rgba(128,128,128,0.35))',
    'border-radius:4px',
    'cursor:pointer',
    'font-size:13px'
  ].join(';');

  const confirmBtn = document.createElement('button');
  confirmBtn.textContent = existing ? 'Update' : 'Insert';
  confirmBtn.style.cssText = [
    'padding:5px 14px',
    'background:var(--vscode-button-background,#0e639c)',
    'color:var(--vscode-button-foreground,#ffffff)',
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
  document.body.appendChild(overlay);

  // Wire autocomplete with links already in the document
  const existingDocLinks = collectDocLinks();
  initLinkAutocomplete(urlInput, (href) => {
    urlInput.value = href;
  }, existingDocLinks);

  // Focus the input
  setTimeout(() => urlInput.focus(), 0);

  function cleanup(): void {
    destroyLinkAutocomplete();
    overlay.remove();
  }

  function confirm(): void {
    const url = urlInput.value.trim();
    cleanup();
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
    'background:var(--vscode-editorWidget-background,var(--vscode-editor-background,#252526))',
    'border:1px solid var(--vscode-editorWidget-border,rgba(128,128,128,0.35))',
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
  title.style.cssText = 'font-weight:600;font-size:14px;color:var(--vscode-editor-foreground,#d4d4d4)';

  const makeField = (label: string, placeholder: string, value: string): { wrapper: HTMLElement; input: HTMLInputElement } => {
    const wrapper = document.createElement('div');
    const lbl = document.createElement('label');
    lbl.textContent = label;
    lbl.style.cssText = 'display:block;font-size:12px;font-weight:500;margin-bottom:4px;color:var(--vscode-descriptionForeground)';
    const input = document.createElement('input');
    input.type = 'text';
    input.placeholder = placeholder;
    input.value = value;
    input.style.cssText = [
      'width:100%',
      'padding:5px 8px',
      'background:var(--vscode-input-background,#3c3c3c)',
      'color:var(--vscode-input-foreground,#d4d4d4)',
      'border:1px solid var(--vscode-input-border,rgba(128,128,128,0.35))',
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
    'color:var(--vscode-button-secondaryForeground,#d4d4d4)',
    'border:1px solid var(--vscode-button-secondaryBackground,rgba(128,128,128,0.35))',
    'border-radius:4px',
    'cursor:pointer',
    'font-size:13px'
  ].join(';');

  const confirmBtn = document.createElement('button');
  confirmBtn.textContent = 'Insert';
  confirmBtn.style.cssText = [
    'padding:5px 14px',
    'background:var(--vscode-button-background,#0e639c)',
    'color:var(--vscode-button-foreground,#ffffff)',
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
  document.body.appendChild(overlay);

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

function showSettingsModal(): void {
  // Remove existing modal if open
  document.getElementById('mikedown-settings-overlay')?.remove();

  const overlay = document.createElement('div');
  overlay.id = 'mikedown-settings-overlay';
  overlay.style.cssText = 'position:fixed;inset:0;z-index:1050;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,0.25)';

  const modal = document.createElement('div');
  modal.setAttribute('role', 'dialog');
  modal.setAttribute('aria-modal', 'true');
  modal.setAttribute('aria-label', 'MikeDown Settings');
  modal.style.cssText = [
    'background:var(--vscode-editorWidget-background,#252526)',
    'border:1px solid var(--vscode-editorWidget-border,rgba(128,128,128,0.35))',
    'border-radius:10px',
    'padding:24px 28px',
    'min-width:420px',
    'max-width:520px',
    'box-shadow:0 12px 40px rgba(0,0,0,0.5)',
    'display:flex',
    'flex-direction:column',
    'gap:20px',
    'max-height:80vh',
    'overflow-y:auto',
  ].join(';');

  // Read current values from CSS custom properties
  const computed = getComputedStyle(document.documentElement);
  const currentFontSize = parseInt(computed.getPropertyValue('--mikedown-font-size') || '17', 10);
  const currentFontFamily = computed.getPropertyValue('--mikedown-font-family').trim();
  const currentMaxWidth = computed.getPropertyValue('--mikedown-content-width').trim() || '100%';

  // ── Title
  const title = document.createElement('div');
  title.style.cssText = 'display:flex;justify-content:space-between;align-items:center';
  const titleText = document.createElement('h2');
  titleText.textContent = 'Settings';
  titleText.style.cssText = 'margin:0;font-size:18px;font-weight:600;color:var(--vscode-editor-foreground)';
  const closeBtn = document.createElement('button');
  closeBtn.innerHTML = '&times;';
  closeBtn.style.cssText = 'background:none;border:none;color:var(--vscode-editor-foreground);font-size:22px;cursor:pointer;padding:0 4px;opacity:0.6';
  closeBtn.addEventListener('click', () => overlay.remove());
  title.appendChild(titleText);
  title.appendChild(closeBtn);

  // ── Helper to create a setting row
  function makeRow(label: string, description: string): HTMLElement {
    const row = document.createElement('div');
    row.style.cssText = 'display:flex;flex-direction:column;gap:6px';
    const lbl = document.createElement('label');
    lbl.style.cssText = 'font-size:14px;font-weight:500;color:var(--vscode-editor-foreground)';
    lbl.textContent = label;
    const desc = document.createElement('div');
    desc.style.cssText = 'font-size:12px;color:var(--vscode-descriptionForeground);line-height:1.4';
    desc.textContent = description;
    row.appendChild(lbl);
    row.appendChild(desc);
    return row;
  }

  const inputStyle = [
    'padding:6px 10px',
    'background:var(--vscode-input-background,#3c3c3c)',
    'color:var(--vscode-input-foreground,#d4d4d4)',
    'border:1px solid var(--vscode-input-border,rgba(128,128,128,0.35))',
    'border-radius:4px',
    'font-size:14px',
    'outline:none',
    'box-sizing:border-box',
    'width:100%',
  ].join(';');

  // ── Font Size
  const fontSizeRow = makeRow('Font Size', 'Size in pixels for the editor content.');
  const fontSizeInput = document.createElement('input');
  fontSizeInput.type = 'range';
  fontSizeInput.min = '12';
  fontSizeInput.max = '28';
  fontSizeInput.value = String(currentFontSize);
  fontSizeInput.style.cssText = 'width:100%;accent-color:var(--vscode-focusBorder,#007fd4)';
  const fontSizeLabel = document.createElement('span');
  fontSizeLabel.style.cssText = 'font-size:13px;color:var(--vscode-descriptionForeground);font-variant-numeric:tabular-nums';
  fontSizeLabel.textContent = `${currentFontSize}px`;
  const fontSizeControl = document.createElement('div');
  fontSizeControl.style.cssText = 'display:flex;align-items:center;gap:10px';
  fontSizeControl.appendChild(fontSizeInput);
  fontSizeControl.appendChild(fontSizeLabel);
  fontSizeRow.appendChild(fontSizeControl);
  fontSizeInput.addEventListener('input', () => {
    fontSizeLabel.textContent = `${fontSizeInput.value}px`;
    document.documentElement.style.setProperty('--mikedown-font-size', `${fontSizeInput.value}px`);
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
  themeCurrentRow.style.cssText = 'display:flex;align-items:center;justify-content:space-between;margin-bottom:6px';
  const themeIndicator = document.createElement('span');
  themeIndicator.style.cssText = 'font-size:13px;color:#cccccc';
  themeIndicator.textContent = `Current: ${currentThemeLabel}`;
  const themeRevertBtn = document.createElement('button');
  themeRevertBtn.textContent = 'Revert';
  themeRevertBtn.style.cssText = 'padding:3px 10px;background:transparent;color:#cccccc;border:1px solid rgba(128,128,128,0.4);border-radius:3px;cursor:pointer;font-size:12px;display:none';
  themeRevertBtn.addEventListener('click', () => {
    selectedBody = originalBody;
    selectedHeading = originalHeading;
    document.documentElement.style.setProperty('--mikedown-font-family', originalBody);
    document.documentElement.style.setProperty('--mikedown-heading-font-family', originalHeading);
    themeRevertBtn.style.display = 'none';
    updateThemeItems();
  });
  themeCurrentRow.appendChild(themeIndicator);
  themeCurrentRow.appendChild(themeRevertBtn);
  fontThemeRow.appendChild(themeCurrentRow);

  // Theme list
  const themeList = document.createElement('div');
  themeList.setAttribute('tabindex', '0');
  themeList.style.cssText = 'max-height:400px;overflow-y:auto;border:1px solid rgba(128,128,128,0.25);border-radius:6px;background:#1e1e1e;outline:none';

  const themeItems: Array<{ el: HTMLElement; theme: typeof fontThemes[0] }> = [];

  function updateThemeItems(): void {
    themeItems.forEach(({ el, theme }) => {
      const isActive = selectedBody === theme.body && selectedHeading === theme.heading;
      el.style.background = isActive ? '#0e639c' : '';
      const nameEl = el.querySelector('[data-role="name"]') as HTMLElement;
      const descEl = el.querySelector('[data-role="desc"]') as HTMLElement;
      const headEl = el.querySelector('[data-role="heading"]') as HTMLElement;
      const bodyEl = el.querySelector('[data-role="body"]') as HTMLElement;
      if (nameEl) nameEl.style.color = isActive ? '#ffffff' : '#e0e0e0';
      if (descEl) descEl.style.color = isActive ? 'rgba(255,255,255,0.7)' : '#888';
      if (headEl) headEl.style.color = isActive ? '#ffffff' : '#cccccc';
      if (bodyEl) bodyEl.style.color = isActive ? 'rgba(255,255,255,0.8)' : '#999';
    });
  }

  fontThemes.forEach(theme => {
    const item = document.createElement('div');
    item.style.cssText = 'padding:10px 12px;cursor:pointer;border-radius:4px;margin:2px 4px;transition:background 0.06s ease';

    const topRow = document.createElement('div');
    topRow.style.cssText = 'display:flex;justify-content:space-between;align-items:baseline;margin-bottom:4px';
    const nameSpan = document.createElement('span');
    nameSpan.setAttribute('data-role', 'name');
    nameSpan.textContent = theme.label;
    nameSpan.style.cssText = 'font-size:13px;font-weight:600;color:#e0e0e0';
    const descSpan = document.createElement('span');
    descSpan.setAttribute('data-role', 'desc');
    descSpan.textContent = theme.desc;
    descSpan.style.cssText = 'font-size:11px;color:#888';
    topRow.appendChild(nameSpan);
    topRow.appendChild(descSpan);

    const preview = document.createElement('div');
    preview.style.cssText = 'background:rgba(0,0,0,0.2);border-radius:4px;padding:10px 12px;margin-top:4px';

    const headingSample = document.createElement('div');
    headingSample.setAttribute('data-role', 'heading');
    headingSample.textContent = 'The Quick Brown Fox Jumps';
    headingSample.style.cssText = `font-family:${theme.heading};font-size:18px;font-weight:700;color:#cccccc;line-height:1.3;margin-bottom:4px`;
    const bodySample = document.createElement('div');
    bodySample.setAttribute('data-role', 'body');
    bodySample.textContent = 'Pack my box with five dozen liquor jugs. How vexingly quick daft zebras jump! 0123456789 — "quotes" & more.';
    bodySample.style.cssText = `font-family:${theme.body};font-size:14px;color:#999;line-height:1.5`;

    preview.appendChild(headingSample);
    preview.appendChild(bodySample);

    item.appendChild(topRow);
    item.appendChild(preview);

    item.addEventListener('mouseenter', () => {
      if (selectedBody !== theme.body || selectedHeading !== theme.heading) {
        item.style.background = 'rgba(255,255,255,0.08)';
      }
    });
    item.addEventListener('mouseleave', () => {
      if (selectedBody !== theme.body || selectedHeading !== theme.heading) {
        item.style.background = '';
      }
    });
    item.addEventListener('click', () => {
      selectedBody = theme.body;
      selectedHeading = theme.heading;
      document.documentElement.style.setProperty('--mikedown-font-family', theme.body);
      document.documentElement.style.setProperty('--mikedown-heading-font-family', theme.heading);
      themeRevertBtn.style.display = (selectedBody !== originalBody || selectedHeading !== originalHeading) ? '' : 'none';
      updateThemeItems();
    });

    themeItems.push({ el: item, theme });
    themeList.appendChild(item);
  });

  // Keyboard navigation
  let themeFocusIdx = themeItems.findIndex(ti => ti.theme.body === selectedBody && ti.theme.heading === selectedHeading);
  if (themeFocusIdx < 0) themeFocusIdx = 0;

  themeList.addEventListener('keydown', (e: KeyboardEvent) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      themeFocusIdx = e.key === 'ArrowDown'
        ? Math.min(themeFocusIdx + 1, themeItems.length - 1)
        : Math.max(themeFocusIdx - 1, 0);
      const { el, theme } = themeItems[themeFocusIdx];
      selectedBody = theme.body;
      selectedHeading = theme.heading;
      document.documentElement.style.setProperty('--mikedown-font-family', theme.body);
      document.documentElement.style.setProperty('--mikedown-heading-font-family', theme.heading);
      themeRevertBtn.style.display = (selectedBody !== originalBody || selectedHeading !== originalHeading) ? '' : 'none';
      updateThemeItems();
      el.scrollIntoView({ block: 'nearest' });
    }
  });

  themeList.addEventListener('click', () => {
    themeList.focus();
    themeFocusIdx = themeItems.findIndex(ti => ti.theme.body === selectedBody && ti.theme.heading === selectedHeading);
    if (themeFocusIdx < 0) themeFocusIdx = 0;
  });

  fontThemeRow.appendChild(themeList);

  // Apply initial styling
  updateThemeItems();

  // Wire selectedFontValue for save handler
  let selectedFontValue = selectedBody;

  // ── Content Width
  const widthRow = makeRow('Content Width', 'Max width of the editor content area. Use "100%" for full width or a value like "800px".');
  const widthSelect = document.createElement('select');
  widthSelect.style.cssText = inputStyle + ';cursor:pointer';
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
    if (currentMaxWidth === opt.value || (currentMaxWidth === '' && opt.value === '100%')) option.selected = true;
    widthSelect.appendChild(option);
  });
  widthRow.appendChild(widthSelect);
  widthSelect.addEventListener('change', () => {
    document.documentElement.style.setProperty('--mikedown-content-width', widthSelect.value);
  });

  // ── Save button + note
  const footer = document.createElement('div');
  footer.style.cssText = 'display:flex;justify-content:space-between;align-items:center;padding-top:4px;border-top:1px solid var(--vscode-editorWidget-border,rgba(128,128,128,0.2))';
  const note = document.createElement('span');
  note.style.cssText = 'font-size:12px;color:var(--vscode-descriptionForeground)';
  note.textContent = 'Changes apply instantly. Use VS Code settings for persistence.';
  const saveBtn = document.createElement('button');
  saveBtn.textContent = 'Save to Settings';
  saveBtn.style.cssText = [
    'padding:6px 16px',
    'background:var(--vscode-button-background,#0e639c)',
    'color:var(--vscode-button-foreground,#ffffff)',
    'border:none',
    'border-radius:4px',
    'cursor:pointer',
    'font-size:13px',
    'font-weight:500',
    'flex-shrink:0',
  ].join(';');
  saveBtn.addEventListener('click', () => {
    // Send settings to extension host to persist in VS Code config
    vscode.postMessage({
      type: 'saveSettings',
      settings: {
        fontSize: parseInt(fontSizeInput.value, 10),
        fontFamily: selectedBody,
        headingFontFamily: selectedHeading,
        contentWidth: widthSelect.value,
      }
    });
    overlay.remove();
  });
  footer.appendChild(note);
  footer.appendChild(saveBtn);

  // Assemble
  modal.appendChild(title);
  modal.appendChild(fontSizeRow);
  modal.appendChild(fontThemeRow);
  modal.appendChild(widthRow);
  modal.appendChild(footer);
  overlay.appendChild(modal);
  document.body.appendChild(overlay);

  // Close on backdrop click or Escape
  overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });
  document.addEventListener('keydown', function escHandler(e) {
    if (e.key === 'Escape') { overlay.remove(); document.removeEventListener('keydown', escHandler); }
  });
}

// ── Theme toggle ────────────────────────────────────────────────────────────────

let themeToggleScope: 'vscode' | 'editorOnly' = 'editorOnly';

function isDarkTheme(): boolean {
  if (document.body.classList.contains('mikedown-force-light')) return false;
  if (document.body.classList.contains('mikedown-force-dark')) return true;
  const kind = document.body.dataset.vscodeThemeKind ?? '';
  return !kind.includes('light');
}

function toggleTheme(): void {
  // Always delegate to extension host — it handles both scopes,
  // persists the setting, and broadcasts to all open tabs.
  vscode.postMessage({ type: 'toggleTheme' });
}

/** Apply the editorTheme setting ('auto' | 'light' | 'dark') to the body. */
function applyEditorTheme(editorTheme: string): void {
  document.body.classList.remove('mikedown-force-light', 'mikedown-force-dark');
  if (editorTheme === 'light') document.body.classList.add('mikedown-force-light');
  else if (editorTheme === 'dark') document.body.classList.add('mikedown-force-dark');
  // 'auto' → no class override, follow VS Code theme
  updateThemeToggleIcon();
}

function updateThemeToggleIcon(): void {
  const btn = document.querySelector('button[data-action="themeToggle"]');
  if (!btn) return;
  const dark = isDarkTheme();
  const mkSvg = (d: string, sw = 1.8) => `<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="${sw}" stroke-linecap="round" stroke-linejoin="round">${d}</svg>`;
  btn.innerHTML = dark
    ? mkSvg('<circle cx="8" cy="8" r="3"/><path d="M8 1.5v1.5M8 13v1.5M1.5 8H3M13 8h1.5M3.4 3.4l1.06 1.06M11.54 11.54l1.06 1.06M3.4 12.6l1.06-1.06M11.54 4.46l1.06-1.06"/>')
    : mkSvg('<path d="M13.5 8a5.5 5.5 0 0 1-8.38 4.68A5.5 5.5 0 0 1 8 2.5c0 .5.05 1 .16 1.47A4.5 4.5 0 0 0 13.5 8z"/>');
  btn.title = dark ? 'Switch to Light Mode' : 'Switch to Dark Mode';
}

// Watch for VS Code theme changes (body attribute updates)
new MutationObserver(updateThemeToggleIcon).observe(document.body, {
  attributes: true,
  attributeFilter: ['data-vscode-theme-kind'],
});

// ── Toolbar icons (shared across all toolbar modes) ─────────────────────────

const toolbarSvg = (d: string, sw = 1.8) => `<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="${sw}" stroke-linecap="round" stroke-linejoin="round">${d}</svg>`;
const toolbarIcons = {
  bold: toolbarSvg('<path d="M4 2.5h5a3 3 0 0 1 0 6H4zM4 8.5h6a3 3 0 0 1 0 6H4z" fill="none"/>', 2),
  italic: toolbarSvg('<line x1="10" y1="2" x2="6" y2="14"/><line x1="7" y1="2" x2="12" y2="2"/><line x1="4" y1="14" x2="9" y2="14"/>'),
  strike: toolbarSvg('<line x1="2" y1="8" x2="14" y2="8"/><path d="M10.5 3H6.5a2.5 2.5 0 0 0 0 5h3a2.5 2.5 0 0 1 0 5H5"/>'),
  code: toolbarSvg('<polyline points="5 4 2 8 5 12"/><polyline points="11 4 14 8 11 12"/>'),
  ul: toolbarSvg('<line x1="6" y1="4" x2="14" y2="4"/><line x1="6" y1="8" x2="14" y2="8"/><line x1="6" y1="12" x2="14" y2="12"/><circle cx="3" cy="4" r="1" fill="currentColor" stroke="none"/><circle cx="3" cy="8" r="1" fill="currentColor" stroke="none"/><circle cx="3" cy="12" r="1" fill="currentColor" stroke="none"/>'),
  ol: toolbarSvg('<line x1="6" y1="4" x2="14" y2="4"/><line x1="6" y1="8" x2="14" y2="8"/><line x1="6" y1="12" x2="14" y2="12"/><text x="2" y="5.5" font-size="5" fill="currentColor" stroke="none" font-family="sans-serif">1</text><text x="2" y="9.5" font-size="5" fill="currentColor" stroke="none" font-family="sans-serif">2</text><text x="2" y="13.5" font-size="5" fill="currentColor" stroke="none" font-family="sans-serif">3</text>'),
  task: toolbarSvg('<rect x="2" y="4" width="5" height="5" rx="1"/><polyline points="3.5 6.5 4.5 7.5 6 5.5"/><line x1="9" y1="5" x2="14" y2="5"/><line x1="9" y1="9" x2="14" y2="9"/><line x1="9" y1="13" x2="12" y2="13"/>'),
  quote: toolbarSvg('<line x1="3" y1="3" x2="3" y2="13"/><line x1="6" y1="5" x2="13" y2="5"/><line x1="6" y1="8" x2="13" y2="8"/><line x1="6" y1="11" x2="10" y2="11"/>'),
  codeBlock: toolbarSvg('<rect x="2" y="2" width="12" height="12" rx="2"/><polyline points="5.5 5.5 4 8 5.5 10.5"/><polyline points="10.5 5.5 12 8 10.5 10.5"/>'),
  link: toolbarSvg('<path d="M6.5 9.5l3-3"/><path d="M9 5l1.5-1.5a2.12 2.12 0 0 1 3 3L12 8"/><path d="M7 11l-1.5 1.5a2.12 2.12 0 0 1-3-3L4 8"/>'),
  image: toolbarSvg('<rect x="2" y="3" width="12" height="10" rx="1.5"/><circle cx="5.5" cy="6.5" r="1.2" fill="currentColor" stroke="none"/><polyline points="14 10.5 10.5 7 6 11.5 4.5 10 2 12.5"/>'),
  table: toolbarSvg('<rect x="2" y="2" width="12" height="12" rx="1.5"/><line x1="2" y1="6" x2="14" y2="6"/><line x1="2" y1="10" x2="14" y2="10"/><line x1="6" y1="2" x2="6" y2="14"/><line x1="10" y1="2" x2="10" y2="14"/>'),
  hr: toolbarSvg('<line x1="2" y1="8" x2="14" y2="8"/><circle cx="5" cy="8" r="0.5" fill="currentColor" stroke="none"/><circle cx="8" cy="8" r="0.5" fill="currentColor" stroke="none"/><circle cx="11" cy="8" r="0.5" fill="currentColor" stroke="none"/>'),
  undo: toolbarSvg('<polyline points="4 7 2 5 4 3"/><path d="M2 5h8a4 4 0 0 1 0 8H7"/>'),
  redo: toolbarSvg('<polyline points="12 7 14 5 12 3"/><path d="M14 5H6a4 4 0 0 0 0 8h3"/>'),
  source: toolbarSvg('<polyline points="5 4 2 8 5 12"/><polyline points="11 4 14 8 11 12"/><line x1="9" y1="3" x2="7" y2="13"/>'),
  gear: toolbarSvg('<circle cx="8" cy="8" r="1.8"/><path d="M8 1.5l.6 2.1a4.2 4.2 0 0 1 1.6.65l1.95-.9 1.1 1.1-.9 1.95c.3.5.53 1.03.65 1.6l2.1.6v1.5l-2.1.6a4.2 4.2 0 0 1-.65 1.6l.9 1.95-1.1 1.1-1.95-.9a4.2 4.2 0 0 1-1.6.65l-.6 2.1h-1.5l-.6-2.1a4.2 4.2 0 0 1-1.6-.65l-1.95.9-1.1-1.1.9-1.95a4.2 4.2 0 0 1-.65-1.6L1.5 8.6V7.1l2.1-.6a4.2 4.2 0 0 1 .65-1.6l-.9-1.95 1.1-1.1 1.95.9A4.2 4.2 0 0 1 8 2.1z"/>', 1.4),
  diff: toolbarSvg('<path d="M4 3v10"/><path d="M12 3v10"/><path d="M7 5h2" stroke-opacity="0.5"/><path d="M7 8h2"/><path d="M7 11h2" stroke-opacity="0.5"/>'),
  sun: toolbarSvg('<circle cx="8" cy="8" r="3"/><path d="M8 1.5v1.5M8 13v1.5M1.5 8H3M13 8h1.5M3.4 3.4l1.06 1.06M11.54 11.54l1.06 1.06M3.4 12.6l1.06-1.06M11.54 4.46l1.06-1.06"/>'),
  moon: toolbarSvg('<path d="M13.5 8a5.5 5.5 0 0 1-8.38 4.68A5.5 5.5 0 0 1 8 2.5c0 .5.05 1 .16 1.47A4.5 4.5 0 0 0 13.5 8z"/>'),
  chevron: toolbarSvg('<polyline points="5 6.5 8 9.5 11 6.5"/>', 1.6),
  print: toolbarSvg('<path d="M4 6V2h8v4"/><rect x="2" y="6" width="12" height="6" rx="1"/><rect x="4" y="10" width="8" height="4"/><circle cx="12" cy="8" r="0.5" fill="currentColor" stroke="none"/>'),
  browser: toolbarSvg('<rect x="1.5" y="2.5" width="13" height="11" rx="1.5"/><line x1="1.5" y1="6" x2="14.5" y2="6"/><circle cx="3.5" cy="4.25" r="0.5" fill="currentColor" stroke="none"/><circle cx="5" cy="4.25" r="0.5" fill="currentColor" stroke="none"/><circle cx="6.5" cy="4.25" r="0.5" fill="currentColor" stroke="none"/>'),
  selectAll: toolbarSvg('<rect x="2" y="2" width="12" height="12" rx="1" stroke-dasharray="2 1.5"/><rect x="5" y="5" width="6" height="6" fill="currentColor" stroke="none"/>'),
};

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

function buildToolbar(editor: Editor): void {
  const toolbar = document.getElementById('toolbar');
  if (!toolbar) return;
  toolbar.className = '';

  const icons = toolbarIcons;

  const buttons: ToolbarButtonDef[] = [
    { id: 'bold', title: 'Bold (Cmd+B)', icon: icons.bold, action: () => editor.chain().focus().toggleBold().run(), isActive: () => editor.isActive('bold') },
    { id: 'italic', title: 'Italic (Cmd+I)', icon: icons.italic, action: () => editor.chain().focus().toggleItalic().run(), isActive: () => editor.isActive('italic') },
    { id: 'strike', title: 'Strikethrough', icon: icons.strike, action: () => editor.chain().focus().toggleStrike().run(), isActive: () => editor.isActive('strike') },
    { id: 'code', title: 'Inline Code', icon: icons.code, action: () => editor.chain().focus().toggleCode().run(), isActive: () => editor.isActive('code') },
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
    { id: 'undo', title: 'Undo (Cmd+Z)', icon: icons.undo, action: () => editor.chain().focus().undo().run(), isActive: () => false },
    { id: 'redo', title: 'Redo (Cmd+Shift+Z)', icon: icons.redo, action: () => editor.chain().focus().redo().run(), isActive: () => false },
    { separator: true },
    { id: 'sourceToggle', title: 'Toggle Source Mode (Cmd+/)', icon: icons.source, action: () => vscode.postMessage({ type: 'toggleSource' }), isActive: () => false },
    { id: 'diffToggle', title: 'Toggle Diff Highlighting', icon: icons.diff, action: () => toggleDiffHighlight(), isActive: () => diffHighlightActive },
    { separator: true },
    { id: 'viewInBrowser', title: 'View in Browser', icon: icons.browser, action: () => vscode.postMessage({ type: 'viewInBrowser', html: (document.querySelector('.ProseMirror') as HTMLElement)?.innerHTML ?? '' }), isActive: () => false },
    { id: 'print', title: 'Print / Export as PDF', icon: icons.print, action: () => vscode.postMessage({ type: 'printDocument', html: (document.querySelector('.ProseMirror') as HTMLElement)?.innerHTML ?? '' }), isActive: () => false },
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
    const target = (e.target as HTMLElement).closest('button[data-action]') as HTMLButtonElement | null;
    if (!target) return;
    // M5b — Table button opens grid picker instead of directly inserting
    if (target.dataset.action === 'table') {
      showTableGridPicker(editor, target);
      return;
    }
    const btn = buttons.find(b => !('separator' in b) && (b as { id: string }).id === target.dataset.action);
    if (btn && 'action' in btn) btn.action();
  });

  // Keyboard accessibility: activate buttons via Enter or Space
  toolbar.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    const target = (e.target as HTMLElement).closest('button[data-action]') as HTMLButtonElement | null;
    if (!target) return;
    e.preventDefault();
    target.click();
  });
}

// ── Condensed Toolbar (Apple Notes-style) ───────────────────────────────────

function buildCondensedToolbar(editor: Editor): void {
  const toolbar = document.getElementById('toolbar');
  if (!toolbar) return;
  toolbar.className = 'toolbar-condensed';
  toolbar.innerHTML = '';

  const icons = toolbarIcons;

  // Helper: get current block type label for the text format button
  function getBlockLabel(): string {
    if (editor.isActive('heading', { level: 1 })) return 'H1';
    if (editor.isActive('heading', { level: 2 })) return 'H2';
    if (editor.isActive('heading', { level: 3 })) return 'H3';
    return 'Aa';
  }

  // Helper: check if any inline mark or heading is active (for text format button highlight)
  function isTextFormatActive(): boolean {
    return editor.isActive('bold') || editor.isActive('italic') ||
           editor.isActive('strike') || editor.isActive('code') ||
           editor.isActive('heading', { level: 1 }) ||
           editor.isActive('heading', { level: 2 }) ||
           editor.isActive('heading', { level: 3 });
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

  function makeSeparator(): HTMLDivElement {
    const sep = document.createElement('div');
    sep.className = 'toolbar-separator';
    sep.setAttribute('role', 'separator');
    return sep;
  }

  // ── Text Format dropdown (Aa ▾) ─────────────────────────────────────────
  const textFormatBtn = makeDropdownTrigger('textFormat', 'Text Format', getBlockLabel());
  textFormatBtn.addEventListener('click', () => {
    if (isToolbarDropdownOpen()) { hideToolbarDropdown(); return; }
    showToolbarDropdown(textFormatBtn, [
      { type: 'action', id: 'h1', label: 'Heading 1', icon: '<span style="font-weight:700;font-size:14px">H1</span>', isActive: () => editor.isActive('heading', { level: 1 }), action: () => editor.chain().focus().toggleHeading({ level: 1 }).run() },
      { type: 'action', id: 'h2', label: 'Heading 2', icon: '<span style="font-weight:600;font-size:13px">H2</span>', isActive: () => editor.isActive('heading', { level: 2 }), action: () => editor.chain().focus().toggleHeading({ level: 2 }).run() },
      { type: 'action', id: 'h3', label: 'Heading 3', icon: '<span style="font-weight:500;font-size:12px">H3</span>', isActive: () => editor.isActive('heading', { level: 3 }), action: () => editor.chain().focus().toggleHeading({ level: 3 }).run() },
      { type: 'action', id: 'paragraph', label: 'Paragraph', action: () => editor.chain().focus().setParagraph().run(), isActive: () => !editor.isActive('heading') && !editor.isActive('codeBlock') },
      { type: 'separator' },
      { type: 'mini-row', items: [
        { id: 'bold', icon: icons.bold, title: 'Bold', isActive: () => editor.isActive('bold'), action: () => editor.chain().focus().toggleBold().run() },
        { id: 'italic', icon: icons.italic, title: 'Italic', isActive: () => editor.isActive('italic'), action: () => editor.chain().focus().toggleItalic().run() },
        { id: 'strike', icon: icons.strike, title: 'Strikethrough', isActive: () => editor.isActive('strike'), action: () => editor.chain().focus().toggleStrike().run() },
        { id: 'code', icon: icons.code, title: 'Inline Code', isActive: () => editor.isActive('code'), action: () => editor.chain().focus().toggleCode().run() },
      ]},
    ]);
  });

  // ── List & Block dropdown (≡ ▾) ─────────────────────────────────────────
  const listBlockBtn = makeDropdownTrigger('listBlock', 'Lists & Blocks', icons.ul);
  listBlockBtn.addEventListener('click', () => {
    if (isToolbarDropdownOpen()) { hideToolbarDropdown(); return; }
    showToolbarDropdown(listBlockBtn, [
      { type: 'action', id: 'bulletList', label: 'Bullet List', icon: icons.ul, isActive: () => editor.isActive('bulletList'), action: () => editor.chain().focus().toggleBulletList().run() },
      { type: 'action', id: 'orderedList', label: 'Ordered List', icon: icons.ol, isActive: () => editor.isActive('orderedList'), action: () => editor.chain().focus().toggleOrderedList().run() },
      { type: 'action', id: 'taskList', label: 'Task List', icon: icons.task, isActive: () => editor.isActive('taskList'), action: () => editor.chain().focus().toggleTaskList().run() },
      { type: 'separator' },
      { type: 'action', id: 'blockquote', label: 'Blockquote', icon: icons.quote, isActive: () => editor.isActive('blockquote'), action: () => editor.chain().focus().toggleBlockquote().run() },
      { type: 'action', id: 'codeBlock', label: 'Code Block', icon: icons.codeBlock, isActive: () => editor.isActive('codeBlock'), action: () => editor.chain().focus().toggleCodeBlock().run() },
    ]);
  });

  // ── Link (direct action) ────────────────────────────────────────────────
  const linkBtn = makeBtn('link', 'Insert Link (Cmd+K)', icons.link);
  linkBtn.addEventListener('click', () => showLinkDialog(editor));

  // ── Insert dropdown (Image, Table, HR) ──────────────────────────────────
  const insertBtn = makeDropdownTrigger('insert', 'Insert', icons.image);
  insertBtn.addEventListener('click', () => {
    if (isToolbarDropdownOpen()) { hideToolbarDropdown(); return; }
    showToolbarDropdown(insertBtn, [
      { type: 'action', id: 'image', label: 'Image', icon: icons.image, action: () => showImageInsertDialog(editor) },
      { type: 'action', id: 'table', label: 'Table', icon: icons.table, isActive: () => editor.isActive('table'), action: () => showTableGridPicker(editor, insertBtn) },
      { type: 'action', id: 'hr', label: 'Horizontal Rule', icon: icons.hr, action: () => editor.chain().focus().setHorizontalRule().run() },
    ]);
  });

  // ── Direct action buttons ───────────────────────────────────────────────
  const undoBtn = makeBtn('undo', 'Undo (Cmd+Z)', icons.undo);
  undoBtn.addEventListener('click', () => editor.chain().focus().undo().run());

  const redoBtn = makeBtn('redo', 'Redo (Cmd+Shift+Z)', icons.redo);
  redoBtn.addEventListener('click', () => editor.chain().focus().redo().run());

  const sourceBtn = makeBtn('sourceToggle', 'Toggle Source Mode (Cmd+/)', icons.source);
  sourceBtn.addEventListener('click', () => vscode.postMessage({ type: 'toggleSource' }));

  const diffBtn = makeBtn('diffToggle', 'Toggle Diff Highlighting', icons.diff);
  diffBtn.style.opacity = '0.3';
  diffBtn.style.pointerEvents = 'none';
  diffBtn.addEventListener('click', () => toggleDiffHighlight());

  const viewInBrowserBtn = makeBtn('viewInBrowser', 'View in Browser', icons.browser);
  viewInBrowserBtn.addEventListener('click', () => {
    const el = document.querySelector('.ProseMirror') as HTMLElement | null;
    vscode.postMessage({ type: 'viewInBrowser', html: el?.innerHTML ?? '' });
  });

  const printBtn = makeBtn('print', 'Print / Export as PDF', icons.print);
  printBtn.addEventListener('click', () => {
    const el = document.querySelector('.ProseMirror') as HTMLElement | null;
    vscode.postMessage({ type: 'printDocument', html: el?.innerHTML ?? '' });
  });

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

  const themeBtn = makeBtn('themeToggle', 'Toggle Light/Dark Mode', icons.sun);
  themeBtn.addEventListener('click', () => toggleTheme());

  const settingsBtn = makeBtn('settings', 'Settings', icons.gear);
  settingsBtn.addEventListener('click', () => showSettingsModal());

  // ── Font quick-switcher button ──────────────────────────────────────────
  const fontIcon = toolbarSvg('<text x="3" y="12" font-size="11" font-weight="700" fill="currentColor" stroke="none" font-family="serif">A</text><text x="10" y="12" font-size="8" fill="currentColor" stroke="none" font-family="sans-serif">a</text>', 0);
  const fontBtn = makeBtn('fontPicker', 'Font Theme', fontIcon);
  fontBtn.addEventListener('click', () => {
    // Remove existing dropdown if open
    document.getElementById('mikedown-font-quick-picker')?.remove();

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
    dropdown.id = 'mikedown-font-quick-picker';
    dropdown.style.cssText = 'position:absolute;top:100%;right:0;z-index:1100;background:#252526;border:1px solid rgba(128,128,128,0.3);border-radius:6px;box-shadow:0 6px 20px rgba(0,0,0,0.3);padding:4px;min-width:300px;max-height:400px;overflow-y:auto';

    const currentBody = getComputedStyle(document.documentElement).getPropertyValue('--mikedown-font-family').trim();
    const currentHeading = getComputedStyle(document.documentElement).getPropertyValue('--mikedown-heading-font-family').trim();

    fontThemes.forEach(theme => {
      const isActive = currentBody === theme.body && (currentHeading === theme.heading || (!currentHeading && theme.heading === theme.body));
      const item = document.createElement('div');
      item.style.cssText = `padding:10px 12px;cursor:pointer;border-radius:4px;margin:2px 0;color:${isActive ? '#ffffff' : '#e0e0e0'};background:${isActive ? '#0e639c' : 'transparent'}`;

      // Theme name + description
      const topRow = document.createElement('div');
      topRow.style.cssText = 'display:flex;justify-content:space-between;align-items:baseline;margin-bottom:4px';
      const nameSpan = document.createElement('span');
      nameSpan.textContent = theme.label;
      nameSpan.style.cssText = 'font-size:13px;font-weight:600';
      const descSpan = document.createElement('span');
      descSpan.textContent = theme.desc;
      descSpan.style.cssText = `font-size:11px;color:${isActive ? 'rgba(255,255,255,0.7)' : '#888'}`;
      topRow.appendChild(nameSpan);
      topRow.appendChild(descSpan);

      // Preview: heading sample + body sample
      const preview = document.createElement('div');
      const headingSample = document.createElement('div');
      headingSample.textContent = 'Heading Preview';
      headingSample.style.cssText = `font-family:${theme.heading};font-size:15px;font-weight:600;color:${isActive ? '#ffffff' : '#cccccc'}`;
      const bodySample = document.createElement('div');
      bodySample.textContent = 'Body text looks like this in the editor.';
      bodySample.style.cssText = `font-family:${theme.body};font-size:13px;color:${isActive ? 'rgba(255,255,255,0.8)' : '#999'}`;
      preview.appendChild(headingSample);
      preview.appendChild(bodySample);

      item.appendChild(topRow);
      item.appendChild(preview);

      item.addEventListener('mouseenter', () => {
        if (!isActive) item.style.background = 'rgba(255,255,255,0.08)';
      });
      item.addEventListener('mouseleave', () => {
        if (!isActive) item.style.background = isActive ? '#0e639c' : 'transparent';
      });
      item.addEventListener('click', () => {
        document.documentElement.style.setProperty('--mikedown-font-family', theme.body);
        document.documentElement.style.setProperty('--mikedown-heading-font-family', theme.heading);
        dropdown.remove();
        vscode.postMessage({ type: 'saveSettings', settings: { fontFamily: theme.body, headingFontFamily: theme.heading } });
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

  // ── Assemble ────────────────────────────────────────────────────────────
  toolbar.appendChild(textFormatBtn);
  toolbar.appendChild(listBlockBtn);
  toolbar.appendChild(linkBtn);
  toolbar.appendChild(insertBtn);
  toolbar.appendChild(makeSeparator());
  toolbar.appendChild(undoBtn);
  toolbar.appendChild(redoBtn);
  toolbar.appendChild(makeSeparator());
  toolbar.appendChild(sourceBtn);
  toolbar.appendChild(diffBtn);
  toolbar.appendChild(makeSeparator());
  toolbar.appendChild(viewInBrowserBtn);
  toolbar.appendChild(printBtn);
  toolbar.appendChild(selectAllBtn);
  toolbar.appendChild(makeSeparator());
  toolbar.appendChild(themeBtn);
  toolbar.appendChild(settingsBtn);

  // ── Update dynamic label on selection changes ──────────────────────────
  (toolbar as any).__condensedUpdate = () => {
    // Update the text format button label to reflect current block type
    const labelEl = textFormatBtn.querySelector('.condensed-btn-label');
    if (labelEl) labelEl.innerHTML = getBlockLabel();

    // Highlight dropdown triggers when their children are active
    textFormatBtn.classList.toggle('active', isTextFormatActive());
    listBlockBtn.classList.toggle('active', isBlockActive());
    linkBtn.classList.toggle('active', editor.isActive('link'));

    // Update dropdown active states if one is open
    updateDropdownActiveStates();
  };
}

function updateToolbarState(editor: Editor): void {
  const toolbar = document.getElementById('toolbar');
  if (!toolbar) return;
  const inCodeBlock = editor.isActive('codeBlock');
  toolbar.querySelectorAll('button[data-action]').forEach(el => {
    const btn = el as HTMLButtonElement;
    const action = btn.dataset.action!;
    // Active state
    btn.classList.toggle('active', (() => {
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
    // Disabled state: inline format buttons disabled inside code blocks
    btn.disabled = inCodeBlock && ['bold', 'italic', 'strike', 'code', 'link'].includes(action);
  });
  // Condensed mode: update dynamic labels and dropdown trigger highlights
  if ((toolbar as any).__condensedUpdate) {
    (toolbar as any).__condensedUpdate();
  }
}

// ── M13: Find & Replace Bar ────────────────────────────────────────────────────

function buildFindReplaceBar(editor: Editor): void {
  const bar = document.createElement('div');
  bar.id = 'find-replace-bar';
  bar.style.display = 'none';
  bar.innerHTML = `
    <div class="fr-row">
      <input id="fr-find-input" type="text" placeholder="Find…" autocomplete="off" spellcheck="false" />
      <button id="fr-prev-btn" title="Previous (Shift+Enter)">↑</button>
      <button id="fr-next-btn" title="Next (Enter)">↓</button>
      <span id="fr-match-count" class="fr-count"></span>
      <div class="fr-options">
        <label title="Match Case"><input type="checkbox" id="fr-case" /> Aa</label>
        <label title="Whole Word"><input type="checkbox" id="fr-word" /> |W|</label>
        <label title="Use Regex"><input type="checkbox" id="fr-regex" /> .*</label>
      </div>
      <button id="fr-replace-toggle" title="Toggle replace">≡</button>
      <button id="fr-close-btn" title="Close (Escape)">✕</button>
    </div>
    <div class="fr-row" id="fr-replace-row" style="display:none">
      <input id="fr-replace-input" type="text" placeholder="Replace…" autocomplete="off" spellcheck="false" />
      <button id="fr-replace-btn">Replace</button>
      <button id="fr-replace-all-btn">Replace All</button>
    </div>
  `;
  document.body.appendChild(bar);

  const findInput = document.getElementById('fr-find-input') as HTMLInputElement;
  const replaceInput = document.getElementById('fr-replace-input') as HTMLInputElement;
  const matchCount = document.getElementById('fr-match-count') as HTMLSpanElement;

  function getCurrentOptions() {
    return {
      matchCase: (document.getElementById('fr-case') as HTMLInputElement).checked,
      wholeWord: (document.getElementById('fr-word') as HTMLInputElement).checked,
      useRegex: (document.getElementById('fr-regex') as HTMLInputElement).checked,
    };
  }

  function doSearch() {
    const matches = updateSearch(editor, { query: findInput.value, ...getCurrentOptions() });
    matchCount.textContent = matches.length > 0 ? `${matches.length} match${matches.length === 1 ? '' : 'es'}` : 'No matches';
  }

  findInput.addEventListener('input', doSearch);
  ['fr-case', 'fr-word', 'fr-regex'].forEach(id => {
    document.getElementById(id)?.addEventListener('change', doSearch);
  });

  // Prevent the ↑ / ↓ buttons from stealing focus from the find input on
  // mousedown. Without this, clicking the arrows moves focus to the button,
  // which breaks subsequent Enter / Shift+Enter navigation and can leave the
  // user focused in the toolbar area.
  const nextBtn = document.getElementById('fr-next-btn');
  const prevBtn = document.getElementById('fr-prev-btn');
  nextBtn?.addEventListener('mousedown', (e) => e.preventDefault());
  prevBtn?.addEventListener('mousedown', (e) => e.preventDefault());
  nextBtn?.addEventListener('click', () => {
    if (sourceMode && cmView) {
      // Source mode: CodeMirror has its own built-in find via @codemirror/search
    } else {
      findNext(editor);
    }
  });
  prevBtn?.addEventListener('click', () => findPrev(editor));

  findInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); if (e.shiftKey) findPrev(editor); else findNext(editor); }
    if (e.key === 'Escape') { closeFindBar(); }
  });

  document.getElementById('fr-replace-toggle')?.addEventListener('click', () => {
    const row = document.getElementById('fr-replace-row') as HTMLElement;
    row.style.display = row.style.display === 'none' ? '' : 'none';
  });

  document.getElementById('fr-replace-btn')?.addEventListener('click', () => {
    replaceCurrentMatch(editor, replaceInput.value);
    doSearch();
  });

  document.getElementById('fr-replace-all-btn')?.addEventListener('click', () => {
    const n = replaceAllMatches(editor, replaceInput.value);
    matchCount.textContent = `Replaced ${n}`;
    doSearch();
  });

  document.getElementById('fr-close-btn')?.addEventListener('click', closeFindBar);

  function closeFindBar() {
    bar.style.display = 'none';
    clearSearch(editor);
    matchCount.textContent = '';
    editor.commands.focus();
  }

  // Expose openFindBar to keyboard handler
  (window as any).__mikedownOpenFind = (replace = false) => {
    bar.style.display = '';
    if (replace) {
      (document.getElementById('fr-replace-row') as HTMLElement).style.display = '';
    }
    findInput.focus();
    findInput.select();
    doSearch();
  };
  (window as any).__mikedownCloseFind = closeFindBar;
}

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

// ── TipTap Initialisation ──────────────────────────────────────────────────────

const editorContainer = document.getElementById('editor-container');

// ── M15: Frontmatter UI block renderer ─────────────────────────────────────────
// Declared here (after editorContainer) but only called after `editor` is created.
// The actual function body is defined inside the `else` block where `editor` is in scope.

console.log('MikeDown: about to create TipTap editor, container:', !!editorContainer);
if (!editorContainer) {
  console.error('MikeDown: #editor-container element not found.');
} else {
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
        // Disable the built-in link — we register a standalone Link.configure
        // below with openOnClick: false. Registering both produces a
        // "Duplicate extension names found: ['link']" warning and double-binds
        // ProseMirror plugins/keymaps.
        link: false,
        // M2d: Configure History with grouping delay and stack depth.
        history: { depth: 100, newGroupDelay: 500 },
      }),

      // ── Code Blocks with Syntax Highlighting (M15) ────────────────────────────
      // CodeBlockLowlight extends the base CodeBlock node with lowlight (highlight.js
      // wrapper) for offline syntax highlighting. StarterKit has codeBlock: false,
      // so this extension provides the codeBlock node type without conflict.
      // tiptap-markdown serialises codeBlock nodes as fenced code blocks (```lang).
      CodeBlockLowlight.configure({
        lowlight,
        defaultLanguage: 'plaintext',
        HTMLAttributes: {
          class: 'mikedown-code-block',
        },
      }),

      // ── Task Lists (M2c) ──────────────────────────────────────────────────────
      // "- [ ] " and "- [x] " input rules convert to checkable task list items.
      // TaskItem is configured with nested: true to allow sub-tasks.
      // Auto-continuation (Enter → new item) and list-exit (Enter on empty item
      // → paragraph) are handled natively by ProseMirror's list commands.
      TaskList,
      TaskItem.configure({ nested: true }),

      // ── Tables ────────────────────────────────────────────────────────────────
      Table.configure({ resizable: false }),
      TableRow,
      TableHeader,
      TableCell,

      // ── Links (M2b) ───────────────────────────────────────────────────────────
      // tiptap-markdown handles "[text](url)" syntax via its paste/input rules,
      // converting typed or pasted markdown link syntax to Link marks.
      // openOnClick: false keeps the editor from navigating on Ctrl+click so
      // the user can edit the link text.
      // isAllowedUri: TipTap's default validator has a regex bug where
      // `[a-z+.-:]` treats `.-:` as a range that includes `/`, so relative
      // paths like "Planning/README.md" are rejected and the Link mark is
      // dropped during markdown → HTML → PM parsing. Allow any non-empty URI.
      Link.configure({ openOnClick: false, isAllowedUri: () => true }),

      // ── Images (M2b) ──────────────────────────────────────────────────────────
      // tiptap-markdown handles "![alt](src)" syntax and creates Image nodes.
      Image,

      // ── Placeholder (M2c) ─────────────────────────────────────────────────────
      // "Start writing…" is displayed when the document contains no content.
      // The CSS rule `.ProseMirror p.is-editor-empty:first-child::before` renders
      // this via the data-placeholder attribute injected by the extension.
      Placeholder.configure({ placeholder: 'Start writing…' }),

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
        breaks: false,
        transformPastedText: false,
        transformCopiedText: false,
      }),

      // ── Smart Paste (M12a) ─────────────────────────────────────────────────
      // Intercepts paste events that carry text/html clipboard data, cleans the
      // HTML (strips Word/Google Docs noise, converts style-based bold/italic to
      // semantic elements) and converts it to ProseMirror nodes via PM's own
      // DOMParser. Falls back to tiptap-markdown's built-in paste handling when
      // no HTML data is present or when the payload exceeds 500 KB.
      SmartPasteExtension,

      // ── Find & Replace (M13) ───────────────────────────────────────────────
      // ProseMirror decoration plugin that highlights all search matches in the
      // WYSIWYG view. Keyboard intercept (Cmd+F / Cmd+H) is wired below.
      FindReplaceExtension,

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
    ],
    content: '',

    // ── Keyboard shortcuts ──────────────────────────────────────────────────────
    editorProps: {
      handleKeyDown(view, event) {
        // M13 — Cmd+F / Ctrl+F: Open find bar.
        if ((event.metaKey || event.ctrlKey) && event.key === 'f') {
          event.preventDefault();
          (window as any).__mikedownOpenFind?.(false);
          return true;
        }
        // M13 — Cmd+H / Ctrl+H: Open find & replace bar.
        if ((event.metaKey || event.ctrlKey) && event.key === 'h') {
          event.preventDefault();
          (window as any).__mikedownOpenFind?.(true);
          return true;
        }

        // M3 — Cmd+K / Ctrl+K: Insert/edit link (not inside a table).
        if ((event.metaKey || event.ctrlKey) && event.key === 'k' && !editor.isActive('table')) {
          event.preventDefault();
          showLinkDialog(editor);
          return true;
        }

        // M5a — Table keyboard navigation.
        // Tab/Shift+Tab move between cells. Tab on the last cell of the last row
        // creates a new row. Escape exits the table.
        if (event.key === 'Tab' && editor.isActive('table')) {
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
        if (event.key === 'Tab' && !event.shiftKey) {
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
        if (event.key === 'Tab' && event.shiftKey) {
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

    onUpdate: ({ editor: updatedEditor }) => {
      // Guard: do not send an edit event while we are loading content from the
      // extension host — that would incorrectly mark the document as modified.
      if (isLoading) {
        return;
      }

      // M15 — Re-attach frontmatter when serializing so saved content is complete.
      const body = updatedEditor.storage.markdown.getMarkdown() as string;
      const markdown = restoreFrontmatter(frontmatterContent, body);

      // M2d — Dirty-state detection: compare the current serialized markdown
      // against the original content loaded from disk. This prevents false
      // "unsaved changes" prompts caused by round-trip serialization differences.
      const newDirty = markdown !== originalContent;
      if (newDirty !== isDirty) {
        isDirty = newDirty;
        // Dirty state changed — extension host is implicitly notified via the
        // 'edit' message below (host tracks dirty state through TextDocument).
      }

      vscode.postMessage({ type: 'edit', content: markdown });

      // M2d — Send plain text to status bar (M14 hook: word/character count).
      const plainText = updatedEditor.getText();
      vscode.postMessage({ type: 'stats', plainText });
    },
  });

  // Build condensed toolbar (Apple Notes-style) and wire active-state updates.
  buildCondensedToolbar(editor);
  updateThemeToggleIcon();
  editor.on('selectionUpdate', () => updateToolbarState(editor));
  editor.on('transaction', () => updateToolbarState(editor));


  // M13 — Build find/replace bar and wire global keyboard shortcut.
  buildFindReplaceBar(editor);

  // M5c — Initialize table drag handles and multi-cell selection
  initTableDrag(editor);

  // M10 — Custom context menu: prevent browser default; show custom one.
  editorContainer.addEventListener('contextmenu', (event) => {
    event.preventDefault();
    const target = event.target as HTMLElement;

    let items;
    const linkEl = target.closest<HTMLAnchorElement>('a[href]');
    const tableEl = target.closest('table');
    const imgEl = target.closest<HTMLImageElement>('img');

    if (linkEl) {
      items = buildLinkMenu(editor, linkEl.getAttribute('href') || '');
    } else if (imgEl) {
      items = buildImageMenu(editor, imgEl);
    } else if (tableEl) {
      items = buildTableMenu(editor);
    } else {
      items = buildTextMenu(editor);
    }

    showContextMenu(editor, event.clientX, event.clientY, items);
  });

  // Hide context menu on click elsewhere
  document.addEventListener('mousedown', (event) => {
    if (!(event.target as HTMLElement).closest('#mikedown-context-menu')) {
      hideContextMenu();
    }
    // M5c — Clear multi-cell selection when clicking outside a table
    if (!(event.target as HTMLElement).closest('table')) {
      clearCellSelection();
    }
  });

  // Expose vscode for contextmenu.ts link opening
  (window as any).__vscode = vscode;
  (window as any).__mikedownShowLinkDialog = () => showLinkDialog(editor);
  (window as any).__mikedownShowImageDialog = () => showImageInsertDialog(editor);

  // M5b — Wire table toolbar to selection updates
  editor.on('selectionUpdate', () => {
    updateTableToolbar(editor);
  });
  editor.on('blur', () => {
    // Delay hiding to allow toolbar button clicks to register
    setTimeout(() => {
      if (!document.activeElement?.closest('#mikedown-table-toolbar')) {
        hideTableToolbar();
      }
    }, 150);
  });

  // M5b — Hide grid picker on click outside
  document.addEventListener('mousedown', (event) => {
    if (!(event.target as HTMLElement).closest('#mikedown-table-picker')) {
      hideTableGridPicker();
    }
  });

  // M5b — Expose grid picker hide for contextmenu compatibility
  (window as any).__mikedownHideTablePicker = hideTableGridPicker;

  // M5c — Expose cell selection and drag handle clear functions externally
  (window as any).__mikedownClearCellSelection = clearCellSelection;
  (window as any).__mikedownClearDragHandles = clearDragHandles;

  // M13 — Global keydown listener for Cmd+F / Cmd+H when editor doesn't have focus.
  document.addEventListener('keydown', (event) => {
    if ((event.metaKey || event.ctrlKey) && event.key === 'f') {
      event.preventDefault();
      (window as any).__mikedownOpenFind?.(false);
    } else if ((event.metaKey || event.ctrlKey) && event.key === 'h') {
      event.preventDefault();
      (window as any).__mikedownOpenFind?.(true);
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
  document.addEventListener('keydown', (event) => {
    if (!(event.metaKey || event.ctrlKey)) return;
    if (event.key !== 'a' && event.key !== 'A') return;
    if (sourceMode) return; // CodeMirror has its own selectAll in source mode.

    const target = event.target as HTMLElement | null;
    // Let native Cmd+A run inside form fields (find bar, dialogs).
    if (target) {
      if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA') return;
      // Let native Cmd+A run inside other contenteditable regions (e.g. the
      // frontmatter block), but NOT inside the main ProseMirror editor —
      // that one must go through our TextSelection path below.
      const editorDom = editor.view.dom as HTMLElement;
      if (target.isContentEditable && !editorDom.contains(target)) return;
    }

    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation();
    selectAllDocument(editor);
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
  imagePopover.id = 'image-edit-popover';
  imagePopover.innerHTML = `
  <label>Alt text</label>
  <input id="img-alt" type="text" placeholder="Describe the image">
  <label>Path or URL</label>
  <input id="img-src" type="text" placeholder="./image.png or https://...">
  <div class="popover-actions">
    <button class="secondary" id="img-cancel">Cancel</button>
    <button id="img-ok">Update</button>
  </div>
`;
  document.body.appendChild(imagePopover);

  let editingImagePos: number | null = null;

  if (editorContainer) {
    editorContainer.addEventListener('click', (e) => {
      const target = e.target as HTMLElement;
      if (target.tagName !== 'IMG') { return; }
      const img = target as HTMLImageElement;
      // Get the ProseMirror position of this image node
      const pos = editor.view.posAtDOM(img, 0);
      if (pos < 0) { return; }
      editingImagePos = pos;
      // Populate fields
      (document.getElementById('img-alt') as HTMLInputElement).value = img.alt ?? '';
      (document.getElementById('img-src') as HTMLInputElement).value = img.dataset.originalSrc ?? img.getAttribute('src') ?? '';
      // Position popover near image
      const rect = img.getBoundingClientRect();
      imagePopover.style.display = 'block';
      imagePopover.style.top = `${rect.bottom + 8}px`;
      imagePopover.style.left = `${Math.min(rect.left, window.innerWidth - 300)}px`;
    });
  }

  document.getElementById('img-ok')?.addEventListener('click', () => {
    if (editingImagePos === null) { return; }
    const src = (document.getElementById('img-src') as HTMLInputElement).value;
    const alt = (document.getElementById('img-alt') as HTMLInputElement).value;
    editor.commands.setNodeSelection(editingImagePos);
    editor.commands.updateAttributes('image', { src, alt });
    imagePopover.style.display = 'none';
    editingImagePos = null;
  });

  document.getElementById('img-cancel')?.addEventListener('click', () => {
    imagePopover.style.display = 'none';
    editingImagePos = null;
  });

  // Close popover when clicking outside
  document.addEventListener('click', (e) => {
    if (!imagePopover.contains(e.target as Node) && (e.target as HTMLElement).tagName !== 'IMG') {
      imagePopover.style.display = 'none';
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
    document.querySelectorAll('.ProseMirror a[href]').forEach(el => {
      const href = el.getAttribute('href') || '';
      if (!href || href.startsWith('http://') || href.startsWith('https://')) return;
      if (href.startsWith('#')) {
        links.push({ href, type: 'anchor' });
      } else if (href.includes('#')) {
        links.push({ href, type: 'fileAnchor' });
      } else {
        links.push({ href, type: 'file' });
      }
    });
    if (links.length > 0) {
      vscode.postMessage({ type: 'checkLinks', links });
    }
  }

  // Wire link scan on editor updates (debounced) so heading renames are caught.
  editor.on('update', () => {
    clearTimeout((window as any).__mikedownLinkCheckTimer);
    (window as any).__mikedownLinkCheckTimer = setTimeout(() => {
      scanAndCheckLinks();
    }, 500);
  });

  // ── Active heading tracking (reports scroll position for Document Outline) ──
  {
    const editorContainer = document.querySelector('.ProseMirror')?.parentElement;
    let lastReportedAnchor = '';
    let scrollTimer: number | undefined;

    function reportActiveHeading(): void {
      if (!editorContainer) return;
      const headings = editorContainer.querySelectorAll<HTMLElement>('h1,h2,h3,h4,h5,h6');
      const containerRect = editorContainer.getBoundingClientRect();
      let activeHeading: HTMLElement | null = null;

      for (const h of headings) {
        const rect = h.getBoundingClientRect();
        if (rect.top <= containerRect.top + 50) {
          activeHeading = h;
        } else {
          break;
        }
      }

      // If no heading has scrolled past the top, use the first one
      if (!activeHeading && headings.length > 0) {
        activeHeading = headings[0];
      }

      if (activeHeading) {
        const text = activeHeading.textContent?.trim() || '';
        const anchor = text.toLowerCase().replace(/[^\w\s-]/g, '').replace(/\s+/g, '-').replace(/-+/g, '-');
        if (anchor && anchor !== lastReportedAnchor) {
          lastReportedAnchor = anchor;
          vscode.postMessage({ type: 'activeHeading', anchor });
        }
      }
    }

    if (editorContainer) {
      editorContainer.addEventListener('scroll', () => {
        clearTimeout(scrollTimer);
        scrollTimer = window.setTimeout(reportActiveHeading, 150) as unknown as number;
      });
    }

    // Also report after content loads
    editor.on('update', () => {
      clearTimeout(scrollTimer);
      scrollTimer = window.setTimeout(reportActiveHeading, 300) as unknown as number;
    });
  }

  // ── M6a: Link click handler (Cmd+Click to navigate) ────────────────────────
  // Use mousedown in capture phase so it fires before ProseMirror's own
  // mousedown handler (which would consume the event for cursor placement).
  // This ensures Cmd+Click / Ctrl+Click reliably navigates links.

  let linkClickBehavior: 'navigateCurrentTab' | 'openNewTab' | 'showContextMenu' = 'openNewTab';

  editorContainer.addEventListener('mousedown', (event) => {
    if (!event.metaKey && !event.ctrlKey) return;
    if (event.button !== 0) return; // left-click only

    const target = event.target as HTMLElement;
    const linkEl = target.closest('a[href]') as HTMLAnchorElement | null;
    if (!linkEl) return;

    event.preventDefault();
    event.stopPropagation();

    const href = linkEl.getAttribute('href') || '';

    if (linkClickBehavior === 'showContextMenu') {
      // Show a mini context menu with navigation options
      const items = buildLinkMenu(editor, href);
      showContextMenu(editor, event.clientX, event.clientY, items);
    } else {
      vscode.postMessage({ type: 'openLink', href });
    }
  }, true);

  // ── M6a: Heading anchor icon click handler ──────────────────────────────────

  editorContainer.addEventListener('click', (event) => {
    const target = event.target as HTMLElement;
    const heading = target.closest<HTMLElement>('h1,h2,h3,h4,h5,h6');
    if (!heading) return;

    // Only trigger if click is in the left margin area (before the text)
    const rect = heading.getBoundingClientRect();
    if (event.clientX < rect.left) {
      // Compute anchor ID dynamically from heading text
      const anchorId = computeAnchorIdFor(heading);
      if (anchorId) {
        navigator.clipboard?.writeText(`#${anchorId}`).catch(() => {});
        // Brief visual feedback
        heading.style.outline = '1px solid var(--vscode-focusBorder)';
        setTimeout(() => { heading.style.outline = ''; }, 600);
      }
    }
  });

  // ── M6a: Link tooltip on hover ──────────────────────────────────────────────

  editorContainer.addEventListener('mouseover', (event) => {
    const target = event.target as HTMLElement;
    const linkEl = target.closest<HTMLAnchorElement>('a[href]');
    if (!linkEl) {
      if (linkTooltip) { linkTooltip.style.display = 'none'; }
      return;
    }

    const href = linkEl.getAttribute('href') || '';
    if (!linkTooltip) {
      linkTooltip = document.createElement('div');
      linkTooltip.id = 'link-tooltip';
      document.body.appendChild(linkTooltip);
    }
    const mod = navigator.platform.includes('Mac') ? 'Cmd' : 'Ctrl';
    // M6c — Show broken link tooltip if this link is marked as broken.
    if (linkEl.classList.contains('mikedown-broken-link')) {
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
      if (linkTooltip) linkTooltip.style.display = 'none';
    }
  });

  // ── M6a: Cmd-held class tracking (changes link cursor on hover) ─────────────

  document.addEventListener('keydown', (e) => {
    if (e.metaKey || e.ctrlKey) document.body.classList.add('cmd-held');
  });
  document.addEventListener('keyup', (e) => {
    if (!e.metaKey && !e.ctrlKey) document.body.classList.remove('cmd-held');
  });

  // ── M15: Frontmatter UI block renderer ─────────────────────────────────────

  function renderFrontmatterBlock(): void {
    // Remove existing frontmatter block if any
    const existing = document.getElementById('frontmatter-block');
    if (existing) existing.remove();

    if (!frontmatterContent) return;

    const block = document.createElement('div');
    block.id = 'frontmatter-block';
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
        const body = editor.storage.markdown.getMarkdown() as string;
        const markdown = restoreFrontmatter(frontmatterContent, body);
        vscode.postMessage({ type: 'edit', content: markdown });
      });
      block.appendChild(content);
    }

    // Insert frontmatter block BEFORE the editor container
    const editorEl = document.getElementById('editor-container');
    editorEl?.parentNode?.insertBefore(block, editorEl);
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
    const proseMirrorEl = document.querySelector('.ProseMirror') as HTMLElement | null;
    if (proseMirrorEl) {
      proseMirrorEl.querySelectorAll('.mikedown-diff-changed').forEach(el => {
        el.classList.remove('mikedown-diff-changed');
      });
    }

    if (!diffHighlightActive || !headContent) return;

    // Get current markdown from the editor
    const currentMarkdown = editor.storage.markdown.getMarkdown();
    const changedLines = computeChangedBlocks(headContent, currentMarkdown);

    if (changedLines.size === 0) return;

    // Map changed source lines to top-level ProseMirror nodes.
    // Walk the doc's top-level children and track which markdown lines they span.
    const lines = currentMarkdown.split('\n');
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
          if (child.type.name === 'tableRow') nodeLineCount++;
          return true;
        });
        nodeLineCount += 1; // header separator line
      } else if (node.type.name === 'bulletList' || node.type.name === 'orderedList' || node.type.name === 'taskList') {
        nodeLineCount = 0;
        node.descendants((child) => {
          if (child.type.name === 'listItem' || child.type.name === 'taskItem') nodeLineCount++;
          return true;
        });
      } else if (node.type.name === 'codeBlock') {
        const text = node.textContent;
        nodeLineCount = text.split('\n').length + 2; // +2 for fences
      } else if (node.type.name === 'blockquote') {
        nodeLineCount = 0;
        node.descendants((child) => {
          if (child.isTextblock) nodeLineCount++;
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

  function toggleDiffHighlight(): void {
    if (!fileHasGitChanges) return;

    diffHighlightActive = !diffHighlightActive;

    if (diffHighlightActive && !headContent) {
      // Request HEAD content from extension host
      vscode.postMessage({ type: 'requestDiff' });
    } else {
      applyDiffDecorations();
    }

    // Update toolbar button active state
    const btn = document.querySelector('button[data-action="diffToggle"]') as HTMLButtonElement | null;
    if (btn) {
      btn.classList.toggle('is-active', diffHighlightActive);
    }
  }

  // ── M4: CodeMirror source editor ───────────────────────────────────────────

  const sourceContainer = document.getElementById('source-container') as HTMLElement;

  function buildCmTheme(): EditorView.Theme {
    // Read VS Code CSS variables for theming
    const computedStyle = getComputedStyle(document.body);
    const bg = computedStyle.getPropertyValue('--vscode-editor-background').trim() || '#1e1e1e';
    const fg = computedStyle.getPropertyValue('--vscode-editor-foreground').trim() || '#d4d4d4';
    const selBg = computedStyle.getPropertyValue('--vscode-editor-selectionBackground').trim() || '#264f78';
    const isLight = document.body.classList.contains('mikedown-force-light');
    const activeLine = computedStyle.getPropertyValue('--vscode-editor-lineHighlightBackground').trim()
      || (isLight ? 'rgba(0,0,0,0.06)' : 'rgba(255,255,255,0.1)');
    const gutterFg = computedStyle.getPropertyValue('--vscode-editorLineNumber-foreground').trim() || '#858585';

    return EditorView.theme({
      '&': { backgroundColor: bg, color: fg, height: '100%' },
      '.cm-scroller': { fontFamily: 'var(--vscode-editor-font-family, monospace)', overflow: 'auto', height: '100%' },
      '.cm-content': { padding: '8px 0' },
      '&.cm-focused .cm-selectionBackground, .cm-selectionBackground': { backgroundColor: selBg },
      '.cm-activeLine': { backgroundColor: activeLine },
      '.cm-gutters': { backgroundColor: bg, color: gutterFg, border: 'none' },
    }, { dark: !isLight });
  }

  function initCmView(): EditorView {
    const state = EditorState.create({
      doc: '',
      extensions: [
        history(),
        keymap.of([...defaultKeymap, ...historyKeymap]),
        lineNumbers(),
        highlightActiveLine(),
        cmMarkdown({ base: markdownLanguage }),
        syntaxHighlighting(document.body.classList.contains('mikedown-force-light') ? defaultHighlightStyle : oneDarkHighlightStyle),
        buildCmTheme(),
        EditorView.lineWrapping,
        EditorView.updateListener.of((update) => {
          if (!update.docChanged) return;
          if (cmLoading) return;
          const md = update.state.doc.toString();
          const newDirty = md !== originalContent;
          if (newDirty !== isDirty) isDirty = newDirty;
          vscode.postMessage({ type: 'edit', content: md });
          vscode.postMessage({ type: 'stats', plainText: md });
        }),
      ],
    });
    return new EditorView({ state, parent: sourceContainer });
  }

  function switchToSource(): void {
    if (sourceMode) return;

    // Serialize TipTap content (re-attach frontmatter for complete markdown)
    const body = editor.storage.markdown.getMarkdown() as string;
    const md = restoreFrontmatter(frontmatterContent, body);

    // Record scroll percentage before hiding
    const editorEl = document.getElementById('editor-container') as HTMLElement;
    const scrollPct = editorEl.scrollTop / (editorEl.scrollHeight || 1);

    // Init CodeMirror view lazily
    if (!cmView) {
      cmView = initCmView();
    }

    // Set content in CodeMirror
    cmLoading = true;
    cmView.dispatch({
      changes: { from: 0, to: cmView.state.doc.length, insert: md },
    });
    cmLoading = false;

    // Attempt cursor position mapping (character offset → CodeMirror position)
    try {
      const { from } = editor.state.selection.main;
      const textBefore = editor.state.doc.textBetween(0, from, '\n');
      const cmPos = Math.min(textBefore.length, cmView.state.doc.length);
      cmView.dispatch({ selection: { anchor: cmPos } });
    } catch (_) { /* ignore cursor mapping errors */ }

    // Restore approximate scroll position
    setTimeout(() => {
      const scroller = cmView!.scrollDOM;
      scroller.scrollTop = scrollPct * scroller.scrollHeight;
    }, 10);

    // Show source, hide WYSIWYG
    editorEl.style.display = 'none';
    sourceContainer.style.display = 'block';
    sourceMode = true;

    // Update toolbar: disable formatting buttons, keep source toggle active
    document.querySelectorAll<HTMLButtonElement>('#toolbar button[data-action]').forEach(btn => {
      const action = btn.dataset.action;
      if (action === 'sourceToggle') {
        btn.classList.add('active');
      } else if (action !== 'undo' && action !== 'redo') {
        btn.disabled = true;
      }
    });

    cmView.focus();
  }

  function switchToWysiwyg(): void {
    if (!sourceMode || !cmView) return;

    const md = cmView.state.doc.toString();

    // Record scroll percentage
    const scroller = cmView.scrollDOM;
    const scrollPct = scroller.scrollTop / (scroller.scrollHeight || 1);

    // Extract frontmatter from source content
    const { frontmatter, body } = extractFrontmatter(md);
    frontmatterContent = frontmatter;

    // Load content into TipTap (use isLoading to prevent dirty flag)
    isLoading = true;
    originalContent = md; // reset baseline to avoid false dirty
    editor.commands.setContent(body);
    isLoading = false;

    // Show WYSIWYG, hide source
    const editorEl = document.getElementById('editor-container') as HTMLElement;
    sourceContainer.style.display = 'none';
    editorEl.style.display = '';
    sourceMode = false;

    // Restore approximate scroll position
    setTimeout(() => {
      editorEl.scrollTop = scrollPct * editorEl.scrollHeight;
    }, 10);

    // Re-enable toolbar buttons
    document.querySelectorAll<HTMLButtonElement>('#toolbar button[data-action]').forEach(btn => {
      btn.disabled = false;
      if (btn.dataset.action === 'sourceToggle') {
        btn.classList.remove('active');
      }
    });

    // Re-render frontmatter block in case it changed
    renderFrontmatterBlock();

    updateToolbarState(editor);
    editor.commands.focus();
  }

  // ── Message Handling — Extension → Webview ─────────────────────────────────

  window.addEventListener('message', (event: MessageEvent) => {
    const message = event.data as {
      type: string;
      content?: string;
      fontFamily?: string;
      fontSize?: number;
      command?: string;
    };

    if (message.type === 'theme') {
      document.documentElement.style.setProperty(
        '--mikedown-font-family', message.fontFamily || ''
      );
      document.documentElement.style.setProperty(
        '--mikedown-heading-font-family', (message as any).headingFontFamily || ''
      );
      document.documentElement.style.setProperty(
        '--mikedown-font-size', `${message.fontSize || 17}px`
      );
    }

    // Receive user-facing settings from the extension host.
    if (message.type === 'settings') {
      const msg = message as any;
      if (msg.linkClickBehavior) {
        linkClickBehavior = msg.linkClickBehavior;
      }
      if (msg.themeToggleScope) {
        themeToggleScope = msg.themeToggleScope;
      }
      if (msg.editorTheme) {
        applyEditorTheme(msg.editorTheme);
      }
    }

    // Handle diff status updates from the extension host
    if (message.type === 'diffStatus') {
      const msg = message as any;
      fileHasGitChanges = msg.hasChanges;
      const btn = document.querySelector('button[data-action="diffToggle"]') as HTMLButtonElement | null;
      if (btn) {
        btn.style.opacity = fileHasGitChanges ? '1' : '0.3';
        btn.style.pointerEvents = fileHasGitChanges ? 'auto' : 'none';
      }
    }

    // Handle diff data (HEAD content) from the extension host
    if (message.type === 'diffData') {
      const msg = message as any;
      headContent = msg.headContent;
      fileHasGitChanges = msg.hasChanges;
      const btn = document.querySelector('button[data-action="diffToggle"]') as HTMLButtonElement | null;
      if (btn) {
        btn.style.opacity = fileHasGitChanges ? '1' : '0.3';
        btn.style.pointerEvents = fileHasGitChanges ? 'auto' : 'none';
      }
      if (diffHighlightActive) {
        applyDiffDecorations();
      }
    }

    // M3 — Handle formatting commands posted from the extension host
    // (triggered by VS Code keybindings registered in package.json).
    if (message.type === 'command') {
      switch (message.command) {
        case 'toggleBold': editor.chain().focus().toggleBold().run(); break;
        case 'toggleItalic': editor.chain().focus().toggleItalic().run(); break;
        case 'toggleStrike': editor.chain().focus().toggleStrike().run(); break;
        case 'toggleCode': editor.chain().focus().toggleCode().run(); break;
        case 'undo': editor.chain().focus().undo().run(); break;
        case 'redo': editor.chain().focus().redo().run(); break;
        case 'toggleSource':
          if (sourceMode) { switchToWysiwyg(); } else { switchToSource(); }
          break;
      }
    }

    // M4 — Handle toggleSource message (forwarded from extension host or toolbar button)
    if (message.type === 'toggleSource') {
      if (sourceMode) {
        switchToWysiwyg();
      } else {
        switchToSource();
      }
    }

    if (message.type === 'update') {
      // M2d — Load content from disk and establish the originalContent baseline.
      // isLoading prevents the onUpdate handler from echoing this back as an
      // 'edit' message, which would incorrectly mark the document as dirty.
      isLoading = true;
      originalContent = message.content ?? '';

      // M15 — Extract frontmatter before passing body to TipTap.
      const { frontmatter, body } = extractFrontmatter(originalContent);
      frontmatterContent = frontmatter;

      editor.commands.setContent(body);

      // M2d — After TipTap parses and re-sets the content, immediately serialize
      // back to check for round-trip fidelity. If the serialized form differs from
      // the original, log a warning but continue using originalContent as the
      // dirty-detection baseline so the document is not marked as modified on open.
      const reserialized = restoreFrontmatter(frontmatterContent, editor.storage.markdown.getMarkdown() as string);
      if (reserialized !== originalContent) {
        console.warn(
          'MikeDown: serialization round-trip mismatch — using original as baseline'
        );
        // Still use originalContent as baseline, not the reserialized version.
      }

      isDirty = false;
      isLoading = false;

      // Mirror external updates into CodeMirror when source mode is active.
      if (sourceMode && cmView) {
        cmLoading = true;
        cmView.dispatch({
          changes: { from: 0, to: cmView.state.doc.length, insert: originalContent },
        });
        cmLoading = false;
      }

      // M15 — Render frontmatter UI block (collapsed by default above editor).
      renderFrontmatterBlock();

      // M6c — Trigger broken link check after content loads (debounced 500ms).
      clearTimeout((window as any).__mikedownLinkCheckTimer);
      (window as any).__mikedownLinkCheckTimer = setTimeout(() => {
        scanAndCheckLinks();
      }, 500);

      // M2d — Send initial stats to status bar (M14 hook).
      const plainText = editor.getText();
      vscode.postMessage({ type: 'stats', plainText });
    }

    // M11 — Export: get rendered HTML from the editor DOM and send to extension host.
    if (message.type === 'requestExportHtml') {
      const editorEl = document.querySelector('.ProseMirror') as HTMLElement;
      if (editorEl) {
        vscode.postMessage({ type: 'exportHtml', html: editorEl.innerHTML });
      }
    }

    // View in Browser: get rendered HTML from the editor DOM and send to host.
    if (message.type === 'requestViewInBrowser') {
      const editorEl = document.querySelector('.ProseMirror') as HTMLElement;
      if (editorEl) {
        vscode.postMessage({ type: 'viewInBrowser', html: editorEl.innerHTML });
      }
    }

    // Print: VS Code webviews are sandboxed and cannot call window.print()
    // directly, so we hand the rendered HTML to the host which opens it in
    // the system browser with an auto-print script.
    if (message.type === 'requestPrint') {
      const editorEl = document.querySelector('.ProseMirror') as HTMLElement;
      if (editorEl) {
        vscode.postMessage({ type: 'printDocument', html: editorEl.innerHTML });
      }
    }

    // M11 — Copy as rich text: write HTML + plain text to clipboard.
    if (message.type === 'copyAsRichText') {
      const editorEl2 = document.querySelector('.ProseMirror') as HTMLElement;
      if (editorEl2 && navigator.clipboard) {
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
    }

    // M6a — Scroll to an anchor in the editor (posted from openLink handler for # links).
    if (message.type === 'scrollToAnchor') {
      const anchor = (message as any).anchor as string;
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
        targetEl.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
    }

    // M6b — Link autocomplete: receive workspace file suggestions from host.
    if (message.type === 'linkSuggestions') {
      receiveSuggestions((message as any).suggestions);
    }

    // M6b — Link autocomplete: receive heading anchors for a specific file.
    if (message.type === 'fileHeadings') {
      receiveFileHeadings((message as any).anchors);
    }

    // M6c — Broken link indicator: apply/remove CSS class to broken links.
    if (message.type === 'brokenLinks') {
      // Remove old broken link classes
      document.querySelectorAll('.mikedown-broken-link').forEach(el => {
        el.classList.remove('mikedown-broken-link');
        (el as HTMLElement).title = '';
      });
      // Apply broken link class to matching anchors
      const brokenSet = new Set<string>((message as any).hrefs || []);
      document.querySelectorAll('.ProseMirror a[href]').forEach(el => {
        const href = el.getAttribute('href') || '';
        if (brokenSet.has(href)) {
          el.classList.add('mikedown-broken-link');
          (el as HTMLElement).title = `Broken link: ${href}`;
        }
      });
    }
  });

  // ── Signal readiness to the extension host ─────────────────────────────────

  // The provider listens for this message and responds with the current
  // document content via an 'update' message.
  vscode.postMessage({ type: 'ready' });
}
