# Changelog

All notable changes to MikeDown Editor are documented here.

## [2.3.0] - 2026-05-20

### Changed

- **Sidebar consolidation.** Every per-document surface now lives in the in-editor sidebar (the panel you open with the `≡` toggle), in this order top-to-bottom: Properties → Outline → Backlinks → metadata footer
- The dedicated MikeDown activity-bar icon has been removed. The Backlinks tree-view that lived there is gone — the same list now renders inline in the in-editor sidebar. One panel per document, no extra activity-bar real estate consumed

### Added

- **Highlight / mark.** Surround text with `==…==` to render it with a yellow highlight (`<mark>`). New toolbar button (highlighter icon), right-click → **Highlight**, and **Cmd+Shift+H** / **Ctrl+Shift+H** all toggle it on the current selection. Round-trips cleanly to `==text==` in saved markdown so GitHub renders it the same way. Light and dark mode each get a tuned background tint
- **Emoji shortcodes + picker.** Type `:smi` and an inline autocomplete popup shows up to 8 matching shortcodes — arrow keys + Enter inserts; Esc dismisses. A new top-level **Emoji** button on the toolbar (and **Cmd+;** / **Ctrl+;**, and right-click → **Insert Emoji…**) opens a searchable picker with category sections (Smileys, People, Animals, Food, etc.) and a Recents row pinned at the top, persisted in localStorage. Full GitHub shortcode set supported
- **Backlinks section in the in-editor sidebar.** Stacks below the outline as a collapsible section with a header count badge (e.g. `Backlinks (3)`). Click any entry to jump to that file. Updates live as the workspace-wide backlink index changes (save / create / delete) — no manual refresh
- **Properties section** rendered from YAML frontmatter when present. Keys in muted color, values normal; arrays like `tags: [foo, bar]` render as inline pills; dates show literally as written. The section is absent — not just empty — when the document has no frontmatter, placed above the Outline so it mirrors the document order. Collapsed state is persisted per-document
- **Sidebar footer metadata strip** showing relative modified time, word count, and estimated reading time (e.g. `Modified 2 days ago · 1,245 words · 6 min read`). Word count + reading time update live as you type, modified time refreshes on save and ticks once a minute. Reuses the same word-counting helper as the status bar so the numbers always match

## [2.1.0] - 2026-05-20

### Added

- **GitHub-style callouts / admonitions.** Blockquotes whose first line is `> [!NOTE]`, `[!TIP]`, `[!IMPORTANT]`, `[!WARNING]`, or `[!CAUTION]` now render as styled, icon-prefixed panels in WYSIWYG mode. Each kind has its own accent color and icon (light + dark mode); the marker line is hidden from the editing surface so the body reads as normal blockquote content
- Insert a callout from the toolbar **Lists & Blocks** dropdown — a row of color-coded badges lets you pick the kind directly, no need to remember the marker syntax
- Right-click anywhere in the editor and choose **Callout → Note / Tip / Important / Warning / Caution** for the same picker from the canvas
- Round-trips cleanly: opening a file with `> [!WARNING]` parses to a callout, saving writes the canonical GFM marker back. Lowercase markers like `[!note]` are accepted on parse and normalized to uppercase on save. Unknown kinds (`[!FOOBAR]`) fall back to a plain blockquote so no content is lost

## [2.0.0] - 2026-05-20

### Added

- **In-editor document outline sidebar — the headline 2.0 feature.** Click the small `≡` icon in the top-left of any MikeDown tab to reveal a compact, per-document outline that lists every heading in the file. The active section follows your cursor *and* the scroll position (so jumping via an in-document anchor link keeps the outline in sync), with a left accent bar + bold styling for the current heading and auto-scroll inside the sidebar to keep it visible. Click any heading to jump straight to it
- Drag the right edge of the outline to resize it (160–360px, persisted globally so the width sticks across files and themes)
- New **Document Outline** preference in the in-editor settings modal: *Always show* · *Always hide* (default) · *Remember per document*. Also exposed as `mikedown.outline.visibility` and `mikedown.outline.width` in VS Code settings

### Notes

- Why a major version bump? The outline reshapes how you navigate long documents inside MikeDown and is the first surface in the editor that mounts a sibling pane alongside the editing area — it's a genuinely new mode of working with the editor, not a tweak
- VS Code's built-in **Outline** view still can't be populated for custom editors (it binds to `activeTextEditor`, which is `undefined` for webview-based editors — tracked upstream as `microsoft/vscode#105448`). An in-editor sidebar sidesteps the limitation entirely, gives each open document its own outline, and unlocks the per-file scroll-spy and active-item auto-scroll behavior that wouldn't be possible inside VS Code's pane

## [1.8.0] - 2026-05-19

### Added

