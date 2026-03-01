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

// ── M3: Link and image dialog helpers ─────────────────────────────────────────

function showLinkDialog(editor: Editor): void {
  const existing = editor.getAttributes('link').href as string | undefined;
  const url = window.prompt('Link URL:', existing ?? 'https://');
  if (url === null) return; // cancelled
  if (url === '') {
    editor.chain().focus().unsetLink().run();
  } else {
    editor.chain().focus().setLink({ href: url }).run();
  }
}

function showImageInsertDialog(editor: Editor): void {
  const src = window.prompt('Image path or URL:');
  if (!src) return;
  const alt = window.prompt('Alt text (optional):', '') ?? '';
  editor.chain().focus().setImage({ src, alt }).run();
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

  const buttons: ToolbarButtonDef[] = [
    { id: 'bold', title: 'Bold (Cmd+B)', icon: '<b>B</b>', action: () => editor.chain().focus().toggleBold().run(), isActive: () => editor.isActive('bold') },
    { id: 'italic', title: 'Italic (Cmd+I)', icon: '<i>I</i>', action: () => editor.chain().focus().toggleItalic().run(), isActive: () => editor.isActive('italic') },
    { id: 'strike', title: 'Strikethrough', icon: '<s>S</s>', action: () => editor.chain().focus().toggleStrike().run(), isActive: () => editor.isActive('strike') },
    { id: 'code', title: 'Inline Code', icon: '<code>&lt;/&gt;</code>', action: () => editor.chain().focus().toggleCode().run(), isActive: () => editor.isActive('code') },
    { separator: true },
    { id: 'h1', title: 'Heading 1', icon: 'H1', action: () => editor.chain().focus().toggleHeading({ level: 1 }).run(), isActive: () => editor.isActive('heading', { level: 1 }) },
    { id: 'h2', title: 'Heading 2', icon: 'H2', action: () => editor.chain().focus().toggleHeading({ level: 2 }).run(), isActive: () => editor.isActive('heading', { level: 2 }) },
    { id: 'h3', title: 'Heading 3', icon: 'H3', action: () => editor.chain().focus().toggleHeading({ level: 3 }).run(), isActive: () => editor.isActive('heading', { level: 3 }) },
    { separator: true },
    { id: 'bulletList', title: 'Bullet List', icon: '&bull; List', action: () => editor.chain().focus().toggleBulletList().run(), isActive: () => editor.isActive('bulletList') },
    { id: 'orderedList', title: 'Ordered List', icon: '1. List', action: () => editor.chain().focus().toggleOrderedList().run(), isActive: () => editor.isActive('orderedList') },
    { id: 'taskList', title: 'Task List', icon: '&#9744; List', action: () => editor.chain().focus().toggleTaskList().run(), isActive: () => editor.isActive('taskList') },
    { id: 'blockquote', title: 'Blockquote', icon: '&#10077;', action: () => editor.chain().focus().toggleBlockquote().run(), isActive: () => editor.isActive('blockquote') },
    { id: 'codeBlock', title: 'Code Block', icon: '{ }', action: () => editor.chain().focus().toggleCodeBlock().run(), isActive: () => editor.isActive('codeBlock') },
    { separator: true },
    { id: 'link', title: 'Insert Link (Cmd+K)', icon: '&#128279;', action: () => showLinkDialog(editor), isActive: () => editor.isActive('link') },
    { id: 'image', title: 'Insert Image', icon: '&#128444;', action: () => showImageInsertDialog(editor), isActive: () => false },
    { id: 'table', title: 'Insert Table', icon: '&#8862;', action: () => editor.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run(), isActive: () => editor.isActive('table') },
    { id: 'hr', title: 'Horizontal Rule', icon: '&mdash;', action: () => editor.chain().focus().setHorizontalRule().run(), isActive: () => false },
    { separator: true },
    { id: 'undo', title: 'Undo (Cmd+Z)', icon: '&#8617;', action: () => editor.chain().focus().undo().run(), isActive: () => false },
    { id: 'redo', title: 'Redo (Cmd+Shift+Z)', icon: '&#8618;', action: () => editor.chain().focus().redo().run(), isActive: () => false },
    { separator: true },
    { id: 'sourceToggle', title: 'Toggle Source Mode (Cmd+/)', icon: '&lt;/&gt; Source', action: () => vscode.postMessage({ type: 'toggleSource' }), isActive: () => false },
  ];

  toolbar.innerHTML = buttons.map(btn => {
    if ((btn as { separator?: boolean }).separator) {
      return '<div class="toolbar-separator"></div>';
    }
    const b = btn as { id: string; title: string; icon: string };
    return `<button data-action="${b.id}" title="${b.title}" aria-label="${b.title}">${b.icon}</button>`;
  }).join('');

  // Wire click handlers
  toolbar.addEventListener('click', (e) => {
    const target = (e.target as HTMLElement).closest('button[data-action]') as HTMLButtonElement | null;
    if (!target) return;
    const btn = buttons.find(b => !('separator' in b) && (b as { id: string }).id === target.dataset.action);
    if (btn && 'action' in btn) btn.action();
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
    ],
    content: '',

    // ── Keyboard shortcuts ──────────────────────────────────────────────────────
    editorProps: {
      handleKeyDown(view, event) {
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
    header.innerHTML = `<span class="frontmatter-icon">${frontmatterExpanded ? '▼' : '▶'}</span> <span class="frontmatter-label">Frontmatter</span>`;
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

      // M2d — Send initial stats to status bar (M14 hook).
      const plainText = editor.getText();
      vscode.postMessage({ type: 'stats', plainText });
    }
  });

  // ── Signal readiness to the extension host ─────────────────────────────────

  // The provider listens for this message and responds with the current
  // document content via an 'update' message.
  vscode.postMessage({ type: 'ready' });
}
