# MikeDown Backlog

Ideas and feature requests for future versions. Not a roadmap — just a parking lot. Pull from here when planning a release.

## High-value features

- **Math / LaTeX rendering** — inline `$...$` and block `$$...$$` via KaTeX. GitHub renders this now, so it's basically table stakes for a markdown editor.
- **Mermaid diagrams** — render ```` ```mermaid ```` fenced blocks (flowcharts, sequence, gantt, etc.). Also GitHub-rendered.
- **Footnotes** — `[^1]` reference syntax (CommonMark extension, not strictly GFM).
- **Callouts / admonitions** — GitHub-style `> [!NOTE]`, `> [!WARNING]`, `> [!TIP]` alert blocks.

## Nice-to-have

- **Slash commands** — `/` menu for inserting blocks (Notion-style).
- **Emoji shortcodes** — `:smile:` → 😄 with autocomplete.
- **Wiki-links** — `[[Page Name]]` syntax with autocomplete (Obsidian-style).
- **Mark / highlight** — `==highlighted==` syntax.
- **Definition lists** — `term\n: definition` (pandoc / PHP Markdown Extra).
- **Table of contents** — auto-generated `[[toc]]` block.
- **Custom containers** — `:::note ... :::` style (VuePress / MkDocs).
- **Image captions** — render alt text or title as a `<figcaption>` under images.
- **Spell check toggle** for the editing surface.
- **PlantUML / D2 diagram** support (less common than Mermaid).

## Polish

- Word count / reading time in status bar — _scaffolding exists in `src/statusBar.ts` but isn't wired to the webview yet._ ✅ Shipped in 1.8.0.

## Recently shipped

- **Document outline sidebar** — in-editor pane with cursor + scroll tracking, click-to-jump, drag-resize, three-way visibility preference. ✅ Shipped in 2.0.0.
