# AI Writing Features Plan

## Summary

The second wave of experimental AI features on the engine layer that `ai-inference-engines-plan.md` shipped. Two bundles:

1. **Rewrite family** (brainstorm ideas 2, 12, 19, 20): the remaining variants on top of the shipped selection Rewrite (Simpler, Formal, Casual), Explain and Expand, a reading-level and audience dial, and translation that keeps markdown structure. Plus the on-demand thinking dial (engines plan follow-up 11) in the popover.
2. **Document understanding bundle** (ideas 4, 7, 14): `/summary` (TL;DR or outline), `/title` (title and heading suggestions), and frontmatter, tag and description suggestions in the Properties sidebar.

Everything stays Experimental and off by default behind `mikedown.ai.enabled`, with the shared disclaimer. No new `mikedown.*` settings are planned; if a worker finds one is needed, the CLAUDE.md three-place rule applies.

**Key objectives:**

- Reuse, do not rebuild: every new surface runs through `runAiCompletion` (`ai-request.ts`) and previews in the rewrite popover (`ai-rewrite.ts`) before one transaction commits it. Explain never touches the document unless asked.
- Local first: works on oMLX and LM Studio models that have no JSON mode and an unknown (8k default) context window. JSON is parsed leniently with one repair retry; long documents are budgeted and labelled, never silently cut.
- Markdown fidelity: translation and tone rewrites keep links, code, headings, list markers and frontmatter keys; a post-check compares structure counts and warns before Accept.
- No toolbar registry work. Surfaces are the selection bubble, the context menu, the AI toolbar menu entries (pure data in `ai-toolbar.ts`), slash commands and the Properties sidebar. The customizable toolbar orchestrator owns `editor.ts` toolbar code; see Parallel Development Recommendations.
- Every AI edit is one undo step; nothing writes to `editor.view.dom` outside a ProseMirror transaction.

**Critical success factors:**

- On Mike's oMLX setup, each variant, `/summary`, `/title` and Properties Suggest produce a usable result on a 7B to 30B local model, and a wrong result is one `Cmd+Z` away.
- Prompt builders, lenient JSON parsing and the structure post-check are pure and unit-tested; the opt-in live run (`MIKEDOWN_AI_LIVE=1`, `npm run test:ai-live`) exercises each new task once against a real local server.
- The prompt builders and fixtures double as benchmark cases for the follow-up model benchmark (see Follow-ups).

**Defaults applied by the planning skill:** incremental testing milestones after each build group; automated tests preferred, one hands-on pass at the end (no screenshots); Opus for UI milestones, Sonnet for pure logic and plumbing, Haiku for docs; no schema review (no database). Not a LymeStack app.

### Milestone Progress Tracker

