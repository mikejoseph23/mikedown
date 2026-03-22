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
import StarterKit from '@tiptap/starter-kit';
import TaskList from '@tiptap/extension-task-list';
import TaskItem from '@tiptap/extension-task-item';
import Table from '@tiptap/extension-table';
import TableRow from '@tiptap/extension-table-row';
import TableHeader from '@tiptap/extension-table-header';
import TableCell from '@tiptap/extension-table-cell';
import Link from '@tiptap/extension-link';
import Image from '@tiptap/extension-image';
import Placeholder from '@tiptap/extension-placeholder';
import { Markdown } from 'tiptap-markdown';
import { CodeBlockLowlight } from '@tiptap/extension-code-block-lowlight';
import { createLowlight, all } from 'lowlight';
import { SmartPasteExtension } from './smartpaste';
import {
  FindReplaceExtension, updateSearch, clearSearch, findNext, findPrev,
  replaceCurrentMatch, replaceAllMatches
} from './findreplace';
import { showContextMenu, hideContextMenu, buildTextMenu, buildLinkMenu, buildTableMenu, buildImageMenu } from './contextmenu';
import { showTableGridPicker, hideTableGridPicker, updateTableToolbar, hideTableToolbar } from './tablepicker';
import { initTableDrag, clearCellSelection, clearDragHandles } from './tabledrag';
import { initLinkAutocomplete, receiveSuggestions, receiveFileHeadings, destroyLinkAutocomplete } from './linkautocomplete';

// ── CodeMirror 6 — Source Mode (M4) ───────────────────────────────────────────
import { EditorState } from '@codemirror/state';
import { EditorView, keymap, lineNumbers, highlightActiveLine } from '@codemirror/view';
import { defaultKeymap, historyKeymap, history } from '@codemirror/commands';
import { markdown as cmMarkdown, markdownLanguage } from '@codemirror/lang-markdown';
import { syntaxHighlighting, defaultHighlightStyle } from '@codemirror/language';

const lowlight = createLowlight(all);

// ── VS Code Webview API ────────────────────────────────────────────────────────

declare const acquireVsCodeApi: () => {
  postMessage: (msg: unknown) => void;
  getState: () => unknown;
  setState: (state: unknown) => void;
};

const vscode = acquireVsCodeApi();

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

// ── M6a: Link tooltip state ────────────────────────────────────────────────────

let linkTooltip: HTMLDivElement | null = null;

/**
 * Timer handle for debouncing anchor ID updates after editor transactions.
 */
