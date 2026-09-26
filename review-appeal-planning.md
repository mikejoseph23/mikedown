# Review Appeal Planning

## Summary

**Purpose.** MikeDown (`interapp.mikedown-editor`) has roughly 400 installs and only 5 Marketplace reviews (all 5 star). The current ask in `src/nagPrompt.ts` is a single native info toast with 4 buttons, fired 60 seconds after activation once the install is at least 7 days old and 3 documents have been opened. It fails because it appears at the wrong moment (startup, before any value is delivered), its text truncates and disappears into the notification center, it reads like a system message instead of a person, and there is no persistent place to find the ask again.

**Objectives.**

- Replace the toast with a warm, dismissible **"A note from Mike"** card rendered inside the editor webview, written in Mike's personal voice.
- Show it at a good moment (after a save that follows a meaningful editing session), gated by a pure, unit-tested eligibility module with an injected clock.
- Add low-key, always-available **"♥ Support MikeDown"** entry points: a link inline after the sidebar footer metrics (dismissible forever via a small ×, and toggled by the new setting `mikedown.support.showSidebarLink`), Settings modal About tab, and a `MikeDown: Support MikeDown` command.
- Remove the startup toast entirely; the only remaining native notice is the `mikedown.support` fallback when no MikeDown editor is open.
- Update the README (which is the Marketplace listing) and CHANGELOG with the same appeal. Ship as **2.11.0** (may share the release with the slash commands feature).
- Measure before and after with `npx vsce show interapp.mikedown-editor`.

**Success factors.**

- Review count rises materially within 60 days of release (baseline: 5 reviews, about 400 installs, recorded 2026-09-26).
- No user complaints about nagging; the card never blocks typing and never appears at startup.
- Copy approved by Mike before any UI uses it; the appeal copy contains no hyphens or em/en dashes.
- All unit and integration tests green; one hands-on pass in the Extension Development Host signed off by Mike.

### Milestone Progress Tracker

| Milestone | Model | Status | Duration (min) | Notes |
| --- | --- | --- | --- | --- |
| M1: Copy Draft (Review Gate) | Opus | ✅ | | Pauses for Mike's approval; neutral share line (Q7) |
| M2: Eligibility Module | Sonnet | ✅ | 6 | Pure module, injected clock; Q1 thresholds |
| M3: Host Wiring, Command, Dev Reset | Sonnet | ✅ | 12 | Needs M2; toast removed (Q2) |
| M4: Testing: Host Logic | Sonnet | ✅ | 12 | Needs M2, M3 |
| M5: "A Note from Mike" Card UI | Opus | ✅ | 15 | Needs M1 approved, M3 protocol; swappable avatar slot (Q6) |
| M6: Persistent Entry Points | Opus | ✅ | 8 | Needs M5; inline sidebar link, × dismiss, new setting (Q5) |
| M7: Testing: Webview Card and Entry Points | Sonnet | ✅ | 20 | Needs M5, M6 |
| M8: README and CHANGELOG | Haiku | ✅ | 1 | Needs M1 approved; 2.11.0 (Q8) |
| M9: Hands-on Pass and Measurement Follow-up | Sonnet | ✅ | 4 | Signed off 2026-09-26 |

## Table of Contents