| Milestone | Model | Status | Duration (min) | Notes |
|---|---|---|---|---|
| [M1 Rewrite family: variants, prompts, structure check](#m1-rewrite-family-variants-prompts-structure-check) | Sonnet | ✅ Done | 15 | Pure, `ai/prompts/` (`bd4753f`) |
| [M2 Rewrite family UI: grouped menu, pickers, Explain, whole document](#m2-rewrite-family-ui-grouped-menu-pickers-explain-whole-document) | Opus | ✅ Done | 12 | `ai-rewrite.ts`, `contextmenu.ts`; light `editor.ts` (`db72be1`) |
| [M3 Thinking dial per request](#m3-thinking-dial-per-request) | Opus | ✅ Done | 10 | Core wire + VS Code + Desktop + popover control (`da0789d`) |
| [T1 Rewrite family and thinking dial tests](#t1-rewrite-family-and-thinking-dial-tests) | Sonnet | ✅ Done | 6 | vitest + live case (`bc9b781`) |
| [M4 Document understanding core: prompts, lenient JSON, document budget](#m4-document-understanding-core-prompts-lenient-json-document-budget) | Sonnet | ✅ Done | 15 | Pure; relaxes `summarize`/`structure` gates (`a209aef`) |
| [M5 `/summary` and `/title`](#m5-summary-and-title) | Opus | ✅ Done | 16 | Slash + AI menu + popover insert mode (`865c124`) |
| [M6 Properties suggestions](#m6-properties-suggestions) | Opus | ✅ Done | 10 | `outlineSidebar.ts` Suggest + chips (`56dab62`) |
| [T2 Document bundle tests and live run](#t2-document-bundle-tests-and-live-run) | Sonnet | ✅ Done | 10 | vitest + jsdom + live (`eb4494a`, `ae1135c`, `5f344d7`) |
| [M7 Host commands, docs, release notes](#m7-host-commands-docs-release-notes) | Haiku | ✅ Done | 4 | VS Code commands, Desktop menu, CHANGELOG (`c9c12dc`) |
| [T3 Hands-on: VS Code and Desktop against oMLX](#t3-hands-on-vs-code-and-desktop-against-omlx) | — (Mike) | ⏸ Awaiting Mike | — | One pass, both hosts |

[Return to Top](#ai-writing-features-plan)

---

## Table of Contents

- [Summary](#summary)
- [Decisions (planning interview, 2026-10-28)](#decisions-planning-interview-2026-10-28)
- [Architecture](#architecture)
- [Milestones](#milestones)
  - [M1 Rewrite family: variants, prompts, structure check](#m1-rewrite-family-variants-prompts-structure-check)
  - [M2 Rewrite family UI: grouped menu, pickers, Explain, whole document](#m2-rewrite-family-ui-grouped-menu-pickers-explain-whole-document)
  - [M3 Thinking dial per request](#m3-thinking-dial-per-request)
  - [T1 Rewrite family and thinking dial tests](#t1-rewrite-family-and-thinking-dial-tests)
  - [M4 Document understanding core: prompts, lenient JSON, document budget](#m4-document-understanding-core-prompts-lenient-json-document-budget)
  - [M5 `/summary` and `/title`](#m5-summary-and-title)
  - [M6 Properties suggestions](#m6-properties-suggestions)
  - [T2 Document bundle tests and live run](#t2-document-bundle-tests-and-live-run)
  - [M7 Host commands, docs, release notes](#m7-host-commands-docs-release-notes)
  - [T3 Hands-on: VS Code and Desktop against oMLX](#t3-hands-on-vs-code-and-desktop-against-omlx)
- [Open Questions](#open-questions)
- [Follow-ups](#follow-ups)
- [Parallel Development Recommendations](#parallel-development-recommendations)
- [Gap-filling prompts](#gap-filling-prompts)
- [Progress Log / Notes](#progress-log--notes)

---

## Decisions (planning interview, 2026-10-28)

All nine recommendations were accepted by Mike as given.

| # | Decision | Outcome |
|---|---|---|
| D1 | Where the new rewrite variants live | **Grouped submenu** in the same three entry points (selection bubble, context menu, AI toolbar menu entry opening the popover's choose phase): Length (Shorter, Longer), Tone (Simpler, Formal, Casual, Fix flow), Audience (reading level picker), Translate (language picker), Explain, Expand, Custom prompt. No toolbar registry change. |
| D2 | Explain output | **Read-only popover.** Same popover, Accept replaced by **Copy** and **Insert below** (a blockquote after the selection's block, one transaction). The selection is never replaced. |
| D3 | Translate and reading-level inputs | **Second-level picker, remembered.** Translate: short language list, recent first, plus "Other…" free text, plus a **Whole document** option. Reading level: General, Expert, Plain language, Grade 8, ESL. The last choice is remembered per host in browser storage (not a `mikedown.*` setting). |
| D4 | `/summary` and `/title` output | **Popover preview, insert on accept.** `/summary` streams into the popover anchored at the cursor; Accept inserts a callout (TL;DR) or a list (Outline) at the cursor in one transaction. `/title` shows three candidates; picking one sets the H1, or `title:` when frontmatter exists. Both also appear in the AI toolbar menu. |
| D5 | Properties suggestions trigger and apply | **On demand, chips to apply.** A Suggest (sparkle) button in the Properties header. Tags (constrained to the workspace tag vocabulary first, new tags marked), title and description arrive as dismissible chips; a click applies one through the existing frontmatter edit path, one undo step. Never automatic, never on save. |
| D6 | Local-model JSON reliability | **Lenient parse, drop the json gate.** Send `format: 'json'` when the model has `json`, else a plain prompt with a fixed shape; parse leniently in core (strip `<think>`, fences, trailing prose, first balanced `{…}`), one repair retry quoting the parse error. `structure` requires `chat` only; `json` becomes a routing preference, not a gate. |
| D7 | On-demand thinking dial | **In the popover header**, next to the engine badge, only when `thinkingChoices(kind)` is non-empty for the served model's kind. Default is the model's configured level; a change applies to Retry and is remembered for the session. Uses `withThinkingLevel`, no new setting. |
| D8 | Test strategy | **One hands-on pass at the end, both hosts, against oMLX**, about ten behaviours. Automated: vitest on prompt builders, lenient JSON, structure post-check, popover and chips in jsdom, fixtures per task; the live opt-in run gets one case per new task. No screenshots. |
| D9 | `summarize` 32k context gate | **Drop the gate, truncate with notice.** `summarize` requires `chat` only. Core budgets the document to the model's known context minus output; when it does not fit, it sends whole sections from the top and labels the result "summary of the first N% of the document". Chunk-then-merge is a follow-up. |

Open questions resolved 2026-10-28 (OQ1 to OQ8, by the orchestrator on Mike's tie-breakers: intuitive UX first, clean architecture second):

| # | Decision | Outcome |
|---|---|---|
| D10 | Remembered picker choices (OQ1) | **`localStorage` in `ai-prefs.ts`**, same pattern as `emojipicker.ts` recents (try/catch, `mikedown.ai.*` keys, silent on failure). `host.sidebarPrefs` is a round-trip API for one feature and would need host code on three hosts for a convenience; not worth it. Session thinking level is memory only. Follow-up 5 stays as the escape hatch. |
| D11 | Summary callout type (OQ2) | **`[!NOTE]` with a bold first line `**Summary**`.** `CALLOUT_KINDS` is the GFM five; a custom kind would not round-trip on GitHub. Outline inserts a plain nested list, no callout. |
| D12 | `/title` with both H1 and `title:` (OQ3) | **Set `title:` only, leave the H1.** Properties is what tools and the sidebar read; renaming the H1 would also break anchors (`headingRename.ts` only detects renames, the link fix lives in editor wiring). The candidates list shows a one-line hint naming what the click will change ("Sets title: in Properties" or "Replaces the H1" or "Inserts an H1"). "Also rename heading" stays Follow-up 4. |
| D13 | Whole-document translate loses selection and scroll (OQ4) | **Accept for v1.** After Accept, the cursor goes to the start of the body and the editor scrolls to the top (one `scrollIntoView` in the same transaction). |
| D14 | AI toolbar menu has no submenus (OQ5) | **No submenu work.** "Rewrite selection…" keeps opening the popover's grouped choose phase; "Summarize document…" and "Suggest titles…" are flat entries. `toolbar-dropdown.ts` stays untouched (toolbar plan territory). |
| D15 | Slash entries when the feature is disabled (OQ6) | **Hide the `ai` slash group whenever availability is not `available`.** `slashcommands.ts` has no disabled-entry rendering (`setSlashDisableHandler` is the "Turn off slash commands" row, unrelated), and a greyed slash row is a poor place for a router reason. The reason surfaces where it already has a home: the AI toolbar menu entries (`{ enabled: false; hint }`) and the Properties Suggest tooltip. No new slash menu feature in this plan. |
| D16 | Repair retry cost (OQ7) | **One retry, JSON tasks only** (`title`, `frontmatter`); never for `summarize` or rewrite variants. While it runs the popover footer or chips row reads "Fixing the answer format…"; the retry is abortable like the first request. |
| D17 | Language list (OQ8) | **Fixed list of twelve**, in this order: English, Spanish, French, German, Portuguese, Italian, Dutch, Japanese, Chinese (Simplified), Korean, Arabic, Hindi, then "Other…" (free text, stored as typed). Up to three recent choices float to the top, deduplicated from the list below. |

[Return to Top](#ai-writing-features-plan)

---

## Architecture

### Where each piece lives

| Piece | Location | Notes |
|---|---|---|
| Variant definitions, prompt builders, output cleanup, structure post-check | `packages/core/src/ai/prompts/rewrite.ts` (grows), new `ai/prompts/explain.ts`, `ai/prompts/summary.ts`, `ai/prompts/title.ts`, `ai/prompts/properties.ts` | Pure, no DOM. Exported through `@mikedown/core/ai`. |
| Lenient JSON parsing and repair prompt | new `packages/core/src/ai/json.ts` | Pure. Shared by `/title` and Properties. |
| Document budgeting (fit markdown to a context window by whole sections, report coverage) | new `packages/core/src/ai/documentBudget.ts` | Pure. Uses heading boundaries; frontmatter and title always included. |
| Popover (choose phase groups, read-only mode, insert mode, candidates list, thinking control) | `packages/core/src/ai-rewrite.ts` | Keeps `AiRewriteTarget`; adds an insertion target and an `explain` output mode. Styles in `styles/ai.css`. |
| Remembered picker choices (language, audience, session thinking level) | new `packages/core/src/ai-prefs.ts` | `localStorage` behind try/catch, keyed `mikedown.ai.*`, modelled on `emojipicker.ts` recents (D10); never a `mikedown.*` setting (D3). Thinking level is memory only. |
| Entry points | `ai-rewrite.ts` (bubble), `contextmenu.ts` (`aiRewrite` hook grows to grouped items), `ai-toolbar.ts` (`aiToolbarMenuEntries` gains Summarize, Suggest titles, Explain), `slashcommands-registry.ts` + `slashcommands-actions.ts` (`summary`, `outline`, `title`) | Slash entries hidden whenever the feature is not `available` (D15; `setSlashHiddenCommands`, same mechanism as `image`). The router's reason shows in the AI toolbar menu hints instead. |
| Properties Suggest | `packages/core/src/outlineSidebar.ts` (header button, chips row), wiring in `editor.ts` beside `onPropertiesChange` | Applies through `applyFrontmatterEdit`, which already re-renders block and sidebar in lockstep. |
| Per-request thinking level on the wire | `ai/types.ts` (`AiCompletionRequest.requestOverrides?`), VS Code `src/ai/engineService.ts`, Desktop `packages/desktop/src-tauri/src/commands/ai.rs` + `src/host/aiHost.ts`, website stub host | Merged over the model's `requestOverrides` host side. |
| Host commands | `src/extension.ts`, `package.json#contributes.commands` + menus, `packages/desktop/src/menu/shortcuts.ts`, core `types.ts` command union | `aiExplain`, `aiTranslate`, `aiSummarize`, `aiSuggestTitle`, `aiSuggestProperties`. |

### Features and tasks

| Feature id | Status change | Task | Requires (feature) | Notes |
|---|---|---|---|---|
| `rewrite` | available (unchanged) | `rewrite` | chat, stream | Gains the new variants; Explain and Expand are variants of this feature. |
| `summary` | planned → available | `summarize` | chat | `summarize` task drops the 32k minimum (D9); `SUMMARIZE_MIN_CONTEXT_TOKENS` stays exported as the "comfortable" threshold the budget code uses to decide whether to warn. |
| `title` (new) | available | `structure` | chat | `/title` and "Suggest titles…". |
| `frontmatter` | planned → available | `structure` | chat | Properties Suggest. `structure` drops `json: true` from `requires` (D6); the router prefers a `json` model when more than one candidate qualifies (small change in `router.ts`, or a `prefers` field on the task). |

### Output modes of the popover

| Mode | Used by | Footer | Commit |
|---|---|---|---|
| `replace` (today) | all rewrite variants, translate selection | Accept, Retry, Copy | `target.accept(markdown)`, one transaction |
| `replaceDocument` | Translate whole document | Accept, Retry, Copy | one transaction replacing the body; frontmatter YAML kept verbatim (keys and values untouched, values not translated) |
| `readOnly` | Explain | Insert below, Retry, Copy | Insert below adds a blockquote after the selection's block, one transaction |
| `insert` | `/summary`, `/outline` | Insert, Retry, Copy | one transaction at the cursor; `/query` removal joins it (see `slashcommands-actions.ts` picker pattern) |
| `choose` | `/title` | list of candidates, Retry | click sets H1 or `title:`; one transaction (or one frontmatter edit) |

Every mode streams into the preview only; nothing streams into the document (brainstorm constraint 5).

### Context budgets

- Rewrite variants: selection plus `REWRITE_CONTEXT_CHARS` per side (unchanged).
- Explain: selection plus the same context, plus the document title.
- Translate whole document, `/summary`, `/title`, Properties: the document through `documentBudget` with `contextTokens` of the routed model (unknown → `DEFAULT_CONTEXT_TOKENS`), minus the output budget. `/title` and Properties prefer the first sections and the headings list; `/summary` takes whole sections from the top and reports coverage.

### Local-model JSON contract (D6)

- Request shape in the prompt: a one-line example object, "reply with that JSON object only".
- `format: 'json'` only when the served model has `json: true`.
- `parseLenientJson(raw)`: strip `<think>…</think>`, strip fences, take the first balanced `{…}` or `[…]`, `JSON.parse`; on failure try common repairs (trailing commas, single quotes, unquoted keys) once; return `{ ok, value, error }`.
- One repair round trip: resend with "Your previous reply was not valid JSON (<error>). Reply with the JSON object only." Then give up with `AiErrorCode` `badOutput` (new code, copy in `errors.ts`).
- Validate the shape in core before showing anything (arrays of strings, lengths capped, tags normalised through the existing tag syntax helpers).

[Return to Top](#ai-writing-features-plan)

---

## Milestones

### M1 Rewrite family: variants, prompts, structure check

**Recommended model: Sonnet** (pure logic with a precise spec).

> Workers must complete ALL items in this list. Do not skip items that seem lower priority; note any you believe should be deferred in your summary and let the orchestrator decide.

- [x] `ai/prompts/rewrite.ts`: extend `AiRewriteVariant` with `simpler`, `formal`, `casual`, `expand`, `explain`, `readingLevel`, `translate`. Add `group: 'length' | 'tone' | 'audience' | 'translate' | 'explain' | 'custom'` and `output: 'replace' | 'readOnly'` to `AiRewriteVariantDefinition`; `explain` is `readOnly`. Keep `AI_REWRITE_VARIANTS` order as the menu order.
- [x] Parameterised variants: `RewritePromptInput` gains `params?: { language?: string; audience?: AiAudience }`; `AiAudience = 'general' | 'expert' | 'plain' | 'grade8' | 'esl'` with label and instruction text each (`AI_AUDIENCES`). `rewriteInstruction` renders the instruction with the parameter; a missing parameter falls back to `fixFlow` like `custom` does today.
- [x] Translation prompt: a dedicated system-prompt addendum (keep headings, list markers, tables, links and image URLs, inline and fenced code, `[[wikilinks]]`, `#tags`, math, footnote markers and frontmatter keys verbatim; translate only prose, alt text and link text; keep the markdown line structure). Scope `selection` or `document`; for `document`, the input is the body without frontmatter.
- [x] `ai/prompts/explain.ts`: `buildExplainMessages({ selection, before, after, title })` and `explainMaxTokens`; output is plain markdown prose, no echo of the passage.
- [x] Structure post-check `checkMarkdownStructure(original, result): StructureDiff` in `ai/prompts/structureCheck.ts` (pure): counts of headings by level, fenced code blocks, inline code spans, links and images by URL, list items, table rows, wikilinks, footnote references. Returns the mismatches as human sentences ("2 links in the original, 1 in the result"). Used by translate and tone variants to show a warning line before Accept; never blocks Accept.
- [x] `rewriteMaxTokens` per variant: `expand` and `translate` like `longer` (×3), `explain` fixed 600 default, `simpler`/`formal`/`casual` ×1.8.
- [x] Export everything through `ai/index.ts`. `npm run lint`, `npm run test:unit` green. Commit.

**Acceptance criteria**

- `buildRewriteMessages` for each new variant produces a system and user message pair that contains the instruction, the fenced passage and the context, and for `translate` names the target language exactly once.
- `checkMarkdownStructure` reports zero mismatches for an identical pair and the right counts for a fixture with a dropped link and a dropped code fence.
- No DOM or editor imports in `ai/prompts/*` or `ai/structureCheck.ts`.

[Return to Top](#ai-writing-features-plan)

### M2 Rewrite family UI: grouped menu, pickers, Explain, whole document

**Recommended model: Opus** (front-end interaction design in the popover and menus).

> Workers must complete ALL items in this list. The grouped menu and pickers should feel like Apple Notes' Writing Tools: short labels, a thin separator per group, the remembered choice shown as the default. Decorations only; one transaction on Accept; every new request aborts the last one.

- [x] `ai-rewrite.ts` choose phase and bubble submenu render `AI_REWRITE_VARIANTS` grouped by `group`, with group headings or separators (Length, Tone, Audience, Translate, Explain, then Custom prompt…). Keyboard navigation and `aria-*` as today.
- [x] Second-level pickers (D3): `readingLevel` opens the audience list; `translate` opens the language list (D17: up to three recents first, deduplicated, then English, Spanish, French, German, Portuguese, Italian, Dutch, Japanese, Chinese (Simplified), Korean, Arabic, Hindi, then "Other…" free text stored as typed) plus a "Whole document" toggle. Choice remembered through `ai-prefs.ts` (D10: `localStorage` behind try/catch like `emojipicker.ts` recents, never required). Esc returns to the first level.
- [x] `contextmenu.ts`: the `aiRewrite` hook returns the grouped structure; render it as one submenu with separators (the existing submenu renderer), pickers open the popover in choose phase pre-focused on the picker rather than nesting a third menu level.
- [x] Explain (`readOnly` mode, D2): footer shows Insert below, Retry, Copy; Insert below inserts a blockquote after the target's block in one transaction (rich mode) or after the selection's line in source mode; the selection highlight stays until close. Title reads "Explain".
- [x] Translate whole document (`replaceDocument` mode): target built from the whole body (frontmatter stripped and restored by the existing `extractFrontmatter`/`restoreFrontmatter` path); Accept replaces the document content in one transaction with `closeHistory` so one undo restores it; the same transaction puts the cursor at the start of the body and scrolls to the top (D13); side-by-side view off (too long), new text only with a coverage note when the document was truncated by the context budget (M4's `documentBudget`; until M4 lands, send the whole body and rely on `contextOverflow`).
- [x] Structure warning: after the stream ends, run `checkMarkdownStructure` for `translate`, `simpler`, `formal`, `casual`, `expand`; show mismatches as a small warning line above the footer ("Check: 1 link missing in the result"). Accept stays enabled.
- [x] `editor.ts`: `startAiRewrite(variant?, params?)` accepts the parameters; command union in `types.ts` gains `aiExplain` and `aiTranslate` (open the popover on that variant). Touch nothing in `buildCondensedToolbar`, `toolbar-dropdown.ts` or the toolbar registry; the AI toolbar menu entry keeps opening the choose phase, no submenus (D14).
- [x] Source mode: all variants work on the CodeMirror selection through the existing `sourceRewriteTarget`; Explain's Insert below and whole-document translate have CM equivalents (one CM transaction each).
- [x] `styles/ai.css`: group headings, picker list, warning line, read-only footer. Respect the VS Code theme variables already used.
- [x] `npm run lint`, `npm run test:unit` green. Commit.

**Acceptance criteria**

- Each variant is reachable from the bubble, the context menu and the AI menu's "Rewrite selection…" in three clicks or fewer; the remembered language and audience are preselected on the next use.
- Explain never changes the document unless Insert below is clicked; then one `Cmd+Z` removes the inserted blockquote.
- Whole-document translate on a document with frontmatter keeps the YAML byte-identical, leaves the cursor at the start of the body, and restores everything with one undo.
- No `editor.view.dom` writes; the existing `ai-rewrite.test.ts` suite still passes.

[Return to Top](#ai-writing-features-plan)

### M3 Thinking dial per request

**Recommended model: Opus** (a small control in the popover header plus three hosts of plumbing).

> Workers must complete ALL items in this list. The control is a compact segmented pill ("Thinking: Off · Low · Med · High") that matches the engine badge's height; hidden when the served kind has no mapping.

- [x] `ai/types.ts`: `AiCompletionRequest.requestOverrides?: Record<string, unknown>` (per-request, merged over the model's configured `requestOverrides` by the host; request wins). Document it in the protocol comment at the top of `editor-main.ts`.
- [x] `ai-request.ts`: `AiRunRequest.thinking?: AiThinkingLevel | null`; when set and the route's engine kind has choices, send `requestOverrides = withThinkingLevel(kind, undefined, level, { local })` (only the thinking fields; the host merges).
- [x] VS Code `src/ai/engineService.ts` + `providers/*`: merge `request.requestOverrides` over the model's overrides when building the body; protocol test in `test/unit/ai-protocol.test.ts` for the merge order.
- [x] Desktop: `commands/ai.rs` accepts `request_overrides` and merges the same way; `aiHost.ts` passes it through; one cargo fixture test.
- [x] Website stub host (`website/`) ignores it gracefully (tier 1).
- [x] Popover: control in the header when `thinkingChoices(kind)` for the route's engine is non-empty; initial value from `thinkingLevelFrom(kind, model.requestOverrides)`; a change re-runs (same as Retry) and is remembered for the session per kind in `ai-prefs.ts` (memory only, not `localStorage`). The badge title names the level that served ("oMLX · Qwen3 30B · thinking: low").
- [x] `npm run lint`, `npm run test:unit`, `cargo test` (desktop) green. Commit.

**Acceptance criteria**

- Changing the level and pressing Retry sends a body whose thinking fields match `thinkingOverrides(kind, level)` on both hosts (asserted by the protocol/fixture tests).
- The control is absent for a kind with no mapping and for a tier-1 host.

[Return to Top](#ai-writing-features-plan)

### T1 Rewrite family and thinking dial tests

**Recommended model: Sonnet.** Modes: unit (vitest, node), DOM (vitest jsdom), live opt-in.

- [x] `packages/core/test/ai-rewrite-variants.test.ts`: every variant builds messages; `translate` and `readingLevel` render the parameter; missing parameter falls back; `rewriteMaxTokens` ranges; `explain` messages do not ask to rewrite.
- [x] `packages/core/test/ai-structure-check.test.ts`: identical pair, dropped link, dropped fence, changed list marker, heading level change, table row count; wikilinks and footnotes counted.
- [x] `packages/core/test/ai-rewrite.test.ts` (extend): grouped choose phase renders all groups; picker opens and remembers (mock `localStorage`); Explain mode footer has Insert below and no Accept; Insert below adds one blockquote and one undo removes it; whole-document translate keeps frontmatter and undoes in one step; structure warning line appears for a fixture with a dropped link.
- [x] `test/unit/ai-protocol.test.ts` and the Desktop fixture: `requestOverrides` merge order (request over model), `thinking` absent leaves the body unchanged.
- [x] `test/live/ai-live.test.ts`: one 40-token `translate` (to Spanish) of a two-line markdown fixture with a link, asserting the link URL survives, and one `explain`; skipped unless `MIKEDOWN_AI_LIVE=1`.
- [x] `npm run test:unit`, `npm run test:edge`, `npm run test:packages` green; run `MIKEDOWN_AI_LIVE=1 npm run test:ai-live` if oMLX is up and record the result in the Progress Log (skip is a result, not a failure). Commit.

[Return to Top](#ai-writing-features-plan)

### M4 Document understanding core: prompts, lenient JSON, document budget

**Recommended model: Sonnet** (pure logic; well specified).

> Workers must complete ALL items in this list.

- [x] `ai/json.ts`: `parseLenientJson<T>(raw): { ok: true; value: unknown } | { ok: false; error: string }` as specified in Architecture; `jsonRepairMessages(previousRaw, error)` builds the one-shot repair turn; `JSON_SHAPE_HINT(example)` helper for prompts.
- [x] `ai/documentBudget.ts`: `budgetDocument(markdown, { contextTokens, outputTokens, reserveTokens }): { text, coverage: number, truncated: boolean, sectionsIncluded, sectionsTotal }`. Splits on ATX headings, always keeps frontmatter and the first block, adds whole sections from the top until the budget (chars ÷ 3.5) is spent. Also `headingsOutline(markdown)` (levels and texts only) for `/title` and Properties.
- [x] `ai/prompts/summary.ts`: `buildSummaryMessages({ document, kind: 'tldr' | 'outline', coverage })` with a system prompt that returns markdown only: TL;DR as 3 to 6 bullets (or one paragraph for short documents), Outline as a nested list of proposed or actual headings. `summaryMaxTokens(kind, inputChars)`. `finalizeSummary(raw, kind)` reuses `rewriteVisibleText` and wraps TL;DR in a `[!NOTE]` callout whose first line is **Summary** (D11; Outline stays a plain nested list) and appends "Covers the first N% of the document." when truncated.
- [x] `ai/prompts/title.ts`: `buildTitleMessages({ document, outline, existingTitle?, count: 3 })` asking for `{ "titles": ["…", "…", "…"] }`; `parseTitles(raw)` through `parseLenientJson`, dedupes, trims to 120 chars, drops ones equal to the existing title.
- [x] `ai/prompts/properties.ts`: `buildPropertiesMessages({ document, outline, existing: FrontmatterEntry[], vocabulary: string[] })` asking for `{ "title": "…", "description": "…", "tags": ["…"] }`, with the vocabulary listed as "prefer these existing tags"; `parsePropertySuggestions(raw, existing, vocabulary)` normalises tags through `tagSyntax` helpers, marks each tag `known: boolean`, drops tags already present, caps at 8 tags and a 200-char description.
- [x] Tasks and features: `summarize.requires = { chat: true }` and `structure.requires = { chat: true }` with a new optional `prefers?: AiCapabilityRequirements` (`structure.prefers = { json: true }`, `summarize.prefers = { contextTokens: SUMMARIZE_MIN_CONTEXT_TOKENS }`); `router.ts` orders fallback candidates so preferred ones come first and never rejects on `prefers`. Features: `summary` and `frontmatter` → `status: 'available'`; add `title` (available, task `structure`, `requires: { chat: true }`). Update the AI tab copy if it lists statuses.
- [x] `AiErrorCode` gains `badOutput` ("The model did not return a usable answer. Try again or pick another model.") in `errors.ts`.
- [x] Fixtures: `test/ai-fixtures/outputs/` with real-looking local-model replies (clean JSON, JSON in a fence, JSON after prose, `<think>` prefix, trailing comma, single quotes, plain text). Add a README line.
- [x] `npm run lint`, `npm run test:unit` green. Commit.

**Acceptance criteria**

- `parseLenientJson` accepts every fixture except plain text, which yields `ok: false` with a message.
- `budgetDocument` on a 60k-char fixture with `contextTokens: 8192` returns whole sections, `truncated: true`, coverage between 0 and 1, and never splits inside a fenced code block.
- Router: a model without `json` is usable for `structure`; with two candidates, the `json` one is chosen first.

[Return to Top](#ai-writing-features-plan)

### M5 `/summary` and `/title`

**Recommended model: Opus** (popover modes and slash integration are user-facing).

> Workers must complete ALL items in this list. `/summary` should feel like Notion's "Summarize": the popover appears at the cursor line, streams, and a single Insert puts a tidy block in place. Decorations only; the inserted block is one transaction that also removes `/query`.

- [x] `slashcommands-registry.ts`: new group `'ai'` with `summary` (aliases `tldr`, `summarize`), `outline`, and `title` (aliases `titles`, `heading`); icon key `ai`. `slashcommands.ts` renders the group last, labelled "AI"; the entries are hidden through `setSlashHiddenCommands` whenever the feature's availability is not `available` (D15: hidden and disabled both hide; the router's reason lives in the AI toolbar menu hints, not in the slash menu). No disabled-entry rendering is added to `slashcommands.ts`.
- [x] `slashcommands-actions.ts`: `summary`/`outline` open the popover in `insert` mode anchored at the cursor block (new `cursorInsertTarget(editor)` in `ai-rewrite.ts`: `accept(markdown)` parses markdown and inserts at the block boundary, removing `/query` in the same transaction, picker-pattern cancel semantics). `title` opens `choose` mode.
- [x] Popover `insert` mode: title "Summary" or "Outline", footer Insert, Retry, Copy; a small toggle TL;DR ⇄ Outline in the header re-runs. Coverage note shown when `truncated`.
- [x] Popover `choose` mode for `/title`: three candidates as a list (keyboard navigable), Retry regenerates; clicking one: if the document has a frontmatter `title:` set it through `applyFrontmatterEdit` and leave any H1 alone (D12); else if an H1 exists replace its text in one transaction; else insert an H1 at the top. A one-line hint under the list names the effect before the click ("Sets title: in Properties", "Replaces the H1", "Inserts an H1"). `/query` removal joins the same undo step where ProseMirror is involved (follow the `properties` action's undo-depth pattern for the frontmatter case).
- [x] AI toolbar menu (`ai-toolbar.ts`, pure): flat entries "Summarize document…", "Suggest titles…" after "Rewrite selection" and before the separator, each `{ enabled } | { enabled: false; hint }` like `rewrite` (D14: no submenus; D15: this hint is where the router's reason shows when the slash group is hidden); `editor.ts#openAiToolbar` passes the availabilities and callbacks (small, non-toolbar-registry change; see sequencing).
- [x] Both commands use `documentBudget` with the routed model's `contextTokens`; `summary` feature uses `summarize`, `title` uses `structure`. JSON contract from M4 applies to `/title` only: one repair retry, abortable, footer reads "Fixing the answer format…" while it runs (D16); `/summary` never retries. `badOutput` error shows "Try again" and "Open AI settings".
- [x] Source mode: `/summary` and `/title` are available from the AI menu only (slash menu is rich-text today); insert at the CM cursor line, one CM transaction.
- [x] Commands `aiSummarize`, `aiSuggestTitle` in the `types.ts` union and `editor.ts` switch.
- [x] `npm run lint`, `npm run test:unit` green. Commit.

**Acceptance criteria**

- Typing `/sum` offers Summary; Enter opens the popover at the cursor; Insert produces one block and one undo removes it and restores `/summary`.
- `/title` on a document with frontmatter writes `title:` and the Properties sidebar updates, the H1 (if any) is untouched; on a document without frontmatter the H1 changes; one undo reverts either.
- With AI off, or AI on and no route, the `ai` slash group is absent; in the no-route case the AI menu's "Summarize document…" and "Suggest titles…" are disabled with the router's reason.

[Return to Top](#ai-writing-features-plan)

### M6 Properties suggestions

**Recommended model: Opus** (sidebar UI).

> Workers must complete ALL items in this list. Chips should look like the existing tag pills with a dashed outline for "suggested"; a known tag shows as is, a new tag gets a small "new" mark; title and description chips are single-line with ellipsis and a title tooltip for the full text. Nothing applies without a click.

- [x] `outlineSidebar.ts`: a Suggest button (sparkle icon, `aria-label="Suggest properties with AI"`) at the right of the Properties header, shown only when the `frontmatter` feature availability is not `hidden`, disabled with the router's reason tooltip when `disabled`. Options gain `onSuggestProperties?: () => void` and the handle gains `applyPropertySuggestions(s: PropertySuggestions | null, state: 'idle' | 'running' | 'error', message?)`.
- [x] Chips row under the Properties list: while running, a thin progress line and the engine badge text; on result, chips for title, description and each tag with a dismiss (×) each and "Dismiss all"; on error, the `aiErrorCopy` line with "Try again".
- [x] `editor.ts` wiring beside `onPropertiesChange`: runs `runAiCompletion` with `buildPropertiesMessages` (document through `documentBudget`, outline from `headingsOutline`, vocabulary from the last `setTags` payload, existing entries from `frontmatterContent`); parses with `parsePropertySuggestions`; one repair retry, abortable, chips row reads "Fixing the answer format…" while it runs (D16); result into the sidebar. Aborts on a new run, on document switch and on dispose.
- [x] Applying a chip calls `applyFrontmatterEdit` with the merged entries (tags appended to the existing `tags` list or array form, title/description set or replaced). If the document has no frontmatter, the first applied chip creates it (reuse `insertEmptyFrontmatter` then edit, as one logical step; the `properties` slash action shows the undo pattern). Each click is one undo step; the chip disappears once applied.
- [x] Source mode: the sidebar is read-only for properties there today; Suggest is disabled with "Switch to rich text to apply suggestions" (or applies by editing the YAML text in one CM transaction if the existing code already supports it; record which).
- [x] `styles/sidebar.css` (or where tag pills live): suggested chip styles, light and dark.
- [x] `npm run lint`, `npm run test:unit` green. Commit.

**Acceptance criteria**

- Clicking Suggest on a document with body text yields chips within the engine's latency; a known tag renders without the "new" mark; clicking a tag chip adds it to `tags:` and the frontmatter block in the editor shows it; one undo removes it.
- Suggest is absent when AI is off and disabled with a reason when no route serves `structure`.
- No automatic run on open, save or edit.

[Return to Top](#ai-writing-features-plan)

### T2 Document bundle tests and live run

**Recommended model: Sonnet.** Modes: unit (vitest), DOM (jsdom), live opt-in.

- [x] `packages/core/test/ai-json.test.ts`: every fixture in `test/ai-fixtures/outputs/`; repair message quotes the error.
- [x] `packages/core/test/ai-document-budget.test.ts`: fits, truncates on section boundaries, never splits a fence, coverage math, frontmatter always kept, `headingsOutline` shape.
- [x] `packages/core/test/ai-summary-title-properties.test.ts`: prompt builders include the shape hint and the vocabulary; `parseTitles` dedupe and cap; `parsePropertySuggestions` normalises `#Tag` and `tag`, marks known/new, drops existing.
- [x] `packages/core/test/ai-router.test.ts` (extend): `structure` usable without `json`; `prefers` ordering; `summarize` usable at 8k.
- [x] `packages/core/test/slashcommands*.test.ts` (extend): `ai` group present only when provided, hidden for both `hidden` and `disabled` availability (D15), `/sum` ranking.
- [x] `packages/core/test/ai-rewrite.test.ts` (extend) or new `ai-insert-modes.test.ts`: `insert` mode inserts one block and removes `/query` in one undo; `choose` mode sets `title:` vs H1 correctly.
- [x] `packages/core/test/outlineSidebar*.test.ts` (extend): Suggest button visibility, chips render, apply calls `onPropertiesChange` with merged entries, dismiss.
- [x] `test/live/ai-live.test.ts`: one `structure` call asking for `{"titles": [...]}` on a fixture and asserting `parseTitles` yields at least one; one short `summarize` call; skipped unless live.
- [x] `npm run test:unit`, `npm run test:edge`, `npm run test:packages` green; live run attempted and recorded. Commit.

[Return to Top](#ai-writing-features-plan)

### M7 Host commands, docs, release notes

**Recommended model: Haiku** (mechanical wiring and docs).

> Workers must complete ALL items in this list. Do not publish, tag or push.

- [x] VS Code: `package.json#contributes.commands` + command palette and editor context `when` clauses (`config.mikedown.ai.enabled`) for `mikedown.ai.explain`, `mikedown.ai.translate`, `mikedown.ai.summarize`, `mikedown.ai.suggestTitle`, `mikedown.ai.suggestProperties`; `src/extension.ts` forwards each as `{ type: 'command', command: … }`. No new keybindings by default (Rewrite keeps `Cmd+Option+K`).
- [x] Desktop: `packages/desktop/src/menu/shortcuts.ts` editor entries for the same commands (key-free), under the existing AI menu.
- [x] `package.json#contributes.configuration` `mikedown.ai.features` description: list the new feature ids (`title`) if the schema enumerates them; otherwise confirm the open map already accepts it. No other settings change (record "no new settings" in the summary; if any were added, verify the three places).
- [x] `CHANGELOG.md`: npm family entry (new prompt modules, `requestOverrides` on the request, relaxed `summarize`/`structure` gates, popover modes) and extension entry (rewrite variants, Explain, Translate, thinking dial, `/summary`, `/title`, Properties Suggest; all experimental, off by default).
- [x] `README.md` (extension) and `website/vscode/` AI section: one paragraph per bundle; `packages/core/README.md`: the `requestOverrides` field and the new feature ids for host authors.
- [x] `CLAUDE.md` architecture lines: `ai/prompts/*`, `ai/json.ts`, `ai/documentBudget.ts`, `ai-prefs.ts`.
- [x] `npm run lint`, `npm run test:unit` green. Commit.

[Return to Top](#ai-writing-features-plan)

### T3 Hands-on: VS Code and Desktop against oMLX

**Mode: hands-on (Mike).** One pass, both hosts, no screenshots. The orchestrator pauses here for sign-off.

Setup: oMLX running at `http://127.0.0.1:8000/v1` with a 7B+ instruct model enabled and routed as default (AI Engines page). VS Code: `npm run dev` from the repo root, open `test/workspace/` and a document with headings, a link, a code block and frontmatter with `tags:`. Desktop: `npm run tauri dev` in `packages/desktop/` (or the current dev command in its README), open the same folder.

Checklist, in each host:

- [ ] Select a paragraph → bubble → Rewrite → Tone → Formal: preview streams, engine badge says local, Accept replaces, one `Cmd+Z` restores.
- [ ] Same selection → Audience → Grade 8: picker remembers Grade 8 on the second use.
- [ ] Selection with a link → Translate → Spanish: link URL unchanged; the structure warning does not appear (or appears and is accurate).
- [ ] Translate → Whole document: frontmatter unchanged, body translated, one undo restores.
- [ ] Explain: popover is read-only; Insert below adds a blockquote; undo removes it.
- [ ] Thinking control: visible for the oMLX model, change to High + Retry; the output channel line (VS Code) or Desktop log shows the thinking fields.
- [ ] `/summary` in an empty paragraph: TL;DR streams; toggle to Outline; Insert; undo restores `/summary`.
- [ ] `/title` on a document with `title:` in frontmatter: three candidates, pick one, Properties sidebar updates; undo.
- [ ] Properties → Suggest: chips appear; a known workspace tag has no "new" mark; apply one tag and the description; undo each.
- [ ] Turn AI off in Settings: bubble items, `ai` slash group, Suggest button and the AI menu entries disappear; turn it on with no usable route: the `ai` slash group stays hidden, the AI menu entries and the Suggest button are disabled with a reason (D15).
- [ ] Source mode: Formal and Translate on a CM selection; Explain's Insert below; AI menu Summarize inserts at the cursor line.

Sign-off: Mike records the result (pass, or the list of failures) in the Progress Log; failures become gap-fill prompts.

[Return to Top](#ai-writing-features-plan)

---

## Open Questions

All resolved on 2026-10-28; the decisions are D10 to D17 above and are already folded into the milestones. The numbering stays so references keep working.

| # | Question | Resolution |
|---|---|---|
| OQ1 | Where the remembered picker choices live. Core has no host state API (`host.ts` exposes only `sidebarPrefs`; `editor.ts` does not use `localStorage`). | Resolved → D10 |
| OQ2 | Callout type for the inserted summary. `callout-node.ts` supports the GFM set only (NOTE, TIP, IMPORTANT, WARNING, CAUTION). | Resolved → D11 |
| OQ3 | `/title` when both an H1 and a frontmatter `title:` exist. | Resolved → D12 |
| OQ4 | Whole-document translation replaces the entire body in one transaction, which also drops selection and scroll position. | Resolved → D13 |
| OQ5 | `toolbar-dropdown.ts` has no submenu support, so the AI toolbar menu cannot show grouped variants inline. | Resolved → D14 |
| OQ6 | Slash menu entries that are disabled (AI on, no route) vs hidden. | Resolved → D15 (`setSlashDisableHandler` turned out to be the "Turn off slash commands" row, not disabled-entry support) |
| OQ7 | Repair retry cost on slow local models (a second full round trip). | Resolved → D16 |
| OQ8 | Language list contents and order. | Resolved → D17 |

[Return to Top](#ai-writing-features-plan)

---

## Follow-ups

1. **Per-task model benchmark (Mike, 2026-10-28).** A "Benchmark" action on the AI Engines page that runs a fixed case per task (`rewrite`, `summarize`, `structure`, `vision`, `notes`…) against every enabled local model, records latency to first token, tokens per second and total time, shows the outputs side by side for a one-click quality rating (good / ok / bad), and stores results per model and task so the routing pickers can show "fastest good model" hints. Motivation: a light model (Gemma) can be the best OCR or vision model and still lose to Qwen on meeting notes; today that is discovered by hand. This plan prepares for it: every prompt builder is pure and parameterised, and `test/ai-fixtures/` gains inputs per task that the benchmark can reuse as its cases. Own plan: `ai-model-benchmark-plan.md`.
2. **Chunk-then-merge summaries** for documents beyond the context window (replaces the coverage note from D9).
3. **Reading grade in the status bar** (pure code extension of `wordCount`, idea 19's first half) linking to the Audience picker.
4. **"Also rename heading" from `/title`** through `headingRename.ts` so links stay valid (D12).
5. **Host state API** (`getState/setState`) if `localStorage` proves unreliable for remembered choices (D10).
6. **Meeting notes to action items** (`/actions`, idea 13), **paste cleanup** (16) and **Mermaid/table generation** (9): the rest of the engines plan's follow-up 4, each one prompt module plus a popover mode on the machinery built here.
7. Ghost text, chat with this document, alt text, grammar and consistency review, workspace RAG, dictation: unchanged, their own plans.
8. **Disabled slash entries.** If a later plan gives `slashcommands.ts` a greyed-with-reason row, the `ai` group should use it instead of hiding when `disabled` (D15).
9. **Split AI code out of the standalone web component bundle** (budget raised 850 → 900 kB on 2026-10-28 to absorb this plan).

[Return to Top](#ai-writing-features-plan)

---

## Parallel Development Recommendations

**The customizable toolbar orchestrator** (`customizable-toolbar-plan.md`) owns `packages/core/src/editor.ts` toolbar code and the Settings modal while its M3 runs; its M1 (registry) has landed on `develop` (`60b4bc7`, `02cc9ae`), M2 is in progress and M3 touches `editor.ts` and the Settings modal next. Rules for this plan:

- Nothing here edits `buildCondensedToolbar`, `toolbar-registry.ts`, `toolbar-ids.ts`, `toolbar-overflow.ts` or the Settings modal tabs.
- Milestones that edit `editor.ts` at all (M2: `startAiRewrite` signature and command cases; M3: popover deps; M5: `openAiToolbar` entries, slash wiring, command cases; M6: Properties wiring) run **after the toolbar plan's M3 has merged to `develop`**, or in a worktree that rebases onto `develop` before commit, and never two of them at once. The `openAiToolbar` change in M5 is the one spot adjacent to toolbar code; keep it to passing two more callbacks.
- Pure milestones (M1, M4) touch no shared file and can start now.

Groups:

- **Group A (now, parallel):** M1 (`ai/prompts/*`, `ai/structureCheck.ts`) and M4 (`ai/json.ts`, `ai/documentBudget.ts`, `ai/prompts/summary|title|properties.ts`, `tasks.ts`, `features.ts`, `router.ts`, `errors.ts`, fixtures). Disjoint files; both export through `ai/index.ts`, so whichever lands second rebases.
- **Sequential:** M2 after M1 (and after toolbar M3 or in a worktree). M3 after M2 (same file, `ai-rewrite.ts`). T1 after M3.
- **Group B (after M4 and M2, parallel if in separate worktrees):** M5 (`slashcommands-*`, `ai-toolbar.ts`, `ai-rewrite.ts` insert/choose modes, `editor.ts`) and M6 (`outlineSidebar.ts`, sidebar CSS, `editor.ts`). Both touch `editor.ts` and M5 touches `ai-rewrite.ts`; prefer M5 then M6 unless worktrees are used. Workers list each other's files in their prompts.
- **Then:** T2, M7 (docs can start as soon as M5 and M6 names are fixed), T3 last.

Orchestrator context: with two parallel workers the orchestrator should suggest `/compact` while waiting and resume from `.orchestrator/state.json`.

[Return to Top](#ai-writing-features-plan)

---

## Gap-filling prompts

When a milestone comes back incomplete, the follow-up prompt follows the original prompt's structure (header, mission, plan reference, file ownership), states what was already done and which files changed, lists other active workers and their directories (including the toolbar orchestrator's), commits code before the summary, writes the summary to `.orchestrator/worker-summary-<milestone-slug>-gap.md`, prompts the user to clear the context afterwards, and is labelled "Worker Context: <Milestone> - Gap Fill".

[Return to Top](#ai-writing-features-plan)

---

## Progress Log / Notes

**2026-10-28 19:30** - Plan written after a nine-question interview (D1 to D9, all recommendations accepted). Grounded in `ai-inference-engines-plan.md` (follow-ups 1, 4, 11), `ai-copilot-brainstorm.md` (ideas 2, 4, 7, 12, 14, 19, 20 and constraints 4, 5, 7, 8), `packages/core/src/ai/` (tasks, features, router, thinking, prompts/rewrite), `ai-rewrite.ts` (targets, popover deps, bubble), `ai-request.ts`, `ai-toolbar.ts`, `slashcommands-registry.ts`/`-actions.ts`, `outlineSidebar.ts` (Properties, `applyTags`), `test/live/ai-live.test.ts`, and `customizable-toolbar-plan.md` (M1 landed, M3 pending). Mike added the per-task model benchmark idea mid-planning; recorded as Follow-up 1 with this plan's fixtures made reusable for it.

**2026-10-28 (later)** - OQ1 to OQ8 resolved as D10 to D17 and folded into M2, M4, M5, M6, T2 and T3. Code checks behind them: `emojipicker.ts` already keeps recents in `localStorage` with try/catch (D10 follows it); `CALLOUT_KINDS` is the GFM five (D11); `headingRename.ts` is detection only, so renaming the H1 from `/title` stays Follow-up 4 (D12); `toolbar-dropdown.ts` has actions, separators and mini-rows but no submenus (D14); `setSlashDisableHandler` is the "Turn off slash commands" row, so the slash menu has no disabled-entry rendering and the `ai` group hides instead (D15, Follow-up 8). Nothing left open for Mike.

**2026-10-28 20:45** - M1 done (`bd4753f`, Sonnet, 15 min). Seven new variants with `group`/`output`/`param`, `AI_AUDIENCES`, translate addendum with `scope`, `ai/prompts/explain.ts`, `ai/prompts/structureCheck.ts`; prompts now exported from `@mikedown/core/ai`. 2466 unit tests pass. Notes: `readingLevel` uses ×1.6 tokens (not specified); the structure check skips setext headings and reference-style link uses. Until M2 lands, the new variants already appear ungrouped in the context menu and the choose phase.

**2026-10-28 20:50** - M4 done (worktree commit `eb1d4bc`, cherry-picked as `a209aef`, Sonnet, ~15 min). `ai/json.ts` (`parseLenientJson`, `jsonRepairMessages`, `JSON_SHAPE_HINT`), `ai/documentBudget.ts` (`budgetDocument`, `headingsOutline`), summary/title/properties prompt modules, `prefers` on tasks with router ordering, `summary`/`frontmatter` available, new `title` feature, `badOutput` error, nine output fixtures. 2487 unit tests in the worktree; the AI suites pass on develop after the merge. Notes: the user's chosen route is kept when usable even without JSON (`prefers` only orders fallbacks); `frontmatter` feature's own `json` requirement was dropped too; `finalizeSummary(raw, kind, coverage?)` takes coverage as a third argument; callers own the one repair round trip, then throw `badOutput`.

**2026-10-28 20:55** - M2 done (`db72be1`, Opus, 12 min). Grouped choose phase, bubble and context menu (`aiRewriteMenuGroups`), audience and language pickers with `ai-prefs.ts` (`localStorage`, try/catch), Explain read-only mode with Insert below, whole-document translate (`richDocumentTarget`/`sourceDocumentTarget`, one undo, caret to body start), structure warning line, `aiExplain`/`aiTranslate` commands. 2523 unit tests pass, lint 0 errors, both tsconfigs clean. Deviations: styles went in `styles/ai-rewrite.css` (where the popover styles already live), not `ai.css`; "Whole document" is not remembered (deliberate); `ContextMenuActions.aiRewrite` now requires `groups`; whole-document output uses a local `documentMaxTokens` (1024 to 16384). Open: the `budgetDocument` coverage note for whole-document translate (`TODO(M4)` in `ai-rewrite.ts#start`) goes to M5; `simpler` sits in the Length group, D1 puts it under Tone (fixed in M3).

**2026-10-28 21:05** - M3 done (`da0789d`, Opus, 10 min). `requestOverrides` on the request, merged body → model → request in core's shared `buildCompletionBody` (used by every VS Code adapter) and in Rust `build_completion_body`; segmented thinking pill left of the engine badge, session level per kind in `ai-prefs.ts` (memory only); `simpler` moved to Tone (M2 gap). 2549 unit tests, `cargo test` (188 + 26 + 7), desktop and website vitest green. Deviations: `thinkingRequestOverrides` sends neutral values for thinking fields the model sets but the level omits (a merge cannot delete); the website stub is tier 2 with an openai-compatible engine, so the dial shows on the demo pages (re-streams canned text). Not yet seen in a running editor.

**2026-10-28 21:10** - T1 done (worktree `cc6ce3e`, cherry-picked as `bc9b781`, Sonnet, 6 min). New `ai-rewrite-variants.test.ts` (22) and `ai-structure-check.test.ts` (18), six popover flow tests in `ai-rewrite.test.ts`, thinking-absent cases in `ai-protocol.test.ts` and the desktop cargo tests, `translate` and `explain` live cases. `test:unit` 2605, `test:edge` 22, desktop AI cargo 69 pass. Live run on oMLX (`Qwen3.8-Flash-Next-Uncensored-oQ4e-mtp`): pass, translate 777 ms with the link kept, explain 822 ms; LM Studio and Ollama cases skipped. `test:packages`: 1 failure, the standalone web component is 874099 B gzipped against the 850 kB (870400 B) budget in `test/packages/web-component-shape.test.ts`, grown by M1 to M3; open for Mike. The structure check counts list items but not markers (pinned in a test).

**2026-10-28 21:20** - M5 done (`865c124`, Opus, 16 min). `ai` slash group (`summary`/`tldr`/`summarize`, `outline`, `title`/`titles`) hidden unless available (`syncAiSlashCommands`), `cursorInsertTarget`/`sourceCursorTarget`, popover `insert` mode with TL;DR ⇄ Outline pill and coverage note, `choose` mode with effect hints and one repair retry, flat AI menu entries, `aiSummarize`/`aiSuggestTitle` commands, source-mode paths; M2's whole-document translate now budgets through `budgetTranslation` and appends the untranslated rest on Accept. `test:unit` 153 files green on develop after the T1 merge; lint 0 errors. Deviations: `heading` is a keyword, not an alias (would outrank Heading 1); `matchCommands` now ranks an exact id above an exact alias; the frontmatter title edit rewrites only the `title:` line; "Suggest titles…" from the AI menu on a document with `title:` is not undoable (no PM transaction), handed to M6 with the chip undo work; the budget uses the route at open, not a fallback's.

**2026-10-28 21:25** - M7 done (worktree `9a8ea2f`, cherry-picked, Haiku, 4 min). Five `mikedown.ai.*` commands in `package.json` (palette, gated on `config.mikedown.ai.enabled`, no keybindings) forwarded in `src/extension.ts`; Desktop key-free rows plus a new Format > AI submenu (no AI menu existed; menu fixtures regenerated); CHANGELOG (extension and `packages/core/CHANGELOG.md` Unreleased), README, core README (`requestOverrides`, feature ids), `website/vscode/` and CLAUDE.md. No new settings (`mikedown.ai.features` is an open map). No editor-context `when` clauses, matching how Rewrite is registered. Desktop typecheck needs M6's `aiSuggestProperties` in the command union.

**2026-10-28 21:30** - M6 done (`56dab62`, Opus, 10 min). Suggest sparkle in the Properties header (hidden when the feature is hidden, disabled with the router's reason), chips row (progress + badge + Cancel, dismissible title/description/tag chips with "new" marks, error with Try again), `startAiPropertySuggestions` in `editor.ts` (budgeted body, outline, tag vocabulary, one abortable repair retry), `aiSuggestProperties` command. Undo: new `frontmatterHistory.ts` keeps frontmatter as a `doc` attribute changed by real PM transactions (`setDocAttribute`), so each chip and M5's AI-menu title pick are one undo step (redo works); M5's undo-depth watcher for the title was removed. Pure merge in `propertySuggestions.ts`. `test:unit` 154 files, 2644 pass; Desktop typecheck now clean with M7. Deviations: Suggest is disabled in source mode ("Switch to rich text…") and when the frontmatter is not simple YAML. Known edge: sidebar typing and `/properties` still bypass PM history, so undoing a chip after a later sidebar edit reverts that edit too.

**2026-10-28 21:35** - VS Code integration tests on develop at `56dab62`: 47 passing. Mike approved raising the standalone web component budget from 850 kB to 900 kB; added to T2. Follow-up: split the AI code out of the standalone bundle.

**2026-10-28 21:40** - T2 done (`eb4494a`, Sonnet, 10 min) plus gap fills `ae1135c` (web component budget 850 → 900 kB, bundle 865.8 kB) and `5f344d7` (`summary.ts#tidy` strips a lead-in before a wrapping fence; a fenced outline after "Here is the outline:" was inserted as a code block). New `ai-summary-title-properties.test.ts` (35), `ai-insert-modes.test.ts` (15), `ai-frontmatter-undo.test.ts` (11, no bug found), extensions to router, slash registry and sidebar tests. `test:unit` 2770, `test:edge` 22, `test:packages` 79/79. Live on oMLX (`Qwen3.8-Flash-Next-Uncensored-oQ4e-mtp`): 12 pass, 14 skipped (LM Studio no chat model, Ollama down); titles 1.1 s, TL;DR callout about 1.1 s, both good. Known limit: `budgetDocument` cuts only on block boundaries, so one huge paragraph or fence is sent whole (`truncated: false`) and can overflow a small window. Next: T3 hands-on (Mike).

[Return to Top](#ai-writing-features-plan)
