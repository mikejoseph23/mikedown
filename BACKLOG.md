# MikeDown Backlog

Ideas and feature requests for future versions. Not a roadmap — just a parking lot. Pull from here when planning a release.

## High-value features

- **Math / LaTeX rendering** — inline `$...$` and block `$$...$$` via KaTeX. GitHub renders this now, so it's basically table stakes for a markdown editor.
- ~~**Mermaid diagrams** — render ```` ```mermaid ```` fenced blocks (flowcharts, sequence, gantt, etc.). Also GitHub-rendered.~~ ✅ Shipped — diagrams render live; click to edit source. Toggle: `mikedown.renderMermaidDiagrams`.
- **Footnotes** — `[^1]` reference syntax (CommonMark extension, not strictly GFM).

## Nice-to-have

- **Slash commands** — `/` menu for inserting blocks (Notion-style).
- **Wiki-links** — `[[Page Name]]` syntax with autocomplete (Obsidian-style).
- **Tags** — first-class support for `#tag` inline syntax and/or frontmatter `tags:` arrays: render as clickable pills in the editor, aggregate workspace-wide with a sidebar section showing all tags + their documents, autocomplete on `#`. _🚧 In progress on branch `feature/inline-tags` (parked for a later release): inline `#tag` decorations + frontmatter `tags:` pills, merged workspace index, click → QuickPick of tagged docs (nested tags supported). Still TODO before shipping: `#` autocomplete, a dedicated all-tags sidebar section, and possibly a VS Code-search click target instead of the QuickPick._
- **Definition lists** — `term\n: definition` (pandoc / PHP Markdown Extra).
- **Table of contents** — auto-generated `[[toc]]` block.
- **Custom containers** — `:::note ... :::` style (VuePress / MkDocs).
- **Image captions** — render alt text or title as a `<figcaption>` under images.
- **Spell check toggle** for the editing surface.
- **PlantUML / D2 diagram** support (less common than Mermaid).

## Polish

- **Backlinks: jump to the line, not just the file.** Clicking a backlink (or an expanded child row) in the sidebar opens the source doc but lands at the top. It should navigate to the link's line number. The line is already indexed (`BacklinkProvider` stores `lineNumber`, and the webview `BacklinkItem` carries `line`); the `openLink` host handler just needs to scroll/reveal that line after opening (similar to the existing `#anchor` → `scrollToAnchor` path). _Requested 2026-06-14._
- Word count / reading time in status bar — _scaffolding exists in `src/statusBar.ts` but isn't wired to the webview yet._ ✅ Shipped in 1.8.0.
- **Buy Me A Coffee link in Settings → About tab.** Needs a final BMAC URL. The About panel in `src/webview/editor-main.ts#buildAboutPanel` already has GitHub / changelog / issue links — add a BMAC link there once the URL exists.
## Recently shipped

- **Consolidate toolbar utility buttons.** Folded View in Browser + Print/PDF into a single Share dropdown; removed the inert Diff toggle (palette command still works); Select All stays standalone as a diagnostic. ✅ Shipped (post-2.5.1).
- **Mark / highlight** — `==highlighted==` syntax; toolbar button + Cmd+Shift+H + right-click; round-trips cleanly. ✅ Shipped in 2.3.0.
- **Emoji shortcodes** — `:smile:` → 😄 with inline autocomplete and a searchable picker (toolbar button, Cmd+;, right-click → Insert Emoji…) including recents and category sections. ✅ Shipped in 2.3.0.
- **Callouts / admonitions** — GitHub-style `> [!NOTE]` / `[!TIP]` / `[!IMPORTANT]` / `[!WARNING]` / `[!CAUTION]` rendered as styled panels; toolbar + right-click insert with kind picker; round-trips to canonical GFM. ✅ Shipped in 2.1.0.
- **Document outline sidebar** — in-editor pane with cursor + scroll tracking, click-to-jump, drag-resize, three-way visibility preference. ✅ Shipped in 2.0.0.
