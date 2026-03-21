# Resume Prompt — MikeDown Editor

Paste this into a new Claude Code window to resume.

---

```
Read and follow the instructions in .orchestrator/prompts/ if needed, but first read this context.

## Project State

All 28 milestones of MikeDown Editor are COMPLETE as of 2026-03-01.

Project directory: /Users/michaeljosephwork/Desktop/ideas/markdown-WYSIWYG-vscode-extension/

The extension is a Typora-style WYSIWYG Markdown editor for VS Code (v0.1.0), built on TipTap v2 + ProseMirror, with CodeMirror 6 for source mode. It is fully offline, uses the VS Code Custom Editor API, and targets GFM spec.

## What's Built

Every feature is implemented and committed:
- WYSIWYG editing with full GFM support (TipTap v2 + tiptap-markdown)
- 21-button toolbar with keyboard shortcuts
- Source mode toggle (CodeMirror 6, Cmd+/)
- Smart paste (Google Docs, Word, Slack, web → clean Markdown)
- Find & Replace (ProseMirror decoration plugin, regex/case/whole-word)
- Context menu (right-click for text/link/table/image)
- Table grid picker + contextual table toolbar + drag handles + multi-cell selection
- Export: HTML, print/PDF, copy-as-rich-text (ClipboardItem API)
- Image handling: inline rendering, viewport scaling, click-to-edit popover
- Link navigation (Cmd+Click), autocomplete (fuzzy workspace file/anchor dropdown), broken link detection (wavy red underline), backlinks Explorer panel
- Frontmatter: collapsible YAML block
- Code blocks: syntax highlighting via lowlight (192 languages)
- Document stats in status bar
- VS Code theming, 10+ settings, auto-reload
- Unit tests: 53/53 pass (vitest, test/unit/)
- Edge case + performance tests: 22/22 pass (test/edge-cases/, test/performance/)
- Integration tests: written (test/integration/, @vscode/test-cli)
- ARIA labels + keyboard accessibility on toolbar
- CHANGELOG.md, images/icon.svg + icon.png, .vsixignore

## Remaining Before Marketplace Publish

1. Change `"publisher": "mikedown"` in package.json to your real VS Code Marketplace publisher ID
2. Create README.md (user-facing documentation)
3. Run `npx vsce package` to produce the .vsix file
4. Test-install the .vsix in VS Code and verify all features work

## Key Files

- `PLANNING.md` — full milestone history and task checklist (all checked)
- `src/extension.ts` — activation, command registration, BacklinkProvider wiring
- `src/markdownEditorProvider.ts` — Custom Editor, webview message dispatch
- `src/webview/editor-main.ts` — TipTap setup, toolbar, all message handlers
- `src/webview/editor.css` — imports all feature CSS modules
- `package.json` — v0.1.0, all contributes (commands, views, configuration)
- `.orchestrator/state.json` — all 28 milestones marked complete

## How to Build

cd /Users/michaeljosephwork/Desktop/ideas/markdown-WYSIWYG-vscode-extension
npx webpack --mode production   # build dist/
npx tsc --noEmit                 # type-check
npx vitest run test/unit         # 53 unit tests
npx vitest run test/edge-cases test/performance  # 22 edge/perf tests
```
