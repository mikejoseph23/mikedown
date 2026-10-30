# Table editing improvements plan

One-pass usability review of MikeDown's table editing (`packages/core/src/`), read from the code plus a few jsdom probes. No code was changed.

## Milestone Progress Tracker

| Milestone | Model | Status | Duration (min) | Notes |
| --- | --- | --- | --- | --- |
| M1 Quick wins (bugs) | Opus | ✅ Done | 11 | `3ff068f`. Table node selection on; all bare `\|` in cells escaped |
| M2 Clipboard | Opus | 🔄 In Progress | — | Items 4, 5, 13 |
| M3 Discoverability and accessibility | Sonnet | ⬜ Not Started | — | Items 7, 8, 10, 11 |
| M4 Fidelity options | Sonnet | ⬜ Not Started | — | Item 12 |

## What works well today

- Three ways in: toolbar grid picker (8 x 10, plus a manual size form), `/table`, and the Insert dropdown. The picker commits in one undo step.
- A floating table toolbar (row/column insert and delete, column alignment, header toggle, merge, delete table) with tooltips, mirrored by the right-click menu.
- Tab / Shift+Tab move between cells, Tab on the last cell adds a row (one undo step), Escape and Arrow Down leave the table.
- Per-column alignment that really round-trips to the delimiter row (`:---:`, `---:`), with left stored as plain `---`.
- Enter in a cell saves as `<br>` and reloads as a line break (#9); a typed `|` saves as `\|` (#5); `[ ]` / `[x]` in cells render as checkboxes and save bare.
- Spreadsheet and Google Docs pastes are normalised to a header row plus padded body rows; wide tables scroll inside `.tableWrapper`.
- Row and column drag reorder is a single transaction, so one undo reverts it.

## Findings, ranked by user impact

### 1. Backspace after clicking into a cell wipes the whole cell (bug)

`tabledrag.ts` keeps its own DOM "multi-cell selection" that is set on every left click in a cell (`tabledrag.ts:362-369`), never cleared while the cursor stays in the table, and a `document` keydown handler turns Backspace or Delete into "clear every selected cell" (`tabledrag.ts:76-84`, `416-459`). Reproduced in jsdom: click into a table, click a cell again, press Backspace: `hello` becomes an empty cell. This also double-highlights real drag selections (`.selectedCell` from prosemirror-tables plus `.mikedown-cell-selected`).

Fix: delete the custom cell-selection layer (`wireCellSelection`, `applySelectionHighlight`, `clearSelectedCellContents`, the keydown handler, `tabledrag.css:67-93`, the clear in `editor.ts:4827-4830`). prosemirror-tables already gives Shift+click, Shift+arrow and drag `CellSelection`, Backspace/Delete to clear it, copy/paste of cell ranges, and it is what `mergeCells` needs. Keep `.selectedCell` styling (`tables.css:36-38`). Size: S.

### 2. Toggle header row and merge cells silently destroy the table on reload (bug)

Both fall through `isMarkdownSerializable` (`table-align.ts:74-96`) and save as an HTML `<table>` (`table-align.ts:112-126`). The parser runs with `html: false` (`editor.ts:3941-3953`), so that file reopens as one paragraph of literal `<table style="min-width...">` text (probed). The CHANGELOG claim "reloads correctly" does not hold.

Fix, in order: (a) remove "Toggle header row" from the toolbar and context menu (`tablepicker.ts:304-308`, `contextmenu.ts:492`); GFM has no headerless table. (b) Either drop "Merge / split" too (`tablepicker.ts:309-313`, `contextmenu.ts:493`) or make the HTML fallback round-trip by parsing a top-level `<table>` block back into table nodes even with `html: false` (a markdown-it block rule, the same approach `tableBreaksToHardBreaks` uses for `<br>`). (c) Until then, warn in the toolbar tooltip that the table will save as HTML. Size: S for (a)/(c), M for (b).

### 3. Pasting a table while inside a table corrupts it

`smartpaste.ts:13-47` does `tr.replaceSelection(slice)` for any HTML paste, so a table pasted with the cursor in a cell nests inside the cell, the result is not GFM-serialisable, and finding 2 applies on reload (probed: a 2 x 2 HTML table pasted into a header cell produced a 3-column HTML table). prosemirror-tables' own `handlePaste` would fill cells from the cursor onward, spreadsheet-style, but SmartPaste wins first.

Fix: in SmartPaste, when the cleaned HTML's first block is a `<table>` and the selection is inside a table, return `false` so prosemirror-tables handles it (or dispatch its `handlePaste` explicitly); otherwise insert the table after the current one. Add a unit test. Size: S.

### 4. Plain-text table pastes are not recognised

`transformPastedText: false` (`editor.ts:3952`) plus `insertPlainText` (`plainpaste.ts:26-45`) means TSV from a spreadsheet's plain-text clipboard, CSV, and markdown pipe tables paste as literal lines (probed: `a\tb\n1\t2` and `| a | b |...` both land as paragraphs with tabs or pipes). Notion, Obsidian and Typora all turn these into tables.

Fix: a pure `detectTextTable(text)` (pipe table with delimiter row; two or more tab-separated lines with equal counts; optionally CSV) wired into a `handlePaste` that builds table nodes; keep plain-paste (Cmd+Shift+V) verbatim. Size: M.

### 5. Copying cells gives one line per cell as plain text

With `transformCopiedText: false` and no `clipboardTextSerializer`, ProseMirror's default puts each cell on its own line, so a table pasted into Slack, a terminal or a commit message loses its structure (HTML on the clipboard keeps spreadsheets working). Obsidian and Typora copy tables as markdown.

Fix: `clipboardTextSerializer` that renders a slice containing table nodes through the markdown serializer (pipe table), falling back to the default for other content. Add "Copy table as Markdown" to the context menu for whole tables. Size: S.

### 6. Inline code containing `|` in a cell

`markdownEscape.ts:112-114` escapes pipes in text nodes only; the `code` mark serializer writes its text raw, so `` `a|b` `` typed in a cell is likely saved unescaped and splits the cell on reload (GFM requires `\|` inside code spans in tables). Not fully confirmed by probe; verify first.

Fix: in the table serializer (`table-align.ts:143-149`) post-process each cell's rendered inline text so bare `|` inside backticks becomes `\|`, or escape in the code-mark serializer when `state.inTable`. Add a round-trip test. Size: S.

### 7. The table picker cannot be used from the keyboard

`tablepicker.ts:152-158` listens for Escape and Enter on the picker element, but nothing focuses it on open, so after `/table` Escape does not close it and arrows do nothing. The only exits are a mouse click or clicking away.

Fix: on open, focus the grid (`tabindex="-1"`), arrows move the highlighted size, Enter commits, Escape closes and restores editor focus; expose the size inputs via Tab. Size: S.

### 8. Floating toolbar and drag handles lose their anchor on long or wide tables

The toolbar is pinned above the table's top edge (`tablepicker.ts:367-379`) and flips below it when the top is off-screen, so on a tall table with the cursor mid-way it is often off-screen in both directions. Drag handles are recomputed only on container scroll (`tabledrag.ts:55-59`) and skipped when the cursor stays in the same table (`tabledrag.ts:137`), so after typing changes row heights, or after scrolling `.tableWrapper` horizontally, they drift.

Fix: position the toolbar relative to the current row (or clamp it into the viewport while the table is visible); reposition handles on `editor.on('update')`, window resize and the wrapper's `scroll`. Size: S-M.

### 9. No keyboard shortcuts for row/column operations and the toolbar is mouse-only

Every structural edit needs the mouse: toolbar buttons fire on `mousedown` only (`tablepicker.ts:335-339`), so a focused button does not respond to Enter or Space, and `hotkeys.ts` lists no table commands. Typora and Obsidian insert rows from the keyboard; Notion has Cmd+Shift+Enter-style row actions.

Fix: add `Mod-Enter` (row below), `Mod-Shift-Enter` (row above) and `Mod-Alt-Backspace` (delete row) in the table keydown block (`editor.ts:4063-4105`), list them in Hotkeys, and switch toolbar buttons to `click` with `mousedown` preventDefault for focus retention. Size: S.

### 10. Drag handles are hard to see and not accessible

Handles are 16 px text glyphs at 50% opacity (`tabledrag.ts:211-229`, `tabledrag.css:3-20`), the column handle sits over the first body row, and they are `div`s with no role, label or keyboard path. Nothing exists for touch.

Fix: SVG grip icons, `role="button"` with `aria-label`, and "Move row up/down" and "Move column left/right" in the context menu as the keyboard and touch equivalent (reuse `reorderRows` / `reorderColumns`). Size: M.

### 11. No hover affordance to add rows and columns

Notion-style "+" strips on the right and bottom edges are the most discoverable way to grow a table; today users must find the toolbar or Tab from the last cell.

Fix: a hover-only "+" at the right edge of the header row and the bottom edge of the last row, implemented as portal overlays like the handles. Size: M.

### 12. Source-mode readability: pipes are not padded

The serializer writes `| a | b |` with no column padding (`table-align.ts:143-158`), so source view and diffs do not line up. Typora and Obsidian pad to the widest cell. Trade-off: padding churns diffs on every edit.

Fix: optional `mikedown.tables.padColumns` setting (three places per the settings rule), default off. Size: S.

### 13. Smart paste rewrites merged cells by duplicating content

`smartpaste.ts:253-270` copies a `colspan` cell's content into the extra cells and drops `rowspan` outright; a merged title cell becomes repeated text. Body-cell alignment from pasted HTML is also dropped (`smartpaste.ts:286-292` sets `align`, which the parse rule does read, but the probe showed no alignment survives).

Fix: fill the extra cells with empty cells instead of clones; carry per-column alignment to the header cells so it reaches the delimiter row. Size: S.

### 14. Minor

- Dead CSS: `.column-resize-handle` (`tables.css:41-50`) while `resizable: false` (`editor.ts:3862`). Column widths cannot round-trip to markdown, so leaving resizing off is right; remove the rule. S.
- `insertTable` command and the Insert context-menu entry (`editor.ts:6934`, `contextmenu.ts:317`) always make 3 x 3 without the picker; route them through `showTableGridPicker`. S.
- "Delete table" has no confirmation and no "Select table"; add a "Select table" entry (NodeSelection) so Cmd+C / Backspace work on the whole table. S.
- Tests: `test/unit/tables.test.ts` only asserts `isActive('table')` and that output contains `|`; add round-trip fixtures for escaped pipes, inline marks, `<br>` cells, ragged rows and alignment, and a jsdom test for Tab/Escape/Backspace in cells. S.

## Milestones

Merged cells are dropped (OQ1), so 2(b) is a removal and moves into M1; 2(c) is moot once both entries are gone.

### M1 Quick wins (bugs, 1 to 2 days)

- [x] 1. Remove the custom cell-selection layer (Backspace wipe)
- [x] 2(a). Remove "Toggle header row" from the toolbar and context menu
- [x] 2(b). Remove "Merge / split" from the toolbar and context menu (OQ1)
- [x] 3. Table pasted inside a table goes to prosemirror-tables
- [x] 6. Escape `|` in inline code inside cells
- [x] 9. Row chords (Mod+Enter, Mod+Shift+Enter, Mod+Alt+Backspace), Hotkeys entries, toolbar buttons on `click`
- [x] 14. Dead resize CSS, insertTable through the picker, "Select table", round-trip and keyboard tests

### M2 Clipboard (2 to 3 days)

- [ ] 4. Plain-text table paste: pipe tables and TSV (OQ3)
- [ ] 5. Copy cells as a markdown pipe table, plus "Copy table as Markdown"
- [ ] 13. Smart paste: empty cells for colspan, carry column alignment

### M3 Discoverability and accessibility (3 to 4 days)

- [ ] 7. Keyboard-usable table picker
- [ ] 8. Toolbar and drag handles keep their anchor
- [ ] 10. Visible, accessible drag handles plus Move row/column menu entries
- [ ] 11. Hover "+" to add rows and columns

### M4 Fidelity options (1 day)

- [ ] 12. `mikedown.tables.padColumns` setting, default off (OQ4)

## Open questions for Mike

- Keep merged cells at all? Supporting them means the HTML-table round trip (2b); dropping them keeps the editor GFM-only, like Obsidian and Typora.
- Should Enter in a cell keep inserting a line (`<br>`, Google Docs / Notion style) or move to the row below (Obsidian / Typora style), with Shift+Enter for the line break?
- Plain-text table paste: recognise pipe tables only, or also TSV and CSV? Should it apply to Cmd+Shift+V (paste without formatting)?
- Padded pipes in saved markdown: a setting (default off), always on, or never?
- Keyboard chords for row operations: happy with Mod+Enter / Mod+Shift+Enter, or reserve Mod+Enter for something else?

### Answers (Mike, 2026-10-30)

1. **Merged cells:** drop them. Remove Merge / split everywhere; tables stay GFM-only.
2. **Enter in a cell:** keep inserting a line break (`<br>`). Shift+Enter already does the same (TipTap HardBreak); no change.
3. **Plain-text table paste:** pipe tables and TSV, no CSV, no setting. Cmd+Shift+V stays verbatim; undo restores the text.
4. **Padded pipes:** a setting, `mikedown.tables.padColumns`, default off.
5. **Row chords:** Mod+Enter (row below), Mod+Shift+Enter (row above), Mod+Alt+Backspace (delete row), inside tables only. This replaces TipTap's Mod+Enter line break inside tables; Enter and Shift+Enter still insert one.

## Progress Log

- 2026-10-30 15:20: Open questions answered; 2(b) folded into M1 as a removal.
- 2026-10-30 15:58: M1 done (`3ff068f`, cherry-picked from worktree). Custom cell selection removed; header toggle and merge removed; table-in-table paste uses prosemirror-tables; `|` in cells escaped (all bare pipes, not just code spans); Mod+Enter / Mod+Shift+Enter / Mod+Alt+Backspace; Insert Table opens the picker (keyboard support waits on M3 item 7); Select Table via `allowTableNodeSelection`, so Backspace after a table now selects it first. 32 new tests; unit 3355 pass, lint 0 errors.
