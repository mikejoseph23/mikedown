# MikeDown Editor — Resume Prompt

## Project Overview

MikeDown Editor is a true WYSIWYG Markdown editor for VS Code built on TipTap v2 / ProseMirror + tiptap-markdown, with CodeMirror 6 powering source mode. Uses VS Code's Custom Editor API, fully offline, targets GFM, MIT licensed. Published to the Marketplace under publisher `interapp`. Currently shipping in the **2.x** line.

## Current Status

**2.3.0 is built, committed, pushed (`5fbcf0e`), and the vsix is ready to upload.** Highlight + emoji + sidebar consolidation all rode the same minor.

- Just finished: highlight (`==text==`), emoji shortcodes + picker, sidebar consolidation (Backlinks + Properties + footer strip moved into the in-editor sidebar), MikeDown activity-bar icon removed
- Ready to publish: `mikedown-editor-2.3.0.vsix` at repo root, 197 tests passing
- Not yet uploaded to the Marketplace — manual vsix upload still pending
- Two loose ends flagged before publish: (1) verify `Cmd+Shift+H` keybinding actually wins over VS Code's default toggle-replace inside MikeDown tabs (scoped via `activeCustomEditorId`); (2) confirm the `.sidebar-section[hidden] { display: none }` defensive rule isn't also needed on `.backlinks-section` or other collapsible sections

## What's Done (2.x highlights)

- **2.3.0** — `==highlight==` mark, emoji shortcodes (`:smile:`) + autocomplete + searchable picker modal (`Cmd+;`), sidebar consolidation: Properties (frontmatter) + Backlinks + footer metadata strip ("Modified 2 days ago · 1,245 words · 6 min read") all in the in-editor sidebar; MikeDown activity-bar icon removed
- **2.1.0** — GitHub-style callouts (`> [!NOTE]` / TIP / IMPORTANT / WARNING / CAUTION) with kind picker in toolbar + right-click
- **2.0.0** — In-editor document outline sidebar inside the WYSIWYG panel; cursor + scroll tracking, click-to-jump, drag-resize, three-way visibility (Always show / Always hide / Remember per doc)
- **1.8.0** — Status bar word/char/reading-time wired to webview via `stats` message
- **1.7.x** — Language picker for code blocks, code-block context menu, copy-to-clipboard for code blocks
- **1.6.0** — Image paste/drag, resize presets, orphan cleanup on save
- Earlier: smart paste, link autocomplete + broken-link detection, table editing with drag handles, find/replace, frontmatter, font themes (10 curated pairings, "Editorial" default), source mode (`Cmd+/`), HTML export, print/PDF, copy as rich text

## What's Next

1. **Smoke-test 2.3.0** — install `mikedown-editor-2.3.0.vsix` locally; verify Cmd+Shift+H wins inside MikeDown tabs; confirm Backlinks/Properties hide correctly when empty; check footer relative time ticks
2. **Upload to Marketplace** once smoke test passes
3. **Pick the next feature from BACKLOG.md** — top remaining high-value bullets:
   - **Math / LaTeX rendering** (`$...$` and `$$...$$` via KaTeX) — table stakes, GitHub renders it
   - **Mermaid diagrams** (```` ```mermaid ```` fenced blocks) — also GitHub-rendered
   - **Footnotes** (`[^1]`) — markdown-it-footnote exists, mature
   - Math and Mermaid both have bundle-size and re-render gotchas — give them a dedicated session each, not the "low-hanging fruit" treatment

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
    callout-node.ts               — GFM callout TipTap node (2.1.0)
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
test/unit/                        — Vitest suite (197 tests across callout, highlight, emoji,
                                    outline, backlinks, frontmatter, relative-time, etc.)
package.json                      — Manifest (2.3.0). No more `mikedown-sidebar` view container.
BACKLOG.md                        — Future features + recently shipped
CHANGELOG.md                      — Per-version release notes
README.md                         — Marketplace listing
mikedown-editor-2.3.0.vsix        — Ready to upload
```

## Recent Git Log

```
5fbcf0e fix(sidebar): hide Properties section when document has no frontmatter
ad55c50 2.3: in-editor sidebar consolidation (Properties / Backlinks / footer)
c37f8b1 2.3: highlight (==text==) + emoji shortcodes & picker
8c2aae7 2.1: GitHub-style callouts / admonitions
d4199bd BACKLOG: remove shipped outline entry; correct word-count version
d684fba 2.0: in-editor document outline sidebar
341477f Add MikeDown Outline pane in Explorer; cursor-driven highlight
e9a6f58 Move review-nudge above the fold; add Screenshots heading
```

## Any Other Notes

- **Built-in Outline panel constraint**: VS Code's built-in Outline binds to `vscode.window.activeTextEditor`, which is undefined for custom editors (tracked upstream as microsoft/vscode#105448). The in-editor sidebar (2.0+) is the durable workaround — don't re-attempt Explorer-pane integration.
- **Activity-bar icon is gone** as of 2.3.0. All per-document UI lives inside the WYSIWYG sidebar (toggle via the `≡` icon top-left of any MikeDown tab).
- **Sidebar visibility default is "Always hide"** — users opt in via the toggle. Don't flip the default without explicit user direction.
- **No mocks of VS Code APIs in unit tests** — the tests use DOM scaffolding directly. See `test/unit/sidebarBacklinks.test.ts` for the pattern.
- **Build**: `npm run package && npx vsce package` (do NOT use the `npm run vsix` script — it auto-bumps the patch version).
- **Testing**: `F5` launches Extension Development Host. Use `assets/sample-docs/engineering-handbook.md` for realistic outline/backlinks/frontmatter testing.
- **Permanent root fixtures**: `CLAUDE.md` (none yet here), `RESUME.md`, `BACKLOG.md` — never archive/rename/delete.
