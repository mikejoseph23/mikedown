# Changelog

All notable changes to MikeDown Editor are documented here.

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
