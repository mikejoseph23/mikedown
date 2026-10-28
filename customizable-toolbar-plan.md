# Customizable Toolbar (Firefox-style) — Planning Document

## Summary

**Purpose.** Let users add, remove and rearrange the MikeDown toolbar: buttons, separators and flexible spacers, by drag and drop (and keyboard) from a palette, in place on the live toolbar, Firefox-style. The layout is one self-contained, versioned JSON value (`mikedown.toolbarLayout`) stored by each host, with a Toolbar section in the in-editor Settings modal (Customize…, Reset to Default). Hosts' `features` flags and host-conditional buttons (Source, Share, AI, heading numbers) keep hiding buttons regardless of layout.

**Approach in one line.** First turn `buildCondensedToolbar`'s hand-written `appendChild` sequence into a registry of button definitions keyed by id (behavior-identical), then add a pure layout module (parse, normalize, migrate, apply), then host plumbing, then the edit mode UI, keyboard/accessibility, tests, docs and a hands-on pass.

**Key objectives**

- Registry of toolbar items with `id`, `render`, `available()`, `group` and default order; the default render is pixel-identical to today.
- `toolbarLayout` round-trips through every host (VS Code, Desktop, wrappers) through the existing `settings` in / `host.saveSettings` out channel.
- In-place edit mode: drag handles, palette tray (unused items, Separator, Flexible Spacer), Done, Reset to Default, fully keyboard-operable with screen reader announcements.
- More ⋯ overflow keeps working on top of any custom layout; flexible spacers collapse before buttons overflow.
- Future layout sync (GitHub or similar) only has to move one value.

**Critical success factors**

- Milestone 1 ships with no visible change: same DOM order, same `data-action` ids, same More ⋯ behavior, same AI/heading-numbers show/hide paths.
- The toolbar and the palette tray are chrome: no code path touches `editor.view.dom` (see CLAUDE.md "Never mutate `editor.view.dom` outside a ProseMirror transaction").
- A hand-edited or future-version layout never breaks the toolbar: unknown ids are skipped at render and preserved on save; invalid JSON means default.
- Drag works inside the VS Code webview and in Tauri on macOS and Windows (pointer events, not HTML5 DnD; see Decisions D6).

**Defaults applied without asking:** incremental testing, automated tests first, no Playwright, no screenshots (one hands-on milestone instead), no schema milestone (no database), model per milestone recommended below. Not a LymeStack app (no `lymetools.json`).

### Milestone Progress Tracker

