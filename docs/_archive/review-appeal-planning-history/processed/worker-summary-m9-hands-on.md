# M9 Worker Summary: Hands-on Pass and Measurement Follow-up

**NOTE:** The sandbox blocked writing directly to the main repo's
`.orchestrator/review-appeal-planning/worker-summary-m9-hands-on.md` (Trap 2).
This file is written at the same relative path inside the worktree instead,
uncommitted. The orchestrator should copy it to the main repo path.

**Status:** Partial (all automatable items done; hands-on pass and Mike's sign-off deliberately left for Mike, per this milestone's design)

**Start:** 2026-09-26 01:38
**End:** 2026-09-26 01:42
**Worktree:** /Users/michaeljosephwork/git/mikedown/.claude/worktrees/agent-a2930c320cebab454
**Branch:** worktree-agent-a2930c320cebab454
**Commit:** 5dfd02b ("Add review appeal follow-ups to backlog"), on top of base 8b14951

## Work completed

- **Reset worktree.** It was stale at `e4d26d0` (Release 2.10.4) on a clean tree; reset to `8b14951` per Trap 1.
- **`npm run compile`** — green (extension.js + editor-main.js both built successfully).
- **`npm run test:unit`** — green, 601/601 passed, 43 test files.
- **`npm run test:integration`** — skipped in the worktree per the orchestrator's scope note (worktree paths overflow the VS Code test-electron socket path limit). The orchestrator already ran it green (28 tests) in the main tree at base commit 8b14951.
- **Marketplace baseline** (`npx vsce show interapp.mikedown-editor`, run 2026-09-26 ~01:41, pre-release):
  - Installs: **391**
  - Rating: **5.00 average** (**5** reviews)
  - Also: downloadCount 982, current published version 2.10.4 (2.11.0 not yet released)
  - Roughly matches the ~400 installs / 5 reviews expectation in the milestone.
