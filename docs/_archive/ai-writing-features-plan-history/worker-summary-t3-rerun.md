# T3 automated pass: re-run after the fix wave

Model: `Qwen3.8-Flash-Next-oQ5e-mtp` on oMLX (`http://127.0.0.1:8000/v1`), same harness and host as the first pass. Code at `80e7dd2` (develop), `packages/core` rebuilt first. Harness unchanged.

Method note: Chrome screenshots timed out on every try (the renderer would not capture), while `javascript_tool` worked, so every check was driven through the DOM (synthetic clicks and keys, `selPara`, the slash menu fed through `handleTextInput`) and read back from `getMarkdown()`, `window.__reqs`, `[aiwire]`/`[ailatency]` logs and `getBoundingClientRect`. Layout checks (F4, F7) are geometric, not visual.

## Checklist

| # | Check | Result | Evidence |
|---|---|---|---|
| 1 | Bubble → More formal: streams, badge, Accept, one Cmd+Z | Pass | Badge "local · oMLX · Qwen3.8…"; 1 line changed; one Cmd+Z byte-equal, nothing left to undo. 3.3 s |
| 2 | Reading level → 8th grade, remembered | Pass | `mikedown.ai.audience = grade8`; reopened picker has 8th grade checked and focused. No empty answer this time |
| 3 | Rich selection with link → Translate → Spanish | Pass | Passage sent contains `[pilot notes](https://example.com/pilot-notes)`; after Accept the line has `[notas del piloto](https://example.com/pilot-notes)`; one undo byte-equal |
| 4 | Translate → Whole document | Pass | Frontmatter byte-identical, link, code block and `#planning` kept, caret at 1, one undo byte-equal. Off 2.8 s, High 6.6 s |
| 5 | Explain: read-only, Insert below, undo | Pass | Footer Insert below/Retry/Copy; paragraph unchanged; `> …` blockquote after it; one undo byte-equal |
| 6 | Thinking: High + Retry, wire fields | Pass | High → `"reasoning_effort":"high"`, Retry kept it; Off → `"chat_template_kwargs":{"enable_thinking":false}`; level remembered for the session (also by /summary, /title, Suggest) |
| 7 | `/summary` TL;DR + Outline, Insert, undo | Pass | `> [!NOTE]` / `> **Summary**` callout; Outline a nested list; each one Cmd+Z back to the `/sum` text byte-equal |
| 8 | `/title` | Pass | 3 candidates, hint "Sets title: in Properties"; pick set `title: "…"` only, H1 unchanged, sidebar updated, `/ti` removed; one undo byte-equal |
| 9 | Properties Suggest | Pass | Chips title, description, engineering, schedule (planning/team filtered, no "new" mark); tag and description applied, one undo each, back to the original |
| 10a | AI off | Pass | No bubble, no Rewrite in the context menu, `/sum` shows nothing, `/ti` has no Suggest titles, Suggest hidden; toolbar AI opens the first-run dialog (as designed) |
| 10b | AI on, no route | Pass | `/sum` empty; bubble and Suggest `aria-disabled` with "No engine and model is chosen for this task."; toolbar entries disabled with whole labels (see F4) |
| 11 | Source mode: Formal, Translate, Explain, AI menu Summarize | Pass | Formal changed line 11 only; Translate kept `[notas del piloto](https://example.com/pilot-notes)`; Explain blockquote after the line; Summarize inserted the callout at the caret line; one undo each, byte-equal |
| – | VS Code / Desktop log lines, Desktop Format > AI | Not testable | No VS Code or Desktop host in the harness |

## Fixed findings

| Finding | Result | Evidence |
|---|---|---|
| F1 link in rich selection | Pass | See row 3. Partial selection with bold: passage `standups went **asynchronous**, and Fridays stayed free.`, result kept `**asynchronous**` |
| F2 token headroom | Pass | 40 natural calls (22 at model default, 11 High, 7 Off), 0 empty, 0 cut. Table below |
| F2b cut answer note | Pass | Forced by capping `max_tokens` in a page-level `fetch` wrapper (harness untouched). Off, cap 30: "The answer was cut off at the length limit." on rewrite and TL;DR. Default thinking, cap 300: same plus "Lower Thinking, or Retry, for a full answer." TL;DR raw ended "To support this schedule"; Insert put "…To support this…", no fragment |
| F3 empty answer copy | Pass | Thinking on, cap 40/200/240/270: "No room left to answer. The model used its whole length budget thinking and sent no answer. Lower Thinking, or Retry." on rewrite, summary and Properties Suggest |
| F4 disabled menu labels | Pass | All three labels whole (label 228px, scrollWidth = clientWidth), hint on its own line (about 20px below the label, items 44px); same reason text on all three |
| F6 chips after AI off | Pass | 2 chips showing → AI off → row hidden, 0 chips, Suggest hidden |
| F7 header overflow | Pass | "Translate · Spanish · Whole document" at High: head 49–487, title 83–161 ellipsized (tooltip has the full text), dial 169–366, badge 374–449, Close 457–481, all inside |

### F2: `max_tokens` sent

| Call | Model default | High | Off |
|---|---|---|---|
| Rewrite (paragraph) | 2304 (2310 longer passage) | 4352 | 256 |
| Explain | 2648 | 4696 | – |
| Translate whole document | – | 5120 | 1024 |
| /summary TL;DR | 2304 | 4352 | 256 |
| /summary Outline | – | – | 384 |
| /title | 2320 | 4368 | 272 |
| Properties Suggest | 2432 | 4480 | 384 |

## Findings

No new or still failing code findings. Observations, minor:

- **O1. The `/summary` preview and the inserted text differ after a cut.** The popover shows the raw cut text ("…To support this schedule") while Insert drops the last word and adds "…", so the inserted text is not what was previewed. Repro: thinking Off, cap `max_tokens` at 30, `/summary`, Insert. Suspect: the preview renders raw text, only Insert runs `finalizeSummary` (`ai-rewrite.ts`).
- **O2. At High with a long title the badge text shrinks to about 44px** ("local · o…"); engine and model are then only in the tooltip. Within F7's fix (badge visible, nothing off the edge), noting it in case the badge should keep "local · oMLX". `styles/ai-rewrite.css`, `.ai-rw-badge`.
- F5 and F8 were not in the fix wave and were not re-tested. The out-of-scope blank-line drop after the frontmatter is still there.

## Start / End

Start 22:11, End 22:23 (2026-10-28, local).

## Review Materials

- Rerun: `npm run build -w packages/core`, then `cd /Users/michaeljosephwork/git/mikedown/packages/core && npx vite . --port 5198 --strictPort --config demo/ai-handson/vite.config.mjs` with `OMLX_API_KEY` set, and open `http://localhost:5198/demo/ai-handson/`.
- To force cuts: in the console, wrap `window.fetch` to overwrite `max_tokens` in `/chat/completions` bodies (what this pass did); thinking Off with 30 gives a cut answer, model default with about 200 an empty one and about 300 a cut one.
- Vite server killed by PID; my tab closed. One earlier tab (`localhost:5198/demo/ai-handson/`) fell out of the MCP tab group when the group was reset and may still be open in Chrome. Nothing committed, no source or harness changed.
