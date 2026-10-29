# T3 automated hands-on pass (browser, real oMLX)

Model: `Qwen3.8-Flash-Next-oQ5e-mtp` on oMLX (`http://127.0.0.1:8000/v1`), a thinking model (reasoning arrives as `reasoning_content`). Engine kind `openai-compatible`, locality auto (local), capabilities from `detectCapabilities` (so `json: true`, `response_format: json_object` was sent for title/properties). Host: the built core editor (`packages/core/dist`) in Chrome with a throwaway tier 2 host whose `complete` calls oMLX through `buildCompletionBody` + `createCompletionStreamReader`.

## Checks

| # | Check | Result | Evidence |
|---|---|---|---|
| 1 | Bubble → Rewrite → More formal: streams, local badge, Accept, one Cmd+Z | Pass | Badge "local · oMLX · Qwen3.8…"; one line changed; Cmd+Z restored markdown byte-equal. ~2.6 s |
| 2 | Audience → 8th grade, remembered on second use | Pass | `localStorage mikedown.ai.audience = grade8`; reopened picker shows ✓ 8th grade, focused. First try failed with "The engine sent back no text" (see F2), Retry worked. ~2.4 s |
| 3 | Rich selection with link → Translate → Spanish: URL unchanged | **Fail** | Passage sent to the model was plain text (`See the pilot notes for…`, no `[..](url)`); Accept removed the link from the document. No structure warning (it never saw a link). See F1. ~2–3 s |
| 4 | Translate → Whole document | Pass | Frontmatter YAML byte-identical to the file on disk; body translated, link kept; caret at pos 1 (body start); one Cmd+Z restored. ~7.7 s (High thinking, max_tokens 1024) |
| 5 | Explain: read-only, Insert below, undo | Pass | Footer Insert below/Retry/Copy, no Accept; paragraph unchanged; one `> …` blockquote added after it; Cmd+Z restored. ~3.6 s |
| 6 | Thinking: visible, High + Retry, wire fields | Pass | Pill Off/Low/Med/High shown (model default: none pressed). High → `[aiwire] … "reasoning_effort":"high"`, Retry kept it, level remembered across later popovers (session). Off → `"chat_template_kwargs":{"enable_thinking":false}` (local mapping), matches `thinkingOverrides`. |
| 7 | `/summary`: TL;DR streams, toggle Outline, Insert, undo restores `/summary` | Pass | TL;DR inserted as `> [!NOTE]` / `> **Summary**` / `>` / text; Outline inserted a plain nested list; each time one Cmd+Z restored the `/sum` text byte-equal. ~2.4–3.6 s. TL;DR once hit the length limit mid-word (see F2) |
| 8 | `/title`: three candidates, hint, Properties updates, H1 untouched, undo | Pass | 3 candidates, hint "Sets title: in Properties"; pick set `title: "…"` only, H1 unchanged, sidebar showed it, `/title` line removed; one Cmd+Z restored everything. ~1.4 s |
| 9 | Properties Suggest: chips, known tags not "new", apply tag + description, undo each | Pass | Chips: description, #engineering, #schedule (planning/team already present, filtered); no "new" mark on vocabulary tags. Apply tag → `tags: [planning, team, engineering]`; apply description → `description: "…"`; one Cmd+Z each restored byte-equal. ~1.8 s. "new" mark itself not exercised (model proposed no out-of-vocabulary tag) |
| 10a | AI off (D15) | Pass | No bubble, no AI items in context menu, `ai` slash group hidden (`/sum`, `/ti` show no AI rows), Suggest button `hidden`. Toolbar AI button stays and opens the "Turn on and set up" onboarding (existing opt-in design) |
| 10b | AI on, no route (D15) | Pass, with a UI defect | Slash `ai` group hidden; bubble Rewrite `aria-disabled` with title "No engine and model is chosen for this task."; Suggest `aria-disabled` with the same reason; toolbar menu entries disabled with hints, but their labels are squeezed to "S" (F4) |
| 11 | Source mode: Formal, Translate, Explain Insert below, AI menu Summarize at cursor | Pass | Formal replaced line 11, one undo. Translate kept `[notas del piloto](https://example.com/pilot-notes)`, no warning (accurate). Explain added a blockquote after the line, one undo. Summarize inserted the `[!NOTE]` callout at the caret line, one undo |
| – | VS Code output channel line for thinking fields | Not testable | No VS Code host in this harness |
| – | Desktop log line for thinking fields | Not testable | No Desktop host |
| – | Desktop Format > AI menu | Not testable | No Desktop host |

Counts: 11 checklist rows, 10 pass, 1 fail, 3 not testable.

## Findings

Code:

