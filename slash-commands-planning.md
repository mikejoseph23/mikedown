# Slash Commands Planning

<a id="top"></a>

## Summary

**Purpose.** Add a Notion-style slash command menu to the MikeDown WYSIWYG editor. Typing `/` opens a filterable popup at the cursor; choosing an item inserts that block in place of the typed `/query`. This ships the BACKLOG.md item "Slash commands — `/` menu for inserting blocks (Notion-style)".

**Objectives.**

- A pure, unit-tested command registry and matcher (name prefix + alias matching).
- A ProseMirror plugin that opens the menu only in the right places (textblock start or after whitespace, anywhere in the line; never in code, links, mid-word, or source mode) and exits gracefully without ever deleting typed text.
- A popup that looks and feels native to VS Code and as polished as Notion's menu, in light and dark themes.
- Every command inserts a block that serializes to clean markdown and undoes in one step back to the `/query` text.
- Three new settings, `mikedown.slashCommands.enabled`, `mikedown.slashCommands.dateFormat`, and `mikedown.slashCommands.timeZone`, each wired in all three places (package.json, `src/settings.ts`, Settings modal "Slash commands" subsection of the Behavior tab) with live effect.
- An in-menu "Turn off slash commands" footer row that disables the feature in one step, with a host notification offering Open Settings and Undo.
- A new host-side image file picker reachable from `/image` (files from outside the doc folder/workspace are copied into the image-paste folder).
- `/properties` (only when the doc has no frontmatter), `/date`, and `/datetime`, with date/time formatting in a pure, clock-injected, unit-tested helper.
- The empty-doc placeholder reads "Type / for commands…" while slash commands are enabled and reverts to "Start writing…" live when they are disabled.

**Success factors.**

