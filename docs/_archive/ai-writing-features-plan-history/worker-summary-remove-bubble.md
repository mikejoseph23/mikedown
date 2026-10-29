# Summary: remove the AI selection bubble

Status: Completed

## Work completed
- ai-rewrite.ts: deleted createAiRewriteBubble, its deps/handle types, and now-dead `rewriteHotkeyLabel`, `CHEVRON`, an unused type import; header comment updated. `aiRewriteMenuGroups` kept (context menu uses it). `isMacPlatform` is still exported but now has no callers (left alone).
- editor.ts: removed aiBubble, aiBubbleSelectionRect, aiPointerDown, the bubble listeners and every aiBubble hide/schedule call; kept `editor.on('focus', syncAiSlashCommands)`; dropped unused `posToDOMRect` import.
- ai-rewrite.css: deleted bubble rules, reduced-motion entries and the `.ai-bubble-item` focus selector.
- Tests: removed the bubble-only test; added "no selection bubble" test (selection with AI on creates no bubble element, no popover). No other test used the bubble.
- Docs: no mentions in README/CHANGELOG/core docs/website/CLAUDE.md; added a root CHANGELOG Unreleased line. Planning docs (ai-writing-features-plan.md, ai-inference-engines-plan.md, ai-copilot-brainstorm.md) still mention the bubble historically; not edited.
- Bundle: web component standalone gzip 883846 -> 882526 bytes (budget 900 kB); test passes.

## Files modified
CHANGELOG.md, packages/core/src/ai-rewrite.ts, packages/core/src/editor.ts, packages/core/src/styles/ai-rewrite.css, packages/core/test/ai-rewrite-ui.test.ts

## Test status
lint 0 errors; both tsc --noEmit clean; build:core ok; test:unit 161 files / 2797 passed; test:edge 22 passed; test:packages 79 passed.

## Notes for orchestrator
packages/core/demo/ai-handson/ has no references to the bubble. The plan docs listed above still describe the bubble as an entry point.

Start 22:30, end 22:41.
Review Materials: none
