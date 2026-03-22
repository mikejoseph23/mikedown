# Resume Prompt — MikeDown Editor

Paste this into a new Claude Code window to resume.

---

```
Read and follow the instructions in .orchestrator/prompts/ if needed, but first read this context.

## Project State

All 28 milestones of MikeDown Editor are COMPLETE. A full frontend redesign was done on 2026-03-22 (uncommitted).

Project directory: /Users/michaeljosephwork/git/markdown-WYSIWYG-vscode-extension/

The extension is a Typora-style WYSIWYG Markdown editor for VS Code (v0.1.0), built on TipTap v2 + ProseMirror, with CodeMirror 6 for source mode. It is fully offline, uses the VS Code Custom Editor API, and targets GFM spec.

## What's Built

Every feature is implemented and committed:
- WYSIWYG editing with full GFM support (TipTap v2 + tiptap-markdown)
- 21-button toolbar with SVG icons and keyboard shortcuts
- Source mode toggle (CodeMirror 6, Cmd+/)
- Smart paste (Google Docs, Word, Slack, web → clean Markdown)
- Find & Replace (ProseMirror decoration plugin, regex/case/whole-word)
- Context menu with keyboard shortcut hints (right-click for text/link/table/image)
- Table grid picker + contextual table toolbar (SVG icons) + drag handles + multi-cell selection
- Export: HTML, print/PDF, copy-as-rich-text (ClipboardItem API)
- Image handling: inline rendering, viewport scaling, click-to-edit popover
- Link navigation (Cmd+Click), autocomplete (fuzzy workspace file/anchor dropdown), broken link detection (wavy red underline), backlinks Explorer panel
- Frontmatter: collapsible YAML block with CSS-animated expand/collapse
- Code blocks: syntax highlighting via lowlight (192 languages)
- Document stats in status bar
- VS Code theming, 10+ settings, auto-reload
- Unit tests: 75/75 pass (vitest)
- Integration tests: written (test/integration/, @vscode/test-cli)
- ARIA labels + keyboard accessibility on toolbar
- CHANGELOG.md, images/icon.svg + icon.png, .vsixignore

## Recent: Frontend Redesign (2026-03-22, uncommitted)

All 11 CSS stylesheets and key TypeScript UI components were redesigned:
- Replaced emoji/unicode toolbar icons with inline SVG icons matching VS Code style
- Replaced all window.prompt/window.confirm calls with proper modal dialogs
- Added entrance animations to context menu, find bar, table picker, autocomplete, image popover
- Improved typography: letter-spacing on H1, border-bottom on H2, uppercase H6
- Links use subtle border-bottom with color-mix transparency instead of underline
- Code blocks get border, language label pill, better font stack
- Context menu shows keyboard shortcut hints (⌘B, ⌘K, etc.)
- Table toolbar uses SVG icons instead of cryptic unicode (↑+, ⬛L, 🗑)
- Task list items get strikethrough + opacity when checked
- Consistent border-radius (4-8px), transitions, and VS Code theme integration
- 15 files changed, ~700 lines added, ~300 removed

## How to Test the Frontend Redesign

1. Build and launch:
   cd /Users/michaeljosephwork/git/markdown-WYSIWYG-vscode-extension
   npm run compile
   # Press F5 in VS Code to launch Extension Development Host
   # Open any .md file → should open in MikeDown Editor

2. Visual checks:
   - Toolbar: all buttons should show SVG icons, not text/emoji
   - Hover toolbar buttons: smooth highlight transitions
   - Active formatting state: buttons highlight when cursor is in bold/heading/etc.
   - Right-click: context menu with rounded corners, animation, shortcut hints
   - Cmd+F: find bar slides in from top-right with animation
   - Click a table: toolbar appears above with SVG icons for row/col operations
   - Click Insert Table button: grid picker pops in with animation
   - Click an image: edit popover appears with proper form fields
   - Click Insert Image: full modal dialog (not browser prompt)
   - Click Insert Link / Cmd+K: full modal dialog with URL field label
   - Type in link dialog: autocomplete dropdown with slide-in animation
   - Headings: H1 has tight letter-spacing, H2 has bottom border, H6 is uppercase
   - Links: subtle border-bottom (not underline), Cmd+hover shows dashed border
   - Code blocks: rounded with border, language label has background pill
   - Task lists: checked items get strikethrough + fade
   - Frontmatter: expand arrow rotates via CSS transform

3. Functional checks:
   - All toolbar buttons work (bold, italic, headings, lists, etc.)
   - Context menu actions work (formatting, insert link/image/table)
   - Find & Replace works (match highlighting, navigation, replace)
   - Table operations work (add/remove row/col, alignment, delete)
   - Link dialog: insert/update links with autocomplete
   - Image dialog: insert images with alt text
   - Source mode toggle (Cmd+/) switches between WYSIWYG and CodeMirror
   - Undo/Redo work

4. Run tests:
   npx vitest run                          # 75 unit tests should pass
   npm run compile                         # should compile with no errors

## Key Files

- `PLANNING.md` — full milestone history and task checklist (all checked)
- `src/extension.ts` — activation, command registration, BacklinkProvider wiring
- `src/markdownEditorProvider.ts` — Custom Editor, webview message dispatch
- `src/webview/editor-main.ts` — TipTap setup, toolbar (SVG icons), dialogs, all message handlers
- `src/webview/editor.css` — imports all feature CSS modules
- `src/webview/contextmenu.ts` — context menu with shortcut hints
- `src/webview/tablepicker.ts` — table grid picker + table toolbar (SVG icons)
- `package.json` — v0.1.0, all contributes (commands, views, configuration)

## How to Build

cd /Users/michaeljosephwork/git/markdown-WYSIWYG-vscode-extension
npm run compile                    # build both bundles (webpack)
npx vitest run                     # all unit/edge/perf tests
```