- Word count, character count, and estimated reading time now appear in VS Code's status bar while a MikeDown editor tab is focused. Stats update live as you type and follow you across panels — reading time assumes a 225 WPM reading pace
- A README "Enjoying MikeDown?" section nudging happy users to tell a friend or co-worker, or [leave a review on the Marketplace](https://marketplace.visualstudio.com/items?itemName=interapp.mikedown-editor&ssr=false#review-details)
- New top-level `BACKLOG.md` capturing future feature ideas (math/LaTeX, Mermaid diagrams, footnotes, callouts, slash commands, wiki-links, and more) so the parking lot is visible to anyone browsing the repo

## [1.7.1] - 2026-05-18

### Added

- Click the language pill in the top-right of any code block to open a searchable language picker. Lists ~190 lowlight-supported languages with a curated top set (json, javascript, typescript, python, bash, etc.), accepts free-text input for any identifier, and offers "Clear language" to remove the fence tag. Round-trips cleanly to source mode
- Right-click inside a code block now shows a tailored menu (Set language…, Copy code, Delete code block) instead of the generic formatting menu — useful for blocks with no language yet (no pill to click)
- Right-click context menu on regular content is now compact: Heading, List, and Insert are grouped into hover submenus so it fits on smaller windows. Submenus mark the currently active heading level / list type and auto-flip when they would overflow the viewport

## [1.7.0] - 2026-05-17

### Added

- Hover over a code block to reveal a **Copy** button in the top-right corner — one click copies the block's contents to the clipboard, with a brief "Copied!" confirmation. Works for every fenced code block regardless of language

## [1.6.0] - 2026-05-06

### Added

- Paste an image (Cmd/Ctrl+V) or drag an image file into the editor to save it next to your document and insert a markdown image link automatically. Closes [#1](https://github.com/mikejoseph23/mikedown/issues/1)
- Seven `mikedown.imagePaste.*` settings to control the destination folder, filename pattern, path style, alt-text behavior, and max size limit. Defaults: save to `images/` next to the document, name as `${docName}-${timestamp}.${ext}`, insert a relative path with empty alt text, reject pastes over 10 MB
- Drag-and-drop image files into the editor uses the same pipeline as paste
- Right-click an image to access Resize 75% / 50% / 25% presets — useful for downscaling Mac high-DPI screenshots that paste in at 2× physical size. Resizes happen client-side via `<canvas>` and write through to disk. SVG and GIF are excluded (canvas can't preserve animation/vector form)
- New `mikedown.imageResize.overwrite` setting (default `true`) controls whether resizes overwrite the original file or write a sibling like `foo-50pct.png` and update the markdown link to point at it. Exposed in both VS Code's Settings UI and the in-editor settings modal
- On save, MikeDown now deletes images that fell out of the document and live inside the configured `imagePaste.folder` — but only if (a) the file was pasted in this session OR its filename matches the configured `filenamePattern` shape (so user-curated assets like `logo.png` are never touched), and (b) no other markdown file in the workspace still references it. Helps keep `images/` folders from accumulating committed-but-unused screenshots. Toggle off with `mikedown.imagePaste.cleanupUnreferenced`

### Fixed

- Image paths in saved markdown no longer leak the session-scoped `https://*.vscode-cdn.net/...` URI used for in-editor display — round-tripping a file with relative image paths now preserves the original `images/foo.png` form on disk
- Cache-bust query strings appended to webview image URIs (used to force the browser to re-fetch an overwritten file after resize) are stripped before path resolution so they never leak into the saved markdown

## [1.5.2] - 2026-05-06

### Fixed

- Email autolinks (`<user@example.com>`) no longer get rewritten as `[user@example.com](mailto:user@example.com)` on open, which had been marking unmodified files dirty
- Email and other non-HTTP scheme links (`mailto:`, `tel:`, etc.) are no longer flagged with a red "Broken link" squiggle — they're handed to the OS instead of validated as relative file paths
- Cmd/Ctrl+Click on a `mailto:` link now opens the user's default mail client; `tel:` links open the dialer
- Right-click menu on email links shows "Send Email" / "Copy Email Address" (with the `mailto:` prefix stripped) instead of generic "Open Link" / "Copy Link"

## [1.5.1] - 2026-05-04

### Changed

- Single newlines inside a paragraph now render as visible line breaks (matches Typora / Obsidian / GitHub-flavored rendering). Previously a single `\n` was treated as a CommonMark soft break and collapsed to a space, so a three-line block like `**To:** … / **From:** … / **Subject:** …` rendered as one wrapped line
- Increased paragraph spacing in the WYSIWYG view from 0.75em to 1em for clearer separation between blocks

### Fixed

- Toggling to source mode on an unmodified file now shows the file's bytes verbatim instead of the round-tripped serialization. Soft-break newlines, trailing whitespace, and other markdown details that don't survive the ProseMirror parse/serialize cycle are preserved
- Toggling source → WYSIWYG with no source-side edits no longer needlessly reloads the WYSIWYG editor when the only difference is round-trip lossiness — preserves PM's undo history and keeps the saved-state baseline intact

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
