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
| [M1 Rewrite family: variants, prompts, structure check](#m1-rewrite-family-variants-prompts-structure-check) | Sonnet | ⬜ Not Started | — | Pure, `ai/prompts/` |
| [M2 Rewrite family UI: grouped menu, pickers, Explain, whole document](#m2-rewrite-family-ui-grouped-menu-pickers-explain-whole-document) | Opus | ⬜ Not Started | — | `ai-rewrite.ts`, `contextmenu.ts`; light `editor.ts` |
| [M3 Thinking dial per request](#m3-thinking-dial-per-request) | Opus | ⬜ Not Started | — | Core wire + VS Code + Desktop + popover control |
| [T1 Rewrite family and thinking dial tests](#t1-rewrite-family-and-thinking-dial-tests) | Sonnet | ⬜ Not Started | — | vitest + live case |
| [M4 Document understanding core: prompts, lenient JSON, document budget](#m4-document-understanding-core-prompts-lenient-json-document-budget) | Sonnet | ⬜ Not Started | — | Pure; relaxes `summarize`/`structure` gates |
| [M5 `/summary` and `/title`](#m5-summary-and-title) | Opus | ⬜ Not Started | — | Slash + AI menu + popover insert mode |
| [M6 Properties suggestions](#m6-properties-suggestions) | Opus | ⬜ Not Started | — | `outlineSidebar.ts` Suggest + chips |
| [T2 Document bundle tests and live run](#t2-document-bundle-tests-and-live-run) | Sonnet | ⬜ Not Started | — | vitest + jsdom + live |
| [M7 Host commands, docs, release notes](#m7-host-commands-docs-release-notes) | Haiku | ⬜ Not Started | — | VS Code commands, Desktop menu, CHANGELOG |
| [T3 Hands-on: VS Code and Desktop against oMLX](#t3-hands-on-vs-code-and-desktop-against-omlx) | — (Mike) | ⬜ Not Started | — | One pass, both hosts |

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
| Remembered picker choices (language, audience, session thinking level) | new `packages/core/src/ai-prefs.ts` | `localStorage` behind try/catch, keyed `mikedown.ai.*`; never a `mikedown.*` setting (D3). |
| Entry points | `ai-rewrite.ts` (bubble), `contextmenu.ts` (`aiRewrite` hook grows to grouped items), `ai-toolbar.ts` (`aiToolbarMenuEntries` gains Summarize, Suggest titles, Explain), `slashcommands-registry.ts` + `slashcommands-actions.ts` (`summary`, `outline`, `title`) | Slash entries hidden when the feature is unavailable (same mechanism as `image` and `properties`). |
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

- [ ] `ai/prompts/rewrite.ts`: extend `AiRewriteVariant` with `simpler`, `formal`, `casual`, `expand`, `explain`, `readingLevel`, `translate`. Add `group: 'length' | 'tone' | 'audience' | 'translate' | 'explain' | 'custom'` and `output: 'replace' | 'readOnly'` to `AiRewriteVariantDefinition`; `explain` is `readOnly`. Keep `AI_REWRITE_VARIANTS` order as the menu order.
- [ ] Parameterised variants: `RewritePromptInput` gains `params?: { language?: string; audience?: AiAudience }`; `AiAudience = 'general' | 'expert' | 'plain' | 'grade8' | 'esl'` with label and instruction text each (`AI_AUDIENCES`). `rewriteInstruction` renders the instruction with the parameter; a missing parameter falls back to `fixFlow` like `custom` does today.
- [ ] Translation prompt: a dedicated system-prompt addendum (keep headings, list markers, tables, links and image URLs, inline and fenced code, `[[wikilinks]]`, `#tags`, math, footnote markers and frontmatter keys verbatim; translate only prose, alt text and link text; keep the markdown line structure). Scope `selection` or `document`; for `document`, the input is the body without frontmatter.
- [ ] `ai/prompts/explain.ts`: `buildExplainMessages({ selection, before, after, title })` and `explainMaxTokens`; output is plain markdown prose, no echo of the passage.
- [ ] Structure post-check `checkMarkdownStructure(original, result): StructureDiff` in `ai/prompts/structureCheck.ts` (pure): counts of headings by level, fenced code blocks, inline code spans, links and images by URL, list items, table rows, wikilinks, footnote references. Returns the mismatches as human sentences ("2 links in the original, 1 in the result"). Used by translate and tone variants to show a warning line before Accept; never blocks Accept.
- [ ] `rewriteMaxTokens` per variant: `expand` and `translate` like `longer` (×3), `explain` fixed 600 default, `simpler`/`formal`/`casual` ×1.8.
- [ ] Export everything through `ai/index.ts`. `npm run lint`, `npm run test:unit` green. Commit.

**Acceptance criteria**

- `buildRewriteMessages` for each new variant produces a system and user message pair that contains the instruction, the fenced passage and the context, and for `translate` names the target language exactly once.
- `checkMarkdownStructure` reports zero mismatches for an identical pair and the right counts for a fixture with a dropped link and a dropped code fence.
- No DOM or editor imports in `ai/prompts/*` or `ai/structureCheck.ts`.

[Return to Top](#ai-writing-features-plan)

### M2 Rewrite family UI: grouped menu, pickers, Explain, whole document

**Recommended model: Opus** (front-end interaction design in the popover and menus).

> Workers must complete ALL items in this list. The grouped menu and pickers should feel like Apple Notes' Writing Tools: short labels, a thin separator per group, the remembered choice shown as the default. Decorations only; one transaction on Accept; every new request aborts the last one.

- [ ] `ai-rewrite.ts` choose phase and bubble submenu render `AI_REWRITE_VARIANTS` grouped by `group`, with group headings or separators (Length, Tone, Audience, Translate, Explain, then Custom prompt…). Keyboard navigation and `aria-*` as today.
- [ ] Second-level pickers (D3): `readingLevel` opens the audience list; `translate` opens the language list (recent first, then a fixed short list of ~12 languages, then "Other…" free text) plus a "Whole document" toggle. Choice remembered through `ai-prefs.ts` (`localStorage`, try/catch, never required). Esc returns to the first level.
- [ ] `contextmenu.ts`: the `aiRewrite` hook returns the grouped structure; render it as one submenu with separators (the existing submenu renderer), pickers open the popover in choose phase pre-focused on the picker rather than nesting a third menu level.
- [ ] Explain (`readOnly` mode, D2): footer shows Insert below, Retry, Copy; Insert below inserts a blockquote after the target's block in one transaction (rich mode) or after the selection's line in source mode; the selection highlight stays until close. Title reads "Explain".
- [ ] Translate whole document (`replaceDocument` mode): target built from the whole body (frontmatter stripped and restored by the existing `extractFrontmatter`/`restoreFrontmatter` path); Accept replaces the document content in one transaction with `closeHistory` so one undo restores it; side-by-side view off (too long), new text only with a coverage note when the document was truncated by the context budget (M4's `documentBudget`; until M4 lands, send the whole body and rely on `contextOverflow`).
- [ ] Structure warning: after the stream ends, run `checkMarkdownStructure` for `translate`, `simpler`, `formal`, `casual`, `expand`; show mismatches as a small warning line above the footer ("Check: 1 link missing in the result"). Accept stays enabled.
- [ ] `editor.ts`: `startAiRewrite(variant?, params?)` accepts the parameters; command union in `types.ts` gains `aiExplain` and `aiTranslate` (open the popover on that variant). Touch nothing in `buildCondensedToolbar` or the toolbar registry; the AI toolbar menu entry keeps opening the choose phase.
- [ ] Source mode: all variants work on the CodeMirror selection through the existing `sourceRewriteTarget`; Explain's Insert below and whole-document translate have CM equivalents (one CM transaction each).
- [ ] `styles/ai.css`: group headings, picker list, warning line, read-only footer. Respect the VS Code theme variables already used.
- [ ] `npm run lint`, `npm run test:unit` green. Commit.

**Acceptance criteria**

- Each variant is reachable from the bubble, the context menu and the AI menu's "Rewrite selection…" in three clicks or fewer; the remembered language and audience are preselected on the next use.
- Explain never changes the document unless Insert below is clicked; then one `Cmd+Z` removes the inserted blockquote.
- Whole-document translate on a document with frontmatter keeps the YAML byte-identical and restores everything with one undo.
- No `editor.view.dom` writes; the existing `ai-rewrite.test.ts` suite still passes.

[Return to Top](#ai-writing-features-plan)

### M3 Thinking dial per request

**Recommended model: Opus** (a small control in the popover header plus three hosts of plumbing).

> Workers must complete ALL items in this list. The control is a compact segmented pill ("Thinking: Off · Low · Med · High") that matches the engine badge's height; hidden when the served kind has no mapping.

- [ ] `ai/types.ts`: `AiCompletionRequest.requestOverrides?: Record<string, unknown>` (per-request, merged over the model's configured `requestOverrides` by the host; request wins). Document it in the protocol comment at the top of `editor-main.ts`.
- [ ] `ai-request.ts`: `AiRunRequest.thinking?: AiThinkingLevel | null`; when set and the route's engine kind has choices, send `requestOverrides = withThinkingLevel(kind, undefined, level, { local })` (only the thinking fields; the host merges).
- [ ] VS Code `src/ai/engineService.ts` + `providers/*`: merge `request.requestOverrides` over the model's overrides when building the body; protocol test in `test/unit/ai-protocol.test.ts` for the merge order.
- [ ] Desktop: `commands/ai.rs` accepts `request_overrides` and merges the same way; `aiHost.ts` passes it through; one cargo fixture test.
- [ ] Website stub host (`website/`) ignores it gracefully (tier 1).
- [ ] Popover: control in the header when `thinkingChoices(kind)` for the route's engine is non-empty; initial value from `thinkingLevelFrom(kind, model.requestOverrides)`; a change re-runs (same as Retry) and is remembered for the session per kind in `ai-prefs.ts` (memory only, not `localStorage`). The badge title names the level that served ("oMLX · Qwen3 30B · thinking: low").
- [ ] `npm run lint`, `npm run test:unit`, `cargo test` (desktop) green. Commit.

**Acceptance criteria**

- Changing the level and pressing Retry sends a body whose thinking fields match `thinkingOverrides(kind, level)` on both hosts (asserted by the protocol/fixture tests).
- The control is absent for a kind with no mapping and for a tier-1 host.

[Return to Top](#ai-writing-features-plan)

### T1 Rewrite family and thinking dial tests

**Recommended model: Sonnet.** Modes: unit (vitest, node), DOM (vitest jsdom), live opt-in.

- [ ] `packages/core/test/ai-rewrite-variants.test.ts`: every variant builds messages; `translate` and `readingLevel` render the parameter; missing parameter falls back; `rewriteMaxTokens` ranges; `explain` messages do not ask to rewrite.
- [ ] `packages/core/test/ai-structure-check.test.ts`: identical pair, dropped link, dropped fence, changed list marker, heading level change, table row count; wikilinks and footnotes counted.
- [ ] `packages/core/test/ai-rewrite.test.ts` (extend): grouped choose phase renders all groups; picker opens and remembers (mock `localStorage`); Explain mode footer has Insert below and no Accept; Insert below adds one blockquote and one undo removes it; whole-document translate keeps frontmatter and undoes in one step; structure warning line appears for a fixture with a dropped link.
- [ ] `test/unit/ai-protocol.test.ts` and the Desktop fixture: `requestOverrides` merge order (request over model), `thinking` absent leaves the body unchanged.
- [ ] `test/live/ai-live.test.ts`: one 40-token `translate` (to Spanish) of a two-line markdown fixture with a link, asserting the link URL survives, and one `explain`; skipped unless `MIKEDOWN_AI_LIVE=1`.
- [ ] `npm run test:unit`, `npm run test:edge`, `npm run test:packages` green; run `MIKEDOWN_AI_LIVE=1 npm run test:ai-live` if oMLX is up and record the result in the Progress Log (skip is a result, not a failure). Commit.

[Return to Top](#ai-writing-features-plan)

### M4 Document understanding core: prompts, lenient JSON, document budget

**Recommended model: Sonnet** (pure logic; well specified).

> Workers must complete ALL items in this list.

- [ ] `ai/json.ts`: `parseLenientJson<T>(raw): { ok: true; value: unknown } | { ok: false; error: string }` as specified in Architecture; `jsonRepairMessages(previousRaw, error)` builds the one-shot repair turn; `JSON_SHAPE_HINT(example)` helper for prompts.
- [ ] `ai/documentBudget.ts`: `budgetDocument(markdown, { contextTokens, outputTokens, reserveTokens }): { text, coverage: number, truncated: boolean, sectionsIncluded, sectionsTotal }`. Splits on ATX headings, always keeps frontmatter and the first block, adds whole sections from the top until the budget (chars ÷ 3.5) is spent. Also `headingsOutline(markdown)` (levels and texts only) for `/title` and Properties.
- [ ] `ai/prompts/summary.ts`: `buildSummaryMessages({ document, kind: 'tldr' | 'outline', coverage })` with a system prompt that returns markdown only: TL;DR as 3 to 6 bullets (or one paragraph for short documents), Outline as a nested list of proposed or actual headings. `summaryMaxTokens(kind, inputChars)`. `finalizeSummary(raw, kind)` reuses `rewriteVisibleText` and wraps TL;DR in a `[!NOTE]`-style callout titled **Summary** (see OQ2 for the callout type) and appends "Covers the first N% of the document." when truncated.
- [ ] `ai/prompts/title.ts`: `buildTitleMessages({ document, outline, existingTitle?, count: 3 })` asking for `{ "titles": ["…", "…", "…"] }`; `parseTitles(raw)` through `parseLenientJson`, dedupes, trims to 120 chars, drops ones equal to the existing title.
- [ ] `ai/prompts/properties.ts`: `buildPropertiesMessages({ document, outline, existing: FrontmatterEntry[], vocabulary: string[] })` asking for `{ "title": "…", "description": "…", "tags": ["…"] }`, with the vocabulary listed as "prefer these existing tags"; `parsePropertySuggestions(raw, existing, vocabulary)` normalises tags through `tagSyntax` helpers, marks each tag `known: boolean`, drops tags already present, caps at 8 tags and a 200-char description.
- [ ] Tasks and features: `summarize.requires = { chat: true }` and `structure.requires = { chat: true }` with a new optional `prefers?: AiCapabilityRequirements` (`structure.prefers = { json: true }`, `summarize.prefers = { contextTokens: SUMMARIZE_MIN_CONTEXT_TOKENS }`); `router.ts` orders fallback candidates so preferred ones come first and never rejects on `prefers`. Features: `summary` and `frontmatter` → `status: 'available'`; add `title` (available, task `structure`, `requires: { chat: true }`). Update the AI tab copy if it lists statuses.
- [ ] `AiErrorCode` gains `badOutput` ("The model did not return a usable answer. Try again or pick another model.") in `errors.ts`.
- [ ] Fixtures: `test/ai-fixtures/outputs/` with real-looking local-model replies (clean JSON, JSON in a fence, JSON after prose, `<think>` prefix, trailing comma, single quotes, plain text). Add a README line.
- [ ] `npm run lint`, `npm run test:unit` green. Commit.

**Acceptance criteria**

- `parseLenientJson` accepts every fixture except plain text, which yields `ok: false` with a message.
- `budgetDocument` on a 60k-char fixture with `contextTokens: 8192` returns whole sections, `truncated: true`, coverage between 0 and 1, and never splits inside a fenced code block.
- Router: a model without `json` is usable for `structure`; with two candidates, the `json` one is chosen first.

[Return to Top](#ai-writing-features-plan)

### M5 `/summary` and `/title`

**Recommended model: Opus** (popover modes and slash integration are user-facing).

> Workers must complete ALL items in this list. `/summary` should feel like Notion's "Summarize": the popover appears at the cursor line, streams, and a single Insert puts a tidy block in place. Decorations only; the inserted block is one transaction that also removes `/query`.

- [ ] `slashcommands-registry.ts`: new group `'ai'` with `summary` (aliases `tldr`, `summarize`), `outline`, and `title` (aliases `titles`, `heading`); icon key `ai`. `slashcommands.ts` renders the group last, labelled "AI", and the entries are hidden through `setSlashHiddenCommands` when the feature's availability is `hidden`, disabled with the router's reason when `disabled` (reuse the disable handler used for `properties` if one exists, else add a hidden-only path and record it).
- [ ] `slashcommands-actions.ts`: `summary`/`outline` open the popover in `insert` mode anchored at the cursor block (new `cursorInsertTarget(editor)` in `ai-rewrite.ts`: `accept(markdown)` parses markdown and inserts at the block boundary, removing `/query` in the same transaction, picker-pattern cancel semantics). `title` opens `choose` mode.
- [ ] Popover `insert` mode: title "Summary" or "Outline", footer Insert, Retry, Copy; a small toggle TL;DR ⇄ Outline in the header re-runs. Coverage note shown when `truncated`.
- [ ] Popover `choose` mode for `/title`: three candidates as a list (keyboard navigable), Retry regenerates; clicking one: if the document has a frontmatter `title:` set it through `applyFrontmatterEdit`; else if an H1 exists replace its text in one transaction; else insert an H1 at the top. `/query` removal joins the same undo step where ProseMirror is involved (follow the `properties` action's undo-depth pattern for the frontmatter case).
- [ ] AI toolbar menu (`ai-toolbar.ts`, pure): entries "Summarize document…", "Suggest titles…" after "Rewrite selection" and before the separator, each `{ enabled } | { enabled: false; hint }` like `rewrite`; `editor.ts#openAiToolbar` passes the availabilities and callbacks (small, non-toolbar-registry change; see sequencing).
- [ ] Both commands use `documentBudget` with the routed model's `contextTokens`; `summary` feature uses `summarize`, `title` uses `structure`; JSON contract from M4 with one repair retry; `badOutput` error shows "Try again" and "Open AI settings".
- [ ] Source mode: `/summary` and `/title` are available from the AI menu only (slash menu is rich-text today); insert at the CM cursor line, one CM transaction.
- [ ] Commands `aiSummarize`, `aiSuggestTitle` in the `types.ts` union and `editor.ts` switch.
- [ ] `npm run lint`, `npm run test:unit` green. Commit.

**Acceptance criteria**

- Typing `/sum` offers Summary; Enter opens the popover at the cursor; Insert produces one block and one undo removes it and restores `/summary`.
- `/title` on a document with frontmatter writes `title:` and the Properties sidebar updates; on a document without frontmatter the H1 changes; one undo reverts either.
- With AI off the `ai` slash group is absent; with AI on and no route the entries are disabled with the router's reason.

[Return to Top](#ai-writing-features-plan)

### M6 Properties suggestions

**Recommended model: Opus** (sidebar UI).

> Workers must complete ALL items in this list. Chips should look like the existing tag pills with a dashed outline for "suggested"; a known tag shows as is, a new tag gets a small "new" mark; title and description chips are single-line with ellipsis and a title tooltip for the full text. Nothing applies without a click.

- [ ] `outlineSidebar.ts`: a Suggest button (sparkle icon, `aria-label="Suggest properties with AI"`) at the right of the Properties header, shown only when the `frontmatter` feature availability is not `hidden`, disabled with the router's reason tooltip when `disabled`. Options gain `onSuggestProperties?: () => void` and the handle gains `applyPropertySuggestions(s: PropertySuggestions | null, state: 'idle' | 'running' | 'error', message?)`.
- [ ] Chips row under the Properties list: while running, a thin progress line and the engine badge text; on result, chips for title, description and each tag with a dismiss (×) each and "Dismiss all"; on error, the `aiErrorCopy` line with "Try again".
- [ ] `editor.ts` wiring beside `onPropertiesChange`: runs `runAiCompletion` with `buildPropertiesMessages` (document through `documentBudget`, outline from `headingsOutline`, vocabulary from the last `setTags` payload, existing entries from `frontmatterContent`); parses with `parsePropertySuggestions`; one repair retry; result into the sidebar. Aborts on a new run, on document switch and on dispose.
- [ ] Applying a chip calls `applyFrontmatterEdit` with the merged entries (tags appended to the existing `tags` list or array form, title/description set or replaced). If the document has no frontmatter, the first applied chip creates it (reuse `insertEmptyFrontmatter` then edit, as one logical step; the `properties` slash action shows the undo pattern). Each click is one undo step; the chip disappears once applied.
- [ ] Source mode: the sidebar is read-only for properties there today; Suggest is disabled with "Switch to rich text to apply suggestions" (or applies by editing the YAML text in one CM transaction if the existing code already supports it; record which).
- [ ] `styles/sidebar.css` (or where tag pills live): suggested chip styles, light and dark.
- [ ] `npm run lint`, `npm run test:unit` green. Commit.

**Acceptance criteria**

- Clicking Suggest on a document with body text yields chips within the engine's latency; a known tag renders without the "new" mark; clicking a tag chip adds it to `tags:` and the frontmatter block in the editor shows it; one undo removes it.
- Suggest is absent when AI is off and disabled with a reason when no route serves `structure`.
- No automatic run on open, save or edit.

[Return to Top](#ai-writing-features-plan)

### T2 Document bundle tests and live run

**Recommended model: Sonnet.** Modes: unit (vitest), DOM (jsdom), live opt-in.

- [ ] `packages/core/test/ai-json.test.ts`: every fixture in `test/ai-fixtures/outputs/`; repair message quotes the error.
- [ ] `packages/core/test/ai-document-budget.test.ts`: fits, truncates on section boundaries, never splits a fence, coverage math, frontmatter always kept, `headingsOutline` shape.
- [ ] `packages/core/test/ai-summary-title-properties.test.ts`: prompt builders include the shape hint and the vocabulary; `parseTitles` dedupe and cap; `parsePropertySuggestions` normalises `#Tag` and `tag`, marks known/new, drops existing.
- [ ] `packages/core/test/ai-router.test.ts` (extend): `structure` usable without `json`; `prefers` ordering; `summarize` usable at 8k.
- [ ] `packages/core/test/slashcommands*.test.ts` (extend): `ai` group present only when provided, hidden/disabled states, `/sum` ranking.
- [ ] `packages/core/test/ai-rewrite.test.ts` (extend) or new `ai-insert-modes.test.ts`: `insert` mode inserts one block and removes `/query` in one undo; `choose` mode sets `title:` vs H1 correctly.
- [ ] `packages/core/test/outlineSidebar*.test.ts` (extend): Suggest button visibility, chips render, apply calls `onPropertiesChange` with merged entries, dismiss.
- [ ] `test/live/ai-live.test.ts`: one `structure` call asking for `{"titles": [...]}` on a fixture and asserting `parseTitles` yields at least one; one short `summarize` call; skipped unless live.
- [ ] `npm run test:unit`, `npm run test:edge`, `npm run test:packages` green; live run attempted and recorded. Commit.

[Return to Top](#ai-writing-features-plan)

### M7 Host commands, docs, release notes

**Recommended model: Haiku** (mechanical wiring and docs).

> Workers must complete ALL items in this list. Do not publish, tag or push.

- [ ] VS Code: `package.json#contributes.commands` + command palette and editor context `when` clauses (`config.mikedown.ai.enabled`) for `mikedown.ai.explain`, `mikedown.ai.translate`, `mikedown.ai.summarize`, `mikedown.ai.suggestTitle`, `mikedown.ai.suggestProperties`; `src/extension.ts` forwards each as `{ type: 'command', command: … }`. No new keybindings by default (Rewrite keeps `Cmd+Option+K`).
- [ ] Desktop: `packages/desktop/src/menu/shortcuts.ts` editor entries for the same commands (key-free), under the existing AI menu.
- [ ] `package.json#contributes.configuration` `mikedown.ai.features` description: list the new feature ids (`title`) if the schema enumerates them; otherwise confirm the open map already accepts it. No other settings change (record "no new settings" in the summary; if any were added, verify the three places).
- [ ] `CHANGELOG.md`: npm family entry (new prompt modules, `requestOverrides` on the request, relaxed `summarize`/`structure` gates, popover modes) and extension entry (rewrite variants, Explain, Translate, thinking dial, `/summary`, `/title`, Properties Suggest; all experimental, off by default).
- [ ] `README.md` (extension) and `website/vscode/` AI section: one paragraph per bundle; `packages/core/README.md`: the `requestOverrides` field and the new feature ids for host authors.
- [ ] `CLAUDE.md` architecture lines: `ai/prompts/*`, `ai/json.ts`, `ai/documentBudget.ts`, `ai-prefs.ts`.
- [ ] `npm run lint`, `npm run test:unit` green. Commit.

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
- [ ] Turn AI off in Settings: bubble items, `ai` slash group, Suggest button and the AI menu entries disappear; turn it on with no usable route: entries disabled with a reason.
- [ ] Source mode: Formal and Translate on a CM selection; Explain's Insert below; AI menu Summarize inserts at the cursor line.

Sign-off: Mike records the result (pass, or the list of failures) in the Progress Log; failures become gap-fill prompts.

[Return to Top](#ai-writing-features-plan)

---

## Open Questions

Each has a recommendation so a worker can proceed if Mike has not overridden it.

| # | Question | Recommendation | Blocks |
|---|---|---|---|
| OQ1 | Where the remembered picker choices live. Core has no host state API (`host.ts` exposes none; `editor.ts` does not use `localStorage`). | `localStorage` in `ai-prefs.ts` behind try/catch; VS Code webviews keep it per extension origin, Desktop per app. If it proves unreliable in a host, move to a `host.getState/setState` pair in a later plan. | M2, M3 |
| OQ2 | Callout type for the inserted summary. `callout-node.ts` supports the GFM set only (NOTE, TIP, IMPORTANT, WARNING, CAUTION). | `[!NOTE]` with a bold first line **Summary**. Do not add a custom callout type for this plan. | M4, M5 |
| OQ3 | `/title` when both an H1 and a frontmatter `title:` exist. | Set `title:` (the Properties value is what tools read) and leave the H1; offer "Also rename heading" as a second click only if trivial, else record as a follow-up. | M5 |
| OQ4 | Whole-document translation replaces the entire body in one transaction, which also drops selection and scroll position. | Accept it for v1; restore the cursor to the start of the body after Accept. | M2 |
| OQ5 | `toolbar-dropdown.ts` has no submenu support, so the AI toolbar menu cannot show grouped variants inline. | Keep "Rewrite selection…" opening the popover's grouped choose phase. Do not add submenus to the dropdown (that is toolbar code the other plan owns). | M2, M5 |
| OQ6 | Slash menu entries that are disabled (AI on, no route) vs hidden. | Hidden when `hidden`; when `disabled`, show greyed with the reason if `slashcommands.ts` already supports disabled entries (there is a `setSlashDisableHandler`), else hide and note it. | M5 |
| OQ7 | Repair retry cost on slow local models (a second full round trip). | One retry, only for JSON-shaped tasks (`title`, `frontmatter`), never for summary or rewrite. Show "Fixing the answer format…" in the popover or chips row while it runs. | M4, M5, M6 |
| OQ8 | Language list contents and order. | English, Spanish, French, German, Portuguese, Italian, Dutch, Japanese, Chinese (Simplified), Korean, Arabic, Hindi, then Other…; recent choices float to the top. | M2 |

[Return to Top](#ai-writing-features-plan)

---

## Follow-ups

1. **Per-task model benchmark (Mike, 2026-10-28).** A "Benchmark" action on the AI Engines page that runs a fixed case per task (`rewrite`, `summarize`, `structure`, `vision`, `notes`…) against every enabled local model, records latency to first token, tokens per second and total time, shows the outputs side by side for a one-click quality rating (good / ok / bad), and stores results per model and task so the routing pickers can show "fastest good model" hints. Motivation: a light model (Gemma) can be the best OCR or vision model and still lose to Qwen on meeting notes; today that is discovered by hand. This plan prepares for it: every prompt builder is pure and parameterised, and `test/ai-fixtures/` gains inputs per task that the benchmark can reuse as its cases. Own plan: `ai-model-benchmark-plan.md`.
2. **Chunk-then-merge summaries** for documents beyond the context window (replaces the coverage note from D9).
3. **Reading grade in the status bar** (pure code extension of `wordCount`, idea 19's first half) linking to the Audience picker.
4. **"Also rename heading" from `/title`** through `headingRename.ts` so links stay valid (OQ3).
5. **Host state API** (`getState/setState`) if `localStorage` proves unreliable for remembered choices (OQ1).
6. **Meeting notes to action items** (`/actions`, idea 13), **paste cleanup** (16) and **Mermaid/table generation** (9): the rest of the engines plan's follow-up 4, each one prompt module plus a popover mode on the machinery built here.
7. Ghost text, chat with this document, alt text, grammar and consistency review, workspace RAG, dictation: unchanged, their own plans.

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

[Return to Top](#ai-writing-features-plan)
