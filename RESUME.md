# MikeDown Editor — Resume Prompt

## Project Overview

MikeDown Editor is a true WYSIWYG Markdown editor for VS Code built on TipTap v2 / ProseMirror + tiptap-markdown, with CodeMirror 6 powering source mode. Uses VS Code's Custom Editor API, fully offline, targets GFM, MIT licensed. Published to the Marketplace under publisher `interapp`. Currently shipping in the **2.x** line.

## Current Status

**2.6.1 is built, committed, pushed (`667d718`), and PUBLISHED to the Marketplace.** It was a hotfix bundling three fixes; all shipped and live.

This session (2.6.1 hotfix):

- **GitHub-exact anchor IDs.** `githubAnchorId` no longer collapses consecutive hyphens or trims trailing ones, so TOC links to headings with stripped punctuation (e.g. `Memory & Hardware` → `memory--hardware`, `UD-` → `ud-`) resolve. Fixed in all three copies (`outlineProvider`, `markdownEditorProvider`, `webview/editor-main`) plus the test replica, with regression cases.
- **Faster anchor-link scrolling.** New `smoothScrollHeadingIntoView` (webview/editor-main) eases over a fixed, distance-capped duration (180–420ms) instead of native smooth scroll, so long-doc jumps stay snappy. Honors `prefers-reduced-motion`.
- **Code-block first-line indent (issue #2, now closed).** The inner `<code>` is inline and inherited `0.4em` horizontal padding from the inline-code style; inline left-padding lands only at the start of line 1, indenting it ~1 char. Fixed by zeroing horizontal padding on `.ProseMirror pre code` only — background/highlight/colors untouched. First (over-scoped) attempt stripped the line-highlight background and was reverted; the history is bad-fix → revert → correct-fix (`0b92c99` → `c05373d` → `667d718`). Verified visually with a browser before/after repro.
- 226 unit tests passing.

## What's Done (2.x highlights)

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
test/unit/                        — Vitest suite (226 tests; links.test.ts covers githubAnchorId)
package.json                      — Manifest (2.6.1)
BACKLOG.md                        — Future features + recently shipped
CHANGELOG.md                      — Per-version release notes
README.md                         — Marketplace listing
mikedown-editor-2.6.1.vsix        — Published build (.vsix is gitignored)
```

## Recent Git Log

```
667d718 Fix first line of code block appearing indented (#2)
c05373d Revert "Fix first line of code block appearing indented (#2)"
0b92c99 Fix first line of code block appearing indented (#2)
661ce64 Fix GitHub-anchor TOC links and speed up anchor scrolling (2.6.1)
1df5bd9 Merge branch 'feat/mermaid-diagrams'
945104c 2.6.0: Mermaid diagram rendering
c9ec17c 2.5.2: Share dropdown + periodic engagement toast
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
