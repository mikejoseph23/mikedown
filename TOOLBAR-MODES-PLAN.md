# Toolbar Mode System — Planning Document

## Summary

Redesign the MikeDown WYSIWYG toolbar to support three configurable layout modes: **Full** (current single-row with all buttons), **Condensed** (Apple Notes-inspired with dropdown menus and fewer top-level icons), and **Tabbed** (MS Word-style ribbon with grouped tab panels). This also fixes the immediate bug where wrapped toolbar buttons lose their background on narrow viewports.

**Key Objectives:**

- Fix the toolbar wrap/overflow background bug (quick win)
- Build a dropdown menu primitive reusable across modes
- Implement the Condensed toolbar with smart grouping and popover menus
- Implement the Tabbed toolbar with a ribbon-style tab bar and grouped panels
- Add a `mikedown.toolbarMode` setting to switch between modes
- Ensure all three modes look intentional and hand-crafted, not like generic scaffolding

**Critical Success Factors:** Each mode must feel native to VS Code's visual language. Dropdowns and popovers must be keyboard-accessible. Mode switching must be instant (no reload). The Condensed mode should be the best default for narrow viewports.

---

### Milestone Progress Tracker

| Milestone | Model | Status | Duration (min) | Notes |
|---|---|---|---|---|
| M1: Fix toolbar wrap background | Sonnet | ✅ Done | 2 | Quick CSS fix — removed min-height, added align-content: flex-start |
| M2: Dropdown menu primitive | Opus | ✅ Done | 3 | toolbar-dropdown.ts + .css created |
| M3: Condensed toolbar mode | Opus | ✅ Done | 5 | Apple Notes-style with dropdown menus |
| M4: Tabbed toolbar mode | Opus | ✅ Done | 5 | Ribbon-style with Format/Insert/View tabs |
| M5: Settings & mode switching | Sonnet | ✅ Done | 5 | Setting + runtime toggle + settings modal |
| M6: Polish & edge cases | Opus | ✅ Done | 3 | High contrast, responsive, transitions verified |

---

## Table of Contents

