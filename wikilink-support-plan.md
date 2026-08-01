# MikeDown `[[wikilink]]` Support — Implementation Plan

## Context

MikeDown (`~/git/mikedown`) is a WYSIWYG markdown editor for VS Code (TipTap in a webview + extension host). It currently supports only standard `[text](path.md)` links, which are **path-based** — they break when files move and don't produce a clean cross-repo graph.

The goal is Obsidian-style `[[wikilink]]` support so MikeDown can be an editor in a distributed "second brain": markdown scattered across many git repos, linked by `[[Note]]` name references, browsable as a graph in Obsidian, and readable by an LLM (Claude Code) as the actual retriever. The defining difference from existing links is **name-based (basename) resolution**: `[[Note]]` matches `Note.md` anywhere in the workspace, not a fixed relative path. That is what survives files being scattered across repos.

Scope target: the VS Code **workspace** is the "vault." A multi-root workspace containing the relevant repos gives cross-repo resolution for free (`findFiles` already searches all workspace folders).

## Design decision

Implement the wikilink as an **atomic inline node** (not a text mark). `[[Note]]` and `[[Note|alias]]` are a single unit: renders the alias-or-name, is clickable, round-trips to `[[...]]` source. This mirrors the existing custom-node pattern in `src/webview/callout-node.ts` (markdown-it parse rule + `state.*` serializer + `parseHTML`/`renderHTML` HTML bridge).

Resolution is done **host-side** by basename search, reusing the existing `findFiles('**/*.{md,markdown}', '**/node_modules/**', ...)` pattern already in `markdownEditorProvider.ts`. The webview asks the host to resolve a name; the host answers with a resolved relative href (or "unresolved").

## Implementation — phased

### Phase 1 — Core node (parse / render / serialize round-trip)
New file `src/webview/wikilink-node.ts`, modeled on `callout-node.ts`:

- Define an inline atomic node `wikilink` with attrs `{ target, alias, anchor }`.
- `parseHTML()` matches `a[data-wikilink]`; `renderHTML()` emits `<a data-wikilink data-target="…" class="mikedown-wikilink">alias||target</a>`.
- `addStorage().markdown`:
  - **parse:** add a markdown-it **inline** rule before `'link'` matching `[[target(#anchor)?(|alias)?]]` → wikilink token → node HTML.
  - **serialize:** `state.write('[[' + target + (anchor?'#'+anchor:'') + (alias?'|'+alias:'') + ']]')`.
- Register in the extension list in `src/webview/editor-main.ts` (~line 2571, alongside `Callout`; register before/after link extensions so priority is correct).
- Suggested regex: `/\[\[([^\]|#]+)(#[^\]|]*)?(?:\|([^\]]*))?\]\]/`.

### Phase 2 — Click-to-open + host resolution
- **Host** (`src/markdownEditorProvider.ts`): add inbound message `resolveWikilink` (near `getFileHeadings`, ~line 703). Search workspace md files, match by `path.basename` (case-insensitive, strip `.md`); post back `{ type: 'wikilinkResolved', target, href|null }`. Add both to the `WebviewMessage` union (~line 1763).
- **Webview** (`editor-main.ts`): on render, batch-request resolution for visible wikilinks; apply resolved relative `href` to the node's anchor. Reuse the **existing `openLink` mousedown handler** (~lines 3353–3373) — no new click path needed once the anchor has a real href.
- Unresolved wikilinks: no href, get `mikedown-unresolved` class (mirrors `mikedown-broken-link` treatment).

### Phase 3 — Styling
- New CSS in `src/webview/links.css`: `.ProseMirror a[data-wikilink]` (distinct accent so wikilinks read differently from normal links) and `.ProseMirror a.mikedown-wikilink.mikedown-unresolved` (muted/dashed, like broken links at links.css:77–80). No host wiring needed — `links.css` is already injected (markdownEditorProvider.ts ~1699–1708).

### Phase 4 — Backlinks
- Extend `src/backlinkProvider.ts` `indexFile()` (~line 50) with a second regex for `[[ ]]`. Because wikilinks are basename references, resolve the target against the workspace file set (the index already enumerates all md files via `buildIndex`) rather than `path.resolve`. Push a `BacklinkEntry` with `linkHref` in `[[...]]` form. Existing `broadcastBacklinks` / sidebar path then shows them with no further change.

### Phase 5 — Inline `[[` autocomplete (nice-to-have)
- New trigger modeled on `src/webview/emojiautocomplete.ts` (inline-typing popup), NOT the dialog-bound `linkautocomplete.ts`. On typing `[[`, show a filename picker.
- Reuse the host `getLinkSuggestions` file list (already returns workspace md files, markdownEditorProvider.ts ~670) for candidates; insert a `wikilink` node on selection.

### Phase 6 — Optional: create-on-click for unresolved wikilinks
- Obsidian behavior: clicking an unresolved `[[Note]]` creates `Note.md`. Add a host branch on `openLink`/`resolveWikilink` that, when unresolved, prompts to create the file in a sensible location (same folder as current doc) then opens it. Gate behind a new `mikedown.wikilink.createOnClick` setting. Defer unless wanted.

## Files touched (summary)
- **New:** `src/webview/wikilink-node.ts`, wikilink CSS block in `src/webview/links.css`.
- **Edit:** `src/webview/editor-main.ts` (register node; resolution request/apply; unresolved styling hook), `src/markdownEditorProvider.ts` (`resolveWikilink` handler + message union), `src/backlinkProvider.ts` (second regex + basename resolve). Phase 5 adds an autocomplete module; Phase 6 adds a setting in `package.json` `contributes.configuration`.

## Verification
1. `npm run compile` (webpack) clean.
2. `npm run test:unit` — add unit tests for the wikilink markdown round-trip (parse `[[A]]`, `[[A|b]]`, `[[A#h]]` → node → serialize back to identical source), matching existing vitest patterns under `test/unit`.
3. Manual, in Extension Development Host (F5): open a multi-root workspace with two repos each containing a `.md`. In doc A type `[[NoteInRepoB]]`, confirm it renders styled, Cmd+Click opens `NoteInRepoB.md` in repo B. Type `[[DoesNotExist]]`, confirm unresolved styling and no navigation. Save and reopen the file in a plain text editor — confirm source is exactly `[[...]]` (round-trip preserved). Open the same vault folder in **Obsidian** and confirm the link and graph edge appear.
4. Backlinks: open `NoteInRepoB.md`, confirm the MikeDown sidebar lists doc A as a backlink.
