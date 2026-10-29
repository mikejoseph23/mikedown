# Worker summary: U2 — Update window and settings UI

**Status:** Completed

- Worktree: `/Users/michaeljosephwork/git/mikedown/.claude/worktrees/agent-a4859d5e84a8abf73`
- Branch: `worktree-agent-a4859d5e84a8abf73`
- Commit: `b05be16`
- Base: `f4c35a5` was not on the worktree, so it was reset to `3ad55d5` per the prompt (tree was clean)
- Start: 2026-10-24 00:09 EDT. End: 2026-10-24 00:26 EDT
- Note: worktree isolation blocked writing to the main repo path, so this summary lives in the worktree at the same relative path (`.orchestrator/` is gitignored).

## Work completed

- [x] **Found-notice**: bottom-right, non-modal, `role=status`, never takes focus. Says "MikeDown X is available" with View and a close button. Close or Escape hides it for the session (not a snooze). (`src/ui/updateToast.ts`)
- [x] **Update window**: a sheet that drops from the top edge, laid out like Sparkle (app icon left; title, subtitle, major-update line, "What's new" right). Notes are rendered with markdown-it (`html: false`) and then passed through an allowlist sanitizer. The empty-notes text is shown when there are none. Links open in the browser through `shell.open`. (`src/ui/updateWindow.ts`, `src/ui/releaseNotes.ts`, `src/styles/update.css`)
- [x] **Buttons**: Skip This Version (far left), Remind Me Later, and Install and Relaunch (primary, focused on open). Enter on a non-button triggers Install, Escape is Remind Me Later, and Tab stays inside the sheet.
- [x] **Progress and states**: "Downloading update… N%" with a determinate bar (indeterminate when there is no Content-Length), then "Verifying…". After a cancelled quit dialog, "Update ready. Install when you're ready." comes back with the buttons. Installing shows the Windows reopen line (macOS: "…will relaunch in a moment"). The failed line links its own words "MikeDown website" to `https://www.iadev.net/mikedown/`.
- [x] **OS notification**: `tauri-plugin-notification` (Cargo, `lib.rs`, three `notification:` permissions in `capabilities/default.json`, npm `@tauri-apps/plugin-notification`). It posts only from the window that ran the silent check, only when no MikeDown window is focused, and at most once per version per day. Permission is requested only at first use.
- [x] **Settings > App > Updates**: "Automatically check for updates" (same `updates.checkOnLaunch` key, no migration), "Last checked: <relative time>" from `updater_status`, and a Check Now button. The whole group is hidden on a store build, and the key is left out of the save patch there. The old About "Check for Updates…" button was removed (About now shows only the version).
- [x] **Manual-check strings** match the spec. `classifyCheckError` in `updater.ts` maps transport errors to "Couldn't reach…" and manifest errors to "unexpected response". A manual check opens the window directly. A manual check during a download opens the window on the progress and does not restart the download.
- [x] **ARIA**: the sheet is `role=alertdialog` with `aria-modal` and labelled/described-by. A polite live region announces phase changes and download progress in 25% steps. The bar is `role=progressbar` with aria-valuenow. Focus returns to the previously focused element on close.
- [x] Commit.

## Files

- New: `src/ui/updateWindow.ts`, `src/ui/releaseNotes.ts`, `src/ui/updateView.ts`, `src/ui/updateNotification.ts`, `src/styles/update.css`, `test/unit/{releaseNotes,updateView,updateNotification,updateWindow}.test.ts`, `test/e2e/update-window.spec.ts`
- Changed: `src/ui/updateToast.ts` (now the found-notice plus `createUpdatePrompt` routing), `src/app/updater.ts` (spec MESSAGES and `badFeed`; `UpdatePrompt.show(..., {manual})` and `showsProgress()`; `onSilentFound` hook; `classifyCheckError`), `src/main.ts`, `src/settings/appTab.ts`, `src/settings/appActions.ts` (doc comment only), `src/styles/app.css` (old toast CSS moved out), `package.json` (adds `markdown-it`, which was already in the tree through core, `@types/markdown-it` and the notification plugin), `package-lock.json`, `src-tauri/{Cargo.toml,Cargo.lock,src/lib.rs,capabilities/default.json}`
- Help menu label was already "Check for Updates…", so it is unchanged.

## Tests

- `npm run typecheck`: clean
- `npm run test:unit`: 463 passed across 37 files (was 404 across 33)
- `cargo test`: 115 passed, 6 ignored (unchanged)
- `npx playwright test … update-window`: 3 passed (also 9/9 with `--repeat-each 3`). This covers axe on the notice and the window in light and dark, plus the flow and the narrow layout.

## Issues / notes

- **Notification click**: the plugin does not report clicks on desktop. Clicking a banner activates the app, so a window gaining focus within 10 minutes of the notification opens the update window (`onFocus`, shared through localStorage). T2 should check this on both OSes, especially Windows toast activation.
- I added a quiet **Hide** button while a download runs, which is not in the spec. Without it, a mouse user would have no way out of a stalled download. Hiding does not snooze. When the download reaches ready, the window comes back because Install was pressed in it.
- "Major update" means the first version number grows (0.x to 1.0, 1.x to 2.0).
- The Windows/Mac split for the installing line comes from `navigator.platform` in `main.ts`.

## Notes for orchestrator / T1

- Dev hooks: `window.mikedownApp.updater` and `window.mikedownApp.updateWindow` (DEV and smoke builds only).
- Selectors: `.mdapp-update[data-version]` with `[data-action=view|close]`. `.mdapp-updwin[data-mode=offer|progress|ready|installing|failed]` with `[data-action=skip|later|install|hide]`, `[role=progressbar]`, `.mdapp-updwin__notes`, `.mdapp-updwin__website`. App tab: `[data-action=check-updates]` and `[data-role=last-checked]`.
- Worth more T1 coverage: `classifyCheckError` against real plugin error strings (offline, a 404 feed, malformed JSON, missing platform), the controller path for ready after a cancelled quit dialog with the window hidden, and keyboard order checked with a real screen reader in T2.

## Review Materials

To see it in the browser (mocked Tauri): from `/Users/michaeljosephwork/git/mikedown/.claude/worktrees/agent-a4859d5e84a8abf73/packages/desktop`, run
`MIKEDOWN_SHOTS=/tmp/shots npx playwright test --config test/e2e/playwright.config.ts update-window`
This writes `light-` and `dark-` screenshots of the notice, window, downloading and failed states, plus `narrow.png`, to that folder.

To see it in the real app: run `npm run dev` from the same directory. In Web Inspector:
`mikedownApp.updater.announce({version:'1.0.0',currentVersion:'0.1.0',notes:'- Hello',date:null})` shows the notice; click View for the window.
Then `mikedownApp.updater.applyHostState({state:'downloading',version:'1.0.0',error:null}); mikedownApp.updater.applyProgress({downloaded:42,total:100})` shows the progress state.
Use `state:'failed'` or `state:'ready'` for the others. Settings > App shows the Updates group.
