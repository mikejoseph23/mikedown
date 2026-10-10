# Worker Summary: M3 Host Wiring, Command, Dev Reset

**Status:** Completed

**Start time:** 2026-09-26 00:55
**End time:** 2026-09-26 01:07
**Worktree path:** /Users/michaeljosephwork/git/mikedown/.claude/worktrees/agent-a4ef5d53b6851f455
**Branch:** worktree-agent-a4ef5d53b6851f455
**Commit SHA:** 75bf731c4183ce38f0856d0c8bea043d226e76bd

Note: the worktree was found off a stale base (`e4d26d0 Release 2.10.4`, not an
ancestor of `9c09e3c`). Tree was clean, so per the trap-1 instruction I ran
`git reset --hard 9c09e3c` before starting.

## Work completed (per task)

- `src/supportPrompt.ts` (new): host-side `SupportPrompt` class wrapping
  `context.globalState` via the M2 pure functions (`readState`/`writeState`/
  `isAutoEligible`/`applyAction`/`recordActiveDay`). Owns the review/share/
  issue URLs (carried over unchanged from the removed `nagPrompt.ts`), handles
  `supportAction` (`review`, `share`, `feedback`, `later`, `never`, `close`),
  opens URLs via `vscode.env.openExternal`, writes the share message via
  `vscode.env.clipboard.writeText` + posts `supportCopied`, and posts
  `showSupportCard` for both auto (`onSaveAfterSession`) and manual
  (`showManual`) entry points.
- `src/supportCopy.ts` (new): single source of the **approved** copy (not
  placeholders — M1 landed and Mike approved 2026-09-26, so I used
  `review-appeal-copy.md` verbatim) — card title/body, `avatar: { kind:
  'initial', text: 'M' }`, the five button labels, the copied confirmation,
  the neutral `SHARE_MESSAGE`, and `FALLBACK_NOTICE_TEXT`.
- `src/markdownEditorProvider.ts`: added a per-panel `SessionTracker`
  (`supportSessionTracker`, a plain local closure variable — one per
  `resolveCustomTextEditor` call, so effectively "per panel" without a Map).
  `case 'edit'` calls `supportSessionTracker.recordEdit(now)` and
  `this.supportPrompt.recordEdit(now)` (the latter updates `lastActiveDay`/
  `activeDays`, no-op after the first edit of a given local day). The existing
  per-panel `onDidSaveTextDocument` handler calls
  `this.supportPrompt.onSaveAfterSession(webviewPanel, savedDoc,
  supportSessionTracker)` after its existing work, then resets the tracker.
  Added `case 'supportAction'`, `case 'supportCardShown'`, `case 'busy'` to
  the webview message switch, and a `findVisiblePanel()` static helper for
  the manual command's "most recent visible panel" fallback.
- Diff-view / non-`file:` gating: diff-view panels never reach the
  `didSaveSubscription` setup at all (the provider returns early before it),
  so they're excluded structurally. `onSaveAfterSession` additionally checks
  `document.uri.scheme !== 'file'` and `panel.visible` before scheduling, and
  re-checks both right before actually posting the card 1.5s later.
- `lastPrompt` is written **only** inside `onCardShown()` (the
  `supportCardShown` ack handler); `onBusy()` clears the pending-reason
  tracking without touching persisted state, so a busy reply never "uses up"
  the save.
- Registered `mikedown.support` in `extension.ts` + `package.json` (title
  "MikeDown: Support MikeDown", no `commandPalette` `when` entry — same
  pattern as other always-visible commands like `mikedown.print`). Posts
  `showSupportCard` `reason: 'manual'` to `activePanel ?? findVisiblePanel()`,
  or calls `showFallbackNotice()` (native toast, approved text, same five
  buttons) when no MikeDown panel exists anywhere.
- Registered `mikedown.dev.resetSupportPrompt` gated behind
  `context.extensionMode !== vscode.ExtensionMode.Production`, sets
  `setContext('mikedown.isDevelopment', true)`, added to
  `package.json#contributes.commands` and gated in `commandPalette` with
  `"when": "mikedown.isDevelopment"`. Quick pick offers "Clear all support
  prompt state" (`devResetAll` — deletes every `KEYS` value) and "Make
  eligible now" (`devMakeEligibleNow` — backdates `installDate` 30 days,
  `docOpens: 5`, `activeDays: 3`, clears `lastPrompt`/`dismissed`/
  `reviewedAt`, and arms a one-shot `devForceMeaningfulNextSave` flag so the
  very next save is treated as a meaningful session regardless of real edit
  counts).
