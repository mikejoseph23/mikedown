# M1 — Commands & Keybindings (Host Side) — Worker Summary

**Status:** Completed

## Work completed

- Added four commands to `package.json#contributes.commands`:
  - `mikedown.toggleBulletList` — "MikeDown: Toggle Bullet List"
  - `mikedown.toggleOrderedList` — "MikeDown: Toggle Ordered List"
  - `mikedown.toggleTaskList` — "MikeDown: Toggle Task List"
  - `mikedown.toggleSidebar` — "MikeDown: Toggle Sidebar"
- Added matching entries to `package.json#contributes.keybindings`, each with `when: "activeCustomEditorId == 'mikedown.editor'"`:
  - `toggleBulletList` — `ctrl+.` / `cmd+.`
  - `toggleOrderedList` — `ctrl+3` / `cmd+3`
  - `toggleTaskList` — `ctrl+8` / `cmd+8`
  - `toggleSidebar` — `ctrl+\` / `cmd+\`
- Registered all four in `src/extension.ts` by adding them to the existing `formattingCommands` forwarding array (same pipeline as `toggleBold` etc. — posts `{ type: 'command', command: <name> }` to `MarkdownEditorProvider.activePanel`). No new registration block needed; this mirrors the existing pattern exactly.
- Added the four commands to `contributes.menus.commandPalette` with `when: "activeCustomEditorId == 'mikedown.editor'"`.

## Files modified

- `package.json`
- `src/extension.ts`

## Test status

- `npm run lint`: pre-existing failures unrelated to this change (241 errors / 114 warnings, all in `tsconfig.json` project-inclusion issues for webview files and pre-existing `curly` warnings). Confirmed identical error/warning count on a clean `git stash` of this change — this milestone introduces zero new lint issues.
- `npm run compile`: **passes**. Both bundles (extension host `dist/extension.js`, webview `out/webview/editor-main.js`) built successfully with no errors.

## Issues or blockers

None blocking.

## Notes for orchestrator

- **`ctrl+\` / `cmd+\` shadowing:** This is VS Code's built-in "Split Editor" default. The keybinding's `when: "activeCustomEditorId == 'mikedown.editor'"` clause should take precedence while a MikeDown editor is focused, per VS Code's keybinding resolution (more specific `when` wins). I did not find concrete evidence in this codebase or VS Code docs that the override fails for custom-editor `when` clauses — the existing `toggleSourceMode` command already uses `ctrl+/` (also a common built-in, "Toggle Line Comment") successfully with the identical `when` pattern, which is a working precedent for this shadowing approach. Kept `ctrl+\` / `cmd+\` as specified; recommend the orchestrator/user do a manual smoke test (open a `.md` file in MikeDown, confirm `Cmd+\` toggles the sidebar rather than splitting the editor) since I have no way to launch the Extension Development Host from this context.
- **`commandPalette` gating discrepancy:** The prompt asked me to match "how existing editor-scoped commands are gated" in `commandPalette`. As of this milestone's start, no editor-scoped commands (e.g. `toggleBold`, `toggleItalic`) had `commandPalette` entries at all — only `mikedown.openWithMikeDown` did (gated on `resourceExtname`). There was no existing pattern for gating editor-scoped commands to hide them when no MikeDown editor is active. I added the four new commands with `when: "activeCustomEditorId == 'mikedown.editor'"`, which is consistent with their keybinding `when` clause, but this makes them the first editor-scoped commands with palette gating — flagging in case the orchestrator wants the older commands retrofitted to match for consistency (out of scope for this milestone; not touched).
- Scope respected: only `package.json` and `src/extension.ts` touched. `src/webview/editor-main.ts` was not touched — webview-side handlers for these four commands (actual list-toggle logic, sidebar toggle logic) still need to be implemented in Milestone 2.
- Also noticed HEAD had moved to `1ca9836` ("Fix Ctrl+Tab triggering list indent instead of VS Code tab switch") — one commit ahead of the `54b4997` shown in this session's initial git status, presumably from other orchestrator/worker activity. Not investigated further; my commit (`89b49e4`) is on top of it.

**Start time:** 2026-08-24 ~17:05 EDT
**End time:** 2026-08-24 17:13 EDT