let anchorUpdateTimer: ReturnType<typeof setTimeout> | undefined;

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
    'min-width:360px',
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

  // Wire autocomplete
  initLinkAutocomplete(urlInput, (href) => {
    urlInput.value = href;
  });

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
    if (e.key === 'Enter') { e.preventDefault(); confirm(); }
    if (e.key === 'Escape') { cleanup(); editor.commands.focus(); }
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

  // SVG icon helpers — 16×16 inline SVGs that match VS Code's icon style
  const svg = (d: string, sw = 1.8) => `<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="${sw}" stroke-linecap="round" stroke-linejoin="round">${d}</svg>`;
  const icons = {
    bold: svg('<path d="M4 2.5h5a3 3 0 0 1 0 6H4zM4 8.5h6a3 3 0 0 1 0 6H4z" fill="none"/>', 2),
    italic: svg('<line x1="10" y1="2" x2="6" y2="14"/><line x1="7" y1="2" x2="12" y2="2"/><line x1="4" y1="14" x2="9" y2="14"/>'),
    strike: svg('<line x1="2" y1="8" x2="14" y2="8"/><path d="M10.5 3H6.5a2.5 2.5 0 0 0 0 5h3a2.5 2.5 0 0 1 0 5H5"/>'),
    code: svg('<polyline points="5 4 2 8 5 12"/><polyline points="11 4 14 8 11 12"/>'),
    ul: svg('<line x1="6" y1="4" x2="14" y2="4"/><line x1="6" y1="8" x2="14" y2="8"/><line x1="6" y1="12" x2="14" y2="12"/><circle cx="3" cy="4" r="1" fill="currentColor" stroke="none"/><circle cx="3" cy="8" r="1" fill="currentColor" stroke="none"/><circle cx="3" cy="12" r="1" fill="currentColor" stroke="none"/>'),
    ol: svg('<line x1="6" y1="4" x2="14" y2="4"/><line x1="6" y1="8" x2="14" y2="8"/><line x1="6" y1="12" x2="14" y2="12"/><text x="2" y="5.5" font-size="5" fill="currentColor" stroke="none" font-family="sans-serif">1</text><text x="2" y="9.5" font-size="5" fill="currentColor" stroke="none" font-family="sans-serif">2</text><text x="2" y="13.5" font-size="5" fill="currentColor" stroke="none" font-family="sans-serif">3</text>'),
    task: svg('<rect x="2" y="4" width="5" height="5" rx="1"/><polyline points="3.5 6.5 4.5 7.5 6 5.5"/><line x1="9" y1="5" x2="14" y2="5"/><line x1="9" y1="9" x2="14" y2="9"/><line x1="9" y1="13" x2="12" y2="13"/>'),
    quote: svg('<line x1="3" y1="3" x2="3" y2="13"/><line x1="6" y1="5" x2="13" y2="5"/><line x1="6" y1="8" x2="13" y2="8"/><line x1="6" y1="11" x2="10" y2="11"/>'),
    codeBlock: svg('<rect x="2" y="2" width="12" height="12" rx="2"/><polyline points="5.5 5.5 4 8 5.5 10.5"/><polyline points="10.5 5.5 12 8 10.5 10.5"/>'),
    link: svg('<path d="M7 9l2-2m-1.5 3.5L9 9m-2.5-2L5 8.5"/><path d="M9.5 5.5l1-1a2 2 0 0 1 2.83 2.83l-1 1"/><path d="M6.5 10.5l-1 1a2 2 0 0 1-2.83-2.83l1-1"/>'),
    image: svg('<rect x="2" y="3" width="12" height="10" rx="1.5"/><circle cx="5.5" cy="6.5" r="1.2" fill="currentColor" stroke="none"/><polyline points="14 10.5 10.5 7 6 11.5 4.5 10 2 12.5"/>'),
    table: svg('<rect x="2" y="2" width="12" height="12" rx="1.5"/><line x1="2" y1="6" x2="14" y2="6"/><line x1="2" y1="10" x2="14" y2="10"/><line x1="6" y1="2" x2="6" y2="14"/><line x1="10" y1="2" x2="10" y2="14"/>'),
    hr: svg('<line x1="2" y1="8" x2="14" y2="8"/><circle cx="5" cy="8" r="0.5" fill="currentColor" stroke="none"/><circle cx="8" cy="8" r="0.5" fill="currentColor" stroke="none"/><circle cx="11" cy="8" r="0.5" fill="currentColor" stroke="none"/>'),
    undo: svg('<polyline points="4 7 2 5 4 3"/><path d="M2 5h8a4 4 0 0 1 0 8H7"/>'),
    redo: svg('<polyline points="12 7 14 5 12 3"/><path d="M14 5H6a4 4 0 0 0 0 8h3"/>'),
    source: svg('<polyline points="5 4 2 8 5 12"/><polyline points="11 4 14 8 11 12"/><line x1="9" y1="3" x2="7" y2="13"/>'),
  };

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
  ];

  toolbar.innerHTML = buttons.map(btn => {
    if ((btn as { separator?: boolean }).separator) {
      return '<div class="toolbar-separator" role="separator"></div>';
    }
    const b = btn as { id: string; title: string; icon: string };
    return `<button data-action="${b.id}" title="${b.title}" aria-label="${b.title}" tabindex="0">${b.icon}</button>`;
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

  document.getElementById('fr-next-btn')?.addEventListener('click', () => {
    if (sourceMode && cmView) {
      // Source mode: CodeMirror has its own built-in find via @codemirror/search
    } else {
      findNext(editor);
    }
  });
  document.getElementById('fr-prev-btn')?.addEventListener('click', () => findPrev(editor));

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

// ── TipTap Initialisation ──────────────────────────────────────────────────────

const editorContainer = document.getElementById('editor-container');

// ── M15: Frontmatter UI block renderer ─────────────────────────────────────────
// Declared here (after editorContainer) but only called after `editor` is created.
// The actual function body is defined inside the `else` block where `editor` is in scope.

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
      Link.configure({ openOnClick: false }),

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

  // M3 — Build toolbar and wire active-state updates.
  buildToolbar(editor);
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

  /**
   * Scan editor DOM and assign data-anchor-id attributes to all headings
   * using GitHub-style anchor ID generation with collision deduplication.
   */
  function updateHeadingAnchors(): void {
    const seenIds = new Map<string, number>();
    const headings = editorContainer.querySelectorAll<HTMLElement>('h1,h2,h3,h4,h5,h6');
    headings.forEach(h => {
      const base = githubAnchorId(h.textContent || '');
      const count = seenIds.get(base) ?? 0;
      const id = count === 0 ? base : `${base}-${count}`;
      seenIds.set(base, count + 1);
      h.dataset.anchorId = id;
    });
  }

  // Debounced anchor update on every TipTap transaction.
  editor.on('transaction', () => {
    clearTimeout(anchorUpdateTimer);
    anchorUpdateTimer = setTimeout(updateHeadingAnchors, 300);
  });

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

  // ── M6a: Link click handler (Cmd+Click to navigate) ────────────────────────

  editorContainer.addEventListener('click', (event) => {
    const target = event.target as HTMLElement;
    const linkEl = target.closest('a[href]') as HTMLAnchorElement | null;
    if (!linkEl) return;

    // Regular click → position cursor (let ProseMirror handle it, do NOT navigate)
    if (!event.metaKey && !event.ctrlKey) return;

    // Cmd+Click or Ctrl+Click → navigate
    event.preventDefault();
    event.stopPropagation();

    const href = linkEl.getAttribute('href') || '';
    vscode.postMessage({ type: 'openLink', href });
  });

  // ── M6a: Heading anchor icon click handler ──────────────────────────────────

  editorContainer.addEventListener('click', (event) => {
    const target = event.target as HTMLElement;
    const heading = target.closest<HTMLElement>('h1,h2,h3,h4,h5,h6');
    if (!heading || !heading.dataset.anchorId) return;

    // Only trigger if click is in the left margin area (before the text)
    const rect = heading.getBoundingClientRect();
    if (event.clientX < rect.left) {
      const anchorId = heading.dataset.anchorId;
      navigator.clipboard?.writeText(`#${anchorId}`).catch(() => {});
      // Brief visual feedback
      heading.style.outline = '1px solid var(--vscode-focusBorder)';
      setTimeout(() => { heading.style.outline = ''; }, 600);
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
    // M6c — Show broken link tooltip if this link is marked as broken.
    if (linkEl.classList.contains('mikedown-broken-link')) {
      linkTooltip.textContent = linkEl.title || `Broken link: ${href}`;
    } else {
      linkTooltip.textContent = href;
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

  // ── M4: CodeMirror source editor ───────────────────────────────────────────

  const sourceContainer = document.getElementById('source-container') as HTMLElement;

  function buildCmTheme(): EditorView.Theme {
    // Read VS Code CSS variables for theming
    const computedStyle = getComputedStyle(document.body);
    const bg = computedStyle.getPropertyValue('--vscode-editor-background').trim() || '#1e1e1e';
    const fg = computedStyle.getPropertyValue('--vscode-editor-foreground').trim() || '#d4d4d4';
    const selBg = computedStyle.getPropertyValue('--vscode-editor-selectionBackground').trim() || '#264f78';
    const activeLine = computedStyle.getPropertyValue('--vscode-editor-lineHighlightBackground').trim() || 'rgba(255,255,255,0.04)';
    const gutterFg = computedStyle.getPropertyValue('--vscode-editorLineNumber-foreground').trim() || '#858585';

    return EditorView.theme({
      '&': { backgroundColor: bg, color: fg, height: '100%' },
      '.cm-scroller': { fontFamily: 'var(--vscode-editor-font-family, monospace)', overflow: 'auto', height: '100%' },
      '.cm-content': { padding: '8px 0' },
      '&.cm-focused .cm-selectionBackground, .cm-selectionBackground': { backgroundColor: selBg },
      '.cm-activeLine': { backgroundColor: activeLine },
      '.cm-gutters': { backgroundColor: bg, color: gutterFg, border: 'none' },
    }, { dark: true });
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
        syntaxHighlighting(defaultHighlightStyle),
        buildCmTheme(),
        EditorView.lineWrapping,
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
    cmView.dispatch({
      changes: { from: 0, to: cmView.state.doc.length, insert: md },
    });

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
        '--mikedown-font-size', `${message.fontSize || 16}px`
      );
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

      // M15 — Render frontmatter UI block (collapsed by default above editor).
      renderFrontmatterBlock();

      // M6a — Update heading anchor IDs after content is loaded.
      updateHeadingAnchors();

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

    // M11 — Print: trigger the system print dialog (user can save as PDF).
    if (message.type === 'triggerPrint') {
      window.print();
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
      const anchor = message.anchor as string;
      // Find the heading element with matching data-anchor-id
      const el = document.querySelector(`[data-anchor-id="${CSS.escape(anchor)}"]`);
      if (el) {
        el.scrollIntoView({ behavior: 'smooth', block: 'start' });
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
