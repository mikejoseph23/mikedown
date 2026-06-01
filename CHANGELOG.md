# Changelog

All notable changes to MikeDown Editor are documented here.

## [2.6.0] - 2026-05-31

### Added

- **Mermaid diagram rendering.** ```` ```mermaid ```` fenced blocks render as live SVG diagrams in the WYSIWYG view (flowcharts, sequence, class, state, gantt, pie, ER, and more). Click a diagram to reveal and edit its source; click away to re-render. Invalid syntax shows the source with an inline error so nothing is lost. Honors the editor light/dark theme. Toggle via the gear menu (Markdown tab) or `mikedown.renderMermaidDiagrams` (default on). Rendering is fully offline — mermaid is bundled, no network access.

## [2.5.2] - 2026-05-25

### Added

- **Share dropdown in the toolbar.** View in Browser and Print / Export as PDF are now grouped under a single Share button to keep the right-side utility cluster focused. Select All stays standalone — it's a selection action, not export.
- **Periodic "enjoying MikeDown?" toast.** A single low-frequency information toast (Review · Share · Feedback · Stop asking) that only appears after ≥7 days of install and ≥3 documents opened in MikeDown. Dismissal backs off on a 14 → 30 → 60 → 90 day ladder; any call-to-action click resets the schedule to 30 days; Stop-asking is permanent. State persists per-install in `globalState`.

### Removed

- **Inert Diff toggle button** in the toolbar (it had been disabled — opacity 0.3 / no pointer events). The underlying `MikeDown: Show Git Diff` command stays available from the command palette and the editor-title context menu.
- Three orphaned `button[data-action="diffToggle"]` DOM lookups that were running on every diffStatus / diffData broadcast.

## [2.5.1] - 2026-05-24

### Fixed

- **Sidebar auto-collapse on empty Properties.** Opening a document with no frontmatter now correctly initializes the Properties section as collapsed (matching the Backlinks behavior). Previously, a message-order race between `update` and `sidebarState` caused Properties to render expanded with the "+ Add property" affordance visible even on docs with no saved collapse preference. The auto-collapse rule is also now genuinely per-section — toggling Outline no longer silences the empty-state auto-collapse for Properties or Backlinks.

## [2.5.0] - 2026-05-24

### Added

- **Settings modal: five tabs.** The in-editor Settings modal (toolbar gear) is now organized into vertical tabs — **Appearance** (font, content width, sidebar defaults), **Behavior** (default editor, link click behavior, auto-reload, theme toggle scope), **Markdown** (normalization + bold/italic/list/heading marker styles), **Images** (paste + resize), **About** (version, license, GitHub / changelog / issue links) — instead of one long scrolling list. Active tab is remembered for the session.
- **Sidebar pin button.** A pin icon in the sidebar header toggles "pinned open" vs "start hidden." Pinned state shows a filled blue pill background; unpinned shows an outlined/tilted icon. Clicking the pin persists the new default to `mikedown.sidebar.visibility` so newly-opened documents inherit it.
- **Sidebar position toggle in the header.** A small arrow button next to the pin flips the sidebar to the opposite side instantly (per-document; the Settings tab still controls the default for new documents).
- **Sidebar discovery toggle now uses a layout icon.** The collapsed-state toggle in the corner renders as a sidebar-pane SVG (with the active side filled) instead of a hamburger glyph.
- **Sidebar footer is now two lines.** Top line: `Modified … ago`. Bottom line: `N words · N chars · N min read`. Footer text is more legible in light mode.
- **"Apply to open documents" button.** In Settings → Appearance, a subtle button next to the sidebar defaults pushes the saved defaults onto every open MikeDown panel on demand — without reloading them.
- **Selection word/char count in the status bar.** When you select text, a status-bar item shows `N words · N chars selected` alongside the document totals.
- **Editable Properties section.** Frontmatter rows in the sidebar Properties section are now inline-editable — click a key or value to edit, hit Enter to commit, Esc to cancel; a "+ Add property" affordance lives at the bottom. Round-trips to YAML in the document's frontmatter via a shared parser/serializer (`src/frontmatterYaml.ts`), so the source markdown stays clean.
- **Smart section defaults on open.** When a document opens with no saved collapse preference, Properties and Backlinks each auto-collapse if empty and auto-expand if they have content. The moment you manually toggle any section, your preference takes over and persists per-doc.

### Changed

- **Sidebar section order: Outline / Backlinks / Properties / Footer.** Outline anchors the top so its header controls (position toggle, pin, close) sit where they're easy to reach. Properties is always present at the bottom (even with no frontmatter — shows a subtle "No properties." placeholder or the "+ Add property" affordance in editable mode).
- **Source-mode toolbar lockout.** Switching to raw-markdown view (`Cmd+/`) now disables every toolbar action that would mutate the underlying ProseMirror doc — bold/italic/lists/headings/images/etc. — so they don't silently apply to the hidden WYSIWYG view. The `sourceToggle` button itself shows as active in source mode.
- **Status bar stats are always-on again for markdown documents.** Word count, character count, and reading-time items are shown whenever a markdown doc is the active editor (custom or plain text), and follow focus across MikeDown tabs. Earlier in 2.5 development they were briefly removed in favor of the sidebar footer alone, but the sidebar is now per-instance and can be hidden, so the status bar is back as the always-visible fallback.
- **Sidebar state is now per-instance.** Position and width changes made via the sidebar header / resize handle stay local to that document instead of broadcasting to every open MikeDown tab. Persisted settings act as seeds for newly-opened documents.
- **Sidebar visibility went binary.** `mikedown.sidebar.visibility` now accepts `always` | `never` only — the `remember` (per-document last-known) mode and its globalState map were removed because they produced confusing cross-document behavior. Existing user configs storing `remember` are auto-migrated to `never` on first launch.
- **Outline sidebar now defaults to the right side.** Existing installs with no explicit `mikedown.sidebar.position` saved will see the sidebar move to the right on next open — set it back to `left` in the Settings modal if you prefer the previous position.
- **Settings renamed: `mikedown.outline.*` → `mikedown.sidebar.*`.** The sidebar hosts more than the outline now (Properties, Backlinks, footer), so the keys were renamed to match. Existing values (`mikedown.outline.visibility`, `.width`, `.position`) are auto-migrated to the new keys on first launch — no action needed.
- **Marketplace screenshots refreshed for 2.5.** The README and the bundled `.vsix` assets now reflect the redesigned sidebar, toolbar, and status bar — the previous shots were from 1.x.

## [2.3.3] - 2026-05-23

### Fixed

- **Inline images on the same line stay on the same line.** Multiple `![]()` images separated by spaces on one markdown line (e.g. a row of shields.io badges) now render side-by-side in one paragraph, matching GitHub. Previously each image was promoted to its own block — the TipTap Image extension defaults to block-level, and a `display: block` CSS rule reinforced it. Image nodes are now configured `inline: true` and styled `display: inline-block`

## [2.3.2] - 2026-05-23

### Fixed

- **External `https:` images now render.** Shields.io badges, raw GitHub images, and any other remote image referenced with an `https://…` URL render in the editor instead of showing as broken-image placeholders. The webview's Content-Security-Policy only listed `${webview.cspSource} data:` for `img-src`, which is enough for local images (rewritten to the cdn host by `asWebviewUri`) but blocked everything else. CSP now includes `https:`, matching VS Code's built-in markdown preview

## [2.3.1] - 2026-05-21

### Fixed

- **Percent-encoded relative links now resolve.** Clicking a markdown link like `[x](../folder/My%20File%20%28v2%29.md)` opens the file instead of silently failing. The host was passing the encoded href straight to the filesystem, so it looked for a file literally named `My%20File%20%28v2%29.md`. The angle-bracket form `<...>` was the only workaround. The broken-link checker had the same bug and would false-positive on encoded paths

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