- `and/or`, `path/to`, `https://x.com/a/b`, code blocks (including mermaid), and inline code never trigger the menu.
- `/date` and `/datetime` output follows `dateFormat` and `timeZone`, including the correct calendar day across zones.
- Esc, click-away, Backspace past `/`, a no-match space, or moving the cursor out of range all close the menu with the document byte-for-byte unchanged.
- Enter on any command produces the expected markdown (round-trip tested) and Cmd+Z restores the exact `/query` text.
- Toggling `mikedown.slashCommands.enabled` (settings UI, Settings modal, or the menu's footer row) takes effect in an open editor without reload, including the placeholder text.
- The footer row is never matched by filtering, so Enter on a filtered query can never turn the feature off by accident.
- `npm run test:unit`, `npm run test:integration`, and `npm run lint` are green, and Mike signs off on the hands-on pass.

## Milestone Progress Tracker

| Milestone | Model | Status | Duration (min) | Notes |
| --- | --- | --- | --- | --- |
| M1: Command registry + matcher | Sonnet | ⬜ | | Pure module, no DOM |
| M2: Trigger/exit plugin + popup UI | Opus | ⬜ | | Front-end design craft required |
| T1: Tests for M1 + M2 | Sonnet | ⬜ | | Unit + jsdom harness |
| M3: Wire existing-block commands | Sonnet | ⬜ | | Mid-line insert-below, callouts, pickers |
| M4: Image file picker (host) | Sonnet | ⬜ | | New message pair |
| M5: Settings (three places, live toggle) | Sonnet | ⬜ | | enabled/dateFormat/timeZone, Behavior subsection, placeholder, footer notification |
| M6: Properties, Date, Datetime | Sonnet | ⬜ | | Pure date helper + tests; runs before T2 |
| T2: Tests, integration, hands-on sign-off | Sonnet | ⬜ | | Pauses for Mike |
| M7: Docs (CHANGELOG, README, BACKLOG) | Haiku | ⬜ | | Last |

## Table of Contents

- [Summary](#summary)
- [Milestone Progress Tracker](#milestone-progress-tracker)
- [Design Decisions](#design-decisions)
- [Code Findings That Shape the Plan](#code-findings-that-shape-the-plan)
- [Model Guidelines](#model-guidelines)
- [M1: Command Registry + Matcher](#m1-command-registry--matcher)
- [M2: Trigger/Exit Plugin + Popup UI](#m2-triggerexit-plugin--popup-ui)
- [T1: Tests for M1 + M2](#t1-tests-for-m1--m2)
- [M3: Wire Existing-Block Commands](#m3-wire-existing-block-commands)
- [M4: Image File Picker](#m4-image-file-picker)
- [M5: Settings](#m5-settings)
- [M6: Properties, Date, Datetime](#m6-properties-date-datetime)
- [T2: Tests, Integration, Hands-On Sign-Off](#t2-tests-integration-hands-on-sign-off)
- [M7: Docs](#m7-docs)
- [Open Questions](#open-questions)
- [Parallel Development Recommendations](#parallel-development-recommendations)
- [Gap-Filling Prompt Guidance](#gap-filling-prompt-guidance)
- [Progress Log / Notes](#progress-log--notes)

## Design Decisions

### Command set

Filtering matches the command name by prefix and every alias by prefix (case-insensitive). Exact name/alias matches rank first, then name-prefix, then alias-prefix, then registry order.

| Command | Name | Aliases | Behavior |
| --- | --- | --- | --- |
| Heading 1 | `h1` | `heading1`, `title` | Block → H1 |
| Heading 2 | `h2` | `heading2` | Block → H2 |
| Heading 3 | `h3` | `heading3` | Block → H3 |
| Heading 4 | `h4` | `heading4` | Block → H4 |
| Heading 5 | `h5` | `heading5` | Block → H5 |
| Heading 6 | `h6` | `heading6` | Block → H6 |
| Paragraph | `text` | `p`, `paragraph` | Block → paragraph |
| Quote | `quote` | `blockquote` | Wrap in blockquote |
| Bullet list | `bullet` | `ul`, `list` | Bullet list |
| Numbered list | `numbered` | `ol`, `1.` | Ordered list |
| Task list | `todo` | `task`, `checkbox` | Task list |
| Code block | `code` | `codeblock`, ```` ``` ```` | Code block, then open the existing language picker |
| Mermaid | `mermaid` | `diagram`, `chart` | Code block with language `mermaid` and a starter diagram |
| Table | `table` | `grid` | Open the existing table grid picker (`tablepicker.ts`) |
| Divider | `divider` | `hr`, `---` | Horizontal rule |
| Note callout | `note` | `callout` | `callout-node.ts`, kind `note` |
| Tip callout | `tip` | | kind `tip` |
| Important callout | `important` | | kind `important` |
| Warning callout | `warning` | `warn` | kind `warning` |
| Caution callout | `caution` | `danger` | kind `caution` |
| Link | `link` | `url` | Existing link prompt (`showLinkDialog`) |
| Wikilink | `wikilink` | `[[`, `page` | Insert `[[` and hand off to `wikilinkautocomplete.ts` |
| Image | `image` | `img`, `picture` | NEW host-side file picker (M4) |
| Emoji | `emoji` | `:` | Existing emoji picker (`showEmojiPicker`) |
| Properties | `properties` | `frontmatter`, `yaml` | Insert empty frontmatter and focus the sidebar Properties section (M6). **Only offered when the doc has no frontmatter.** |
| Date | `date` | `today` | Insert today's date inline, per `dateFormat` and `timeZone` (M6) |
| Date and time | `datetime` | `timestamp`, `now` | Insert date + `HH:mm` (24-hour) inline, per `dateFormat` and `timeZone`, with a zone label when `timeZone` is not local (M6) |

Because aliases include `1.`, ```` ``` ````, `---`, `[[` and `:`, the query character set is "any non-whitespace", not just `\w`. `/date` exact-matches Date first, then Date and time by name prefix.

### Date and time formatting

- `mikedown.slashCommands.dateFormat`: `iso` (default) → `2026-09-26`; `long` → `September 26, 2026` (en-US month name).
- `mikedown.slashCommands.timeZone`: `"local"` (default), `"UTC"`, or an IANA zone name (e.g. `America/New_York`). Validated by constructing `Intl.DateTimeFormat(undefined, { timeZone })`; an invalid value falls back to local and logs a `console.warn` once per value.
- `/date` uses `timeZone` to decide which calendar day it is (e.g. 23:30 local on the 25th can be the 26th in UTC).
- `/datetime`: date part per `dateFormat`, then a space, then `HH:mm` 24-hour in `timeZone`. When `timeZone` is not local, append the short zone label from `Intl.DateTimeFormat(..., { timeZoneName: 'short' })`: `2026-09-26 18:30 UTC`, `2026-09-26 14:30 EDT`, `September 26, 2026 14:30 EDT`. Local time has no label: `2026-09-26 14:30`.
- All of this lives in a pure helper, `src/webview/slashcommands-date.ts`: `formatSlashDate(now: Date, opts: { format: 'iso' | 'long'; timeZone: string; includeTime: boolean }): string` plus `resolveTimeZone(value): string | undefined` (undefined = local). The clock is injected (`now` parameter); no `Date.now()` inside the helper.

### Trigger rules

- Opens when `/` is typed at the start of a textblock or immediately after whitespace, anywhere in the line. This is fixed behavior with no setting (decided 2026-09-25; the former `trigger` setting was dropped).
- **Never while the cursor is in a code block or inline code** (reaffirmed 2026-09-26). That covers every `codeBlock` node regardless of language (including `mermaid`, whether the diagram is rendered or being edited) and any position with an inline `code` mark active, including the boundary just inside the backticks.
- Also never inside a `link` mark, a wikilink, or directly after a non-whitespace character (so `and/or`, `path/to`, and URLs never trigger).
- Never in source mode (CodeMirror). The plugin also stays closed if the selection is non-empty.
- Mid-line insertion (decided 2026-09-25): if the `/query` is the only content of its textblock, convert that block in place. Otherwise remove `/query`, leave the current line's text untouched (no split), and insert the new block **immediately after the current block**, with the cursor placed inside it. Inline commands (link, wikilink, emoji, date, datetime) insert inline at the cursor instead. Properties inserts at the top of the document (frontmatter) regardless of cursor line, and removes `/query`.

### Graceful exit

- Esc, click-away (mousedown outside the popup), editor blur, Backspace past the `/`, typing whitespace when the query has no matches (queries never contain whitespace, so any whitespace closes), and the cursor leaving the `[from, to]` range all close the menu.
- Dismissal never mutates the document. The plugin remembers the dismissed `/` position so the menu does not reopen on the next keystroke until a new `/` is typed.
- Insertion runs as one transaction with `closeHistory` applied first, so one Cmd+Z restores the exact `/query` text (the typing and the insertion must not merge into one history group, even when Enter is hit inside ProseMirror's 500 ms group window).
- Commands that open a follow-up picker (code language, table, link, emoji, image) remove `/query` only when the picker commits. Cancelling the picker leaves `/query` intact (resolved 2026-09-26, Open Question 3).

### Settings

All three follow the three-place rule (`package.json`, `src/settings.ts`, Settings modal). No trigger-mode setting (decided 2026-09-25).

| Setting | Type | Default | Modal control |
| --- | --- | --- | --- |
| `mikedown.slashCommands.enabled` | boolean | `true` | Checkbox "Slash command menu" |
| `mikedown.slashCommands.dateFormat` | enum `iso` \| `long` | `iso` | Select: "ISO (2026-09-26)" / "Long (September 26, 2026)" |
| `mikedown.slashCommands.timeZone` | string | `"local"` | Text input, placeholder "local, UTC, or e.g. America/New_York" |

- No dedicated tab. They go in a **"Slash commands" subsection** (subheading) of the Settings modal's **Behavior** tab (`behaviorPanel` in `showSettingsModal`, currently holding default editor, auto-reload, link click, wikilink create, theme scope, and heading rename). Behavior is the right fit: this is an editing interaction, not markdown output (Markdown tab) or looks (Appearance).
- The dateFormat and timeZone controls are disabled (greyed out) while the "Slash command menu" checkbox is unticked, updating live as the checkbox changes; their values are still saved.
- The settings broadcast applies all three live, no reload.

### Placeholder

- The empty-doc placeholder reads "Type / for commands…" while `enabled` is true and "Start writing…" while it is false, switching live on the settings broadcast (resolved 2026-09-26). Today it is `Placeholder.configure({ placeholder: 'Start writing…' })` (`editor-main.ts` ~line 2876). Make `placeholder` a function reading the current enabled flag, then dispatch a no-op transaction (e.g. `tr.setMeta('slashPlaceholder', true)`) on toggle so the decoration re-renders; never touch `editor.view.dom` directly.

### In-menu disable option

- The popup ends with a muted footer row, "Turn off slash commands" with a subtle icon, separated from the command list by a divider and set in smaller `--vscode-descriptionForeground` text.
- Reachable by keyboard (ArrowDown past the last command, ArrowUp from the first wraps to it) and by click. Filtering never matches it, so it is never the default selection and Enter on a filtered query cannot hit it by accident. It stays visible under any filter that still has matches; when no commands match, the menu closes as usual.
- Choosing it: closes the menu, leaves the typed `/query` text intact (no transaction), and posts the existing `{ type: 'saveSettings', settings: { slashCommandsEnabled: false } }` path. The host persists `mikedown.slashCommands.enabled = false`, and the resulting settings broadcast disables the plugin in every open editor.
- The host (only when the save came from the footer row) shows `vscode.window.showInformationMessage("Slash commands are turned off. You can turn them back on in MikeDown Settings → Behavior.", "Open Settings", "Undo")`.
  - **Open Settings:** host posts `{ type: 'command', command: 'openSettings', tab: 'behavior' }` to the originating panel; the webview opens `showSettingsModal` on the Behavior tab.
  - **Undo:** host sets `mikedown.slashCommands.enabled = true` (Global); the broadcast re-enables live.
- To tell the host the save came from the footer, the webview adds `source: 'slashMenu'` to that `saveSettings` message. No other new message types are needed.
- Protocol additions (document in the header comment of `src/webview/editor-main.ts`):
  - Webview → host: `saveSettings` gains optional `source?: 'slashMenu'`.
  - Host → webview: `command` with `command: 'openSettings'` and optional `tab?: 'general' | 'appearance' | 'markdown' | 'behavior'` (use the modal's real tab ids).

[Return to Top](#top)

## Code Findings That Shape the Plan

- **Popup pattern to follow:** `src/webview/wikilinkautocomplete.ts` (and its twin `emojiautocomplete.ts`). It is a TipTap `Extension` whose `addProseMirrorPlugins()` returns one `Plugin` with a `view()` whose `update(view)` re-derives the query from `$from.parent.textBetween(...)` before the cursor, a module-level `PopupState { from, to, query, matches, activeIndex }`, a popup element appended to `document.body` (never inside PM's DOM), `positionPopup(view, from)` using `view.coordsAtPos` with viewport clamping and flip-above, `mousedown` + `preventDefault` on items so the editor keeps focus, and `props.handleKeyDown` for ArrowUp/ArrowDown/Enter/Tab/Escape. Selection uses `view.state.tr.replaceWith(from, to, ...)` + `dispatch` (a proper transaction).
- **Gaps in that pattern the slash menu must fix:** neither existing autocomplete has click-away or blur handling, and Esc only hides the popup; the next transaction re-derives the match and reopens it. The slash plugin needs a remembered "dismissed at `from`" and a document `mousedown` listener (cleaned up in `destroy()`).
- **Table picker needs an anchor element.** `showTableGridPicker(editor, anchorEl: HTMLElement)` takes an element, not a rect. The language picker (`anchorRect` / `point`) and emoji picker (`anchorRect`) already accept rects. M3 must either add a rect/point option to `showTableGridPicker` or use a transient invisible anchor in `document.body` (never in `editor.view.dom`).
- **Existing entry points to reuse:** `showLinkDialog(editor)` (editor-main.ts ~line 359), `showLanguagePicker(editor, { anchorRect | point, allLanguages, currentLanguage, onClosed })`, `showEmojiPicker(editor, { anchorRect })`, `showTableGridPicker`, callout commands `setCallout(kind)` / `toggleCallout(kind)` with `CALLOUT_KINDS` exported from `callout-node.ts`, `setMermaidEnabled` in `mermaid.ts`.
- **Image insertion today:** paste goes webview `savePastedImage` → host `handleSavePastedImage` → `pastedImageResult` with `requestId`. The host already has `formatInsertPath(absPath, docPath, workspaceRoot, pathStyle)` and `resolveAltText` in `src/imagePaste.ts`, and `webview.asWebviewUri`. `localResourceRoots` only covers the extension dirs, the doc's folder, and workspace folders, so an image picked from outside those will not render; it is copied into the image-paste folder instead (resolved 2026-09-26, Open Question 4).
- **Protocol comment is stale.** The header comment in `editor-main.ts` documents only a handful of messages; `savePastedImage` / `pastedImageResult` and many others are missing, and CLAUDE.md calls the paste message `pasteImage`. M4 adds the new pair there and to the `WebviewMessage['type']` union in `markdownEditorProvider.ts` (~line 1885).
- **Settings wiring points:** host broadcast object (~line 1168 of `markdownEditorProvider.ts`), `saveSettings` handler (~line 819), webview `message.type === 'settings'` handler (~line 4671 of `editor-main.ts`), and the Behavior panel (~line 1744).
- **CSS registration:** webview stylesheets are listed by filename in `markdownEditorProvider.ts` (~line 1815, next to `linkautocomplete.css` and `emojipicker.css`). A new `slashcommands.css` must be added to that list. Theme overrides use `body.mikedown-force-light` (see `emojipicker.css`).
- **Harness:** `test/harness/webviewHarness.ts` (`bootWebview()`) boots the real bundle in jsdom but only exposes source-mode typing. T1 must add WYSIWYG helpers (get the TipTap editor, insert text at cursor as a user would so input rules and plugin views run, press a key through `handleKeyDown`, read the last `edit` markdown).
- `src/imagePaste.ts` contains a literal NUL byte inside the `sanitizeForFilename` regex character class, so `grep` treats it as binary. Use `grep -a` when searching it.

[Return to Top](#top)

## Model Guidelines

- **Haiku:** mechanical edits (docs, changelog, backlog line removal).
- **Sonnet:** most feature work and all testing milestones.
- **Opus:** complex or ambiguous work and **all front-end UI design** (the popup's look, interaction, CSS). M2 is Opus for that reason.

[Return to Top](#top)

## M1: Command Registry + Matcher

**Model:** Sonnet (pure logic, well specified).

> Workers must complete ALL items. If you think one should be deferred, note it in your summary but still attempt it unless truly blocked.

- [ ] Create `src/webview/slashcommands-registry.ts` with no DOM, no TipTap, no `vscode` imports.
- [ ] Define `SlashCommand { id, title, description, aliases: string[], group: 'basic' | 'lists' | 'callouts' | 'insert', icon: string, keywords?, requiresNoFrontmatter?: boolean }`. The action is NOT in this module; M3 and M6 map `id` → action so the registry stays pure.
- [ ] Add every command from [Design Decisions](#command-set), including H4–H6, Properties (`requiresNoFrontmatter: true`), Date, and Date and time.
- [ ] Export `matchCommands(query: string, ctx: { hasFrontmatter: boolean }, commands = SLASH_COMMANDS): SlashCommand[]` with the ranking: exact name/alias, name prefix, alias prefix, registry order. Empty query returns all, in registry/group order. Commands with `requiresNoFrontmatter` are excluded when `ctx.hasFrontmatter` is true.
- [ ] Export `extractSlashQuery(textBefore: string, atBlockStart: boolean): { offset: number; query: string } | null` implementing the trigger rules on plain text (preceding char must be textblock start or whitespace, anywhere in the line; query is non-whitespace).
- [ ] Export the mermaid starter diagram text as a constant (e.g. a 3-node `flowchart TD`).
- [ ] `npm run lint` clean, `npm run compile` succeeds.
- [ ] Commit.

[Return to Top](#top)

## M2: Trigger/Exit Plugin + Popup UI

**Model:** Opus (front-end UI design plus subtle ProseMirror state).

> Workers must complete ALL items. If you think one should be deferred, note it in your summary but still attempt it unless truly blocked.

**Design craft required.** Apply genuine design craft so the menu feels like a VS Code native quick-pick crossed with Notion's block menu: consistent spacing rhythm, clear hierarchy (title, muted description, right-aligned alias hint), group headers, a leading icon per row, an unmistakable keyboard-focus row (`--vscode-list-activeSelectionBackground` / `--vscode-list-activeSelectionForeground`, with `--vscode-focusBorder` outline), hover distinct from focus, `--vscode-editorWidget-background` / `-border` / `--vscode-widget-shadow`, `--vscode-descriptionForeground` for secondary text, correct in light, dark, high-contrast, and `body.mikedown-force-light`. Match the icon style already used in the toolbar (`icons.*` in `editor-main.ts`). No hard-coded colors without a VS Code token fallback chain.

- [ ] Create `src/webview/slashcommands.ts` exporting a TipTap `SlashCommands` extension, following the `wikilinkautocomplete.ts` plugin pattern named in [Code Findings](#code-findings-that-shape-the-plan).
- [ ] In `view().update`, bail (close) when: disabled by config, source mode active, selection non-empty, the cursor is anywhere inside a `codeBlock` (any language, including `mermaid`; check every ancestor depth, not just `$from.parent`), `code` or `link` mark active at the cursor (check both `$from.marks()` and `storedMarks`, so the boundary just inside backticks is covered), or `extractSlashQuery` returns null.
- [ ] Pass `{ hasFrontmatter }` to `matchCommands` from the current frontmatter state so `/properties` only appears when the doc has none.
- [ ] Keep dismissal state: remember the dismissed `/` document position and do not reopen for it; clear it when that `/` is deleted or a new `/` is typed.
- [ ] Close on: Esc, click-away (document `mousedown` outside the popup), editor blur, Backspace past `/`, whitespace with no matches, cursor leaving `[from, to]`, host `update` message (full-document reload), and entering source mode. None of these may dispatch a transaction.
- [ ] Footer row per [In-menu disable option](#in-menu-disable-option): muted "Turn off slash commands" row with a subtle icon below a divider, smaller secondary text, its own `role="option"` outside the filtered list. Never counted as a match, never the default active row; reachable via ArrowDown past the last command (and ArrowUp wrap) and by click (`mousedown` + `preventDefault`). Choosing it closes the menu without a transaction (`/query` stays) and posts `saveSettings` with `slashCommandsEnabled: false` and `source: 'slashMenu'`. Apply the same design craft: it must read as a quiet utility, not a command.
- [ ] Keyboard: ArrowUp/ArrowDown wrap (through the footer row), Home/End, Enter and Tab execute, Esc closes. Keep the active row scrolled into view. Register with a higher keymap priority than the emoji/wikilink autocompletes and ensure only one popup can be open at a time.
- [ ] Execution API: `executeSlashCommand(id, { from, to })` placeholder that, for M2, handles only H1–H6/Paragraph so the flow is demonstrable. It replaces `/query` in ONE transaction with `closeHistory(tr)` applied (import from `@tiptap/pm/history`) so one undo restores the `/query`.
- [ ] Popup built in `document.body` with `role="listbox"`, `aria-activedescendant`, `role="option"` rows, grouped sections, empty state is not shown (menu closes instead).
- [ ] Position with `view.coordsAtPos(from)`, clamp to viewport, flip above when there is no room below, max height with internal scroll.
- [ ] New `src/webview/slashcommands.css`; register it in the stylesheet list in `markdownEditorProvider.ts`.
- [ ] Expose `setSlashCommandsConfig({ enabled, dateFormat, timeZone })` and `setSlashSourceMode(bool)` (or read the existing `sourceMode` via a setter) for M5 and source-mode wiring. Default: enabled.
- [ ] Register the extension in `editor-main.ts` next to `EmojiAutocomplete` / `WikilinkAutocomplete` (~line 2947). Never touch `editor.view.dom` outside a transaction (commit `f5415e0`).
- [ ] `npm run lint`, `npm run compile`, `npm run test:unit` green (no regressions).
- [ ] Commit.

[Return to Top](#top)

## T1: Tests for M1 + M2

**Model:** Sonnet. **Modes:** unit (vitest, jsdom) and jsdom webview harness.

> Workers must complete ALL items. If you think one should be deferred, note it in your summary but still attempt it unless truly blocked.

- [ ] Write `test/unit/slashcommandsRegistry.test.ts`: every alias from the table finds its command (`/check` → Task list, `/ol` and `/1.` → Numbered, `/---` → Divider, `/[[` → Wikilink, `/:` → Emoji, `/warn` → Warning, `/danger` → Caution, `/h4`/`/heading5`/`/h6` → H4/H5/H6, `/yaml` → Properties, `/today` → Date, `/timestamp` and `/now` → Date and time); ranking (exact before prefix; `/date` ranks Date above Date and time; `/h` lists H1–H6 in order); empty query returns all; unknown query returns `[]`; case-insensitivity; Properties is excluded for every query when `hasFrontmatter` is true and included when false.
- [ ] Write `extractSlashQuery` tests: line start, after space, after tab; `and/or`, `path/to`, `https://a.com/b` return null; mid-line after a space is accepted; whitespace in query returns null.
- [ ] Extend `test/harness/webviewHarness.ts` with WYSIWYG helpers (editor access, type text at cursor through the view so plugins run, press key, place cursor, read last `edit` markdown). Keep `webviewSourceMode.test.ts` green.
- [ ] Write `test/unit/slashcommandsHarness.test.ts` covering: menu opens on `/` at line start and after space; filter narrows as you type; no open inside a plain code block, a ```` ```ts ```` code block, a ```` ```mermaid ```` code block (line start and after a space), inline code (middle and just inside either backtick), link, mid-word; no open in source mode; `/prop` shows Properties in a doc without frontmatter and not in one with frontmatter.
- [ ] Exit tests, each asserting the markdown is byte-identical to before dismissal: Esc, click-away, blur, Backspace past `/`, space with no matches, arrow-key cursor out of range; after Esc, typing another character does not reopen.
- [ ] Insertion tests for H1–H6/Paragraph at line start, then Cmd+Z (history undo) restores `/h2` exactly in one step.
- [ ] Footer row tests: it is never in the filtered match list for any query; it is not the active row on open or after typing; Enter on a filtered query (e.g. `/h`, `/tur`, `/off`) never selects it; ArrowDown past the last command reaches it; choosing it (keyboard and click) closes the menu, leaves the markdown byte-identical, and posts `saveSettings` with `slashCommandsEnabled: false` and `source: 'slashMenu'`.
- [ ] Run `npm run test:unit` green.
- [ ] Run `npm run lint` green.
- [ ] Commit tests.

[Return to Top](#top)

## M3: Wire Existing-Block Commands

**Model:** Sonnet.

> Workers must complete ALL items. If you think one should be deferred, note it in your summary but still attempt it unless truly blocked.

- [ ] Map every registry `id` to an action in `slashcommands.ts` (or a sibling `slashcommands-actions.ts`), all via `editor.chain()` or `view.dispatch(tr)`.
- [ ] Implement the mid-line insert-below rule from [Trigger rules](#trigger-rules) as a shared helper used by every block command (empty line → convert in place; non-empty line → strip `/query`, insert the block after the current block, cursor into it).
- [ ] Headings H1–H6, paragraph, quote, bullet, numbered, task list.
- [ ] Divider (`setHorizontalRule`), serializes as `---`.
- [ ] Callouts: `note`, `tip`, `important`, `warning`, `caution` via `setCallout(kind)`; serializes as `> [!NOTE]` etc.
- [ ] Code block: create the block, then open `showLanguagePicker` anchored at the block (rect from `coordsAtPos`).
- [ ] Mermaid: code block with `language: 'mermaid'` pre-filled with the M1 starter text, cursor inside; renders if `renderMermaidDiagrams` is on.
- [ ] Table: open `showTableGridPicker`. Add a rect/point option to it (preferred) or use a transient anchor in `document.body`; commit inserts the table.
- [ ] Link: open `showLinkDialog(editor)`; the link text is empty-selection behavior of that dialog, verify it inserts a usable link.
- [ ] Wikilink: replace `/query` with `[[` and confirm `wikilinkautocomplete.ts` opens its popup on the next view update.
- [ ] Emoji: open `showEmojiPicker(editor, { anchorRect })` at the cursor.
- [ ] Picker-based commands keep `/query` until the picker commits; cancel leaves it intact (resolved 2026-09-26, Open Question 3).
- [ ] Every action goes through one `closeHistory`'d transaction for the text replacement.
- [ ] `npm run lint`, `npm run compile`, `npm run test:unit` green.
- [ ] Commit.

[Return to Top](#top)

## M4: Image File Picker

**Model:** Sonnet.

> Workers must complete ALL items. If you think one should be deferred, note it in your summary but still attempt it unless truly blocked.

- [ ] Webview → host: `{ type: 'pickImage', requestId: string }`. Host → webview: `{ type: 'pickedImageResult', requestId, insertPath?, webviewUri?, alt?, cancelled?: true, error?: string }`.
- [ ] Document both messages in the protocol comment at the top of `src/webview/editor-main.ts` (and add the missing `savePastedImage` / `pastedImageResult` pair while there).
- [ ] Add `'pickImage'` to the `WebviewMessage['type']` union in `markdownEditorProvider.ts`.
- [ ] Host handler: `vscode.window.showOpenDialog({ canSelectMany: false, filters: { Images: [png, jpg, jpeg, gif, webp, svg, bmp, avif] }, defaultUri: doc folder })`. Untitled/non-`file:` docs get the same "save first" prompt the paste path uses.
- [ ] Compute `insertPath` with `formatInsertPath(absPath, docPath, workspaceRoot, settings.imagePaste.pathStyle)`, `alt` with `resolveAltText`, `webviewUri` with `webview.asWebviewUri`. Extract any shared logic out of `handleSavePastedImage` rather than duplicating it.
- [ ] Files outside the doc folder and workspace folders (i.e. outside `localResourceRoots`) are copied into the image-paste target folder via the existing `resolveTargetFolder` + `resolveFilename` path (dedupe by hash as paste does) so they render and are portable (resolved 2026-09-26, Open Question 4). Files inside are referenced in place.
- [ ] Webview: `src/webview/imagepick.ts` with `requestImagePick(view, from, to)` using a pending-by-`requestId` map like `imagepaste.ts`; on result, replace `/query` with an image node (`src` = `webviewUri`, markdown serializes to `insertPath`); cancel/error leaves `/query` intact.
- [ ] Route `pickedImageResult` in the webview message handler next to `pastedImageResult` (~line 5066).
- [ ] Put pure path logic in `src/imagePaste.ts` (with `imagePaste.test.ts` coverage) so the host handler stays thin.
- [ ] `npm run lint`, `npm run compile`, `npm run test:unit` green.
- [ ] Commit.

[Return to Top](#top)

## M5: Settings

**Model:** Sonnet.

> Workers must complete ALL items. If you think one should be deferred, note it in your summary but still attempt it unless truly blocked.

- [ ] `package.json#contributes.configuration.properties` (see [Settings](#settings)): `mikedown.slashCommands.enabled` (boolean, default `true`); `mikedown.slashCommands.dateFormat` (enum `iso` | `long`, default `iso`, with `enumDescriptions` showing `2026-09-26` / `September 26, 2026`); `mikedown.slashCommands.timeZone` (string, default `"local"`, description: `"local"`, `"UTC"`, or an IANA zone name like `America/New_York`). No trigger setting.
- [ ] `src/settings.ts`: add a `slashCommands: { enabled, dateFormat, timeZone }` group and reader (unknown `dateFormat` → `iso`; empty `timeZone` → `local`).
- [ ] Host broadcast (~line 1168 of `markdownEditorProvider.ts`): add `slashCommandsEnabled`, `slashCommandsDateFormat`, `slashCommandsTimeZone`.
- [ ] Host `saveSettings` (~line 819): persist all three with `ConfigurationTarget.Global`.
- [ ] Settings modal **Behavior** tab: add a "Slash commands" subheading, then a `makeCheckboxRow` "Slash command menu", a select "Date format" (ISO / Long), and a text input "Time zone" with placeholder "local, UTC, or e.g. America/New_York". The select and text input are `disabled` (greyed) while the checkbox is unticked, toggling live on checkbox `change`. Include all three in the save payload and update the `current*` module vars like the existing mermaid field does.
- [ ] Webview `settings` handler (~line 4671): call `setSlashCommandsConfig({ enabled, dateFormat, timeZone })`; if disabling while the menu is open, close it (no doc change).
- [ ] Placeholder per [Placeholder](#placeholder): "Type / for commands…" when enabled, "Start writing…" when disabled, updated live from the `settings` handler via a no-op transaction.
- [ ] Footer-row notification per [In-menu disable option](#in-menu-disable-option): when `saveSettings` arrives with `source: 'slashMenu'`, after persisting, show the information message with **Open Settings** and **Undo**. Open Settings posts `{ type: 'command', command: 'openSettings', tab: 'behavior' }` to the originating panel; Undo sets `enabled = true` (Global). Dismissing the notification does nothing.
- [ ] Webview: handle `command: 'openSettings'` by calling `showSettingsModal` opened on the requested tab (add an initial-tab parameter if it lacks one).
- [ ] Add `source` to the `saveSettings` shape and document `openSettings` + `tab` in the protocol comment at the top of `src/webview/editor-main.ts` (and the `WebviewMessage` type in `markdownEditorProvider.ts` if needed).
- [ ] Verify the live toggle: change each setting in VS Code's settings UI and in the modal with an editor open; no reload needed.
- [ ] `npm run lint`, `npm run compile`, `npm run test:unit` green.
- [ ] Commit.

[Return to Top](#top)

## M6: Properties, Date, Datetime

**Model:** Sonnet. Included (decided 2026-09-26). Runs after M3 (action map) and M5 (settings), before T2.

> Workers must complete ALL items. If you think one should be deferred, note it in your summary but still attempt it unless truly blocked.

- [ ] Create `src/webview/slashcommands-date.ts` per [Date and time formatting](#date-and-time-formatting): pure, no DOM, no TipTap, clock injected. `resolveTimeZone` validates via `Intl.DateTimeFormat`; `"local"`/empty → undefined; `"UTC"` and valid IANA names pass through; invalid → undefined plus one `console.warn` per bad value.
- [ ] Write `test/unit/slashcommandsDate.test.ts` with a fixed injected `Date`: ISO and long for `/date`; ISO and long for `/datetime`; local (no label), `UTC` (`… 18:30 UTC`), and `America/New_York` (`… 14:30 EDT` in September, `EST` in January); invalid zone falls back to local and warns once; day rollover (e.g. `2026-09-26T02:30Z` gives `2026-09-25` in `America/New_York` and `2026-09-26` in `UTC`, and `2026-09-26T23:30Z` gives `2026-09-27` in `Asia/Tokyo`); `HH:mm` zero-padding and 24-hour (`00:05`, `23:59`). Run tests with `TZ=UTC` pinned (vitest config env or setup) so "local" results are deterministic.
- [ ] Date action: insert `formatSlashDate(new Date(), { format, timeZone, includeTime: false })` inline as plain text, replacing `/query` in one `closeHistory`'d transaction.
- [ ] Datetime action: same with `includeTime: true`.
- [ ] Properties action (only reachable when the doc has no frontmatter, per M1/M2 filtering): remove `/query` and insert an empty frontmatter block using the existing `serializeFrontmatter` / sidebar Properties path, then focus the Properties section. One undo removes the frontmatter and restores `/query`.
- [ ] Harness tests: `/date` and `/datetime` insert the expected text for a stubbed clock and each `dateFormat`/`timeZone` combo sent via a `settings` message; `/properties` round-trips to an empty frontmatter block (whatever `serializeFrontmatter` emits for no keys) at the top of the doc; `/prop` is not offered once frontmatter exists; one undo restores `/query` for all three.
- [ ] `npm run lint`, `npm run compile`, `npm run test:unit` green.
- [ ] Commit.

[Return to Top](#top)

## T2: Tests, Integration, Hands-On Sign-Off

**Model:** Sonnet. **Modes:** unit (vitest), jsdom harness, integration (`@vscode/test-electron`), hands-on Extension Development Host.

> Workers must complete ALL items. If you think one should be deferred, note it in your summary but still attempt it unless truly blocked.

### Automated

- [ ] Write round-trip tests (harness): for every command, insert at line start and mid-line, then assert the emitted `edit` markdown exactly (`# `, `## `, `### `, `#### `, `##### `, `###### `, `> `, `- `, `1. `, `- [ ] `, fenced code, ```` ```mermaid ````, `---`, `> [!NOTE]`/`[!TIP]`/`[!IMPORTANT]`/`[!WARNING]`/`[!CAUTION]`, table, link, `[[`, emoji, `![alt](path)`, frontmatter, date, datetime) and that re-loading that markdown via `update` then re-serializing is stable.
- [ ] Write mid-line insert-below tests: `foo /h2|` gives paragraph `foo` + empty H2 below; `foo /table|bar` gives paragraph `foo bar` (text intact, `/table` removed) + table below; `foo /emoji|` inserts inline.
- [ ] Write undo tests: one history undo after each command restores the `/query` text exactly.
- [ ] Write picker-cancel tests: code language, table, link, emoji, image cancel leave `/query` intact.
- [ ] Write settings live-toggle tests (harness): send a `settings` message with `slashCommandsEnabled: false` and assert `/` no longer opens; sending `true` again reopens it on the next `/`.
- [ ] Write placeholder tests (harness): an empty doc shows "Type / for commands…" by default; a `settings` message with `slashCommandsEnabled: false` switches it to "Start writing…" without reload; `true` switches it back.
- [ ] Write code-block guard tests (harness, full bundle): typing `/` and ` /` inside a fenced code block, a `mermaid` code block, and inline code never opens the menu and leaves the markdown exactly as typed.
- [ ] Write Settings modal tests (harness): the Behavior tab has a "Slash commands" subsection with the checkbox, Date format select, and Time zone input (placeholder "local, UTC, or e.g. America/New_York"); unticking the checkbox disables the select and input; Save posts `saveSettings` with all three values.
- [ ] Write footer-row flow tests (harness): choosing the footer row leaves the `/query` text intact and posts `saveSettings` with `slashCommandsEnabled: false`, `source: 'slashMenu'`; a `command` message `openSettings` with `tab: 'behavior'` opens the Settings modal on the Behavior tab.
- [ ] Write image message tests (harness): `pickImage` posted with a `requestId`; replying `pickedImageResult` inserts the image and serializes to `insertPath`; `cancelled` leaves text.
- [ ] Write integration tests in `test/integration/` (new `slashCommands.test.ts`): `mikedown.slashCommands.enabled` (default `true`), `.dateFormat` (default `iso`, enum `iso`/`long`), and `.timeZone` (default `"local"`) are registered and no `trigger` setting exists; a `saveSettings` with new `dateFormat`/`timeZone` values persists them; updating it via `getConfiguration().update` is readable back; a `saveSettings` with `source: 'slashMenu'` persists `enabled: false` and shows the notification (stub `showInformationMessage`); resolving the stub with "Undo" restores `enabled: true`; resolving it with "Open Settings" posts `openSettings` with `tab: 'behavior'` to the panel; the image picker host handler returns a relative path for a file in a private fixture folder, and copies a file from outside the workspace (e.g. `os.tmpdir()`) into the image-paste folder and returns that relative path (stub `showOpenDialog`). Mutating tests use a private fixture with teardown, never `test/workspace/sample.md`.
- [ ] Run `npm run test:unit` green.
- [ ] Run `npm run test:integration` green.
- [ ] Run `npm run test:edge` and `npm run lint` green.
- [ ] Commit tests.

### Hands-on pass (orchestrator pauses for Mike's sign-off)

Start: open the repo in VS Code, run `npm run compile`, press **F5** (Extension Development Host). After later code changes, `npm run compile` then **Cmd+R** in the dev host. Create `scratch-slash.md` in the dev host workspace and open it with MikeDown.

- [ ] 0. Open the new empty `scratch-slash.md`. Expected: placeholder reads "Type / for commands…".
- [ ] 1. Empty line, type `/`. Expected: menu opens under the cursor, grouped, first row focused, readable in the current theme.
- [ ] 2. Type `che`. Expected: Task list is the top (only) match. Enter. Expected: an empty task item; Cmd+Z returns `/che`.
- [ ] 3. Type `and/or` and `path/to/file`. Expected: menu never opens.
- [ ] 4. Inside a fenced code block, inside a ```` ```mermaid ```` block (edit mode), and inside inline code, type `/` at the start of a line and ` /` mid-line. Expected: no menu anywhere; the text is exactly as typed.
- [ ] 5. Type `/h2`, press Esc. Expected: menu closes, `/h2` stays; typing `x` does not reopen.
- [ ] 6. Type `/tab`, click elsewhere in the doc. Expected: closes, text intact.
- [ ] 7. Type `/zz ` (space). Expected: closes, text `/zz ` intact.
- [ ] 8. Type `/h`, Backspace twice. Expected: closes when `/` is removed.
- [ ] 9. On a line `hello world`, place cursor after `hello `, type `/quote`, Enter. Expected: `hello` paragraph, then a quote containing `world`.
- [ ] 10. `/note`, `/tip`, `/important`, `/warn`, `/danger`. Expected: each callout renders with the right style; Cmd+/ source shows `> [!NOTE]` etc.
- [ ] 11. `/code`. Expected: code block plus language picker; pick `ts`. Esc on a second attempt leaves `/code` in place.
- [ ] 12. `/mermaid`. Expected: rendered starter diagram (if rendering enabled).
- [ ] 13. `/table`. Expected: grid picker near the cursor; pick 3x3; table inserted.
- [ ] 14. `/link`, `/wikilink`, `/emoji`. Expected: link dialog; wikilink autocomplete popup after `[[`; emoji picker at the cursor.
- [ ] 15. `/image`, choose a PNG in the workspace. Expected: image renders; source shows a relative path. Repeat with Cancel: `/image` stays.
- [ ] 16. Cmd+/ into source mode, type `/`. Expected: no menu.
- [ ] 17. Gear → Behavior: untick "Slash command menu", Save. Expected: `/` no longer opens, no reload. Re-enable. Expected: `/` at line start and ` /` mid-line both open again.
- [ ] 18. Type `/`. Expected: a muted "Turn off slash commands" footer row below a divider, visually quieter than the commands, not focused. Type `/h` and press Enter. Expected: a heading is inserted, never the footer.
- [ ] 19. Type `/tu`, ArrowDown past the last match to the footer row, Enter. Expected: menu closes, `/tu` stays in the doc, and a VS Code notification reads "Slash commands are turned off. You can turn them back on in MikeDown Settings → Behavior." with Open Settings and Undo. Click **Open Settings**. Expected: the in-editor Settings modal opens on the Behavior tab with "Slash command menu" unticked; tick it and Save; `/` opens again.
- [ ] 20. Type `/`, click the footer row. Expected: same notification. Click **Undo**. Expected: `/` opens the menu again with no reload, and the Behavior checkbox is ticked.
- [ ] 21. Toggle theme (toolbar theme button) light/dark. Expected: menu colors, focus row, footer row, and borders are correct in both.
- [ ] 22. `/h4`, `/h5`, `/h6`. Expected: headings of each level; source shows `####`, `#####`, `######`.
- [ ] 23. In a doc with no frontmatter, `/prop`, Enter. Expected: empty frontmatter added and the sidebar Properties section focused; `/query` gone. Type `/prop` again. Expected: Properties is no longer offered.
- [ ] 24. `/date`, Enter. Expected: today in ISO (`2026-09-26`). `/now`, Enter. Expected: `2026-09-26 HH:mm` local, no zone label.
- [ ] 25. Gear → Behavior → Slash commands: Date format Long, Time zone `UTC`, Save. `/date` and `/datetime`. Expected: `September 26, 2026` and `September 26, 2026 HH:mm UTC`. Set Time zone `America/New_York`. Expected: `/datetime` ends in `EDT`/`EST`. Set Time zone `Not/AZone`. Expected: falls back to local (no label), warning in webview dev tools console.
- [ ] 26. Gear → Behavior: untick "Slash command menu". Expected: Date format and Time zone controls grey out immediately; Save; on an empty doc the placeholder reads "Start writing…" with no reload. Re-tick, Save. Expected: placeholder back to "Type / for commands…".
- [ ] 27. `/image`, choose a PNG outside the workspace (e.g. `~/Desktop`). Expected: it is copied into the image-paste folder, renders, and source shows a relative path to the copy.
- [ ] 28. Save the file, reopen it. Expected: all inserted blocks reload identically.
- [ ] Mike signs off (record in Progress Log).

[Return to Top](#top)

## M7: Docs

**Model:** Haiku (mechanical).

> Workers must complete ALL items. If you think one should be deferred, note it in your summary but still attempt it unless truly blocked.

- [ ] `CHANGELOG.md`: add an `## [Unreleased]` section (above 2.10.4) with an `### Added` entry for the slash command menu, the `/image` file picker, the in-menu "Turn off slash commands" option, `/properties`, `/date`, `/datetime`, the "Type / for commands…" placeholder, and the `mikedown.slashCommands.enabled`, `.dateFormat`, and `.timeZone` settings.
- [ ] `README.md`: add a short slash-commands feature mention and list the `mikedown.slashCommands.enabled`, `.dateFormat`, and `.timeZone` settings where other settings are documented.
- [ ] `BACKLOG.md`: remove the "Slash commands" line from Nice-to-have.
- [ ] Escape `$` as `\$` and keep blank lines around lists (MD032).
- [ ] Commit.

[Return to Top](#top)

## Open Questions

1. **Properties and Date:** ✅ Resolved 2026-09-26: both included (M6); `/properties` only offered when the doc has no frontmatter. Date format is configurable via `mikedown.slashCommands.dateFormat` (`iso` default, or `long`). Also added `/datetime` (aliases `timestamp`, `now`) and `mikedown.slashCommands.timeZone` (`local` default, `UTC`, or IANA name).
2. **H4 to H6:** ✅ Resolved 2026-09-26: included (`/h4`, `/h5`, `/h6`, aliases `heading4`–`heading6`).
3. **Picker cancel:** ✅ Resolved 2026-09-26: cancelling the follow-up picker leaves `/query` in the document.
4. **Images outside the doc folder/workspace:** ✅ Resolved 2026-09-26: copied into the image-paste folder.
5. **Placeholder hint:** ✅ Resolved 2026-09-26: "Type / for commands…" while slash commands are enabled, "Start writing…" when disabled, switching live (M5).
6. **Mid-line behavior:** ✅ Resolved 2026-09-25: no split. Block commands on a non-empty line insert the block on the next line; inline commands insert inline.
7. **Trigger setting and disabling:** ✅ Resolved 2026-09-25: no `trigger` setting; `/` triggers at textblock start or after whitespace anywhere in the line. Only `mikedown.slashCommands.enabled` remains, plus an in-menu "Turn off slash commands" footer row with an Open Settings / Undo notification.

[Return to Top](#top)

## Parallel Development Recommendations

- **Group A (start together):** M1 (registry, new file only) and M4 host half (`markdownEditorProvider.ts` handler, `src/imagePaste.ts` helpers, protocol comment). No shared files.
- **Sequential:** M1 → M2 → T1 → M3. M2 needs the registry; M3 needs the plugin's execution API.
- **Group B (after M2):** M3 and M5 can run in parallel. Both touch `editor-main.ts`; M5 owns the settings modal and `settings` handler, M3 owns nothing in `editor-main.ts` except possibly a `showLinkDialog` export. Coordinate on `editor-main.ts` merge.
- **M4 webview half** (`imagepick.ts`, image action, `pickedImageResult` routing) waits for M3's action map.
- **M6:** the pure date helper and its tests (`slashcommands-date.ts`, `slashcommandsDate.test.ts`) have no dependencies and can start in Group A. The M6 actions wait for M3 (action map) and M5 (settings).
- **T2** waits for M3, M4, M5, M6. M7 is last.
- If the orchestrator context fills up, the user should run `/compact` and resume from `.orchestrator/state.json`.

[Return to Top](#top)

## Gap-Filling Prompt Guidance

When a worker's summary shows unfinished items, the orchestrator writes a gap-fill prompt with the same structure as the original milestone prompt, labeled:

**Worker Context: [Milestone Name] - Gap Fill**

Each gap-fill prompt must include:

- The planning doc path (`slash-commands-planning.md`) and the milestone section to read.
- Completed work so far: which checkboxes are done, and the list of files the original worker modified (from its summary and `git log`).
- Only the remaining unchecked items, restated, plus any failures or deferrals the worker reported.
- Other active workers and the files/directories they own, so this worker avoids them.
- The standing constraints: no DOM mutation outside PM transactions (`f5415e0`), three-place settings rule, private fixtures for mutating integration tests, the recommended model.
- Completion steps:
  - [ ] Run the milestone's test commands green.
  - [ ] Commit code (no AI attribution in messages).
  - [ ] Write the summary to `.orchestrator/worker-summary-[milestone-slug]-gap.md`.
  - [ ] Prompt the user to close or clear this context.

[Return to Top](#top)

## Progress Log / Notes

**2026-09-26 00:06** - Mike resolved Open Questions 1 to 5. Properties and Date are in (M6 no longer optional, now runs before T2; `/properties` only when the doc has no frontmatter). Added `/h4`–`/h6`, `/datetime` (aliases `timestamp`, `now`; `now` moved off `/date`), and two settings, `mikedown.slashCommands.dateFormat` (`iso` | `long`) and `.timeZone` (`local` | `UTC` | IANA, validated, invalid falls back to local), in a "Slash commands" subsection of the Behavior tab that greys out when disabled. Date/time formatting is a pure, clock-injected helper (`slashcommands-date.ts`). Picker cancel keeps `/query`; outside images are copied into the image-paste folder; placeholder is "Type / for commands…" when enabled, "Start writing…" when disabled (M5). Reaffirmed no menu in code blocks (including mermaid) or inline code. Updated Summary, command table, new [Date and time formatting](#date-and-time-formatting) and [Placeholder](#placeholder), [Trigger rules](#trigger-rules), [Settings](#settings), M1, M2, T1, M3, M4, M5, M6, T2 (tests and hands-on steps 0, 4, 22 to 28), M7, tracker, parallel groups, and Open Questions.

**2026-09-25 23:56** - Mike dropped the `mikedown.slashCommands.trigger` setting (`/` now always triggers at textblock start or after whitespace, never mid-word) and kept only `mikedown.slashCommands.enabled` (default true, three places, live toggle). Added an in-menu "Turn off slash commands" footer row (never matched by filtering) that saves `enabled: false`, leaves `/query` intact, and triggers a host notification with Open Settings (Behavior tab) and Undo. Updated Summary, [Trigger rules](#trigger-rules), [Settings](#settings), new [In-menu disable option](#in-menu-disable-option), M1, M2, T1, M5, T2 (tests and hands-on steps 17 to 22), M7, and Open Question 7.

**2026-09-25 23:55** - Mike decided mid-line block commands insert the block on the next line instead of splitting the paragraph. Updated [Trigger rules](#trigger-rules), M3, T2 tests, and Open Question 6.

**2026-09-25 23:43** - Plan created. Decisions baked in: full command set with aliases (Properties/Date deferred to M6 pending Mike); trigger at line start or after whitespace, never in code, inline code, links, mid-word, or source mode; mid-line insertion splits the paragraph; dismissal (Esc, click-away, Backspace past `/`, no-match space, cursor out of range) never changes text; one undo restores `/query`; settings `mikedown.slashCommands.enabled` (default true) and `.trigger` (`lineStart` | `anywhere`, default `anywhere`) in the Behavior tab with live toggle; popup follows the `wikilinkautocomplete.ts` plugin pattern; pure registry in `slashcommands-registry.ts`; `/image` uses a new host `showOpenDialog` picker with a `pickImage` / `pickedImageResult` message pair.

[Return to Top](#top)
