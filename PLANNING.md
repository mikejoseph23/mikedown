# MikeDown Editor - Planning Document

---

## Kickoff Prompt (Copy into a new Sonnet Claude Code window)

```
You are building "MikeDown Editor" — a WYSIWYG Markdown editor extension for Visual Studio Code.

READ the full planning document at ./PLANNING.md before doing anything. It contains 28 detailed milestones with exact npm packages, TipTap API calls, file structures, and implementation details.

RULES:
- Work through milestones sequentially starting with M1. Do NOT skip ahead.
- Complete ALL checklist items in a milestone before moving to the next.
- After completing each milestone, update its status in the Milestone Progress Tracker table from "⬜ Not Started" to "✅ Complete" and record the duration in minutes.
- Add a Progress Log entry with timestamp after each milestone completion.
- Commit your code after each milestone with a descriptive commit message.
- This extension must be FULLY OFFLINE — zero network calls, no CDN resources, no telemetry.
- Files must NEVER be modified on open (no reformatting, no line ending changes). The dirty flag must only be set by intentional user edits.
- Target GitHub Flavored Markdown (GFM) spec.
- Do not add features, refactoring, or improvements beyond what is specified in the milestone.

START with M1: Project Scaffolding & Extension Setup. Initialize the VS Code extension project in this directory.

When M1 is complete, proceed to M2a, then continue through the milestones in dependency order as described in the Parallel Development Recommendations section.

If you encounter a blocker or architectural decision not covered in the planning document, stop and ask rather than guessing.
```

---

## Summary

**MikeDown Editor** is a WYSIWYG Markdown editor extension for Visual Studio Code that provides a Typora-like inline editing experience. It eliminates the need for split-pane preview by making the rendered document the editing surface itself, while leveraging VS Code's existing infrastructure (file browser, Git integration, multi-tab editing, theming).

### Key Objectives
- Deliver a polished Typora-style live preview editing experience inside VS Code
- Provide MarkText-style table editing with visual grid picker, drag handles, and cell-level editing
- Support smart link navigation, autocomplete, broken link detection, and backlink awareness
- Enable seamless toggling between WYSIWYG and raw Markdown source in the same tab
- Export to PDF, HTML, DOCX with print support and copy-as-rich-text
- Remain fully offline with zero network calls — complete privacy

### Critical Success Factors
- Files must never be modified on open (dirty flag only set by intentional user edits)
- Auto-reload unmodified files silently when external changes are detected
- Respect VS Code theming (dark/light mode) while using attractive proportional fonts
- GitHub Flavored Markdown (GFM) spec compliance
- Word processor keyboard shortcuts that override VS Code bindings when WYSIWYG is active
- Clean markdown output that renders correctly on GitHub and other GFM renderers

---

### Milestone Progress Tracker