- Removed the `setTimeout(() => nag.maybeShow(), 60_000)` startup toast from
  `extension.ts`; `recordActivation`/`onDocOpen` semantics now go through
  `provider.supportPrompt`. Deleted `src/nagPrompt.ts` (confirmed nothing
  else imports it — only two doc-comment mentions remain, in
  `supportPromptEligibility.ts` and `defaultEditorPrompt.ts`, both
  intentionally historical and left as-is).
- Documented `showSupportCard` / `supportCopied` / `supportAction` /
  `supportCardShown` / `busy` in the protocol comment at the top of
  `src/webview/editor-main.ts` (comment only, per the milestone — M5
  implements the handlers).
- `npm run compile` — green (both bundles).
- `npm run lint` — green: full-repo error count is **unchanged at 252**
  versus the base commit (verified by stashing my changes and re-linting the
  base tree); warnings actually **dropped from 124 to 118** (I added braces
  to every new `if` I wrote rather than leaving the pre-existing single-line
  style). `src/supportPrompt.ts` and `src/supportCopy.ts` (new files) lint
  with 0 errors, 0 warnings.

## Files modified

- `src/supportPrompt.ts` (new)
- `src/supportCopy.ts` (new)
- `src/markdownEditorProvider.ts`
- `src/extension.ts`
- `src/webview/editor-main.ts` (protocol doc comment only)
- `package.json` (2 new command entries + 1 `commandPalette` gate)
- `src/nagPrompt.ts` (deleted)

## Test status

No tests were written or run beyond the M3 gate (`npm run compile` +
`npm run lint`), per the milestone's own task list — `test/unit/
supportPrompt.test.ts`, `test/unit/supportPromptEligibility.test.ts`, and
`test/integration/supportCommand.test.ts` are explicitly M4's job (a
different milestone/worker; confirmed by reading `review-appeal-planning.md`
M4's task list, which names all three files).

## Issues or blockers

- **Worktree had no `node_modules`**, and the webview webpack config aliases
  `@tiptap/core` / `@tiptap/pm` / `tiptap-markdown` to
  `path.resolve(__dirname, 'node_modules', ...)`, which resolved to a
  nonexistent directory once `__dirname` was the worktree path — this broke
  `npm run compile` for the webview bundle only (the extension host bundle,
  which is everything I touched, compiled fine throughout; ts-loader ran full
  type-checking on it with zero new errors before I did anything else).
  I created `node_modules` as a symlink to the main repo's
  `/Users/michaeljosephwork/git/mikedown/node_modules` inside the worktree so
  I could get a real full `npm run compile` green (both bundles) rather than
  relying only on the host bundle's clean type-check. It's untracked (not
  staged/committed) and matches the repo's own `.gitignore` entry for
  `node_modules/` in spirit. Left in place in case a reviewer wants to
  re-verify the build in this worktree; safe to delete otherwise.
- Everything else in the M3 task list was completed as specified; nothing
  deferred.

## Notes for orchestrator

- `SupportPrompt` is a single instance (`provider.supportPrompt`, created
  once in `MarkdownEditorProvider`'s constructor) that lives for the
  extension host's lifetime — this is where `autoShownThisSession` (the "at
  most one auto show per VS Code session" cap the M2 module deliberately
  excludes from its pure state) lives, as a plain instance field.
- `lastPrompt` is now written for **both** auto and manual shows (any ack of
  `supportCardShown` writes it) — only `autoShownThisSession` is reason-gated
  to `'auto'`. This seemed like the intended reading of "Record lastPrompt
  only when the webview acks `supportCardShown`" (no reason qualifier in that
  bullet), and it means a manual open via the command also pushes back the
  next auto-show gap, which seems right.
- M5 (webview render + ack) can post `busy` for *either* `reason: 'auto'` or
  `'manual'` — `onBusy`/`onCardShown` don't care which; I track the pending
  reason per-panel via a `WeakMap` set right before `postCard()`.

## Review Materials

- `src/supportPromptEligibility.ts` — unchanged (M2), only imported from.
- `src/supportPrompt.ts` — full new file, host wiring.
- `src/supportCopy.ts` — full new file, approved copy.
- `src/markdownEditorProvider.ts` — search `supportSessionTracker`,
  `onSaveAfterSession`, `findVisiblePanel`, `case 'supportAction'`.
- `src/extension.ts` — search `mikedown.support`, `mikedown.dev.resetSupportPrompt`.
- `package.json` — search `mikedown.dev.resetSupportPrompt` (commands +
  commandPalette entries).
- `src/webview/editor-main.ts` — top-of-file protocol comment, "Support
  appeal" section.
