# Worker Summary: M6 Persistent Entry Points

**Status:** Completed

- Worktree: `/Users/michaeljosephwork/git/mikedown/.claude/worktrees/agent-a7f06f9f8e0e2d5d5`
- Branch: `worktree-agent-a7f06f9f8e0e2d5d5` (base `9f35612`, reset from stale `e4d26d0`)
- Commits: `7e65b40` (feature), `f1c27af` (lint tidy). Tip: `f1c27af`
- Start: 2026-09-26 01:15 EDT. End: 2026-09-26 01:23 EDT
- The sandbox blocked writing this summary to the main repo path, so it lives at the same relative path inside the worktree (uncommitted). The screenshots did reach the main repo path.

## Work completed

- **Sidebar footer link:** `renderFooter()` builds "♥ Support MikeDown" inline after the metrics (`data-testid="sidebar-support-link"`, a real `<button>` styled as a link). It uses the middle dot separator, inherited footer color, and underline plus `--vscode-textLink-foreground` on hover. Because it is rebuilt inside `renderFooter()`, the 60s tick keeps it, and focus on the link or × is restored after each re-render.
- **Wrap behavior:** Each item draws its own leading dot. The wrapper is shifted left and clipped, so an item that starts a line never shows a dangling dot. When the row is too narrow, the whole link group wraps to its own line and the metrics ellipsize as before.
- **Dismiss ×:** `data-testid="sidebar-support-dismiss"` is a real button with aria-label and tooltip "Hide this link". It is hidden with opacity 0 until the group is hovered or the button gets `:focus-visible`, and it gets a `--vscode-focusBorder` outline. Clicking it hides the link immediately and posts `saveSettings { supportShowSidebarLink: false }`. It also shows "Hidden. You can bring it back in Settings, Appearance." for 4s in a persistent `role="status"` element outside the rebuilt rows, without moving focus.
- **Setting `mikedown.support.showSidebarLink`** (boolean, default true) is added in all three places: package.json, `settings.ts` (`support.showSidebarLink`), and an Appearance checkbox after the sidebar rows (`data-testid="setting-support-sidebar-link"`, label from copy, no description). It is included in the `settings` broadcast as `supportShowSidebarLink`, and the webview calls `applySupportLink()` live.
- **Open route (chosen):** the webview posts `{ type: 'supportAction', action: 'open' }` and the host replies with a manual `showSupportCard`. This keeps the card copy host-owned. It is documented in the protocol comment at the top of `editor-main.ts`.
- **About tab:** below the links there is a divider, the "Support MikeDown" heading, the lead-in line, and a secondary-style button "♥ Support MikeDown" (`data-testid="about-support-button"`). The button closes Settings, then posts `open`.
- **Command palette:** confirmed `mikedown.support` calls `showManual(activePanel ?? findVisiblePanel())`, and the webview renders manual cards unconditionally (code read; not run in a host).
- **Host `open`:** `SupportPrompt.handleAction` accepts `'open'`, calls `showManual` and returns early without changing state. That is a 5-line change; the `WebviewMessage.action` type was widened.
- **Copy:** `ENTRY_COPY` / `SupportEntryCopy` were added to `src/supportCopy.ts` and are sent as `supportEntryCopy` in every settings broadcast. The webview hardcodes none of the entry strings. `closeLabel: 'Close'` was added to `CARD_COPY`, and `supportCard.ts` uses it (falling back to 'Close').
- **Checks:** `npm run compile` is green. `npm run test:unit` passes 522/522. Lint shows no new errors in the touched files versus `9f35612`; `markdownEditorProvider.ts` is back to its baseline of 195 after `f1c27af`.

## Files modified

`package.json`, `src/settings.ts`, `src/supportCopy.ts`, `src/supportPrompt.ts`, `src/markdownEditorProvider.ts`, `src/webview/outlineSidebar.ts`, `src/webview/outline-sidebar.css`, `src/webview/editor-main.ts`, `src/webview/supportCard.ts`

## Issues / notes for orchestrator

- **Settings key shape:** the prompt showed `'support.showSidebarLink'`, but I matched the modal's existing flat camelCase keys (`supportShowSidebarLink`) as instructed. The host maps it to `mikedown.support.showSidebarLink`.
- **Link color:** it uses `inherit`, which is `--vscode-descriptionForeground` in dark. In light it follows the footer's existing contrast bump rather than a fainter description color.
- **Copy gating:** the entry points need `supportEntryCopy`. Until the first settings broadcast arrives, the footer link, the Appearance checkbox and the About section are omitted, which in practice is immediately after ready.
- **About section check:** it was verified by compile only. No headless render was made, because the modal lives inside the 4k LOC `editor-main.ts`.
- **Screenshot spacing:** the screenshots were taken with a 1.1em separator width. It was then tightened to 0.95em to match the metrics' " · " spacing. The layout is otherwise identical.
- **For M7:** the testids to use are `sidebar-support-link`, `sidebar-support-dismiss`, `sidebar-support-status`, `setting-support-sidebar-link` and `about-support-button`, plus the exported `applySupportLink()`.
- **Lint on the prompt's list:** `npm run lint` overall still has the pre-existing baseline failures.

## Review Materials

- **Sidebar footer screenshots** (headless Chrome, esbuild harness using the real `outlineSidebar.ts` + `outline-sidebar.css`): `/Users/michaeljosephwork/git/mikedown/.orchestrator/review-appeal-planning/screenshots/sidebar-{dark,light}-{160,200,360}-{idle,focus,dismissed}.png`. The 160/200 shots use 1,234 words, which wraps the link to its own line. The 360 shots use 12 words to show the inline layout. `focus` shows the × with its focus ring; `dismissed` shows the confirmation.
- **Harness:** `/private/tmp/claude-503/-Users-michaeljosephwork-git-mikedown/1ae199cf-9fd7-4665-8c40-5699ba056598/scratchpad/m6/` (`harness.ts`, `index.html`, `shoot.sh`)
