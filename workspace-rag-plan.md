# Workspace RAG (documentation bases) — Planning Document

## Summary

MikeDown gets **documentation bases**: user-level folders of markdown that the AI can navigate and answer questions from, on both hosts (VS Code extension and MikeDown Desktop). One chat panel in the editor, with a scope picker (**This document** / **Active bases**), answers with numbered citations and inserts at the cursor. Navigation is a prompted loop over a home document (`HOME.md` override, `INDEX.md`, `README.md`, or an in-memory map), never native tool calling, with the model naming page ids only. There are no embeddings in the MVP.

Critical success factors:

- **Containment is code, not prompt.** The model names ids from core's index; hosts canonicalize paths, refuse anything outside a base root, non-markdown, symlinks and oversize files.
- **Consent is honest.** A per-base "May be sent to cloud engines" switch (off by default) plus a `docsBase` consent scope so the dialog names what leaves the machine.
- **Budget is visible.** Navigation sees outlines only; the final call carries section bodies capped at a configurable share of context with a coverage note.
- **Every security finding in the brief is a checkbox** in the milestone that implements the piece (see [Security requirements](#security-requirements)).

Defaults applied: incremental testing, vitest for core and VS Code host modules, `cargo test` for Rust, hands-on for interactive behaviour, no Playwright, no screenshots. Not a LymeStack app.

### Milestone Progress Tracker

| Milestone | Model | Status | Duration (min) | Notes |
|---|---|---|---|---|
| [M1 Core types, settings, `docs` task, `docsBase` scope](#m1-core-types-settings-docs-task-docsbase-scope) | Sonnet | ✅ Done | 8 | `98707b6` |
| [M2 Core index model, link graph, keyword fallback, secrets scan](#m2-core-index-model-link-graph-keyword-fallback-secrets-scan) | Sonnet | ✅ Done | 14 | `d3aa708`. Pure TS |
| [M3 Core tests](#m3-core-tests) | Sonnet | ✅ Done | 9 | `4c458a1`. Found and fixed 3 M2 bugs |
| [M4 Navigation loop and answer call](#m4-navigation-loop-and-answer-call) | Opus | 🔄 In Progress | — | Nuanced prompts |
| [M5 host.docs in VS Code](#m5-hostdocs-in-vs-code) | Sonnet | ✅ Done | 11 | `4c28014`. Modal entry is M8's |
| [M6 host.docs on Desktop](#m6-hostdocs-on-desktop) | Sonnet | 🔄 In Progress | — | Rust |
| [M7 Host tests](#m7-host-tests) | Sonnet | ⬜ Not Started | — | vitest + cargo |
| [M8 Bases manager page](#m8-bases-manager-page) | Opus | 🔄 In Progress | — | UI |
| [M9 Chat panel](#m9-chat-panel) | Opus | ⬜ Not Started | — | UI |
| [M10 UI tests](#m10-ui-tests) | Sonnet | ⬜ Not Started | — | vitest jsdom |
| [M11 Hands-on in both hosts](#m11-hands-on-in-both-hosts) | Sonnet | ⬜ Not Started | — | Mike signs off |
| [M12 Docs and release notes](#m12-docs-and-release-notes) | Haiku | ⬜ Not Started | — | |

## Table of Contents

- [Summary](#summary)
- [Design](#design)
  - [Decisions](#decisions)
  - [Data flow](#data-flow)
  - [Security requirements](#security-requirements)
- [Milestones](#milestones)
- [Later](#later)
- [Parallel Development Recommendations](#parallel-development-recommendations)
- [Gap-Filling Prompts](#gap-filling-prompts)
- [Progress Log / Notes](#progress-log--notes)

## Design

### Decisions

All decided; do not reopen.

1. **Surface:** one chat panel in the editor on both hosts, Insert at cursor on each answer. Scope picker: This document (live editor text) or Active bases (saved files). Defaults to This document when no base is active. Replaces the planned `chat` feature in `packages/core/src/ai/features.ts` (id stays `chat` for settings compatibility; label becomes "Chat"; status `available`).
2. **Bases:** user-level only, absolute normalized folder paths: machine-scope `mikedown.ai.docBases` in VS Code, the global `<app-data>/settings.json` on Desktop. No `${...}` tokens, not a file, no duplicates (case-insensitive on Windows). A repo can never add or redirect a base. Manager page has "Add this workspace folder" (multi-root shows a picker); Desktop uses its folder picker and re-allows every root on startup.
3. **Home precedence per root:** optional override file name (per base, for example `HOME.md`), then `INDEX.md`, then `README.md`, then an in-memory map from the file tree (titles and headings, max 400 entries, nothing written). Health shows "No home document".
4. **Navigation:** prompted loop. Hop 1 sends each root's home in full within budget plus its link list (outline and links only, max 200 links); the model returns JSON `{ read: [ids], done: boolean }`; up to `maxHops` (default 3, clamped 1 to 5); then one final answering call. Nav calls never see bodies; the model asks for section ids (`page#heading`) or whole pages per the "navigate by section or page" setting. Parse failures get one repair retry through `ai/json.ts`, then the loop ends with what was read. Nothing read: answer labelled "answered without sources".
5. **Budget:** final call carries section bodies capped at `sourceShare` (default 60%, clamped 30 to 80%) of the route's context; coverage note "answered from 4 of 7 sections, 3 left out". Reuses `CHARS_PER_TOKEN` and `headingsOutline` from `packages/core/src/ai/documentBudget.ts`.
6. **Citations:** sections are numbered in the final call only. The model cites `[n]`; unknown numbers are dropped; none valid shows "No sources cited". Chat renders `[1]` plus a `file › heading` chip that opens through `host.openLink` with a reveal. Insert at cursor turns each citation into a CommonMark relative link such as `[Key rotation](security.md#key-rotation)` where resolvable, else plain `file › heading` text.
7. **Routing:** new `docs` task in `packages/core/src/ai/tasks.ts` (`requires: { chat: true }`, `prefers: { json: true, contextTokens: SUMMARIZE_MIN_CONTEXT_TOKENS }`). One route per turn: hops and the final call use the same engine; fallback only between turns. This document scope keeps the `chat` task.
8. **Cloud:** per-base `allowCloud` switch, off by default. On a cloud route with it off, chat says "Base X is local-only" and offers a local engine or the switch. New `AiSendsScope` value `docsBase` so the consent dialog names the bases.
9. **Secrets:** strict pattern scan (AWS access keys, `sk-` style tokens, PEM blocks, JWT-shaped tokens) on each section before sending, every engine. Matched sections are left out; coverage note says "1 section left out: looks like it contains a key".
10. **History:** in memory per editor instance, cleared on close. Copy and Save reuse the AI Activity export pattern (`formatActivityExport`, `host.saveTextFile`).
11. **Keyword fallback:** when the home is the map, or navigation reads nothing, a host-side case-folded scan over the index's files (headings weighted, top 20 sections). No stored index.
12. **Index:** built lazily per base on first use, in memory on the host; per-file invalidation from a watcher plus a TTL re-walk as Desktop's `packages/desktop/src/tree/mdIndex.ts` does. Bodies are read from disk at request time, never cached.
13. **Caps:** 5,000 files per base, 1 MiB per file (skipped, counted in health), 24 KB per sent section, 200 links per nav list, 400 map entries, one chat request in flight per editor, cancellable.
14. **Health:** computed when the manager page opens and on Refresh. A root missing on disk: "Root not found", base skipped for requests, never deleted. A relative link leaving every root is a broken link, not followable. Duplicate wikilink names: same base by nearest path (`pickBestWikilinkTarget` in `src/wikilinkResolve.ts`), then other active bases, else both offered with a count.
15. **Activity:** each hop is an entry, feature `chat`, job `navigate` or `answer`, with the page list in the entry.
16. **Hosts without `host.docs`** (npm consumers): scope picker shows This document only.

### Data flow

```
chat panel (ai-ui lazy chunk)
  └─ docsChat loop (packages/core/src/ai/docs/, pure TS)
       ├─ host.docs.listBases()        → bases + health
       ├─ host.docs.index(baseId)      → pages {id, path, title, headings[], links[]}  (no bodies)
       ├─ runAiCompletion(navigate)    → JSON {read: ids, done}      × ≤ maxHops
       ├─ host.docs.readSections(baseId, ids) → bodies (host canonicalizes, caps, refuses)
       ├─ secretsScan → budget → number sections
       └─ runAiCompletion(answer)      → text with [n] → citations → render / insert
```

`host.docs` is optional on `MikeDownHost` (`packages/core/src/host.ts`, next to `ai?`). The VS Code bridge adds `docs*` messages to `src/ai/webviewBridge.ts`; Desktop adds `docs_*` Tauri commands wired in `packages/desktop/src/host/`.

### Security requirements

Each lands as a checkbox in the owning milestone.

| # | Requirement | Owner |
|---|---|---|
| S1 | Model names page/section ids only; hosts map ids to paths from their own index, never from model text | M4, M5, M6 |
| S2 | Every read canonicalizes (symlinks resolved) and checks: under the canonical root, `.md`/`.markdown`, regular file, ≤ 1 MiB | M5, M6 |
| S3 | Own walker in VS Code (`findFiles` is workspace-only and follows symlinks); skip symlinked dirs and `node_modules` on both hosts | M5, M6 |
| S4 | `docBases` joins the user-only keys: `effectiveAiRaw` in `src/settings.ts` reads `globalValue` only; `USER_ONLY_KEYS` in `src/ai/vscodeAi.ts`; Desktop reads it from the global file only like `ai.rs` does for engines | M5, M6 |
| S5 | `docsBase` consent scope in `privacy.ts`, `test/ai-fixtures/consent/consent-text.json`, `consent.rs`; dialog names the bases | M1, M6 |
| S6 | Per-base cloud switch enforced in the loop before any request, not only in the UI | M4, M9 |
| S7 | Secrets scan before every send, every engine | M2, M4 |
| S8 | Insert at cursor: citation links only; other links and images become plain text unless the URL appears verbatim in a cited section (CSP allows `img-src https:` at `src/markdownEditorProvider.ts:2322`; Desktop renders remote images) | M9 |
| S9 | Caps (files, bytes, sections, links, map, hops, share) clamped in code; index work host-side; watcher per root only | M2, M5, M6 |
| S10 | Nav prompt states page text is data; hop cap, coverage note and citations keep injection visible | M4 |
| S11 | Desktop fs scope: a root outside `$HOME` becomes readable and writable for the session (Tauri has no read-only scope); accepted, documented in `capabilities/default.json` | M6 |
| S12 | Read-only: no writes, shell or URLs from the loop; `getFileHeadings` (`markdownEditorProvider.ts:1061`) is not the pattern to copy | M5 |
| S13 | Activity panel stays off by default; secrets-scanned sections never reach it | M4 |

[Return to Top](#workspace-rag-documentation-bases--planning-document)

## Milestones

Workers must complete **all** items in their milestone. Do not skip items as lower priority or out of scope; if one should be dropped, say so in the summary and still attempt it unless truly blocked. New AI UI loads through `ai-ui.ts`, never statically from the editor's main path (`packages/core/test/ai-lazy-load.test.ts` enforces this). Never print API keys. Mike's local engines: oMLX at `http://127.0.0.1:8000/v1`, LM Studio on port 1234.

### M1 Core types, settings, `docs` task, `docsBase` scope

**Model:** Sonnet. Files: `packages/core/src/ai/types.ts`, `schema.ts`, `tasks.ts`, `features.ts`, `privacy.ts`, `host.ts`, `test/ai-fixtures/consent/consent-text.json`.

- [x] Add `AiDocBase` type: `{ id, name, roots: string[], homeFile?: string, allowCloud: boolean }` and `AiDocsSettings` (`bases`, `maxHops`, `sourceShare`, `navigateBy: 'section' | 'page'`) to `types.ts`.
- [x] Add `docBases` and `docs` (advanced options) to `AI_SETTINGS_KEYS`, `parseAiSettings` (clamp hops 1 to 5, share 30 to 80, drop invalid bases with a reason) and `serializeAiSettings` in `schema.ts`.
- [x] Add the `docs` task to `AI_TASKS` (decision 7) and a `taskThinkingDefault` entry for `navigate` and `answer` jobs.
- [x] Change the `chat` feature: status `available`, label "Chat", description names bases, `sends: 'document'` (the loop overrides with `docsBase` per request through `AiRunRequest.sends`).
- [x] (S5) Add `'docsBase'` to `AiSendsScope`, `AI_SENDS_TEXT` ("pages from the documentation bases you turned on: ...") and a `whatIsSent` variant that takes the base names; update `consent-text.json` fixtures.
- [x] Add `MikeDownDocsHost` to `host.ts`: `listBases(): Promise<AiDocBaseStatus[]>`, `index(baseId): Promise<AiDocsIndex>`, `readSections(baseId, ids: string[]): Promise<AiDocsSection[]>`, `keywordSearch(baseId, query): Promise<AiDocsSectionRef[]>`, `watch?(baseId, cb)`; `docs?: MikeDownDocsHost` on `MikeDownHost`.
- [x] Export the new types from `packages/core/src/ai/index.ts`; `npm run lint` and the existing `ai-schema`, `ai-privacy` and `ai-fixtures` tests green.

[Return to Top](#workspace-rag-documentation-bases--planning-document)

### M2 Core index model, link graph, keyword fallback, secrets scan

**Model:** Sonnet. New folder `packages/core/src/ai/docs/` (pure TS, no DOM, no network; the package shape test checks).

- [x] `index.ts`: `AiDocsIndex` builder from host-supplied `{ id, relPath, title, headings[], links[] }` pages; stable ids (`<root-label>/<rel-path>` and `#<slug>` for sections); dedupe.
- [x] `home.ts`: home precedence per root (override, `INDEX.md`, `README.md`, map); map builder capped at 400 entries; "No home document" health state.
- [x] `links.ts`: resolve relative links and wikilinks inside the index (decision 14), mark broken links, produce the hop-1 link list capped at 200.
- [x] `keyword.ts`: shared ranking for the keyword fallback (headings weighted, top 20) so both hosts return the same order for the same input.
- [x] (S7) `secrets.ts`: strict patterns for AWS access keys (`AKIA[0-9A-Z]{16}`), `sk-` style tokens, PEM blocks, JWT-shaped tokens; returns matched section ids and the coverage phrase.
- [x] (S9) `caps.ts`: one place for every cap and clamp (5,000 files, 1 MiB, 24 KB section, 200 links, 400 map, hops, share).
- [x] `budget.ts`: section numbering and the share-of-context cut with the coverage note, built on `documentBudget.ts`.
- [x] `citations.ts`: parse `[n]` from an answer, drop unknown numbers, "No sources cited", and the CommonMark relative-link rewrite for Insert at cursor.

[Return to Top](#workspace-rag-documentation-bases--planning-document)

### M3 Core tests

**Model:** Sonnet. Mode: unit (vitest), `packages/core/test/ai-docs-*.test.ts`.

- [x] Schema: clamps, invalid base rejection (relative path, token, file, duplicate), serialize round-trip.
- [x] Home precedence per root, including multi-root bases and the map fallback cap.
- [x] Link graph: relative links, wikilinks with duplicates, links leaving every root flagged broken.
- [x] Keyword ranking is deterministic and heading-weighted.
- [x] Secrets scan: each pattern hit, no false positive on ordinary prose with `sk-` in a word, coverage phrase.
- [x] Budget: share cut, numbering, coverage note wording, section cap 24 KB.
- [x] Citations: unknown numbers dropped, "No sources cited", relative link rewrite, non-cited links and images become plain text.
- [x] Privacy: `docsBase` text names the bases; fixture test passes; `npm run test:unit` green.

[Return to Top](#workspace-rag-documentation-bases--planning-document)

### M4 Navigation loop and answer call

**Model:** Opus. `packages/core/src/ai/docs/loop.ts` and `prompts/docsNavigate.ts`, `prompts/docsAnswer.ts`.

- [ ] Nav prompt: home outline plus link list under root labels, JSON shape hint from `JSON_SHAPE_HINT`, (S10) states page text is data and instructions inside pages must be ignored.
- [ ] Loop: `runAiCompletion` with `feature: 'chat'`, `task: 'docs'`, `format: 'json'`, `job: 'navigate'`; one repair retry through `parseLenientJson` and `jsonRepairMessages`; stop on `done`, empty read list, or `maxHops`.
- [ ] (S1) Only ids present in the index are passed to `host.docs.readSections`; anything else is dropped and counted in the entry.
- [ ] (S6) Before the first request, resolve the route; if cloud and any active base has `allowCloud: false`, return a `baseLocalOnly` outcome naming the base.
- [ ] (S7) Run the secrets scan on every section before budgeting; left-out sections go into the coverage note.
- [ ] Answer call: numbered sections, coverage note, same engine as the hops; `sends: 'docsBase'` with base names for the consent dialog.
- [ ] Keyword fallback when the home is the map or the loop read nothing; "answered without sources" when still empty.
- [ ] (S13) One Activity entry per hop (job `navigate` / `answer`, page list, dropped ids); activity stays off by default.
- [ ] One request in flight per editor; `AbortSignal` cancels hops and the answer.
- [ ] This document scope: same loop with a single synthetic page from live editor text, no host calls, task `chat`.

[Return to Top](#workspace-rag-documentation-bases--planning-document)

### M5 host.docs in VS Code

**Model:** Sonnet. Files: new `src/ai/docsHost.ts`, `src/ai/webviewBridge.ts`, `src/settings.ts`, `src/ai/vscodeAi.ts`, `package.json`.

- [x] (S3) Walker over each root with `vscode.workspace.fs`: skip symlinked dirs (`FileType.SymbolicLink`), `node_modules`, hidden dirs; stop at 5,000 files and record the cap in health.
- [x] (S2, S12) `readSections`: canonicalize with `fs.realpath`, require the path under the canonical root, `.md`/`.markdown`, regular file, ≤ 1 MiB; refuse otherwise with a reason; read-only, no other I/O.
- [x] Index per base: titles, headings (`headingsOutline`), links; lazy on first use; `FileSystemWatcher` with `RelativePattern(Uri.file(root), '**/*.{md,markdown}')` for invalidation plus a TTL re-walk.
- [x] Keyword search using the shared ranking from M2 over the index's files.
- [x] Bridge messages: `docsListBases`, `docsIndex`, `docsReadSections`, `docsKeywordSearch` and replies; list them at the top of `webviewBridge.ts` and `src/webview/editor-main.ts`.
- [ ] Settings rule, all three places: `mikedown.ai.docBases` and `mikedown.ai.docs` in `package.json#contributes.configuration` (scope `machine`), `src/settings.ts`, and the Settings modal entry pointing at the manager page.
- [x] (S4) `docBases` read from `globalValue` only in `effectiveAiRaw`; added to `USER_ONLY_KEYS`; "Add this workspace folder" writes the global value (multi-root: `showQuickPick`).
- [x] (S9) Watcher per root only; no workspace-wide watcher.

[Return to Top](#workspace-rag-documentation-bases--planning-document)

### M6 host.docs on Desktop

**Model:** Sonnet. Files: new `packages/desktop/src-tauri/src/commands/docs.rs`, `commands/ai/consent.rs`, `commands/settings.rs`, `capabilities/default.json`, `packages/desktop/src/host/docsHost.ts`, `tauriHost.ts`.

- [ ] (S3) `docs_index(root)`: reuse `walk_markdown` from `fs.rs` (skips symlinks, hidden, `node_modules`) with the 5,000 cap; return titles, headings, links per file (no bodies).
- [ ] (S2, S12) `docs_read_sections(root, ids)`: `canonicalize`, prefix check against the canonical root, extension and regular-file checks, 1 MiB cap; ids map to paths from the command's own index, never model text.
- [ ] `docs_keyword_search(root, query)`: shared ranking rules ported from M2 (same input, same order).
- [ ] (S5) `consent.rs`: `docsBase` sends text with base names; fixture `consent-text.json` passes in `tests.rs`.
- [ ] (S4) `docBases` and `docs` read from the global `settings.json` only, in the same slice as `ai.engines`.
- [ ] (S11) On startup, re-allow every base root in the fs scope; document in `capabilities/default.json` that a root outside `$HOME` is readable and writable for the session.
- [ ] Watcher: reuse `watcher.rs` `watch(dir)` per root; `fs-changed` events invalidate that base's index.
- [ ] `docsHost.ts` implements `MikeDownDocsHost` over the commands; wired into `tauriHost.ts` as `host.docs`.

[Return to Top](#workspace-rag-documentation-bases--planning-document)

### M7 Host tests

**Model:** Sonnet. Modes: unit (vitest for `src/ai/docsHost.ts` with a fake `workspace.fs`, in `test/unit/`), `cargo test` for `docs.rs` and `consent.rs`.

- [ ] VS Code: walker skips symlinked dirs and `node_modules`, stops at the cap and reports it.
- [ ] VS Code: `readSections` refuses a symlink escaping the root, a `../` path, a `.txt`, a 2 MiB file, and an id not in the index.
- [ ] VS Code: `effectiveAiRaw` ignores a workspace-scoped `docBases`; `USER_ONLY_KEYS` write test.
- [ ] Rust: `docs_read_sections` same five refusals; `docs_index` cap; `walk_markdown` reuse.
- [ ] Rust: `consent.rs` `docsBase` text matches `test/ai-fixtures/consent/consent-text.json`.
- [ ] Both: keyword search returns the same order for the shared fixture in `test/ai-fixtures/docs/`.
- [ ] `npm run test:unit`, `npm run test:packages`, `cargo test` in `packages/desktop/src-tauri` green.

[Return to Top](#workspace-rag-documentation-bases--planning-document)

### M8 Bases manager page

**Model:** Opus (UI). New `packages/core/src/ai-docs-page.ts`, loaded through `ai-ui.ts`; a section of the Engines page beside Tasks and Activity (`ai-engines-page.ts`).

- [ ] Bases list: name, roots, home document found (or "No home document"), file count, skipped oversize count, broken links, "Root not found"; Refresh button; health computed on open and Refresh only.
- [ ] Add base: name, roots (VS Code "Add this workspace folder" through the host; Desktop folder picker), optional home file name, per-base "May be sent to cloud engines" switch (off by default, one plain sentence under it saying what it allows).
- [ ] Edit, remove, enable/disable a base; validation messages from the schema reasons.
- [ ] Advanced: max hops (1 to 5), source share (30 to 80%), navigate by section or page; clamped in the model, not only the control.
- [ ] Tasks table gets the `docs` row through the existing routing section (`ai-routing-section.ts`), nothing hardcoded.
- [ ] Design craft: match the Engines page's rhythm (settings-rows spacing, quiet health chips like VS Code's native settings, no cards within cards); empty state explains what a base is in two lines.
- [ ] Lazy-load test still passes; `host.docs` absent hides the section.

[Return to Top](#workspace-rag-documentation-bases--planning-document)

### M9 Chat panel

**Model:** Opus (UI). New `packages/core/src/ai-chat-panel.ts`, loaded through `ai-ui.ts`; opened from the AI toolbar menu and the `mikedown.ai.chat` command (register in `package.json` commands and menus like `mikedown.ai.summarize`).

- [ ] Panel in the editor (same mount pattern as the AI Activity panel): scope picker This document / Active bases (hidden without `host.docs`), input, Send, Cancel while in flight, one request at a time.
- [ ] Answer rendering through `ai-markdown-preview.ts` (no href or src); `[n]` citations as `file › heading` chips that call `host.openLink` with a reveal; "No sources cited" and the coverage note under the answer.
- [ ] (S6) "Base X is local-only" state with two actions: pick a local engine (routing) or open the base's switch (manager page).
- [ ] (S8) Insert at cursor: citation links rewritten to CommonMark relative links from the current document's folder; other links and images inserted as plain text unless the URL appears verbatim in a cited section; insert through `editor.commands`, never DOM writes.
- [ ] History in memory per editor instance, cleared on close; Copy and Save using `formatActivityExport` style and `host.saveTextFile`.
- [ ] Hop progress line ("Reading 2 pages... hop 2 of 3") and a link to the Activity panel entry when activity is on.
- [ ] Design craft: conversational layout like VS Code's Copilot chat or Apple Notes' quiet chrome, citation chips with hover title showing the path, subtle transition on answer arrival, keyboard: Enter sends, Shift+Enter newline, Esc cancels.
- [ ] Feature switch: the `chat` feature toggle gates the panel with the standard "blocked by a feature switch" notice (`aiFeatureOffNotice`).

[Return to Top](#workspace-rag-documentation-bases--planning-document)

### M10 UI tests

**Model:** Sonnet. Mode: unit (vitest jsdom), `packages/core/test/ai-docs-page.test.ts`, `ai-chat-panel.test.ts`, extend `ai-lazy-load.test.ts`.

- [ ] Manager page: renders health states, validation messages, clamp of hops and share, cloud switch default off, hidden without `host.docs`.
- [ ] Chat panel: scope picker defaults, local-only state, citation chips call `openLink` with the reveal, unknown `[n]` dropped, Insert at cursor output with a fake host (links rewritten, image URL not in a cited section becomes text), Cancel aborts the signal, history cleared on dispose.
- [ ] Loop integration with a fake host and fake engine: three hops then answer, repair retry path, secrets section left out with the note, `baseLocalOnly` on a cloud route.
- [ ] Lazy load: neither panel is imported from the editor's main path.
- [ ] `npm run test:unit` and `npm run lint` green.

[Return to Top](#workspace-rag-documentation-bases--planning-document)

### M11 Hands-on in both hosts

**Model:** Sonnet (prepares the fixture and the checklist; Mike walks it). Mode: hands-on. The orchestrator pauses for sign-off.

Fixture: the worker adds `test/workspace/docs-base/` with `INDEX.md`, four linked pages, one page with a fake `AKIA...` key, one symlink pointing outside the folder, and one 1.5 MiB page.

VS Code: `npm run dev` from the repo root opens `test/workspace`. Desktop: quit the installed app, then `npm run dev` in `packages/desktop`, open `test/workspace`.

- [ ] Engines page → Bases: add `test/workspace/docs-base` with "Add this workspace folder" (VS Code) and the folder picker (Desktop); health shows the home, the oversize skip and no symlink target.
- [ ] Toolbar AI menu → Chat; scope Active bases; ask "how do I rotate a key?" on oMLX (`http://127.0.0.1:8000/v1`); watch hop progress, get an answer with `[n]` chips; click a chip, the file opens at the heading.
- [ ] Insert at cursor: links are relative CommonMark; the fake key never appears; the coverage note names the left-out section.
- [ ] Switch routing for `docs` to a cloud engine with the base's switch off: "Base X is local-only" appears; flip the switch; the consent dialog names the base.
- [ ] Scope This document on a file with no base active: answers from the editor text only.
- [ ] Cancel mid-hop; the panel returns to idle; Activity shows the cancelled entry.
- [ ] Remove the base folder on disk, Refresh: "Root not found", the base stays listed.
- [ ] Repeat the chip click and Insert on Desktop; LM Studio (port 1234) as the second engine.
- [ ] Layout judgment while there: spacing, chips, empty states; note fixes for a follow-up, no screenshots.

[Return to Top](#workspace-rag-documentation-bases--planning-document)

### M12 Docs and release notes

**Model:** Haiku.

- [ ] `README.md`: a Documentation bases section (what a base is, home precedence, what is sent, the cloud switch, the secrets scan).
- [ ] `CHANGELOG.md` entries for the extension and the npm family; `docs/ai-writing-features-plan.md` marks chat as shipped and links here.
- [ ] `CLAUDE.md`: `packages/core/src/ai/docs/`, `host.docs`, the `docs*` bridge messages and the Desktop commands in the AI paragraphs.
- [ ] Settings docs for `mikedown.ai.docBases` and `mikedown.ai.docs` (machine scope, why).
- [ ] Move this plan to `docs/` once complete (reserved root files untouched).

[Return to Top](#workspace-rag-documentation-bases--planning-document)

## Later

Not milestones. Short list so nothing in the MVP forecloses them.

- **Embeddings:** per-base opt-in, index in app data (never the repo), local engines by default, through the unused `host.ai.embed` and the `embed` task.
- **Generate INDEX.md:** from the map, preview before writing; the only write this feature would ever do.
- **Persisted chat history:** in app data alongside the embeddings store.
- **Settings sync across machines:** separate backlog item (`BACKLOG.md`); bases do not travel with a repo by design.

[Return to Top](#workspace-rag-documentation-bases--planning-document)

## Parallel Development Recommendations

- **Sequential blockers:** M1 before everything. M2 before M3 and M4. M4 and (M5 or M6) before M9. M8 and M9 before M10. M10 before M11.
- **Group A (after M1):** M2 and M5 and M6 in parallel (M5 and M6 build against the `MikeDownDocsHost` interface from M1).
- **Group B (after M2):** M3, M4 and M8 in parallel.
- **Group C (after M5 and M6):** M7 beside M9.
- **Group D:** M10, then M11, then M12.
- Worker directories: core workers in `packages/core/src/ai/docs/` and `packages/core/src/ai-*.ts`; VS Code host in `src/ai/`; Desktop in `packages/desktop/`. Only M1 and M5 touch `package.json`.
- If dispatching fills the orchestrator context, run `/compact` while workers run; resume from `.orchestrator/state.json`.

[Return to Top](#workspace-rag-documentation-bases--planning-document)

## Gap-Filling Prompts

When a milestone leaves items undone, the follow-up prompt follows the original structure (header, mission, planning doc reference), states what the first attempt completed and which files it touched, lists other active workers and their directories, and is labelled "Worker Context: [Milestone] - Gap Fill". It ends with the standard completion steps: commit the code changes, write `.orchestrator/worker-summary-[milestone-slug]-gap.md`, then prompt the user to clear the context.

[Return to Top](#workspace-rag-documentation-bases--planning-document)

## Progress Log / Notes

**2026-11-05 14:00** - Plan written from the completed interview (ten decisions, four follow-up decisions, Fable's defaults and security findings). Code references re-checked: `walk_markdown` in `fs.rs:562` with the 50,000 cap; `USER_ONLY_KEYS` in `src/ai/vscodeAi.ts:19`; `effectiveAiRaw` in `src/settings.ts:198`; `AiSendsScope` in `packages/core/src/ai/types.ts:450`; `AiRunRequest.sends` in `ai-request.ts:71`; `img-src https:` at `markdownEditorProvider.ts:2322`; `getFileHeadings` at `:1061`; `BacklinkProvider` 500-file cap; `host.ai.embed` declared in `types.ts:368`, unused. The feature id stays `chat` (the brief said `docsChat`) so existing feature toggles keep working.

**2026-11-05 16:45** - Orchestration started. Mike: no human approval or testing gates until the end, so M11 sign-off moves after M12 and the plan stays in the root until it is signed. M2 runs before M5 and M6 (they need its ranking, ids and exports), then M3, M4, M5, M6, M8 together. Workers commit on develop, no worktrees. Gaps closed in the worker briefs (`.orchestrator/workspace-rag-plan/prompts/worker-common.md`): route pinning for S6 (`runAiCompletion` falls back mid-call), `enabled` on bases, host methods for saving and picking folders, base ids through the consent wire, hosts validating roots, secrets scan over nav outlines, S1 made explicit in M5, S13 made explicit in M4.

**2026-11-05 16:53** - M1 done (`98707b6`). 3586 unit tests pass per the worker; settings, privacy and schema tests re-run by the orchestrator. Chat now shows a working toggle in AI settings that does nothing until M9. Bridge and `consent.rs` forwarding of `baseIds` is left to M5 and M6. M2 dispatched.

**2026-11-05 17:08** - M2 done (`d3aa708`): 151 new tests re-run by the orchestrator, 3694 total per the worker. M3, M4, M5, M6 and M8 dispatched together. The Settings modal entry moves from M5 to M8, which owns the page it opens. M4's `loop.ts` takes the completion runner as a parameter so `ai/` stays pure.

**2026-11-05 17:18** - M3 done (`4c458a1`). Attack tests found and fixed three M2 bugs: a quadratic Insert sanitizer (28 s on 150 KB), `#` and `?` unencoded in citation links, a PEM header re-wrapped across a line break not detected. 4 consent and bridge failures in M5's in-progress files to re-check when M5 lands.

**2026-11-05 17:21** - M5 done (`4c28014`), 3949 unit tests per the worker; the 4 consent and bridge failures M3 saw are gone (143 re-run here). The Settings rule box stays open until M8 adds the modal entry. For M7: a file swapped for a symlink after indexing is still readable when it resolves inside the root; the Summary says symlinks are refused, so M7 tightens this on both hosts.

[Return to Top](#workspace-rag-documentation-bases--planning-document)
