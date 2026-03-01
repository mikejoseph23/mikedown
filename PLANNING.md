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
| [M1: Project Scaffolding & Extension Setup](#m1-project-scaffolding--extension-setup) | Sonnet | ⬜ Not Started | — | Foundation: extension manifest, build tooling, Custom Editor API |
| [M2a: WYSIWYG Engine Setup & Markdown Round-Trip](#m2a-wysiwyg-engine-setup--markdown-round-trip) | Sonnet | ⬜ Not Started | — | Install TipTap, configure in webview, implement GFM parse/serialize |
| [M2b: Inline Element Live Preview](#m2b-inline-element-live-preview) | Sonnet | ⬜ Not Started | — | Bold, italic, strikethrough, inline code, links |
| [M2c: Block Element Live Preview](#m2c-block-element-live-preview) | Sonnet | ⬜ Not Started | — | Headings, lists, blockquotes, code blocks, horizontal rules |
| [M2d: Editor Behaviors & Document Integrity](#m2d-editor-behaviors--document-integrity) | Sonnet | ⬜ Not Started | — | Undo/redo, list continuation, nesting, no-modify-on-open, save cleanup |
| [M3: Toolbar & Formatting Controls](#m3-toolbar--formatting-controls) | Sonnet | ⬜ Not Started | — | Fixed toolbar, all formatting actions, keyboard shortcuts |
| [M4: Source Mode Toggle](#m4-source-mode-toggle) | Sonnet | ⬜ Not Started | — | Same-tab toggle, cursor position preservation |
| [M5a: Table Rendering & Cell Editing](#m5a-table-rendering--cell-editing) | Sonnet | ⬜ Not Started | — | Visual table grid, click-into-cell editing, keyboard navigation |
| [M5b: Table Grid Picker & Toolbar](#m5b-table-grid-picker--toolbar) | Sonnet | ⬜ Not Started | — | Insert table dialog, table-specific toolbar controls |
| [M5c: Table Drag Handles & Multi-Cell Selection](#m5c-table-drag-handles--multi-cell-selection) | Sonnet | ⬜ Not Started | — | Row/column reordering, drag preview, multi-cell select |
| [M6a: Link Navigation & Anchor System](#m6a-link-navigation--anchor-system) | Sonnet | ⬜ Not Started | — | Click/Cmd+Click behavior, anchor ID generation, internal links |
| [M6b: Link Autocomplete](#m6b-link-autocomplete) | Sonnet | ⬜ Not Started | — | Workspace file suggestions, heading anchor suggestions, fuzzy match |
| [M6c: Broken Link Detection & Backlinks](#m6c-broken-link-detection--backlinks) | Sonnet | ⬜ Not Started | — | Link validation, visual indicators, workspace backlink scanning |
| [M7: Image Handling](#m7-image-handling) | Sonnet | ⬜ Not Started | — | Inline rendering, viewport scaling, insert dialog |
| [M8: File Handling & Auto-Reload](#m8-file-handling--auto-reload) | Sonnet | ⬜ Not Started | — | File watching, auto-reload, concurrent editing sync |
| [M9: Theming & Typography](#m9-theming--typography) | Sonnet | ⬜ Not Started | — | VS Code theme integration, configurable fonts |
| [M10: Context Menu & Right-Click](#m10-context-menu--right-click) | Sonnet | ⬜ Not Started | — | Custom context menu with formatting options |
| [M11: Export & Clipboard](#m11-export--clipboard) | Sonnet | ⬜ Not Started | — | PDF, HTML, DOCX export, print, copy-as-rich-text |
| [M12a: Smart Paste — Basic HTML Conversion](#m12a-smart-paste--basic-html-conversion) | Sonnet | ⬜ Not Started | — | Detect HTML clipboard, convert inline + block elements to markdown |
| [M12b: Smart Paste — Complex Structures & Source Handling](#m12b-smart-paste--complex-structures--source-handling) | Sonnet | ⬜ Not Started | — | Tables, nested lists, source-specific quirks (Google Docs, Word, etc.) |
| [M13: Find & Replace](#m13-find--replace) | Sonnet | ⬜ Not Started | — | Search visible text vs source toggle |
| [M14: Document Stats & Status Bar](#m14-document-stats--status-bar) | Sonnet | ⬜ Not Started | — | Word count, character count, reading time |
| [M15: Frontmatter & Code Blocks](#m15-frontmatter--code-blocks) | Sonnet | ⬜ Not Started | — | Collapsible YAML frontmatter, syntax-highlighted code blocks |
| [M16: Preferences & Settings](#m16-preferences--settings) | Sonnet | ⬜ Not Started | — | All user-configurable preferences |
| [M17a: Unit Tests](#m17a-unit-tests) | Sonnet | ⬜ Not Started | — | Markdown round-trip, formatting commands, table ops, link system |
| [M17b: Integration Tests](#m17b-integration-tests) | Sonnet | ⬜ Not Started | — | File handling, mode toggle, sync, shortcuts, export, theming |
| [M17c: Edge Case Tests & Performance](#m17c-edge-case-tests--performance) | Sonnet | ⬜ Not Started | — | Empty docs, line endings, encoding, large content, profiling |
| [M17d: Polish & Release Prep](#m17d-polish--release-prep) | Sonnet | ⬜ Not Started | — | Icons, animations, accessibility, README, extension icon |

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

**Model: Sonnet** | **Status: ⬜ Not Started**

Initialize the VS Code extension project with proper build tooling, extension manifest, and the Custom Editor API foundation that all subsequent milestones build upon.

### Tasks

- [ ] Initialize project with `yo code` generator (TypeScript extension)
- [ ] Configure `package.json` with extension metadata (name: `mikedown-editor`, display name: `MikeDown Editor`)
- [ ] Set up TypeScript compilation with strict mode
- [ ] Configure webpack/esbuild bundler for extension packaging
- [ ] Register Custom Editor provider in `package.json` for `.md` and `.markdown` file types
- [ ] Implement `CustomTextEditorProvider` with basic webview panel
- [ ] Set up Content Security Policy (CSP) for webview (fully offline — no external resources)
- [ ] Create basic webview HTML shell with toolbar placeholder and editor container
- [ ] Set up message passing between extension host and webview (postMessage API)
- [ ] Implement file read/write through VS Code's `workspace.fs` API
- [ ] Configure `.vsixignore` for clean packaging
- [ ] Set up ESLint and Prettier for code quality
- [ ] Create development launch configuration (`.vscode/launch.json`)
- [ ] Verify extension activates and opens `.md` files in the custom editor
- [ ] Set up the preference to optionally register as default editor for `.md`/`.markdown` files

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

**Model: Sonnet** | **Status: ⬜ Not Started**

Build the fixed toolbar at the top of the editor pane with all formatting controls and the source mode toggle button.

### Tasks

- [ ] Design toolbar layout (HTML/CSS within webview)
- [ ] Implement fixed positioning at top of editor pane (always visible)
- [ ] Add Bold button (triggers `editor.chain().focus().toggleBold().run()`)
- [ ] Add Italic button (triggers `editor.chain().focus().toggleItalic().run()`)
- [ ] Add Strikethrough button (triggers `editor.chain().focus().toggleStrike().run()`)
- [ ] Add Underline button (de-emphasized/overflow position, triggers `editor.chain().focus().toggleUnderline().run()`, inserts `<u>` HTML)
- [ ] Add Heading dropdown selector (H1-H6) (triggers `editor.chain().focus().toggleHeading({ level: N }).run()`)
- [ ] Add Unordered List button (triggers `editor.chain().focus().toggleBulletList().run()`)
- [ ] Add Ordered List button (triggers `editor.chain().focus().toggleOrderedList().run()`)
- [ ] Add Task/Checkbox List button (triggers `editor.chain().focus().toggleTaskList().run()`)
- [ ] Add Blockquote button (triggers `editor.chain().focus().toggleBlockquote().run()`)
- [ ] Add Inline Code button (triggers `editor.chain().focus().toggleCode().run()`)
- [ ] Add Fenced Code Block button (triggers `editor.chain().focus().toggleCodeBlock().run()`)
- [ ] Add Insert Link button (opens dialog for text + URL, then calls `editor.chain().focus().setLink({ href: url }).run()`)
- [ ] Add Insert Image button (opens dialog for alt text + path/URL, then calls `editor.chain().focus().setImage({ src, alt }).run()`)
- [ ] Add Insert Table button (opens grid picker — implementation in M5b, placeholder button for now)
- [ ] Add Horizontal Rule button (triggers `editor.chain().focus().setHorizontalRule().run()`)
- [ ] Add Undo button (triggers `editor.chain().focus().undo().run()`)
- [ ] Add Redo button (triggers `editor.chain().focus().redo().run()`)
- [ ] Add Source Mode toggle button (prominent, clearly labeled — toggle logic implemented in M4, placeholder button for now)
- [ ] Implement active state indicators using TipTap's `editor.isActive()` API:
  - [ ] Bold button highlighted when `editor.isActive('bold')`
  - [ ] Italic button highlighted when `editor.isActive('italic')`
  - [ ] Heading dropdown shows current level when `editor.isActive('heading', { level: N })`
  - [ ] List buttons highlighted when `editor.isActive('bulletList')`, `editor.isActive('orderedList')`, `editor.isActive('taskList')`
  - [ ] Update active states on every `editor.on('selectionUpdate')` and `editor.on('transaction')` event
- [ ] Implement disabled states:
  - [ ] Disable inline formatting buttons (bold, italic, code) when cursor is inside a code block (`editor.isActive('codeBlock')`)
  - [ ] Disable block-level buttons that don't apply in certain contexts
- [ ] Implement keyboard shortcut bindings via VS Code's `keybindings` contribution in `package.json` with `when` clause scoped to WYSIWYG context:
  - [ ] `Cmd+B` / `Ctrl+B` — Bold (override VS Code's sidebar toggle)
  - [ ] `Cmd+I` / `Ctrl+I` — Italic
  - [ ] `Cmd+U` / `Ctrl+U` — Underline
  - [ ] `Cmd+Shift+S` — Strikethrough
  - [ ] `Cmd+Shift+K` — Inline code
  - [ ] `Cmd+Shift+T` — Insert table
  - [ ] `Cmd+K` — Insert link
  - [ ] `Cmd+Z` / `Ctrl+Z` — Undo
  - [ ] `Cmd+Shift+Z` / `Ctrl+Shift+Z` — Redo
  - [ ] Use `when: "activeCustomEditorId == 'mikedown.editor'"` to scope overrides to WYSIWYG tabs only
- [ ] Ensure toolbar respects VS Code theme colors (read CSS custom properties from webview)
- [ ] Ensure toolbar icons are clear and recognizable (use SVG icons or a lightweight icon set like Lucide)

> **Worker Note:** All items in this milestone must be completed. If any item seems unclear or blocked, note it in your summary for the orchestrator but still attempt the work.

[Return to Top](#mikedown-editor---planning-document)

---

## M4: Source Mode Toggle

**Model: Sonnet** | **Status: ⬜ Not Started**

Implement same-tab toggling between WYSIWYG and raw markdown source editing, with cursor position and scroll location preservation.

### Tasks

- [ ] Implement source mode view using **CodeMirror 6** within the webview
  - CodeMirror 6 is lightweight, extensible, and works well in webview contexts
  - Install: `@codemirror/state`, `@codemirror/view`, `@codemirror/lang-markdown`, `@codemirror/theme-one-dark` (or equivalent)
  - Alternative: use a simple `<textarea>` with syntax highlighting via Prism.js if CodeMirror adds too much bundle weight
- [ ] Create two container divs in the webview: one for TipTap (WYSIWYG), one for CodeMirror (source)
- [ ] Implement toggle logic:
  - [ ] When toggling WYSIWYG -> Source: serialize TipTap content to markdown string, set it in CodeMirror, hide TipTap container, show CodeMirror container
  - [ ] When toggling Source -> WYSIWYG: read markdown string from CodeMirror, parse into TipTap, hide CodeMirror container, show TipTap container
- [ ] Implement cursor position preservation (WYSIWYG -> Source):
  - [ ] Get the current ProseMirror cursor position (character offset in the document)
  - [ ] Map it to the corresponding line and column in the raw markdown string
  - [ ] Strategy: serialize the document up to the cursor position, count the characters in the serialized output to determine the offset in the markdown string
  - [ ] Set CodeMirror's cursor to that position
- [ ] Implement cursor position preservation (Source -> WYSIWYG):
  - [ ] Get CodeMirror's cursor position (line + column -> character offset in markdown string)
  - [ ] Parse the markdown string up to that offset to determine which ProseMirror node/position corresponds
  - [ ] Strategy: serialize the full document, then binary search for the ProseMirror position whose serialized offset matches the CodeMirror offset
  - [ ] Set TipTap's cursor to that position via `editor.commands.setTextSelection(pos)`
- [ ] Implement scroll position preservation:
  - [ ] Before toggling, record the approximate percentage scrolled (scrollTop / scrollHeight)
  - [ ] After toggling, set the new view's scroll position to the same percentage
  - [ ] Alternatively: find the first visible line/node before toggle and scroll to the corresponding position after toggle
- [ ] Apply markdown syntax highlighting in source mode:
  - [ ] Use `@codemirror/lang-markdown` for syntax highlighting
  - [ ] Configure GFM extensions for proper table and task list highlighting
- [ ] Ensure source mode uses VS Code theme colors:
  - [ ] Create a custom CodeMirror theme that reads from VS Code CSS custom properties
  - [ ] Match background, text color, selection color, and syntax highlighting to the active VS Code theme
- [ ] Sync changes between modes: edits made in source mode should be reflected when toggling back to WYSIWYG, and vice versa
  - This is handled naturally by the toggle logic (serialize on exit, parse on enter)
- [ ] Ensure toolbar remains visible in source mode:
  - [ ] Hide or disable formatting buttons (bold, italic, heading, etc.) since they don't apply in source mode
  - [ ] Keep the source mode toggle button visible and active (so user can toggle back)
  - [ ] Optionally show a "Source Mode" label or indicator
- [ ] Implement keyboard shortcut for toggle: `Cmd+/` or `Ctrl+/`
  - [ ] Register via VS Code keybinding with `when: "activeCustomEditorId == 'mikedown.editor'"`
  - [ ] The shortcut should work in both WYSIWYG and source mode

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

**Model: Sonnet** | **Status: ⬜ Not Started**

Implement the table creation grid picker dialog (like Word/MarkText) and the contextual table toolbar that appears when a table is active.

### Reference Implementation
See MarkText codebase at `~/git/marktext`:
- `src/muya/lib/ui/tablePicker/index.js` — Grid picker UI (default 6x8 grid, hover to select)
- `src/muya/lib/ui/tableTools/config.js` — Toolbar button definitions

### Tasks

#### Table Grid Picker
- [ ] Create a grid picker UI component that appears when the "Insert Table" toolbar button is clicked
- [ ] Render a grid of cells (default size: 6 rows x 8 columns) in a dropdown/popover below the toolbar button
- [ ] Implement hover selection: as the mouse moves over cells, highlight all cells from top-left to the hovered cell
  - [ ] Show the current selection dimensions as text (e.g., "3 x 4") at the bottom of the picker
- [ ] Implement click to confirm: clicking a cell inserts a table with the selected dimensions
  - [ ] Call `editor.chain().focus().insertTable({ rows: selectedRows, cols: selectedCols, withHeaderRow: true }).run()`
- [ ] Include row/column input fields at the bottom of the picker for manual dimension entry
  - [ ] Two small number inputs labeled "Rows" and "Cols"
  - [ ] An "OK" button to confirm
  - [ ] Allow dimensions larger than the grid (e.g., 20x10)
- [ ] Implement keyboard support: Enter to confirm, Escape to cancel
- [ ] Style the grid picker to match VS Code theme colors (background, borders, hover highlight)
- [ ] Close the picker when clicking outside of it

#### Table Toolbar (Contextual)
- [ ] Create a contextual toolbar that appears when the cursor is inside a table
- [ ] Position the toolbar above or below the table (floating, does not push content)
- [ ] Add toolbar buttons:
  - [ ] **Insert Row Above**: calls `editor.chain().focus().addRowBefore().run()`
  - [ ] **Insert Row Below**: calls `editor.chain().focus().addRowAfter().run()`
  - [ ] **Remove Row**: calls `editor.chain().focus().deleteRow().run()`
    - [ ] Prevent removing the header row (first row) — disable button when cursor is in header
    - [ ] Prevent removing the last remaining body row — show warning or disable
  - [ ] **Insert Column Left**: calls `editor.chain().focus().addColumnBefore().run()`
  - [ ] **Insert Column Right**: calls `editor.chain().focus().addColumnAfter().run()`
  - [ ] **Remove Column**: calls `editor.chain().focus().deleteColumn().run()`
    - [ ] Prevent removing if only 2 columns remain (minimum for a GFM table)
  - [ ] **Align Left**: sets current column alignment to left
  - [ ] **Align Center**: sets current column alignment to center
  - [ ] **Align Right**: sets current column alignment to right
    - [ ] Highlight the active alignment button
    - [ ] Clicking the same alignment twice removes it (back to default)
  - [ ] **Delete Table**: calls `editor.chain().focus().deleteTable().run()`
    - [ ] Optionally show a brief confirmation before deleting
- [ ] Show the toolbar only when the cursor is inside a table
- [ ] Hide the toolbar when the cursor moves outside the table
- [ ] Use clear icons for each button (consistent with the main toolbar icon style)
- [ ] Style the toolbar to match VS Code theme colors

> **Worker Note:** All items in this milestone must be completed. If any item seems unclear or blocked, note it in your summary for the orchestrator but still attempt the work.

[Return to Top](#mikedown-editor---planning-document)

---

## M5c: Table Drag Handles & Multi-Cell Selection

**Model: Sonnet** | **Status: ⬜ Not Started**

Implement drag handles for row/column reordering and multi-cell selection with visual feedback. These are the advanced table interaction features from MarkText.

### Reference Implementation
See MarkText codebase at `~/git/marktext`:
- `src/muya/lib/contentState/tableDragBarCtrl.js` — Drag handle logic (mousedown/move/up handlers, CSS transform preview, 300ms animation)
- `src/muya/lib/contentState/tableSelectCellsCtrl.js` — Multi-cell selection (click-drag, `ag-cell-selected` class, border highlighting)
- `src/muya/lib/parser/render/renderBlock/renderTableDargBar.js` — Drag bar rendering (left bar for rows, bottom bar for columns)

### Tasks

#### Drag Handles for Row Reordering
- [ ] Render a drag handle on the **left side** of each row when the table is active (cursor is inside the table)
  - [ ] Visual style: small grip icon or two-dot pattern (matches MarkText)
  - [ ] Only visible when mouse hovers near the table or when the table has focus
- [ ] Implement drag behavior for row handles:
  - [ ] On mousedown on a row drag handle: record the source row index
  - [ ] On mousemove: show visual feedback — apply a CSS `translateY` transform to the dragged row to follow the mouse
  - [ ] Highlight the drop target position (show a horizontal line between rows where the row will be placed)
  - [ ] On mouseup: reorder the table data — move the source row to the drop position
  - [ ] Apply a 300ms ease-in-out transition animation for smooth visual feedback
- [ ] Prevent dragging the header row (it must always be first)
- [ ] Update the ProseMirror document model after the row reorder

#### Drag Handles for Column Reordering
- [ ] Render a drag handle on the **bottom** of each column when the table is active
  - [ ] Visual style: small grip icon or two-dot pattern
  - [ ] Only visible on hover/focus
- [ ] Implement drag behavior for column handles:
  - [ ] On mousedown on a column drag handle: record the source column index
  - [ ] On mousemove: show visual feedback — apply a CSS `translateX` transform to the dragged column
  - [ ] Highlight the drop target position (show a vertical line between columns)
  - [ ] On mouseup: reorder column data across all rows (header + body)
  - [ ] Apply a 300ms ease-in-out transition animation
- [ ] Update the ProseMirror document model after the column reorder
- [ ] Update column alignment attributes to follow the reordered columns

#### Multi-Cell Selection
- [ ] Implement click-and-drag to select multiple cells:
  - [ ] On mousedown inside a table cell: record the start cell (row, column)
  - [ ] On mousemove (while mouse button is held): extend selection to the current cell
  - [ ] Selection should be a rectangular region from start cell to current cell
  - [ ] On mouseup: finalize the selection
- [ ] Apply visual highlighting to selected cells:
  - [ ] Selected cells get a background color highlight (use theme's selection color or a subtle blue tint)
  - [ ] Selected region boundaries get border highlighting (thicker or colored borders on the edges of the selection)
  - [ ] Use CSS classes: `mikedown-cell-selected` for selected cells, `mikedown-cell-border-top/right/bottom/left` for boundary borders
- [ ] Implement delete/backspace on multi-cell selection:
  - [ ] If all cells in a row are selected and the row is empty: remove the row
  - [ ] If all cells in a column are selected and the column is empty: remove the column
  - [ ] Otherwise: clear the content of selected cells without removing rows/columns
- [ ] Implement Cmd+A / Ctrl+A when cursor is in a table: select all cells in the table
- [ ] Clear multi-cell selection when:
  - [ ] User clicks elsewhere in the document
  - [ ] User starts typing (type replaces selection content)
  - [ ] User presses Escape
- [ ] Store selection state: `{ tableId, startRow, startCol, endRow, endCol }`

> **Worker Note:** All items in this milestone must be completed. If any item seems unclear or blocked, note it in your summary for the orchestrator but still attempt the work.

[Return to Top](#mikedown-editor---planning-document)

---

## M6a: Link Navigation & Anchor System

**Model: Sonnet** | **Status: ⬜ Not Started**

Implement link click behavior (click to edit, Cmd+Click to navigate), internal anchor links, and the configurable link click preference.

### Tasks

#### Link Click Behavior
- [ ] Ensure clicking on a link in WYSIWYG mode **places the cursor for editing** (does NOT navigate)
  - TipTap's `Link` extension should handle this by default — verify clicks don't navigate
  - If TipTap's link extension navigates on click, configure it with `openOnClick: false`
- [ ] Implement **Cmd+Click** (Mac) / **Ctrl+Click** (Windows/Linux) to navigate to the link target:
  - [ ] Listen for click events on link elements in the webview
  - [ ] Check if the modifier key (Meta on Mac, Ctrl on Windows/Linux) is held
  - [ ] Determine link type and route accordingly (see below)
- [ ] Implement the configurable link click preference (`mikedown.linkClickBehavior`):
  - [ ] Read the setting value: `navigateCurrentTab`, `openNewTab`, or `showContextMenu`
  - [ ] `navigateCurrentTab`: Cmd+Click navigates in the current editor tab
  - [ ] `openNewTab`: Cmd+Click opens the target in a new VS Code editor tab
  - [ ] `showContextMenu`: Cmd+Click shows a context menu with options (Open in Current Tab, Open in New Tab, Open in New Window)

#### Link Type Routing
- [ ] **Internal document links** (anchor links like `#heading-name`):
  - [ ] Parse the `href` to detect `#` prefix
  - [ ] Find the heading in the document that matches the anchor ID
  - [ ] Scroll the editor to that heading position
  - [ ] Place the cursor at the start of the heading
- [ ] **Links to other markdown files** (relative paths like `./other.md` or `../docs/readme.md`):
  - [ ] Parse the `href` to detect relative file paths ending in `.md` or `.markdown`
  - [ ] Resolve the path relative to the current file's directory
  - [ ] Open the target file using VS Code's `vscode.commands.executeCommand('vscode.open', uri)`
  - [ ] If the link includes an anchor (e.g., `./other.md#section`), open the file AND scroll to the heading
  - [ ] For "Open in New Tab": use `vscode.commands.executeCommand('vscode.open', uri, { viewColumn: vscode.ViewColumn.Beside })` or similar
  - [ ] For "Open in New Window": use `vscode.commands.executeCommand('vscode.openWith', uri, 'mikedown.editor', { viewColumn: vscode.ViewColumn.Active })`
- [ ] **External URLs** (http/https links):
  - [ ] Open in the system's default browser using `vscode.env.openExternal(vscode.Uri.parse(href))`

#### Anchor ID Generation
- [ ] Auto-generate GitHub-style anchor IDs from heading text:
  - [ ] Convert to lowercase
  - [ ] Replace spaces with hyphens (`-`)
  - [ ] Remove non-alphanumeric characters (except hyphens)
  - [ ] Handle duplicate headings by appending `-1`, `-2`, etc. (like GitHub does)
  - [ ] Examples:
    - `## Hello World` → `#hello-world`
    - `## Hello World!` → `#hello-world`
    - `## API Reference` → `#api-reference`
- [ ] Store anchor IDs as data attributes on heading elements in the ProseMirror document
- [ ] Update anchor IDs when headings are edited

#### Visual Indicators on Headings
- [ ] Show a subtle link/anchor icon next to headings on hover
  - [ ] Icon appears to the left of the heading text (like GitHub's heading anchor links)
  - [ ] Clicking the icon copies the anchor link to clipboard (e.g., `#hello-world`)
  - [ ] Style: muted color, becomes visible on hover only, doesn't interfere with editing

#### Link Styling in WYSIWYG
- [ ] Style links with underline and theme-appropriate link color
- [ ] Show the link URL in a tooltip on hover (small popover below the link text showing the href)
- [ ] Make the tooltip non-interactive (disappears when mouse moves away)

> **Worker Note:** All items in this milestone must be completed. If any item seems unclear or blocked, note it in your summary for the orchestrator but still attempt the work.

[Return to Top](#mikedown-editor---planning-document)

---

## M6b: Link Autocomplete

**Model: Sonnet** | **Status: ⬜ Not Started**

Implement autocomplete suggestions when creating links — suggest workspace markdown files and heading anchors.

### Tasks

#### Trigger Autocomplete
- [ ] When the user is in the link URL input (either from the toolbar's "Insert Link" dialog or from typing `[text](` in the editor):
  - [ ] Show an autocomplete dropdown with suggestions
  - [ ] The dropdown should appear below the input or inline in the editor

#### Workspace File Suggestions
- [ ] Scan the workspace for all `.md` and `.markdown` files using `vscode.workspace.findFiles('**/*.{md,markdown}')`
- [ ] Cache the file list and update on file system changes (listen to `vscode.workspace.onDidCreateFiles`, `onDidDeleteFiles`, `onDidRenameFiles`)
- [ ] Display files as suggestions with their relative paths (relative to the current file)
  - [ ] Example: if current file is `docs/guide.md` and target is `docs/api/reference.md`, suggest `./api/reference.md`
- [ ] Sort suggestions by relevance:
  - [ ] Files in the same directory first
  - [ ] Then files in parent/sibling directories
  - [ ] Then files elsewhere in the workspace

#### Heading Anchor Suggestions
- [ ] For the **current document**: list all headings with their auto-generated anchor IDs
  - [ ] Example suggestions: `#introduction`, `#getting-started`, `#api-reference`
  - [ ] Get headings from the current TipTap document model (iterate nodes of type `heading`)
- [ ] For **other markdown files**: when a file path is already entered (e.g., `./other.md#`), parse that file's content to extract headings and offer their anchors
  - [ ] Read the target file content using `vscode.workspace.fs.readFile()`
  - [ ] Parse headings using a simple regex: `/^#{1,6}\s+(.+)$/gm`
  - [ ] Generate anchor IDs from the heading text (same algorithm as M6a)
  - [ ] Display as suggestions after the `#` character

#### Fuzzy Matching
- [ ] Implement fuzzy matching on the user's input:
  - [ ] As the user types in the URL input, filter suggestions to match
  - [ ] Use a simple fuzzy match algorithm: check if all characters of the query appear in order in the suggestion
  - [ ] Example: typing `api` matches `./api/reference.md` and `#api-reference`
  - [ ] Highlight matching characters in the suggestion list
- [ ] Use a lightweight fuzzy matching library (e.g., `fuse.js`) or implement a simple character-by-character matcher

#### Autocomplete UI
- [ ] Render autocomplete as a dropdown list below the input
- [ ] Show file icon for file suggestions, heading icon for anchor suggestions
- [ ] Show relative file path as primary text, absolute path as secondary text (muted)
- [ ] Keyboard navigation: Up/Down arrows to navigate, Enter to select, Escape to dismiss
- [ ] Mouse: click to select a suggestion
- [ ] Dismiss on blur or when the input value doesn't match any suggestions
- [ ] Style to match VS Code's native autocomplete appearance (theme colors, fonts)

> **Worker Note:** All items in this milestone must be completed. If any item seems unclear or blocked, note it in your summary for the orchestrator but still attempt the work.

[Return to Top](#mikedown-editor---planning-document)

---

## M6c: Broken Link Detection & Backlinks

**Model: Sonnet** | **Status: ⬜ Not Started**

Implement broken link detection with visual indicators and workspace-wide backlink awareness.

### Tasks

#### Broken Link Detection
- [ ] After the document is loaded (and on subsequent edits), scan all links in the document:
  - [ ] Iterate over all `Link` marks in the TipTap document model
  - [ ] For each link, check the `href` value
- [ ] Check **internal anchor links** (`#heading-name`):
  - [ ] Get all heading anchor IDs in the current document
  - [ ] If the link target doesn't match any heading anchor, mark it as broken
- [ ] Check **file links** (`./other.md`, `../docs/readme.md`):
  - [ ] Resolve the path relative to the current file
  - [ ] Check if the file exists using `vscode.workspace.fs.stat()`
  - [ ] If the file doesn't exist, mark it as broken
  - [ ] If the link includes an anchor (`./other.md#section`), check the file exists AND the heading exists in that file
- [ ] Do NOT check **external URLs** (http/https) — these would require network calls and we're fully offline
- [ ] Apply visual indicators to broken links:
  - [ ] Add a CSS class `mikedown-broken-link` to broken link elements
  - [ ] Style: red underline (wavy or dashed) instead of the normal link underline
  - [ ] Optionally: small warning icon after the link text
- [ ] Show **tooltip on hover** for broken links explaining the issue:
  - [ ] For missing anchors: "Heading '#section-name' not found in this document"
  - [ ] For missing files: "File './other.md' not found in workspace"
  - [ ] For missing file + anchor: "File found, but heading '#section' not found in './other.md'"
- [ ] Update broken link status **reactively** as the document is edited:
  - [ ] When a heading is added, renamed, or removed: re-check all anchor links in the document
  - [ ] When a link is added or modified: check the new link target
  - [ ] Debounce the re-check to avoid performance issues (e.g., 500ms after the last edit)
- [ ] Also update when external files change:
  - [ ] Listen for `vscode.workspace.onDidCreateFiles` and `onDidDeleteFiles`
  - [ ] Re-check file links when files are created or deleted in the workspace

#### Backlink Awareness
- [ ] Implement workspace-wide backlink scanning:
  - [ ] On document open, scan all `.md` and `.markdown` files in the workspace
  - [ ] For each file, parse its content and extract all links
  - [ ] Find links that point to the currently open document (by file path)
  - [ ] Store these as "backlinks" for the current document
- [ ] Cache the backlink index to avoid re-scanning the entire workspace on every file open:
  - [ ] Build the index once when the extension activates
  - [ ] Update incrementally when files are created, deleted, or modified
  - [ ] Listen for `vscode.workspace.onDidSaveTextDocument` to update the index for saved files
- [ ] Display backlinks in a VS Code panel or tree view:
  - [ ] Register a `TreeDataProvider` for a "Backlinks" panel in the sidebar or bottom panel
  - [ ] Each backlink entry shows: source file name, line number, surrounding context text
  - [ ] Clicking a backlink opens the source file and navigates to the link location
- [ ] Alternatively, display a backlink count in the status bar:
  - [ ] Show "3 backlinks" next to the document stats
  - [ ] Clicking it opens the backlinks panel
- [ ] Update backlinks when the current document's filename changes (rename)

> **Worker Note:** All items in this milestone must be completed. If any item seems unclear or blocked, note it in your summary for the orchestrator but still attempt the work.

[Return to Top](#mikedown-editor---planning-document)

---

## M7: Image Handling

**Model: Sonnet** | **Status: ⬜ Not Started**

Implement inline image rendering with viewport scaling and an insert image dialog.

### Tasks

- [ ] Render images inline in WYSIWYG view (display actual image, not markdown syntax)
- [ ] Scale images down to fit viewport width (max-width constraint with CSS)
- [ ] Preserve aspect ratio when scaling
- [ ] Implement insert image dialog with fields:
  - [ ] Alt text input
  - [ ] File path / URL input
  - [ ] Preview of the image (if path is valid/accessible)
- [ ] Handle missing/broken images gracefully (show placeholder with alt text)
- [ ] Support both relative and absolute file paths
- [ ] Support both local file paths and HTTP URLs
- [ ] Clicking on an image in WYSIWYG should allow editing alt text and path (popover or dialog)

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

**Model: Sonnet** | **Status: ⬜ Not Started**

Implement custom right-click context menus for text and links.

### Tasks

#### General Text Context Menu
- [ ] Bold / Italic / Strikethrough formatting options
- [ ] Heading selection submenu (H1-H6, Paragraph)
- [ ] Convert to list (bullet, numbered, task)
- [ ] Wrap in blockquote
- [ ] Insert link / image / table / horizontal rule
- [ ] Cut / Copy / Paste
- [ ] Select All

#### Link Context Menu
- [ ] Open in Current Tab
- [ ] Open in New Tab
- [ ] Open in New Window
- [ ] Copy Link
- [ ] Edit Link
- [ ] Remove Link (keep text)

#### Table Cell Context Menu
- [ ] Insert Row Above / Below
- [ ] Insert Column Left / Right
- [ ] Remove Row / Column
- [ ] Align Left / Center / Right
- [ ] Delete Table

#### Image Context Menu
- [ ] Edit Image (alt text, path)
- [ ] Remove Image
- [ ] Copy Image Path

- [ ] Ensure context menus respect VS Code theme colors
- [ ] Prevent default browser context menu from showing

> **Worker Note:** All items in this milestone must be completed. If any item seems unclear or blocked, note it in your summary for the orchestrator but still attempt the work.

[Return to Top](#mikedown-editor---planning-document)

---

## M11: Export & Clipboard

**Model: Sonnet** | **Status: ⬜ Not Started**

Implement export to PDF, HTML, DOCX, print support, and copy-as-rich-text.

### Tasks

#### Export
- [ ] Implement "Export to PDF" command (via VS Code command palette and/or toolbar menu)
- [ ] Implement "Export to HTML" command (standalone HTML file with embedded styles)
- [ ] Implement "Export to DOCX" command (using a library like `docx` or `pandoc`)
- [ ] Implement export file picker dialog (choose save location and filename)
- [ ] Apply current theme styling to exported documents
- [ ] Ensure all exports work fully offline (no external CDN resources)

#### Print
- [ ] Implement "Print" command
- [ ] Generate print-friendly view (appropriate margins, page breaks, no toolbar)
- [ ] Use the webview's print capability or generate a printable HTML page

#### Clipboard
- [ ] Default copy behavior: place both rich text AND raw markdown on clipboard simultaneously
- [ ] Rich text pastes into Google Docs, Slack, email clients with formatting preserved
- [ ] Raw markdown pastes into code editors and terminals as fallback
- [ ] Implement copy from WYSIWYG view preserving visual formatting

> **Worker Note:** All items in this milestone must be completed. If any item seems unclear or blocked, note it in your summary for the orchestrator but still attempt the work.

[Return to Top](#mikedown-editor---planning-document)

---

## M12a: Smart Paste — Basic HTML Conversion

**Model: Sonnet** | **Status: ⬜ Not Started**

Implement the clipboard paste handler that detects rich text (HTML) on the clipboard and converts basic inline and block HTML elements to their markdown equivalents before inserting into the editor.

### How It Works

When the user pastes content (Cmd+V / Ctrl+V), the browser's clipboard API provides multiple formats:
- `text/plain` — raw text
- `text/html` — rich text as HTML

If `text/html` is present, we parse it and convert to markdown-compatible ProseMirror nodes/marks. If only `text/plain` is present, we insert as plain text.

### Tasks

#### Clipboard Detection
- [ ] Intercept paste events in the TipTap editor using TipTap's `addPasteRules()` or a custom ProseMirror plugin
  - [ ] Option A: Use TipTap's `Extension.create()` with `addProseMirrorPlugins()` to add a custom paste handler
  - [ ] Option B: Use `editor.on('paste', handler)` if available
  - [ ] In the handler, check `event.clipboardData.types` for `text/html`
- [ ] If `text/html` is present: extract the HTML string via `event.clipboardData.getData('text/html')`
- [ ] If only `text/plain` is present: let TipTap handle the paste normally (plain text insertion)

#### HTML Parsing
- [ ] Parse the HTML string into a DOM tree using `DOMParser`:
  ```typescript
  const parser = new DOMParser();
  const doc = parser.parseFromString(htmlString, 'text/html');
  ```
- [ ] Walk the DOM tree and convert each element to the corresponding ProseMirror node/mark

#### Inline Element Conversion
- [ ] `<b>`, `<strong>` → Bold mark
- [ ] `<i>`, `<em>` → Italic mark
- [ ] `<u>` → Underline mark
- [ ] `<s>`, `<del>`, `<strike>` → Strikethrough mark
- [ ] `<code>` → Inline Code mark
- [ ] `<a href="...">text</a>` → Link mark with `href` attribute
- [ ] `<img src="..." alt="...">` → Image node
- [ ] `<br>` → Hard break node
- [ ] `<sup>`, `<sub>` → Strip tags, keep text content (not supported in GFM)

#### Block Element Conversion
- [ ] `<h1>` through `<h6>` → Heading nodes (level 1-6)
- [ ] `<p>` → Paragraph node
- [ ] `<blockquote>` → Blockquote node
- [ ] `<pre><code>` → Code Block node (detect language from `class="language-xxx"` attribute if present)
- [ ] `<hr>` → Horizontal Rule node
- [ ] `<ul>` → Unordered List node
  - [ ] `<li>` → List Item node
- [ ] `<ol>` → Ordered List node
  - [ ] `<li>` → List Item node (with `start` attribute support)

#### Cleanup
- [ ] Strip HTML comments (`<!-- ... -->`)
- [ ] Strip `<script>`, `<style>`, and other non-content tags
- [ ] Strip inline `style` attributes (don't try to convert CSS to markdown)
- [ ] Convert `&nbsp;` to regular spaces
- [ ] Convert common HTML entities (`&amp;`, `&lt;`, `&gt;`, `&quot;`) to their characters
- [ ] Remove empty elements (e.g., `<p></p>`, `<span></span>`)
- [ ] Collapse excessive whitespace (multiple spaces, multiple blank lines)

#### Integration
- [ ] After conversion, insert the resulting ProseMirror nodes at the current cursor position
- [ ] Ensure the pasted content integrates cleanly with surrounding content (no broken paragraphs, proper block merging)
- [ ] Preserve plain text paste when no rich text is on clipboard
- [ ] Ensure Cmd+Shift+V / Ctrl+Shift+V pastes as plain text (no conversion)

> **Worker Note:** All items in this milestone must be completed. If any item seems unclear or blocked, note it in your summary for the orchestrator but still attempt the work.

[Return to Top](#mikedown-editor---planning-document)

---

## M12b: Smart Paste — Complex Structures & Source Handling

**Model: Sonnet** | **Status: ⬜ Not Started**

Handle complex HTML structures (tables, nested lists) and source-specific quirks from common paste sources like Google Docs, Microsoft Word, Slack, and web browsers.

### Prerequisites
- M12a must be complete (basic HTML conversion pipeline in place)

### Tasks

#### Table Conversion
- [ ] Convert `<table>` HTML to GFM table structure:
  - [ ] Detect `<thead>` / `<tbody>` structure
  - [ ] If no `<thead>`, use the first `<tr>` as the header row
  - [ ] Convert `<th>` cells to header cells, `<td>` cells to body cells
  - [ ] Extract text content from each cell (strip inner HTML formatting, preserve inline marks)
  - [ ] Handle `colspan` and `rowspan` attributes gracefully:
    - [ ] GFM tables don't support cell merging — expand merged cells by duplicating content
  - [ ] Handle empty cells: insert a space or leave empty
- [ ] Detect alignment from `style="text-align: ..."` or `align="..."` attributes on cells
- [ ] Create corresponding TipTap Table nodes with proper header/body structure

#### Nested List Conversion
- [ ] Handle deeply nested lists (lists within lists):
  - [ ] `<ul><li>A<ul><li>B<ul><li>C</li></ul></li></ul></li></ul>` → three-level bullet list
  - [ ] Preserve list type at each level (ordered/unordered can be mixed)
- [ ] Handle lists with mixed content: list items containing paragraphs, code blocks, or blockquotes
- [ ] Handle list items with multiple paragraphs (`<li><p>...</p><p>...</p></li>`)

#### Google Docs Quirks
- [ ] Google Docs wraps content in `<google-sheets-html-origin>` or `<b style="font-weight:normal">` tags — strip these wrapper elements
- [ ] Google Docs uses `<span style="font-weight: 700">` instead of `<b>` — detect bold via inline styles
- [ ] Google Docs uses `<span style="font-style: italic">` instead of `<i>` — detect italic via inline styles
- [ ] Google Docs uses `<li style="list-style-type: disc">` for bullets — handle style-based list detection
- [ ] Google Docs generates `<a id="..." href="...">` links with internal document anchors — convert to standard links

#### Microsoft Word Quirks
- [ ] Word pastes include `<!--StartFragment-->` / `<!--EndFragment-->` markers — strip these
- [ ] Word uses `<p class="MsoNormal">` and similar `Mso*` classes — strip these classes
- [ ] Word uses `<o:p>` and other namespaced elements — strip namespace prefixes
- [ ] Word uses `mso-*` CSS properties in inline styles — strip these
- [ ] Word generates `<w:sdt>` structured document tags — extract content, strip tags

#### Slack Quirks
- [ ] Slack uses `<ts-mention>` for @mentions — convert to plain text
- [ ] Slack uses `<ts-emoji>` for emoji — convert to text representation
- [ ] Slack formats code with `<code>` inside `<pre>` for code blocks

#### Web Browser Content
- [ ] When pasting from a general web page, handle:
  - [ ] Navigation menus, sidebars, and other non-content elements — strip `<nav>`, `<aside>`, `<header>`, `<footer>` tags
  - [ ] Article content: preserve `<article>` content structure
  - [ ] Figure/figcaption: convert `<figure><img><figcaption>` to image + text
  - [ ] Definition lists (`<dl>`, `<dt>`, `<dd>`): convert to bold term + paragraph description

#### Edge Cases
- [ ] Empty clipboard: do nothing
- [ ] HTML with only whitespace: do nothing
- [ ] Deeply nested inline formatting (bold inside italic inside link inside bold): flatten and apply all marks
- [ ] Malformed HTML: the `DOMParser` handles this gracefully, but ensure the converter doesn't crash
- [ ] Very large pastes: set a reasonable size limit and paste as plain text if exceeded

> **Worker Note:** All items in this milestone must be completed. If any item seems unclear or blocked, note it in your summary for the orchestrator but still attempt the work.

[Return to Top](#mikedown-editor---planning-document)

---

## M13: Find & Replace

**Model: Sonnet** | **Status: ⬜ Not Started**

Implement find and replace with a toggle for searching visible rendered text versus underlying markdown source.

### Tasks

- [ ] Implement find dialog (Cmd+F / Ctrl+F)
- [ ] Implement replace dialog (Cmd+H / Ctrl+H)
- [ ] Implement "Search visible text" mode (searches rendered content, ignoring markdown syntax)
- [ ] Implement "Search markdown source" mode (searches raw markdown including syntax characters)
- [ ] Add toggle button in find dialog to switch between visible text and source modes
- [ ] Implement standard find options:
  - [ ] Match Case toggle
  - [ ] Whole Word Only toggle
  - [ ] Use Regular Expressions toggle
- [ ] Highlight all matches in the document
- [ ] Implement Find Next / Find Previous navigation
- [ ] Implement Replace / Replace All
- [ ] Ensure find/replace works in both WYSIWYG and source mode
- [ ] Show match count indicator (e.g., "3 of 12")

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

**Model: Sonnet** | **Status: ⬜ Not Started**

Implement collapsible YAML frontmatter display and syntax-highlighted code blocks.

### Tasks

#### Frontmatter
- [ ] Detect YAML frontmatter (content between `---` delimiters at top of file)
- [ ] Render as a collapsible metadata block at the top of the WYSIWYG view
- [ ] Show collapsed state with a summary indicator (e.g., "Frontmatter" with expand arrow)
- [ ] Show expanded state with formatted key-value pairs or raw YAML
- [ ] Allow editing frontmatter content within the collapsible block
- [ ] Ensure frontmatter is preserved exactly during markdown round-trip

#### Code Blocks
- [ ] Render fenced code blocks with syntax highlighting (use a library like highlight.js or Shiki)
- [ ] Display language label in the corner of the code block (e.g., "javascript", "python")
- [ ] Use monospace font within code blocks
- [ ] Apply dark/themed background to visually distinguish code blocks from prose
- [ ] When clicking into a code block, switch to monospace editing experience within the block
- [ ] Support language detection from the fence info string (```javascript, ```python, etc.)
- [ ] Handle code blocks without a language specifier (plain text / no highlighting)
- [ ] Render inline code (`backtick code`) with monospace font and subtle background

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

**Model: Sonnet** | **Status: ⬜ Not Started**

Write unit tests for all core logic: markdown round-trip, formatting commands, table operations, link system, smart paste, find/replace, and document stats.

### Test Framework Setup
- [ ] Install testing dependencies: `vitest` (or `jest`) + `@testing-library/dom` for DOM testing
- [ ] Configure test runner in `package.json` scripts
- [ ] Create test directory structure: `test/unit/`

### Markdown Round-Trip Tests (`test/unit/roundtrip.test.ts`)
- [ ] Create a comprehensive test fixture file containing all GFM elements
- [ ] Test: parse markdown string -> serialize back -> output matches input (semantically)
- [ ] Test each element type individually:
  - [ ] Headings H1-H6
  - [ ] Bold (both `**` and `__` syntax)
  - [ ] Italic (both `*` and `_` syntax)
  - [ ] Strikethrough (`~~`)
  - [ ] Inline code (`` ` ``)
  - [ ] Links (`[text](url)`)
  - [ ] Images (`![alt](src)`)
  - [ ] Unordered lists (`-`, `*`, `+`)
  - [ ] Ordered lists (`1.`)
  - [ ] Task lists (`- [ ]`, `- [x]`)
  - [ ] Blockquotes (`>`)
  - [ ] Fenced code blocks (with and without language)
  - [ ] Tables (with alignment)
  - [ ] Horizontal rules
  - [ ] YAML frontmatter
- [ ] Test nested structures: list inside blockquote, code block inside list item
- [ ] Test edge cases: empty document, document with only whitespace, document with only frontmatter

### Formatting Command Tests (`test/unit/formatting.test.ts`)
- [ ] Test toggleBold on selected text
- [ ] Test toggleItalic on selected text
- [ ] Test toggleStrike on selected text
- [ ] Test toggleCode on selected text
- [ ] Test toggleHeading for each level
- [ ] Test toggleBulletList, toggleOrderedList, toggleTaskList
- [ ] Test toggleBlockquote
- [ ] Test setLink with href
- [ ] Test setImage with src and alt
- [ ] Test insertTable with dimensions
- [ ] Test setHorizontalRule
- [ ] Test formatting toggle off (apply, then apply again to remove)

### Table Operation Tests (`test/unit/tables.test.ts`)
- [ ] Test addRowBefore, addRowAfter
- [ ] Test deleteRow (including protection against removing header row)
- [ ] Test addColumnBefore, addColumnAfter
- [ ] Test deleteColumn (including minimum column protection)
- [ ] Test cell alignment setting
- [ ] Test table serialization to GFM syntax
- [ ] Test table creation from grid picker dimensions

### Link System Tests (`test/unit/links.test.ts`)
- [ ] Test anchor ID generation from heading text (GitHub-style)
- [ ] Test anchor ID deduplication for duplicate headings
- [ ] Test broken link detection for missing anchors
- [ ] Test broken link detection for missing files
- [ ] Test link autocomplete file path resolution (relative paths)

### Smart Paste Tests (`test/unit/smartpaste.test.ts`)
- [ ] Test HTML bold/italic/underline conversion
- [ ] Test HTML heading conversion
- [ ] Test HTML list conversion (ordered and unordered)
- [ ] Test HTML link conversion
- [ ] Test HTML table to GFM table conversion
- [ ] Test HTML code block conversion
- [ ] Test nested structure conversion
- [ ] Test Google Docs HTML quirks handling
- [ ] Test Word HTML quirks handling
- [ ] Test stripping of script/style tags
- [ ] Test HTML entity conversion

### Document Stats Tests (`test/unit/stats.test.ts`)
- [ ] Test word count calculation (should not count markdown syntax)
- [ ] Test character count calculation
- [ ] Test reading time calculation
- [ ] Test with empty document
- [ ] Test with code blocks (code words should be counted)

> **Worker Note:** All items in this milestone must be completed. If any item seems unclear or blocked, note it in your summary for the orchestrator but still attempt the work.

[Return to Top](#mikedown-editor---planning-document)

---

## M17b: Integration Tests

**Model: Sonnet** | **Status: ⬜ Not Started**

Write integration tests that test the extension within VS Code's extension testing framework.

### Test Framework Setup
- [ ] Set up VS Code extension test runner using `@vscode/test-electron`
- [ ] Create test directory structure: `test/integration/`
- [ ] Create test workspace with sample markdown files for testing

### File Handling Tests (`test/integration/fileHandling.test.ts`)
- [ ] Test: opening a `.md` file in WYSIWYG editor does NOT set the dirty flag
- [ ] Test: editing text in WYSIWYG editor sets the dirty flag
- [ ] Test: saving the file clears the dirty flag
- [ ] Test: auto-reload when file is modified externally and has no unsaved changes
- [ ] Test: prompt appears when file is modified externally and has unsaved changes
- [ ] Test: ignore mechanism prevents reload loops during save

### Mode Toggle Tests (`test/integration/modeToggle.test.ts`)
- [ ] Test: toggling from WYSIWYG to source mode preserves content
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
- [ ] Test: Export to HTML produces valid HTML file
- [ ] Test: Export to PDF produces valid PDF file
- [ ] Test: Export to DOCX produces valid DOCX file
- [ ] Test: exported content matches editor content

### Theme Tests (`test/integration/theming.test.ts`)
- [ ] Test: editor loads with dark theme colors when VS Code is in dark mode
- [ ] Test: editor loads with light theme colors when VS Code is in light mode
- [ ] Test: high contrast theme is supported

> **Worker Note:** All items in this milestone must be completed. If any item seems unclear or blocked, note it in your summary for the orchestrator but still attempt the work.

[Return to Top](#mikedown-editor---planning-document)

---

## M17c: Edge Case Tests & Performance

**Model: Sonnet** | **Status: ⬜ Not Started**

Test edge cases and measure/optimize performance.

### Edge Case Tests (`test/edge-cases/`)
- [ ] Test: empty document opens without errors
- [ ] Test: document with only YAML frontmatter (no body content)
- [ ] Test: document with deeply nested structures (5+ levels of list nesting, nested blockquotes)
- [ ] Test: table with 20+ columns (verify horizontal scrolling)
- [ ] Test: table with 100+ rows (verify performance)
- [ ] Test: very long paragraph (1000+ words in a single paragraph)
- [ ] Test: mixed content document (rapid alternation of prose, code blocks, tables, images, lists)
- [ ] Test: file with Windows line endings (CRLF `\r\n`)
- [ ] Test: file with Unix line endings (LF `\n`)
- [ ] Test: file with mixed line endings
- [ ] Test: file with UTF-8 BOM
- [ ] Test: file with non-ASCII characters (unicode, CJK, emoji)
- [ ] Test: rapid toggling between WYSIWYG and source mode (10+ times quickly)
- [ ] Test: multiple WYSIWYG tabs open simultaneously (3+ tabs)
- [ ] Test: opening same file in two WYSIWYG tabs
- [ ] Test: pasting extremely large content (10,000+ characters)
- [ ] Test: markdown with unusual but valid syntax (e.g., reference-style links, setext headings)

### Performance Tests (`test/performance/`)
- [ ] Measure editor initialization time (from file open to editor ready):
  - [ ] Target: < 500ms for a typical document (< 1000 lines)
  - [ ] Target: < 2000ms for a large document (5000+ lines)
- [ ] Measure markdown parsing time (string -> ProseMirror document):
  - [ ] Target: < 100ms for a typical document
  - [ ] Target: < 500ms for a large document
- [ ] Measure markdown serialization time (ProseMirror document -> string):
  - [ ] Same targets as parsing
- [ ] Measure typing latency (time between keystroke and visual update):
  - [ ] Target: < 16ms (60fps) for a typical document
- [ ] Profile memory usage:
  - [ ] Baseline: editor with empty document
  - [ ] Typical: editor with 500-line document
  - [ ] Large: editor with 5000-line document
  - [ ] Multiple tabs: 5 documents open simultaneously
- [ ] Ensure document stats debouncing prevents lag during rapid typing
- [ ] Ensure broken link detection debouncing prevents lag during rapid editing

### Performance Optimization (if targets not met)
- [ ] Identify bottlenecks using browser DevTools profiler in the webview
- [ ] Optimize serialization/deserialization hot paths
- [ ] Implement debouncing for expensive operations (stats, broken link detection, backlink updates)
- [ ] Consider lazy loading for large documents (render visible content first)

> **Worker Note:** All items in this milestone must be completed. If any item seems unclear or blocked, note it in your summary for the orchestrator but still attempt the work.

[Return to Top](#mikedown-editor---planning-document)

---

## M17d: Polish & Release Prep

**Model: Sonnet** | **Status: ⬜ Not Started**

Final visual polish, accessibility review, and release preparation for private distribution.

### Tasks

#### Visual Polish
- [ ] Review all toolbar icons for clarity, consistency, and proper sizing
  - [ ] Icons should be SVG for crisp rendering at all resolutions
  - [ ] Use a consistent icon set (recommend Lucide icons)
  - [ ] Icons should adapt color to theme (use `currentColor` in SVGs)
- [ ] Ensure smooth animations and transitions:
  - [ ] Toolbar button hover/active states
  - [ ] Context menu open/close
  - [ ] Table drag feedback
  - [ ] Collapsible frontmatter expand/collapse
  - [ ] Mode toggle transition (no flash of unstyled content)
- [ ] Review spacing and alignment throughout the UI
- [ ] Ensure consistent padding/margins in the editor content area

#### Accessibility
- [ ] Keyboard navigation through toolbar (Tab between buttons, Enter/Space to activate)
- [ ] Add ARIA labels to all toolbar buttons (`aria-label="Bold"`, `aria-label="Insert Table"`, etc.)
- [ ] Add ARIA roles to toolbar (`role="toolbar"`), menus (`role="menu"`), and dialog components
- [ ] Ensure focus management: when a dialog opens, focus moves to it; when it closes, focus returns to the editor
- [ ] Ensure screen reader compatibility for the editor content
- [ ] Support keyboard-only table navigation (already done in M5a, verify it works with screen readers)
- [ ] Test with VS Code's built-in accessibility features

#### Release Preparation
- [ ] Write extension description for VS Code marketplace listing (concise, feature-focused)
- [ ] Create extension icon (square, clear at small sizes, represents markdown/editing)
- [ ] Write `CHANGELOG.md` with initial version notes
- [ ] Review and finalize all preference/setting descriptions
- [ ] Ensure `package.json` has correct metadata (publisher, categories, keywords, engines)
- [ ] Set version to `0.1.0` (initial private release)
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

**2026-03-01 16:15** - Refactored planning document to break down all Opus-rated milestones into Sonnet-digestible sub-milestones. M2 split into M2a (engine setup), M2b (inline preview), M2c (block preview), M2d (behaviors & integrity). M5 split into M5a (rendering & cell editing), M5b (grid picker & toolbar), M5c (drag handles & multi-cell). M6 split into M6a (navigation & anchors), M6b (autocomplete), M6c (broken links & backlinks). M12 split into M12a (basic HTML conversion), M12b (complex structures & source handling). M17 split into M17a (unit tests), M17b (integration tests), M17c (edge cases & performance), M17d (polish & release prep). Each sub-milestone now includes prescriptive implementation details: specific npm packages to install, exact TipTap API calls to use, CSS class names, regex patterns, and test scenarios. Total milestone count: 28 (all Sonnet). Updated dependency graph and parallel groups accordingly.

**2026-03-01 15:30** - Planning document created based on comprehensive requirements interview. All 17 milestones defined with detailed task breakdowns. Technology recommendation: TipTap (ProseMirror-based) for the WYSIWYG engine. GFM as the target spec. Key architectural decisions: VS Code Custom Editor API, webview-based rendering, fully offline. Competitive analysis completed — existing extensions (Markdown Editor by zaaack, Mark Sharp, Typora by cweijan) all have significant limitations. Microsoft has explicitly declined to build this feature into VS Code core, confirming the market opportunity.

[Return to Top](#mikedown-editor---planning-document)