| Milestone | Model | Status | Duration (min) | Notes |
|---|---|---|---|---|
| [M1 — Toolbar registry refactor (no visible change)](#m1--toolbar-registry-refactor-no-visible-change) | Sonnet | ✅ Done | 7 | `cc70ad0`, `f2f4ba2`; unavailable items DOM-absent |
| [M2 — Layout model: schema, normalize, migrate, apply](#m2--layout-model-schema-normalize-migrate-apply) | Sonnet | ✅ Done | 6 | `152d838`; AC3 corrected to D15 (`settings` appended) |
| [T1 — Registry and layout model tests](#t1--registry-and-layout-model-tests) | Sonnet | ✅ Done | 4 | `02cc9ae`, `c5b41e7`; 126 toolbar tests |
| [M3 — Settings plumbing: core, VS Code, Desktop, wrappers, Toolbar section](#m3--settings-plumbing-core-vs-code-desktop-wrappers-toolbar-section) | Sonnet | ✅ Done | 7 | `8988bc9`; OQ1 own tab, OQ6 reuse `APP_WIDE_KEYS` |
| [M4 — Edit mode UI: handles, palette tray, drag, spacers](#m4--edit-mode-ui-handles-palette-tray-drag-spacers) | Opus | ⏸ Waiting on OQ2 | — | Front-end design work |
| [M5 — Keyboard and accessibility for edit mode](#m5--keyboard-and-accessibility-for-edit-mode) | Opus | ⬜ Not Started | — | Interaction design |
| [T2 — Edit mode, overflow and host tests](#t2--edit-mode-overflow-and-host-tests) | Sonnet | ⬜ Not Started | — | jsdom keyboard flows, fakeRow overflow |
| [M6 — Docs, website, CHANGELOG](#m6--docs-website-changelog) | Haiku | 🔄 In Progress | — | Can start after M3 |
| [T3 — Hands-on checklist (VS Code, Desktop, React demo)](#t3--hands-on-checklist-vs-code-desktop-react-demo) | Human (Mike) | ⬜ Not Started | — | Drag is the one thing jsdom can't prove |

---

## Table of Contents

- [Summary](#summary)
- [Current code (grounding)](#current-code-grounding)
- [Decisions](#decisions)
- [Layout schema](#layout-schema)
- [Milestones](#milestones)
  - [M1 — Toolbar registry refactor (no visible change)](#m1--toolbar-registry-refactor-no-visible-change)
  - [M2 — Layout model: schema, normalize, migrate, apply](#m2--layout-model-schema-normalize-migrate-apply)
  - [T1 — Registry and layout model tests](#t1--registry-and-layout-model-tests)
  - [M3 — Settings plumbing: core, VS Code, Desktop, wrappers, Toolbar section](#m3--settings-plumbing-core-vs-code-desktop-wrappers-toolbar-section)
  - [M4 — Edit mode UI: handles, palette tray, drag, spacers](#m4--edit-mode-ui-handles-palette-tray-drag-spacers)
  - [M5 — Keyboard and accessibility for edit mode](#m5--keyboard-and-accessibility-for-edit-mode)
  - [T2 — Edit mode, overflow and host tests](#t2--edit-mode-overflow-and-host-tests)
  - [M6 — Docs, website, CHANGELOG](#m6--docs-website-changelog)
  - [T3 — Hands-on checklist (VS Code, Desktop, React demo)](#t3--hands-on-checklist-vs-code-desktop-react-demo)
- [Open Questions](#open-questions)
- [Follow-ups](#follow-ups)
- [Parallel Development Recommendations](#parallel-development-recommendations)
- [Gap-filling prompts](#gap-filling-prompts)
- [Progress Log / Notes](#progress-log--notes)

---

## Current code (grounding)

- `packages/core/src/editor.ts` `buildCondensedToolbar` (~line 2485 to 2955): `makeBtn` / `makeDropdownTrigger` / `makeSeparator` helpers, `overflowOpeners` map, a `wireDropdown` helper, each button built inline with its listeners, then an "Assemble" block of `toolbar.appendChild(...)` calls. Current order: `textFormat, listBlock, link, insert, emoji, headingNumbers, [ai], | undo, redo, | [sourceToggle |] [share] selectAll | zoomOut zoomReset zoomIn | themeToggle settings more`. `headingNumbers` toggles `style.display` from the `headingNumbering` setting (`applyHeadingNumbering`, line ~1969); `ai` is only appended when `aiHost` exists and `applyAiToolbarMode` / `refreshAiToolbarButton` (line ~2211) hide it from `ai.showToolbarButton`. `(toolbar as any).__condensedUpdate` refreshes labels and active states on selection change. Other code finds buttons by `button[data-action="..."]` (`zoomReset`, `zoomOut`, `zoomIn`, `headingNumbers`, `ai`).
- `packages/core/src/toolbar-overflow.ts` `layoutToolbarOverflow`: items spill from the right into More ⋯ (`.toolbar-overflowed`); the first child never overflows; trailing separators are hidden; More is hidden when nothing listable overflowed (so at a wide width More ⋯ is not visible at all). Rerun by a ResizeObserver. The More menu is built in `editor.ts` from the overflowed `BUTTON` children, using `overflowOpeners` for dropdowns.
- `packages/core/src/types.ts`: `MikeDownFeatures` / `DEFAULT_FEATURES`, `MikeDownSettings`, and the `MikeDownSettingsSection` extension API (`makeRow`, `makeGroup`, `makeCheckboxRow`, `makeSelectRow`, `collect`, `onSaved`).
- Settings modal: tabs `appearance`, `behavior`, `markdown`, `spelling`, `hotkeys`, plus host tabs (`AI`, Desktop `App`); `updateSettings(patch)` at ~line 6024 applies live changes.
- VS Code: `package.json#contributes.configuration`, `src/settings.ts` (reader), `src/markdownEditorProvider.ts` (`saveSettings` handling ~line 208 and 1161, `settings` broadcast ~line 1416).
- Desktop: `packages/desktop/src/settings/schema.ts` (`DESKTOP_KEY_DEFAULTS`, `APP_WIDE_KEYS`, `IGNORED_CORE_KEYS`), `store.ts` (global + folder files, `applyCore` to every pane), `desktopSettings.ts`; `tauriHost.ts#saveSettings`. `tauri.conf.json` has `dragDropEnabled: true`.
- Wrappers: React / Vue / Angular / web component accept `settings?: Partial<MikeDownSettings>` and apply later changes with `handle.updateSettings`.
- Tests: `packages/core/test/toolbar-overflow.test.ts` already fakes flex-row geometry (`fakeRow`) over `stubLayoutMeasurement()` from `test/harness/webviewHarness`; `editor-a11y.test.ts`, `two-editors.test.ts`, `host-gating.test.ts` are the patterns for jsdom editor tests.
- A parallel worker is landing the AI toolbar button on `develop` (`aiBtn`, `applyAiToolbarMode`, `mikedown.ai.showToolbarButton`). M1 must build on that commit, not duplicate it.

[Return to Top](#customizable-toolbar-firefox-style--planning-document)

---

## Decisions

Decisions Mike made (D1 to D4) and the ones made while writing this plan (D5 onward), one line of rationale each.

- **D1 — In-place edit mode (Firefox model).** "Customize Toolbar…" turns the live toolbar into edit mode: drag handles, a palette tray below with unused items plus Separator and Flexible Spacer, a Done button. The Settings modal's Toolbar section holds Customize… and Reset to Default. *Rationale: editing the real thing beats a preview; it is the model users already know from Firefox.*
- **D2 — Overflow and granularity.** More ⋯ auto-overflow still applies on top of the custom layout. Text Format is pinned first and not removable; More ⋯ and Settings are not removable (always a way back into customize). Dropdown groups (Text Format, Lists & Blocks, Insert, Share) stay single items; their menus are not customizable in v1. Zoom (− size +) moves as one item. The floating table toolbar is out of scope. *Rationale: keeps the overflow invariant ("first child never overflows") and the v1 surface small.*
- **D3 — Storage per host, no cross-host sync in v1.** VS Code: `mikedown.toolbarLayout`, user (application) scope, carried by Settings Sync. Desktop: a key in its global settings file. Wrappers: `settings.toolbarLayout` in, `host.saveSettings({ toolbarLayout })` out; the app decides persistence, otherwise session-only. The layout is one versioned JSON blob so a later sync/export moves one value. *Rationale: every host already has a settings store; sync is a follow-up (see Follow-ups).*
- **D4 — Schema** (see [Layout schema](#layout-schema)): `{ version: 1, items: [...], seen: [...] }`, `"|"` separator, `"~"` flexible spacer. New buttons not in `seen` are inserted next to their default-layout neighbor and added to `seen`; removed ones stay removed. Unknown ids are skipped at render, preserved on save. Empty/missing layout means default; Reset clears it. Host-conditional buttons have `available()`; unavailable ones are hidden from toolbar and palette but keep their slot. *Rationale: forward and backward compatible with one small blob.*
- **D5 — Entry points: Settings modal, More ⋯ (when visible) and a toolbar right-click menu.** More ⋯ is hidden when nothing overflows, so at a wide width it cannot carry the entry; a right-click on empty toolbar space (or on any toolbar button) shows a one-item context menu "Customize Toolbar…", like Firefox. More ⋯ stays hidden when nothing overflows (no visual change for existing users). *Rationale: Firefox parity and a discoverable entry without adding a permanent button.*
- **D6 — Drag uses pointer events, not HTML5 drag and drop.** `pointerdown` + `setPointerCapture` + `pointermove` hit-testing + a cloned ghost element, with a 4px move threshold before a drag starts. *Rationale: Tauri's `dragDropEnabled: true` (needed for file drops in Desktop) swallows HTML5 DnD on Windows/WebView2, HTML5 DnD ghost images are inconsistent in the VS Code webview, and pointer events share one code path with touch.*
- **D7 — Edits apply live, save on Done; Escape equals Done.** Every drop/remove/add is applied to the toolbar immediately (so the user sees the real result, including overflow behavior after Done) but `host.saveSettings` is called once, on Done. Escape with nothing grabbed is Done. There is no Cancel; "Reset to Default" in the tray is the undo. *Rationale: Firefox saves on close too; one save per session avoids a VS Code config write per drop and keeps multi-panel broadcasts quiet.*
- **D8 — While an instance is in edit mode, incoming `toolbarLayout` updates are ignored for that instance.** Its working copy wins and is saved on Done. Other instances (other VS Code panels, other Desktop panes) rebuild from the broadcast as usual. *Rationale: avoids the toolbar rebuilding under the user's pointer when the host echoes a save or another window saves.*
- **D9 — Edit mode suspends overflow and wraps the toolbar.** On entering edit mode the toolbar gets `.toolbar-editing` (`flex-wrap: wrap`), every `.toolbar-overflowed` class is cleared, the ResizeObserver callback is a no-op, and More ⋯ is shown as a fixed, non-draggable end anchor. Done restores one-row overflow. *Rationale: every item must be visible and reachable while editing, including at narrow widths.*
- **D10 — Flexible spacer is an overflowable flex element.** `.toolbar-spacer { flex: 1 1 0; min-width: 0 }`; `layoutToolbarOverflow` treats spacers like separators (may get `.toolbar-overflowed`, never listed in More ⋯, trimmed when trailing). Because it shrinks to zero before any button overflows, `rowFits` keeps working unchanged. *Rationale: no change to the overflow algorithm, and a spacer never pushes a button into More ⋯.*
- **D11 — Keyboard model for edit mode.** Roving `tabindex` across toolbar items, then the tray. Arrow keys move focus. Space or Enter on a toolbar item grabs it (`aria-pressed="true"`, visible lifted style); while grabbed, Left/Right (Up/Down in the tray) move it one slot, Space/Enter drops, Escape cancels the grab and restores the original slot. Delete/Backspace on a focused toolbar item removes it to the tray (focus moves to the next item). Enter or Space on a tray item adds it after the last toolbar item the user focused (or before More ⋯ if none). `aria-live="polite"` region announces "Moved Undo to position 7 of 12", "Removed Emoji", "Added Separator". Entering edit mode focuses the first movable item; Done returns focus to whatever opened edit mode (the Settings modal's button, More ⋯, or the toolbar). *Rationale: WAI-ARIA toolbar pattern plus the familiar grab/move/drop idiom used by sortable lists; no drag required.*
- **D12 — Wrapper API: `settings.toolbarLayout` plus `features.customizeToolbar` plus exported registry ids.** `MikeDownFeatures.customizeToolbar` (default `true`) hides every Customize entry and the Toolbar section for embeds that want a fixed layout; `@mikedown/core` exports `ToolbarLayout`, `ToolbarItemId`, `TOOLBAR_ITEM_IDS`, `DEFAULT_TOOLBAR_LAYOUT` and `normalizeToolbarLayout` from the main entry (no new subpath). No wrapper-specific props: all four wrappers already pass `settings` through. *Rationale: apps can preset a layout and still lock it; one flag matches how `sourceMode` and `findReplace` are gated today.*
- **D13 — `mikedown.ai.showToolbarButton` wins; the layout only positions.** The AI entry's `available()` includes the setting, so when it is false the button is hidden from toolbar and palette and keeps its slot. The setting is not retired. *Rationale: it is a shipped host kill switch from the parallel AI work; folding it into the layout is a follow-up, not a v1 change.*
- **D14 — `headingNumbers` stays setting-driven through `available()`.** `available()` returns `headingNumbering !== 'off'`; a `refreshToolbarAvailability()` pass replaces today's `style.display` toggles for `headingNumbers` and `ai`, and reruns overflow. *Rationale: one mechanism for every conditional button.*
- **D15 — Normalization rules for hand-edited settings.** Non-object or wrong-shape values mean default (not written back until the next save). Non-string entries are dropped; duplicate ids keep the first occurrence; `textFormat` is moved or inserted first; `more` is moved or appended last and `settings` appended before it if missing; runs of `|`/`~` collapse to one; leading and trailing `|`/`~` are trimmed. Unknown ids are kept in place (skipped at render). A `version` greater than 1 is read the same way (unknown ids preserved). *Rationale: the toolbar must always render something sane, and a newer layout must survive an older core.*
- **D16 — Multiple editor instances.** The registry and layout state are per `createMikeDownEditor` instance (closure, like everything else in `editor.ts`); edit mode is per instance; a save goes through that instance's `host.saveSettings` and the host broadcasts to every instance. *Rationale: matches how all other settings flow today; `two-editors.test.ts` covers the pattern.*
- **D17 — Zoom is one registry item rendering a `.toolbar-group` wrapper** with the three existing buttons inside (ids unchanged), draggable as one; overflow treats the wrapper as one child; the More ⋯ menu lists the wrapper's inner buttons (three entries) so the readout stays reachable. *Rationale: D2 says zoom moves as one; the inner `data-action` ids keep `refreshZoomControl` working unchanged.*
- **D18 — Read-only editors can still customize.** The toolbar is chrome and the layout is a user preference, not a document edit. *Rationale: no reason to couple it to document editability.*
- **D19 — Desktop stores `toolbarLayout` in the global file only** (added to the global-only key list next to `APP_WIDE_KEYS`; a folder file carrying it is dropped on load with the usual banner reason). *Rationale: a per-folder toolbar would surprise people and complicates sync later.*
- **D20 — Test strategy.** Pure layout module: vitest unit tests. Registry render, features gating, availability refresh, keyboard edit flows, multi-instance and incoming-update-while-editing: jsdom tests in `packages/core/test/`. Overflow with spacers: the existing `fakeRow` harness. VS Code reader and Desktop schema: `test/unit/` and the desktop test suite. Pointer drag: hands-on only (T3), on macOS and Windows for Desktop. *Rationale: everything but the drag gesture is assertable without a browser.*

[Return to Top](#customizable-toolbar-firefox-style--planning-document)

---

## Layout schema

```json
{
  "version": 1,
  "items": ["textFormat", "listBlock", "link", "insert", "emoji", "headingNumbers", "ai", "|", "undo", "redo", "|", "sourceToggle", "|", "share", "selectAll", "|", "zoom", "|", "themeToggle", "settings", "more"],
  "seen": ["textFormat", "listBlock", "link", "insert", "emoji", "headingNumbers", "ai", "undo", "redo", "sourceToggle", "share", "selectAll", "zoom", "themeToggle", "settings", "more"]
}
```

- `items`: registry ids plus `"|"` (separator) and `"~"` (flexible spacer). The example above is the default layout; it reproduces today's DOM exactly (the separators after `sourceToggle` and around `share` fall out of trailing/duplicate trimming when those buttons are unavailable, matching today's conditional `appendChild` calls).
- `seen`: every registry id this layout has been reconciled against. A future core that adds `foo` after `emoji` in its default inserts `foo` after `emoji` (or the nearest present default neighbor) in a layout whose `seen` lacks it, then adds `foo` to `seen`. A user who removed `emoji` keeps it removed because `emoji` is in `seen`.
- `version`: the schema version; 1 for this plan. A reader accepts higher versions and preserves what it does not understand.
- Empty / missing / invalid: the default layout. Reset to Default writes `null` (VS Code: `config.update('toolbarLayout', undefined, Global)`; Desktop: removes the key; wrappers: `host.saveSettings({ toolbarLayout: null })`).
- `MikeDownSettings.toolbarLayout?: ToolbarLayout | null`. The VS Code schema is `type: ["object", "null"]` with `version`, `items`, `seen` properties, `default: null`, `scope: "application"`.

[Return to Top](#customizable-toolbar-firefox-style--planning-document)

---

## Milestones

**Worker completion requirement (every milestone).** Workers must complete ALL items in their task list. Do not skip items because they seem lower priority or slightly out of scope. If an item should be removed or deferred, say so in the worker summary for the orchestrator to decide, but attempt the work unless it is truly blocked. Commit on `develop` (no feature branches), human-style commit messages, no AI attribution anywhere.

**Common rules for every worker**

- Never touch `editor.view.dom` or anything inside `.mikedown-editor-container` from toolbar code. The toolbar, the tray and the context menu live in `.mikedown-root` beside the editor container.
- Keep `data-action` ids exactly as today (`textFormat`, `listBlock`, `link`, `insert`, `emoji`, `headingNumbers`, `ai`, `undo`, `redo`, `sourceToggle`, `share`, `selectAll`, `zoomOut`, `zoomReset`, `zoomIn`, `themeToggle`, `settings`, `more`, `fontPicker` if it is wired). Other code queries them.
- `npm run lint`, `npm run test:unit`, `npm run test:edge` green before the summary. Add `npm run test:packages` when `packages/core` exports change.
- Markdown written by workers: escape `$` as `\$`, blank lines around lists.

### M1 — Toolbar registry refactor (no visible change)

**Model: Sonnet.** Well-defined, mechanical refactor guarded by a baseline test written first; escalate to Opus only if the merge with the AI button commit is messy.

**Precondition.** The AI toolbar button work (`aiBtn`, `applyAiToolbarMode`, `refreshAiToolbarButton`, `mikedown.ai.showToolbarButton`) must be committed on `develop`. The worker runs `git log --oneline -5 -- packages/core/src/ai-toolbar.ts` first; if it is not there, stop and report rather than refactor around uncommitted work.

**Tasks**

- [x] Write the baseline test before refactoring: `packages/core/test/toolbar-registry.test.ts` creates an editor (default features, a host with `viewInBrowser`, no AI) and asserts the exact sequence of toolbar children as `[tag, data-action or 'separator', display]`; add cases for `features.sourceMode: false`, a host without share outputs, a host with AI, and `headingNumbering: 'fromH1'` vs `'off'`. Run it against the unrefactored code and commit it green.
- [x] Create `packages/core/src/toolbar-registry.ts` with `ToolbarItemDef { id: ToolbarItemId; label: string; menuLabel?: string; kind: 'button' | 'dropdown' | 'group'; pinned?: 'first' | 'last'; removable: boolean; available?(): boolean; render(ctx): HTMLElement; update?(): void }`, `TOOLBAR_ITEM_IDS`, `DEFAULT_TOOLBAR_ITEMS` (the default order including `'|'` positions) and `ToolbarItemId` / `ToolbarLayoutToken` (`ToolbarItemId | '|' | '~'`) types. The definitions themselves are built inside `buildCondensedToolbar` (they close over `editor`, `host`, `features`, `fontZoom`, `openAiToolbar`...), the module holds the types, ids, default order and a `renderToolbar(toolbar, defs, tokens)` function.
- [x] Move each button's construction into its registry entry's `render`: `textFormat` (pinned first, not removable), `listBlock`, `link`, `insert`, `emoji`, `headingNumbers` (`available: () => currentHeadingNumbering !== 'off'`), `ai` (`available: () => !!aiHost && aiToolbarButtonMode(...) !== 'hidden'`), `undo`, `redo`, `sourceToggle` (`available: () => features.sourceMode`), `share` (`available: () => !!(host.viewInBrowser || host.printDocument)`), `selectAll`, `zoom` (kind `group`, wrapper `.toolbar-group[data-action="zoom"]` holding `zoomOut`, `zoomReset`, `zoomIn`), `themeToggle`, `settings` (not removable), `more` (pinned last, not removable). Keep `overflowOpeners` and `wireDropdown` as they are.
- [x] `renderToolbar` walks the token list: skips unknown ids, skips unavailable items (not in DOM at all, replacing today's `style.display='none'` for `headingNumbers` and `ai`, or keep `display:none` if the a11y test or `refreshAiToolbarButton` rely on the node existing; pick one and make `refreshToolbarAvailability()` consistent), collapses duplicate separators and trims trailing ones so the DOM matches the baseline exactly.
- [x] Replace `applyHeadingNumbering`'s and `refreshAiToolbarButton`'s `style.display` toggles with `refreshToolbarAvailability()` (re-render or toggle, then `layoutToolbarOverflow`). Keep `refreshZoomControl`, `__condensedUpdate` and every `querySelector('button[data-action=...]')` call site working.
- [x] Overflow: `layoutToolbarOverflow` and the More ⋯ menu builder treat a `.toolbar-group` as one child; the More menu expands a group into its inner buttons. Add the group case to `toolbar-overflow.test.ts`.
- [x] Delete or ZOMBIE-comment the dead `buildToolbar` (line ~2405) only if its removal is trivial; otherwise leave it.
- [x] Baseline test still green without modification; `npm run lint`, `npm run test:unit`, `npm run test:edge` green. Commit.

**Acceptance criteria**

- `toolbar-registry.test.ts` baseline passes unchanged after the refactor (same children, same order, same ids, same conditional presence).
- `npm run dev` shows a toolbar indistinguishable from `main` at wide and narrow widths, including More ⋯ contents and the zoom readout.
- No references to `editor.view.dom` in `toolbar-registry.ts`.

[Return to Top](#customizable-toolbar-firefox-style--planning-document)

### M2 — Layout model: schema, normalize, migrate, apply

**Model: Sonnet.** Pure logic with a precise spec (D4, D15); runs in parallel with M1.

**Tasks**

- [x] Create `packages/core/src/toolbar-layout.ts` (pure, no DOM): `ToolbarLayout` type, `TOOLBAR_LAYOUT_VERSION = 1`, `DEFAULT_TOOLBAR_LAYOUT` built from `DEFAULT_TOOLBAR_ITEMS` (import ids/default order from `toolbar-registry.ts` types only, or from a tiny `toolbar-ids.ts` both import, so M1 and M2 don't conflict; agree on `toolbar-ids.ts` holding `TOOLBAR_ITEM_IDS`, `DEFAULT_TOOLBAR_ITEMS` and the pinned/removable table).
- [x] `parseToolbarLayout(value: unknown): ToolbarLayout | null` accepts an object or a JSON string; returns `null` for anything not shaped like a layout.
- [x] `normalizeToolbarLayout(layout, knownIds): ToolbarLayout` applies D15 (drop non-strings, dedupe keeping first, `textFormat` first, `settings` present, `more` last, collapse and trim `|`/`~`, preserve unknown ids in place).
- [x] `reconcileSeen(layout, defaultItems, knownIds): ToolbarLayout` inserts ids missing from `seen` next to their default-layout neighbor (previous present default neighbor, else next, else before `more`) and adds them to `seen`; never re-adds an id already in `seen`.
- [x] `resolveToolbarLayout(value: unknown, knownIds, defaultItems): { tokens: ToolbarLayoutToken[]; layout: ToolbarLayout; isDefault: boolean }` is the single entry the editor calls; `isDefault` when value was empty/invalid.
- [x] `layoutWithMove / layoutWithRemove / layoutWithInsert` pure helpers for the edit mode (M4/M5) so reorder logic is testable without DOM, including "pinned items cannot move or be removed" and "a separator/spacer can be inserted anywhere between pinned ends".
- [x] `serializeToolbarLayout(layout): ToolbarLayout` returns the value to save (unknown ids kept, `version` set, `seen` sorted by default order for stable diffs).
- [x] JSDoc on every export with the D15 rules. Commit.

**Acceptance criteria**

- `resolveToolbarLayout(undefined)` yields `DEFAULT_TOOLBAR_ITEMS` and `isDefault: true`.
- The round trip default → serialize → resolve is identity.
- A layout with `version: 7` and ids `["textFormat","hologram","more"]` resolves to `["textFormat","settings","more"]` (D15 appends `settings`) and serializes back as `["textFormat","hologram","settings","more"]`.

[Return to Top](#customizable-toolbar-firefox-style--planning-document)

### T1 — Registry and layout model tests

**Model: Sonnet.** Modes: unit (vitest) for `toolbar-layout.ts`; jsdom for the registry.

**Tasks**

- [x] `packages/core/test/toolbar-layout.test.ts`: every D15 rule as its own `it`; `reconcileSeen` cases: new id with a present neighbor, new id whose neighbor was removed, user-removed id stays removed, `seen` empty (legacy) treats all current ids as unseen only for ids not in `items`; move/remove/insert helpers incl. pinned refusals; higher `version` preserved; JSON string input; garbage input.
- [x] Extend `toolbar-registry.test.ts` (from M1): `renderToolbar` with a custom token list (reordered, with `~`, with an unknown id), unavailable items absent, `refreshToolbarAvailability()` after `updateSettings({ headingNumbering: 'off' })` and after an AI `showToolbarButton` flip; zoom group renders three inner buttons with unchanged ids.
- [x] `toolbar-overflow.test.ts`: `.toolbar-group` counted as one child and expanded in More; spacer (`data-w="0"`) overflowed like a separator and never listed.
- [x] Run `npm run test:unit` and `npm run lint` green. Commit.

**Acceptance criteria**

- All new tests green; no existing test modified except to add cases.

[Return to Top](#customizable-toolbar-firefox-style--planning-document)

### M3 — Settings plumbing: core, VS Code, Desktop, wrappers, Toolbar section

**Model: Sonnet.** Wiring across known files; the Settings modal rows use the existing row builders (no new visual design).

**Tasks**

- [x] Core `types.ts`: `MikeDownSettings.toolbarLayout?: ToolbarLayout | null` (documented as a self-contained versioned blob), `MikeDownFeatures.customizeToolbar: boolean` (default `true`). Export `ToolbarLayout`, `ToolbarItemId`, `ToolbarLayoutToken`, `TOOLBAR_ITEM_IDS`, `DEFAULT_TOOLBAR_LAYOUT`, `normalizeToolbarLayout` from `packages/core/src/index.ts`.
- [x] Core `editor.ts`: `buildCondensedToolbar` resolves the layout from `options.settings?.toolbarLayout`; `updateSettings({ toolbarLayout })` re-resolves and re-renders the toolbar (dropdowns closed first, then `layoutToolbarOverflow`), unless this instance is in edit mode (D8, store the pending value and drop it on Done). `null` means default.
- [x] Core Settings modal: new `toolbar` tab after `appearance` (or a group at the bottom of Appearance, worker's call, record it) with a "Customize Toolbar…" button (closes the modal with `onDiscarded` semantics, then enters edit mode; the M4 worker wires the actual entry, M3 leaves a `enterToolbarEditMode()` stub that logs nothing and is a no-op) and "Reset to Default" (sends `host.saveSettings({ toolbarLayout: null })` and re-renders immediately; disabled when `isDefault`). Both hidden when `features.customizeToolbar` is false.
- [x] VS Code `package.json#contributes.configuration.properties`: `mikedown.toolbarLayout` (`type: ["object","null"]`, `default: null`, `scope: "application"`, `properties` for `version`/`items`/`seen`, description pointing to the in-editor Customize). Keep `additionalProperties: true` so a newer layout survives an older extension.
- [x] VS Code `src/settings.ts`: read `toolbarLayout` (raw unknown, no validation beyond object-or-null); include it in the `settings` broadcast. `markdownEditorProvider.ts` `saveSettings`: `toolbarLayout: null` → `config.update('toolbarLayout', undefined, ConfigurationTarget.Global)`, otherwise write the object to Global (never Workspace). Add to `test/unit/settings` reader tests if a pattern exists.
- [x] Desktop: `toolbarLayout` is a core key stored in the global file only (extend the global-only mechanism beside `APP_WIDE_KEYS`; folder copies dropped with a banner reason); `null` save removes the key; `applyCore` already fans the patch to every pane. Add the key to the desktop settings tests (`packages/desktop` test suite, same style as the `ai.*` cases).
- [x] Wrappers: no code change expected; verify each (`react`, `vue`, `angular`, `web-component`) passes `settings.toolbarLayout` through and that `features.customizeToolbar` flows through the existing `features` prop/attribute. Add a short "Toolbar layout" paragraph to `packages/core/README.md` and the wrapper READMEs that document `settings` (same wording).
- [x] `npm run test:unit`, `npm run test:packages` green. Commit.

**Acceptance criteria**

- Setting `mikedown.toolbarLayout` in VS Code user settings reorders the toolbar live in every open panel; removing the setting restores the default.
- Desktop global `settings.json` with `toolbarLayout` renders the layout in every pane; a folder file carrying it is ignored with a banner reason.
- `features.customizeToolbar: false` hides the Toolbar section entries; the layout still applies.

[Return to Top](#customizable-toolbar-firefox-style--planning-document)

### M4 — Edit mode UI: handles, palette tray, drag, spacers

**Model: Opus.** Front-end interaction and visual design; the look of the edit mode is the deliverable.

**Design brief.** Reference Firefox's Customize Toolbar and VS Code's own drag feel: items lift with a subtle shadow and 1.02 scale, a 2px accent insertion line shows the drop slot, the tray is a quiet panel under the toolbar with a label ("Drag items onto the toolbar"), grid of unused items with their icon and label, then Separator and Flexible Spacer tiles, a Reset to Default link and a primary Done button at the right. Use the existing toolbar tokens (`theme.css`), 120ms transitions, respect `prefers-reduced-motion`. In edit mode toolbar buttons are inert (no editor actions), dropdown chevrons stay but do nothing, spacers render as a dashed outline with a `⇔` glyph only in edit mode (invisible otherwise), separators are visible as today.

**Tasks**

- [ ] `packages/core/src/toolbar-customize.ts`: `enterToolbarEditMode(ctx)` / `exitToolbarEditMode()` owning the working `ToolbarLayout`, the tray DOM (`.mikedown-toolbar-tray`, inserted after the toolbar inside `.mikedown-root`, never inside the editor container), and the live re-render through M1's `renderToolbar` and M2's `layoutWith*` helpers.
- [ ] Entry points (D5): "Customize Toolbar…" in the Settings modal Toolbar section (replace M3's stub), as the last entry of the More ⋯ menu (separator above it) when More is visible, and a one-item context menu on right-click anywhere in the toolbar (reuse `contextmenu.ts` `showContextMenu`). All hidden when `features.customizeToolbar` is false.
- [ ] Edit mode state (D9): `.toolbar-editing` on the toolbar (`flex-wrap: wrap`), overflow suspended (clear `.toolbar-overflowed`, ResizeObserver callback no-ops, More ⋯ shown as a fixed end anchor), `aria-label` of the toolbar changes to "Customize toolbar", buttons get `aria-disabled` for their normal action and a drag handle affordance (grip on hover is fine; the whole button is the handle).
- [ ] Pointer-event drag (D6): `pointerdown` on a movable item (not `textFormat`, `settings`, `more`), 4px threshold, `setPointerCapture`, ghost clone following the pointer, insertion line computed from item midpoints (toolbar) or "drop here" highlight on the tray (remove), drop applies `layoutWithMove` / `layoutWithRemove`; dragging from the tray onto the toolbar applies `layoutWithInsert`; `pointercancel` restores. Touch works through the same path (`touch-action: none` on items only in edit mode).
- [ ] Spacers (D10): `.toolbar-spacer` element rendered by `renderToolbar` for `~`; CSS `flex: 1 1 0; min-width: 0`; `layoutToolbarOverflow` treats it like a separator (coordinate with the M1 change if not already done).
- [ ] Tray contents: every registry item not in the layout and `available()`, plus Separator and Flexible Spacer tiles (always available, multiple allowed), plus Reset to Default (applies `DEFAULT_TOOLBAR_LAYOUT` to the working copy) and Done.
- [ ] Done (D7): `host.saveSettings({ toolbarLayout: serializeToolbarLayout(working) })` once (or `null` if the working copy equals the default), exit edit mode, remove the tray, restore overflow, apply any deferred incoming layout only if the user made no changes.
- [ ] Multiple instances (D16): entering edit mode in one instance does not affect others; `destroy()` while editing removes the tray and listeners (add to `disposers`).
- [ ] CSS in `packages/core/src/styles/editor.css` / `theme.css` (light and dark, VS Code theme variables where the host provides them). Ship the CSS in the `.vsix` list if a new file is added (`markdownEditorProvider.ts#getWebviewContent` and `.vscodeignore`); prefer adding to existing files.
- [ ] `npm run lint`, `npm run test:unit` green; `npm run dev` smoke in VS Code. Commit.

**Acceptance criteria**

- From a wide VS Code window: right-click the toolbar → Customize Toolbar…, drag Emoji to the tray, drag a Flexible Spacer between Redo and Source, drag Undo to the far left (lands after Text Format), Done; the toolbar keeps that layout after reload and the setting shows the JSON.
- At 500px width in edit mode every item is visible on wrapped rows; after Done the overflow puts items back into More ⋯.
- No `editor.view.dom` access in `toolbar-customize.ts`; the editor's selection is unchanged after an edit session.

[Return to Top](#customizable-toolbar-firefox-style--planning-document)

### M5 — Keyboard and accessibility for edit mode

**Model: Opus.** Interaction design with ARIA; nuanced focus management.

**Tasks**

- [ ] Implement D11 in `toolbar-customize.ts`: roving `tabindex` over toolbar items then tray items; Arrow navigation; Space/Enter grab and drop (`aria-pressed`, `.toolbar-item-grabbed` style); Left/Right move while grabbed (Up/Down in the tray grid); Escape cancels a grab (restores the slot) or, with nothing grabbed, acts as Done; Delete/Backspace removes a focused movable item to the tray and moves focus to the next item; Enter/Space on a tray item inserts it after the last focused toolbar item (before `more` when none).
- [ ] Pinned items (`textFormat`, `settings`, `more`) are focusable but announce "cannot be moved" on grab attempts.
- [ ] `aria-live="polite"` status region inside the tray announcing every move/add/remove with position of total ("Moved Undo to position 7 of 12"), plus a one-time instruction on entry ("Customizing the toolbar. Use arrow keys to choose an item, Space to pick it up and move it, Delete to remove it, Escape or Done to finish.").
- [ ] Focus management: entering edit mode focuses the first movable item; Done/Escape returns focus to the element that opened edit mode (Settings modal button is gone by then, so fall back to the toolbar's first item or More ⋯); focus never lands in the ProseMirror document as a side effect.
- [ ] Keep the normal-mode toolbar a11y intact (`editor-a11y.test.ts` green): `role="toolbar"`, button names, hidden icons.
- [ ] Visible focus ring and grabbed state meet 3:1 contrast in both themes; `prefers-reduced-motion` disables the lift animation.
- [ ] `npm run lint`, `npm run test:unit` green. Commit.

**Acceptance criteria**

- With the mouse unplugged (VS Code or the React demo): enter edit mode from the Settings modal, move Undo three slots right, remove Emoji, add a Separator, press Escape; the saved layout matches; VoiceOver (macOS) reads each announcement.

[Return to Top](#customizable-toolbar-firefox-style--planning-document)

### T2 — Edit mode, overflow and host tests

**Model: Sonnet.** Modes: jsdom (keyboard flows, multi-instance, deferred updates), unit (fakeRow overflow), host reader tests.

**Tasks**

- [ ] `packages/core/test/toolbar-customize.test.ts`: enter edit mode via a programmatic entry (export `enterToolbarEditMode` for tests or trigger the context menu entry); `.toolbar-editing` set and all `.toolbar-overflowed` cleared; tray lists exactly the unused available items plus Separator and Spacer; keyboard grab/move/drop reorders the DOM and the working layout; Delete removes to tray; Enter on a tray item inserts; Escape with a grab restores, without a grab calls `host.saveSettings` once with the serialized layout (or `null` when equal to default); `features.customizeToolbar: false` exposes no entry points; `destroy()` during edit mode removes the tray.
- [ ] Deferred update (D8): `updateSettings({ toolbarLayout })` during edit mode does not re-render; after Done with changes the user's layout wins; after Done without changes the deferred layout applies.
- [ ] Two instances on one page (`two-editors.test.ts` pattern): edit mode in one leaves the other's toolbar untouched; the host's broadcast after Done re-renders both.
- [ ] Overflow: fakeRow with a spacer between buttons: spacer collapses first (`data-w="0"` when squeezed), buttons overflow from the right, spacer never listed in More; a layout starting with `~` after `textFormat` still keeps `textFormat` first.
- [ ] Host side: `test/unit/` test for the VS Code settings reader including `toolbarLayout` object and `null`; Desktop test for global-only enforcement and `null` removal.
- [ ] `npm run test:unit`, `npm run test:edge`, `npm run test:packages` green. Commit.

**Acceptance criteria**

- Every D7, D8, D9, D11, D15, D16 behavior has at least one assertion; CI (`.github/workflows/ci.yml`) green.

[Return to Top](#customizable-toolbar-firefox-style--planning-document)

### M6 — Docs, website, CHANGELOG

**Model: Haiku.** Mechanical documentation; copy the voice of the existing entries.

**Tasks**

- [ ] `CHANGELOG.md`: an `Added` entry under the next unreleased extension version describing Customize Toolbar (how to open it, drag and keyboard, separators and spacers, Reset to Default, the `mikedown.toolbarLayout` setting and that Settings Sync carries it).
- [ ] `README.md`: a "Customizable toolbar" paragraph in the toolbar section (line ~88), no screenshot required (leave a TODO comment for Mike to add one later if he wants).
- [ ] `website/vscode/index.html`: a short feature blurb beside the existing toolbar mentions (line ~249 area); `website/developers/` wrapper docs: `settings.toolbarLayout`, `features.customizeToolbar`, exported ids/types, and the "app decides persistence" note.
- [ ] `packages/core/README.md` and each wrapper README: the same paragraph if M3 did not already add it; `packages/desktop` docs/CHANGELOG if the desktop keeps one.
- [ ] `package.json` setting description reviewed for clarity (it shows in the VS Code settings UI).
- [ ] Commit.

**Acceptance criteria**

- `npm run build:site` green; a reader of the developers hub can preset a layout and lock it without reading core source.

[Return to Top](#customizable-toolbar-firefox-style--planning-document)

### T3 — Hands-on checklist (VS Code, Desktop, React demo)

**Model: Human (Mike).** Mode: hands-on. Drag is the one thing jsdom cannot prove; everything else below is a behavioral walk-through at the same time. The orchestrator pauses for sign-off.

**Where to look**

- VS Code: `npm run dev` in `/Users/michaeljosephwork/git/mikedown` opens a dev host on `test/workspace`; open any `.md`.
- Desktop: `cd packages/desktop && npm run tauri dev` (macOS), and the Windows box for the WebView2 drag check (D6).
- React demo: `npm run dev:site` then `http://localhost:5180/mikedown/developers/` → React demo.

**Checklist**

- [ ] VS Code, wide window: right-click the toolbar → Customize Toolbar… Drag Emoji to the tray, a Flexible Spacer between Redo and Source, Undo to the far left. Done. Reload the window: layout kept. Settings UI shows `mikedown.toolbarLayout` JSON. Reset to Default in the Settings modal restores everything and empties the setting.
- [ ] VS Code, two panels side by side: customize in one, Done; the other panel updates. Start customizing in panel A, change the setting in panel B (Reset); A keeps its working copy until Done.
- [ ] VS Code, 500px wide editor: enter edit mode; every item visible on wrapped rows; Done; More ⋯ holds the overflow again and Customize Toolbar… is its last entry.
- [ ] VS Code, keyboard only: Settings → Toolbar → Customize…, Arrow keys, Space to grab, move, Space to drop, Delete to remove, Enter on a tray item, Escape. VoiceOver announces each step.
- [ ] VS Code: turn `mikedown.headingNumbering` on and off and `mikedown.ai.showToolbarButton` on and off with a custom layout; the buttons appear in their layout slot and never in the tray while unavailable.
- [ ] Desktop macOS: same drag flow; the layout lands in the global `settings.json`; a second pane picks it up; a `.mikedown/settings.json` with `toolbarLayout` is ignored with the banner reason.
- [ ] Desktop Windows: the drag flow works with `dragDropEnabled: true` (file drop onto the editor still works afterwards).
- [ ] React demo: customize and Done; the demo page's `onSettingsChange` (or equivalent) receives `toolbarLayout`; reload shows the default again unless the demo persists it (expected, session-only).
- [ ] Editing a document before and after an edit session: cursor and selection are where they were; no console errors.

**Acceptance criteria**

- Every item checked or a defect filed as a gap-fill prompt; Mike signs off.

[Return to Top](#customizable-toolbar-firefox-style--planning-document)

---

## Open Questions

- **OQ1 — Toolbar section placement in the Settings modal:** *(M3: own `toolbar` tab after Appearance; easier to find and leaves room for M4/M6 hints.)* its own `toolbar` tab or a group at the bottom of Appearance? Two rows feel thin for a tab; a tab is easier to find. M3 worker decides and records it; Mike can overrule in T3.
- **OQ2 — Should the Settings modal's Customize… button close the modal with "discard" semantics?** Unsaved changes on other tabs would be lost; alternatively save first, then enter edit mode. Plan assumes discard with a confirm only when the modal is dirty (reuse any existing dirty check).
- **OQ3 — `fontPicker` button:** `makeBtn('fontPicker', ...)` exists at line ~2678 but is not in the assemble block. Is it meant to be a registry item (available from the palette, not in the default layout)? If yes it becomes the first "optional" item users can add, which is a nice showcase.
- **OQ4 — Removing `mikedown.ai.showToolbarButton` later:** D13 keeps it. Once layouts ship, the setting is redundant for users who customize. Retire in a later release or keep as the host-level kill switch?
- **OQ5 — Hide the whole toolbar?** Firefox allows an empty toolbar; here Text Format, Settings and More are pinned so the minimum is three items. Is a "hide toolbar" toggle wanted (it already exists for embeds via `features.toolbar`)? Not planned.
- **OQ6 — Desktop global-only enforcement:** *(M3: reused `APP_WIDE_KEYS`, widened to `string[]`.)* reuse `APP_WIDE_KEYS` (renaming it) or add a parallel `GLOBAL_ONLY_CORE_KEYS` list? M3 worker picks the smaller diff.

[Return to Top](#customizable-toolbar-firefox-style--planning-document)

---

## Follow-ups

- **Layout sync across hosts** (Mike's ask): the layout is one versioned value, so a sync feature moves exactly `toolbarLayout`. Candidates: a GitHub Gist (one JSON file, like VS Code's old Settings Sync), or a `mikedown-settings.json` in a user-chosen repo, with an "Export / Import toolbar layout" pair in the Toolbar section as the zero-infrastructure first step. Reconciliation on import is `normalize` + `reconcileSeen`, already built in M2. Note VS Code already syncs it through Settings Sync, so the follow-up is really Desktop ⇄ VS Code ⇄ wrappers.
- **Customizable dropdown menus** (Text Format, Lists & Blocks, Insert, Share) and a "split a group into its buttons" option, e.g. Bold/Italic as top-level buttons. Needs per-item registry entries for the inner commands; the schema supports it as new ids without a version bump.
- **Table toolbar customization** (`tablepicker.ts`, `#mikedown-table-toolbar`): same registry pattern, separate layout key.
- **Retire `mikedown.ai.showToolbarButton`** once the layout is the canonical way to hide the button (see OQ4).
- **Named presets** (Writing, Reviewing, Minimal) in the tray.
- **Icon-only vs icon+label** mode for the toolbar, a common Firefox-style option.

[Return to Top](#customizable-toolbar-firefox-style--planning-document)

---

## Parallel Development Recommendations

- **Group A (parallel):** M1 (registry refactor) and M2 (layout model). They share only `toolbar-ids.ts`; M2 creates it, M1 imports from it (M1 can inline the ids first and switch after M2 lands; whichever lands first owns the file).
- **Sequential blocker:** T1 after both A milestones. M3 after T1 (needs the types and `renderToolbar`).
- **Group B (parallel):** M4 (edit mode UI) and M6 (docs) after M3. M6 only needs the setting and API names.
- **Sequential:** M5 after M4 (same file, `toolbar-customize.ts`). T2 after M5. T3 last.
- **Precondition for M1:** the AI toolbar button commit on `develop`. If the orchestrator starts while that worker is still running, dispatch M2 first and hold M1.
- Only M4 and M5 touch `styles/`; M1, M3 and M4 all edit `editor.ts`, so never run two of those at once.

**Orchestrator context management.** If dispatching several prompts fills the orchestrator context, prompt Mike to run `/compact` while waiting for workers; after compacting, resume from `.orchestrator/state.json`. Worker summaries go to `.orchestrator/customizable-toolbar-plan/worker-summary-<milestone-slug>.md`.

[Return to Top](#customizable-toolbar-firefox-style--planning-document)

---

## Gap-filling prompts

When a milestone leaves items skipped or partial, the orchestrator writes a gap-fill prompt that:

- Follows the same structure as the original milestone prompt (header, mission statement, planning doc reference).
- States what the original attempt completed and which files it modified, and references the original milestone's context.
- Lists other active workers and their directories to avoid conflicts.
- Ends with the standard completion steps: commit code changes before writing the summary; write the summary to `.orchestrator/customizable-toolbar-plan/worker-summary-<milestone-slug>-gap.md`; prompt the user to close/clear the context.
- Is labeled "Worker Context: <Milestone Name> - Gap Fill".

[Return to Top](#customizable-toolbar-firefox-style--planning-document)

---

## Progress Log / Notes

**2026-10-28 18:45** - Plan written from Mike's backlog item and decisions D1 to D4; D5 to D20 made while planning (entry points incl. toolbar right-click since More ⋯ hides at wide widths; pointer-event drag because Tauri `dragDropEnabled` blocks HTML5 DnD on Windows; save on Done; edit mode wraps and suspends overflow; spacer overflows like a separator; `showToolbarButton` wins; `features.customizeToolbar`; Desktop global-only; test strategy). Grounded in `editor.ts#buildCondensedToolbar`, `toolbar-overflow.ts`, `types.ts`, `src/settings.ts`, Desktop `settings/schema.ts` and the existing `toolbar-overflow.test.ts` harness. M1 is gated on the parallel AI toolbar button commit.

**2026-10-28 18:47** - Orchestrator started. M1 precondition met (`fdbde35`). Dispatched M1 and M2 (Sonnet, worktrees). Coordination: M2 owns `toolbar-ids.ts`; M1 inlines the ids in `toolbar-registry.ts` and T1 switches it to import from `toolbar-ids.ts`. Canonical ids are the 16 in the schema's `seen`; `fontPicker` stays out until OQ3 is answered.

**2026-10-28 18:55** - M2 done (`152d838`, fast-forwarded onto `develop`, 6 min). `toolbar-ids.ts` (ids, default items, pinned/removable traits) and `toolbar-layout.ts` (parse, normalize, reconcileSeen, resolve, serialize, index-based move/remove/insert helpers that return the same object when refused) plus 28 tests. Corrected M2 acceptance criterion 3 to match D15 (missing `settings` is appended). Worktree was created off stale `98b5e8c`; the worker reset it to `39863d6`. The one `test:unit` failure in the worktree (`standaloneHtml.test.ts`, missing `packages/core/dist/styles.css`) is a fresh-worktree artifact.

**2026-10-28 19:05** - M1 done (`cc70ad0` baseline test, `f2f4ba2` registry refactor; cherry-picked onto `develop`, 7 min). Unavailable items are left out of the DOM (not `display:none`) so separators collapse correctly; `test/unit/headingNumberingEditor.test.ts` was changed to expect an absent button. Zoom is a `.toolbar-group`; spacers overflow like separators; More expands groups. `buildToolbar` left in place (not trivial). Ids still inline in `toolbar-registry.ts`. Main tree: lint 0 errors, `test:unit` 2266 pass, `test:edge` 22, `test:integration` 47 passing. Dispatched T1 (Sonnet, worktree), which also switches `toolbar-registry.ts` to import from `toolbar-ids.ts`.

**2026-10-28 19:10** - T1 done (`02cc9ae` registry now imports ids from `toolbar-ids.ts`; `c5b41e7` tests; fast-forwarded, 4 min). Toolbar tests: layout 85, registry 20, overflow 21. No bugs found in M1/M2 source. Main tree: lint 0 errors, `test:unit` 2351 pass, `test:edge` 22. Dispatched M3 (Sonnet, worktree). OQ2 asked of Mike ahead of M4.

**2026-10-28 19:22** - M3 done (`8988bc9`, cherry-picked onto `develop` after another session's `83a16a9`, 7 min). `toolbarLayout` setting and `features.customizeToolbar` wired through core, VS Code (application scope, Global writes, `null` removes), Desktop (global-only via `APP_WIDE_KEYS`) and wrappers (no code change needed; README paragraph added to core and all four wrappers). Toolbar tab in Settings with a no-op Customize stub and Reset to Default. M4 hooks: `enterToolbarEditMode()` stub, `toolbarEdit.isToolbarEditing`, `toolbarEdit.pendingToolbarLayout`. Fixed a Desktop bug: a folder-scope Save never wrote an `APP_WIDE_KEYS` core key because `store.ts#save` set the baseline before the global re-save. `ai-settings.test.ts` tab-order list updated for the new tab. Angular note: Reset stores `toolbarLayout: null` in localStorage, which overrides an app's `[settings]` preset (Reset means product default, not app preset). Main tree: lint 0 errors, `test:unit` 2374, `test:edge` 22, `test:packages` 79, desktop unit 567, `test:integration` 47 passing. Dispatched M6 (Haiku, worktree); M4 waits on Mike's OQ2 answer.

[Return to Top](#customizable-toolbar-firefox-style--planning-document)
