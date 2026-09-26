# Slash Commands Planning

<a id="top"></a>

## Summary

**Purpose.** Add a Notion-style slash command menu to the MikeDown WYSIWYG editor. Typing `/` opens a filterable popup at the cursor; choosing an item inserts that block in place of the typed `/query`. This ships the BACKLOG.md item "Slash commands — `/` menu for inserting blocks (Notion-style)".

**Objectives.**

- A pure, unit-tested command registry and matcher (name prefix + alias matching).
- A ProseMirror plugin that opens the menu only in the right places (line start or after whitespace; never in code, links, mid-word, or source mode) and exits gracefully without ever deleting typed text.
- A popup that looks and feels native to VS Code and as polished as Notion's menu, in light and dark themes.
- Every command inserts a block that serializes to clean markdown and undoes in one step back to the `/query` text.
- Two new settings wired in all three places (package.json, `src/settings.ts`, Settings modal) with a live toggle.
- A new host-side image file picker reachable from `/image`.

**Success factors.**

- `and/or`, `path/to`, `https://x.com/a/b`, code, and inline code never trigger the menu.
- Esc, click-away, Backspace past `/`, a no-match space, or moving the cursor out of range all close the menu with the document byte-for-byte unchanged.
- Enter on any command produces the expected markdown (round-trip tested) and Cmd+Z restores the exact `/query` text.
- Toggling `mikedown.slashCommands.enabled` or `.trigger` takes effect in an open editor without reload.
- `npm run test:unit`, `npm run test:integration`, and `npm run lint` are green, and Mike signs off on the hands-on pass.

## Milestone Progress Tracker

