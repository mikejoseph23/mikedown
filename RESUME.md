# Resume Prompt — MikeDown Editor

Paste this into a new Claude Code window to resume.

---

```
Read this context first, then ask what I'd like to work on.

## Project State

MikeDown Editor v1.0.x — a Typora-style WYSIWYG Markdown editor for VS Code. All core features are built and working. Currently distributed via .vsix files (Dropbox) for limited testing. Next step is publishing to the VS Code Marketplace.

Project directory: /Users/michaeljosephwork/git/markdown-WYSIWYG-vscode-extension/

Built on TipTap v2 + ProseMirror, with CodeMirror 6 for source mode. Fully offline, uses VS Code Custom Editor API, targets GFM spec. MIT licensed.

## What's Built

- WYSIWYG editing with full GFM support (TipTap v2 + tiptap-markdown)
- Condensed Apple Notes-style toolbar with dropdown menus (replaced the original 21-button toolbar)
- Toolbar dropdown primitive (toolbar-dropdown.ts) — reusable popover with keyboard nav, animations
- Source mode toggle (CodeMirror 6, Cmd+/)
- Smart paste (Google Docs, Word, Slack, web → clean Markdown)
- Find & Replace (ProseMirror decoration plugin, regex/case/whole-word)
- Context menu with keyboard shortcut hints
- Table grid picker + contextual toolbar + drag handles + multi-cell selection
- Export: HTML, print/PDF, copy-as-rich-text
- Image handling: inline rendering, viewport scaling, click-to-edit popover
- Link navigation: Cmd+Click opens links, right-click "Open Link" / "Open Link in New Tab"
- Link autocomplete (fuzzy workspace file/anchor dropdown), broken link detection
- Backlinks Explorer panel
- Frontmatter: collapsible YAML block
- Code blocks: syntax highlighting via lowlight (192 languages)
- Editor-only light/dark theme toggle (persisted via mikedown.editorTheme setting, syncs across all open tabs)
- Theme toggle scope setting: can toggle just MikeDown editors or VS Code's global theme
- Settings modal (gear icon), 10+ VS Code settings
- Unit tests: 75 pass (vitest)
- Packaging: npm run vsix (auto-increments patch version, builds, packages)
- .vscodeignore cleaned up, LICENSE.md (MIT)

## Recent Work (2026-03-29)

1. Fixed Cmd+Click link navigation (switched from click to mousedown in capture phase)
2. Added "Open Link" / "Open Link in New Tab" to right-click context menu with behavior override
3. Fixed anchor scroll (data-anchor-id was being stripped by ProseMirror — now computes dynamically)
4. Added editor-only light/dark theme toggle with CSS variable overrides
5. Made theme toggle persist via VS Code setting and broadcast to all open panels
6. Condensed toolbar with Apple Notes-style dropdown menus (replaced full toolbar as default)
7. Dropdown menu primitive with keyboard nav, auto-positioning, animations
8. Fixed settings/theme not loading on first tab open (ready handler wasn't sending them)
9. vsix packaging improvements, MIT license added

## Next Steps — Marketplace Publishing

The immediate goal is to publish MikeDown as an open source extension on the VS Code Marketplace. Here's everything that needs to happen:

### Pre-publish checklist

1. **Write the README.md** — This becomes the marketplace listing page. Must include:
   - The origin story (see below)
   - Feature overview with screenshots
   - Demo GIF showing WYSIWYG editing in action
   - Installation instructions
   - Link to the GitHub repo
   - Feature comparison highlights (unique features no competitor has)
   - Settings reference
   - License (MIT)

2. **Origin story to include in README:**
   The author (Michael Joseph) previously used VS Code's built-in Markdown Preview, which required splitting the editor — markdown source on one side, rendered preview on the other. While valuable, this was cumbersome, especially when working with multiple markdown files simultaneously. This led to exploring alternatives, and the best standalone option found was Typora — a smooth, polished product worth recommending. However, Typora is a Chinese-owned entity, and under Chinese law the government can assert control over domestic assets (the same concern behind TikTok's U.S. scrutiny). Beyond that, as a developer, VS Code offers things a standalone editor can't — Git integration, multi-language file support, extensions ecosystem. Typora is purely markdown-focused. MikeDown was built to bring a Typora-quality WYSIWYG experience directly into VS Code, allowing multiple markdown files open across panes, windows, and monitors — all while retaining VS Code's full power. A desktop product could evolve from this, but the first goal is contributing to the open source community.

3. **Screenshots to capture** (in both light and dark mode):
   - Full editor with condensed toolbar and a document open
   - Dropdown menu open (the Aa text format dropdown)
   - Right-click context menu on a link
   - Split view with two markdown files side by side
   - Backlink Explorer panel in the sidebar
   - Source mode toggle (before/after)
   - Link autocomplete dropdown
   - Table editing with toolbar

4. **Create a demo GIF** — Record a ~30s walkthrough: open a .md file, edit with toolbar, toggle theme, Cmd+Click a link, show source mode toggle

5. **GitHub repo setup:**
   - Push to GitHub (public repo)
   - Add repo URL to package.json: `"repository": { "type": "git", "url": "https://github.com/OWNER/markdown-WYSIWYG-vscode-extension" }`
   - Verify LICENSE.md is committed (it is)

6. **Publisher account:**
   - Go to https://marketplace.visualstudio.com/manage
   - Sign in with Microsoft account
   - Create publisher with ID "mikedown" (must match package.json "publisher" field)
   - Create a Personal Access Token (PAT) in Azure DevOps with "Marketplace (Manage)" scope

7. **Publish:**
   - `vsce login mikedown`
   - `vsce publish` (or `npm run vsix` first to verify the package looks right)
   - Verify the listing appears on the marketplace

8. **Post-publish:**
   - Update README with marketplace badge (install count, rating)
   - Share the marketplace link
   - Add marketplace link to GitHub repo description

### Market research summary
- Space is underserved — best purpose-built WYSIWYG competitor has only ~25K installs
- The top result (Office Viewer, 1M installs) is a general file viewer, not a focused markdown editor
- MikeDown has unique features no competitor offers: broken link detection, link autocomplete, backlink panel, in-editor find/replace
- Main feature gaps vs competitors: Mermaid diagrams and Math/LaTeX (both on the backlog)
## Backlog

- **Mermaid diagram rendering** — render ```mermaid code blocks as inline SVGs using the mermaid npm package (~2-3MB). Custom TipTap NodeView that shows rendered diagram, click to edit source. Most competitors have this.
- **Math/LaTeX (KaTeX)** — render $inline$ and $$block$$ math using katex npm package (~300KB). Need inline math mark + block math node TipTap extensions. User personally wants math disabled by default but available for others. Both features should be behind settings (mikedown.enableMermaid, mikedown.enableMath).
- **Print support** — improve/add proper print functionality
- **Broken link detection** — already built, highlight in marketplace listing (unique feature, no competitor has this)
- **Link autocomplete with workspace file fuzzy search** — already built, highlight in marketplace listing (unique feature)
- **Backlink Explorer panel** — already built, highlight in marketplace listing (unique feature, positions MikeDown as lightweight Obsidian-in-VS-Code)
- **Find/Replace inside the WYSIWYG editor** — already built, highlight in marketplace listing (only Yarkdown also does this)
- **Apple Notes-style condensed toolbar** — already built, highlight in marketplace listing (distinct UI approach)

## Key Files

- src/markdownEditorProvider.ts — Custom Editor, webview message dispatch, openPanels tracking
- src/webview/editor-main.ts — TipTap setup, condensed toolbar, theme toggle, all message handlers
- src/webview/toolbar-dropdown.ts — Reusable dropdown/popover component
- src/webview/contextmenu.ts — Right-click context menu
- src/settings.ts — MikeDownSettings interface (linkClickBehavior, themeToggleScope, editorTheme, toolbarMode)
- package.json — v1.0.x, all contributes (commands, views, configuration, settings)
- .vscodeignore — controls what goes in the .vsix package
- TOOLBAR-MODES-PLAN.md — completed planning doc for toolbar redesign

## How to Build

cd /Users/michaeljosephwork/git/markdown-WYSIWYG-vscode-extension
npm run compile          # build both bundles (webpack)
npm run vsix             # bump version + production build + package .vsix
npx vitest run           # unit tests

## How to Debug

Cmd+Shift+P → "Debug: Select and Start Debugging" → "Run Extension"
Or: Run and Debug sidebar (Cmd+Shift+D) → select "Run Extension" → green play button
```
