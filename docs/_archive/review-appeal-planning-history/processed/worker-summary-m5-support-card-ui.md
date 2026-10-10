# Worker Summary: M5 "A Note from Mike" Card UI

**Status:** Completed

- Worktree: `/Users/michaeljosephwork/git/mikedown/.claude/worktrees/agent-a9396a7d3882a3924`
- Branch: `worktree-agent-a9396a7d3882a3924`
- Commit: `516496a` (base `0f66859`, worktree was reset to it from a stale `e4d26d0`)
- Start: 2026-09-26 01:10 EDT. End: 2026-09-26 01:25 EDT.
- Note: the worktree sandbox blocked writing this file to the main repo path, so it lives in the worktree (uncommitted) at `.orchestrator/review-appeal-planning/worker-summary-m5-support-card-ui.md`.

## Work completed

- `src/webview/supportCard.ts`: exports `showSupportCard(opts)`, `hideSupportCard()`, `isSupportCardOpen()`, plus `showSupportCopied()`. Card is a `<section>` appended to `document.body`; nothing touches `editor.view.dom`. Styles are injected once as a `<style>` element (CSP already allows `'unsafe-inline'` styles), so `markdownEditorProvider.ts` was not touched.
- Placement: fixed bottom right, 16px from edges, 380px wide, `z-index: 1040` (under the Settings modal's 1050). Below 480px wide it spans the pane with 12px gutters. Letter scrolls internally if the pane is short.
- Hierarchy: 28px circular `.support-card-avatar` slot rendered from `copy.avatar` (`initial` now; `image` with `src` already supported, `object-fit: cover`); semibold 13.5px title; 13px body at 1.5 line height, paragraphs split on blank lines, final short line ("Mike") styled as an italic muted sign off; primary + two secondary buttons in one row; "Maybe later" · "Don't ask again" as quiet links; × close (posts `close`). Theme tokens as specified, 8px radius.
- Motion: 150ms fade + 8px rise on open, 120ms fade on close; disabled under `prefers-reduced-motion`.
- Focus: `auto` never moves focus; `manual` focuses "Leave a review". Esc listener lives on the card, so it only fires when focus is inside. When the card closes with focus inside it, focus returns to the editor (not in source mode).
- A11y: `role="dialog"`, `aria-modal="false"`, `aria-labelledby` the title; all real `<button>`s; `:focus-visible` outline in `--vscode-focusBorder`.
- Actions: every button posts `{ type: 'supportAction', action }`. Share keeps the card open; all others close it. `supportCopied` swaps the share button to a check glyph + `copy.copiedConfirmation` for 2s.
- `editor-main.ts`: handles `showSupportCard` (auto + Settings overlay or open card → `busy`; otherwise render + `supportCardShown`; manual replaces an open card) and `supportCopied`. Protocol comment updated to match.
- `data-testid="support-card"` on the root and `data-action` on every button, for M7.

## Files modified

- `src/webview/supportCard.ts` (new)
- `src/webview/editor-main.ts` (import, two message handlers, protocol comment)

## Test status

- `npm run compile`: green.
- `npm run test:unit`: 38 files, 522 tests pass.
- Lint: both files hit the same pre-existing parse error every `src/webview/*.ts` file gets (root `tsconfig.json` excludes `src/webview`, so typed lint can't parse them). No other errors. `tsc -p tsconfig.webview.json` reports no errors in the new/changed code (25 pre-existing elsewhere).

## Theme check (what was and wasn't checked)

- Checked: rendered the real module in headless Chrome with approximated Dark Modern, Light Modern, and High Contrast Dark token sets, plus a 420px narrow pane with the Copied state. All read well; HC gets contrast borders on card, buttons, and avatar, no shadow.
- Fixed from that pass: button row now spans full card width (was wrapping to two rows); HC avatar got a border (HC button background is black, so the "M" circle vanished).
- Added overrides for MikeDown's own force light / force dark editor theme, since `theme.css` does not remap button or widget shadow tokens.
- Not checked: the real Extension Development Host, High Contrast Light, and real token values (mine were hand approximated).

## Issues / notes for orchestrator

- The × button's accessible name "Close" is hardcoded: the approved copy has no close label. It's generic UI chrome, not appeal copy. If Mike wants it in the payload, add `closeLabel` to `CARD_COPY`.
- A `manual` show while Settings is open renders behind the modal (spec only requires `busy` for auto). M6's About button closes Settings first, so this shouldn't come up.
- The webview keeps its own `SupportCardCopy` type, a superset whose avatar also allows `image`. `src/supportCopy.ts` is untouched.

## Review Materials

- Code: `/Users/michaeljosephwork/git/mikedown/.claude/worktrees/agent-a9396a7d3882a3924/src/webview/supportCard.ts`
- Screenshots: `/private/tmp/claude-503/-Users-michaeljosephwork-git-mikedown/1ae199cf-9fd7-4665-8c40-5699ba056598/scratchpad/card/{dark,light,hc,narrow-copied}.png` (harness: `entry.ts`, `shoot.sh` in the same folder)
