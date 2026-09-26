# 2.11.0 hands-on sign-off — what's left to check by hand

Everything below is what automated tests genuinely cannot prove: visual/theme
quality, native OS pickers, VS Code notification toasts, the external
browser, the git diff view, and focus/feel subtleties jsdom can't reproduce.
Everything else in the two original checklists is now covered by the test
suite (see the mapping table at the end).

**Launch:** open the repo in VS Code, run `npm run compile`, press F5
(Extension Development Host). After later code changes, `npm run compile`
then Cmd+R in the dev host.

## Slash commands

Create `scratch-slash.md` in the dev host workspace and open it with MikeDown.

- **Step 1** — Type `/`. Confirm the menu is readable in the current theme
  (grouping, first-row focus, and open-under-cursor positioning are now
  automated).
- **Step 9** — BUG found during automation, needs your call: on `hello world`
  with the cursor after `hello `, typing `/quote` + Enter currently leaves
  `hello world` untouched and appends an *empty* quote below, instead of the
  checklist's expected `hello` paragraph + quote containing `world`. Decide
  whether the checklist's expectation or the current behavior is correct
  (see the `.todo` note in `test/unit/slashcommandsHandsOn.test.ts`).
- **Step 10** — `/note`, `/tip`, `/important`, `/warn`, `/danger`. Confirm each
  callout's visual style is correct (the kind + GFM tag are automated).
- **Step 11/13** — Confirm the language/table grid pickers render and are
  positioned sensibly near the cursor (their selection behavior is automated).
- **Step 12** — `/mermaid`. Confirm the starter diagram actually renders as a
  diagram, if diagram rendering is enabled (the block/content is automated).
- **Step 18** — Confirm the footer "Turn off slash commands" row is visually
  quieter than the commands and separated by a divider (that it's never
  reachable via a matched Enter, and that ArrowDown reaches it, are automated).