- [M1: Fix Toolbar Wrap Background](#m1-fix-toolbar-wrap-background)
- [M2: Dropdown Menu Primitive](#m2-dropdown-menu-primitive)
- [M3: Condensed Toolbar Mode (Apple Notes-Style)](#m3-condensed-toolbar-mode-apple-notes-style)
- [M4: Tabbed Toolbar Mode (MS Word Ribbon-Style)](#m4-tabbed-toolbar-mode-ms-word-ribbon-style)
- [M5: Settings & Mode Switching](#m5-settings--mode-switching)
- [M6: Polish & Edge Cases](#m6-polish--edge-cases)
- [Parallel Development Recommendations](#parallel-development-recommendations)
- [Progress Log / Notes](#progress-log--notes)

---

## M1: Fix Toolbar Wrap Background

**Model: Sonnet** | **Priority: Immediate**

The toolbar currently uses `flex-wrap: wrap` but the toolbar container's height doesn't expand to cover wrapped rows, leaving buttons floating against the editor background.

### Tasks

- [x] Fix `#toolbar` CSS so background and border extend behind all wrapped rows (likely just needs `min-height` removed or `align-content` adjustment)
- [x] Ensure the bottom border stays at the actual bottom of the toolbar, not after the first row
- [x] Test at multiple viewport widths: full-width, half-width, narrow sidebar-heavy layout
- [x] Verify no visual regression in single-row layout

**Worker Completion Requirement:** All items above must be completed. Do not skip items.

[↑ Return to Top](#toolbar-mode-system--planning-document)

---

## M2: Dropdown Menu Primitive

**Model: Opus** | **Priority: Foundation** | **Front-end UI design — apply genuine design craft**

Build a reusable dropdown/popover menu component for the toolbar. This powers both the Condensed mode's grouped menus and could replace or complement the existing context menu system. Must feel like a native VS Code popover — not a generic HTML dropdown.

### Design Reference

Look at how Apple Notes groups formatting options into a single "Aa" button that opens a popover with text styles (Title, Heading, Body, Monospaced) and a secondary inline row for B/I/U/S. The popover has clear visual hierarchy with larger preview-style labels for block formats and a compact icon row for inline marks.

### Tasks

- [x] Create `src/webview/toolbar-dropdown.ts` — a dropdown component that:
  - Anchors to a toolbar button and opens below it
  - Supports menu items with icons, labels, and active states
  - Supports item groups separated by dividers
  - Supports a "mini toolbar row" variant (horizontal icon strip within the dropdown, for B/I/S/code)
  - Closes on click-outside, Escape, or item selection
  - Positions intelligently (flips up if near bottom edge)
- [x] Create `src/webview/toolbar-dropdown.css` with styling that:
  - Uses VS Code CSS variables for colors/borders (same approach as context menu)
  - Has subtle box-shadow and border-radius matching VS Code's hover widgets
  - Includes smooth open/close transitions (opacity + slight translateY, ~120ms)
  - Shows active/selected state for the current block type (e.g., Heading 2 highlighted when cursor is in an H2)
- [x] Keyboard navigation: arrow keys to move between items, Enter to select, Escape to close
- [x] Export a clean API: `showToolbarDropdown(anchorEl, items, onSelect)` / `hideToolbarDropdown()`

**Worker Completion Requirement:** All items above must be completed. Do not skip items.

[↑ Return to Top](#toolbar-mode-system--planning-document)

---

## M3: Condensed Toolbar Mode (Apple Notes-Style)

**Model: Opus** | **Priority: Core** | **Front-end UI design — apply genuine design craft**

The Condensed toolbar reduces the button count to ~8-10 top-level icons by grouping related actions into dropdown menus. This is the ideal mode for narrow viewports and users who prefer a minimal UI.

### Design Concept

Inspired by Apple Notes toolbar:

```
[Aa ▾]  [≡ ▾]  [🔗]  [📷 ▾]  [⊞]  [—]  |  [↩] [↪]  [</>]  [☀]  [⚙]
```

- **Aa ▾** — Text format dropdown: Heading 1/2/3, Paragraph, plus an inline row for B / I / S / Code
- **≡ ▾** — List & block dropdown: Bullet List, Ordered List, Task List, Blockquote, Code Block
- **🔗** — Insert link (direct action, most common insert)
- **📷 ▾** — Insert dropdown: Image, Table, Horizontal Rule
- Remaining buttons stay as direct actions (undo/redo, source toggle, theme, settings)

### Tasks

- [x] Define the button groupings and dropdown contents (finalize the above concept)
- [x] Build `buildCondensedToolbar(editor)` function in `editor-main.ts` that:
  - Creates the condensed button set with dropdown triggers
  - Wires each dropdown trigger to open the appropriate `showToolbarDropdown`
  - Maps dropdown item selections to the correct editor commands
  - Shows active state on dropdown trigger when any of its children are active (e.g., "Aa" button highlighted when text is bold or in a heading)
- [x] Style the dropdown trigger buttons to show a small chevron indicator (▾) that's subtle but visible
- [x] The text format dropdown should show the current block type (e.g., show "H2" instead of "Aa" when cursor is in an H2)
- [x] Inline marks row in the text format dropdown: horizontal strip of B/I/S/Code buttons with active states
- [x] Test that all editor commands still work correctly through the dropdowns
- [x] Ensure the condensed toolbar never wraps (it should always fit in a single row)

**Worker Completion Requirement:** All items above must be completed. Do not skip items.

[↑ Return to Top](#toolbar-mode-system--planning-document)

---

## M4: Tabbed Toolbar Mode (MS Word Ribbon-Style)

**Model: Opus** | **Priority: Core** | **Front-end UI design — apply genuine design craft**

The Tabbed toolbar organizes all actions into tab groups displayed as a compact ribbon. Tabs switch the visible button panel without a full page transition — just the icon row changes.

### Design Concept

```
[ Format ]  [ Insert ]  [ View ]
─────────────────────────────────
B  I  S  Code  |  H1  H2  H3  |  ≡  1.  ☑  ❝  </>
```

**Tab Groups:**

- **Format** — Inline marks (B/I/S/Code), Headings (H1/H2/H3), Block types (lists, quote, code block)
- **Insert** — Link, Image, Table, Horizontal Rule
- **View** — Undo, Redo, Source Toggle, Theme Toggle, Settings

### Tasks

- [x] Build tab bar UI: horizontal row of tab labels above the toolbar buttons
  - Tab labels use VS Code's tab styling conventions (subtle underline on active tab)
  - Compact height — tabs should feel like sub-navigation, not a full tab bar
- [x] Build `buildTabbedToolbar(editor)` function that:
  - Creates the tab bar with clickable tab labels
  - Creates a button panel for each tab, only one visible at a time
  - Switches panels instantly on tab click (no animation needed, just swap)
  - Remembers the last active tab per session
- [x] Each panel arranges its buttons in logical sub-groups with separators
- [x] Active states on buttons still work (e.g., Bold button highlighted in the Format tab)
- [x] The tab bar itself should not be taller than ~24px to minimize vertical space
- [x] Keyboard: left/right arrows to switch tabs when tab bar is focused
- [x] Test all actions from each tab panel

**Worker Completion Requirement:** All items above must be completed. Do not skip items.

[↑ Return to Top](#toolbar-mode-system--planning-document)

---

## M5: Settings & Mode Switching

**Model: Sonnet** | **Priority: Core**

Wire up the setting and enable runtime mode switching without requiring a reload.

### Tasks

- [x] Add `mikedown.toolbarMode` setting to `package.json` with enum: `full`, `condensed`, `tabbed`
  - Default: `full` (preserves current behavior)
  - Description: "Toolbar layout style. Full shows all buttons, Condensed groups actions into dropdown menus, Tabbed organizes into a ribbon with tab groups."
- [x] Add `toolbarMode` to `MikeDownSettings` interface and `getSettings()` in `settings.ts`
- [x] Include `toolbarMode` in `sendSettingsToWebview()` message
- [x] In the webview, when the `settings` message arrives with a new `toolbarMode`:
  - Clear the current toolbar contents
  - Call the appropriate build function (`buildToolbar`, `buildCondensedToolbar`, or `buildTabbedToolbar`)
  - Re-call `updateThemeToggleIcon()` since the button is recreated
  - Wire up `updateToolbarState` to the new toolbar's buttons
- [x] Add toolbar mode option to the in-editor Settings modal (the gear icon dialog)
- [x] Verify mode switch works without reloading the webview
- [x] Broadcast mode changes to all open panels (same pattern as editorTheme)

**Worker Completion Requirement:** All items above must be completed. Do not skip items.

[↑ Return to Top](#toolbar-mode-system--planning-document)

---

## M6: Polish & Edge Cases

**Model: Opus** | **Priority: Final** | **Front-end UI design — apply genuine design craft**

Final pass for responsive behavior, transitions, keyboard accessibility, and visual coherence across all three modes.

### Tasks

- [x] Condensed mode: verify it never wraps at any reasonable viewport width (down to ~300px editor width)
- [x] Tabbed mode: verify tab switching is instant, no flicker or layout shift
- [x] Dropdown menus: test with keyboard-only navigation (Tab into toolbar, Enter to open dropdown, arrows to navigate, Enter to select, Escape to close)
- [x] Transitions: dropdown open/close should have a subtle fade+slide (~100-150ms), not instant pop
- [x] All three modes: verify active state highlighting is correct for all formatting types
- [x] All three modes: verify theme toggle icon (sun/moon) updates correctly
- [x] All three modes: verify the settings gear icon opens the settings modal
- [x] Test with high-contrast themes (VS Code high contrast and high contrast light)
- [x] Verify no regressions in existing features (context menu, link dialog, table picker, find/replace bar)

**Worker Completion Requirement:** All items above must be completed. Do not skip items.

[↑ Return to Top](#toolbar-mode-system--planning-document)

---

## Parallel Development Recommendations

### Dependency Graph

```
M1 (wrap fix) ──── no dependencies, do first or in parallel
M2 (dropdown) ──── no dependencies, foundation for M3
M3 (condensed) ─── depends on M2
M4 (tabbed) ────── no dependency on M2 (no dropdowns needed)
M5 (settings) ──── depends on M3 + M4 (needs all builders to exist)
M6 (polish) ────── depends on M3 + M4 + M5
```

### Parallel Groups

- **Group A** (can run simultaneously): M1, M2, M4
- **Group B** (after M2 completes): M3
- **Group C** (after M3 + M4 complete): M5
- **Group D** (after M5 completes): M6

**Sequential Blockers:** M2 blocks M3. M3 + M4 block M5. M5 blocks M6.

**Context Management Note:** If dispatching multiple parallel workers causes context to fill up, run `/compact` while waiting for workers to complete. Resume coordination by reading `.orchestrator/state.json`.

---

## Gap-Filling Prompt Requirements

When milestones have incomplete work, gap-filling prompts must:

- Follow the same structure as original milestone prompts
- Include awareness of what work was already completed
- Reference the original milestone's context and modified files
- List other active workers and their directories to avoid conflicts
- Include standard completion instructions:
  1. Commit code changes before writing the summary
  2. Write summary to `.orchestrator/worker-summary-[milestone-slug]-gap.md`
  3. Prompt user to close/clear the context after completion
- Be labeled as gap-filling work (e.g., "Worker Context: [Milestone Name] - Gap Fill")

---

## Progress Log / Notes

**2026-03-29 12:00** - Planning document created. Toolbar wrap bug identified from user screenshot showing buttons overflowing onto a second row without background coverage. Three toolbar modes defined based on user request referencing Apple Notes (condensed) and MS Word (tabbed) as design inspiration. User preference: Sonnet for logic/wiring, Opus for all front-end UI design work.

[↑ Return to Top](#toolbar-mode-system--planning-document)
