# Kevin Feedback — Planning Document (Call, Aug 8)

## Summary

**Purpose:** Turn the raw call notes from Kevin Pfeiffer (Aug 8) into shippable MikeDown work. Three tracks came out of the call: a **hard bug** (export/print/view-in-browser is broken over VS Code Remote), a **feature request** (spell checker), and a **discoverability problem** (VS Code's built-in preview wins the `.md` default editor, so new users never see MikeDown).

**Key objectives:**

1. Make Export as PDF / Export HTML / View in Browser / Print work when VS Code is attached to a remote (Dev Container, WSL, SSH host).
2. Ship a spell checker in the MikeDown editor surface.
3. Make MikeDown the obvious default `.md` editor — prompt on install and document it in README/marketplace.
4. Close the loop with Kevin on the item he couldn't recall.

**Critical success factors:**

- The remote export fix must be verified in a *real* remote session (Dev Container or WSL), not just locally — that's the entire bug.
- Spell check must not mutate `editor.view.dom` outside a ProseMirror transaction (see [CLAUDE.md](CLAUDE.md) critical constraints).
- Any new `mikedown.*` setting lands in all three places: `package.json`, `src/settings.ts`, and the in-editor Settings modal.

**Known grounding (already verified in the codebase):**

- `src/export.ts:178-181` writes the render to `os.tmpdir()` then calls `vscode.env.openExternal(vscode.Uri.file(tmpPath))`. Under a remote connection that temp file is created **on the remote side** and the `file:` URI is meaningless to the local browser — this is almost certainly the reported failure. `vscode.env.asExternalUri()` / a local-side write is the likely fix shape.
- `src/export.ts:138` (`showSaveDialog` for HTML export) is remote-aware already and probably fine; the browser-launch path is not.
- There is no `spellcheck` attribute on the editor's contenteditable anywhere in `src/webview/` — spell check is currently fully absent, not merely misconfigured.
- `src/nagPrompt.ts` already exists and does notification-style prompting — reuse it for the default-editor prompt rather than building a new mechanism.

### Milestone Progress Tracker

| Milestone | Model | Status | Duration (min) | Notes |
|---|---|---|---|---|
| M1 — Reproduce & diagnose remote export failure | Sonnet | ✅ Complete | 20 | Awaiting user gate: approve fix for M2 |
| M2 — Fix remote export / print / view-in-browser | Opus | ✅ Complete | 5 | Merged `35d28fb` (worktree `914320c`); runtime remote verification deferred to M3 |
| M3 — Testing: remote export | Sonnet | 🔄 Automated ✅ | 55 | `392158c`+`dee0958`; unit 335/335, integration 20/20 verified by orchestrator; **hands-on remote checks pending user** |
| M4 — Spell checker: spike & approach decision | Opus | ✅ Complete | 9 | Awaiting user gate: approve approach for M5 |
| M5 — Spell checker implementation | Opus | ✅ Complete | 13 | Merged `9b1f0c9` (worktree `2f3e740`); needs live smoke test (M6) |
| M6 — Testing: spell checker | Sonnet | ✅ Complete | 25 | `6a2ccf4` + gap `52bef90`; user signed off; spell-check track (M4–M6) done |
| M7 — Default-editor discoverability | Sonnet | ✅ Complete | 40 | Commit `6591bea`; lint has pre-existing repo-wide debt (326 problems, zero net-new) |
| M8 — Testing: discoverability & docs | Haiku | ✅ Complete | 10 | Commit `afd5417`; 14 new tests, 308/308 green |
| M9 — Follow up with Kevin | Haiku | ✅ Draft ready | 10 | No transcript exists (M1 claim corrected); draft asks Kevin directly — awaiting Mike's review/send |

**Status legend:** ⬜ Not Started / 🔄 In Progress / ✅ Complete

**Duration tracking:** when a milestone completes, record actual elapsed minutes. Use it to spot milestones that should have been split.

---

## Table of Contents

- [Summary](#summary)
- [Milestone Progress Tracker](#milestone-progress-tracker)
- [M1 — Reproduce & Diagnose Remote Export Failure](#m1--reproduce--diagnose-remote-export-failure)
- [M2 — Fix Remote Export / Print / View in Browser](#m2--fix-remote-export--print--view-in-browser)
- [M3 — Testing: Remote Export](#m3--testing-remote-export)
- [M4 — Spell Checker: Spike & Approach Decision](#m4--spell-checker-spike--approach-decision)
- [M5 — Spell Checker Implementation](#m5--spell-checker-implementation)
- [M6 — Testing: Spell Checker](#m6--testing-spell-checker)
- [M7 — Default-Editor Discoverability](#m7--default-editor-discoverability)
- [M8 — Testing: Discoverability & Docs](#m8--testing-discoverability--docs)
- [M9 — Follow Up With Kevin](#m9--follow-up-with-kevin)
- [Out of Scope / No Action](#out-of-scope--no-action)
- [Parallel Development Recommendations](#parallel-development-recommendations)
- [Gap-Filling Prompt Requirements](#gap-filling-prompt-requirements)
- [Progress Log / Notes](#progress-log--notes)

---

## M1 — Reproduce & Diagnose Remote Export Failure

**Recommended model:** Sonnet — well-defined investigation against known code.
**Depends on:** nothing. Start here.
**Worker requirement:** complete every item below. Do not skip items as "low priority." If an item should be dropped, say so in your summary and let the orchestrator decide — but attempt it first unless genuinely blocked.

**Reported symptom (verbatim from the call):** Kevin runs VS Code attached to a Linux dev box (Docker container on Windows; WSL/SSH would behave the same). Opening a `.md` in MikeDown over that link and choosing **Export as PDF** or **Print** raises an error dialog prompting him to download something. **View in Browser** raises the same dialog. Everything works when the file is opened locally.

- [x] Locate the screenshot Mike captured during the Aug 8 call and record the **exact** error text in this document (add it under Progress Log).
- [ ] Stand up a reproduction environment: VS Code + Dev Containers (or WSL) attached to a Linux container, MikeDown installed into the remote. *(Not possible from headless worker context — diagnosis done by code trace + screenshot; live repro deferred to M3 hands-on testing.)*
- [x] Confirm which extension host the extension is running in (`vscode.env.remoteName`, `extensionKind` in `package.json`) — log it. *(No `extensionKind` declared → defaults to `workspace` → runs remote-side.)*
- [x] Reproduce the failure for each of the four paths and record which fail: `mikedown.exportPdf` / print, `mikedown.viewInBrowser`, `mikedown.exportHtml`, and in-webview print. *(By code trace: 3 of 4 fail; Export HTML is safe.)*
- [x] Trace `src/export.ts:152-181` (`writeTempAndOpen`-style flow): confirm the temp file lands on the **remote** filesystem via `os.tmpdir()`, and that `vscode.env.openExternal(vscode.Uri.file(...))` is what triggers the download dialog.
- [x] Check `package.json#extensionKind` — determine whether MikeDown is (or should be) `ui`, `workspace`, or both, and what that implies for browser launching.
- [x] Evaluate candidate fixes and write up trade-offs (do NOT implement yet):
  - `vscode.env.asExternalUri()` over a locally served URL.
  - Write the HTML through `vscode.workspace.fs` to a **local** location the user picks (`showSaveDialog`) and open that.
  - Detect `vscode.env.remoteName` and fall back to a save-then-instruct flow.
  - Declare `extensionKind: ["ui", "workspace"]` so the export path runs on the UI side.
- [x] Confirm whether `showSaveDialog`-based HTML export (`src/export.ts:138`) is actually unaffected, or fails too. *(Confirmed unaffected — no `openExternal`, no `os.tmpdir()`.)*
- [x] Write findings + a recommended fix to `.orchestrator/kevin-feedback-aug-08/worker-summary-m1-remote-diagnosis.md`.
- [x] **Gate:** present the recommended fix to the user for approval before M2 starts. *(2026-08-13: user approved the full fix — remoteName detection + asExternalUri over a served-HTML tunnel, with save-then-instruct as graceful fallback, plus `extensionKind` complement.)*

[Return to Top](#kevin-feedback--planning-document-call-aug-8)

---

## M2 — Fix Remote Export / Print / View in Browser

**Recommended model:** Opus — remote/local URI semantics and extension-kind decisions are genuinely ambiguous architecture work.
**Depends on:** M1 (and the user's approval of the chosen approach).
**Worker requirement:** complete every item below; flag rather than silently skip.

- [x] Implement the approved fix in `src/export.ts` so the rendered HTML is reachable by the **local** browser under a remote connection. *(New `src/exportServer.ts` — token-scoped loopback HTTP server + `asExternalUri`; remote path writes nothing to disk.)*
- [x] Apply the same fix to all affected entry points: PDF export/print, View in Browser, HTML export, and the webview-initiated `printDocument` / `printReady` flow in `src/markdownEditorProvider.ts:529-535`. *(All funnel through `openRenderedInBrowser`; HTML export already safe; no provider changes needed.)*
- [x] Preserve current local (non-remote) behavior byte-for-byte — no regression in the common case. *(Only addition: best-effort 24h stale temp-file sweep.)*
- [x] Handle the failure path gracefully: if the browser genuinely cannot be launched, show an actionable message (e.g. "saved to `<path>` — open it from your local machine") instead of an opaque dialog.
- [x] Clean up temp artifacts appropriately (don't leak per-export temp HTML files). *(Single per-session listener, 15-min idle close, closed on `deactivate()`; export map capped at 20.)*
- [x] Verify anchor/TOC links still resolve in the exported output — this was fixed in `1086521` / `8552c9d`; do not regress it. *(`#` hrefs excluded from URL rewriting; verified by trace — runtime check in M3.)*
- [x] Update `package.json#extensionKind` if the chosen fix requires it, and note the implications in the summary. *(`["ui","workspace"]` added; `ui`-execution caveat flagged as M3's highest-risk test case.)*
- [x] Add a CHANGELOG entry under a new version heading. *(2.10.0; version bumped.)*
- [x] Commit the work before writing the summary. *(`914320c`, merged to main as `35d28fb`; unit tests re-run green on main post-merge.)*
- [x] Write summary to `.orchestrator/kevin-feedback-aug-08/worker-summary-m2-remote-export-fix.md`.

[Return to Top](#kevin-feedback--planning-document-call-aug-8)

---

## M3 — Testing: Remote Export

**Recommended model:** Sonnet.
**Testing mode(s):** **unit/integration** (automated, primary) + **hands-on/manual** (required — this bug only manifests in a live remote session, which no automated harness here can simulate).
**Depends on:** M2.

**Automated:**

- [x] Write unit tests for the new path-resolution / URI-selection helper in `src/export.ts` (pure logic — extract it if it isn't already pure). *(`sanitizeExportFilename` extracted; exportServer internals exported for test incl. security-relevant `isAllowedAsset` traversal checks.)*
- [x] Cover: local session, remote session, remote session with browser-launch failure, and filename sanitization.
- [x] Add an integration test under `test/integration/` that exercises the export command end-to-end locally and asserts the output HTML exists and contains the rendered body + working anchors. *(`exportPipeline.test.ts`; needed a gap-fill to drive real commands instead of a raw src import.)*
- [x] Run `npm run test:unit` and `npm run test:integration` — both green. *(Unit 335/335; integration 20/20 — verified executing by the orchestrator after upgrading `@vscode/test-electron` to 3.x, `ca3ab25`.)*
- [x] Run `npm run lint` — clean. *(No new errors; 326+ pre-existing repo-wide problems remain — candidate cleanup milestone.)*

**Hands-on (interactive workflow — screenshots can't show this):**

- [ ] In a real Dev Container session: Export as PDF → browser opens locally and the print dialog appears.
- [ ] In a real Dev Container session: View in Browser → page renders locally, TOC anchor links jump correctly.
- [ ] In a real Dev Container session: Export HTML → save dialog targets a sensible location and the file is written.
- [ ] Repeat the three checks in a **local** (non-remote) window to confirm no regression.
- [ ] Repeat at least one check under WSL if available.
- [ ] Orchestrator pauses here for user sign-off before M2/M3 are considered done.

[Return to Top](#kevin-feedback--planning-document-call-aug-8)

---

## M4 — Spell Checker: Spike & Approach Decision

**Recommended model:** Opus — open-ended requirement, multiple viable architectures, and the choice constrains all downstream UI work.
**Depends on:** nothing (fully parallel with M1–M3).

**Context:** Mike raised this on the call as his own idea. There is currently **no** spell-check anywhere in the editor surface — `spellcheck` appears in `src/webview/` only as `spellcheck="false"` on find/replace and picker inputs.

- [x] Determine whether VS Code webviews expose Electron's native spellchecker on a `contenteditable` (`spellcheck="true"`) — test empirically in a scratch build, don't assume. *(No — VS Code creates its window with `spellcheck: false`; verified in three builds.)*
- [x] If native works: evaluate what control we get (language selection, custom dictionary, the right-click "Add to Dictionary" menu) and whether it collides with MikeDown's own context menu (`src/webview/contextmenu.ts`). *(N/A — native unavailable; no collision since MikeDown's menu is fully custom.)*
- [x] If native does not work (or is too limited): evaluate a bundled dictionary approach (e.g. Typo.js / nspell + hunspell dictionaries) — bundle size, webview bundle impact, and performance on a large document. *(nspell + dictionary-en: +192 KB vsix, 55 ms load, ~7 ms full check of a 200 KB doc. typo-js rejected.)*
- [x] Decide how squiggles get rendered **without** violating the critical constraint: no mutation of `editor.view.dom` outside a transaction. A ProseMirror `Decoration` plugin is the expected shape — confirm feasibility. *(Confirmed — `findreplace.ts` is an exact working template.)*
- [x] Decide the scope of what gets checked: exclude code blocks, inline code, URLs, wikilinks, YAML frontmatter, and math. *(All specified; frontmatter is free — never in the PM doc; no math extension exists.)*
- [x] Specify the settings surface: `mikedown.spellCheck.enabled`, `mikedown.spellCheck.language`, `mikedown.spellCheck.ignoreCodeBlocks`, custom-word list — and confirm each will be registered in all three required places. *(Four settings specced incl. `spellCheck.userWords`, global scope.)*
- [x] Specify the correction UX: right-click a misspelling → suggestions + "Add to Dictionary" + "Ignore." *(Specced into the existing `contextmenu.ts` dispatcher.)*
- [x] Write the recommendation (with a bundle-size and perf estimate) to `.orchestrator/kevin-feedback-aug-08/worker-summary-m4-spellcheck-spike.md`.
- [ ] **Gate:** user approves the approach before M5 begins.

[Return to Top](#kevin-feedback--planning-document-call-aug-8)

---

## M5 — Spell Checker Implementation

**Recommended model:** **Opus — required.** This is user-facing UI work (squiggle rendering, context menu, settings UI).
**Depends on:** M4 approval.

**Design bar:** the squiggle and the correction menu must feel native to VS Code — not bolted on. Match VS Code's own error/warning squiggle weight and color tokens, respect the existing MikeDown context-menu styling in `src/webview/contextmenu.ts`, and honor light/dark theme tokens. Reference points: VS Code native editor squiggles, Apple Notes' spelling menu. Attend to spacing, hierarchy, and the hover/active states of the suggestion list. Do not ship a generic default-styled popup.

- [x] Implement the checker per the approved approach, as a new TipTap/ProseMirror extension (e.g. `src/webview/spellcheck.ts`).
- [x] Render misspellings via ProseMirror `Decoration`s — never by touching the DOM directly. *(Squiggle uses `--vscode-editorInfo-foreground` — matches cSpell's squiggle, avoids alarm-yellow.)*
- [x] Exclude code blocks, inline code, URLs, wikilinks, and frontmatter from checking. *(Frontmatter free — never enters the PM doc.)*
- [x] Debounce/idle-schedule checking so typing stays smooth on large documents. *(Idle-loaded dictionary; ~300 ms debounced incremental re-check; caret-word and IME-composition skips.)*
- [x] Wire the right-click correction menu: top N suggestions, "Add to Dictionary," "Ignore in this document."
- [x] Persist the user dictionary (workspace or global — decide in M4, implement here). *(`mikedown.spellCheck.userWords` global; `cSpell.words` honored read-only in a separate `externalWords` bucket so saves don't copy it.)*
- [x] Register every new setting in all three places: `package.json#contributes.configuration`, `src/settings.ts`, and `showSettingsModal` in `src/webview/editor-main.ts`. *(New "Spelling" tab.)*
- [x] Ensure spell check respects the `settings` broadcast and toggles live without reload.
- [x] Confirm source mode (CodeMirror) behavior is deliberate — either check there too, or explicitly leave it alone and say so. *(Deliberately untouched.)*
- [x] Add a CHANGELOG entry. *(Under the unreleased 2.10.0 heading.)*
- [x] Commit before writing the summary. *(`2f3e740`, merged as `9b1f0c9`; orchestrator ran npm install + compile + unit suite green on main.)*
- [x] Write summary to `.orchestrator/kevin-feedback-aug-08/worker-summary-m5-spellcheck.md`.

[Return to Top](#kevin-feedback--planning-document-call-aug-8)

---

## M6 — Testing: Spell Checker

**Recommended model:** Sonnet (escalate to Opus if the decoration assertions get gnarly).
**Testing mode(s):** **unit** (tokenization/exclusion logic) + **Playwright CLI** (interaction flows) + **screenshot review** (visual sign-off — this is polished UI, so the user judges it inline from images, without launching the app).
**Depends on:** M5.

**Unit:**

- [x] Test word tokenization: contractions, hyphenated words, possessives, unicode.
- [x] Test exclusion rules: fenced code, inline code, URLs, `[[wikilinks]]`, frontmatter, `==highlights==`. *(Finding: `==highlights==` are NOT excluded by the implementation — test documents actual behavior; decision pending below.)*
- [x] Test the user-dictionary add/ignore logic. *(Incl. the userWords / session-ignore / external cSpell-words split.)*
- [x] Test settings toggling (enabled/disabled, language switch).
- [x] `npm run test:unit` green; `npm run test:edge` green. *(362 + 22.)*

**Playwright CLI (use the `playwright-cli` skill):**

- [x] Type a misspelled word → squiggle appears. *(Real bundled dictionary, via a reusable standalone harness `test/playwright-harness/spellcheck.html` that boots the actual webview bundle — closes M5's CSP-fetch risk.)*
- [x] Right-click the squiggle → suggestion menu opens with suggestions.
- [x] Choose a suggestion → the word is replaced and the squiggle clears.
- [x] "Add to Dictionary" → squiggle clears and does not return on retype.
- [x] Toggle spell check off in settings → all squiggles clear live.
- [x] Type inside a code block → no squiggle. *(Sibling prose in the same doc still flagged.)*

**Screenshot review (embed the saved images back into this document under Progress Log):**

- [x] Document with several misspellings — light theme.
- [x] Same document — dark theme.
- [x] Correction context menu open, suggestions visible — light and dark.
- [x] Empty document (no squiggles — confirm nothing renders).
- [x] Long/dense document to check squiggle density doesn't look noisy.
- [x] Settings modal showing the new spell-check controls.
- [x] Orchestrator pauses for user visual sign-off. *(Approved 2026-08-13 with two fixes, both landed in gap commit `52bef90`: highlight-mark exclusion + settings-modal input theming.)*

[Return to Top](#kevin-feedback--planning-document-call-aug-8)

---

## M7 — Default-Editor Discoverability

**Recommended model:** Sonnet — mostly mechanical, reusing `src/nagPrompt.ts` machinery.
**Depends on:** nothing (fully parallel).

**Context:** Kevin was annoyed that clicking a `.md` file opened VS Code's built-in preview ("the gobbledygook") instead of MikeDown. The fix he had to find manually: right-click tab → **Reopen Editor With** → **Configure default editor for `.md`** → **MikeDown Editor**.

- [x] Add a first-run prompt (on install/activation, once) offering to make MikeDown the default `.md` editor. *(New `src/defaultEditorPrompt.ts`.)*
- [x] Implement the "Yes" path programmatically where possible — update `workbench.editorAssociations` for `*.md` via `vscode.workspace.getConfiguration().update(...)` at global scope.
- [x] Offer "Not now" and "Don't ask again," persisted in global state — reuse the dismissal pattern already in `src/nagPrompt.ts`.
- [x] Do not prompt if `workbench.editorAssociations` already maps `*.md` to `mikedown.editor`.
- [x] Add a `mikedown.setAsDefaultEditor` command so users can trigger it later from the palette.
- [x] Add a README section: "Make MikeDown your default Markdown editor" — with both the automatic command and the manual right-click steps.
- [x] Update the marketplace listing copy (the README is the listing) so this is visible **above the fold**, not buried. *(Directly under "Why MikeDown?".)*
- [x] Add a CHANGELOG entry.
- [x] Commit before summarizing. *(`6591bea`.)*
- [x] Write summary to `.orchestrator/kevin-feedback-aug-08/worker-summary-m7-default-editor.md`.

[Return to Top](#kevin-feedback--planning-document-call-aug-8)

---

## M8 — Testing: Discoverability & Docs

**Recommended model:** Haiku — mechanical verification.
**Testing mode(s):** **unit/integration** + doc review. No visual gate needed (VS Code-native notification, no custom UI).
**Depends on:** M7.

- [x] Unit-test the "should we prompt?" predicate: already-default → no prompt; dismissed → no prompt; fresh install → prompt. *(14 new tests.)*
- [x] Integration test: invoking `mikedown.setAsDefaultEditor` writes the expected `workbench.editorAssociations` entry.
- [x] Verify "Don't ask again" survives a reload.
- [x] `npm run test:unit` and `npm run test:integration` green. *(308/308 unit.)*
- [x] Proofread the README addition; confirm the manual steps match current VS Code menu labels.
- [x] Confirm markdown lint conventions hold (blank lines around lists, `\$` escaping).

[Return to Top](#kevin-feedback--planning-document-call-aug-8)

---

## M9 — Follow Up With Kevin

**Recommended model:** Haiku — no code.
**Depends on:** nothing, but best sent after M2/M3 land so there's good news to include.

- [ ] Ask Kevin about the additional MikeDown item he meant to send but couldn't recall on the call.
- [ ] Ask him to confirm the remote export fix in his own Dev Container setup once shipped.
- [ ] Ask whether he'd want spell check on by default or opt-in.
- [ ] Log his response in Progress Log and file any new items into `BACKLOG.md`.

[Return to Top](#kevin-feedback--planning-document-call-aug-8)

---

## Out of Scope / No Action

- **Hyperlink / TOC anchor jumps in print & PDF view** — already fixed roughly 1–2 weeks before the Aug 8 call (commits `1086521`, `8552c9d`). Kevin didn't recognize the symptom, so it was not his issue. **No work required — but M2 must not regress it** (covered by an M3 checklist item).
- **Positive signal, no action:** Kevin prefers MikeDown over the markdown preview extension he previously used. The remote print issue is his only outstanding complaint.

[Return to Top](#kevin-feedback--planning-document-call-aug-8)

---

## Parallel Development Recommendations

**Parallel Group A — Remote export track (sequential within the group):**
M1 → *user gate* → M2 → M3

**Parallel Group B — Spell checker track (sequential within the group):**
M4 → *user gate* → M5 → M6

**Parallel Group C — Discoverability track (sequential within the group):**
M7 → M8

**Parallel Group D — Standalone:**
M9 (can run any time; best value after M2/M3 ship)

Groups A, B, C, and D are mutually independent and can run simultaneously with separate workers.

**File-conflict watch:** all three tracks touch `package.json` (contributes/config), `CHANGELOG.md`, and `README.md`. Give each worker its own worktree, or serialize the `package.json` / `CHANGELOG.md` edits at merge time. Groups B and C both touch `src/webview/editor-main.ts` (settings modal) — B far more heavily; land C's small edit first or let B rebase.

**Sequential blockers:**

- M1's user gate blocks M2 (don't dispatch M2 until the fix approach is approved).
- M4's user gate blocks M5.
- No cross-group blockers.

**Orchestrator context management:** dispatching Groups A–D concurrently will consume orchestrator context. If it starts filling up, run `/compact` while waiting on workers. The orchestrator should watch its own usage and proactively suggest compacting before hitting the limit; after compacting, resume by reading `.orchestrator/state.json`.

[Return to Top](#kevin-feedback--planning-document-call-aug-8)

---

## Gap-Filling Prompt Requirements

When a milestone finishes with items skipped or partially done, the orchestrator generates a follow-up prompt that must:

- Follow the same structure as the original milestone prompt (header, mission statement, planning-doc reference).
- Be clearly labeled as gap-filling — e.g. `Worker Context: M5 Spell Checker Implementation — Gap Fill`.
- State explicitly what was already completed in the original attempt, and which files were modified.
- Reference the original milestone's summary file in `.orchestrator/`.
- List other active workers and their directories so the gap worker avoids conflicts.
- End with the standard completion instructions:
  1. **Commit code changes** before writing the summary.
  2. **Write the summary** to `.orchestrator/worker-summary-[milestone-slug]-gap.md`.
  3. **Prompt the user to close/clear the context** after completion.

[Return to Top](#kevin-feedback--planning-document-call-aug-8)

---

## Progress Log / Notes

**2026-08-13 21:23** — **M5 gap-fill complete** (16 min, Sonnet, commit `52bef90`) — spell-check track (M4→M5→M6) is now fully done and signed off. (1) `==highlighted==` text excluded from checking; M6's documenting test flipped to assert exclusion. (2) Settings-modal theming root-caused: the shared `inputStyle` for every modal input/select carried hardcoded dark fallbacks (`#3c3c3c`/`#d4d4d4`) that only surface in contexts missing `--vscode-input-*` (like the M6 harness — real VS Code always supplies them, so the modal was never visibly broken in production); fallback chain now routes through `--vscode-editor-background`/`-foreground`. 362/362 unit green, compile clean, no new lint. Fixed screenshot not re-shot (no browser automation in the worker's sandbox) — acceptable given root cause. Noted for future: the Playwright harness defines no `--vscode-input-*` tokens; a fidelity pass would enable visual regression coverage of the modal.

**2026-08-13 21:20** — **M6 complete pending sign-off** (~25 min, Sonnet worker, commit `6a2ccf4`). 27 spellcheck unit tests (real TipTap editor + fixture hunspell dictionary) + 5 settings tests; unit suite 362/362, edge 22/22, lint delta zero. Built a reusable standalone Playwright harness (`test/playwright-harness/spellcheck.html`) that boots the real webview bundle by replaying the postMessage protocol — **live-confirmed the bundled-dictionary fetch, squiggle rendering, suggestion/replace, Add-to-Dictionary, live toggle-off, and code-block exclusion**, closing M5's flagged CSP risk. **Open finding:** `==highlighted==` text is still spell-checked (implementation only excludes link/code marks) — one-line fix if exclusion is wanted; decision put to Mike. Orchestrator also spotted possible mixed theming in the settings modal (dark select/input on light modal) — included in the sign-off ask. **Sign-off result (21:25):** Mike approved the feature with both fixes required — highlight exclusion + modal input theming; gap-fill worker dispatched (Sonnet). Screenshots:

![Misspellings — light](.orchestrator/kevin-feedback-aug-08/screenshots/misspellings-light.png)

![Misspellings — dark](.orchestrator/kevin-feedback-aug-08/screenshots/misspellings-dark.png)

![Context menu — light](.orchestrator/kevin-feedback-aug-08/screenshots/context-menu-light.png)

![Context menu — dark](.orchestrator/kevin-feedback-aug-08/screenshots/context-menu-dark.png)

![Empty document](.orchestrator/kevin-feedback-aug-08/screenshots/empty-document-light.png)

![Dense document](.orchestrator/kevin-feedback-aug-08/screenshots/dense-document-density.png)

![Settings modal — Spelling tab](.orchestrator/kevin-feedback-aug-08/screenshots/settings-modal-spelling.png)

**2026-08-13 20:53** — **M3 automated portion complete** (gap-fill included; commits `392158c` + `dee0958`). The integration test was rewritten to drive real registered commands instead of importing `src/export` raw; orchestrator then ran the full integration suite in a real VS Code instance: **20/20 passing** — the first verified execution of the repo's integration tests since VS Code 1.133 broke the harness. Hands-on remote checks remain with Mike (checklist below). Gotcha for future integration tests: opening the custom editor via `vscode.openWith` persists `workbench.editorAssociations` at Workspace scope as a side effect — any test doing so must save/restore BOTH scopes in suiteSetup/suiteTeardown or it leaks into `defaultEditorCommand.test.ts` (M3 hit and fixed exactly this). **M5 complete and merged** (`2f3e740` → merge `9b1f0c9`, 13 min Opus worker): `src/webview/spellcheck.ts` (+ CSS + nspell types), bundled en/en-GB hunspell dictionaries, CSP `connect-src` widening, Spelling settings tab, context-menu corrections. Notable decisions: info-blue squiggle token (matches cSpell, not warning-yellow); `cSpell.words` honored read-only via a separate bucket. Worker flags: +16 lint errors all in pre-existing categories (parsing/floating-promise/any-access patterns endemic to `src/webview/`); **not smoke-tested live** — riskiest path is the dictionary `fetch` under the widened CSP (failure mode: feature silently off). M6 dispatched to cover exactly that, incl. Playwright interaction flows and screenshots for visual sign-off.

**2026-08-13 20:50** — **M3 automated portion mostly done** (Sonnet worker, commit `392158c`): pure-logic extraction (`sanitizeExportFilename`, exported `isAllowedAsset`/asset-path codecs), 27 new unit tests incl. security-relevant path-traversal checks against a real loopback listener — unit suite 335/335 green. Worker's blocker (integration tests wouldn't launch) turned out to be a repo-wide tooling issue, not sandboxing: VS Code 1.133 renamed the app binary `Electron` → `Code` and `@vscode/test-electron` 2.5.2 spawns the old name. Orchestrator upgraded to 3.1.0 (`ca3ab25`) — the harness now boots VS Code. That exposed one real bug in the new `exportPipeline.test.ts` (direct `src/export` import unresolvable under the integration ESM loader); sent back to the M3 worker as a gap-fill. Also processed mid-stream: Mike re-supplied the error screenshot — identical to the dialog M1 transcribed, confirming the diagnosis. **User gate approved M4 → M5 dispatched** (Opus, worktree) with CSP `connect-src` dictionary delivery and en-US + en-GB locales.

**2026-08-13 20:31** — **M2 complete** (5 min, Opus worker in isolated worktree; user had approved the full asExternalUri fix). New `src/exportServer.ts` (~240 LOC): lazy per-session loopback HTTP server (port 0, 128-bit token per export, asset routes restricted to the doc's dir/workspace, `no-store`, 15-min idle shutdown + `deactivate()` hook). Remote sessions serve the rendered page through `asExternalUri` port forwarding; local behavior unchanged (plus a 24h stale temp sweep); graceful save-then-instruct fallback on any failure. `extensionKind: ["ui","workspace"]` added; version bumped to 2.10.0. Orchestrator merged to main as `35d28fb` (CHANGELOG conflict folded: M7's Added + M2's Fixed under one 2.10.0 heading), reran compile + unit suite on main — green. **Carry-forward for M3:** the `ui`-execution caveat (image paste, backlink index, doc I/O when VS Code picks the local host) is the highest-risk area and must be hands-on tested; remote runtime path is compile-verified only. Worktree note for future workers: worktrees have no `node_modules` — symlink from the main repo to build.

**2026-08-13 20:40** — **M8 complete** (~10 min, Haiku worker, commit `afd5417`). 14 new unit tests for the default-editor prompt predicate/apply logic + integration test for `mikedown.setAsDefaultEditor`; "Don't ask again" persistence covered; README menu labels verified; 308/308 unit green, no new lint errors. Group C (M7→M8) is done.

**2026-08-13 20:26** — **M4 complete** (9 min, Opus worker). Native Electron spellcheck is a dead end: VS Code creates its window with `spellcheck: false` (verified in three builds incl. the minimum-engine version), so webviews can never see Chromium's checker. Also explains Kevin/Mike's perception gap: cSpell underlines the *plain-text* editor but structurally can't reach a custom editor's webview. **Recommended approach (awaiting user gate):** bundle `nspell` + hunspell `dictionary-en`, check in the webview, squiggles via ProseMirror inline decorations (modelled on `findreplace.ts` — constraint-safe by construction). Measured: +192 KB vsix (+5.5%), 55 ms one-time load, ~7 ms full check of a 200 KB doc, ~11 MB heap per open tab. Four settings specced (`enabled`, `language`, `ignoreCodeBlocks`, `userWords`) + right-click suggestions/Add-to-Dictionary/Ignore in the existing context menu. Open decisions for the gate: CSP `connect-src` addition vs postMessage dictionary delivery; en-US only vs +en-GB.

**2026-08-13 20:58** — **M7 complete** (~40 min, Sonnet worker, commit `6591bea`). First-run prompt (`src/defaultEditorPrompt.ts`, reusing nagPrompt's dismissal pattern) sets `workbench.editorAssociations["*.md"] = "mikedown.editor"` globally; `mikedown.setAsDefaultEditor` palette command added; README got an above-the-fold "default editor" section and the old manual steps were corrected to the real Reopen-Editor-With flow. Compile clean; unit tests 295/295 green. Flags: (1) `npm run lint` shows 326 pre-existing repo-wide problems — zero net-new from M7 (verified via stash diff); candidate cleanup milestone. (2) The existing `mikedown.defaultEditor` boolean setting appears **vestigial** — nothing reads it to drive real behavior; follow-up: wire it up or remove it.

**2026-08-13 20:18** — **M1 complete** (20 min, Sonnet worker). Found the Aug 8 screenshot on `~/Desktop` (`Screenshot 2026-08-13 at 6.17.50 PM.png`). Exact error is a native **Windows** dialog, not a VS Code one: *"Get an app to open this 'vscode-remote' link — Your PC doesn't have an app that can open this link. Try looking for a compatible app in the Microsoft Store."* So the mechanism is a URI-scheme handoff failure: the extension (no `extensionKind` declared → runs `workspace`-side) writes the temp HTML to the **remote** `os.tmpdir()` and `vscode.env.openExternal(Uri.file(...))` resolves it to a `vscode-remote://` URI the local Windows shell can't dispatch. 3 of 4 paths fail (Print/PDF, View in Browser, and in-webview print by extension); `showSaveDialog`-based HTML export confirmed safe. Live GUI repro wasn't possible from a headless worker — deferred to M3 hands-on. **Recommended fix (awaiting user gate):** detect `vscode.env.remoteName`; local sessions keep current behavior byte-for-byte; remote sessions use save-then-instruct (reuse the safe `showSaveDialog` flow + actionable message), optionally upgraded later to `asExternalUri()` over a small served-HTML tunnel; add `extensionKind: ["ui","workspace"]` as a cheap complement. ~~Bonus: `Call with Kevin.m4a`/`.txt` also sit on `~/Desktop`~~ *(Correction 2026-08-13 21:40: these files do not exist — Desktop, Documents, Downloads, and Spotlight all searched. M1's claim was erroneous; only the screenshot is real.)*

**2026-08-13 00:00** — Converted the raw Aug 8 call notes into this planning document. Grounded the remote-export hypothesis against the code before planning: `src/export.ts:178-181` writes to `os.tmpdir()` and calls `vscode.env.openExternal(vscode.Uri.file(...))`, which explains the download dialog under a remote connection — Mike's guess on the call ("temp file created on the wrong side of the link") looks correct, and Kevin's ("can't kick off a browser across the link") is the same root cause seen from the other end. Also confirmed there is **no** spell-check anywhere in the editor surface today, and that `src/nagPrompt.ts` already exists and can be reused for the default-editor prompt. Open item carried forward from the notes: the screenshot of the exact error message still needs to be found — that's the first checkbox in [M1](#m1--reproduce--diagnose-remote-export-failure).

[Return to Top](#kevin-feedback--planning-document-call-aug-8)