- **Step 19/20** — Confirm the native VS Code notification itself reads
  "Slash commands are turned off. You can turn them back on in MikeDown
  Settings → Behavior." with **Open Settings** / **Undo** buttons and looks
  right (the message text, button wiring, and resulting state changes are
  automated via the extension's test seam).
- **Step 21** — Toggle the toolbar theme button (light/dark). Confirm menu
  colors, the focus row, the footer row, and borders are all correct in both.
- **Step 23** — BUG found during automation, needs your call: after
  `/properties`, the sidebar does open with Properties expanded, but focus
  lands back in the editor instead of on "+ Add property" (`runMatch` in
  `slashcommands.ts` unconditionally calls `view.focus()` after every
  command, including this one). Decide whether that's acceptable or should be
  fixed.
- **Steps 0, 2–8, 14–17, 22, 24–28** — fully automated (see the mapping table).

## Review appeal card

Open any `.md` file in MikeDown; also try the "MikeDown: Support MikeDown"
command and the sidebar entry point.

- **Step 6** — Hover the sidebar link, then Tab to it. Confirm the × actually
  appears on hover/focus and that it looks right (the dismiss action itself —
  immediate removal, the fading confirmation message, and persistence across
  reloads/broadcasts — is automated).
- **Step 9** — Switch VS Code themes (Light Modern, Dark Modern, a High
  Contrast theme). Confirm the card and both entry points are readable and
  native-looking in all three, and that high contrast swaps the shadow for
  real borders.
- **Step 4** — Click "Leave a review". Confirm the default OS browser actually
  opens to the Marketplace review section (the URL and the card-closing
  behavior are automated).
- **Step 14** — Confirm the native notification toast itself displays
  correctly with all five buttons when no MikeDown editor is open (the text,
  button set, and each button's resulting side effect are automated).
- **Step 15** — Open a git diff of a markdown file. Confirm no card ever
  appears in the diff view. This can't be driven from the test harness (it
  needs a real Source Control diff editor), so it stays a manual check.
- **Steps 1, 2, 3, 5, 7, 8, 10, 11, 12, 13** — fully automated (see the
  mapping table).

## Step → test mapping

### Slash commands (`.orchestrator/slash-commands-planning/hands-on-checklist.md`)

| Step | Covered by |
| --- | --- |
| 0 | `test/unit/slashCommandsSettings.test.ts` |
| 1 (open/group/focus) | `test/unit/slashcommandsHandsOn.test.ts`, `test/unit/slashcommandsHarness.test.ts` |
| 1 (theme readability) | manual |
| 2 | `test/unit/slashcommandsHandsOn.test.ts` |
| 3 | `test/unit/slashcommandsRegistry.test.ts`, `test/unit/slashcommandsHandsOn.test.ts` |
| 4 | `test/unit/slashcommandsHarness.test.ts` |
| 5 | `test/unit/slashcommandsHarness.test.ts` |
| 6 | `test/unit/slashcommandsHarness.test.ts` |
| 7 | `test/unit/slashcommandsHarness.test.ts` |
| 8 | `test/unit/slashcommandsHarness.test.ts` |
| 9 | bug — see `test/unit/slashcommandsHandsOn.test.ts` (`.todo`); manual sign-off needed |
| 10 (kind + markdown) | `test/unit/slashcommandsRoundtrip.test.ts`, `test/unit/slashcommandsActions.test.ts` |
| 10 (visual style) | manual |
| 11 | `test/unit/slashcommandsActions.test.ts` |
| 12 (content) | `test/unit/slashcommandsActions.test.ts` |
| 12 (rendered diagram) | manual |
| 13 (insertion) | `test/unit/slashcommandsActions.test.ts`, `test/unit/slashcommandsRoundtrip.test.ts` |
| 13 (picker position) | manual |
| 14 | `test/unit/slashcommandsActions.test.ts` |
| 15 | `test/unit/slashcommandsActions.test.ts`, `test/integration/slashCommands.test.ts` |
| 16 | `test/unit/slashcommandsHarness.test.ts`, `test/unit/slashcommandsHandsOn.test.ts` |
| 17 | `test/unit/slashcommandsUndoToggle.test.ts`, `test/unit/slashCommandsSettings.test.ts` |
| 18 (logic) | `test/unit/slashcommandsHarness.test.ts` |
| 18 (visual) | manual |
| 19/20 (logic) | `test/unit/slashcommandsHarness.test.ts`, `test/integration/slashCommands.test.ts`, `test/unit/slashCommandsSettings.test.ts` |
| 19/20 (native toast) | manual |
| 21 | manual |
| 22 | `test/unit/slashcommandsHarness.test.ts`, `test/unit/slashcommandsRoundtrip.test.ts` |
| 23 (sidebar shown/expanded) | `test/unit/slashcommandsHandsOn.test.ts` |
| 23 (focus) | bug — see `test/unit/slashcommandsHandsOn.test.ts` (`.todo`); manual sign-off needed |
| 24 | `test/unit/slashcommandsActions.test.ts` |
| 25 | `test/unit/slashcommandsDate.test.ts`, `test/unit/slashcommandsActions.test.ts` |
| 26 | `test/unit/slashCommandsSettings.test.ts` |
| 27 | `test/integration/slashCommands.test.ts` |
| 28 | `test/unit/slashcommandsRoundtrip.test.ts` |

### Review appeal card (`.orchestrator/review-appeal-planning/processed/worker-summary-m9-hands-on.md`, "Review Materials")

| Step | Covered by |
| --- | --- |
| 1 | `test/unit/supportPromptHandsOn.test.ts` |
| 2 | `test/unit/supportCardHandsOn.test.ts` |
| 3 | `test/unit/supportCard.test.ts`, `test/unit/supportCardHandsOn.test.ts`, `test/unit/supportPrompt.test.ts` |
| 4 (URL + close) | `test/unit/supportPrompt.test.ts`, `test/unit/supportCardHandsOn.test.ts` |
| 4 (browser opens) | manual |
| 5 | `test/unit/supportCard.test.ts`, `test/unit/supportCardHandsOn.test.ts` |
| 6 (logic/persistence) | `test/unit/supportCard.test.ts` |
| 6 (hover/focus visuals) | manual |
| 7 | `test/unit/supportCard.test.ts` |
| 8 | `test/unit/supportCard.test.ts`, `test/unit/supportCardHandsOn.test.ts` |
| 9 | manual |
| 10 | `test/unit/supportPrompt.test.ts`, `test/unit/supportCard.test.ts` |
| 11 | `test/unit/supportPrompt.test.ts` |
| 12 | `test/unit/supportPromptEligibility.test.ts`, `test/unit/supportPromptHandsOn.test.ts` |
| 13 | `test/unit/supportPromptEligibility.test.ts`, `test/unit/supportPromptHandsOn.test.ts` |
| 14 (toast text/buttons/effects) | `test/unit/supportPromptHandsOn.test.ts`, `test/integration/supportCommand.test.ts` |
| 14 (native rendering) | manual |
| 15 | manual (git diff view) |
