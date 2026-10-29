# M1 Rewrite family core: worker summary

**Status:** Completed

## Work completed
- Variants: `AiRewriteVariant` now has simpler, formal, casual, expand, explain, readingLevel, translate. `AiRewriteVariantDefinition` gained `group`, `output` (explain is `readOnly`) and an optional `param` ('language' | 'audience'). Menu order is the array order: shorter, longer, expand, simpler, fixFlow, formal, casual, readingLevel, translate, explain, custom.
- Parameters: `RewritePromptInput.params?: { language?, audience? }`, `AiAudience`, `AI_AUDIENCES` (label + instruction), `getAiAudience`. Instructions use `{language}` / `{audience}` templates; a missing or blank parameter falls back to `fixFlow`. Language is flattened to one line, max 60 chars (`normalizeRewriteLanguage`).
- Translate: `TRANSLATE_SYSTEM_ADDENDUM` appended through `rewriteSystemPrompt(variant, scope)`; `RewritePromptInput.scope?: 'selection' | 'document'` (document drops before/after context and adds `TRANSLATE_DOCUMENT_NOTE`; caller passes the body without frontmatter). The language appears once, in the instruction line.
- Explain: `ai/prompts/explain.ts` with `buildExplainMessages({ selection, before, after, title })`, `EXPLAIN_SYSTEM_PROMPT`, `explainMaxTokens()` (600). `buildRewriteMessages` with `explain` also works (adds `EXPLAIN_SYSTEM_ADDENDUM`), so the acceptance check holds either way; M2 should prefer `buildExplainMessages`.
- Structure check: `ai/prompts/structureCheck.ts` with `checkMarkdownStructure(original, result): StructureDiff` (`{ ok, mismatches[{kind, original, result, message}], messages[] }`) and `countMarkdownStructure`. Counts headings per level, fenced blocks, inline code, links and images by URL (inline, reference definitions, autolinks), list items, table rows, wikilinks, footnote refs. Content inside code is ignored for everything else.
- Tokens: `rewriteMaxTokens`: expand/translate/longer/custom x3, simpler/formal/casual x1.8, explain fixed 600 (`EXPLAIN_MAX_TOKENS`), everything else (incl. readingLevel) x1.6.
- `ai/index.ts`: one contiguous block at the end exporting `prompts/rewrite`, `prompts/explain`, `prompts/structureCheck`. Note this is the first time the prompts are exported from `@mikedown/core/ai`; `fence` was renamed `escapeClosingTag` and exported for explain.ts.

## Files modified
- packages/core/src/ai/prompts/rewrite.ts, explain.ts (new), structureCheck.ts (new), packages/core/src/ai/index.ts
- packages/core/test/ai-rewrite-family.test.ts (new, 15 tests)
- packages/core/test/ai-rewrite.test.ts (one assertion made derive from `AI_REWRITE_VARIANTS` instead of the hard-coded four labels)

## Test status
- `npm run lint`: 0 errors (pre-existing warnings only; none in ai/prompts).
- `npm run build:core`: ok.
- `npm run test:unit`: 147 files, 2466 passed, 2 todo, 0 failed.

## Issues / notes for orchestrator
- Side effect until M2: `contextmenu.ts` and the `ai-rewrite.ts` choose phase both iterate `AI_REWRITE_VARIANTS`, so the new variants already show in those menus. Picking Reading level, Translate or Explain there runs with no params (falls back to fix flow; explain would be treated as a replace). M2 must group the menus and add the pickers; I did not touch UI files.
- readingLevel x1.6 is my choice (not in the spec).
- Structure check does not handle setext headings or reference-style `[text][ref]` links (the definitions are counted).

## Time
Start 20:30, end 20:45

Review Materials: none
