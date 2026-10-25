# AI copilot brainstorm

Ideas for an embedded, optionally fully private, locally hosted writing copilot in MikeDown. Off by default, behind a new AI settings section. The provider layer (engine list, auth, model picker) is a separate effort; each idea only notes what it needs from it.

Legend for "engine needs": **stream** (token streaming), **embed** (embeddings endpoint), **tools** (function calling / JSON mode), **ctx** (rough context the feature sends), **latency** (how fast it must feel). "Local OK" is whether a 3B to 14B model is good enough.

## Architecture constraints first

These shape every idea below, so they come first.

1. **Webview CSP blocks all network.** `src/markdownEditorProvider.ts` sets `connect-src ${webview.cspSource}` and `default-src 'none'`. The webview cannot `fetch()` Ollama at `localhost:11434` or any cloud API. Inference must run in the **extension host** (Node, no CSP) and stream back over `postMessage`. Adding `http://localhost:*` to `connect-src` is possible but breaks the "fully offline" guarantee the comment advertises and would not help cloud endpoints anyway. Recommendation: host-side only.
2. **Desktop (Tauri) has `csp: null`** in `tauri.conf.json`, so the webview could call `localhost` directly, but the capabilities file scopes everything through app commands. Cleanest is a Rust-side `ai_complete` command (reqwest, streaming via Tauri events) so keys never live in the webview and the LAN/cloud call is auditable in one place. Same shape as `src/commands/fs.rs`.
3. **npm consumers need a plug-in point, not a built-in client.** `MikeDownHost` (`packages/core/src/host.ts`) is already the pattern: every optional method turns a feature on. Add optional `ai?: { complete(req, onToken, signal), embed?(texts), transcribe?(blob) }` to the host. Absent method hides every AI surface. The VS Code host and Desktop host implement it; a React/Vue/Angular consumer passes their own (their backend proxy, Ollama in dev, whatever). Core never ships a provider SDK.
4. **"Never mutate `editor.view.dom` outside a PM transaction."** Ghost text must be a **widget `Decoration`** in a plugin state (exactly how `spellcheck.ts` does misspellings), never a span injected into the DOM. Accept = one `tr.insertText`. Streaming into a decoration is fine: each token updates plugin state and PM re-renders the widget.
5. **Edits must be transactional and undoable.** Every AI rewrite is a single `tr` (or `editor.chain()`), so `Cmd+Z` reverts it in one step. Stream into a preview (bubble, diff panel, or decoration), then commit once on accept. Never stream directly into the document.
6. **Source mode (CodeMirror) is a second surface.** Ghost text there is a CM6 `WidgetType` decoration. Scope v1 to WYSIWYG mode; source mode gets the selection commands only.
7. **Cancellation and debounce live in the host.** One in-flight request per panel, `AbortController` on every keystroke, 300 to 500 ms idle debounce before a ghost request. Local models on a laptop will otherwise queue up and heat the machine.
8. **Context budget.** Default to a window around the cursor (previous 2 to 3 headings' worth, about 1.5k tokens) plus doc title and frontmatter. Whole-document context only for explicit commands. Small local models degrade past 8k anyway.
9. **Privacy UI.** A visible indicator (status bar item + sidebar footer) saying "AI: local (Ollama, qwen2.5:7b)" or "AI: cloud (OpenAI)". Cloud engines get a one-time consent dialog per workspace. A `mikedown.ai.allowCloud` setting defaulting to false, so a shared workspace can never silently leak.
10. **Settings rule applies.** Every `mikedown.ai.*` setting goes in `package.json`, `src/settings.ts`, and the Settings modal. The modal needs a new "AI" section with a "Test connection" button.

## Ideas

### 1. Inline ghost-text continuation

Writer pauses mid-sentence and a dim continuation appears; `Tab` accepts, `Esc` dismisses, typing through it keeps the matching prefix. Surface: inline widget decoration. Local OK: yes, 3B to 7B is fine for one sentence, FIM-capable models (Qwen2.5-Coder, Codestral) are best; use a "continue the text, output nothing else" prompt for chat models. Privacy: sends the cursor window continuously, so this must be an explicit opt-in separate from the master switch. Engine needs: stream, ctx 1.5k, latency under 600 ms to first token or it feels broken. Effort: **M** (decoration plugin, debounce, prefix-matching, CM6 twin later).

### 2. Selection rewrite menu

Select text, the existing bubble/context menu gains "Rewrite: shorter / longer / simpler / formal / casual / fix flow / custom prompt". Result streams into a popover showing old vs new; Accept replaces in one transaction, Retry regenerates. Surface: selection bubble + context menu + `Cmd+K`-style prompt box. Local OK: yes, 7B+ is good, 3B acceptable for shorten/fix. Privacy: sends only the selection plus one surrounding paragraph. Engine needs: stream, ctx under 2k, latency relaxed. Effort: **M**. The preview-then-commit popover is reused by half the other ideas, so build it once.

### 3. Grammar and style pass

Beyond `nspell`: run paragraphs through the model and get back `{from, to, replacement, reason}` spans rendered as a second class of underline (blue, distinct from red misspellings) with a hover card and one-click fix. Surface: inline decorations, same plugin shape as `spellcheck.ts`. Local OK: marginal. 7B models find real errors but also hallucinate offsets; anchor by quoting the exact original substring and re-find it in the paragraph rather than trusting numeric offsets. Privacy: paragraph-by-paragraph, on idle or on demand ("Check this document"). Engine needs: tools or JSON mode, ctx 1k per call, batchable. Effort: **L** (offset reconciliation, incremental re-check, dismiss memory).

### 4. Summarize / outline / TL;DR

Slash command `/summary` or toolbar action inserts a summary block (callout) at the cursor or the top; `/outline` drafts headings for an empty doc from a one-line brief; sidebar "Summary" tab shows a live abstract of the current doc. Surface: slash command + sidebar. Local OK: yes for short docs, long docs need chunk-then-merge. Privacy: whole document. Engine needs: stream, ctx up to the model max. Effort: **S** for the slash commands, **M** with chunking.

### 5. Chat with this document

Sidebar tab with a chat thread; the current markdown is the system context. Answers can cite headings (click scrolls there, using the existing anchoring code). "Insert at cursor" button on each answer. Surface: sidebar panel. Local OK: yes for Q&A on documents under the model's context. Privacy: whole doc per turn (or a cached prefix if the engine supports it). Engine needs: stream, ctx, optional prompt caching. Effort: **M**. The sidebar already has Properties / Outline / Backlinks tabs; this is a fourth.

### 6. Chat with the workspace (RAG over the backlink index)

Same chat panel with a "Workspace" scope. The host's `backlinkProvider.ts` already walks every markdown file; extend it to chunk by heading and embed into a local vector store (SQLite + a small cosine search, or `vectra`; no server). Answers cite `file#heading` and open on click. Surface: sidebar. Local OK: yes, `nomic-embed-text` / `bge-small` via Ollama for embeddings, 7B+ for generation. Privacy: the entire workspace gets embedded; index lives in `globalStorageUri`, never in the repo; cloud embeddings must require the cloud consent. Engine needs: embed, stream, ctx 4k+. Effort: **L** (indexer, incremental updates on save, citation UI). Desktop version indexes the open folder with the same code.

### 7. Frontmatter and tag suggestions

On save or on demand, the Properties sidebar shows suggested `tags:`, `description:`, `title:` chips drawn from the doc body and the workspace's existing tag vocabulary (`TagCount` already exists in the host). Click a chip to apply. Surface: sidebar Properties tab. Local OK: yes, constrained choice from existing tags is easy for a 3B. Privacy: doc body. Engine needs: JSON mode, ctx 2k. Effort: **S**.

### 8. Alt text for pasted images

When an image is pasted and the engine supports vision, generate alt text and fill the `![alt](path)`; otherwise fall back to the filename heuristic in `imagePaste.ts`. Also "Describe image" in the image context menu for existing images. Surface: automatic on paste + context menu. Local OK: yes with a vision model (LLaVA, Qwen2-VL, moondream 2B is fast). Privacy: image bytes leave the editor; with cloud engines this needs its own toggle. Engine needs: vision input, no stream. Effort: **S** given the paste pipeline already round-trips through the host.

### 9. Table and Mermaid from prose

Select a paragraph of comparisons and choose "Turn into table"; select a process description and choose "Turn into Mermaid flowchart". The result renders in the preview popover (the existing `mermaid.ts` renderer) before commit. Also `/table from prompt` and `/mermaid from prompt`. Surface: selection menu + slash. Local OK: tables yes; Mermaid syntax is fragile under 7B, so validate with the mermaid parser and auto-retry once with the error message. Privacy: selection only. Engine needs: stream, ctx small. Effort: **M**.

### 10. Link and wikilink suggestions

While writing, the engine (or just the embedding index from idea 6) spots phrases that match another note's title or heading and offers `[[Note]]` as a dismissible underline, like Obsidian's "unlinked mentions" but semantic. Surface: inline decoration + Backlinks sidebar section "Suggested links". Local OK: embeddings-only variant needs no generation model at all. Privacy: workspace index. Engine needs: embed. Effort: **M** once idea 6's index exists, otherwise **L**.

### 11. Voice dictation

Hold a hotkey or click a mic button, speak, text is inserted at the cursor as markdown; a second pass ("tidy") removes filler and adds punctuation. Surface: toolbar + hotkey. Local OK: whisper.cpp / `whisper-small` is fine; the tidy pass works on 3B. Privacy: audio is the most sensitive input; local-only by default. Engine needs: a `transcribe(blob)` host method; LymeScribe Server (`X-API-Key`, LAN) is a ready-made private backend for the Mac Studio setup, whisper.cpp or the OS dictation API for laptops. Host side: VS Code webviews can request `getUserMedia` (needs the `microphone` permission in the webview options); Desktop records in the webview or via a Tauri plugin. Effort: **L**.

### 12. Explain or expand selection

"Explain this" shows a tooltip-level answer without touching the doc; "Expand" turns a bullet into a paragraph; "Give me three alternatives" for a sentence. Surface: selection bubble. Local OK: yes. Privacy: selection. Engine needs: stream. Effort: **S** on top of idea 2.

### 13. Meeting notes to action items

Select or whole-doc: extract `- [ ]` task items with owners and dates into a "Action items" section, honoring the existing task-item syntax and `@date` conventions. Surface: slash command `/actions`. Local OK: yes with JSON mode. Effort: **S**. Pairs with dictation (idea 11) for a record-meeting-then-extract flow.

### 14. Heading and title generator

Empty H1 or `/title`: proposes three titles from the body; also "Rename heading" suggestions in the outline sidebar using the existing `headingRename.ts` plumbing so links stay valid. Surface: slash + outline context menu. Local OK: yes, 3B. Effort: **S**.

### 15. Continuity and consistency checker

Long-form writers: a sidebar pass that flags terms used inconsistently (`sign-in` vs `login`), undefined acronyms, tense drift, and heading-structure gaps (H2 jumps to H4). The structural checks are pure code; the model handles the semantic ones. Surface: sidebar "Review" tab with jump-to links. Local OK: partially. Effort: **M**.

### 16. Smart paste cleanup

`smartpaste.ts` already converts HTML; add an optional model pass for messy pastes (email threads, PDF text with hard wraps, chat logs) that re-flows paragraphs and recovers lists and headings. Surface: a "Clean up with AI" toast after a large paste. Local OK: yes. Privacy: pasted content. Effort: **S**.

### 17. Front-of-doc "What changed" summary

For files in git (host has `workspace.fs` and can shell to git): one click writes a human summary of the diff since the last commit into a callout or the CHANGELOG. Surface: toolbar/command palette. Local OK: yes. Effort: **S** (VS Code only; Desktop later).

### 18. Prompt-as-document ("notebook" blocks)

A fenced block ` ```prompt ` whose body is sent to the model on `Cmd+Enter`, with the answer inserted as a sibling block below. Turns any note into a lightweight LLM scratchpad; prompts stay in plain markdown and are portable. Surface: code block with a run button in the gutter. Local OK: whatever the user picks. Effort: **M**. Novel and very "markdown-editor"; also a cheap way to expose arbitrary prompts without building UI per use case.

### 19. Reading-level and audience dial

Status bar shows estimated reading grade (pure code, extends `wordCount`); clicking offers "Rewrite for: general / expert / ESL / 8th grade" over the selection or doc. Surface: status bar + selection. Local OK: yes. Effort: **S** on top of idea 2.

### 20. Translation keeping structure

Rewrite selection or document in another language while preserving headings, links, code blocks and frontmatter keys verbatim. Surface: selection menu + command. Local OK: 7B+ for major languages. Effort: **S** on top of idea 2, with a structure-preserving prompt and a post-check that link and code block counts match.

## Top 5 for an experimental first release

1. **Selection rewrite menu (idea 2) with the preview-then-commit popover.** It is the broadest win, proves the host streaming path, teaches the transaction-and-undo discipline, and ideas 12, 19 and 20 fall out of it as extra menu entries at near-zero cost.
2. **Inline ghost-text continuation (idea 1).** The feature people picture when they hear "copilot". Validates the decoration-based rendering rule, debounce and cancellation. Ship it as its own opt-in under the AI section.
3. **Chat with this document (idea 5).** Cheapest way to add a sidebar chat surface, which later becomes the workspace RAG panel without redesign. No embeddings dependency yet.
4. **Frontmatter and tag suggestions (idea 7) plus `/summary` and `/title` (ideas 4 and 14).** Small, local-model-friendly, uniquely markdown. They show the copilot understands documents, not just sentences, and they reuse the Properties sidebar and slash registry already in place.
5. **Alt text for pasted images (idea 8).** Small effort, real accessibility value, and the first vision touchpoint; it exercises the "feature hides itself when the engine lacks a capability" rule the provider layer will need anyway.

Deferred on purpose: workspace RAG (6) and dictation (11) are both **L** and each drags in a dependency (vector index, audio capture) that deserves its own plan; grammar pass (3) waits until local JSON-mode reliability is measured on the model catalog in `home-lab/local-ai/`.

## What the provider layer must expose (summary)

- `complete(request, onToken, signal)`: streaming, abortable, with system + user messages and a `format: 'json'` hint. Everything in the top 5 runs on this alone.
- `capabilities`: `{ stream, json, vision, embed, transcribe, maxContext }` so surfaces can hide themselves.
- `embed(texts)`: ideas 6 and 10 only.
- `transcribe(blob)`: idea 11 only.
- An `engineLabel` string for the privacy indicator, and an `isLocal` boolean gating the cloud consent flow.