- **F1. A rich-mode selection inside a paragraph loses every inline mark (links, bold, italic, code) on any rewrite, translate or explain.** `serializeFragment` in `packages/core/src/ai-rewrite.ts` (used by `richRewriteTarget`) passes the inline `doc.slice(from, to).content` to the tiptap-markdown serializer, which drops marks for top-level inline nodes; the block-wrapped slice serializes correctly (`[pilot notes](https://example.com/pilot-notes)`). Repro: select the first paragraph of `test/workspace/ai-writing-handson.md` (triple click or a TextSelection over its content), Rewrite → Translate → Spanish, Accept: the link is gone, no structure warning. Verified in the page: `serializer.serialize(doc.slice(22,218).content)` has no link, `doc.slice(21,219).content` has it. Fix direction: wrap inline content in its parent textblock before serializing (or serialize `doc.slice(from,to)` with open depth handled). Source mode is unaffected.
- **F2. Token budgets ignore reasoning tokens, so a thinking model often returns nothing or a truncated answer.** Rewrite `max_tokens` floors at 256 (`rewriteMaxTokens`), TL;DR at 256 (`summaryMaxTokens`); with the model's default or High thinking, oMLX spends them on `reasoning_content`. Seen 4 times in ~20 calls: `finish: length, chars: 0` → "The engine sent back no text."; once a TL;DR cut at "#pl", and Insert put that bogus `#pl` tag in the document. Thinking Off (`enable_thinking:false`) avoided it every time. Suspect `ai/prompts/rewrite.ts#rewriteMaxTokens`, `ai/prompts/summary.ts#summaryMaxTokens` (also `titleMaxTokens` 272, `propertiesMaxTokens` 384, which happened to fit). Option: add headroom when the served model can think and the level is not Off.
- **F3. The error for `finishReason: 'length'` with empty text is misleading.** It says "The engine sent back no text." (`ai-rewrite.ts` ~line 1966) when the model ran out of tokens while thinking; a hint to lower Thinking or retry would point at the fix.
- **F4. Disabled AI toolbar menu entries truncate their labels to one letter.** With no route, "Summarize document…" and "Suggest titles…" render as "S" because the long hint "No engine and model is chosen for this task." takes the row. Suspect the entry layout in `ai-toolbar.ts` (label needs `flex-shrink: 0` or the hint should wrap/ellipsize). Also the copy differs: Rewrite selection says "No engine available", the others the longer sentence.
- **F5 (minor). Escape in a second-level picker (Reading level, Translate) goes back to the choose phase instead of closing, and the next selection then does not show the bubble until the popover is fully closed.** Two Escapes needed; may be intended (back navigation), noting it.
- **F6 (minor). Stale suggestion chips stay visible after AI is turned off** (a dismissed-not chip "#schedule" plus "Dismiss all" remained under Properties while the Suggest button was hidden). `outlineSidebar.ts` chips row is not cleared on availability change.
- **F7 (minor). Popover header overflows with a long title**: "Translate · Spanish · Whole doc…" pushes the engine badge and the High segment off the right edge (badge read as "Higl"). `styles/ai.css` header row.
- **F8 (minor). The AI toolbar menu has no Explain entry**; the plan's Architecture table lists `aiToolbarMenuEntries` gaining Explain. Explain is reachable through "Rewrite selection" (D14), so this may be intentional.

Out of scope, observed: loading the document drops the blank line between the closing `---` and `# Four-day week pilot` (`getMarkdown()` differs from the file at byte 58). Not an AI feature; the AI edits themselves kept the frontmatter block byte-identical.

Model (not code): answers were fine for the task. Rewrites and translations were faithful, titles reasonable, properties sensible. The model did drop the link only in rich mode because it never received it (F1); in source mode it kept the link exactly.

## Start / End

Start 21:41, End 21:54 (2026-10-28, EDT). About 13 minutes; harness wiring took about 5.

## Review Materials

- Harness (uncommitted, leave or delete): `/Users/michaeljosephwork/git/mikedown/packages/core/demo/ai-handson/` (`index.html`, `main.ts`, `vite.config.mjs`). It uses the built `packages/core/dist`, so run `npm run build -w packages/core` first after source changes.
- Rerun: `cd /Users/michaeljosephwork/git/mikedown/packages/core && npx vite . --port 5198 --strictPort --config demo/ai-handson/vite.config.mjs` with `OMLX_API_KEY` in the environment, then open `http://localhost:5198/demo/ai-handson/` (`?model=<id>` picks another oMLX model). Console: `[aiwire]` request bodies minus messages, `[ailatency]` timings; `window.__reqs` / `window.__outs` hold requests and raw outputs; `selPara('text')` selects a paragraph; bar buttons switch AI off / on with no route / on routed.
- Vite server killed by PID; browser tab closed. Nothing committed, no source changed.