- [Summary](#summary)
- [Background and Current State](#background-and-current-state)
- [Design Decisions](#design-decisions)
- [Milestones](#milestones)
  - [M1: Copy Draft (Review Gate)](#m1-copy-draft-review-gate)
  - [M2: Eligibility Module](#m2-eligibility-module)
  - [M3: Host Wiring, Command, Dev Reset](#m3-host-wiring-command-dev-reset)
  - [M4: Testing: Host Logic](#m4-testing-host-logic)
  - [M5: "A Note from Mike" Card UI](#m5-a-note-from-mike-card-ui)
  - [M6: Persistent Entry Points](#m6-persistent-entry-points)
  - [M7: Testing: Webview Card and Entry Points](#m7-testing-webview-card-and-entry-points)
  - [M8: README and CHANGELOG](#m8-readme-and-changelog)
  - [M9: Hands-on Pass and Measurement Follow-up](#m9-hands-on-pass-and-measurement-follow-up)
- [Follow-ups (Not in This Release)](#follow-ups-not-in-this-release)
- [Open Questions](#open-questions)
- [Progress Log / Notes](#progress-log--notes)
- [Parallel Development Recommendations](#parallel-development-recommendations)
- [Gap-filling Prompt Guidance](#gap-filling-prompt-guidance)

[Return to Top](#review-appeal-planning)

## Background and Current State

What exists today (read before starting any milestone):

- `src/nagPrompt.ts`: class `NagPrompt` with `recordActivation()`, `recordDocOpen()`, `maybeShow()`. State lives in `context.globalState` under `mikedown.nag.*` keys: `installDate`, `sessions`, `docOpens`, `lastPrompt`, `remindCount`, `dismissed`, `lastCtaAt`. Backoff ladder 14 → 30 → 60 → 90 days on dismiss; 30 days after any CTA; "Stop asking" is sticky. `isEligible()` calls `Date.now()` directly (not testable). **No unit tests exist for it.**
- `src/extension.ts` (around lines 315 to 330): constructs `NagPrompt`, calls `recordActivation()`, sets `MarkdownEditorProvider.onDocOpen = () => nag.recordDocOpen()`, and `setTimeout(() => nag.maybeShow(), 60_000)`.
- `src/markdownEditorProvider.ts`: `onDocOpen` static hook fires in `resolveCustomTextEditor` (around line 158). A per-panel `onDidSaveTextDocument` handler (around line 310) already posts `saved` to the webview; that is the natural place to hook the "after save" trigger. `case 'edit'` (around line 405) is where edit volume can be counted.
- `src/webview/outlineSidebar.ts`: `renderFooter()` (around line 1204) rebuilds two `.sidebar-footer-row` rows (modified time; words/chars/read time) with `replaceChildren()` on every refresh, including a 60 second tick.
- `src/webview/editor-main.ts`: `buildAboutPanel()` (around line 695) is the Settings modal About tab (name, tagline, version, license, 3 outbound links via `openLink` postMessage). `showSettingsModal()` (around line 745) builds the overlay `#mikedown-settings-overlay` at `z-index:1050`.
- `README.md` **already has an "Enjoying MikeDown?" section** (line 23) with a one-sentence appeal containing an em dash. M8 replaces it rather than adding a second section.
- `CHANGELOG.md` has no `Unreleased` section; the top entry is `[2.10.4] - 2026-08-31`. Current version `2.10.4`.
- `package.json#contributes.menus.commandPalette` gates editor-only commands with `"when": "activeCustomEditorId == 'mikedown.editor'"`.
- Test harness: `test/harness/webviewHarness.ts` (commit `f308a6d`) boots the real webview in jsdom and records every `postMessage` (`posted`, `ofType`, `last`, `send`). Pure host modules are tested with a mocked `vscode` module (pattern: `test/unit/defaultEditorPrompt.test.ts`).

[Return to Top](#review-appeal-planning)

## Design Decisions

1. **Card, not toast.** Primary ask is a "A note from Mike" card rendered in the webview as an overlay outside the ProseMirror DOM (a sibling of the editor container, `position: fixed`), so it never touches `editor.view.dom` and never steals focus from typing.
2. **Host decides, webview renders.** All eligibility, state, clipboard writes, and URL opening live on the host. The webview only renders the card on `{ type: 'showSupportCard', reason: 'auto' | 'manual', copy }` and reports `{ type: 'supportAction', action }`.
3. **Trigger after value.** Auto show happens only after a save that follows a meaningful editing session, never at activation. The 60 second startup `setTimeout` is removed.
4. **Keep existing state keys.** Reuse the `mikedown.nag.*` keys so current users keep their install date, ladder position, and "Stop asking" choice. New keys use the same prefix.
5. **Clipboard on the host.** "Tell a friend" uses `vscode.env.clipboard.writeText` (reliable in webviews, unlike `navigator.clipboard` which needs focus), then the host acks with `{ type: 'supportCopied' }` so the card can show "Copied".
6. **Manual entry points bypass eligibility** but still record actions (a review click from a manual open counts the same as from an auto open).
7. **Startup toast removed** (Q2 resolved): when eligible at save time but no MikeDown panel is visible (for example the save came from a plain text editor), do nothing and wait for the next qualifying MikeDown save. The only native notice left is a single fallback `showInformationMessage` for `mikedown.support` when no MikeDown editor is open.
8. **One new setting: `mikedown.support.showSidebarLink`** (boolean, default `true`), following the three-place rule in `CLAUDE.md`: `package.json#contributes.configuration`, `src/settings.ts`, and a checkbox in the Settings modal **Appearance** tab (where the other sidebar settings live). It controls only the sidebar footer link; the About tab Support entry and the `mikedown.support` command are unaffected. The link's × writes `false` through the existing `saveSettings` path, and the settings broadcast hides or shows the link live without reload. No other new settings.
9. **Dev-only reset path.** Command `mikedown.dev.resetSupportPrompt` ("MikeDown (Dev): Reset Support Prompt State"), registered only when `context.extensionMode !== vscode.ExtensionMode.Production`. It sets context key `mikedown.isDevelopment` via `setContext`, and the command is gated in `commandPalette` with `"when": "mikedown.isDevelopment"` so it never appears for Marketplace users. It offers a quick pick: "Clear all support prompt state" and "Make eligible now (backdate install, satisfy engagement)".
10. **Swappable avatar slot** (Q6): the card's avatar is a single slot element (`.support-card-avatar`) rendered from the payload (`avatar: { kind: 'initial', text: 'M' }`), so a photo (`kind: 'image'`) can replace the "M" circle later without redesign. Photo swap is a follow-up, not this release.
11. **Release vehicle** (Q8): ship as 2.11.0; may share the release with the slash commands feature.

[Return to Top](#review-appeal-planning)

## Milestones

### M1: Copy Draft (Review Gate)

**Recommended model: Opus** (voice and tone work).

> Workers must complete ALL items in this milestone. If you believe an item should be deferred, note that in your summary, but still attempt it.

Draft every piece of user-facing text into **`/Users/michaeljosephwork/git/mikedown/review-appeal-copy.md`** (repo root, per Mike's working-file convention). The orchestrator **PAUSES** after this milestone until Mike approves or edits the file. M5, M6, and M8 must not start until the progress log records approval.

The copy must carry all five of Mike's points in his personal, first-person voice:

- (a) He is a solo developer.
- (b) MikeDown is lost in a sea of mostly half-baked markdown editors, few of them truly WYSIWYG; it is a small miracle people find it at all.
- (c) Positive reviews help it slowly rise in the Marketplace rankings and are the best way to keep the project alive and improving.
- (d) He is responsive and genuinely listening for feedback and feature ideas (GitHub issues).
- (e) Besides a review, the next best (maybe the best) support is telling a friend or colleague who uses VS Code.

Copy rules: **no hyphens, em dashes, or en dashes** anywhere in the appeal prose (use commas, periods, parentheses). Warm, brief, not guilt-trippy. No "please please". No fake urgency.

- [x] Card title (short, e.g. in the spirit of "A note from Mike").
- [x] Card body: 3 to 5 short sentences covering points a through e; target under 90 words so it fits without scrolling at 360px width.
- [x] Button labels: primary "Leave a review", secondary "Tell a friend", tertiary "Share feedback", plus quiet "Maybe later" and "Don't ask again" (propose alternates if better; keep each under 18 characters).
- [x] "Copied" confirmation text for Tell a friend (e.g. "Copied. Paste it anywhere.").
- [x] Share message copied to the clipboard (Q7 resolved: **neutral line**, not the sharer's personal voice and not Mike's): one sentence plus the Marketplace link, e.g. "Check out MikeDown, a WYSIWYG markdown editor for VS Code: https://marketplace.visualstudio.com/items?itemName=interapp.mikedown-editor". Offer at most one alternate phrasing.
- [x] Entry point labels: sidebar footer link text (e.g. "♥ Support MikeDown", short enough to sit inline after the metrics), the × dismiss button's `aria-label`/tooltip (e.g. "Hide this link"), the brief post dismiss confirmation (e.g. "Hidden. You can bring it back in Settings, Appearance."), the Settings Appearance checkbox label for `mikedown.support.showSidebarLink` (e.g. "Show Support MikeDown link in sidebar"), About tab section heading and one line lead in, command title `MikeDown: Support MikeDown`.
- [x] README section "A note from the developer": same appeal, slightly longer (up to 150 words), with links for review, GitHub issues, and share.
- [x] Fallback notice text for `mikedown.support` when no MikeDown editor is open (single sentence, under 110 characters so it does not truncate). The startup toast is removed (Q2), so this is the only native notice.
- [x] Self check: run `grep -nP '[-\x{2013}\x{2014}]' review-appeal-copy.md` restricted to prose sections and confirm no hyphen or dash appears in any appeal copy (URLs are exempt). Note the result in the summary.
- [x] Add a short "Rationale" note per piece (one line each) so Mike can see intent.
- [x] Commit the copy file ("Add review appeal copy draft"), write `.orchestrator/worker-summary-m1-copy-draft.md`, and stop. Tell the user the copy is ready for review.

[Return to Top](#review-appeal-planning)

### M2: Eligibility Module

**Recommended model: Sonnet.**

> Workers must complete ALL items in this milestone. If you believe an item should be deferred, note that in your summary, but still attempt it.

Extract eligibility into a pure, unit-testable module with no `vscode` import.

- [x] Create `src/supportPromptEligibility.ts` exporting a `SupportPromptState` interface (all persisted fields), a `StateStore` interface (`get`/`update`, satisfied by `globalState`), and pure functions taking `now: number` explicitly (injected clock): `isAutoEligible(state, session, now)`, `nextDelayMs(remindCount, hadCtaSinceLastPrompt)`, and `applyAction(state, action, now): SupportPromptState`.
- [x] Keep existing keys (`mikedown.nag.installDate`, `sessions`, `docOpens`, `lastPrompt`, `remindCount`, `dismissed`, `lastCtaAt`) for backward compatibility. Add `mikedown.nag.activeDays` (count of distinct local dates with an editing session), `mikedown.nag.lastActiveDay` (YYYY-MM-DD), and `mikedown.nag.reviewedAt`.
- [x] Implement the Q1 thresholds (resolved 2026-09-26; make them named constants in one exported `THRESHOLDS` object): install age ≥ 7 days; `docOpens` ≥ 5; `activeDays` ≥ 3; the current session (per panel) had ≥ 20 `edit` messages from the webview **and** ≥ 3 minutes between first edit and the save; at most one auto show per VS Code session; card posted 1.5 s after the save.
- [x] Ladder: keep 14 → 30 → 60 → 90 (cap) for "Maybe later" and for closing the card without choosing. "Tell a friend" and "Share feedback" reset the ladder and set a 60 day gap. "Leave a review" sets `reviewedAt` and **never auto shows again** (Q3 resolved; entry points remain). "Don't ask again" sets `dismissed` (sticky, auto only; manual entry points still work). Existing users with legacy `mikedown.nag.dismissed` are respected with no one time exception (Q4 resolved).
- [x] Session tracking helper (pure): `SessionTracker` with `recordEdit(now)`, `isMeaningful(now)`, `reset()`, so the provider can keep one per panel.
- [x] Do not delete `src/nagPrompt.ts` yet; M3 rewires and retires it.
- [x] Run `npm run lint` and `npx tsc -p tsconfig.json --noEmit` green.
- [x] Commit, write `.orchestrator/worker-summary-m2-eligibility-module.md`.

[Return to Top](#review-appeal-planning)

### M3: Host Wiring, Command, Dev Reset

**Recommended model: Sonnet.**

> Workers must complete ALL items in this milestone. If you believe an item should be deferred, note that in your summary, but still attempt it.

- [x] Create `src/supportPrompt.ts` (host side, imports `vscode`): wraps `globalState` with the M2 pure functions, owns URLs (`review`, `share`, `issue` from `nagPrompt.ts`), handles `supportAction` messages (`review`, `share`, `feedback`, `later`, `never`, `close`), opens URLs via `vscode.env.openExternal`, writes the share message via `vscode.env.clipboard.writeText` and posts `{ type: 'supportCopied' }` back.
- [x] Copy strings live in one host module (`src/supportCopy.ts`) sent to the webview inside `showSupportCard` so copy has a single source. Use placeholder strings from M1 draft until approval lands; replace with approved copy once the progress log records approval.
- [x] In `src/markdownEditorProvider.ts`: keep a `SessionTracker` per panel; call `recordEdit` in `case 'edit'`; in the existing per panel `onDidSaveTextDocument` handler, after the current work, ask `supportPrompt.onSaveAfterSession(panel)`; if eligible and the panel is visible, post `showSupportCard` with `reason: 'auto'` after a 1500 ms delay (so it does not collide with the save flush). Update `lastActiveDay` / `activeDays` on first edit of each day.
- [x] Do not show auto card in a diff view panel, for non `file:` URIs, or when another MikeDown card or the Settings modal is already open (webview reports `busy` back if so; host treats that as "not shown" and does not write `lastPrompt`).
- [x] Record `lastPrompt` only when the webview acks `{ type: 'supportCardShown' }`.
- [x] Register `mikedown.support` ("MikeDown: Support MikeDown") in `src/extension.ts` and `package.json#contributes.commands`. Always available in the palette (no `when` gating) so it works from anywhere: if an active MikeDown panel exists, post `showSupportCard` with `reason: 'manual'`; otherwise open the most recent visible MikeDown panel, or fall back to a single `showInformationMessage` (approved fallback notice text) with the same buttons. This is the only native notice left (Q2 resolved).
- [x] Dev reset: register `mikedown.dev.resetSupportPrompt` ("MikeDown (Dev): Reset Support Prompt State") only when `context.extensionMode !== vscode.ExtensionMode.Production`; call `setContext('mikedown.isDevelopment', true)`; add the command to `contributes.commands` and gate it in `commandPalette` with `"when": "mikedown.isDevelopment"`. Quick pick: "Clear all support prompt state" (delete every `mikedown.nag.*` key) and "Make eligible now" (backdate `installDate` 30 days, set `docOpens` 5, `activeDays` 3, clear `lastPrompt`/`dismissed`/`reviewedAt`, and set a flag so the next save treats the session as meaningful).
- [x] Remove the 60 second `setTimeout(() => nag.maybeShow(), 60_000)` from `extension.ts`; keep `recordActivation` and `onDocOpen` semantics via the new module; delete `src/nagPrompt.ts` once nothing imports it. The startup toast is removed entirely (Q2 resolved); the `mikedown.support` fallback notice lives in `supportPrompt.ts`.
- [x] Document the new messages (`showSupportCard`, `supportCopied`, `supportAction`, `supportCardShown`, `busy`) in the protocol comment at the top of `src/webview/editor-main.ts` (comment only; M5 implements the handlers).
- [x] `npm run compile` and `npm run lint` green.
- [x] Commit, write `.orchestrator/worker-summary-m3-host-wiring.md`.

[Return to Top](#review-appeal-planning)

### M4: Testing: Host Logic

**Recommended model: Sonnet.**

> Workers must complete ALL items in this milestone. If you believe an item should be deferred, note that in your summary, but still attempt it.

Modes: **unit** (`npm run test:unit`, vitest with mocked `vscode`) and **integration** (`npm run test:integration`, real VS Code).

- [x] Write tests: `test/unit/supportPromptEligibility.test.ts` using a fixed injected clock. Cover: not eligible before 7 days; not eligible under 5 doc opens or 3 active days; not eligible when the session is under 20 edits or under 3 minutes; eligible when all met; ladder 14/30/60/90 and cap; CTA gap 60 days; review stops auto permanently; `dismissed` sticky (including legacy `mikedown.nag.dismissed` with no one time exception); one auto show per session; legacy state (only old `mikedown.nag.*` keys present) evaluates correctly.
- [x] Write tests: `test/unit/supportPrompt.test.ts` with mocked `vscode` (pattern from `test/unit/defaultEditorPrompt.test.ts`). Cover: each `supportAction` writes the right keys; `share` calls `env.clipboard.writeText` with exactly the approved neutral share line (starts "Check out MikeDown" or the approved variant, contains the Marketplace URL, no first person "I") and posts `supportCopied`; no toast or notice is shown on activation or after any timer; `review`/`feedback` call `openExternal` with the right URLs; `lastPrompt` written only after `supportCardShown`; `busy` does not write `lastPrompt`.
- [x] Write tests: `test/integration/supportCommand.test.ts`. Assert `mikedown.support` is registered and executes without throwing with and without an open MikeDown editor. Use a **private fixture** copied to a temp dir (never `test/workspace/sample.md`) for any test that opens and saves a file.
- [x] Run green: `npm run test:unit`.
- [x] Run green: `npm run test:integration`.
- [x] Human review locators: `src/supportPromptEligibility.ts` `THRESHOLDS` constant; `src/markdownEditorProvider.ts` `onDidSaveTextDocument` handler (search `onSaveAfterSession`); `src/extension.ts` search `mikedown.dev.resetSupportPrompt`.
- [x] Commit, write `.orchestrator/worker-summary-m4-testing-host-logic.md`.

[Return to Top](#review-appeal-planning)

### M5: "A Note from Mike" Card UI

**Recommended model: Opus** (UI design).

> Workers must complete ALL items in this milestone. If you believe an item should be deferred, note that in your summary, but still attempt it.

**Design craft is the point of this milestone.** Reference: VS Code's own native widgets (notifications center, editor hover, Settings editor) and Notion's quiet, typographic callouts. It should feel like a handwritten note tucked into a well made tool, not a banner ad or a system alert. Use only theme CSS variables so it looks right in light, dark, and high contrast themes.

- [x] Create `src/webview/supportCard.ts` exporting `showSupportCard(opts)`, `hideSupportCard()`, `isSupportCardOpen()`. Render into a container appended to `document.body` (a sibling of the editor, **never inside `editor.view.dom`**, no DOM writes to the ProseMirror tree).
- [x] Placement: bottom right floating card, max width 380px, 16px from edges, above the editor but below the Settings modal (`z-index` under 1050). On narrow panes (< 480px wide) it spans the width with 12px gutters.
- [x] Visual hierarchy: small circular avatar with the initial "M" using `--vscode-button-background` (Q6 resolved), built as a **swappable slot**: one `.support-card-avatar` element rendered from `copy.avatar` (`{ kind: 'initial', text: 'M' }` now; `kind: 'image'` with a `src` later) with fixed size and `object-fit: cover`, so a small photo of Mike can drop in without layout changes; title in semibold 13 to 14px; body in `--vscode-editor-foreground` at 13px with comfortable 1.5 line height; primary button (`--vscode-button-background` / `--vscode-button-foreground`), two secondary buttons (`--vscode-button-secondaryBackground`), and "Maybe later" / "Don't ask again" as quiet text links in `--vscode-descriptionForeground`. Close "×" in the corner (counts as `close`). Background `--vscode-editorWidget-background`, border `--vscode-editorWidget-border`, subtle shadow `--vscode-widget-shadow`, 8px radius.
- [x] Motion: gentle 150ms fade and 8px rise on open; respect `prefers-reduced-motion`.
- [x] Never block typing: do not move focus into the card on `reason: 'auto'`; on `reason: 'manual'` focus the primary button. `Esc` closes only when focus is inside the card. Typing in the editor continues to work while the card is open.
- [x] Accessibility: `role="dialog"` with `aria-labelledby`, but `aria-modal="false"`; buttons are real `<button>` elements; focus visible outline via `--vscode-focusBorder`.
- [x] Actions post `{ type: 'supportAction', action }`. On `supportCopied`, swap the Tell a friend label to the approved "Copied" text for 2 seconds with a check glyph. Review and feedback close the card after posting; share keeps it open to show the confirmation.
- [x] Handle host messages in `editor-main.ts`: `showSupportCard` (reply `busy` if the Settings modal `#mikedown-settings-overlay` or another card is open for `reason: 'auto'`; otherwise render and reply `supportCardShown`), `supportCopied`.
- [x] Use approved copy from the `showSupportCard` payload only (no hardcoded strings in the webview).
- [x] Check it in light (Light Modern), dark (Dark Modern), and a high contrast theme in the Extension Development Host; note any theme issues in the summary.
- [x] `npm run compile` and `npm run lint` green.
- [x] Commit, write `.orchestrator/worker-summary-m5-support-card-ui.md`.

[Return to Top](#review-appeal-planning)

### M6: Persistent Entry Points

**Recommended model: Opus** (UI design).

> Workers must complete ALL items in this milestone. If you believe an item should be deferred, note that in your summary, but still attempt it.

Low key, always there, never loud. They should read as a quiet signature, the way a well made indie app credits its maker.

- [x] Sidebar footer (`src/webview/outlineSidebar.ts`, `renderFooter()`): add a small "♥ Support MikeDown" link **inline after the metrics** in the existing words/chars/read time row (Q5 resolved; not its own row), separated by a middle dot, in `--vscode-descriptionForeground`, underline and `--vscode-textLink-foreground` on hover. Build it inside `renderFooter()` so the 60 second tick's `replaceChildren()` does not drop it; give it `data-testid="sidebar-support-link"`. Render it only when `mikedown.support.showSidebarLink` is `true`.
- [x] Dismiss forever: a small × button (`data-testid="sidebar-support-dismiss"`, real `<button>`, approved `aria-label`) next to the link, visible on hover of the link group and on keyboard focus (focusable via Tab, activates on Enter/Space, `--vscode-focusBorder` outline). Clicking posts `{ type: 'saveSettings', settings: { 'support.showSidebarLink': false } }` through the existing path (match the key shape the modal already uses), hides the link immediately, and shows a brief non blocking confirmation (approved text, e.g. "Hidden. You can bring it back in Settings, Appearance.") in the footer for about 4 seconds, `role="status"`, no focus steal.
- [x] New setting `mikedown.support.showSidebarLink` (boolean, default `true`) via the three-place rule: `package.json#contributes.configuration.properties` (with description), `src/settings.ts` reader, and a checkbox in the Settings modal **Appearance** tab next to the other sidebar settings (`data-testid="setting-support-sidebar-link"`). Include it in the `settings` broadcast; the webview hides or shows the footer link live on broadcast, no reload. This setting does not affect the About tab Support entry or the `mikedown.support` command. Clicking posts `{ type: 'supportAction', action: 'open' }` (host replies with `showSupportCard` `reason: 'manual'`) or calls `showSupportCard` directly via a callback set from `editor-main.ts` (choose one and document it).
- [x] Settings modal About tab (`buildAboutPanel()` in `src/webview/editor-main.ts`): add a "Support MikeDown" section below the links with the approved heading, one line lead in, and a button "♥ Support MikeDown" (`data-testid="about-support-button"`) that closes the Settings modal and opens the card. Match the existing About tab spacing and link styling.
- [x] Command palette: confirm `mikedown.support` (from M3) opens the card in the active MikeDown editor.
- [x] Handle `open` in the host `supportAction` handler (M3's module) if the message route is chosen.
- [x] Verify in light and dark themes; the inline link and × must not wrap awkwardly at the minimum sidebar width (if space runs out, the link may wrap to its own line as a whole, never mid label).
- [x] `npm run compile` and `npm run lint` green.
- [x] Commit, write `.orchestrator/worker-summary-m6-entry-points.md`.

[Return to Top](#review-appeal-planning)

### M7: Testing: Webview Card and Entry Points

**Recommended model: Sonnet.**

> Workers must complete ALL items in this milestone. If you believe an item should be deferred, note that in your summary, but still attempt it.

Mode: **unit** with the jsdom webview harness (`test/harness/webviewHarness.ts`).

- [x] Write tests: `test/unit/supportCard.test.ts` with the harness. `send({ type: 'showSupportCard', reason: 'auto', copy })` renders the card with title, body, and five actions; harness `last('supportCardShown')` is present.
- [x] Write tests: each button posts the right `supportAction` (`review`, `share`, `feedback`, `later`, `never`, `close`).
- [x] Write tests: `supportCopied` swaps the share label to the Copied text; it reverts (use fake timers).
- [x] Write tests: `reason: 'auto'` does not move focus away from the editor; typing into the editor while the card is open still produces an `edit` message with the typed text; the card's container is not a descendant of the ProseMirror root (`.ProseMirror`).
- [x] Write tests: with the Settings modal open, `showSupportCard` `reason: 'auto'` posts `busy` and renders nothing.
- [x] Write tests: sidebar footer contains `[data-testid="sidebar-support-link"]` inline in the metrics row after a footer re-render, and clicking it opens the card (or posts `open`).
- [x] Write tests: clicking `[data-testid="sidebar-support-dismiss"]` posts `saveSettings` with `support.showSidebarLink: false`, removes the link, shows the confirmation (`role="status"`) which disappears (fake timers), and the link stays gone after a footer re-render and after a `settings` broadcast carrying `false` (dismiss persists).
- [x] Write tests: live toggle. A `settings` broadcast with `showSidebarLink: false` hides the link; `true` shows it again, no reload.
- [x] Write tests: Settings checkbox round-trip. The Appearance tab `[data-testid="setting-support-sidebar-link"]` reflects the current value; unchecking and saving posts `saveSettings` with `false`; rechecking posts `true`. The About tab button and `mikedown.support` still work when the link is hidden.
- [x] Write tests (host, unit with mocked `vscode`): `src/settings.ts` reads `support.showSidebarLink` with default `true`; `package.json` declares `mikedown.support.showSidebarLink` as boolean default `true`.
- [x] Write tests: About tab contains `[data-testid="about-support-button"]`; clicking closes `#mikedown-settings-overlay` and opens the card.
- [x] Run green: `npm run test:unit`.
- [x] Run green: `npm run test:integration` (regression).
- [x] Human review locators: `src/webview/supportCard.ts`; `src/webview/outlineSidebar.ts` `renderFooter()` (search `sidebar-support-dismiss`); `src/settings.ts` search `showSidebarLink`; `src/webview/editor-main.ts` `buildAboutPanel()` (search `about-support-button`).
- [x] Commit, write `.orchestrator/worker-summary-m7-testing-webview.md`.

[Return to Top](#review-appeal-planning)

### M8: README and CHANGELOG

**Recommended model: Haiku** (mechanical, copy already approved).

> Workers must complete ALL items in this milestone. If you believe an item should be deferred, note that in your summary, but still attempt it.

- [x] Replace the existing `## Enjoying MikeDown?` section in `README.md` (around line 23) with `## A note from the developer` using the approved README copy from `review-appeal-copy.md` verbatim. Keep links: review `https://marketplace.visualstudio.com/items?itemName=interapp.mikedown-editor&ssr=false#review-details`, issues `https://github.com/mikejoseph23/mikedown/issues/new`.
- [x] Update the Table of Contents or any internal anchor that pointed at the old heading (search `enjoying-mikedown`).
- [x] Add `## [Unreleased]` (targeting **2.11.0**, Q8; may share the release with slash commands) above `## [2.10.4]` in `CHANGELOG.md` with a `### Changed` entry: the review prompt is now a note inside the editor shown after a real editing session, never at startup (startup toast removed); and an `### Added` entry for the Support MikeDown command, the sidebar link (dismissible, plus the `mikedown.support.showSidebarLink` setting), and About tab section.
- [x] Markdown rules: blank lines around lists; escape `$` as `\$` outside code.
- [x] Commit, write `.orchestrator/worker-summary-m8-readme-changelog.md`.

[Return to Top](#review-appeal-planning)

### M9: Hands-on Pass and Measurement Follow-up

**Recommended model: Sonnet** (prepares steps; Mike performs the pass). The orchestrator **PAUSES** here for Mike's sign-off.

> Workers must complete ALL items in this milestone. If you believe an item should be deferred, note that in your summary, but still attempt it.

- [x] Run `npm run compile`, `npm run test:unit`, `npm run test:integration` green before handing off.
- [x] Write the hands-on steps below into the worker summary and tell Mike they are ready.
- [x] Record the baseline now: run `npx vsce show interapp.mikedown-editor` and paste installs, rating, and review count into the Progress Log (expected: about 400 installs, 5 reviews).
- [x] Add the Follow-ups section items below to `BACKLOG.md`, plus a checklist: re-run `npx vsce show interapp.mikedown-editor` 30 days and 60 days after the release date and record results in this document's Progress Log.

**Hands-on steps (Extension Development Host).** Press F5 (after edits, `npm run compile` then Cmd+R in the host window).

1. Open any `.md` file in MikeDown. Expected: no card, no toast at startup, even after waiting 2 minutes.
2. Command palette, "MikeDown: Support MikeDown". Expected: card appears bottom right, focus on "Leave a review", typing is unaffected once you click back into the editor.
3. Click "Tell a friend". Expected: label shows the Copied text; paste into any text field shows the neutral line ("Check out MikeDown, a WYSIWYG markdown editor for VS Code: " plus the Marketplace link, or the approved variant).
4. Click "Leave a review". Expected: browser opens the Marketplace review section; card closes.
5. Open the sidebar. Expected: "♥ Support MikeDown" inline after the word/char/read time metrics, subtle, no extra row; clicking opens the card. Wait 60 seconds; link is still present.
6. Hover the link, then Tab to it with the keyboard. Expected: a small × appears on hover and on focus. Press Enter on the ×. Expected: link disappears, a brief confirmation says it can be restored in Settings, then fades; focus is not stolen. Reload the window. Expected: link stays hidden.
7. Gear button, Appearance tab. Expected: "Show Support MikeDown link in sidebar" checkbox is unchecked. Check it and save. Expected: link reappears in the footer immediately, no reload. Uncheck and save. Expected: link disappears immediately. While hidden, About tab Support button and "MikeDown: Support MikeDown" still open the card.
8. Gear button, About tab. Expected: Support section; the button closes Settings and opens the card.
9. Switch themes (Light Modern, Dark Modern, a High Contrast theme). Expected: card and links readable and native looking in all three.
10. Command palette, "MikeDown (Dev): Reset Support Prompt State", choose "Make eligible now". Then edit a document for a bit and save (Cmd+S). Expected: card appears about 1.5 seconds after save, focus stays in the editor, typing continues.
11. Click "Maybe later"; edit and save again. Expected: no card (one per session, ladder applies).
12. Reset again ("Make eligible now"), trigger the card, click "Don't ask again". Reload window, reset nothing, edit and save. Expected: no auto card; manual entry points still work.
13. Reset again ("Make eligible now"), trigger the card, click "Leave a review". Then reset only the session (reload window, no dev reset), edit and save across several sessions. Expected: no auto card ever again; manual entry points still work.
14. Close all MikeDown editors, run "MikeDown: Support MikeDown". Expected: the single fallback notice appears (the only native notice); no toast ever appears at startup.
15. Open a git diff of a markdown file. Expected: no card appears in the diff view.

- [x] Mike signs off (record in Progress Log). Commit, write `.orchestrator/worker-summary-m9-hands-on.md`.

[Return to Top](#review-appeal-planning)

## Follow-ups (Not in This Release)

- **Photo avatar.** Replace the "M" initial in the card's avatar slot with a small photo of Mike. Needs an image asset shipped in the bundle (webview `localResourceRoots`, `asWebviewUri`) and a CSP check that `img-src` allows `${webview.cspSource}`. No card redesign needed (the slot is built for it in M5).

[Return to Top](#review-appeal-planning)

## Open Questions

All resolved 2026-09-26.

- **Q1. Auto show thresholds.** ✅ Resolved 2026-09-26: recommended default accepted. Install age ≥ 7 days, ≥ 5 documents opened, ≥ 3 distinct active days, and the current session had ≥ 20 edit messages over ≥ 3 minutes before a save; at most one auto show per VS Code session; card shows 1.5 seconds after save.
- **Q2. Toast fallback: keep or remove?** ✅ Resolved 2026-09-26: **remove** the startup toast entirely. When eligible but no MikeDown panel is visible, wait for the next qualifying MikeDown save. Keep only the single fallback notice for `mikedown.support` when no MikeDown editor is open.
- **Q3. After "Leave a review", ever ask again?** ✅ Resolved 2026-09-26: never auto show again. Entry points remain.
- **Q4. Existing "Stop asking" users.** ✅ Resolved 2026-09-26: `mikedown.nag.dismissed` carries over and is respected; no one time exception.
- **Q5. Sidebar footer link placement.** ✅ Resolved 2026-09-26 (changed from recommendation): **inline after the metrics**, not its own row. Dismissible forever via a small × (hover and keyboard focus), with a brief confirmation that it can be restored in Settings. New setting `mikedown.support.showSidebarLink` (boolean, default `true`, three-place rule, Appearance tab checkbox, live toggle). Hiding it does not affect the About tab Support entry or the command.
- **Q6. Avatar.** ✅ Resolved 2026-09-26: "M" initial circle now, built as a swappable slot. Photo of Mike is a follow-up (bundle asset plus CSP check); see Follow-ups.
- **Q7. Share message voice.** ✅ Resolved 2026-09-26 (changed from recommendation): **neutral line**, e.g. "Check out MikeDown, a WYSIWYG markdown editor for VS Code: (Marketplace link)".
- **Q8. Release vehicle.** ✅ Resolved 2026-09-26: ship as **2.11.0** (may share the release with the slash commands feature).

[Return to Top](#review-appeal-planning)

## Progress Log / Notes

**2026-09-26 (afternoon)** - M9 hands-on signed off, no defects (scriptable steps automated in `7d64519`). Decisions: the About tab lead-in says "colleague" not "friend" (lands with the copy rework); a manual card open pushing back the next auto show is accepted. Mike is reworking the appeal copy (reads as AI-written) before 2.11.0 ships; session stays open until that lands.

**2026-09-26 01:58** - M9 prep done (commit `8be197a`). **Baseline** (`npx vsce show interapp.mikedown-editor`, 2026-09-26, published 2.10.4): 391 installs, 5.00 rating, 5 reviews, 982 downloads. `BACKLOG.md` gained the photo avatar follow-up and the 30/60 day re-check checklist. Main tree: compile, 601 unit, 28 integration green. Hands-on steps (updated to built labels) are in `.orchestrator/review-appeal-planning/processed/worker-summary-m9-hands-on.md`. **Paused for Mike's sign-off.**

**2026-09-26 01:50** - M7 done (commit `3c65be6`). 18 new tests: `test/unit/supportCard.test.ts` (15, jsdom harness) and `test/unit/supportSettings.test.ts` (3). No production code changes needed. Worker could not run integration in its worktree (socket path too long); run in main after merge: 601 unit and 28 integration green.

**2026-09-26 01:42** - M4 done (commit `d4dcdd3`). 51 new tests: `test/unit/supportPromptEligibility.test.ts`, `test/unit/supportPrompt.test.ts`, `test/integration/supportCommand.test.ts` (private temp fixture). No M2 or M3 bugs found. Worker ran 573 unit and 28 integration green; after merging onto M6, main runs 583 unit green.

**2026-09-26 01:38** - M6 done (commits `7ee9b3d`, `33d45e1`). Sidebar footer link inline after the metrics with hover and focus × dismiss and a `role="status"` confirmation; About tab Support section; new setting `mikedown.support.showSidebarLink` in all three places with live toggle. Route chosen: link and About button post `supportAction: 'open'`, host replies with a manual card. The modal key shape is `supportShowSidebarLink` (matches the existing modal keys), not `support.showSidebarLink`. Card close label now comes from `supportCopy.ts`. Sidebar screenshots (dark, light, minimum width) in `.orchestrator/review-appeal-planning/screenshots/`; About section compiled but not rendered. Compile and 522 unit tests green; no new lint errors.

**2026-09-26 01:27** - M5 done (commit `921f9a6`). New `src/webview/supportCard.ts` (fixed overlay outside the ProseMirror DOM, swappable avatar slot, fade and rise with reduced motion respected, no focus steal on auto); `editor-main.ts` handles `showSupportCard` (replies `busy` or `supportCardShown`) and `supportCopied`. Theme check done in headless Chrome with Dark Modern, Light Modern, and High Contrast Dark variable sets (screenshots in `.orchestrator/review-appeal-planning/screenshots/`); not yet checked in the real Extension Development Host (covered by M9 step 9). Fixes from that check: buttons fit one row; avatar gets a border in high contrast. The × close `aria-label` "Close" is the one hardcoded webview string (M6 moves it into `supportCopy.ts`). Compile and 522 unit tests green.

**2026-09-26 01:10** - M3 done (commit `4c41a2c`). New `src/supportPrompt.ts` (single host instance on the provider; owns URLs, clipboard, action handling, one auto show per session) and `src/supportCopy.ts` (approved copy, avatar slot payload). Provider keeps a `SessionTracker` per panel and calls `onSaveAfterSession` after save (1500 ms delay, skips diff and non `file:` panels). `mikedown.support` command with fallback notice; dev only `mikedown.dev.resetSupportPrompt` gated on `mikedown.isDevelopment`. Startup `setTimeout` removed; `src/nagPrompt.ts` deleted. Protocol documented in `editor-main.ts`. Note: `lastPrompt` is written on any `supportCardShown` ack, manual included, so a manual open also pushes back the next auto show. `npm run compile` green in main.

**2026-09-26 00:58** - M2 done (commit `8ebadde`). `src/supportPromptEligibility.ts`: `THRESHOLDS`, `KEYS`, `readState`/`writeState`, `isAutoEligible`, `nextDelayMs`, `applyAction`, `recordActiveDay`, `SessionTracker`; no `vscode` import. `tsc --noEmit` green. `npm run lint` fails on a pre-existing baseline (about 250 errors in other files, mostly `markdownEditorProvider.ts`); the new file lints with 0 errors. Lint gate for later milestones: no new errors in touched files.

**2026-09-26 00:49** - M8 done (commit `20b3769`). README "Enjoying MikeDown?" replaced with "A note from the developer" (approved letter verbatim); CHANGELOG `[Unreleased]` added with Changed and Added entries. No `enjoying-mikedown` anchors existed.

**2026-09-26** - **M1 copy approved by Mike.** Card body and README rewritten as a letter (README about 165 words, over the 150 target by Mike's choice). Buttons: "Tell a friend" renamed "Tell a colleague", "Share feedback" renamed "Open an issue" (actions stay `share` and `feedback`). Other pieces accepted as drafted. M5, M6, M8 unblocked; use `review-appeal-copy.md` verbatim.

**2026-09-26** - M1 copy drafted in `review-appeal-copy.md` (all pieces, rationale, one alternate where useful). Dash self check clean in all copy (only URLs, file names, and `aria-label` contain hyphens). Awaiting Mike's approval; M5, M6, M8 blocked until approval is logged here.

**2026-09-26 00:22** - Open questions Q1 to Q8 resolved by Mike. Accepted recommendations for Q1 (thresholds), Q2 (startup toast removed; only the `mikedown.support` fallback notice remains), Q3 (never auto show after "Leave a review"), Q4 (legacy "Stop asking" respected), Q6 ("M" initial now, swappable avatar slot; photo is a follow-up), Q8 (2.11.0, may share the release with slash commands). Changed from recommendation: Q5 sidebar link goes inline after the metrics with a forever × dismiss and a new setting `mikedown.support.showSidebarLink` (three-place rule, Appearance tab, live toggle); Q7 share message is a neutral "Check out MikeDown" line. Updated summary, design decisions, M1 to M9, tests, hands-on steps, and added Follow-ups.

**2026-09-26 00:16** - Plan created. Decisions baked in: replace the startup toast with an in-webview "A note from Mike" card (overlay outside the ProseMirror DOM, dismissible, never blocks typing); trigger after a save following a meaningful editing session, eligibility in a pure module with an injected clock, keep the `mikedown.nag.*` globalState keys and backoff ladder, sticky "Don't ask again"; persistent "♥ Support MikeDown" entry points in sidebar footer, Settings About tab, and `mikedown.support` command; dev-only `mikedown.dev.resetSupportPrompt` for testing; toast removed or kept only as a fallback (Q2); README "A note from the developer" replacing the existing "Enjoying MikeDown?" section, plus CHANGELOG Unreleased; copy review gate at M1 (`review-appeal-copy.md`); no new settings (superseded 2026-09-26 by `mikedown.support.showSidebarLink`); baseline 5 reviews, about 400 installs, check with `npx vsce show interapp.mikedown-editor` at 30 and 60 days after release.

[Return to Top](#review-appeal-planning)

## Parallel Development Recommendations

**Group A (start immediately, in parallel):**

- M1 Copy Draft (Opus). Touches only `review-appeal-copy.md`.
- M2 Eligibility Module (Sonnet). Touches only `src/supportPromptEligibility.ts`.

**Group B (after M2):** M3 Host Wiring (Sonnet). Touches `src/extension.ts`, `src/markdownEditorProvider.ts`, `package.json`, new `src/supportPrompt.ts`, `src/supportCopy.ts`, and the protocol comment in `editor-main.ts`.

**Group C (after M3):** M4 Testing: Host Logic (Sonnet). Can run in parallel with M5 once M1 is approved.

**Group D (after M1 approved and M3 done):** M5 Card UI (Opus), then M6 Entry Points (Opus). M6 is sequential after M5 because both edit `src/webview/editor-main.ts`. M6 also touches `package.json`, `src/settings.ts`, and `src/webview/outlineSidebar.ts` for the new setting. M8 README and CHANGELOG (Haiku) can run in parallel with M5 and M6 (disjoint files).

**Group E (after M5, M6):** M7 Testing: Webview.

**Group F (after all):** M9 Hands-on Pass (pause for Mike).

**Sequential blockers:**

- M1 approval gates M5, M6, M8 (copy). M3 may use placeholder copy.
- M3 gates M5 (message protocol) and M4.
- M5 and M6 must not run concurrently (both edit `editor-main.ts`).
- M3 and M6 both touch the host `supportAction` handler and `package.json`; M6 runs after M3.

If the orchestrator's context fills, run `/compact` and resume from `.orchestrator/state.json`.

[Return to Top](#review-appeal-planning)

## Gap-filling Prompt Guidance

When a milestone's summary shows incomplete items or failing tests, the orchestrator generates a gap-fill prompt with the same structure as the original milestone prompt, plus:

- **Label:** `Worker Context: [Milestone Name] - Gap Fill`.
- **Recommended model:** same as the original milestone (Opus for any UI or copy gaps).
- **Completed work:** list the items already checked off and the commit hashes from the original worker's summary.
- **Modified files:** list files the original worker touched (from its summary and `git show --stat`), so the gap worker reads them before editing.
- **Remaining items:** only the unchecked `- [ ]` items and any failing test names, verbatim.
- **Other active workers:** list every other in-flight milestone with the files and directories it owns (see Parallel Development Recommendations), and instruct the gap worker not to edit them.
- **Constraints reminder:** never mutate `editor.view.dom` outside a ProseMirror transaction; the card lives outside the ProseMirror DOM; no hyphens or dashes in appeal copy; integration tests use a private fixture, never `test/workspace/sample.md`; any new `mikedown.*` setting follows the three-place rule.
- **Completion:** workers must complete ALL items (note deferral suggestions in the summary but still attempt); run the milestone's tests green; commit code (no AI attribution in the message); write the summary to `.orchestrator/worker-summary-[milestone-slug]-gap.md`; then prompt the user to close or clear the context.

[Return to Top](#review-appeal-planning)
