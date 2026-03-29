# MikeDown Editor — Resume Prompt

## Project Overview

MikeDown Editor is a Typora-style WYSIWYG Markdown editor for VS Code, built on TipTap v2 / ProseMirror with CodeMirror 6 for source mode. It uses the VS Code Custom Editor API, targets GFM spec, runs fully offline, and is MIT licensed. Published to the VS Code Marketplace under publisher "interapp" (Michael Joseph). Currently in beta (`"preview": true`).

## Current Status

**v1.0.8 is live on the VS Code Marketplace.** Updated listing with new icon, 7 screenshots, corrected URLs. Published 2026-03-29 via manual .vsix upload.

- Just finished: new logo (M + down arrow), 7 marketplace screenshots (compressed JPEGs), README audit and URL fixes, GitHub repo renamed to `mikedown`, git remote updated
- In flight: Azure DevOps PAT setup for CLI publishing (currently using manual .vsix upload)
- Known issue: Backlinks Explorer panel not appearing in sidebar — the `when` clause (`resourceExtname == .md`) may not fire for custom editor documents. Needs investigation.

## What's Done

- Full WYSIWYG editing with GFM support (TipTap v2 + tiptap-markdown)
- Condensed Apple Notes-style toolbar with dropdown menus
- Source mode toggle (CodeMirror 6, Cmd+/)
- Smart paste (Google Docs, Word, Slack, web -> clean Markdown)
- Cmd+Click link navigation, right-click "Open Link" / "Open Link in New Tab"
- Link autocomplete (fuzzy workspace file/anchor search), broken link detection (red wavy underline)
- Backlink Explorer panel (registered but not rendering — see Known Issue above)
- Table editing: grid picker, contextual toolbar, drag handles, multi-cell selection
- Find & Replace inside the WYSIWYG editor (ProseMirror decorations)
- Code block syntax highlighting (192 languages via lowlight)
- Frontmatter support (collapsible YAML block)
- Editor-only light/dark theme toggle (persisted via `mikedown.editorTheme` setting)
- Export to HTML, print, copy as rich text
- Image support: inline rendering, click-to-edit popover
- Settings modal (gear icon), 12+ VS Code settings
- Unit tests: 75 pass (vitest)
- Marketplace listing: new icon, 7 screenshots, corrected README
- Landing page at `website/index.html`
- Remotion video project scaffolded at `video/`
- Sample docs for screenshots at `assets/sample-docs/`

## What's Next

1. **Fix Backlinks panel** — Investigate why `when: "resourceExtname == .md"` doesn't trigger for custom editor documents. May need a different activation context.

2. **Capture missing screenshots** — `link-autocomplete.png` and `backlinks-panel.png` were skipped. Add them once the backlinks panel is fixed and link autocomplete can be triggered reliably. See `assets/screenshots/README.md` for the capture guide.

3. **Set up CLI publishing** — Create an Azure DevOps PAT for `vsce publish`. Current workaround: manual .vsix upload at https://marketplace.visualstudio.com/manage.

4. **Backlog features:**
   - Mermaid diagram rendering (behind `mikedown.enableMermaid` setting)
   - Math/LaTeX via KaTeX (behind `mikedown.enableMath` setting, off by default)
   - Print support improvements

## Key File Paths

```
src/
  extension.ts                    — Activation, command registration, BacklinkProvider
  markdownEditorProvider.ts       — Custom Editor, webview message dispatch, openPanels tracking
  backlinkProvider.ts             — TreeDataProvider for Backlinks panel
  settings.ts                     — MikeDownSettings interface, getSettings()
  export.ts                       — HTML export, print, copy as rich text
  webview/
    editor-main.ts                — TipTap setup, condensed toolbar, theme toggle, all handlers
    toolbar-dropdown.ts           — Reusable dropdown/popover component
    contextmenu.ts                — Right-click context menu
    findreplace.ts                — Find & Replace extension
    smartpaste.ts                 — Rich text paste conversion
    tablepicker.ts                — Table grid picker and contextual toolbar
    linkautocomplete.ts           — Fuzzy file/heading link suggestions
    theme.css                     — VS Code theme integration, force-light/force-dark overrides
    editor.css                    — Main editor styling
images/
  icon.svg                        — Logo source (SVG)
  icon.png                        — Logo (128x128 transparent PNG)
assets/
  sample-docs/                    — Fictional docs for screenshot demos
  screenshots/                    — Marketplace screenshots (JPEGs) + capture guide
package.json                      — v1.0.8, publisher: interapp, preview: true
README.md                         — Marketplace listing
website/index.html                — Landing page
video/                            — Remotion promo video project
```

## Recent Git Log

```
8cc335d Update marketplace listing: new icon, screenshots, fix URLs
0eaa6ae Add .playwright-cli/ to gitignore
4a0e5e4 Add marketplace README, landing page, promo video scaffold, and publishing prep
3b64de8 Add MIT license, clean up vsix packaging ignore files
eeaecff Add condensed toolbar with dropdown menus, fix settings load and split-view borders
d84611d Fix Cmd+Click link navigation, add Open Link in New Tab context menu
b051dd9 Fix external change detection, context menu overlap, CSS loading, and drag handles
bb6b03e Fix webview loading, add settings modal and context menu open command
```

## Any Other Notes

- Build: `npm run compile` (webpack, both bundles)
- Package: `npm run vsix` (bumps patch version, production build, creates .vsix)
- Tests: `npx vitest run` (75 unit tests)
- Debug: Cmd+Shift+D -> "Run Extension" -> green play button
- Publisher ID is "interapp" — marketplace URL: `https://marketplace.visualstudio.com/items?itemName=interapp.mikedown-editor`
- Git remote: `git@github.com:mikejoseph23/mikedown.git`
- Screenshots use `Cmd+Shift+4` then `Space` for window capture at 1280x800. See `assets/screenshots/README.md` for full guide.
- The `.vsix` must be rebuilt and reuploaded to update the marketplace — pushing to git alone doesn't update the listing.
