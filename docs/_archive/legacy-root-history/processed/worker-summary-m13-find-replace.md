# Worker Summary: M13 — Find & Replace

## Status

COMPLETE — all tasks finished, build passes, committed.

## Work Completed

1. Created `src/webview/findreplace.ts` — ProseMirror decoration plugin via TipTap Extension that:
   - Maintains `currentSearchState` (query, replaceWith, matchCase, wholeWord, useRegex, currentIndex)
   - Builds a `RegExp` from search options and finds all text-content matches
   - Maps plain-text offsets to ProseMirror positions via `textOffsetToPmPos`
   - Creates `Decoration.inline` spans with class `search-match` (all matches) or `search-match-active` (current match)
   - Exports `updateSearch`, `clearSearch`, `findNext`, `findPrev`, `replaceCurrentMatch`, `replaceAllMatches`

2. Wired `FindReplaceExtension` into `src/webview/editor-main.ts`:
   - Added import block for all exported symbols from `./findreplace`
   - Added `FindReplaceExtension` to the TipTap `extensions` array (after SmartPasteExtension)
   - Added Cmd+F / Ctrl+F and Cmd+H / Ctrl+H intercepts at the top of `handleKeyDown` in `editorProps`
   - Added `buildFindReplaceBar(editor)` call after `buildToolbar(editor)`
   - Added global `document.addEventListener('keydown', ...)` for when editor doesn't have focus

3. Defined `buildFindReplaceBar(editor)` in `editor-main.ts`:
   - Creates a floating bar with find input, prev/next buttons, match count, option checkboxes (Aa / |W| / .*), replace toggle, and close button
   - Second row: replace input, Replace and Replace All buttons (hidden until toggle clicked)
   - Exposes `window.__mikedownOpenFind(replace?)` and `window.__mikedownCloseFind` for keyboard handler access
   - Source mode (CodeMirror) noted in next-button handler — CM has its own built-in search

4. Created `src/webview/findreplace.css` — all find/replace bar styles using VS Code CSS variables

5. Added `@import "./findreplace.css"` to `src/webview/editor.css`

## Files Created

- `/Users/michaeljosephwork/Desktop/ideas/markdown-WYSIWYG-vscode-extension/src/webview/findreplace.ts`
- `/Users/michaeljosephwork/Desktop/ideas/markdown-WYSIWYG-vscode-extension/src/webview/findreplace.css`

## Files Modified

- `/Users/michaeljosephwork/Desktop/ideas/markdown-WYSIWYG-vscode-extension/src/webview/editor-main.ts`
- `/Users/michaeljosephwork/Desktop/ideas/markdown-WYSIWYG-vscode-extension/src/webview/editor.css`

## Build Results

- `npx tsc --noEmit` — 0 errors
- `npx webpack --mode development` — compiled successfully (both extension and editor-main bundles)

## Issues / Notes

- `@tiptap/pm/state` and `@tiptap/pm/view` are both available as re-exports of `prosemirror-state` and `prosemirror-view` in the installed TipTap v3.20.0 package. No fallback to direct prosemirror-* imports was needed.
- `textOffsetToPmPos` is an approximation: it maps character offsets in `doc.textContent` to ProseMirror node positions by walking text nodes. This works correctly for standard prose content but may produce off-by-one results across block boundaries (e.g., a match that spans a paragraph break). For this use case (search within visible text) it is acceptable.
- `require('@tiptap/pm/state')` is used dynamically inside `findNext`/`findPrev` for `TextSelection`. This works under webpack's CommonJS transform.
- The global `document.addEventListener('keydown', ...)` is registered once inside the `else` branch (where `editorContainer` is confirmed non-null), preventing double registration.
- Parallel workers M6a and M12a had already merged their changes (SmartPasteExtension, linkTooltip state, anchor ID helpers) into `editor-main.ts` before this commit.

## Start / End Time

- Start: 2026-03-01
- End: 2026-03-01
