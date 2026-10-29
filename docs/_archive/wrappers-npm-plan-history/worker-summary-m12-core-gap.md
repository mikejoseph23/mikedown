# Worker summary: M12 gap fill (core editor findings)

**Status:** Completed. Lighthouse accessibility is 100 on all five developer pages (was 88).

- Start: 2026-10-24 17:45 EDT. End: 2026-10-24 18:03 EDT.
- Worktree: `/Users/michaeljosephwork/git/mikedown/.claude/worktrees/agent-a3a6cb8200a9b341a`
- Branch: `worktree-agent-a3a6cb8200a9b341a`
- Base: started on stale `f3e342f` (clean), reset to `17bdd94` as instructed.
- Commits (one per fix, on top of `17bdd94`):
  - `2d2e73b` Give completed task text enough contrast
  - `fbb76be` Name task checkboxes and give them a 24px target
  - `ab9ccc2` Start toolbar button names with their visible text
  - `a08e748` Show the table toolbar only while a focused cursor is in a table
  - `93c129c` Move toolbar buttons that don't fit into a More menu

## Work completed

- **Toolbar below ~520 px:** overflow menu. A More (⋯) button ends the condensed toolbar; `layoutToolbarOverflow` (new `packages/core/src/toolbar-overflow.ts`) runs from a ResizeObserver on the toolbar and hides buttons from the right (never the text format menu, no dangling separator) until the row fits. More lists them with their tooltip labels and icons and runs their normal handlers. Dropdown triggers (Lists, Insert, Share) and the emoji picker open against More while their own button is hidden. Disabled buttons show disabled (new `isDisabled` on dropdown items). Builds on the 2.15.0 change rather than against it: the toolbar still has `overflow: visible`, so hover tooltips are never clipped (horizontal scroll was rejected for that reason). Also re-runs layout when heading numbering toggles or the zoom readout changes width. The floating table toolbar now wraps inside the viewport on phones (it ran off the right edge at 400 px).
- **Table toolbar on load:** `updateTableToolbar` now also requires the editor (or the table toolbar) to have focus; the editor's `focus` event re-runs it, so clicking into a table still shows it. **Demo workaround not removed:** the demos end with a "Type / for ..." paragraph, but it isn't marked as a workaround and is a useful hint, so I left `website/developers/` untouched.
- **Completed-task contrast:** `opacity: 0.6` replaced by `color: var(--mikedown-text-muted)` plus the strikethrough. About 5.0:1 in light (#6f6f74 on #fff), about 6:1 in dark, and above 4.5:1 with the VS Code mapping (`descriptionForeground`).
- **Task checkboxes:** the node view sets `aria-label` to the item's first-block text, kept current in `update()` (sub-tasks aren't included; empty items read "Task"). Checkboxes in table cells read "Task done". The checkbox is drawn by hand (`appearance: none`, with the box in `::before` and the tick in `::after`) inside a 24×24 input with a -5px margin, so it keeps the old 14px look and footprint. Forced-colors mode falls back to the native control.
- **label-content-name-mismatch:** the text format trigger is named `"<Aa|H1..> Text Format"` and the zoom readout `"<size> px font size (click to reset to 15px)"`. Toolbar SVG icons are `aria-hidden`.
- CHANGELOG: `## [Unreleased]` → `### Fixed`, one line per fix.

## Files modified

- `packages/core/src/editor.ts`, `tablepicker.ts`, `taskitem-drag.ts`, `tablecheckbox.ts`, `toolbar-dropdown.ts`, `toolbar-overflow.ts` (new)
- `packages/core/src/styles/editor.css`, `theme.css`, `toolbar-dropdown.css`, `tablepicker.css`
- `packages/core/test/editor-a11y.test.ts` (checkbox names, toolbar names), `table-toolbar.test.ts` (new), `toolbar-overflow.test.ts` (new)
- `CHANGELOG.md`

## Test status

