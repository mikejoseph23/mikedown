# MikeDown Editor — Resume Prompt

## Project Overview

MikeDown Editor is a true WYSIWYG Markdown editor for VS Code built on TipTap v2 / ProseMirror + tiptap-markdown, with CodeMirror 6 powering source mode. Uses VS Code's Custom Editor API, fully offline, targets GFM, MIT licensed. Published to the Marketplace under publisher `interapp`. Currently shipping in the **2.x** line.

## Current Status

**2.8.0 is shipped — merged to `main`, tagged `v2.8.0`, and already uploaded to the Marketplace.** This release makes table column alignment work end-to-end and polishes the table toolbar.

This session (2.8.0 — table alignment + toolbar polish):

- **Per-column alignment that actually persists (the headline).** The toolbar's Align L/C/R buttons were no-ops before: `textAlign` wasn't a schema attribute, nothing rendered it, and tiptap-markdown's table serializer hardcoded `---`. New `src/webview/table-align.ts` adds a real `textAlign` attribute to `TableCell`/`TableHeader` (inline `text-align` style, parsed back from markdown-it's emitted styles), a `setColumnAlign` command that applies to the whole column, and a `TableAligned` serializer override that writes `:---:` / `---:` in the delimiter row. **Left is the GFM default and stays plain `---`** (stored as `null`) so it round-trips exactly and doesn't create noisy diffs. The library's HTML-table fallback for non-GFM-representable tables is preserved.
- **Toolbar polish.** Bigger buttons/icons (30px / 18px), custom fast hover tooltips replacing the slow native `title`, and the active alignment is highlighted as the cursor moves between columns (`refreshTableToolbarStates` on `selectionUpdate`).
- **New table functions.** Added **Toggle Header Row** and **Merge / Split Cells** to both the toolbar and the right-click menu. Merged cells can't be expressed in GFM, so such a table serializes to an HTML `<table>` block (and reloads correctly) — a known, accepted trade-off.
- Wired the new extensions into `editor-main.ts` (replaced plain `Table`/`TableCell`/`TableHeader` with the `*Aligned` variants). Right-click align entries in `contextmenu.ts` now use `setColumnAlign` too.
- Tests: `test/unit/table-align.test.ts` (5 tests — parse, apply, serialize, default, round-trip). **258 unit tests passing.**

Prior session (2.7.0 — heading rename → fix links): renaming a heading now repairs links that pointed at its old `#anchor` (in-doc TOC links fixed live; cross-file links updated per the `mikedown.headingRename.updateLinks` setting — `ask`/`always`/`never`, default `ask`).

### Parked: inline tags feature (branch `feature/inline-tags`)

Built this session but **deliberately parked off `main` for a later release** (something new to ship in a few days; no one's asking for it yet — it's an iterative attempt). Committed on the branch (`ad2cec6`), not merged. Hybrid tags, modeled on popular note apps:

- **Sources merged into one workspace index:** frontmatter `tags:` (array or scalar) **and** inline `#tag` tokens in the body. Nested tags via slash (`#project/active`); a query for `#project` also matches its children. Charset letters/digits/`_`/`-`; pure-number tags rejected.
- **Click → QuickPick** of every doc carrying the tag; the pick opens to the side. Inline tags navigate on Cmd/Ctrl+click (like links); read-only Properties tag pills navigate on plain click.
- **Inline tags are decoration-only** (`webview/tag.ts`) — no node/mark, so the markdown model keeps literal `#tag` text and round-trips untouched. Code spans/blocks + link targets excluded from indexing.
- New files: `src/tagSyntax.ts`, `src/tagExtract.ts`, `src/tagProvider.ts`, `src/webview/tag.ts`, `test/unit/tags.test.ts` (12 tests). Touches `extension.ts`, `markdownEditorProvider.ts`, `editor-main.ts`, `outlineSidebar.ts`, `editor.css`, `outline-sidebar.css`.
- **Before shipping (see BACKLOG Tags bullet):** `#` autocomplete, a dedicated all-tags sidebar section, possibly a VS Code-search click target instead of the QuickPick. To resume: `git switch feature/inline-tags && npm run compile`, then rebase onto `main` — the branch is now several releases behind (2.6.2 backlinks, 2.7.0 heading-rename, 2.8.0 table alignment), so expect conflicts in `outlineSidebar.ts` / `outline-sidebar.css` and possibly `editor-main.ts`.
- Branch still exists (`feature/inline-tags`, local + remote). `main` is at 258 tests; the branch predates the recent work.

## What's Done (2.x highlights)