| Milestone | Model | Status | Duration (min) | Notes |
| --- | --- | --- | --- | --- |
| M1: Command registry + matcher | Sonnet | ⬜ | | Pure module, no DOM |
| M2: Trigger/exit plugin + popup UI | Opus | ⬜ | | Front-end design craft required |
| T1: Tests for M1 + M2 | Sonnet | ⬜ | | Unit + jsdom harness |
| M3: Wire existing-block commands | Sonnet | ⬜ | | Mid-line insert-below, callouts, pickers |
| M4: Image file picker (host) | Sonnet | ⬜ | | New message pair |
| M5: Settings (three places, live toggle) | Sonnet | ⬜ | | Behavior tab |
| T2: Tests, integration, hands-on sign-off | Sonnet | ⬜ | | Pauses for Mike |
| M6: Optional Properties + Date | Sonnet | ⬜ | | Blocked on Open Question 1 |
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
- [T2: Tests, Integration, Hands-On Sign-Off](#t2-tests-integration-hands-on-sign-off)
- [M6: Optional Properties + Date](#m6-optional-properties--date)
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
| Properties (maybe) | `properties` | `frontmatter`, `yaml` | M6, pending Open Question 1 |
| Date (maybe) | `date` | `today`, `now` | M6, pending Open Question 1 |

Because aliases include `1.`, ```` ``` ````, `---`, `[[` and `:`, the query character set is "any non-whitespace", not just `\w`.

### Trigger rules

- Opens when `/` is typed at the start of a textblock, or (when `trigger = anywhere`) immediately after whitespace. `trigger = lineStart` restricts to textblock start only.
- Never inside a `codeBlock` node, an inline `code` mark, a `link` mark, a wikilink, or directly after a non-whitespace character (so `and/or`, `path/to`, and URLs never trigger).
- Never in source mode (CodeMirror). The plugin also stays closed if the selection is non-empty.
- Mid-line insertion (decided 2026-09-25): if the `/query` is the only content of its textblock, convert that block in place. Otherwise remove `/query`, leave the current line's text untouched (no split), and insert the new block **immediately after the current block**, with the cursor placed inside it. Inline commands (link, wikilink, emoji, date) insert inline at the cursor instead.

### Graceful exit

- Esc, click-away (mousedown outside the popup), editor blur, Backspace past the `/`, typing whitespace when the query has no matches (queries never contain whitespace, so any whitespace closes), and the cursor leaving the `[from, to]` range all close the menu.
- Dismissal never mutates the document. The plugin remembers the dismissed `/` position so the menu does not reopen on the next keystroke until a new `/` is typed.
- Insertion runs as one transaction with `closeHistory` applied first, so one Cmd+Z restores the exact `/query` text (the typing and the insertion must not merge into one history group, even when Enter is hit inside ProseMirror's 500 ms group window).
- Commands that open a follow-up picker (code language, table, link, emoji, image) remove `/query` only when the picker commits. Cancelling the picker leaves `/query` intact. (Confirm via Open Question 3.)

### Settings

- `mikedown.slashCommands.enabled`: boolean, default `true`.
- `mikedown.slashCommands.trigger`: `"lineStart"` | `"anywhere"`, default `"anywhere"` ("anywhere" still requires preceding whitespace).
- No dedicated tab. Both go in the Settings modal's **Behavior** tab (`behaviorPanel` in `showSettingsModal`, currently holding default editor, auto-reload, link click, wikilink create, theme scope, and heading rename). Behavior is the right fit: this is an editing interaction, not markdown output (Markdown tab) or looks (Appearance).
- The settings broadcast toggles behavior live, no reload.

[Return to Top](#top)

## Code Findings That Shape the Plan

- **Popup pattern to follow:** `src/webview/wikilinkautocomplete.ts` (and its twin `emojiautocomplete.ts`). It is a TipTap `Extension` whose `addProseMirrorPlugins()` returns one `Plugin` with a `view()` whose `update(view)` re-derives the query from `$from.parent.textBetween(...)` before the cursor, a module-level `PopupState { from, to, query, matches, activeIndex }`, a popup element appended to `document.body` (never inside PM's DOM), `positionPopup(view, from)` using `view.coordsAtPos` with viewport clamping and flip-above, `mousedown` + `preventDefault` on items so the editor keeps focus, and `props.handleKeyDown` for ArrowUp/ArrowDown/Enter/Tab/Escape. Selection uses `view.state.tr.replaceWith(from, to, ...)` + `dispatch` (a proper transaction).
- **Gaps in that pattern the slash menu must fix:** neither existing autocomplete has click-away or blur handling, and Esc only hides the popup; the next transaction re-derives the match and reopens it. The slash plugin needs a remembered "dismissed at `from`" and a document `mousedown` listener (cleaned up in `destroy()`).
- **Table picker needs an anchor element.** `showTableGridPicker(editor, anchorEl: HTMLElement)` takes an element, not a rect. The language picker (`anchorRect` / `point`) and emoji picker (`anchorRect`) already accept rects. M3 must either add a rect/point option to `showTableGridPicker` or use a transient invisible anchor in `document.body` (never in `editor.view.dom`).
- **Existing entry points to reuse:** `showLinkDialog(editor)` (editor-main.ts ~line 359), `showLanguagePicker(editor, { anchorRect | point, allLanguages, currentLanguage, onClosed })`, `showEmojiPicker(editor, { anchorRect })`, `showTableGridPicker`, callout commands `setCallout(kind)` / `toggleCallout(kind)` with `CALLOUT_KINDS` exported from `callout-node.ts`, `setMermaidEnabled` in `mermaid.ts`.
- **Image insertion today:** paste goes webview `savePastedImage` → host `handleSavePastedImage` → `pastedImageResult` with `requestId`. The host already has `formatInsertPath(absPath, docPath, workspaceRoot, pathStyle)` and `resolveAltText` in `src/imagePaste.ts`, and `webview.asWebviewUri`. `localResourceRoots` only covers the extension dirs, the doc's folder, and workspace folders, so an image picked from outside those will not render (Open Question 4).
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
- [ ] Define `SlashCommand { id, title, description, aliases: string[], group: 'basic' | 'lists' | 'callouts' | 'insert' | 'maybe', icon: string, keywords? }`. The action is NOT in this module; M3 maps `id` → action so the registry stays pure.
- [ ] Add every command from [Design Decisions](#command-set) except Properties/Date (those are added in M6 behind a flag).
- [ ] Export `matchCommands(query: string, commands = SLASH_COMMANDS): SlashCommand[]` with the ranking: exact name/alias, name prefix, alias prefix, registry order. Empty query returns all, in registry/group order.
- [ ] Export `extractSlashQuery(textBefore: string, atBlockStart: boolean, mode: 'lineStart' | 'anywhere'): { offset: number; query: string } | null` implementing the trigger rules on plain text (preceding char must be start or whitespace; query is non-whitespace; `lineStart` requires the `/` at offset 0 of the textblock).
- [ ] Export the mermaid starter diagram text as a constant (e.g. a 3-node `flowchart TD`).
- [ ] `npm run lint` clean, `npm run compile` succeeds.
- [ ] Commit.

[Return to Top](#top)

## M2: Trigger/Exit Plugin + Popup UI

**Model:** Opus (front-end UI design plus subtle ProseMirror state).

> Workers must complete ALL items. If you think one should be deferred, note it in your summary but still attempt it unless truly blocked.

**Design craft required.** Apply genuine design craft so the menu feels like a VS Code native quick-pick crossed with Notion's block menu: consistent spacing rhythm, clear hierarchy (title, muted description, right-aligned alias hint), group headers, a leading icon per row, an unmistakable keyboard-focus row (`--vscode-list-activeSelectionBackground` / `--vscode-list-activeSelectionForeground`, with `--vscode-focusBorder` outline), hover distinct from focus, `--vscode-editorWidget-background` / `-border` / `--vscode-widget-shadow`, `--vscode-descriptionForeground` for secondary text, correct in light, dark, high-contrast, and `body.mikedown-force-light`. Match the icon style already used in the toolbar (`icons.*` in `editor-main.ts`). No hard-coded colors without a VS Code token fallback chain.

- [ ] Create `src/webview/slashcommands.ts` exporting a TipTap `SlashCommands` extension, following the `wikilinkautocomplete.ts` plugin pattern named in [Code Findings](#code-findings-that-shape-the-plan).
- [ ] In `view().update`, bail (close) when: disabled by config, source mode active, selection non-empty, parent is `codeBlock`, `code` or `link` mark active at the cursor, or `extractSlashQuery` returns null.
- [ ] Keep dismissal state: remember the dismissed `/` document position and do not reopen for it; clear it when that `/` is deleted or a new `/` is typed.
- [ ] Close on: Esc, click-away (document `mousedown` outside the popup), editor blur, Backspace past `/`, whitespace with no matches, cursor leaving `[from, to]`, host `update` message (full-document reload), and entering source mode. None of these may dispatch a transaction.
- [ ] Keyboard: ArrowUp/ArrowDown wrap, Home/End, Enter and Tab execute, Esc closes. Keep the active row scrolled into view. Register with a higher keymap priority than the emoji/wikilink autocompletes and ensure only one popup can be open at a time.
- [ ] Execution API: `executeSlashCommand(id, { from, to })` placeholder that, for M2, handles only H1/H2/H3/Paragraph so the flow is demonstrable. It replaces `/query` in ONE transaction with `closeHistory(tr)` applied (import from `@tiptap/pm/history`) so one undo restores the `/query`.
- [ ] Popup built in `document.body` with `role="listbox"`, `aria-activedescendant`, `role="option"` rows, grouped sections, empty state is not shown (menu closes instead).
- [ ] Position with `view.coordsAtPos(from)`, clamp to viewport, flip above when there is no room below, max height with internal scroll.
- [ ] New `src/webview/slashcommands.css`; register it in the stylesheet list in `markdownEditorProvider.ts`.
- [ ] Expose `setSlashCommandsConfig({ enabled, trigger })` and `setSlashSourceMode(bool)` (or read the existing `sourceMode` via a setter) for M5 and source-mode wiring. Defaults: enabled, `anywhere`.
- [ ] Register the extension in `editor-main.ts` next to `EmojiAutocomplete` / `WikilinkAutocomplete` (~line 2947). Never touch `editor.view.dom` outside a transaction (commit `f5415e0`).
- [ ] `npm run lint`, `npm run compile`, `npm run test:unit` green (no regressions).
- [ ] Commit.

[Return to Top](#top)

## T1: Tests for M1 + M2

**Model:** Sonnet. **Modes:** unit (vitest, jsdom) and jsdom webview harness.

> Workers must complete ALL items. If you think one should be deferred, note it in your summary but still attempt it unless truly blocked.

- [ ] Write `test/unit/slashcommandsRegistry.test.ts`: every alias from the table finds its command (`/check` → Task list, `/ol` and `/1.` → Numbered, `/---` → Divider, `/[[` → Wikilink, `/:` → Emoji, `/warn` → Warning, `/danger` → Caution); ranking (exact before prefix); empty query returns all; unknown query returns `[]`; case-insensitivity.
- [ ] Write `extractSlashQuery` tests: line start, after space, after tab; `and/or`, `path/to`, `https://a.com/b` return null; `lineStart` mode rejects mid-line; whitespace in query returns null.
- [ ] Extend `test/harness/webviewHarness.ts` with WYSIWYG helpers (editor access, type text at cursor through the view so plugins run, press key, place cursor, read last `edit` markdown). Keep `webviewSourceMode.test.ts` green.
- [ ] Write `test/unit/slashcommandsHarness.test.ts` covering: menu opens on `/` at line start and after space; filter narrows as you type; no open inside code block, inline code, link, mid-word; no open in source mode.
- [ ] Exit tests, each asserting the markdown is byte-identical to before dismissal: Esc, click-away, blur, Backspace past `/`, space with no matches, arrow-key cursor out of range; after Esc, typing another character does not reopen.
- [ ] Insertion tests for H1/H2/H3/Paragraph at line start, then Cmd+Z (history undo) restores `/h2` exactly in one step.
- [ ] Run `npm run test:unit` green.
- [ ] Run `npm run lint` green.
- [ ] Commit tests.

[Return to Top](#top)

## M3: Wire Existing-Block Commands

**Model:** Sonnet.

> Workers must complete ALL items. If you think one should be deferred, note it in your summary but still attempt it unless truly blocked.

- [ ] Map every registry `id` to an action in `slashcommands.ts` (or a sibling `slashcommands-actions.ts`), all via `editor.chain()` or `view.dispatch(tr)`.
- [ ] Implement the mid-line insert-below rule from [Trigger rules](#trigger-rules) as a shared helper used by every block command (empty line → convert in place; non-empty line → strip `/query`, insert the block after the current block, cursor into it).
- [ ] Headings, paragraph, quote, bullet, numbered, task list.
- [ ] Divider (`setHorizontalRule`), serializes as `---`.
- [ ] Callouts: `note`, `tip`, `important`, `warning`, `caution` via `setCallout(kind)`; serializes as `> [!NOTE]` etc.
- [ ] Code block: create the block, then open `showLanguagePicker` anchored at the block (rect from `coordsAtPos`).
- [ ] Mermaid: code block with `language: 'mermaid'` pre-filled with the M1 starter text, cursor inside; renders if `renderMermaidDiagrams` is on.
- [ ] Table: open `showTableGridPicker`. Add a rect/point option to it (preferred) or use a transient anchor in `document.body`; commit inserts the table.
- [ ] Link: open `showLinkDialog(editor)`; the link text is empty-selection behavior of that dialog, verify it inserts a usable link.
- [ ] Wikilink: replace `/query` with `[[` and confirm `wikilinkautocomplete.ts` opens its popup on the next view update.
- [ ] Emoji: open `showEmojiPicker(editor, { anchorRect })` at the cursor.
- [ ] Picker-based commands keep `/query` until the picker commits; cancel leaves it intact (per Open Question 3 default).
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
- [ ] Handle files outside `localResourceRoots` per Open Question 4 (default: copy into the image-paste target folder via the existing `resolveTargetFolder` + `resolveFilename` path so it renders and is portable).
- [ ] Webview: `src/webview/imagepick.ts` with `requestImagePick(view, from, to)` using a pending-by-`requestId` map like `imagepaste.ts`; on result, replace `/query` with an image node (`src` = `webviewUri`, markdown serializes to `insertPath`); cancel/error leaves `/query` intact.
- [ ] Route `pickedImageResult` in the webview message handler next to `pastedImageResult` (~line 5066).
- [ ] Put pure path logic in `src/imagePaste.ts` (with `imagePaste.test.ts` coverage) so the host handler stays thin.
- [ ] `npm run lint`, `npm run compile`, `npm run test:unit` green.
- [ ] Commit.

[Return to Top](#top)

## M5: Settings

**Model:** Sonnet.

> Workers must complete ALL items. If you think one should be deferred, note it in your summary but still attempt it unless truly blocked.

- [ ] `package.json#contributes.configuration.properties`: `mikedown.slashCommands.enabled` (boolean, default `true`) and `mikedown.slashCommands.trigger` (enum `lineStart` | `anywhere`, default `anywhere`, with `enumDescriptions`).
- [ ] `src/settings.ts`: add a `slashCommands: { enabled; trigger }` group and reader.
- [ ] Host broadcast (~line 1168 of `markdownEditorProvider.ts`): add `slashCommandsEnabled`, `slashCommandsTrigger`.
- [ ] Host `saveSettings` (~line 819): persist both with `ConfigurationTarget.Global`.
- [ ] Settings modal **Behavior** tab: a `makeCheckboxRow` "Slash command menu" and a `makeSelectRow` "Slash menu trigger" (Anywhere after a space / Only at the start of a line). Include both in the save payload and update the `current*` module vars like the existing mermaid field does.
- [ ] Webview `settings` handler (~line 4671): call `setSlashCommandsConfig(...)`; if disabling while the menu is open, close it (no doc change).
- [ ] Verify the live toggle: change the setting in VS Code's settings UI and in the modal with an editor open; no reload needed.
- [ ] `npm run lint`, `npm run compile`, `npm run test:unit` green.
- [ ] Commit.

[Return to Top](#top)

## T2: Tests, Integration, Hands-On Sign-Off

**Model:** Sonnet. **Modes:** unit (vitest), jsdom harness, integration (`@vscode/test-electron`), hands-on Extension Development Host.

> Workers must complete ALL items. If you think one should be deferred, note it in your summary but still attempt it unless truly blocked.

### Automated

- [ ] Write round-trip tests (harness): for every command, insert at line start and mid-line, then assert the emitted `edit` markdown exactly (`# `, `## `, `### `, `> `, `- `, `1. `, `- [ ] `, fenced code, ```` ```mermaid ````, `---`, `> [!NOTE]`/`[!TIP]`/`[!IMPORTANT]`/`[!WARNING]`/`[!CAUTION]`, table, link, `[[`, emoji, `![alt](path)`) and that re-loading that markdown via `update` then re-serializing is stable.
- [ ] Write mid-line insert-below tests: `foo /h2|` gives paragraph `foo` + empty H2 below; `foo /table|bar` gives paragraph `foo bar` (text intact, `/table` removed) + table below; `foo /emoji|` inserts inline.
- [ ] Write undo tests: one history undo after each command restores the `/query` text exactly.
- [ ] Write picker-cancel tests: code language, table, link, emoji, image cancel leave `/query` intact.
- [ ] Write settings live-toggle tests (harness): send a `settings` message with `slashCommandsEnabled: false` and assert `/` no longer opens; `slashCommandsTrigger: 'lineStart'` blocks mid-line.
- [ ] Write image message tests (harness): `pickImage` posted with a `requestId`; replying `pickedImageResult` inserts the image and serializes to `insertPath`; `cancelled` leaves text.
- [ ] Write integration tests in `test/integration/` (new `slashCommands.test.ts`): both settings are registered with the right defaults; updating them via `getConfiguration().update` is readable back; the image picker host handler returns a relative path for a file in a private fixture folder (stub `showOpenDialog`). Mutating tests use a private fixture with teardown, never `test/workspace/sample.md`.
- [ ] Run `npm run test:unit` green.
- [ ] Run `npm run test:integration` green.
- [ ] Run `npm run test:edge` and `npm run lint` green.
- [ ] Commit tests.

### Hands-on pass (orchestrator pauses for Mike's sign-off)

Start: open the repo in VS Code, run `npm run compile`, press **F5** (Extension Development Host). After later code changes, `npm run compile` then **Cmd+R** in the dev host. Create `scratch-slash.md` in the dev host workspace and open it with MikeDown.

- [ ] 1. Empty line, type `/`. Expected: menu opens under the cursor, grouped, first row focused, readable in the current theme.
- [ ] 2. Type `che`. Expected: Task list is the top (only) match. Enter. Expected: an empty task item; Cmd+Z returns `/che`.
- [ ] 3. Type `and/or` and `path/to/file`. Expected: menu never opens.
- [ ] 4. Inside a fenced code block and inside inline code, type ` /`. Expected: no menu.
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
- [ ] 17. Gear → Behavior: untick "Slash command menu", Save. Expected: `/` no longer opens, no reload. Re-enable; set trigger to line start; ` /` mid-line does not open, line-start does.
- [ ] 18. Toggle theme (toolbar theme button) light/dark. Expected: menu colors, focus row, and borders are correct in both.
- [ ] 19. Save the file, reopen it. Expected: all inserted blocks reload identically.
- [ ] Mike signs off (record in Progress Log).

[Return to Top](#top)

## M6: Optional Properties + Date

**Model:** Sonnet. **Blocked on Open Question 1.** Skip entirely if Mike declines.

> Workers must complete ALL items. If you think one should be deferred, note it in your summary but still attempt it unless truly blocked.

- [ ] Add `properties` (`frontmatter`, `yaml`) and `date` (`today`, `now`) to the registry.
- [ ] Properties: if the doc has no frontmatter, insert an empty frontmatter block using the existing `serializeFrontmatter` / sidebar Properties path and focus the Properties section; if it already has frontmatter, focus the existing Properties section instead (no duplicate block).
- [ ] Date: insert today's date as plain text in the format chosen in Open Question 1 (default ISO `YYYY-MM-DD`).
- [ ] Write registry + harness round-trip tests for both, run `npm run test:unit` green.
- [ ] Commit.

[Return to Top](#top)

## M7: Docs

**Model:** Haiku (mechanical).

> Workers must complete ALL items. If you think one should be deferred, note it in your summary but still attempt it unless truly blocked.

- [ ] `CHANGELOG.md`: add an `## [Unreleased]` section (above 2.10.4) with an `### Added` entry for the slash command menu, the `/image` file picker, and the two settings.
- [ ] `README.md`: add a short slash-commands feature mention and list the two settings where other settings are documented.
- [ ] `BACKLOG.md`: remove the "Slash commands" line from Nice-to-have.
- [ ] Escape `$` as `\$` and keep blank lines around lists (MD032).
- [ ] Commit.

[Return to Top](#top)

## Open Questions

1. **Properties and Date:** include them (M6)? If Date is in, which format: ISO `2026-09-25`, or a long form like `September 25, 2026`?
2. **H4 to H6:** add `/h4`, `/h5`, `/h6`, or keep the menu to H1 to H3 like Notion?
3. **Picker cancel:** for `/code`, `/table`, `/link`, `/emoji`, `/image`, should cancelling the follow-up picker leave `/query` in the document (plan default), or remove it and leave an empty block?
4. **Images outside the doc folder/workspace:** they will not render (`localResourceRoots`). Copy them into the image-paste folder (plan default), reference them by absolute path, or refuse?
5. **Placeholder hint:** change the empty-doc placeholder from "Start writing…" to "Type / for commands…"?
6. **Mid-line behavior:** ✅ Resolved 2026-09-25: no split. Block commands on a non-empty line insert the block on the next line; inline commands insert inline.

[Return to Top](#top)

## Parallel Development Recommendations

- **Group A (start together):** M1 (registry, new file only) and M4 host half (`markdownEditorProvider.ts` handler, `src/imagePaste.ts` helpers, protocol comment). No shared files.
- **Sequential:** M1 → M2 → T1 → M3. M2 needs the registry; M3 needs the plugin's execution API.
- **Group B (after M2):** M3 and M5 can run in parallel. Both touch `editor-main.ts`; M5 owns the settings modal and `settings` handler, M3 owns nothing in `editor-main.ts` except possibly a `showLinkDialog` export. Coordinate on `editor-main.ts` merge.
- **M4 webview half** (`imagepick.ts`, image action, `pickedImageResult` routing) waits for M3's action map.
- **T2** waits for M3, M4, M5. M6 waits for Open Question 1 and T2. M7 is last.
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

**2026-09-25 23:55** - Mike decided mid-line block commands insert the block on the next line instead of splitting the paragraph. Updated [Trigger rules](#trigger-rules), M3, T2 tests, and Open Question 6.

**2026-09-25 23:43** - Plan created. Decisions baked in: full command set with aliases (Properties/Date deferred to M6 pending Mike); trigger at line start or after whitespace, never in code, inline code, links, mid-word, or source mode; mid-line insertion splits the paragraph; dismissal (Esc, click-away, Backspace past `/`, no-match space, cursor out of range) never changes text; one undo restores `/query`; settings `mikedown.slashCommands.enabled` (default true) and `.trigger` (`lineStart` | `anywhere`, default `anywhere`) in the Behavior tab with live toggle; popup follows the `wikilinkautocomplete.ts` plugin pattern; pure registry in `slashcommands-registry.ts`; `/image` uses a new host `showOpenDialog` picker with a `pickImage` / `pickedImageResult` message pair.

[Return to Top](#top)
