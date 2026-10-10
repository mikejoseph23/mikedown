# Worker Summary — M7: Default-Editor Discoverability

**Status:** Completed

## Work completed

- Added `src/defaultEditorPrompt.ts`: first-run "make MikeDown the default `.md` editor?" toast, shown once shortly after activation. Reuses the globalState-backed dismissal pattern from `src/nagPrompt.ts` (own key namespace, `mikedown.defaultEditorPrompt.*`), but as a one-time offer rather than a recurring nag — any response (Yes / Not now / Don't ask again / dismiss) gates the toast from showing again automatically.
  - "Yes" and the new command both call `applyMikeDownAsDefaultEditor()`, which writes `workbench.editorAssociations["*.md"] = "mikedown.editor"` at global scope via `vscode.workspace.getConfiguration().update(...)`.
  - `shouldOfferDefaultEditorPrompt()` skips the prompt if `workbench.editorAssociations` already maps `*.md` to MikeDown, or if the prompt has already been shown once.
  - Exported `isMikeDownDefaultEditor`, `applyMikeDownAsDefaultEditor`, and `shouldOfferDefaultEditorPrompt` as standalone functions so M8 can unit-test the "should we prompt?" predicate directly.
- Registered `mikedown.setAsDefaultEditor` command (palette-triggerable at any time) in `package.json#contributes.commands` and wired in `src/extension.ts`. It's idempotent — shows "already your default editor" if already set.
- Wired `maybeOfferDefaultEditorPrompt(context)` into `src/extension.ts#activate`, on a 5s idle delay (before the existing 60s nag-prompt delay, so the two toasts don't collide).
- README: added a new "Make MikeDown your default Markdown editor" section directly under "Why MikeDown?" — above the fold, before Screenshots/Features, per the task requirement. Also rewrote the existing "Getting Started" manual-steps section to describe the real VS Code flow (right-click tab → Reopen Editor With… → Configure default editor for `.md`… → MikeDown Editor) and cross-link to the new above-the-fold section, and to point at the new command instead of the pre-existing `mikedown.defaultEditor` checkbox setting.
- CHANGELOG: added an `[Unreleased]` entry describing the feature.

## Files modified

- `src/defaultEditorPrompt.ts` (new)
- `src/extension.ts`
- `package.json`
- `README.md`
- `CHANGELOG.md`

Commit: `6591bea` — "Add first-run prompt to set MikeDown as default markdown editor"

## Test/lint status

- `npm run compile`: clean, both bundles built successfully.
- `npm run lint`: **not clean on `main` before this milestone either** — 326 problems (225 errors, 101 warnings) both before and after my changes (verified via `git stash`/`git stash pop` diff). Pre-existing issues are (a) several `src/webview/*.ts` files not included in `tsconfig.json`'s parserOptions.project (parsing errors), and (b) `@typescript-eslint/no-floating-promises` errors on every `vscode.commands.registerCommand(..., async () => ...)` callback in `src/extension.ts` that isn't individually wrapped — a pattern that predates this milestone and that my new command registration follows for consistency with its neighbors. My change introduced **zero net-new lint errors or warnings** (verified identical problem count before/after). Did not attempt to fix the pre-existing lint debt — out of scope for this milestone and risks unrelated diff noise.
- `npm run test:unit`: 295/295 passing, unaffected by this change (no existing tests touch this code path — M8 owns writing new tests for it).

## Issues or blockers

- **`npm run lint` is not actually clean**, but this is pre-existing repo-wide lint debt unrelated to M7 (confirmed via git stash comparison — identical error/warning count on `main` before my changes). Flagging for the orchestrator since the milestone's own checklist says "both clean" — that bar was already unmet before this worker started. Worth a separate cleanup milestone if it matters for shipping.
- Left the pre-existing `mikedown.defaultEditor` boolean setting (in `package.json`, `src/settings.ts`, Settings modal) untouched. Investigation showed it doesn't actually drive any VS Code behavior — nothing sets `workbench.editorAssociations` or a `customEditors` `priority` off the back of it — so it appears vestigial/non-functional independent of this milestone. Did not remove or fix it since that's a separate, unscoped bug; just stopped pointing users at it from the README and pointed them at the real mechanism (the new command / `workbench.editorAssociations`) instead. Orchestrator may want a follow-up milestone to either wire that setting up for real or remove it to avoid confusing users.

## Notes for orchestrator

- M8 should be able to unit-test `shouldOfferDefaultEditorPrompt`, `isMikeDownDefaultEditor`, and `applyMikeDownAsDefaultEditor` directly by importing from `src/defaultEditorPrompt.ts` — no need to spin up a full extension host for the predicate logic. Only `applyMikeDownAsDefaultEditor`/the command itself needs the `@vscode/test-electron` integration test to verify the real `workbench.editorAssociations` write.
- "Don't ask again" and "Not now" currently behave identically from the user's perspective (neither re-shows the prompt, since it's specified as a one-time first-run offer) — they're persisted under different `dismissal` values (`'never'` vs `'notNow'`) for potential future differentiation, but there's no current logic that reads `dismissal` back. Worth knowing if M8 tests expect behavioral divergence between the two choices.

**Start time:** 2026-08-13 (session start)
**End time:** 2026-08-13 (same session, ~40 minutes elapsed)