- **2.8.0** — Table column alignment end-to-end (per-column, persists to the GFM delimiter row; left stays `---`); table toolbar polish (bigger icons, fast tooltips, active-alignment highlight); Toggle Header Row + Merge/Split Cells. New `src/webview/table-align.ts`.
- **2.7.0** — Renaming a heading repairs links to its old `#anchor` (in-doc TOC fixed live; cross-file via `mikedown.headingRename.updateLinks` setting, default `ask`).
- **2.6.2** — Hotfix (backlinks): empty-after-reload fixed; grouped multi-link docs; open-to-side; click jumps to the exact link (occurrence-aware). Inline-tags feature built but parked on `feature/inline-tags`.
- **2.6.1** — Hotfix: GitHub-exact TOC anchor IDs, faster/distance-capped anchor scrolling, code-block first-line indent fix (issue #2)
- **2.6.0** — Mermaid diagram rendering (```` ```mermaid ```` fenced blocks → live SVG; click to edit source, theme-aware, fully offline/bundled)
- **2.5.x** — Settings modal reorganized into five tabs; sidebar pin + position toggle + per-instance state; Share dropdown (View in Browser / Print-Export PDF); periodic "enjoying MikeDown?" engagement toast; editable Properties section
- **2.3.0** — `==highlight==` mark, emoji shortcodes (`:smile:`) + autocomplete + searchable picker modal (`Cmd+;`), sidebar consolidation: Properties (frontmatter) + Backlinks + footer metadata strip ("Modified 2 days ago · 1,245 words · 6 min read") all in the in-editor sidebar; MikeDown activity-bar icon removed
- **2.1.0** — GitHub-style callouts (`> [!NOTE]` / TIP / IMPORTANT / WARNING / CAUTION) with kind picker in toolbar + right-click
- **2.0.0** — In-editor document outline sidebar inside the WYSIWYG panel; cursor + scroll tracking, click-to-jump, drag-resize, three-way visibility (Always show / Always hide / Remember per doc)
- **1.8.0** — Status bar word/char/reading-time wired to webview via `stats` message
- **1.7.x** — Language picker for code blocks, code-block context menu, copy-to-clipboard for code blocks
- **1.6.0** — Image paste/drag, resize presets, orphan cleanup on save
- Earlier: smart paste, link autocomplete + broken-link detection, table editing with drag handles, find/replace, frontmatter, font themes (10 curated pairings, "Editorial" default), source mode (`Cmd+/`), HTML export, print/PDF, copy as rich text

## What's Next

1. **Pick the next feature from BACKLOG.md** — top remaining high-value bullets:
   - **Math / LaTeX rendering** (`$...$` and `$$...$$` via KaTeX) — table stakes, GitHub renders it. Has bundle-size + re-render gotchas; give it a dedicated session, not the "low-hanging fruit" treatment.
   - **Footnotes** (`[^1]`) — markdown-it-footnote exists, mature
   - Nice-to-haves: slash commands, wiki-links, definition lists, ToC, image captions, spell check, PlantUML
2. **Optional cleanup** (noticed during the #2 fix, not done): the `#editor pre code` rule in `editor.css` is dead — it targets `#editor`, but the real container id is `editor-container`. Harmless, but it was the intended reset that never fired.

## Planning Docs

- `PLANNING.md` — original 28-milestone scaffolding doc from project kickoff. Historical reference only; current state is tracked in BACKLOG / CHANGELOG, not here.
- `BACKLOG.md` — parking lot of future features. High-value bullets remaining: math/LaTeX, Mermaid, footnotes. Plus the "Nice-to-have" section (slash commands, wiki-links, definition lists, ToC, image captions, spell check, PlantUML).
- `CHANGELOG.md` — release-by-release feature log. Look here for what shipped in each version.

## Key File Paths

```
src/
  extension.ts                    — Activation, command wiring, status-bar wiring
  markdownEditorProvider.ts       — CustomTextEditorProvider, webview setup, message routing
  outlineProvider.ts              — DocumentSymbolProvider (kept for plain-text markdown editors)
  backlinkProvider.ts             — Workspace backlink index (no longer a TreeDataProvider)
  statusBar.ts                    — Word/char/reading-time status bar
  wordCount.ts                    — Shared word-count helper (host + webview)
  export.ts                       — HTML/PDF export
  settings.ts                     — MikeDown settings interface
  webview/
    editor-main.ts                — TipTap setup, toolbar, settings modal (~3700 lines)
    outlineSidebar.ts             — In-editor sidebar (Outline + Backlinks + Properties + footer)
    outline-sidebar.css           — Sidebar styles, theme-aware
    table-align.ts                — Per-column alignment: textAlign attr + setColumnAlign + serializer override (2.8.0)
    tablepicker.ts + .css         — Table grid picker + contextual table toolbar (align/header/merge buttons)
    callout-node.ts               — GFM callout TipTap node (2.1.0)
    mermaid.ts + .css             — Mermaid fenced-block → live SVG (2.6.0)
    codeblocks.css                — Code-block styles (language pill, copy btn, hljs token colors)
    highlight.ts                  — Highlight mark extension + markdown-it-mark glue (2.3.0)
    emojiautocomplete.ts          — `:abc` inline autocomplete popup (2.3.0)
    emojipicker.ts + .css         — Searchable emoji modal w/ recents (2.3.0)
    frontmatterParse.ts           — Minimal YAML parser for Properties section (2.3.0)
    relativeTime.ts               — "2 days ago" formatting for footer (2.3.0)
    linkautocomplete.ts           — Grouped link picker (headings, files, in-doc, external)
    languagepicker.ts             — Code-block language picker (1.7.0)
    contextmenu.ts                — Right-click context menu
    findreplace.ts                — Find & Replace UI
    smartpaste.ts                 — Rich-text → markdown conversion
    imagepaste.ts                 — Image paste/drag pipeline
    editor.css / theme.css        — Editor + theme styles
test/unit/                        — Vitest suite (258 tests; table-align.test.ts, links.test.ts covers githubAnchorId)
package.json                      — Manifest (2.8.0)
BACKLOG.md                        — Future features + recently shipped
CHANGELOG.md                      — Per-version release notes
README.md                         — Marketplace listing
mikedown-editor-2.8.0.vsix        — Packaged build (already uploaded to Marketplace; .vsix is gitignored)
```

## Recent Git Log

```
ca8a73c Merge: 2.8.0 Per-column table alignment + toolbar polish
e4f1800 2.8.0: Per-column table alignment + table toolbar polish
f84c5d8 Merge: 2.7.0 Heading Rename → Fix Links
3174fb2 2.7.0: Heading Rename → Fix Links
1fbda09 2.6.2: Backlinks hotfix — reliable after reload, grouped, jump-to-link
6482a77 Update RESUME.md for 2.6.1 release
667d718 Fix first line of code block appearing indented (#2)
```

## Any Other Notes

- **Built-in Outline panel constraint**: VS Code's built-in Outline binds to `vscode.window.activeTextEditor`, which is undefined for custom editors (tracked upstream as microsoft/vscode#105448). The in-editor sidebar (2.0+) is the durable workaround — don't re-attempt Explorer-pane integration.
- **Activity-bar icon is gone** as of 2.3.0. All per-document UI lives inside the WYSIWYG sidebar (toggle via the `≡` icon top-left of any MikeDown tab).
- **Sidebar visibility default is "Always hide"** — users opt in via the toggle. Don't flip the default without explicit user direction.
- **No mocks of VS Code APIs in unit tests** — the tests use DOM scaffolding directly. See `test/unit/sidebarBacklinks.test.ts` for the pattern.
- **Build**: `npm run package && npx vsce package` (do NOT use the `npm run vsix` script — it auto-bumps the patch version).
- **CSS ships raw, not bundled.** Webview CSS is loaded via `<link>` from `extensionPath/src/webview/*.css` at runtime (see `getWebviewContent` in `markdownEditorProvider.ts`). Editing a `.css` file needs no webpack rebuild, but it must stay under `src/webview/` and be in the vsix.
- **`githubAnchorId` must match GitHub exactly** — no hyphen collapsing, no trailing trim. Three copies are kept in sync (`outlineProvider`, `markdownEditorProvider`, `webview/editor-main`); `test/unit/links.test.ts` has a replica + regression cases. Change all of them together.
- **Env gotcha (this session): rollup arch mismatch.** `npm run test:unit` died with `Cannot find module @rollup/rollup-darwin-arm64` because `node_modules` held the x64 binary on an arm64 Mac. Fix: `rm -rf node_modules && npm install` in a native arm64 shell (Volta node is arm64). Don't reinstall under Rosetta.
- **Testing**: `F5` launches Extension Development Host. Use `assets/sample-docs/engineering-handbook.md` for realistic outline/backlinks/frontmatter testing.
- **Permanent root fixtures**: `CLAUDE.md` (none yet here), `RESUME.md`, `BACKLOG.md` — never archive/rename/delete.