- **BACKLOG.md** — appended two items under "Polish" (append-only, existing style kept):
  - Photo avatar follow-up (mirrors the planning doc's Follow-ups section, `review-appeal-planning.md` line ~301).
  - A "Review appeal: 30/60 day measurement check-in" item with a two-box checklist (30 days / 60 days after the 2.11.0 release) and the baseline numbers above recorded inline.
  - Also fixed a pre-existing missing blank line before the adjacent `## Product ideas` heading (MD032) while editing that spot.
- **Did not edit `review-appeal-planning.md`** (out of scope) — the orchestrator should log the baseline above into its Progress Log, and use the BACKLOG.md checklist as the reminder to record 30/60 day results there.
- **Did not mark Mike's sign-off checkbox** — left for Mike/orchestrator as instructed.

## Files modified

- `BACKLOG.md` (worktree) — committed, commit `5dfd02b`.

## Test status

- `npm run compile`: green.
- `npm run test:unit`: 601 passed / 601, 43 files.
- `npm run test:integration`: not run here (worktree limitation); green (28) in main tree per orchestrator.
- `npm run lint`: not touched — this milestone's only file change (`BACKLOG.md`) is not lint-relevant.

## Issues or blockers

- None. The hands-on pass itself (steps below) requires a human running the Extension Development Host and cannot be completed by this worker — that is by design (Sonnet prepares the steps; Mike performs the pass; the orchestrator pauses here).

## Notes for orchestrator

- Log the Marketplace baseline into `review-appeal-planning.md`'s Progress Log: 391 installs, 5.00 rating, 5 reviews, 982 downloads, captured 2026-09-26 pre-2.11.0-release.
- The 30/60 day re-check checklist now lives in `BACKLOG.md` under Polish; when Mike (or a future session) re-runs `npx vsce show interapp.mikedown-editor`, tick a box there and copy the numbers into the planning doc's Progress Log.
- Do not mark the "Mike signs off" checkbox in the planning doc — that is Mike's action.
- This summary file could not be written to the main repo path directly (sandbox blocked cross-worktree writes); please copy `.orchestrator/review-appeal-planning/worker-summary-m9-hands-on.md` from worktree `agent-a2930c320cebab454` into the main repo.

## Review Materials

**How to launch:** Open `/Users/michaeljosephwork/git/mikedown` in VS Code, run `npm run compile`, then press F5 to open the Extension Development Host. After further edits, `npm run compile` then `Cmd+R` in the host window to reload.

**Hands-on steps** (updated to match what M2 to M8 actually built — real labels/commands from `src/supportCopy.ts`, `src/supportPrompt.ts`, `src/webview/supportCard.ts`, `src/webview/outlineSidebar.ts`, and `package.json`):

1. Open any `.md` file in MikeDown. Expected: no card, no toast at startup, even after waiting 2 minutes (the old startup nag was removed; the only native notice left is the `mikedown.support` fallback below).
2. Command palette, **"MikeDown: Support MikeDown"**. Expected: the "A note from Mike" card appears bottom right; on this manual open, focus lands on **"Leave a review"**; typing is unaffected once you click back into the editor.
3. Click **"Tell a colleague"**. Expected: the button's label swaps to a checkmark + "Copied. Paste it anywhere." for about 2 seconds, then reverts; pasting into any text field shows the neutral line: "Check out MikeDown, a WYSIWYG markdown editor for VS Code: https://marketplace.visualstudio.com/items?itemName=interapp.mikedown-editor". The card stays open (only this action keeps it open).
4. Click **"Leave a review"**. Expected: default browser opens the Marketplace review section (`...&ssr=false#review-details`); the card closes.
5. Open the sidebar. Expected: **"♥ Support MikeDown"** appears inline after the word/char/read-time metrics, on the same footer row, subtle styling, no extra row; clicking it opens the card. Wait 60 seconds (footer re-renders every minute); the link is still present.
6. Hover the link, then Tab to it with the keyboard. Expected: a small **×** appears on hover and on focus (`aria-label`/tooltip "Hide this link"). Press Enter on the ×. Expected: the link disappears immediately, a brief `role="status"` confirmation reads "Hidden. You can bring it back in Settings, Appearance." then fades; focus is not stolen. Reload the window. Expected: the link stays hidden (persisted via `mikedown.support.showSidebarLink`).
7. Gear button, **Appearance** tab. Expected: **"Show Support MikeDown link in sidebar"** checkbox is unchecked (matches step 6). Check it and save. Expected: the footer link reappears immediately, no reload needed. Uncheck and save. Expected: it disappears immediately. While hidden, the About tab's Support button and the **"MikeDown: Support MikeDown"** command still open the card.
8. Gear button, **About** tab. Expected: a "Support MikeDown" section below the existing GitHub/Changelog/Report-an-issue links, with the lead-in "MikeDown is made by one person. A review or a word to a friend goes a long way." and a **"♥ Support MikeDown"** button; clicking it closes Settings and opens the card.
9. Switch VS Code themes (Light Modern, Dark Modern, a High Contrast theme). Expected: the card and both entry points are readable and native looking in all three; in high contrast, borders replace the shadow and buttons/avatar pick up contrast borders.
10. Command palette, **"MikeDown (Dev): Reset Support Prompt State"**, choose **"Make eligible now"**. Then edit a document for a bit and save (Cmd+S). Expected: the card appears about 1.5 seconds after save, focus stays in the editor, typing continues.
11. Click **"Maybe later"**; edit and save again. Expected: no card (at most one auto show per VS Code session).
12. Reset again ("Make eligible now"), trigger the card, click **"Don't ask again"**. Reload the window, reset nothing, edit and save. Expected: no auto card; manual entry points (command, sidebar link, About button) still work.
13. Reset again ("Make eligible now"), trigger the card, click **"Leave a review"**. Then reset only the session (reload window, no dev reset), edit and save across several sessions. Expected: no auto card ever again; manual entry points still work.
14. Close all MikeDown editors, run **"MikeDown: Support MikeDown"**. Expected: the single fallback notice appears ("Open a markdown file in MikeDown to see how you can support the project.") with the same five buttons (Leave a review / Tell a colleague / Open an issue / Maybe later / Don't ask again) — the only native notice; no toast ever appears at startup.
15. Open a git diff of a markdown file. Expected: no card appears in the diff view (diff-view detection redirects to the source-text diff, which never gets a `SupportPrompt` wired to it).

Baseline for the Progress Log: `npx vsce show interapp.mikedown-editor` on 2026-09-26 — 391 installs, 5.00 average rating, 5 reviews, 982 downloads, current published version 2.10.4.
