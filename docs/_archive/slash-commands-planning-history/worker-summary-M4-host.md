# Worker Summary: M4 (host half) - Image File Picker

Status: Completed (host half only, webview half deferred per scope).

## Work completed

- [x] Defined webview-to-host message "pickImage" with a requestId, and host-to-webview reply "pickedImageResult" carrying requestId plus optional insertPath, webviewUri, alt, cancelled, error.
- [x] Documented both, plus the previously-undocumented savePastedImage / pastedImageResult pair, in the protocol comment at the top of src/webview/editor-main.ts.
- [x] Added 'pickImage' to the WebviewMessage type union in markdownEditorProvider.ts, and a switch case calling handlePickImage.
- [x] handlePickImage host handler: untitled or non-file-scheme docs get the identical "save first" prompt the paste path uses, via a new shared promptSaveDocumentFirstForImage helper. Otherwise it calls vscode.window.showOpenDialog with an Images filter (png, jpg, jpeg, gif, webp, svg, bmp, avif) and defaultUri set to the doc's folder. Cancel replies with cancelled true.
- [x] Computes insertPath via formatInsertPath, alt via a new shared resolveAltTextForImage helper (wraps resolveAltText, prompts when altText is 'prompt'), webviewUri via webview.asWebviewUri.
- [x] Files outside the doc folder and every workspace folder are copied into the image-paste target folder via resolveTargetFolder plus resolveFilename (same hash-dedupe as paste) using a new shared writeImageIntoTargetFolder helper; files inside are referenced in place. "Outside" is decided by two new pure helpers in src/imagePaste.ts: isPathInside and isOutsideResourceRoots.
- [x] Extracted shared logic out of handleSavePastedImage rather than duplicating it: promptSaveDocumentFirstForImage, resolveAltTextForImage, and writeImageIntoTargetFolder are now used by both handleSavePastedImage and handlePickImage. handleSavePastedImage's behavior is unchanged, just reorganized.
- [x] Pure path logic (isPathInside, isOutsideResourceRoots) lives in src/imagePaste.ts with coverage in test/unit/imagePaste.test.ts (9 new test cases).
- [x] npm run lint, npm run compile, npm run test:unit - see Test status below.
- [x] Committed.

Deferred (per worker prompt scope - a later worker does this after M3):
src/webview/imagepick.ts (requestImagePick) and the webview-side pickedImageResult routing in editor-main.ts's message handler were intentionally NOT implemented. Nothing in editor-main.ts was touched except the header protocol comment, per the parallel-work note.

## Files modified

- src/imagePaste.ts - added isPathInside, isOutsideResourceRoots.
- src/markdownEditorProvider.ts - pickImage union member and switch case; handlePickImage; shared helpers promptSaveDocumentFirstForImage, resolveAltTextForImage, writeImageIntoTargetFolder; refactored handleSavePastedImage to use the shared helpers; added ImagePasteSettings and isOutsideResourceRoots imports.
- src/webview/editor-main.ts - protocol comment only (documented savePastedImage/pastedImageResult and pickImage/pickedImageResult).
- test/unit/imagePaste.test.ts - tests for isPathInside and isOutsideResourceRoots.

## Test status

- npm run compile - green (both bundles).
- npm run test:unit - green, 432 of 432 tests passed (35 files), including the 9 new tests plus the existing imagePaste.test.ts suite (now 56 tests).
- npm run lint - pre-existing repo-wide baseline failures unrelated to this change (249 errors and 114 warnings, same lines and files before and after my edit): no-floating-promises on existing unawaited showErrorMessage calls, parserOptions.project TSConfig gaps on unrelated webview files, a control-character regex warning already present in imagePaste.ts. Verified via "git show 3fe9317:path" that every flagged line in imagePaste.ts and markdownEditorProvider.ts pre-dates this worker's changes. My new code follows the same existing conventions (e.g. unawaited vscode.window.showErrorMessage calls match the pre-existing style at every other call site in this file) and introduces no new category of lint error.

## Issues/blockers

None. No scope creep - did not touch the pre-existing lint baseline, the toggleBold/Italic sourceMode bug, or any file outside this milestone's ownership.

## Notes for orchestrator

- handleResizeImage was left untouched (different, simpler "not a saved file" check, no Save-As prompt) - out of scope for M4.
- The image-picker's "outside resource roots" check compares against the doc's own folder plus every vscode.workspace.workspaceFolders entry (matching how localResourceRoots is built in resolveCustomTextEditor), not just the doc's own workspace folder.
- settings.imagePaste.enabled is intentionally NOT checked as a gate for pickImage (unlike savePastedImage) - that setting reads as being about auto-write-on-paste behavior, and gating the picker on it wasn't specified in the plan; flagging this judgment call in case the orchestrator wants it reconsidered.
- The webview half's TODO for the next worker: src/webview/imagepick.ts exporting requestImagePick(view, from, to) (pending-by-requestId map like imagepaste.ts), routing pickedImageResult next to pastedImageResult in the editor-main.ts message dispatcher (around the pre-change line 5066), and wiring the /image slash-command action (M3/M6 territory) to call it.

## Worktree / commit

- Worktree path: /Users/michaeljosephwork/git/mikedown/.claude/worktrees/agent-a6f796ddef939b3f9
- Branch: worktree-agent-a6f796ddef939b3f9
- Base commit verified: 3fe9317 (reset via git reset --hard 3fe9317 - worktree was ahead on unrelated later commits with a clean tree).
- Commit: f150b9d - "Add host-side image file picker (/image message pair)"

## Review Materials

- src/imagePaste.ts - isPathInside (after isInsideManagedFolder), isOutsideResourceRoots.
- src/markdownEditorProvider.ts - handlePickImage, promptSaveDocumentFirstForImage, resolveAltTextForImage, writeImageIntoTargetFolder, refactored handleSavePastedImage, WebviewMessage type union, message switch case 'pickImage'.
- src/webview/editor-main.ts - header protocol comment (top of file, roughly lines 8-45).
- test/unit/imagePaste.test.ts - the isPathInside and isOutsideResourceRoots describe blocks.

Start time: 2026-09-26 00:35 (approx.)
End time: 2026-09-26 00:43