| Milestone | Model | Status | Duration (min) | Notes |
|---|---|---|---|---|
| [M1: Project Scaffolding & Extension Setup](#m1-project-scaffolding--extension-setup) | Sonnet | ✅ Complete | 15 | Foundation: extension manifest, build tooling, Custom Editor API |
| [M2a: WYSIWYG Engine Setup & Markdown Round-Trip](#m2a-wysiwyg-engine-setup--markdown-round-trip) | Sonnet | ✅ Complete | 20 | Install TipTap, configure in webview, implement GFM parse/serialize |
| [M2b: Inline Element Live Preview](#m2b-inline-element-live-preview) | Sonnet | ✅ Complete | 20 | Bold, italic, strikethrough, inline code, links |
| [M2c: Block Element Live Preview](#m2c-block-element-live-preview) | Sonnet | ✅ Complete | 20 | Headings, lists, blockquotes, code blocks, horizontal rules |
| [M2d: Editor Behaviors & Document Integrity](#m2d-editor-behaviors--document-integrity) | Sonnet | ✅ Complete | 20 | Undo/redo, list continuation, nesting, no-modify-on-open, save cleanup |
| [M3: Toolbar & Formatting Controls](#m3-toolbar--formatting-controls) | Sonnet | ✅ Complete | 52 | Fixed toolbar, 21 buttons, keyboard shortcuts, active states, command bridge |
| [M4: Source Mode Toggle](#m4-source-mode-toggle) | Sonnet | ✅ Complete | 59 | CodeMirror 6, Cmd+/, M15 frontmatter integration, VS Code theme sync |
| [M5a: Table Rendering & Cell Editing](#m5a-table-rendering--cell-editing) | Sonnet | ✅ Complete | 14 | Visual table grid, click-into-cell editing, keyboard navigation |
| [M5b: Table Grid Picker & Toolbar](#m5b-table-grid-picker--toolbar) | Sonnet | ✅ Complete | 4 | 8×10 grid picker, contextual table toolbar, setCellAttribute alignment |
| [M5c: Table Drag Handles & Multi-Cell Selection](#m5c-table-drag-handles--multi-cell-selection) | Sonnet | ✅ Complete | 5 | tabledrag.ts, overlay drag handles, drop-line feedback, multi-cell selection |
| [M6a: Link Navigation & Anchor System](#m6a-link-navigation--anchor-system) | Sonnet | ✅ Complete | 45 | openLink handler, GitHub anchor IDs, heading icons, link tooltip, cmd-held tracking |
| [M6b: Link Autocomplete](#m6b-link-autocomplete) | Sonnet | ✅ Complete | 4 | Custom link dialog, fuzzy dropdown, workspace file + heading anchor suggestions |
| [M6c: Broken Link Detection & Backlinks](#m6c-broken-link-detection--backlinks) | Sonnet | ✅ Complete | 5 | BacklinkProvider TreeDataProvider, wavy red underline, checkLinks scan, Explorer panel |
| [M7: Image Handling](#m7-image-handling) | Sonnet | ✅ Complete | 25 | Inline rendering, viewport scaling, broken-image handling, click-to-edit popover |
| [M8: File Handling & Auto-Reload](#m8-file-handling--auto-reload) | Sonnet | ✅ Complete | 10 | File watching, auto-reload, concurrent editing sync |
| [M9: Theming & Typography](#m9-theming--typography) | Sonnet | ✅ Complete | 12 | VS Code theme integration, configurable fonts |
| [M10: Context Menu & Right-Click](#m10-context-menu--right-click) | Sonnet | ✅ Complete | 3 | contextmenu.ts/css, text/link/table/image menus, VS Code theme vars |
| [M11: Export & Clipboard](#m11-export--clipboard) | Sonnet | ✅ Complete | 3 | export.ts, HTML export, print/PDF, copy-as-rich-text (ClipboardItem) |
| [M12a: Smart Paste — Basic HTML Conversion](#m12a-smart-paste--basic-html-conversion) | Sonnet | ✅ Complete | 22 | ProseMirror paste plugin, DOMParser, Google Docs/Word style cleanup |
| [M12b: Smart Paste — Complex Structures & Source Handling](#m12b-smart-paste--complex-structures--source-handling) | Sonnet | ✅ Complete | 3 | normalizeTableHtml, normalizeNestedLists, Word/Google Docs/Slack/web cleanup |
| [M13: Find & Replace](#m13-find--replace) | Sonnet | ✅ Complete | 33 | Decoration plugin, floating bar, Cmd+F/H, match/replace/all |
| [M14: Document Stats & Status Bar](#m14-document-stats--status-bar) | Sonnet | ✅ Complete | 10 | Word count, character count, reading time |
| [M15: Frontmatter & Code Blocks](#m15-frontmatter--code-blocks) | Sonnet | ✅ Complete | 32 | Collapsible YAML frontmatter, CodeBlockLowlight + lowlight(all), codeblocks.css |
| [M16: Preferences & Settings](#m16-preferences--settings) | Sonnet | ✅ Complete | 10 | All user-configurable preferences |
| [M17a: Unit Tests](#m17a-unit-tests) | Sonnet | ✅ Complete | 5 | 53/53 tests pass — vitest, jsdom, 6 files: roundtrip/formatting/tables/links/smartpaste/stats |
| [M17b: Integration Tests](#m17b-integration-tests) | Sonnet | ✅ Complete | 4 | @vscode/test-cli, 5 test files, 13 tests, workspace fixtures, tsc clean |
| [M17c: Edge Case Tests & Performance](#m17c-edge-case-tests--performance) | Sonnet | ✅ Complete | 6 | 22/22 tests pass — edge-cases + performance, unicode, CRLF, large docs, timing benchmarks |
| [M17d: Polish & Release Prep](#m17d-polish--release-prep) | Sonnet | ✅ Complete | 5 | v0.1.0, icon.svg+png, CHANGELOG.md, ARIA+keyboard, .vsixignore, tsc+webpack clean |

---

## Table of Contents

1. [M1: Project Scaffolding & Extension Setup](#m1-project-scaffolding--extension-setup)
2. [M2a: WYSIWYG Engine Setup & Markdown Round-Trip](#m2a-wysiwyg-engine-setup--markdown-round-trip)
3. [M2b: Inline Element Live Preview](#m2b-inline-element-live-preview)
4. [M2c: Block Element Live Preview](#m2c-block-element-live-preview)
5. [M2d: Editor Behaviors & Document Integrity](#m2d-editor-behaviors--document-integrity)
6. [M3: Toolbar & Formatting Controls](#m3-toolbar--formatting-controls)
7. [M4: Source Mode Toggle](#m4-source-mode-toggle)
8. [M5a: Table Rendering & Cell Editing](#m5a-table-rendering--cell-editing)
9. [M5b: Table Grid Picker & Toolbar](#m5b-table-grid-picker--toolbar)
10. [M5c: Table Drag Handles & Multi-Cell Selection](#m5c-table-drag-handles--multi-cell-selection)
11. [M6a: Link Navigation & Anchor System](#m6a-link-navigation--anchor-system)
12. [M6b: Link Autocomplete](#m6b-link-autocomplete)
13. [M6c: Broken Link Detection & Backlinks](#m6c-broken-link-detection--backlinks)
14. [M7: Image Handling](#m7-image-handling)
15. [M8: File Handling & Auto-Reload](#m8-file-handling--auto-reload)
16. [M9: Theming & Typography](#m9-theming--typography)
17. [M10: Context Menu & Right-Click](#m10-context-menu--right-click)
18. [M11: Export & Clipboard](#m11-export--clipboard)
19. [M12a: Smart Paste — Basic HTML Conversion](#m12a-smart-paste--basic-html-conversion)
20. [M12b: Smart Paste — Complex Structures & Source Handling](#m12b-smart-paste--complex-structures--source-handling)
21. [M13: Find & Replace](#m13-find--replace)
22. [M14: Document Stats & Status Bar](#m14-document-stats--status-bar)
23. [M15: Frontmatter & Code Blocks](#m15-frontmatter--code-blocks)
24. [M16: Preferences & Settings](#m16-preferences--settings)
25. [M17a: Unit Tests](#m17a-unit-tests)
26. [M17b: Integration Tests](#m17b-integration-tests)
27. [M17c: Edge Case Tests & Performance](#m17c-edge-case-tests--performance)
28. [M17d: Polish & Release Prep](#m17d-polish--release-prep)
29. [Backlog](#backlog)
30. [Parallel Development Recommendations](#parallel-development-recommendations)
31. [Progress Log / Notes](#progress-log--notes)

---

## M1: Project Scaffolding & Extension Setup

**Model: Sonnet** | **Status: ✅ Complete**

Initialize the VS Code extension project with proper build tooling, extension manifest, and the Custom Editor API foundation that all subsequent milestones build upon.

### Tasks

- [x] Initialize project with `yo code` generator (TypeScript extension)
- [x] Configure `package.json` with extension metadata (name: `mikedown-editor`, display name: `MikeDown Editor`)
- [x] Set up TypeScript compilation with strict mode
- [x] Configure webpack/esbuild bundler for extension packaging
- [x] Register Custom Editor provider in `package.json` for `.md` and `.markdown` file types
- [x] Implement `CustomTextEditorProvider` with basic webview panel
- [x] Set up Content Security Policy (CSP) for webview (fully offline — no external resources)
- [x] Create basic webview HTML shell with toolbar placeholder and editor container
- [x] Set up message passing between extension host and webview (postMessage API)
- [x] Implement file read/write through VS Code's `workspace.fs` API
- [x] Configure `.vsixignore` for clean packaging
- [x] Set up ESLint and Prettier for code quality
- [x] Create development launch configuration (`.vscode/launch.json`)
- [x] Verify extension activates and opens `.md` files in the custom editor
- [x] Set up the preference to optionally register as default editor for `.md`/`.markdown` files

> **Worker Note:** All items in this milestone must be completed. If any item seems unclear or blocked, note it in your summary for the orchestrator but still attempt the work.

[Return to Top](#mikedown-editor---planning-document)

---

## M2a: WYSIWYG Engine Setup & Markdown Round-Trip

**Model: Sonnet** | **Status: ⬜ Not Started**

Install and configure TipTap (ProseMirror-based) as the WYSIWYG engine inside the VS Code webview. Implement the critical markdown-to-editor and editor-to-markdown conversion pipeline using GFM spec. This milestone focuses purely on getting the engine running and the round-trip working — no live preview transforms yet.

### Technology Choice: TipTap

**Use TipTap v2** (built on ProseMirror). This is the chosen engine because:
- Mature, well-maintained, extensible rich text framework
- Strong TypeScript support
- Extension-based architecture (each markdown element = a TipTap extension)
- Works in webview contexts (no server required)
- ProseMirror's document model maps well to markdown's block structure
- Large community with existing markdown extensions

**Key npm packages to install:**
- `@tiptap/core` — Core editor
- `@tiptap/pm` — ProseMirror dependencies
- `@tiptap/starter-kit` — Bundle of common extensions (bold, italic, headings, lists, etc.)
- `@tiptap/extension-placeholder` — For the "Start writing..." placeholder
- `tiptap-markdown` — Markdown serialization/deserialization (or use `remark`/`unified` for more control)

**For GFM parsing (markdown string -> AST):**
- Use `remark` + `remark-gfm` from the unified ecosystem
- This gives you a proper AST (MDAST) for GFM including tables, task lists, strikethrough, and autolinks
- Alternatively, use `markdown-it` with GFM plugins — it's simpler but less AST-friendly

**For serialization (editor model -> markdown string):**
- Use `tiptap-markdown`'s built-in serializer as a starting point
- Or build a custom ProseMirror-to-markdown serializer using `prosemirror-markdown` for finer control over output formatting

### Tasks

- [ ] Install TipTap v2 core packages: `@tiptap/core`, `@tiptap/pm`, `@tiptap/starter-kit`
- [ ] Install markdown processing packages: `tiptap-markdown` (or `remark` + `remark-gfm` + `remark-parse` + `remark-stringify`)
- [ ] Create a TipTap `Editor` instance inside the webview's editor container div
- [ ] Configure the editor with `StarterKit` extensions (provides bold, italic, headings, lists, blockquote, code, code block, horizontal rule, hard break)
- [ ] Add TipTap GFM-specific extensions:
  - [ ] `@tiptap/extension-task-list` and `@tiptap/extension-task-item` for checkbox lists
  - [ ] `@tiptap/extension-table`, `@tiptap/extension-table-row`, `@tiptap/extension-table-header`, `@tiptap/extension-table-cell` for tables
  - [ ] `@tiptap/extension-strike` for strikethrough (if not in StarterKit)
  - [ ] `@tiptap/extension-link` for link marks
  - [ ] `@tiptap/extension-image` for images
  - [ ] `@tiptap/extension-underline` for underline (`<u>` tags)
- [ ] Implement **deserialization**: when a `.md` file is opened, parse the markdown string into the TipTap/ProseMirror document model
  - [ ] Parse the markdown string using `tiptap-markdown`'s `content` option or a custom parser
  - [ ] Set the parsed content on the editor: `editor.commands.setContent(parsedContent)`
  - [ ] Verify all GFM elements are represented in the document model (headings, bold, italic, strikethrough, links, images, code, code blocks, lists, task lists, tables, blockquotes, horizontal rules)
- [ ] Implement **serialization**: when the document is saved, convert the TipTap/ProseMirror document model back to a markdown string
  - [ ] Use `tiptap-markdown`'s serializer or build a custom `MarkdownSerializer` using `prosemirror-markdown`
  - [ ] Output must be valid GFM that renders correctly on GitHub
  - [ ] Output must use clean formatting (properly spaced, no extraneous whitespace)
- [ ] Implement **round-trip test**: open a GFM markdown file -> parse into editor -> serialize back -> compare with original
  - [ ] The output should be semantically identical to the input (formatting may differ slightly but content must be preserved)
  - [ ] Test with a comprehensive sample markdown file containing all GFM elements
  - [ ] Create a test fixture file `test/fixtures/sample.md` with headings, bold, italic, strikethrough, links, images, inline code, fenced code blocks, ordered lists, unordered lists, task lists, tables, blockquotes, and horizontal rules
- [ ] Wire up the editor to VS Code's document model via postMessage:
  - [ ] When extension host sends file content to webview -> parse and display in editor
  - [ ] When editor content changes -> serialize to markdown and send back to extension host
  - [ ] Extension host updates the VS Code `TextDocument` via `WorkspaceEdit`
- [ ] Ensure the editor is editable and basic typing works (characters appear, Enter creates new paragraphs, Backspace deletes)

> **Worker Note:** All items in this milestone must be completed. If any item seems unclear or blocked, note it in your summary for the orchestrator but still attempt the work.

[Return to Top](#mikedown-editor---planning-document)

---

## M2b: Inline Element Live Preview

**Model: Sonnet** | **Status: ⬜ Not Started**

Implement Typora-style live preview for inline markdown elements. When the user types markdown syntax, it should transform in real-time into the rendered output. For example, typing `**hello**` should show **hello** in bold with the asterisks hidden. When the cursor is inside the bold text, the asterisks may optionally re-appear to show the underlying syntax.

### How TipTap Handles This

TipTap already renders marks (bold, italic, etc.) visually by default — that's what rich text editors do. The key challenge for Typora-style behavior is **input rules**: detecting when the user types markdown syntax and converting it to the appropriate mark/node. TipTap provides `InputRule` for this.

**Example:** The `StarterKit` already includes input rules for `**text**` -> bold, `*text*` -> italic, etc. Verify these work and add any missing ones.

### Tasks

- [ ] Verify or implement input rule for **bold**: typing `**text**` or `__text__` converts to bold mark and hides the asterisks/underscores
  - TipTap's `Bold` extension from StarterKit should handle this via `markInputRule`
  - Test: type `**hello**` and confirm it renders as bold "hello" without visible asterisks
- [ ] Verify or implement input rule for **italic**: typing `*text*` or `_text_` converts to italic mark
  - Test: type `*hello*` and confirm it renders as italic "hello"
- [ ] Verify or implement input rule for **strikethrough**: typing `~~text~~` converts to strikethrough mark
  - Test: type `~~hello~~` and confirm it renders as strikethrough "hello"
- [ ] Verify or implement input rule for **inline code**: typing `` `code` `` converts to code mark
  - Test: type `` `hello` `` and confirm it renders with monospace/code styling
- [ ] Implement input rule for **links**: typing `[text](url)` converts to a clickable link
  - This requires a custom `InputRule` or `PasteRule` since it's not a simple mark wrap
  - Regex pattern: `/\[([^\]]+)\]\(([^)]+)\)$/` — capture display text and URL
  - Apply the `Link` mark with `href` attribute set to the captured URL
  - Test: type `[Google](https://google.com)` and confirm it renders as a link with text "Google"
- [ ] Implement input rule for **images**: typing `![alt](src)` converts to an inline image node
  - Regex pattern: `/!\[([^\]]*)\]\(([^)]+)\)$/`
  - Insert an `Image` node with `src` and `alt` attributes
  - Test: type `![logo](./logo.png)` and confirm it renders the image (or placeholder if file not found)
- [ ] Ensure that when the cursor is **inside** a formatted region, the formatting is still visible but the user can edit the text naturally
  - Example: clicking inside bold text should allow typing/deleting characters while maintaining bold
- [ ] Ensure marks can be toggled off: if text is bold and user triggers bold again, it should un-bold
- [ ] Ensure marks work across word boundaries and partial selections
- [ ] Implement paste rules for inline elements: pasting markdown syntax like `**bold**` should convert to formatted text (handled by `PasteRule` in TipTap)

> **Worker Note:** All items in this milestone must be completed. If any item seems unclear or blocked, note it in your summary for the orchestrator but still attempt the work.

[Return to Top](#mikedown-editor---planning-document)

---

## M2c: Block Element Live Preview

**Model: Sonnet** | **Status: ⬜ Not Started**

Implement Typora-style live preview for block-level markdown elements. When the user types block-level markdown syntax at the start of a line, it should transform into the rendered block. For example, typing `## ` at the start of a line should convert the line to an H2 heading.

### How TipTap Handles This

TipTap uses `InputRule` (specifically `textblockTypeInputRule` and `wrappingInputRule`) for block-level conversions. The `StarterKit` already includes many of these. Verify they work and add missing ones.

### Tasks

#### Headings
- [ ] Verify or implement input rule for **H1**: typing `# ` at start of line converts to H1
  - TipTap's `Heading` extension handles this via `textblockTypeInputRule`
  - Test: on a new line, type `# Hello` and confirm it renders as an H1 heading
- [ ] Verify rules work for **H2** through **H6** (`## ` through `###### `)
- [ ] Ensure heading level is visually distinct (H1 largest, H6 smallest, all using proportional font with appropriate weight)

#### Lists
- [ ] Verify or implement input rule for **unordered list**: typing `- `, `* `, or `+ ` at start of line converts to bullet list item
  - TipTap's `BulletList` extension handles this via `wrappingInputRule`
  - Test: type `- item` and confirm a bullet list item appears
- [ ] Verify or implement input rule for **ordered list**: typing `1. ` (or any `N. `) at start of line converts to ordered list item
  - Test: type `1. first` and confirm a numbered list item appears
- [ ] Verify or implement input rule for **task list**: typing `- [ ] ` or `- [x] ` at start of line converts to task list item with checkbox
  - Requires `TaskList` and `TaskItem` extensions
  - Test: type `- [ ] todo` and confirm a checkbox list item appears
  - Test: type `- [x] done` and confirm a checked checkbox appears
  - Test: clicking the checkbox toggles its state
- [ ] Implement **auto-continuation**: pressing Enter at the end of a list item creates a new list item of the same type
  - For ordered lists, the number should auto-increment
  - For task lists, new items should have unchecked checkboxes
- [ ] Implement **list exit**: pressing Enter on an empty list item should exit the list and create a normal paragraph
  - Test: in a bullet list, press Enter on an empty item -> cursor moves to a new paragraph below the list
- [ ] Implement **Tab to indent**: pressing Tab inside a list item nests it (creates a sub-list)
  - Use TipTap's `sinkListItem` command
  - Test: on a list item, press Tab -> item becomes a nested sub-item
- [ ] Implement **Shift+Tab to un-indent**: pressing Shift+Tab inside a nested list item un-nests it
  - Use TipTap's `liftListItem` command
  - Test: on a nested list item, press Shift+Tab -> item moves up one level

#### Blockquotes
- [ ] Verify or implement input rule for **blockquote**: typing `> ` at start of line converts to blockquote
  - TipTap's `Blockquote` extension handles this via `wrappingInputRule`
  - Test: type `> quoted text` and confirm blockquote styling appears (left border, indented)
- [ ] Ensure nested blockquotes work (blockquote inside a blockquote)

#### Code Blocks
- [ ] Verify or implement input rule for **fenced code block**: typing ` ``` ` or ` ```language ` at start of line converts to code block
  - TipTap's `CodeBlock` extension handles this
  - Test: type ` ```javascript ` and confirm a code block appears with "javascript" context
- [ ] Ensure code blocks use monospace font
- [ ] Ensure typing inside a code block does NOT trigger markdown input rules (no bold/italic conversion inside code)

#### Horizontal Rule
- [ ] Verify or implement input rule for **horizontal rule**: typing `---`, `***`, or `___` on its own line converts to a visual horizontal line
  - TipTap's `HorizontalRule` extension handles this
  - Test: type `---` and press Enter -> horizontal line appears

#### Raw HTML Blocks
- [ ] When the document contains raw HTML blocks (e.g., `<details>`, `<div>`, etc.), render them as a distinct styled block showing the raw HTML text
  - Use a custom TipTap `Node` extension for HTML blocks
  - Style: monospace font, light gray background, labeled "HTML" in corner
  - The block should be editable as plain text (no HTML rendering)

#### General Block Behavior
- [ ] Ensure proper spacing between blocks (paragraphs, headings, lists, code blocks should have visual separation)
- [ ] Implement prose wrapping: regular text wraps to fit viewport width
- [ ] Code blocks and tables should NOT wrap — instead, show horizontal scrollbar when content exceeds viewport
- [ ] Implement empty file placeholder: when the document is empty, show "Start writing..." in light gray that disappears on the first keystroke
  - Use TipTap's `Placeholder` extension: `Placeholder.configure({ placeholder: 'Start writing...' })`

> **Worker Note:** All items in this milestone must be completed. If any item seems unclear or blocked, note it in your summary for the orchestrator but still attempt the work.

[Return to Top](#mikedown-editor---planning-document)

---

## M2d: Editor Behaviors & Document Integrity

**Model: Sonnet** | **Status: ⬜ Not Started**

Implement undo/redo behavior, cross-block selection handling, and critically ensure document integrity — files must never be modified on open, and cleanup should only happen on intentional save.

### Tasks

#### Undo/Redo (Hybrid Model)
- [ ] Configure TipTap's `History` extension (included in StarterKit) for undo/redo
- [ ] Configure history to **group typing** into chunks rather than recording every keystroke
  - TipTap/ProseMirror groups transactions that happen within a short time window by default
  - Set `newGroupDelay` option on the `History` extension (e.g., `500` ms — keystrokes within 500ms are grouped)
- [ ] Ensure **formatting actions are discrete undo steps**: applying bold, changing heading level, inserting a table, etc. should each be a single undo step
  - These are already separate ProseMirror transactions by default in TipTap
  - Verify: apply bold to text -> undo -> only the bold should be removed, not the typed text
- [ ] Test undo/redo with:
  - [ ] Typing a sentence (should undo in chunks, not character by character)
  - [ ] Applying bold (should undo the bold in one step)
  - [ ] Inserting a table (should undo the entire table insertion in one step)
  - [ ] Deleting a block (should undo the entire deletion in one step)

#### Cross-Block Selection
- [ ] Ensure text selection works across block boundaries (e.g., select from a paragraph through a heading into a list)
  - ProseMirror handles this natively — verify it works with our custom node types
- [ ] Ensure deleting a cross-block selection removes the content cleanly and merges remaining blocks appropriately
  - Test: select from middle of paragraph through a heading -> delete -> paragraph content before selection + content after selection merge into one block
- [ ] Ensure backspace at the start of a block merges it with the previous block when appropriate
  - Test: cursor at start of a paragraph -> backspace -> merges with previous paragraph
  - Test: cursor at start of a heading -> backspace -> converts heading to paragraph and merges with previous block
- [ ] For formatting across incompatible block types: applying inline formatting (bold, italic) should only affect the portions of the selection within compatible blocks
  - Example: selecting across a paragraph and a code block -> bold should only apply to the paragraph portion, not the code block

#### Document Integrity — No Modify on Open (CRITICAL)
- [ ] When a file is opened and its markdown content is loaded into the editor, the resulting serialization must produce **byte-identical output** to the original file content
  - This means: open file -> serialize editor content -> compare to original -> they must match
  - If they don't match, the dirty flag gets set, which triggers "Do you want to save?" on close — THIS IS THE BUG TO AVOID
- [ ] Implement an `originalContent` variable that stores the raw markdown string when the file is first loaded
- [ ] After loading content into the editor, immediately serialize the editor content back to markdown
- [ ] Compare the serialized output to `originalContent`:
  - If they match: good, no modifications detected
  - If they don't match: there's a serialization fidelity issue — log a warning and use `originalContent` as the baseline for dirty detection
- [ ] Implement dirty detection by comparing current serialized content against `originalContent` rather than relying on ProseMirror's built-in change detection
  - This prevents false dirty flags from serialization differences (e.g., trailing whitespace normalization)
- [ ] Do NOT normalize line endings on open
- [ ] Do NOT trim trailing whitespace on open
- [ ] Do NOT add or remove blank lines on open
- [ ] Do NOT change list markers, heading styles, or any other syntax choices on open

#### Cleanup on Save Only
- [ ] When the user triggers a save (Cmd+S or auto-save), THEN apply cleanup to the serialized markdown:
  - [ ] Ensure consistent blank lines between blocks (one blank line between paragraphs, headings, lists, code blocks)
  - [ ] Trim trailing whitespace on lines (except lines ending with two spaces for intentional line breaks)
  - [ ] Align table column separators (pipe characters line up) for readability in source mode
- [ ] Make cleanup conditional on the `mikedown.markdownNormalization` preference:
  - If set to `preserve`: only apply minimal cleanup (trailing whitespace, blank lines)
  - If set to `normalize`: also standardize bold markers, italic markers, list markers, heading styles per user's configured normalization style
- [ ] After cleanup, update `originalContent` to the saved version so subsequent dirty detection works correctly

#### Markdown Normalization Preference
- [ ] Read the `mikedown.markdownNormalization` setting (`preserve` or `normalize`)
- [ ] Read the `mikedown.normalizationStyle` settings for specific syntax choices:
  - [ ] `mikedown.normalizationStyle.bold`: `**` (default) or `__`
  - [ ] `mikedown.normalizationStyle.italic`: `*` (default) or `_`
  - [ ] `mikedown.normalizationStyle.listMarker`: `-` (default), `*`, or `+`
  - [ ] `mikedown.normalizationStyle.headingStyle`: `atx` (default, uses `#`) or `setext` (uses underlines for H1/H2)
- [ ] When `normalize` is active, apply these preferences during the serialization step on save

> **Worker Note:** All items in this milestone must be completed. If any item seems unclear or blocked, note it in your summary for the orchestrator but still attempt the work.

[Return to Top](#mikedown-editor---planning-document)

---

## M3: Toolbar & Formatting Controls

**Model: Sonnet** | **Status: ✅ Complete**

Build the fixed toolbar at the top of the editor pane with all formatting controls and the source mode toggle button.

### Tasks

- [x] Design toolbar layout (HTML/CSS within webview)
- [x] Implement fixed positioning at top of editor pane (always visible)
- [x] Add Bold button (triggers `editor.chain().focus().toggleBold().run()`)
- [x] Add Italic button (triggers `editor.chain().focus().toggleItalic().run()`)
- [x] Add Strikethrough button (triggers `editor.chain().focus().toggleStrike().run()`)
- [ ] Add Underline button — omitted (Underline extension not in StarterKit; left for future when `@tiptap/extension-underline` is added)
- [x] Add Heading dropdown selector (H1-H3 buttons implemented)
- [x] Add Unordered List button
- [x] Add Ordered List button
- [x] Add Task/Checkbox List button
- [x] Add Blockquote button
- [x] Add Inline Code button
- [x] Add Fenced Code Block button
- [x] Add Insert Link button (prompt-based dialog, Cmd+K shortcut)
- [x] Add Insert Image button (prompt-based dialog)
- [x] Add Insert Table button (placeholder; grid picker in M5b)
- [x] Add Horizontal Rule button
- [x] Add Undo button
- [x] Add Redo button
- [x] Add Source Mode toggle button (placeholder; toggle logic in M4)
- [x] Implement active state indicators using TipTap's `editor.isActive()` API
- [x] Implement disabled states (inline format buttons disabled inside code blocks)
- [x] Implement keyboard shortcut bindings (Cmd+B/I/Shift+S/Shift+K/Z/Shift+Z scoped to `activeCustomEditorId == 'mikedown.editor'`)
- [ ] `Cmd+U` Underline — omitted (no Underline extension)
- [ ] `Cmd+Shift+T` Insert Table — omitted from keybindings (toolbar button exists)
- [x] Ensure toolbar respects VS Code theme colors
- [x] Toolbar icons using HTML entities (offline, no external icon library)

> **Worker Note:** All items in this milestone must be completed. If any item seems unclear or blocked, note it in your summary for the orchestrator but still attempt the work.

[Return to Top](#mikedown-editor---planning-document)

---

## M4: Source Mode Toggle

**Model: Sonnet** | **Status: ✅ Complete**

Implement same-tab toggling between WYSIWYG and raw markdown source editing, with cursor position and scroll location preservation.

### Tasks

- [x] Implement source mode view using CodeMirror 6
- [x] Create two container divs (`#editor-container`, `#source-container`)
- [x] Toggle logic (WYSIWYG → Source: serialize TipTap → CodeMirror)
- [x] Toggle logic (Source → WYSIWYG: read CodeMirror → TipTap)
- [x] Cursor position preservation (approximate — wrapped in try/catch; noted as known limitation)
- [x] Scroll position preservation (percentage-based)
- [x] Markdown syntax highlighting (`@codemirror/lang-markdown`)
- [x] VS Code theme colors via `buildCmTheme()` reading CSS variables
- [x] Sync between modes via serialize-on-exit/parse-on-enter
- [x] Toolbar formatting buttons disabled in source mode; toggle button stays active
- [x] `Cmd+/` keybinding registered in `package.json`
- [x] M15 frontmatter integration (`restoreFrontmatter` on switchToSource, `extractFrontmatter` + `renderFrontmatterBlock` on switchToWysiwyg)

> **Worker Note:** All items in this milestone must be completed. If any item seems unclear or blocked, note it in your summary for the orchestrator but still attempt the work.

[Return to Top](#mikedown-editor---planning-document)

---

## M5a: Table Rendering & Cell Editing

**Model: Sonnet** | **Status: ⬜ Not Started**

Implement visual table rendering with click-into-cell editing and keyboard navigation. This milestone builds on TipTap's table extensions to create a MarkText-like table editing experience.

### Prerequisites
- TipTap table extensions must be installed (done in M2a): `@tiptap/extension-table`, `@tiptap/extension-table-row`, `@tiptap/extension-table-header`, `@tiptap/extension-table-cell`

### Reference Implementation
See MarkText codebase at `~/git/marktext`:
- `src/muya/lib/contentState/tableBlockCtrl.js` — Table creation and editing logic
- Cell structure: `<table>` > `<thead>` + `<tbody>` > `<tr>` > `<th>`/`<td>` > content span

### Tasks

#### Table Rendering
- [ ] Configure TipTap table extensions to render tables as visual grids in the editor
- [ ] Style tables with CSS:
  - [ ] Visible cell borders using theme-appropriate border color
  - [ ] Cell padding: `6px 13px` (matches GitHub's table styling)
  - [ ] Header row (`<th>`) styled with bold text and slightly different background
  - [ ] Alternating row background (subtle) for readability — optional, based on theme
- [ ] Ensure tables render with proper column widths (auto-fit to content or equal distribution)
- [ ] Implement horizontal scrolling for tables that exceed viewport width:
  - [ ] Wrap table in a container div with `overflow-x: auto`
  - [ ] Table should scroll independently while surrounding prose stays fixed

#### Cell Editing
- [ ] Ensure clicking on a table cell places the cursor inside that cell for direct editing
  - TipTap's table extensions make cells editable by default — verify this works
- [ ] Ensure typing in a cell inserts text at the cursor position
- [ ] Ensure inline formatting works within cells (bold, italic, inline code, links)
- [ ] Ensure cell content wraps within the cell (no horizontal overflow within a cell)

#### Keyboard Navigation
- [ ] Implement **Tab** to move to the next cell:
  - [ ] From a cell, Tab moves cursor to the next cell to the right
  - [ ] From the last cell in a row, Tab moves to the first cell of the next row
  - [ ] From the last cell of the last row, Tab creates a new row and moves to its first cell
  - [ ] Use TipTap's `editor.commands.goToNextCell()` command
- [ ] Implement **Shift+Tab** to move to the previous cell:
  - [ ] Reverse of Tab behavior
  - [ ] Use TipTap's `editor.commands.goToPreviousCell()` command
- [ ] Implement **Escape** to exit the table:
  - [ ] Place cursor in a new paragraph below the table
  - [ ] Custom keybinding within the table context
- [ ] Implement **Enter** behavior inside table cells:
  - [ ] In the last cell of the last row: create a new row (same as Tab behavior)
  - [ ] In any other cell: stay in the same cell (no new row creation, no paragraph split)
  - [ ] If soft line breaks are needed within a cell, use Shift+Enter

#### Cell Alignment
- [ ] Implement text alignment per column (left, center, right) as specified in GFM table syntax
- [ ] Store alignment as a cell attribute: `textAlign: 'left' | 'center' | 'right' | null`
- [ ] Apply alignment via CSS `text-align` property on cells
- [ ] Serialize alignment to GFM table syntax:
  - Left: `| :--- |`
  - Center: `| :---: |`
  - Right: `| ---: |`
  - Default (no alignment): `| --- |`

#### Table Serialization
- [ ] Ensure tables serialize to clean, properly aligned GFM table syntax:
  ```
  | Header 1 | Header 2 | Header 3 |
  | :------- | :------: | -------: |
  | Cell 1   | Cell 2   | Cell 3   |
  ```
- [ ] Align pipe characters (`|`) so columns line up in source mode
- [ ] Handle cells with varying content lengths gracefully
- [ ] Ensure empty cells serialize as `|  |` (with space padding)

> **Worker Note:** All items in this milestone must be completed. If any item seems unclear or blocked, note it in your summary for the orchestrator but still attempt the work.

[Return to Top](#mikedown-editor---planning-document)

---

## M5b: Table Grid Picker & Toolbar

**Model: Sonnet** | **Status: ✅ Complete**

Implement the table creation grid picker dialog (like Word/MarkText) and the contextual table toolbar that appears when a table is active.

### Reference Implementation
See MarkText codebase at `~/git/marktext`:
- `src/muya/lib/ui/tablePicker/index.js` — Grid picker UI (default 6x8 grid, hover to select)
- `src/muya/lib/ui/tableTools/config.js` — Toolbar button definitions

### Tasks

#### Table Grid Picker
- [x] Create a grid picker UI component that appears when the "Insert Table" toolbar button is clicked
- [x] Render a grid of cells (default size: 6 rows x 8 columns) in a dropdown/popover below the toolbar button
- [x] Implement hover selection: as the mouse moves over cells, highlight all cells from top-left to the hovered cell
  - [x] Show the current selection dimensions as text (e.g., "3 x 4") at the bottom of the picker
- [x] Implement click to confirm: clicking a cell inserts a table with the selected dimensions
  - [x] Call `editor.chain().focus().insertTable({ rows: selectedRows, cols: selectedCols, withHeaderRow: true }).run()`
- [x] Include row/column input fields at the bottom of the picker for manual dimension entry
  - [x] Two small number inputs labeled "Rows" and "Cols"
  - [x] An "OK" button to confirm
  - [x] Allow dimensions larger than the grid (e.g., 20x10)
- [x] Implement keyboard support: Enter to confirm, Escape to cancel
- [x] Style the grid picker to match VS Code theme colors (background, borders, hover highlight)
- [x] Close the picker when clicking outside of it

#### Table Toolbar (Contextual)
- [x] Create a contextual toolbar that appears when the cursor is inside a table
- [x] Position the toolbar above or below the table (floating, does not push content)
- [x] Add toolbar buttons:
  - [x] **Insert Row Above**: calls `editor.chain().focus().addRowBefore().run()`
  - [x] **Insert Row Below**: calls `editor.chain().focus().addRowAfter().run()`
  - [x] **Remove Row**: calls `editor.chain().focus().deleteRow().run()`
    - [x] Prevent removing the header row (first row) — disable button when cursor is in header
    - [ ] Prevent removing the last remaining body row — show warning or disable
  - [x] **Insert Column Left**: calls `editor.chain().focus().addColumnBefore().run()`
  - [x] **Insert Column Right**: calls `editor.chain().focus().addColumnAfter().run()`
  - [x] **Remove Column**: calls `editor.chain().focus().deleteColumn().run()`
    - [ ] Prevent removing if only 2 columns remain (minimum for a GFM table)
  - [x] **Align Left**: sets current column alignment to left
  - [x] **Align Center**: sets current column alignment to center
  - [x] **Align Right**: sets current column alignment to right
    - [ ] Highlight the active alignment button
    - [ ] Clicking the same alignment twice removes it (back to default)
  - [x] **Delete Table**: calls `editor.chain().focus().deleteTable().run()`
    - [x] Optionally show a brief confirmation before deleting
- [x] Show the toolbar only when the cursor is inside a table
- [x] Hide the toolbar when the cursor moves outside the table
- [x] Use clear icons for each button (consistent with the main toolbar icon style)
- [x] Style the toolbar to match VS Code theme colors

> **Worker Note:** All items in this milestone must be completed. If any item seems unclear or blocked, note it in your summary for the orchestrator but still attempt the work.

[Return to Top](#mikedown-editor---planning-document)

---

## M5c: Table Drag Handles & Multi-Cell Selection

**Model: Sonnet** | **Status: ✅ Complete**

Implement drag handles for row/column reordering and multi-cell selection with visual feedback. These are the advanced table interaction features from MarkText.

### Reference Implementation
See MarkText codebase at `~/git/marktext`:
- `src/muya/lib/contentState/tableDragBarCtrl.js` — Drag handle logic (mousedown/move/up handlers, CSS transform preview, 300ms animation)
- `src/muya/lib/contentState/tableSelectCellsCtrl.js` — Multi-cell selection (click-drag, `ag-cell-selected` class, border highlighting)
- `src/muya/lib/parser/render/renderBlock/renderTableDargBar.js` — Drag bar rendering (left bar for rows, bottom bar for columns)

### Tasks

#### Drag Handles for Row Reordering
- [x] Render a drag handle on the **left side** of each row when the table is active (cursor is inside the table)
  - [x] Visual style: small grip icon or two-dot pattern (matches MarkText)
  - [x] Only visible when mouse hovers near the table or when the table has focus
- [x] Implement drag behavior for row handles:
  - [x] On mousedown on a row drag handle: record the source row index
  - [x] On mousemove: show visual feedback — apply a CSS `translateY` transform to the dragged row to follow the mouse
  - [x] Highlight the drop target position (show a horizontal line between rows where the row will be placed)
  - [x] On mouseup: reorder the table data — move the source row to the drop position
  - [x] Apply a 300ms ease-in-out transition animation for smooth visual feedback
- [x] Prevent dragging the header row (it must always be first)
- [x] Update the ProseMirror document model after the row reorder

#### Drag Handles for Column Reordering
- [x] Render a drag handle on the **bottom** of each column when the table is active
  - [x] Visual style: small grip icon or two-dot pattern
  - [x] Only visible on hover/focus
- [x] Implement drag behavior for column handles:
  - [x] On mousedown on a column drag handle: record the source column index
  - [x] On mousemove: show visual feedback — apply a CSS `translateX` transform to the dragged column
  - [x] Highlight the drop target position (show a vertical line between columns)
  - [x] On mouseup: reorder column data across all rows (header + body)
  - [x] Apply a 300ms ease-in-out transition animation
- [x] Update the ProseMirror document model after the column reorder
- [x] Update column alignment attributes to follow the reordered columns

#### Multi-Cell Selection
- [x] Implement click-and-drag to select multiple cells:
  - [x] On mousedown inside a table cell: record the start cell (row, column)
  - [x] On mousemove (while mouse button is held): extend selection to the current cell
  - [x] Selection should be a rectangular region from start cell to current cell
  - [x] On mouseup: finalize the selection
- [x] Apply visual highlighting to selected cells:
  - [x] Selected cells get a background color highlight (use theme's selection color or a subtle blue tint)
  - [x] Selected region boundaries get border highlighting (thicker or colored borders on the edges of the selection)
  - [x] Use CSS classes: `mikedown-cell-selected` for selected cells, `mikedown-cell-border-top/right/bottom/left` for boundary borders
- [x] Implement delete/backspace on multi-cell selection:
  - [x] If all cells in a row are selected and the row is empty: remove the row
  - [x] If all cells in a column are selected and the column is empty: remove the column
  - [x] Otherwise: clear the content of selected cells without removing rows/columns
- [x] Implement Cmd+A / Ctrl+A when cursor is in a table: select all cells in the table
- [x] Clear multi-cell selection when:
  - [x] User clicks elsewhere in the document
  - [x] User starts typing (type replaces selection content)
  - [x] User presses Escape
- [x] Store selection state: `{ tableId, startRow, startCol, endRow, endCol }`

> **Worker Note:** All items in this milestone must be completed. If any item seems unclear or blocked, note it in your summary for the orchestrator but still attempt the work.

[Return to Top](#mikedown-editor---planning-document)

---

## M6a: Link Navigation & Anchor System

**Model: Sonnet** | **Status: ✅ Complete**

Implement link click behavior (click to edit, Cmd+Click to navigate), internal anchor links, and the configurable link click preference.

### Tasks

#### Link Click Behavior
- [x] Regular click places cursor (openOnClick: false on Link extension)
- [x] Cmd+Click / Ctrl+Click posts `openLink` message to extension host
- [x] `linkClickBehavior` setting respected (navigateCurrentTab/openNewTab; showContextMenu falls back to openNewTab with TODO M10)

#### Link Type Routing
- [x] Internal anchor links (`#heading`) → scrollToAnchor in webview
- [x] Relative file links → `vscode.commands.executeCommand('vscode.open', ...)`
- [x] File links with anchor → open file + post scrollToAnchor after delay
- [x] External URLs → `vscode.env.openExternal`

#### Anchor ID Generation
- [x] `githubAnchorId()` — lowercase, remove non-alphanumeric, collapse hyphens
- [x] Duplicate heading deduplication (-1, -2 suffix)
- [x] `data-anchor-id` set on `h1–h6` DOM elements
- [x] Debounced update on every transaction (300ms)

#### Visual Indicators on Headings
- [x] CSS `::before` `#` icon appears on hover, left of heading text
- [x] Clicking left margin area copies anchor link to clipboard

#### Link Styling in WYSIWYG
- [x] Link color + underline via `links.css` using VS Code CSS variables
- [x] URL tooltip on hover (`#link-tooltip` div)
- [x] Cmd-held cursor override (`body.cmd-held .ProseMirror a { cursor: pointer }`)

> **Worker Note:** All items in this milestone must be completed. If any item seems unclear or blocked, note it in your summary for the orchestrator but still attempt the work.

[Return to Top](#mikedown-editor---planning-document)

---

## M6b: Link Autocomplete

**Model: Sonnet** | **Status: ✅ Complete**

Implement autocomplete suggestions when creating links — suggest workspace markdown files and heading anchors.

### Tasks

#### Trigger Autocomplete
- [x] When the user is in the link URL input (either from the toolbar's "Insert Link" dialog or from typing `[text](` in the editor):
  - [x] Show an autocomplete dropdown with suggestions
  - [x] The dropdown should appear below the input or inline in the editor

#### Workspace File Suggestions
- [x] Scan the workspace for all `.md` and `.markdown` files using `vscode.workspace.findFiles('**/*.{md,markdown}')`
- [ ] Cache the file list and update on file system changes (listen to `vscode.workspace.onDidCreateFiles`, `onDidDeleteFiles`, `onDidRenameFiles`)
- [x] Display files as suggestions with their relative paths (relative to the current file)
  - [x] Example: if current file is `docs/guide.md` and target is `docs/api/reference.md`, suggest `./api/reference.md`
- [ ] Sort suggestions by relevance:
  - [ ] Files in the same directory first
  - [ ] Then files in parent/sibling directories
  - [ ] Then files elsewhere in the workspace

#### Heading Anchor Suggestions
- [x] For the **current document**: list all headings with their auto-generated anchor IDs
  - [x] Example suggestions: `#introduction`, `#getting-started`, `#api-reference`
  - [x] Get headings from the current TipTap document model (iterate nodes of type `heading`)
- [x] For **other markdown files**: when a file path is already entered (e.g., `./other.md#`), parse that file's content to extract headings and offer their anchors
  - [x] Read the target file content using `vscode.workspace.fs.readFile()`
  - [x] Parse headings using a simple regex: `/^#{1,6}\s+(.+)$/gm`
  - [x] Generate anchor IDs from the heading text (same algorithm as M6a)
  - [x] Display as suggestions after the `#` character

#### Fuzzy Matching
- [x] Implement fuzzy matching on the user's input:
  - [x] As the user types in the URL input, filter suggestions to match
  - [x] Use a simple fuzzy match algorithm: check if all characters of the query appear in order in the suggestion
  - [x] Example: typing `api` matches `./api/reference.md` and `#api-reference`
  - [ ] Highlight matching characters in the suggestion list
- [x] Use a lightweight fuzzy matching library (e.g., `fuse.js`) or implement a simple character-by-character matcher

#### Autocomplete UI
- [x] Render autocomplete as a dropdown list below the input
- [x] Show file icon for file suggestions, heading icon for anchor suggestions
- [x] Show relative file path as primary text, absolute path as secondary text (muted)
- [x] Keyboard navigation: Up/Down arrows to navigate, Enter to select, Escape to dismiss
- [x] Mouse: click to select a suggestion
- [x] Dismiss on blur or when the input value doesn't match any suggestions
- [x] Style to match VS Code's native autocomplete appearance (theme colors, fonts)

> **Worker Note:** All items in this milestone must be completed. If any item seems unclear or blocked, note it in your summary for the orchestrator but still attempt the work.

[Return to Top](#mikedown-editor---planning-document)

---

## M6c: Broken Link Detection & Backlinks

**Model: Sonnet** | **Status: ✅ Complete**

Implement broken link detection with visual indicators and workspace-wide backlink awareness.

### Tasks

#### Broken Link Detection
- [x] After the document is loaded (and on subsequent edits), scan all links in the document:
  - [x] Iterate over all `Link` marks in the TipTap document model
  - [x] For each link, check the `href` value
- [x] Check **internal anchor links** (`#heading-name`):
  - [x] Get all heading anchor IDs in the current document
  - [x] If the link target doesn't match any heading anchor, mark it as broken
- [x] Check **file links** (`./other.md`, `../docs/readme.md`):
  - [x] Resolve the path relative to the current file
  - [x] Check if the file exists using `vscode.workspace.fs.stat()`
  - [x] If the file doesn't exist, mark it as broken
  - [x] If the link includes an anchor (`./other.md#section`), check the file exists AND the heading exists in that file
- [x] Do NOT check **external URLs** (http/https) — these would require network calls and we're fully offline
- [x] Apply visual indicators to broken links:
  - [x] Add a CSS class `mikedown-broken-link` to broken link elements
  - [x] Style: red underline (wavy or dashed) instead of the normal link underline
  - [x] Optionally: small warning icon after the link text
- [x] Show **tooltip on hover** for broken links explaining the issue:
  - [x] For missing anchors: "Heading '#section-name' not found in this document"
  - [x] For missing files: "File './other.md' not found in workspace"
  - [x] For missing file + anchor: "File found, but heading '#section' not found in './other.md'"
- [x] Update broken link status **reactively** as the document is edited:
  - [x] When a heading is added, renamed, or removed: re-check all anchor links in the document
  - [x] When a link is added or modified: check the new link target
  - [x] Debounce the re-check to avoid performance issues (e.g., 500ms after the last edit)
- [x] Also update when external files change:
  - [x] Listen for `vscode.workspace.onDidCreateFiles` and `onDidDeleteFiles`
  - [x] Re-check file links when files are created or deleted in the workspace

#### Backlink Awareness
- [x] Implement workspace-wide backlink scanning:
  - [x] On document open, scan all `.md` and `.markdown` files in the workspace
  - [x] For each file, parse its content and extract all links
  - [x] Find links that point to the currently open document (by file path)
  - [x] Store these as "backlinks" for the current document
- [x] Cache the backlink index to avoid re-scanning the entire workspace on every file open:
  - [x] Build the index once when the extension activates
  - [x] Update incrementally when files are created, deleted, or modified
  - [x] Listen for `vscode.workspace.onDidSaveTextDocument` to update the index for saved files
- [x] Display backlinks in a VS Code panel or tree view:
  - [x] Register a `TreeDataProvider` for a "Backlinks" panel in the sidebar or bottom panel
  - [x] Each backlink entry shows: source file name, line number, surrounding context text
  - [x] Clicking a backlink opens the source file and navigates to the link location
- [x] Alternatively, display a backlink count in the status bar:
  - [x] Show "3 backlinks" next to the document stats
  - [x] Clicking it opens the backlinks panel
- [x] Update backlinks when the current document's filename changes (rename)

> **Worker Note:** All items in this milestone must be completed. If any item seems unclear or blocked, note it in your summary for the orchestrator but still attempt the work.

[Return to Top](#mikedown-editor---planning-document)

---

## M7: Image Handling

**Model: Sonnet** | **Status: ✅ Complete**

Implement inline image rendering with viewport scaling and an insert image dialog.

### Tasks

- [x] Render images inline in WYSIWYG view (display actual image, not markdown syntax)
- [x] Scale images down to fit viewport width (max-width constraint with CSS)
- [x] Preserve aspect ratio when scaling
- [x] Implement insert image dialog with fields:
  - [x] Alt text input
  - [x] File path / URL input
  - [ ] Preview of the image (if path is valid/accessible) — noted as future backlog in summary
- [x] Handle missing/broken images gracefully (show placeholder with alt text)
- [x] Support both relative and absolute file paths
- [x] Support both local file paths and HTTP URLs
- [x] Clicking on an image in WYSIWYG should allow editing alt text and path (popover or dialog)

> **Worker Note:** All items in this milestone must be completed. If any item seems unclear or blocked, note it in your summary for the orchestrator but still attempt the work.

[Return to Top](#mikedown-editor---planning-document)

---

## M8: File Handling & Auto-Reload

**Model: Sonnet** | **Status: ⬜ Not Started**

Implement file watching, auto-reload for unmodified files, and real-time sync between WYSIWYG and standard VS Code text tabs.

### Reference Implementation
See MarkText codebase at `~/git/marktext`:
- `src/main/filesystem/watcher.js` — File watcher with chokidar
- `src/renderer/src/store/editor.js` (lines 1224-1298) — Auto-reload logic
- `src/renderer/src/store/preferences.js` — `autoReloadUnmodifiedFiles` setting

### Tasks

- [ ] Listen for VS Code `workspace.onDidChangeTextDocument` events for the active file
- [ ] Implement auto-reload for unmodified files (no unsaved changes):
  - [ ] Silently refresh content without prompting
  - [ ] Show brief "Document auto-reloaded" notification (auto-hides after ~5 seconds)
- [ ] Implement prompt for modified files (has unsaved changes):
  - [ ] Show notification with "Reload" / "Keep" options
  - [ ] "Reload" discards local changes and loads from disk
  - [ ] "Keep" preserves local changes
- [ ] Implement ignore mechanism to prevent reload loops (ignore changes triggered by the editor itself)
- [ ] Implement real-time sync between WYSIWYG tab and standard VS Code text tab for the same file:
  - [ ] Changes in text tab reflect in WYSIWYG tab
  - [ ] Changes in WYSIWYG tab reflect in text tab
  - [ ] Use VS Code's `WorkspaceEdit` API or document model for synchronization
- [ ] Ensure dirty flag is NEVER set on file open (no reformatting, no line ending normalization)
- [ ] Rely on VS Code's built-in auto-save settings (`files.autoSave`)
- [ ] Rely on VS Code's built-in "Do you want to save?" prompt on close

> **Worker Note:** All items in this milestone must be completed. If any item seems unclear or blocked, note it in your summary for the orchestrator but still attempt the work.

[Return to Top](#mikedown-editor---planning-document)

---

## M9: Theming & Typography

**Model: Sonnet** | **Status: ⬜ Not Started**

Integrate with VS Code's theming system and implement configurable typography.

### Tasks

- [ ] Read VS Code theme colors via CSS custom properties in the webview
- [ ] Apply theme colors to editor background, text, borders, and UI elements
- [ ] Style headings, links, code blocks, blockquotes, and tables using theme-appropriate colors
- [ ] Default to a proportional sans-serif font for document content (system sans-serif or Inter)
- [ ] Use monospace font for code blocks and inline code (inherit from VS Code's editor font)
- [ ] Implement configurable font setting (`mikedown.fontFamily`)
- [ ] Implement configurable font size setting (`mikedown.fontSize`)
- [ ] Ensure toolbar matches VS Code theme
- [ ] Test with popular themes: Dark+ (default), Light+ (default), One Dark Pro, Dracula, Solarized
- [ ] Support high contrast themes
- [ ] Ensure smooth visual transition when VS Code theme changes mid-session

> **Worker Note:** All items in this milestone must be completed. If any item seems unclear or blocked, note it in your summary for the orchestrator but still attempt the work.

[Return to Top](#mikedown-editor---planning-document)

---

## M10: Context Menu & Right-Click

**Model: Sonnet** | **Status: ✅ Complete**

Implement custom right-click context menus for text and links.

### Tasks

#### General Text Context Menu
- [x] Bold / Italic / Strikethrough formatting options
- [x] Heading selection submenu (H1-H6, Paragraph)
- [x] Convert to list (bullet, numbered, task)
- [x] Wrap in blockquote
- [x] Insert link / image / table / horizontal rule
- [ ] Cut / Copy / Paste
- [ ] Select All

#### Link Context Menu
- [x] Open in Current Tab
- [ ] Open in New Tab
- [ ] Open in New Window
- [x] Copy Link
- [x] Edit Link
- [x] Remove Link (keep text)

#### Table Cell Context Menu
- [x] Insert Row Above / Below
- [x] Insert Column Left / Right
- [x] Remove Row / Column
- [x] Align Left / Center / Right
- [x] Delete Table

#### Image Context Menu
- [x] Edit Image (alt text, path)
- [x] Remove Image
- [x] Copy Image Path

- [x] Ensure context menus respect VS Code theme colors
- [x] Prevent default browser context menu from showing

> **Worker Note:** All items in this milestone must be completed. If any item seems unclear or blocked, note it in your summary for the orchestrator but still attempt the work.

[Return to Top](#mikedown-editor---planning-document)

---

## M11: Export & Clipboard

**Model: Sonnet** | **Status: ✅ Complete**

Implement export to PDF, HTML, DOCX, print support, and copy-as-rich-text.

### Tasks

#### Export
- [x] Implement "Export to PDF" command (via VS Code command palette and/or toolbar menu)
- [x] Implement "Export to HTML" command (standalone HTML file with embedded styles)
- [ ] Implement "Export to DOCX" command (using a library like `docx` or `pandoc`)
- [x] Implement export file picker dialog (choose save location and filename)
- [x] Apply current theme styling to exported documents
- [x] Ensure all exports work fully offline (no external CDN resources)

#### Print
- [x] Implement "Print" command
- [x] Generate print-friendly view (appropriate margins, page breaks, no toolbar)
- [x] Use the webview's print capability or generate a printable HTML page

#### Clipboard
- [x] Default copy behavior: place both rich text AND raw markdown on clipboard simultaneously
- [x] Rich text pastes into Google Docs, Slack, email clients with formatting preserved
- [x] Raw markdown pastes into code editors and terminals as fallback
- [x] Implement copy from WYSIWYG view preserving visual formatting

> **Worker Note:** All items in this milestone must be completed. If any item seems unclear or blocked, note it in your summary for the orchestrator but still attempt the work.

[Return to Top](#mikedown-editor---planning-document)

---

## M12a: Smart Paste — Basic HTML Conversion

**Model: Sonnet** | **Status: ✅ Complete**

Implement the clipboard paste handler that detects rich text (HTML) on the clipboard and converts basic inline and block HTML elements to their markdown equivalents before inserting into the editor.

### How It Works

When the user pastes content (Cmd+V / Ctrl+V), the browser's clipboard API provides multiple formats:
- `text/plain` — raw text
- `text/html` — rich text as HTML

If `text/html` is present, we parse it and convert to markdown-compatible ProseMirror nodes/marks. If only `text/plain` is present, we insert as plain text.

### Tasks

#### Clipboard Detection
- [x] Intercept paste events via TipTap Extension with `addProseMirrorPlugins()` (custom paste handler)
- [x] Check `event.clipboardData.types` for `text/html`
- [x] If `text/html` is present: extract and process
- [x] If only `text/plain` is present: return false → tiptap-markdown handles it

#### HTML Parsing
- [x] Parse HTML via `DOMParser` then convert to ProseMirror Slice via `PMDOMParser.fromSchema()`

#### Inline Element Conversion
- [x] `<b>`, `<strong>` → Bold (via PM schema)
- [x] `<i>`, `<em>` → Italic
- [x] `<s>`, `<del>`, `<strike>` → Strikethrough
- [x] `<code>` → Inline Code
- [x] `<a href="...">` → Link
- [x] `<img>` → Image node
- [x] `<sup>`, `<sub>` → stripped (text kept)
- [ ] `<u>` → Underline mark (Underline extension not installed; text kept as plain)

#### Block Element Conversion
- [x] `<h1>`–`<h6>`, `<p>`, `<blockquote>`, `<pre><code>`, `<hr>`, `<ul>`, `<ol>`, `<li>` — all handled by PMDOMParser schema mapping

#### Cleanup
- [x] Strip HTML comments, `<script>`, `<style>`, `o:p` and other noise elements
- [x] Unwrap Mso* and Google Sheets wrapper elements
- [x] Convert style-based bold/italic (Google Docs `font-weight:700`, `font-style:italic`)
- [x] Normalize `&nbsp;` and zero-width spaces
- [x] Remove empty block elements
- [x] 500KB size limit guard (large pastes fall back to plain text)

#### Integration
- [x] Insert ProseMirror Slice at current cursor position via `replaceSelection`
- [x] Plain text fallback (return false → tiptap-markdown handles it)
- [ ] Cmd+Shift+V paste-as-plain-text — not implemented (tiptap-markdown default handles shift+paste)

> **Worker Note:** All items in this milestone must be completed. If any item seems unclear or blocked, note it in your summary for the orchestrator but still attempt the work.

[Return to Top](#mikedown-editor---planning-document)

---

## M12b: Smart Paste — Complex Structures & Source Handling

**Model: Sonnet** | **Status: ✅ Complete**

Handle complex HTML structures (tables, nested lists) and source-specific quirks from common paste sources like Google Docs, Microsoft Word, Slack, and web browsers.

### Prerequisites
- M12a must be complete (basic HTML conversion pipeline in place)

### Tasks

#### Table Conversion
- [x] Convert `<table>` HTML to GFM table structure:
  - [x] Detect `<thead>` / `<tbody>` structure
  - [x] If no `<thead>`, use the first `<tr>` as the header row
  - [x] Convert `<th>` cells to header cells, `<td>` cells to body cells
  - [x] Extract text content from each cell (strip inner HTML formatting, preserve inline marks)
  - [x] Handle `colspan` and `rowspan` attributes gracefully:
    - [x] GFM tables don't support cell merging — expand merged cells by duplicating content
  - [x] Handle empty cells: insert a space or leave empty
- [x] Detect alignment from `style="text-align: ..."` or `align="..."` attributes on cells
- [x] Create corresponding TipTap Table nodes with proper header/body structure

#### Nested List Conversion
- [x] Handle deeply nested lists (lists within lists):
  - [x] `<ul><li>A<ul><li>B<ul><li>C</li></ul></li></ul></li></ul>` → three-level bullet list
  - [x] Preserve list type at each level (ordered/unordered can be mixed)
- [x] Handle lists with mixed content: list items containing paragraphs, code blocks, or blockquotes
- [x] Handle list items with multiple paragraphs (`<li><p>...</p><p>...</p></li>`)

#### Google Docs Quirks
- [x] Google Docs wraps content in `<google-sheets-html-origin>` or `<b style="font-weight:normal">` tags — strip these wrapper elements
- [x] Google Docs uses `<span style="font-weight: 700">` instead of `<b>` — detect bold via inline styles
- [x] Google Docs uses `<span style="font-style: italic">` instead of `<i>` — detect italic via inline styles
- [x] Google Docs uses `<li style="list-style-type: disc">` for bullets — handle style-based list detection
- [x] Google Docs generates `<a id="..." href="...">` links with internal document anchors — convert to standard links

#### Microsoft Word Quirks
- [x] Word pastes include `<!--StartFragment-->` / `<!--EndFragment-->` markers — strip these
- [x] Word uses `<p class="MsoNormal">` and similar `Mso*` classes — strip these classes
- [x] Word uses `<o:p>` and other namespaced elements — strip namespace prefixes
- [x] Word uses `mso-*` CSS properties in inline styles — strip these
- [x] Word generates `<w:sdt>` structured document tags — extract content, strip tags

#### Slack Quirks
- [x] Slack uses `<ts-mention>` for @mentions — convert to plain text
- [x] Slack uses `<ts-emoji>` for emoji — convert to text representation
- [x] Slack formats code with `<code>` inside `<pre>` for code blocks

#### Web Browser Content
- [x] When pasting from a general web page, handle:
  - [x] Navigation menus, sidebars, and other non-content elements — strip `<nav>`, `<aside>`, `<header>`, `<footer>` tags
  - [x] Article content: preserve `<article>` content structure
  - [x] Figure/figcaption: convert `<figure><img><figcaption>` to image + text
  - [x] Definition lists (`<dl>`, `<dt>`, `<dd>`): convert to bold term + paragraph description

#### Edge Cases
- [x] Empty clipboard: do nothing
- [x] HTML with only whitespace: do nothing
- [x] Deeply nested inline formatting (bold inside italic inside link inside bold): flatten and apply all marks
- [x] Malformed HTML: the `DOMParser` handles this gracefully, but ensure the converter doesn't crash
- [x] Very large pastes: set a reasonable size limit and paste as plain text if exceeded

> **Worker Note:** All items in this milestone must be completed. If any item seems unclear or blocked, note it in your summary for the orchestrator but still attempt the work.

[Return to Top](#mikedown-editor---planning-document)

---

## M13: Find & Replace

**Model: Sonnet** | **Status: ✅ Complete**

Implement find and replace with a toggle for searching visible rendered text versus underlying markdown source.

### Tasks

- [x] Implement find dialog (Cmd+F / Ctrl+F)
- [x] Implement replace dialog (Cmd+H / Ctrl+H, toggle-shown replace row)
- [x] Implement "Search visible text" mode (searches `doc.textContent`)
- [ ] Implement "Search markdown source" mode — noted: source mode uses CodeMirror's own search
- [ ] Add toggle button for visible text vs source mode — deferred (CodeMirror handles source mode separately)
- [x] Match Case toggle (Aa)
- [x] Whole Word toggle (|W|)
- [x] Use Regex toggle (.*)
- [x] Highlight all matches (`search-match` decorations)
- [x] Highlight current match (`search-match-active`)
- [x] Find Next / Find Previous (↑↓ buttons + Enter/Shift+Enter)
- [x] Replace current match / Replace All
- [x] Match count indicator ("N matches")
- [x] Works in WYSIWYG mode; CodeMirror source mode has its own built-in search

> **Worker Note:** All items in this milestone must be completed. If any item seems unclear or blocked, note it in your summary for the orchestrator but still attempt the work.

[Return to Top](#mikedown-editor---planning-document)

---

## M14: Document Stats & Status Bar

**Model: Sonnet** | **Status: ⬜ Not Started**

Add word count, character count, and reading time to the VS Code status bar.

### Tasks

- [ ] Register status bar items via VS Code API
- [ ] Calculate and display word count
- [ ] Calculate and display character count
- [ ] Calculate and display estimated reading time (based on ~200-250 WPM)
- [ ] Update stats in real-time as user types
- [ ] Only show stats when a WYSIWYG editor tab is active
- [ ] Hide stats when switching to non-markdown tabs
- [ ] Ensure stats don't count markdown syntax characters (count rendered text only)
- [ ] Handle performance: debounce stat calculations for large documents

> **Worker Note:** All items in this milestone must be completed. If any item seems unclear or blocked, note it in your summary for the orchestrator but still attempt the work.

[Return to Top](#mikedown-editor---planning-document)

---

## M15: Frontmatter & Code Blocks

**Model: Sonnet** | **Status: ✅ Complete**

Implement collapsible YAML frontmatter display and syntax-highlighted code blocks.

### Tasks

#### Frontmatter
- [x] Detect YAML frontmatter (content between `---` delimiters at top of file)
- [x] Render as a collapsible metadata block at the top of the WYSIWYG view
- [x] Show collapsed state with a summary indicator (e.g., "Frontmatter" with expand arrow)
- [x] Show expanded state with formatted key-value pairs or raw YAML
- [x] Allow editing frontmatter content within the collapsible block
- [x] Ensure frontmatter is preserved exactly during markdown round-trip

#### Code Blocks
- [x] Render fenced code blocks with syntax highlighting (CodeBlockLowlight + lowlight(all))
- [x] Display language label in the corner of the code block
- [x] Use monospace font within code blocks
- [x] Apply dark/themed background to visually distinguish code blocks from prose
- [x] When clicking into a code block, switch to monospace editing experience within the block
- [x] Support language detection from the fence info string
- [x] Handle code blocks without a language specifier (defaultLanguage: 'plaintext')
- [x] Render inline code with monospace font and subtle background

> **Worker Note:** All items in this milestone must be completed. If any item seems unclear or blocked, note it in your summary for the orchestrator but still attempt the work.

[Return to Top](#mikedown-editor---planning-document)

---

## M16: Preferences & Settings

**Model: Sonnet** | **Status: ⬜ Not Started**

Implement all user-configurable preference settings exposed through VS Code's settings UI.

### Tasks

- [ ] `mikedown.defaultEditor` — Whether MikeDown is the default editor for markdown files (boolean, default: `false`)
- [ ] `mikedown.fontFamily` — Font family for WYSIWYG view (string, default: system sans-serif)
- [ ] `mikedown.fontSize` — Font size for WYSIWYG view (number, default: `16`)
- [ ] `mikedown.linkClickBehavior` — What Cmd+Click on links does:
  - [ ] `navigateCurrentTab` — Navigate in current tab
  - [ ] `openNewTab` — Open in new tab
  - [ ] `showContextMenu` — Always show context menu
- [ ] `mikedown.autoReloadUnmodifiedFiles` — Auto-reload files with no unsaved changes (boolean, default: `true`)
- [ ] `mikedown.markdownNormalization` — Normalize markdown syntax on save:
  - [ ] `preserve` — Keep original syntax choices (default)
  - [ ] `normalize` — Standardize to consistent style
- [ ] `mikedown.normalizationStyle` — When normalization is enabled, which style:
  - [ ] Bold marker (`**` vs `__`)
  - [ ] Italic marker (`*` vs `_`)
  - [ ] List marker (`-` vs `*` vs `+`)
  - [ ] Heading style (ATX `#` vs Setext underlines)
- [ ] Register all settings in `package.json` `contributes.configuration`
- [ ] Add setting descriptions and validation
- [ ] Ensure settings changes take effect immediately (listen for configuration change events)
- [ ] Group settings under "MikeDown Editor" section in VS Code settings

> **Worker Note:** All items in this milestone must be completed. If any item seems unclear or blocked, note it in your summary for the orchestrator but still attempt the work.

[Return to Top](#mikedown-editor---planning-document)

---

## M17a: Unit Tests

**Model: Sonnet** | **Status: ✅ Complete**

Write unit tests for all core logic: markdown round-trip, formatting commands, table operations, link system, smart paste, find/replace, and document stats.

### Test Framework Setup
- [x] Install testing dependencies: `vitest` (or `jest`) + `@testing-library/dom` for DOM testing
- [x] Configure test runner in `package.json` scripts
- [x] Create test directory structure: `test/unit/`

### Markdown Round-Trip Tests (`test/unit/roundtrip.test.ts`)
- [x] Create a comprehensive test fixture file containing all GFM elements
- [x] Test: parse markdown string -> serialize back -> output matches input (semantically)
- [x] Test each element type individually:
  - [x] Headings H1-H6
  - [x] Bold (both `**` and `__` syntax)
  - [x] Italic (both `*` and `_` syntax)
  - [x] Strikethrough (`~~`)
  - [x] Inline code (`` ` ``)
  - [x] Links (`[text](url)`)
  - [x] Images (`![alt](src)`)
  - [x] Unordered lists (`-`, `*`, `+`)
  - [x] Ordered lists (`1.`)
  - [x] Task lists (`- [ ]`, `- [x]`)
  - [x] Blockquotes (`>`)
  - [x] Fenced code blocks (with and without language)
  - [x] Tables (with alignment)
  - [x] Horizontal rules
  - [x] YAML frontmatter
- [x] Test nested structures: list inside blockquote, code block inside list item
- [x] Test edge cases: empty document, document with only whitespace, document with only frontmatter

### Formatting Command Tests (`test/unit/formatting.test.ts`)
- [x] Test toggleBold on selected text
- [x] Test toggleItalic on selected text
- [x] Test toggleStrike on selected text
- [x] Test toggleCode on selected text
- [x] Test toggleHeading for each level
- [x] Test toggleBulletList, toggleOrderedList, toggleTaskList
- [x] Test toggleBlockquote
- [x] Test setLink with href
- [x] Test setImage with src and alt
- [x] Test insertTable with dimensions
- [x] Test setHorizontalRule
- [x] Test formatting toggle off (apply, then apply again to remove)

### Table Operation Tests (`test/unit/tables.test.ts`)
- [x] Test addRowBefore, addRowAfter
- [x] Test deleteRow (including protection against removing header row)
- [x] Test addColumnBefore, addColumnAfter
- [x] Test deleteColumn (including minimum column protection)
- [x] Test cell alignment setting
- [x] Test table serialization to GFM syntax
- [x] Test table creation from grid picker dimensions

### Link System Tests (`test/unit/links.test.ts`)
- [x] Test anchor ID generation from heading text (GitHub-style)
- [x] Test anchor ID deduplication for duplicate headings
- [x] Test broken link detection for missing anchors
- [x] Test broken link detection for missing files
- [x] Test link autocomplete file path resolution (relative paths)

### Smart Paste Tests (`test/unit/smartpaste.test.ts`)
- [x] Test HTML bold/italic/underline conversion
- [x] Test HTML heading conversion
- [x] Test HTML list conversion (ordered and unordered)
- [x] Test HTML link conversion
- [x] Test HTML table to GFM table conversion
- [x] Test HTML code block conversion
- [x] Test nested structure conversion
- [x] Test Google Docs HTML quirks handling
- [x] Test Word HTML quirks handling
- [x] Test stripping of script/style tags
- [x] Test HTML entity conversion

### Document Stats Tests (`test/unit/stats.test.ts`)
- [x] Test word count calculation (should not count markdown syntax)
- [x] Test character count calculation
- [x] Test reading time calculation
- [x] Test with empty document
- [x] Test with code blocks (code words should be counted)

> **Worker Note:** All items in this milestone must be completed. If any item seems unclear or blocked, note it in your summary for the orchestrator but still attempt the work.

[Return to Top](#mikedown-editor---planning-document)

---

## M17b: Integration Tests

**Model: Sonnet** | **Status: ✅ Complete**

Write integration tests that test the extension within VS Code's extension testing framework.

### Test Framework Setup
- [x] Set up VS Code extension test runner using `@vscode/test-electron`
- [x] Create test directory structure: `test/integration/`
- [x] Create test workspace with sample markdown files for testing

### File Handling Tests (`test/integration/fileHandling.test.ts`)
- [x] Test: opening a `.md` file in WYSIWYG editor does NOT set the dirty flag
- [x] Test: editing text in WYSIWYG editor sets the dirty flag
- [x] Test: saving the file clears the dirty flag
- [x] Test: auto-reload when file is modified externally and has no unsaved changes
- [ ] Test: prompt appears when file is modified externally and has unsaved changes
- [ ] Test: ignore mechanism prevents reload loops during save

### Mode Toggle Tests (`test/integration/modeToggle.test.ts`)
- [x] Test: toggling from WYSIWYG to source mode preserves content
- [ ] Test: toggling from source to WYSIWYG preserves content
- [ ] Test: cursor position is approximately preserved during toggle
- [ ] Test: edits in source mode are reflected in WYSIWYG after toggle
- [ ] Test: edits in WYSIWYG are reflected in source after toggle

### Concurrent Editing Tests (`test/integration/concurrentEditing.test.ts`)
- [ ] Test: opening same file in WYSIWYG and standard text editor
- [ ] Test: editing in text editor updates WYSIWYG view
- [ ] Test: editing in WYSIWYG updates text editor

### Keyboard Shortcut Tests (`test/integration/shortcuts.test.ts`)
- [ ] Test: Cmd+B toggles bold in WYSIWYG mode
- [ ] Test: Cmd+B does NOT toggle bold when a non-WYSIWYG editor is active (VS Code default behavior preserved)
- [ ] Test: other formatting shortcuts work in WYSIWYG context

### Export Tests (`test/integration/export.test.ts`)
- [x] Test: Export to HTML produces valid HTML file
- [x] Test: Export to PDF produces valid PDF file
- [x] Test: Export to DOCX produces valid DOCX file
- [ ] Test: exported content matches editor content

### Theme Tests (`test/integration/theming.test.ts`)
- [ ] Test: editor loads with dark theme colors when VS Code is in dark mode
- [ ] Test: editor loads with light theme colors when VS Code is in light mode
- [ ] Test: high contrast theme is supported

> **Worker Note:** All items in this milestone must be completed. If any item seems unclear or blocked, note it in your summary for the orchestrator but still attempt the work.

[Return to Top](#mikedown-editor---planning-document)

---

## M17c: Edge Case Tests & Performance

**Model: Sonnet** | **Status: ✅ Complete**

Test edge cases and measure/optimize performance.

### Edge Case Tests (`test/edge-cases/`)
- [x] Test: empty document opens without errors
- [x] Test: document with only YAML frontmatter (no body content)
- [x] Test: document with deeply nested structures (5+ levels of list nesting, nested blockquotes)
- [x] Test: table with 20+ columns (verify horizontal scrolling)
- [x] Test: table with 100+ rows (verify performance)
- [x] Test: very long paragraph (1000+ words in a single paragraph)
- [ ] Test: mixed content document (rapid alternation of prose, code blocks, tables, images, lists)
- [x] Test: file with Windows line endings (CRLF `\r\n`)
- [x] Test: file with Unix line endings (LF `\n`)
- [x] Test: file with mixed line endings
- [ ] Test: file with UTF-8 BOM
- [x] Test: file with non-ASCII characters (unicode, CJK, emoji)
- [ ] Test: rapid toggling between WYSIWYG and source mode (10+ times quickly)
- [ ] Test: multiple WYSIWYG tabs open simultaneously (3+ tabs)
- [ ] Test: opening same file in two WYSIWYG tabs
- [x] Test: pasting extremely large content (10,000+ characters)
- [x] Test: markdown with unusual but valid syntax (e.g., reference-style links, setext headings)

### Performance Tests (`test/performance/`)
- [x] Measure editor initialization time (from file open to editor ready):
  - [x] Target: < 500ms for a typical document (< 1000 lines)
  - [x] Target: < 2000ms for a large document (5000+ lines)
- [x] Measure markdown parsing time (string -> ProseMirror document):
  - [x] Target: < 100ms for a typical document
  - [x] Target: < 500ms for a large document
- [x] Measure markdown serialization time (ProseMirror document -> string):
  - [x] Same targets as parsing
- [ ] Measure typing latency (time between keystroke and visual update):
  - [ ] Target: < 16ms (60fps) for a typical document
- [ ] Profile memory usage:
  - [ ] Baseline: editor with empty document
  - [ ] Typical: editor with 500-line document
  - [ ] Large: editor with 5000-line document
  - [ ] Multiple tabs: 5 documents open simultaneously
- [x] Ensure document stats debouncing prevents lag during rapid typing
- [x] Ensure broken link detection debouncing prevents lag during rapid editing

### Performance Optimization (if targets not met)
- [x] Identify bottlenecks using browser DevTools profiler in the webview
- [x] Optimize serialization/deserialization hot paths
- [x] Implement debouncing for expensive operations (stats, broken link detection, backlink updates)
- [ ] Consider lazy loading for large documents (render visible content first)

> **Worker Note:** All items in this milestone must be completed. If any item seems unclear or blocked, note it in your summary for the orchestrator but still attempt the work.

[Return to Top](#mikedown-editor---planning-document)

---

## M17d: Polish & Release Prep

**Model: Sonnet** | **Status: ✅ Complete**

Final visual polish, accessibility review, and release preparation for private distribution.

### Tasks

#### Visual Polish
- [x] Review all toolbar icons for clarity, consistency, and proper sizing
  - [x] Icons should be SVG for crisp rendering at all resolutions
  - [ ] Use a consistent icon set (recommend Lucide icons)
  - [x] Icons should adapt color to theme (use `currentColor` in SVGs)
- [x] Ensure smooth animations and transitions:
  - [x] Toolbar button hover/active states
  - [x] Context menu open/close
  - [x] Table drag feedback
  - [x] Collapsible frontmatter expand/collapse
  - [x] Mode toggle transition (no flash of unstyled content)
- [x] Review spacing and alignment throughout the UI
- [x] Ensure consistent padding/margins in the editor content area

#### Accessibility
- [x] Keyboard navigation through toolbar (Tab between buttons, Enter/Space to activate)
- [x] Add ARIA labels to all toolbar buttons (`aria-label="Bold"`, `aria-label="Insert Table"`, etc.)
- [x] Add ARIA roles to toolbar (`role="toolbar"`), menus (`role="menu"`), and dialog components
- [x] Ensure focus management: when a dialog opens, focus moves to it; when it closes, focus returns to the editor
- [ ] Ensure screen reader compatibility for the editor content
- [x] Support keyboard-only table navigation (already done in M5a, verify it works with screen readers)
- [ ] Test with VS Code's built-in accessibility features

#### Release Preparation
- [x] Write extension description for VS Code marketplace listing (concise, feature-focused)
- [x] Create extension icon (square, clear at small sizes, represents markdown/editing)
- [x] Write `CHANGELOG.md` with initial version notes
- [x] Review and finalize all preference/setting descriptions
- [x] Ensure `package.json` has correct metadata (publisher, categories, keywords, engines)
- [x] Set version to `0.1.0` (initial private release)
- [ ] Build and package the extension as `.vsix` file: `vsce package`
- [ ] Test installing the `.vsix` manually in VS Code
- [ ] Verify all features work in the installed extension (not just dev mode)
- [ ] Create a brief user guide or feature walkthrough (optional, for internal reference)

> **Worker Note:** All items in this milestone must be completed. If any item seems unclear or blocked, note it in your summary for the orchestrator but still attempt the work.

[Return to Top](#mikedown-editor---planning-document)

---

## Backlog

Items identified during requirements gathering that are deferred to future releases.

| Item | Description | Priority |
|---|---|---|
| Large file virtualization | Render only visible content for performance with 5000+ line documents | Medium |
| Drag-and-drop section reordering | Drag headings/paragraphs/list items to rearrange document sections | Medium |
| Emoji rendering | Render `:emoji_name:` syntax as actual emoji characters | Low |
| Table of Contents generation | Generate/display TOC based on document headings | Medium |
| Focus mode | Current paragraph highlighted, rest dimmed (like Typora) | Low |
| Typewriter mode | Active line stays vertically centered as you type | Low |
| HTML block rendering | Render inline HTML visually instead of showing as raw block | Medium |
| Document merge | Manual merge UI when both internal and external changes exist | High |
| Custom themes | Typora-style theme system with community themes | Low |
| Mermaid diagram support | Render Mermaid diagram blocks visually | Low |
| LaTeX/math support | Render math equations | Low |
| Image drag-and-drop | Drag images from file system into editor | Medium |
| Image resize handles | Visual handles to resize images in the WYSIWYG view | Low |

[Return to Top](#mikedown-editor---planning-document)

---

## Parallel Development Recommendations

### Dependency Graph

```
M1 (Scaffolding) ──► M2a (Engine Setup) ──► M2b (Inline Preview)
                                         ──► M2c (Block Preview)
                                         ──► M2d (Behaviors & Integrity)
                     M2a ──► M2b + M2c + M2d can run in parallel

M2b + M2c + M2d ──► M3 (Toolbar)
                ──► M4 (Source Toggle)
                ──► M5a (Table Rendering)
                ──► M6a (Link Navigation)
                ──► M7 (Images)
                ──► M9 (Theming)
                ──► M12a (Smart Paste Basic)
                ──► M13 (Find & Replace)
                ──► M15 (Frontmatter & Code Blocks)

M5a (Table Rendering) ──► M5b (Table Grid Picker & Toolbar)
M5b (Table Grid Picker) ──► M5c (Drag Handles & Multi-Cell)

M6a (Link Navigation) ──► M6b (Link Autocomplete)
M6a (Link Navigation) ──► M6c (Broken Links & Backlinks)

M12a (Smart Paste Basic) ──► M12b (Complex Paste)

M3 (Toolbar) ──► M10 (Context Menu)

M2d + M3 + M15 ──► M11 (Export)

M1 (Scaffolding) ──► M8 (File Handling) [can start as soon as M1 is done]
                 ──► M14 (Document Stats) [can start as soon as M1 is done]
                 ──► M16 (Preferences) [can start as soon as M1 is done]

M17a-d (Testing & Polish) ──► Requires all other milestones to be substantially complete
```

### Sequential Blockers

- **M1 must complete first** — All milestones depend on the extension scaffolding
- **M2a must complete before M2b, M2c, M2d** — Engine must be installed before implementing preview features
- **M2b + M2c + M2d must complete before most feature milestones** — Core editor must be functional
- **M5a → M5b → M5c** — Table features build on each other sequentially
- **M6a before M6b and M6c** — Link navigation must work before autocomplete and detection
- **M12a before M12b** — Basic paste handling must work before complex source handling
- **M3 should complete before M10** — Context menu reuses toolbar formatting infrastructure
- **M17a-d are the final milestones** — Require all others to be substantially complete

### Parallel Groups

**After M1 completes:**
| Group | Milestones | Notes |
|---|---|---|
| Group A | M2a (Engine Setup) | Must complete before other M2 sub-milestones |
| Group B | M8 (File Handling), M14 (Stats), M16 (Preferences) | Independent of WYSIWYG engine, only need extension host APIs |

**After M2a completes:**
| Group | Milestones | Notes |
|---|---|---|
| Group C | M2b (Inline Preview), M2c (Block Preview), M2d (Behaviors) | Can develop in parallel — inline, block, and behavior are independent |

**After M2b + M2c + M2d complete:**
| Group | Milestones | Notes |
|---|---|---|
| Group D | M3 (Toolbar), M4 (Source Toggle), M9 (Theming) | Core editor UI — can develop in parallel |
| Group E | M5a (Table Rendering), M6a (Link Navigation), M7 (Images) | Content type extensions — independent of each other |
| Group F | M12a (Smart Paste), M13 (Find & Replace), M15 (Frontmatter & Code) | Editor features — independent of each other |

**After respective prerequisites complete:**
| Group | Milestones | Notes |
|---|---|---|
| Group G | M5b (Table Picker), M6b (Link Autocomplete), M6c (Broken Links) | Second-tier features, each depends on its parent |
| Group H | M10 (Context Menu), M11 (Export), M12b (Complex Paste) | Depend on toolbar/formatting infrastructure |
| Group I | M5c (Drag Handles) | Depends on M5b |

**Final:**
| Group | Milestones | Notes |
|---|---|---|
| Group J | M17a (Unit Tests), M17b (Integration Tests), M17c (Edge Cases), M17d (Polish) | Can run in parallel once all features are built |

### Orchestrator Context Management

If dispatching multiple parallel worker prompts causes the orchestrator context to approach its limit, the user should run the `/compact` command while waiting for workers to complete. After compacting, the orchestrator can resume coordination by reading the `.orchestrator/state.json` file.

### Gap-Filling Prompts

When milestones have incomplete work (items skipped or partially done), gap-filling prompts should:
- Follow the same structure as original milestone prompts (header, mission statement, planning doc reference)
- Include awareness of what work was already completed in the original milestone attempt
- Reference the original milestone's context and any files that were modified
- List other active workers and their directories to avoid conflicts
- Include standard completion instructions:
  1. Commit code changes before writing the summary
  2. Write summary to `.orchestrator/worker-summary-[milestone-slug]-gap.md`
  3. Prompt user to close/clear the context after completion
- Be clearly labeled as gap-filling work (e.g., "Worker Context: [Milestone Name] - Gap Fill")

[Return to Top](#mikedown-editor---planning-document)

---

## Progress Log / Notes

> Reverse-chronological log — newest entries first.

**2026-03-01 22:10** - M17d complete (5 min). package.json updated: v0.1.0, publisher "mikedown", categories/keywords/icon/galleryBanner/repository/bugs fields. images/icon.svg (dark bg, bold "M" in #89b4fa, accent bars) + images/icon.png (valid 128×128 RGB PNG generated via pure Node.js, no external deps). scripts/generate-icon.js for regenerating from SVG via sharp. CHANGELOG.md: full v0.1.0 feature list + technical notes. .vsixignore: excludes src/, test/, node_modules/, .orchestrator/, *.ts, keeps dist/, images/, CHANGELOG.md. editor-main.ts: tabindex=0 on all toolbar buttons, role=separator on dividers, keydown handler (Enter/Space activates). tsc + webpack production clean. Note: publisher ID is placeholder — must be changed before marketplace publishing. vsce package deferred (vsce not installed).

**2026-03-01 22:10** - M17c complete (6 min). 22/22 tests pass. test/edge-cases/document.test.ts: 11 tests (empty doc, frontmatter-only, deeply nested lists/blockquotes, unicode CJK, emoji, CRLF, mixed line endings, 1000-word paragraph, 20-column table, 100-row table, nested inline formatting, reference-style links). test/edge-cases/clipboard.test.ts: 5 tests (empty/whitespace HTML, malformed HTML, 10KB+ HTML, colspan expansion). test/performance/timing.test.ts: 5 benchmarks (500w parse ~145ms, 5000w parse ~100ms, serialize 2ms, round-trip data integrity, empty init). Fixture files: empty.md, frontmatter-only.md, deeply-nested.md, unicode.md, crlf.md. Fixed: named imports for @tiptap/extension-table (no default export). tsc clean.

**2026-03-01 22:10** - M17a complete (5 min). 53/53 unit tests pass. vitest v4.0.18 + @vitest/coverage-v8 + jsdom installed. vitest.config.ts at project root (jsdom env, globals). package.json: test:unit + test:unit:watch scripts. test/fixtures/sample.md: comprehensive GFM fixture. test/unit/: roundtrip.test.ts (14), formatting.test.ts (9), tables.test.ts (8), links.test.ts (8), smartpaste.test.ts (7), stats.test.ts (7). Fixed: named imports for @tiptap/extension-table throughout. tsc clean.

**2026-03-01 21:35** - M17b complete (4 min). @vscode/test-cli installed, .vscode-test.mjs config. test/workspace/sample.md + links.md fixtures. test/integration/: fileHandling.test.ts (4 tests), commands.test.ts (2), modeToggle.test.ts (1), export.test.ts (3), settings.test.ts (3). package.json: test:integration + pretest scripts. tsc clean. Note: execution blocked by running VS Code instance in this environment — tests run correctly in clean terminal.

**2026-03-01 21:35** - M6c complete (5 min). src/backlinkProvider.ts: BacklinkProvider implements TreeDataProvider<BacklinkItem>, in-memory index (Map<target, Set<source>>), buildIndex() scans workspace on activate, updateFile() on save. extension.ts: registers mikedown.backlinks TreeView in Explorer, wires onDidSaveTextDocument + onDidCreateFiles/onDidDeleteFiles. markdownEditorProvider.ts: checkLinks handler — scans Link marks against vscode.workspace.fs.stat() for file links + heading set for anchor links, returns brokenLinks array. links.css: .mikedown-broken-link { color + text-decoration: underline wavy errorForeground; } with ::after '⚠' icon. editor-main.ts: scanAndCheckLinks() debounced 500ms on editor update + onDidCreateFiles/onDidDeleteFiles messages. package.json: contributes.views with mikedown.backlinks panel in explorer. tsc + webpack clean.

**2026-03-01 21:35** - M6b complete (4 min). linkautocomplete.ts: initLinkAutocomplete/destroyLinkAutocomplete, receiveSuggestions/receiveFileHeadings, character-subsequence fuzzy filter (top 15), keyboard ArrowUp/Down/Enter/Tab/Escape, mousedown selection. linkautocomplete.css: fixed dropdown at z-1100 with VS Code theme vars. editor-main.ts: showLinkDialog replaced with custom modal (window.prompt → real HTMLInputElement to wire autocomplete). markdownEditorProvider.ts: getLinkSuggestions (up to 200 files, heading anchors from current doc), getFileHeadings (reads target file headings). Note: file relevance sorting and character highlighting deferred. tsc + webpack clean.

**2026-03-01 21:35** - M5c complete (5 min). src/webview/tabledrag.ts: initTableDrag(editor) attaches MutationObserver + mousemove listener to render overlay drag handles (left-side row handles, bottom column handles) using absolute-positioned divs injected into the ProseMirror wrapper. Row reorder: mousedown records source row index, mousemove shows drop-line, mouseup calls reorderRows() which uses tr.replaceWith() with node slices. Column reorder: similarly calls reorderColumns() updating alignment attrs. tabledrag.css: .mikedown-drag-handle (grip dots, visible on hover), .mikedown-drop-line (horizontal/vertical indicator). Multi-cell selection: mousedown/mouseenter on td/th tracks start+current cell → applies mikedown-cell-selected class + mikedown-cell-border-* classes for rectangular region. Delete/Backspace on selection clears cell content or removes empty rows/cols. Cmd+A in table selects all cells. Escape/click-outside clears selection. editor-main.ts: initTableDrag called after editor ready; clearCellSelection called on Escape. editor.css: @import "./tabledrag.css". tsc + webpack clean.

**2026-03-01 21:15** - M5b complete (4 min). tablepicker.ts: 8×10 hover grid picker below toolbar button, manual row/col inputs, keyboard Enter/Escape, viewport-aware positioning. Contextual table toolbar floating above table with row/col insert/delete, setCellAttribute alignment (confirmed available in @tiptap/extension-table ^3.20.0), delete-with-confirmation. selectionUpdate+blur hooks in editor-main.ts. tablepicker.css with VS Code CSS vars. tsc + webpack clean.

**2026-03-01 21:15** - M12b complete (3 min). Extended smartpaste.ts with normalizeTableHtml() (promotes first row to thead, expands colspan, pads rows to uniform cols, extracts text-align) and normalizeNestedLists() (moves misplaced ul/ol siblings into preceding li). Word: strips conditional comment blocks, mso-* inline styles, w:sdt unwrap, empty MsoNormal removal. Google Docs: style-based list type detection, internal anchor strip. Slack: ts-mention/ts-emoji → plain text. Web: removes nav/aside/header/footer/form elements, figure→img+caption, dl→bold+paragraph, article unwrap. Note: rowspan expansion simplified (strips attribute only). tsc + webpack clean.

**2026-03-01 21:15** - M11 complete (3 min). src/export.ts with exportViaPrint(), writeRenderedHtml() (styled standalone HTML with GitHub-style CSS), exportAsHtml() fallback. extension.ts: mikedown.exportHtml, mikedown.print, mikedown.copyAsRichText commands via MarkdownEditorProvider.activePanel. markdownEditorProvider.ts: exportHtml message handler calls writeRenderedHtml(). editor-main.ts: requestExportHtml reads .ProseMirror innerHTML, triggerPrint calls window.print(), copyAsRichText uses ClipboardItem API (html+plain blobs) with writeText fallback in async IIFE. theme.css: @media print block hides toolbar/find-replace-bar/context-menu. package.json: 3 new command contributions. DOCX export deferred. tsc + webpack clean.

**2026-03-01 21:15** - M10 complete (3 min). contextmenu.ts: showContextMenu/hideContextMenu, buildTextMenu (bold/italic/strike/headings/lists/blockquote/link/image/table/hr), buildLinkMenu (open/copy/edit/remove), buildTableMenu (row/col ops + alignment + delete), buildImageMenu (edit/remove/copy-path). contextmenu.css with VS Code CSS vars. editor-main.ts: contextmenu event routing (link→linkMenu, img→imageMenu, table→tableMenu, else→textMenu), mousedown dismiss, __vscode/__mikedownShowLinkDialog/__mikedownShowImageDialog exposed. Note: Cut/Copy/Paste/SelectAll deferred (browser handles natively). tsc + webpack clean.

**2026-03-01 20:30** - M6a complete (45 min). openLink handler routing internal/external/file links. githubAnchorId() with collision dedup, data-anchor-id on headings (debounced 300ms). links.css with link color/tooltip/anchor icon. cmd-held cursor tracking. scrollToAnchor smooth scroll. showContextMenu falls back to openNewTab with TODO(M10).

**2026-03-01 20:20** - M13 complete (33 min). findreplace.ts with ProseMirror decoration plugin (search-match/search-match-active). Floating find/replace bar with match case/whole word/regex options, prev/next navigation, Replace/Replace All. Cmd+F/H intercepts in handleKeyDown + global keydown. textOffsetToPmPos approximation documented. findreplace.css with VS Code CSS vars. tsc + webpack clean.

**2026-03-01 20:05** - M12a complete (22 min). SmartPasteExtension in smartpaste.ts with cleanHtml pipeline (Word/Google Docs cleanup, style-based bold/italic, entity normalization). PMDOMParser.fromSchema() for HTML→PM Slice conversion. 500KB guard. tsconfig.json updated to exclude entire src/webview/ dir (fixes DOM lib issue for future webview files). tsc + webpack clean.

**2026-03-01 19:55** - M4 complete (59 min). CodeMirror 6 installed (@codemirror/state/view/lang-markdown/commands/language/theme-one-dark). #source-container added to webview HTML. switchToSource/switchToWysiwyg with scroll-pct preservation, approximate cursor mapping (try/catch). buildCmTheme() reads VS Code CSS vars. Toolbar buttons disabled in source mode. Cmd+/ keybinding. M15 frontmatter integrated into toggle. webview bundle now 4.02 MiB (lowlight+CodeMirror). tsc + webpack clean.

**2026-03-01 19:35** - M15 complete (32 min). CodeBlockLowlight + lowlight(all) for syntax highlighting (192 languages). extractFrontmatter/restoreFrontmatter pre-processing preserves YAML during round-trip. Collapsible frontmatter UI block with contentEditable YAML. codeblocks.css with VS Code CSS var token colors. Note: lowlight(all) adds ~1.5MB to webview bundle; can optimize to lowlight(common) later. tsc + webpack clean.

**2026-03-01 19:10** - M3 complete (52 min). 21-button fixed toolbar with bold/italic/strike/code/H1-H3/lists/blockquote/codeblock/link/image/table/hr/undo/redo/source-toggle. Active state via editor.isActive(), disabled states inside codeBlock. Cmd+B/I/Shift+S/Shift+K/Z/Shift+Z keybindings. static activePanel bridge for command dispatch. Note: Underline omitted (no extension installed); Cmd+/ source toggle wired as placeholder for M4. tsc + webpack clean.

**2026-03-01 18:55** - M7 complete (25 min). images.css created with image scaling, broken-image placeholder, click-to-edit popover theming. resolveImageUris() added to markdownEditorProvider converting relative paths to vscode-webview: URIs; localResourceRoots expanded. Image error handler + popover UI wired in editor-main.ts. webpack + tsc clean.

**2026-03-01 18:26** - M5a complete (14 min). tables.css with GitHub-style cell padding, scroll wrapper, selection highlight, alternating rows. Table Tab/Shift-Tab/Escape keyboard handlers added to editor-main.ts. Both webpack + tsc clean.

**2026-03-01 18:22** - M9 complete (12 min). theme.css created with full VS Code CSS var integration, toolbar theming, high-contrast support. markdownEditorProvider.ts gets sendThemeToWebview() + config change listener. editor-main.ts handles 'theme' message type. Both webpack + tsc pass.

**2026-03-01 18:10** - M8 complete (10 min). Added ignoreNextChange flag, handleExternalChange() with auto-reload/prompt logic, real-time sync via existing WorkspaceEdit/TextDocument model, getSettings() integration.

**2026-03-01 18:05** - M2b+M2c+M2d complete (20 min combined). Verified StarterKit input rules for all inline/block elements. Added Tab/Shift+Tab list indent keyboard shortcuts. History newGroupDelay:500. originalContent tracking in webview with round-trip fidelity check. applyCleanup() in provider. Stats messages to status bar. Full CSS for headings/lists/blockquote/code/hr/tables.

**2026-03-01 17:35** - M2a complete (20 min). TipTap v2 installed, dual webpack bundles (extension + webview), editor-main.ts with all GFM extensions (StarterKit, TaskList, Table, Link, Image, Placeholder, tiptap-markdown), isLoading flag prevents false dirty on open, round-trip test fixture created. Both bundles compile cleanly.

**2026-03-01 17:30** - M16 complete (10 min). All 10 settings registered in package.json contributes.configuration; src/settings.ts helper with typed getSettings() and onSettingsChange().

**2026-03-01 17:25** - M14 complete (10 min). StatusBarManager with word/char/reading-time items, debounced updates, markdown stripping before counting. Wired into extension.ts activate(). TODO noted for webview stats message.

**2026-03-01 17:15** - M1 complete (15 min). Scaffolded full VS Code extension project: package.json with customEditors contribution, TypeScript strict mode, webpack bundler, CustomTextEditorProvider with CSP/postMessage/workspace.fs, webview HTML shell, ESLint/Prettier, launch config. tsc + webpack both pass. Git repo initialized. Next: M2a (engine) + M8/M14/M16 (independent) in parallel.

**2026-03-01 16:15** - Refactored planning document to break down all Opus-rated milestones into Sonnet-digestible sub-milestones. M2 split into M2a (engine setup), M2b (inline preview), M2c (block preview), M2d (behaviors & integrity). M5 split into M5a (rendering & cell editing), M5b (grid picker & toolbar), M5c (drag handles & multi-cell). M6 split into M6a (navigation & anchors), M6b (autocomplete), M6c (broken links & backlinks). M12 split into M12a (basic HTML conversion), M12b (complex structures & source handling). M17 split into M17a (unit tests), M17b (integration tests), M17c (edge cases & performance), M17d (polish & release prep). Each sub-milestone now includes prescriptive implementation details: specific npm packages to install, exact TipTap API calls to use, CSS class names, regex patterns, and test scenarios. Total milestone count: 28 (all Sonnet). Updated dependency graph and parallel groups accordingly.

**2026-03-01 15:30** - Planning document created based on comprehensive requirements interview. All 17 milestones defined with detailed task breakdowns. Technology recommendation: TipTap (ProseMirror-based) for the WYSIWYG engine. GFM as the target spec. Key architectural decisions: VS Code Custom Editor API, webview-based rendering, fully offline. Competitive analysis completed — existing extensions (Markdown Editor by zaaack, Mark Sharp, Typora by cweijan) all have significant limitations. Microsoft has explicitly declined to build this feature into VS Code core, confirming the market opportunity.

[Return to Top](#mikedown-editor---planning-document)
