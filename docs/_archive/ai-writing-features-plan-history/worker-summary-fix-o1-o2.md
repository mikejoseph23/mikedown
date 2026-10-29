# Worker Summary: Fix O1 and O2

**Status:** Completed

## Work completed
- O1: `/summary` preview now shows `summaryPreviewText(raw, kind, cutOff)` once the run is done (the body `finalizeSummary` inserts, minus callout wrapper and coverage line, which the popover shows separately). Streaming stays raw. Rewrite already previewed `finalText`; titles show a list, so no change there. Test: cut summary preview equals the text Insert puts in the document.
- O2: badge text split into `.ai-rw-badge-engine` ("local · oMLX · ") and `.ai-rw-badge-model`; `.ai-rw-badge-text` is a grid (`auto minmax(3ch, auto)`) and `.ai-rw-badge` has `min-width: min-content`, so only the model name ellipsizes. Tooltip unchanged. Checked in Chrome on a static replica of the header (420px, High dial, long title): engine fully visible, title and model ellipsized, no overflow. Not checked in the real popover.
- Bubble hover transparency: skipped on the lead's instruction (the selection bubble is being removed). It was already committed as 39f6369 before the message arrived, so it is reverted in the following commit; net change to bubble CSS is none. No other floating AI element in ai-rewrite.css has a translucent hover background (bubble menu and popover are opaque); ai.css not touched.

## Files modified
- packages/core/src/ai-rewrite.ts
- packages/core/src/ai/prompts/summary.ts (new export `summaryPreviewText`)
- packages/core/src/styles/ai-rewrite.css
- packages/core/test/ai-length-limit.test.ts
- packages/core/test/ai-rewrite.test.ts

## Test status
`npm run test:unit`: 161 files, 2797 passed, 2 todo, 0 failed.

## Notes for orchestrator
`.ai-rw-badge-text` textContent is unchanged ("local · Proxy · house-model"). Single-part badge texts ("AI: on") go in `.ai-rw-badge-engine` only.

Start 22:30, end 22:40.

Review Materials: none
