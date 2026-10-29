# Worker summary: M2 Rewrite family UI

**Status:** Completed. Commit `db72be1` on `develop`.

## Work completed

- [x] **Grouped choose phase and bubble.** `ai-rewrite.ts` has a new `aiRewriteMenuGroups()` that groups `AI_REWRITE_VARIANTS` by `group` in menu order. The popover's choose phase shows one labelled row per group (Length, Tone, Audience, Translate, Explain), with a thin rule between rows and the custom prompt below. The bubble menu puts a `role=separator` between groups. Chips use `role=menuitem`, and picker chips also get `aria-haspopup`. Arrow keys, Home and End move between chips and between picker rows.
- [x] **Pickers (D3, D17, D10).** Reading level… opens the `AI_AUDIENCES` list. Translate… opens up to 3 recents (deduplicated case-insensitively), then the 12 fixed languages minus the recents, then Other… (inline free text, stored as typed). There is also a "Whole document" checkbox. The remembered choice is checked (`aria-checked`) and focused. Esc goes back to the first level and puts focus on the chip that opened the picker. The new `ai-prefs.ts` stores choices in `localStorage` (`mikedown.ai.recentLanguages`, `mikedown.ai.audience`) behind try/catch.
- [x] **Context menu.** The `aiRewrite` hook now returns `{ enabled, reason?, groups, run }`. `contextmenu.ts` renders it as one submenu with a separator between groups. The picker variants call `run('translate' | 'readingLevel')`, which opens the popover on that picker (no third menu level).
- [x] **Explain (`readOnly`).** The title reads "Explain". The request is built with `buildExplainMessages` (the title comes from frontmatter `title:` or the first heading) and `explainMaxTokens`. The footer shows Insert below, Retry and Copy. Enter does not insert. The highlight stays until the popover closes. Insert below adds a blockquote after the target's top-level block in one transaction with `closeHistory` (rich mode), or after the selection's line in one isolated CM transaction (source mode).
- [x] **Whole-document translate (`replaceDocument`).** New `richDocumentTarget` and `sourceDocumentTarget` targets. Rich mode sends the PM body (frontmatter already lives apart). Source mode uses `extractFrontmatter` to find where the body starts. Accept is one transaction with `closeHistory` (or `isolateHistory` in CM), puts the caret at the body start and scrolls to the top. The rich path also sets `editorContainer.scrollTop = 0`. The layout is single (no side-by-side) and the accept button reads "Replace document". The `TODO(M4)` for `budgetDocument` and the coverage note is in `start()` in `ai-rewrite.ts`. If `aiTranslate` runs with nothing selectable (caret in an empty block), the popover opens on the whole document with the toggle locked on.
- [x] **Structure warning.** After the stream ends, `checkMarkdownStructure` runs for translate, simpler, formal, casual and expand. `.ai-rw-warn` sits above the footer and reads, for example, "Check: 1 link missing in the result", with the full messages in its `title`. Accept stays enabled. The formatter is `structureWarningText(diff)`, exported.
- [x] **`editor.ts`.** `startAiRewrite(variant?, params?, opts?: { wholeDocument })`. New commands `aiExplain` and `aiTranslate` in the `types.ts` union and in the command switch. No toolbar, registry or `buildCondensedToolbar` changes; the AI menu's "Rewrite selection…" still opens the choose phase.
- [x] **Source mode.** Every variant goes through `sourceRewriteTarget`. Insert below and whole-document translate each have a one-transaction CM path.
- [x] **Styles.** Group rows and labels, picker list, check marks, option separators, Whole document toggle, warning line, Explain preview styled as a quote, and a taller preview for whole-document translate. Theme variables only.
- [x] **Lint, unit tests, commit.** See Test status.

## Files modified

- `packages/core/src/ai-rewrite.ts`
- `packages/core/src/ai-prefs.ts` (new)
- `packages/core/src/contextmenu.ts`
- `packages/core/src/editor.ts` (only the menu hook, the popover deps, `startAiRewrite` plus two helpers next to it, and the command switch)
- `packages/core/src/types.ts`
- `packages/core/src/styles/ai-rewrite.css`
- `packages/core/test/ai-rewrite.test.ts` (context menu test updated to the grouped hook)
- `packages/core/test/ai-rewrite-ui.test.ts` (new, 21 tests)

## Test status

- `npm run test:unit`: 149 files, 2523 passed, 2 todo, 0 failed.
- `npm run lint`: 0 errors (1206 warnings, the same count as before this change).
- `tsc -p tsconfig.webview.json --noEmit` and `tsc -p tsconfig.json --noEmit`: clean.
- `npm run build:core`: OK.

## Issues or blockers

None.

## Notes for orchestrator

- **CSS location.** The rewrite styles live in `styles/ai-rewrite.css`, not `styles/ai.css`. I extended `ai-rewrite.css`; `ai.css` is untouched.
- **New exports from `ai-rewrite.ts`:** `aiRewriteMenuGroups`, `AiRewriteMenuGroup`, `AiRewriteChoice`, `structureWarningText`, `blockquoteMarkdown`, `richDocumentTarget`, `sourceDocumentTarget`.
- **New `AiRewriteTarget` fields:** `scope`, `insertBelow` and `title?`.
- **New popover dep:** `documentTarget?()`.
- **New exports from `ai-prefs.ts`:** `AI_TRANSLATE_LANGUAGES`, `MAX_RECENT_LANGUAGES`, `loadRecentLanguages`, `rememberLanguage`, `translateLanguageChoices`, `loadAudience`, `rememberAudience`.
- **Breaking change to `ContextMenuActions.aiRewrite`.** It now also requires `groups`. The editor passes `aiRewriteMenuGroups()`.
- **Whole-document output budget.** `rewriteMaxTokens` caps at 4096, which is too small for a whole document, so a local `documentMaxTokens` (1024 to 16384, about 1.6 times the body's tokens) is used for document scope. M4's budget can replace it.
- **Translate temperature** is now 0.2, like fixFlow.
- **The "Whole document" toggle is not remembered.** This is deliberate: replacing a whole document should be an explicit choice each time.
- **Grouping comes from M1's data.** "Simpler" is in Length and "Fix flow" in Tone, which differs slightly from D1's prose.
- The VS Code host has no `mikedown.ai.explain` or `mikedown.ai.translate` commands yet. Only the core command union gained them.

## Times

Start 20:40, end 20:52.

## Review Materials

- Tests: `npx vitest run packages/core/test/ai-rewrite-ui.test.ts packages/core/test/ai-rewrite.test.ts`
- To see it live: `npm run dev`, turn AI on, select text and use the Rewrite bubble or right-click > Rewrite. There was no visual or hands-on pass in this milestone (D8 puts that at the end).
