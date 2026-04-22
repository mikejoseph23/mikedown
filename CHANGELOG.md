# Changelog

All notable changes to MikeDown Editor are documented here.

## [1.5.0] - 2026-04-22

### Added

- Drag-to-reorder for task-list items — hover a task item to reveal a handle to the left of the checkbox, then drag to reorder within a list or move to another task list. Dropping into a paragraph or bullet list inserts a new task list as a sibling so the task-item type is preserved

## [1.4.0] - 2026-04-22

### Added

- Find & replace now works in source mode — same bar, same options (match case, whole word, regex), highlights and cycles matches inside CodeMirror
- Cursor position is preserved when toggling between WYSIWYG and source mode (snippet-search based mapping handles markdown syntax characters correctly)

### Fixed

- Undo / redo now route to the correct editor based on current mode — previously clicking the toolbar Undo button (or using Cmd+Z in source mode) would target the hidden WYSIWYG state instead of what the user was looking at
- Cmd+/ no longer wraps the current line with `<!-- -->` before switching modes — CodeMirror's default keymap binding for toggle-line-comment was firing alongside the mode toggle
- Pressing Undo immediately after opening a file no longer blanks the document — TipTap's `setContent` and CodeMirror's initial load both added a history entry that the first Cmd+Z would revert through
- Undoing every edit back to the post-open state now correctly clears the "modified" indicator so closing the file doesn't prompt to save

## [1.3.2] - 2026-04-21

### Fixed

- Source view no longer truncates the bottom of long documents — an inline `height:100%` on the source container was combining with its `top:40px` positioning to push the scroller 40px past the viewport, hiding the last lines

## [1.2.1] - 2026-04-14

### Fixed

- Relative-path markdown links like `[Planning](Planning/README.md)` are no longer silently stripped on open — TipTap's default link-URI validator contained a regex bug that rejected any bare `word/word` href, which made in-repo link trees render (and re-save) as plain text

## [1.2.0] - 2026-04-11

### Added

- Custom hover tooltips on all toolbar buttons — every non-dropdown icon now shows a labeled, themed tooltip on hover (VS Code webviews don't reliably render native HTML `title` tooltips, so the labels previously weren't visible)

## [1.1.4] - 2026-04-10

### Fixed

- Find (Ctrl/Cmd+F) in WYSIWYG mode now correctly highlights every match across headings, lists, and other block types — previously, a bug in the text-offset → ProseMirror position mapping caused most matches to collapse onto the last text node so only one garbled highlight was rendered
- Find bar Next / Previous (↑ / ↓ buttons and Enter / Shift+Enter) now scrolls the active match into view instead of moving the editor cursor, so the toolbar no longer flips its "Text Format" indicator to H1/H2/list when stepping through matches
- Clicking the find bar's arrow buttons no longer steals focus from the find input, so keyboard navigation keeps working after a click

## [1.1.3] - 2026-04-10

### Changed

- Expanded the Getting Started section of the marketplace listing with first-time use instructions, how to set MikeDown as the default markdown editor in VS Code, and how to set VS Code as the default `.md` handler in macOS Finder and Windows File Explorer

## [1.1.2] - 2026-04-10

### Changed

- Refreshed marketplace listing copy with a sharper tagline and a more confident "Why MikeDown?" pitch
- Updated marketplace categories (added "Notebooks") and search keywords ("writing", "notes")
- Removed "Preview" badge from the marketplace listing

### Fixed

- Bundled screenshot assets into the published `.vsix` so listing images render even when GitHub is unreachable

## [0.1.0] - 2026-03-01

### Added

- **WYSIWYG Editor** — True live preview editing for Markdown files in VS Code
- **Full GFM Support** — Headings, bold, italic, strikethrough, links, images, tables, task lists, blockquotes, code blocks, horizontal rules
- **Toolbar** — 21-button formatting toolbar with keyboard shortcuts (Cmd+B, Cmd+I, etc.)
- **Source Mode Toggle** — Switch between WYSIWYG and raw Markdown (Cmd+/) with CodeMirror 6
- **Smart Paste** — Converts rich HTML from Google Docs, Word, Slack, and web pages to clean Markdown
- **Find & Replace** — Floating bar with regex, match case, whole word, replace/replace all (Cmd+F/H)
- **Context Menu** — Right-click context menu for text, links, tables, and images
- **Table Grid Picker** — Visual grid dialog for inserting tables of any dimension
- **Table Toolbar** — Contextual toolbar for row/column operations and cell alignment
- **Export** — Export to HTML, print/PDF via browser, copy as rich text
- **Image Handling** — Inline rendering with viewport scaling and click-to-edit popover
- **Link Navigation** — Cmd+Click to open links, internal anchor navigation, GitHub-style anchor IDs
- **Broken Link Detection** — Visual indicators (red underline) for links to missing files or anchors
- **Backlinks Panel** — Explorer panel showing all files that link to the current document
- **Link Autocomplete** — Workspace file and heading anchor suggestions when creating links
- **Frontmatter** — Collapsible YAML frontmatter block preserved through all operations
- **Code Block Highlighting** — Syntax highlighting via lowlight (192 languages)
- **Document Stats** — Word count, character count, and reading time in the status bar
- **Theming** — Full VS Code theme integration (dark, light, high-contrast)
- **Settings** — 10+ configurable preferences (font family/size, link behavior, etc.)
- **Auto-Reload** — Silent reload of unmodified files when external changes are detected
- **No-Modify-On-Open** — Files are never modified by simply opening them in the editor

### Technical Notes

- Built on TipTap v2 (ProseMirror-based)
- Uses `tiptap-markdown` for GFM parse/serialize
- CodeMirror 6 for source mode
- Fully offline — zero network calls, no CDN resources
- VS Code Custom Editor API with webview message passing
