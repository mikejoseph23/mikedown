# MikeDown Editor — Resume Prompt

## Project Overview

MikeDown Editor is a WYSIWYG Markdown editor for VS Code, built on TipTap v2 / ProseMirror with CodeMirror 6 for source mode. It uses the VS Code Custom Editor API, targets GFM spec, runs fully offline, and is MIT licensed. Published to the VS Code Marketplace under publisher "interapp" (Michael Joseph). Currently in beta (`"preview": true`). All references to Typora have been removed from user-facing content — the extension is positioned as "a true WYSIWYG Markdown editor" without naming competitors.

## Current Status

**v1.0.11 is packaged (`mikedown-editor-1.0.11.vsix`) and ready to publish.** Font theme system with 10 curated heading+body pairings. Default is "Editorial" (Avenir headings + Charter body). Website and promo video updated with screenshots and new features.

- Just finished: font theme system, Document Outline TreeView, link picker redesign, marketplace listing overhaul, activity bar sidebar icon, website update (hero screenshot, Document Outline + Font Themes features, fixed GitHub/marketplace URLs), promo video update (screenshots in feature carousel + problem scene reveal, Document Outline + Font Themes added to features)
- Ready to publish: v1.0.11 vsix is built
- **BLOCKING before publish: retake all 7 marketplace screenshots.** Default font changed from monospace to Editorial theme (Avenir headings + Charter body). Every existing screenshot in `assets/screenshots/` shows the old font and will look wrong on the listing. See `assets/screenshots/README.md` for capture guide. Must repackage vsix after retaking since screenshots are bundled.
- Known limitation: VS Code's built-in Outline panel says "The active editor cannot provide outline information" for custom editors — this is a VS Code API constraint. The custom "Document Outline" TreeView in the MikeDown sidebar is the workaround.

## What's Done

- Full WYSIWYG editing with GFM support (TipTap v2 + tiptap-markdown)
- Condensed Apple Notes-style toolbar with dropdown menus
- Source mode toggle (CodeMirror 6, Cmd+/)
- Smart paste (Google Docs, Word, Slack, web -> clean Markdown)
- Cmd+Click link navigation, right-click "Open Link" / "Open Link in New Tab"
- Link autocomplete redesigned: grouped sections (Headings with hierarchy, Used in Document for non-anchor links, Workspace Files, External URL), refocus on blur
- Broken link detection (red wavy underline)
- Backlink Explorer panel (in MikeDown sidebar)
- Document Outline TreeView: heading hierarchy, click-to-navigate via scrollToAnchor, active heading tracking via scroll events
- MikeDown activity bar icon (monochrome M+arrow from main logo) with Document Outline + Backlinks panels
- DocumentSymbolProvider for VS Code Outline (works when file also open in text editor)
- Font theme system: 10 curated heading+body font pairings (Editorial, Magazine, Notebook, Academic, Technical, Manuscript, Modern, Classic, Literary, Developer), OS-aware font stacks, live preview cards in settings, `--mikedown-heading-font-family` CSS variable, keyboard navigation, revert button
- Default theme: "Editorial" — Avenir headings + Charter body (Mac), Segoe UI headings + Cambria body (Windows)
- Table editing: grid picker, contextual toolbar, drag handles, multi-cell selection
- Find & Replace inside the WYSIWYG editor (ProseMirror decorations)
- Code block syntax highlighting (192 languages via lowlight)
- Frontmatter support (collapsible YAML block)
- Editor-only light/dark theme toggle
- Export to HTML, print, copy as rich text
- Image support: inline rendering, click-to-edit popover
- Marketplace listing: 7 screenshots with captions, personal intro, no competitor references

## What's Next

