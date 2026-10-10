# Worker Summary: M4 — Source Mode Toggle

## Status

COMPLETE

## Start / End Time

- Start: 2026-03-01
- End: 2026-03-01

## Work Completed

All 8 tasks from the prompt were completed:

1. **Installed CodeMirror 6 packages** — `@codemirror/state`, `@codemirror/view`, `@codemirror/lang-markdown`, `@codemirror/commands`, `@codemirror/language`, `@codemirror/theme-one-dark` via npm.

2. **Added `#source-container` div** to `getWebviewContent()` in `markdownEditorProvider.ts`, immediately after `#editor-container`. Initial `display:none` hides it. Also added `toggleSource` to `WebviewMessage` type and a message handler that forwards `toggleSource` messages back to the webview.

3. **Added CodeMirror imports** to `editor-main.ts` (after existing TipTap imports). The `markdown` import was aliased to `cmMarkdown` to avoid collision with the local variable `markdown` used throughout the file. State variables `sourceMode` (boolean) and `cmView` (EditorView | null) added in module scope.

4. **Implemented toggle functions**:
   - `buildCmTheme()` — reads VS Code CSS variables to theme the CodeMirror editor to match the current VS Code theme.
   - `initCmView()` — lazily initializes CodeMirror with history, keymap, line numbers, active line highlighting, markdown language, syntax highlighting, and line wrapping.
   - `switchToSource()` — serializes TipTap content (re-attaching frontmatter via M15's `restoreFrontmatter`), sets it into CodeMirror, hides `#editor-container`, shows `#source-container`, disables formatting toolbar buttons, marks the source toggle button active.
   - `switchToWysiwyg()` — reads markdown from CodeMirror, extracts frontmatter, loads body into TipTap, shows `#editor-container`, hides `#source-container`, re-enables toolbar buttons, calls `updateToolbarState` and re-renders the frontmatter block.

5. **Wired `toggleSource` message handler** in `window.addEventListener('message', ...)`:
   - Added `message.type === 'toggleSource'` branch that calls `switchToSource()` or `switchToWysiwyg()`.
   - Added `case 'toggleSource'` to the `message.type === 'command'` switch for completeness.

6. **Added `Cmd+/` keybinding** to `package.json` `contributes.keybindings`. The `mikedown.toggleSourceMode` command was already present in `contributes.commands` (added by M3), so no duplicate was added.

7. **Added source mode CSS** to `src/webview/theme.css` (appended at bottom): `#source-container`, `#source-container .cm-editor`, and `#source-container .cm-editor.cm-focused` rules for full-height CodeMirror rendering.

8. **Build verification** passed clean:
   - `npm run compile` (webpack): both bundles compiled successfully.
   - `npx tsc --noEmit`: zero TypeScript errors.

## Files Modified

- `/Users/michaeljosephwork/Desktop/ideas/markdown-WYSIWYG-vscode-extension/src/webview/editor-main.ts` — CodeMirror imports, state vars, `buildCmTheme`, `initCmView`, `switchToSource`, `switchToWysiwyg`, message handler wiring.
- `/Users/michaeljosephwork/Desktop/ideas/markdown-WYSIWYG-vscode-extension/src/markdownEditorProvider.ts` — `#source-container` div in HTML, `toggleSource` in `WebviewMessage` type, `toggleSource` case in message handler.
- `/Users/michaeljosephwork/Desktop/ideas/markdown-WYSIWYG-vscode-extension/src/webview/theme.css` — Source mode container CSS rules appended.
- `/Users/michaeljosephwork/Desktop/ideas/markdown-WYSIWYG-vscode-extension/package.json` — `Cmd+/` keybinding added, CodeMirror packages added to dependencies.
- `/Users/michaeljosephwork/Desktop/ideas/markdown-WYSIWYG-vscode-extension/package-lock.json` — Updated by npm install.

## Build Results

- webpack (extension bundle): compiled successfully, 29.9 KiB output.
- webpack (webview bundle): compiled successfully, 4.02 MiB output. CodeMirror contributed ~967 KB (@codemirror) + ~384 KB (@lezer parsers). The larger-than-expected total is due to M15's lowlight (~1.49 MiB with all highlight.js languages).
- `npx tsc --noEmit`: no errors.

## M15 Integration Notes

This worker found that M15 had already been merged into `editor-main.ts` before M4 began. The file contained:
- `frontmatterContent`, `frontmatterExpanded` state variables
- `extractFrontmatter`, `restoreFrontmatter` helpers
- `renderFrontmatterBlock` function
- `CodeBlockLowlight` extension in the TipTap extensions array
- Frontmatter extraction in the `update` message handler

M4's `switchToSource` was updated to use `restoreFrontmatter` when serializing TipTap content so the full markdown (including frontmatter) appears in source mode. M4's `switchToWysiwyg` calls `extractFrontmatter` on the CodeMirror content and `renderFrontmatterBlock` after loading so the frontmatter UI stays in sync.

The `markdown` import from `@codemirror/lang-markdown` was aliased as `cmMarkdown` to avoid shadowing the local `markdown` variable used in the onUpdate callback (now renamed `body` inside the callback in the M4-modified version — but since M15 already renamed the local to `body`, the import alias was still applied for clarity and safety).

## Issues

- **Cursor position mapping accuracy**: The cursor mapping from TipTap's ProseMirror offset to CodeMirror character offset is approximate. TipTap's `textBetween` gives the plain text before the cursor, but the serialized markdown may have additional characters (markers, newlines) that shift the position. The mapping is wrapped in try/catch to be silent on errors. This is noted as a known limitation.

## Notes

- The `toggleSource` button in the toolbar uses `data-action="sourceToggle"` (matching the button ID defined in `buildToolbar`), not `data-action="toggleSource"`. The `switchToSource` and `switchToWysiwyg` functions target `sourceToggle` accordingly.
- The toolbar's undo/redo buttons are intentionally left enabled in source mode so users can undo/redo within CodeMirror (CodeMirror's own history extension handles these via `historyKeymap`).
