# Worker Summary: M14 — Document Stats & Status Bar

## Status
COMPLETE

## Work Completed

All five tasks from the worker prompt were completed:

1. **Created `src/statusBar.ts`** — Implemented the `StatusBarManager` class with:
   - Three `StatusBarItem` instances (word count, character count, reading time), all right-aligned
   - `update(plainText)` method that computes and displays stats immediately
   - `updateDebounced(text, delay?)` method (300 ms default) for real-time event listeners on large documents — clears any pending timer before scheduling a new one
   - `hide()` and `dispose()` methods; `dispose()` also cancels any pending debounce timer
   - `countWords(text)` private method that strips markdown syntax (headings, inline marks, links, images, fenced/inline code, list markers, blockquote markers, horizontal rules) before splitting on whitespace

2. **Updated `src/extension.ts`** — Added at the bottom of `activate()`:
   - `import { StatusBarManager } from './statusBar'` at the top of the file
   - `StatusBarManager` instantiation and registration with `context.subscriptions`
   - `onDidChangeActiveTextEditor` listener: shows stats for `.md`/`.markdown` files, hides otherwise
   - `onDidChangeTextDocument` listener: calls `updateDebounced()` when the active document is a markdown file

3. **Debounce mechanism** — `updateDebounced` added to `StatusBarManager`; used in the `onDidChangeTextDocument` listener.

4. **WYSIWYG editor case** — Noted with a TODO comment at the bottom of `src/statusBar.ts` explaining the expected postMessage interface:
   - Webview sends: `{ type: 'stats', plainText: '...' }`
   - Extension host should call: `statusBar.update(message.plainText)`
   - Wiring deferred to M2a (lives in `markdownEditorProvider.ts` which M2a owns)

5. **TypeScript compile check** — `npx tsc --noEmit` passed with zero errors.

## Files Created / Modified

| File | Action |
|------|--------|
| `src/statusBar.ts` | Created (new) |
| `src/extension.ts` | Modified — added import + status bar block at bottom of `activate()` |

## TypeScript Compile Status

PASS — `npx tsc --noEmit` produced no output (zero errors, zero warnings).

## Issues

None.

## Notes

- The `onDidChangeTextDocument` listener was updated to also match `.markdown` extension (not just `.md`) for consistency with the `onDidChangeActiveTextEditor` listener.
- The debounce timer is properly cleaned up in `dispose()` to avoid leaks.
- The TODO for M2a is placed at the bottom of `src/statusBar.ts` outside the class body so it is clearly visible without cluttering the class interface.

## Start / End Time

- Start: 2026-03-01
- End: 2026-03-01