- `npm run compile`: pass
- `npm run lint`: 0 errors (1066 existing warnings)
- `npm run typecheck:webview`: pass
- `npm run test:unit`: 120 files, 1577 passed, 2 todo
- `npm run test:edge`: 22 passed
- `npm run test:packages`: 72 passed
- `npm run test:wrappers`: web-component 48, react 22, vue 11, angular 25, all passing. The Angular step first needed `npm ci --prefix packages/angular/test-app` in this fresh worktree (`ng` was missing).
- `npm run build:site`: pass
- New table-toolbar tests fail without the fix (checked).
- Playwright sweep (Chromium, 5 pages × 320/400/1280 × light/dark): no horizontal page overflow, toolbar row fits everywhere, More shown only when needed, no table toolbar on load, table toolbar appears after clicking a cell, no page errors. Claude in Chrome couldn't resize its window below 500 px or above it, so the screenshots come from Playwright.

## Lighthouse (accessibility only, CLI 13.5.0, `vite preview`)

| Page | Before | After |
| --- | --- | --- |
| `/mikedown/developers/` | 88 | 100 |
| `/developers/web-component/` | 88 | 100 |
| `/developers/react/` | 88 | 100 |
| `/developers/vue/` | 88 | 100 |
| `/developers/angular/` | 88 | 100 |

Nothing is left in accessibility. M12's best-practices note (`valid-source-maps`) was not in scope. Reports: `/private/tmp/claude-503/-Users-michaeljosephwork-git-mikedown/bcdeef5a-0084-4a26-a5d3-4847724c0e44/scratchpad/lh-after/`.

## Issues

- On load, the text format button shows "H1" when the document starts with a heading, because the selection starts there. That behavior existed before this change.
- The More menu reuses each button's tooltip text as its label, so shortcuts show ("Undo (Cmd+Z)").

## Review Materials

- Preview: `cd /Users/michaeljosephwork/git/mikedown/.claude/worktrees/agent-a3a6cb8200a9b341a && npm run build:site && npm run preview -w website -- --port 5187`, then `http://localhost:5187/mikedown/developers/` and `.../developers/{web-component,react,vue,angular}/`. Narrow the window below 520 px to see More.
- Screenshots:
  - `/private/tmp/claude-503/-Users-michaeljosephwork-git-mikedown/bcdeef5a-0084-4a26-a5d3-4847724c0e44/scratchpad/screenshots-gap/gap-react-400-light.png`
  - `/private/tmp/claude-503/-Users-michaeljosephwork-git-mikedown/bcdeef5a-0084-4a26-a5d3-4847724c0e44/scratchpad/screenshots-gap/gap-react-400-dark.png`
  - `/private/tmp/claude-503/-Users-michaeljosephwork-git-mikedown/bcdeef5a-0084-4a26-a5d3-4847724c0e44/scratchpad/screenshots-gap/gap-react-1280-light.png`
  - `/private/tmp/claude-503/-Users-michaeljosephwork-git-mikedown/bcdeef5a-0084-4a26-a5d3-4847724c0e44/scratchpad/screenshots-gap/gap-react-1280-dark.png`
  - `/private/tmp/claude-503/-Users-michaeljosephwork-git-mikedown/bcdeef5a-0084-4a26-a5d3-4847724c0e44/scratchpad/screenshots-gap/gap-react-400-light-more-menu.png`
  - `/private/tmp/claude-503/-Users-michaeljosephwork-git-mikedown/bcdeef5a-0084-4a26-a5d3-4847724c0e44/scratchpad/screenshots-gap/gap-react-400-dark-more-menu.png`
  - `/private/tmp/claude-503/-Users-michaeljosephwork-git-mikedown/bcdeef5a-0084-4a26-a5d3-4847724c0e44/scratchpad/screenshots-gap/gap-react-400-light-table-focused.png`
  - `/private/tmp/claude-503/-Users-michaeljosephwork-git-mikedown/bcdeef5a-0084-4a26-a5d3-4847724c0e44/scratchpad/screenshots-gap/gap-react-400-dark-table-focused.png`
- Sweep script: `/private/tmp/claude-503/-Users-michaeljosephwork-git-mikedown/bcdeef5a-0084-4a26-a5d3-4847724c0e44/scratchpad/gap-shots.js`