1. **Publish v1.0.10** to the VS Code Marketplace (manual vsix upload)
2. **Retake all 7 marketplace screenshots** — default font is now Editorial theme (Avenir headings + Charter body). Current screenshots show old monospace default. See `assets/screenshots/README.md` for capture guide.
3. **Test Document Outline** more thoroughly — active heading tracking, switching between files, large documents
4. **Consider**: The built-in Outline panel limitation is worth noting in Known Limitations in README

## Key File Paths

```
src/
  extension.ts                    — Extension activation, provider registration, command wiring
  markdownEditorProvider.ts       — CustomTextEditorProvider, webview setup, message handling, font theme delivery
  outlineProvider.ts              — DocumentSymbolProvider + DocumentOutlineProvider (TreeView)
  backlinkProvider.ts             — Backlink Explorer TreeDataProvider
  settings.ts                     — MikeDown settings interface
  export.ts                       — HTML/PDF export
  statusBar.ts                    — Word/character count status bar
  webview/
    editor-main.ts                — TipTap editor setup, toolbar, font theme picker, settings modal (~2200 lines)
    linkautocomplete.ts           — Grouped link picker (headings, files, in-doc, external URL)
    linkautocomplete.css          — Link picker styles (hardcoded colors for contrast)
    editor.css                    — Editor typography, --mikedown-heading-font-family on all heading levels
    theme.css                     — Body font-family via --mikedown-font-family
    contextmenu.ts                — Right-click context menu
    findreplace.ts                — Find & Replace UI
    smartpaste.ts                 — Rich text paste -> markdown conversion
    tablepicker.ts                — Table grid picker
    toolbar-dropdown.ts           — Toolbar dropdown menus
package.json                      — Extension manifest, views, commands, settings (fontFamily + headingFontFamily)
README.md                         — Marketplace listing (recently overhauled)
images/
  icon.png                        — Marketplace icon
  icon-sidebar.svg                — Activity bar sidebar icon (monochrome M+arrow)
assets/screenshots/               — 7 marketplace screenshots (STALE — need retaking with new font default)
```

## Recent Git Log

```
df1cf2d Update website and promo video with screenshots and new features
11e47d0 Switch default font theme to Editorial, bump to v1.0.11
ea2ef6b Add font theme system, Document Outline, link picker redesign (v1.0.10)
596b30c Add Document Outline panel and activity bar sidebar (v1.0.9)
1282a10 Update marketplace listing and redesign link picker
e2fd4c0 Resume prompt checkin
8cc335d Update marketplace listing: new icon, screenshots, fix URLs
0eaa6ae Add .playwright-cli/ to gitignore
```

## Any Other Notes

- **Publishing**: Currently using manual .vsix upload to the Marketplace. The vsix is at `mikedown-editor-1.0.11.vsix` in the project root.
- **Font themes**: Heading and body fonts are separate CSS variables (`--mikedown-font-family`, `--mikedown-heading-font-family`). The settings panel has a themed picker with live preview cards. The toolbar "Aa" button was removed — themes are accessed via the settings gear. Default is "Editorial" (Avenir headings + Charter body on Mac, Segoe UI headings + Cambria body on Windows).
- **Contrast fix**: The link autocomplete and font picker use hardcoded colors (`#d4d4d4`, `#e0e0e0`, etc.) instead of VS Code theme variables because the webview context doesn't resolve them reliably.
- **Custom editor limitation**: VS Code's `DocumentSymbolProvider` populates the Outline panel but `revealRange` is a no-op for custom editors. The custom TreeView with `scrollToAnchor` messaging is the workaround.
- **Website**: `website/index.html` — hero screenshot added, Document Outline + Font Themes features added, GitHub/marketplace URLs fixed. References `../assets/screenshots/` for images.
- **Promo video**: `video/` — Remotion project, 30s at 1080p. Screenshots integrated into feature carousel and problem scene. Render with `cd video && npm run render`. Output: `video/out/promo.mp4`.
- **Testing**: `F5` launches Extension Development Host. Open any `.md` file and right-click -> "Open with MikeDown" or set `mikedown.defaultEditor` to true.
