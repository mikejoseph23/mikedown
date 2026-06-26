# Heading Rename → Fix Links — Planning Document

## Summary

When a user renames a heading in the MikeDown editor, every link that pointed at that heading's anchor silently breaks — the in-document table of contents, and any cross-file backlinks like `other.md#old-heading`. This feature detects the rename, finds the affected links, and offers to rewrite them so the anchors stay valid.

**Target version:** 2.7.0 (minor bump — new feature).

## Why

Headings get renamed constantly during editing. Anchor slugs are derived from heading text, so a rename invalidates `#old-slug` everywhere it's referenced. Today the user has to hunt down and hand-fix each TOC entry and backlink. The backlink index and slug machinery to do this automatically already exist; only the rename detection and the rewrite step are missing.

## UX decision

A preference `mikedown.headingRename.updateLinks` with three values:

- `ask` (**default**) — when a rename affects N links, prompt: _"This heading is referenced by N links across M files. Update them?"_ Show which files. One click fixes all.
- `always` — fix silently (still undoable).
- `never` — do nothing.

**In-document TOC links vs cross-file backlinks.** In-doc links (`#slug`) are low-risk and self-contained — fixed inside the live editor via a ProseMirror transaction. Cross-file links (`file.md#slug`) touch files the user may not have open, so those edits go through a host `WorkspaceEdit` (visible, undoable). Under `ask`, in-doc fixes may be applied without prompting (frictionless common case); the prompt is reserved for cross-file edits. _(Open question — see below.)_

## How it works

### Rename detection (webview — the part with the most unknowns)

The webview only ever sends the full re-serialized markdown to the host (`editor-main.ts:2710`); no per-node diff crosses the boundary. ProseMirror has no stable node identity, and a rename arrives as many keystroke transactions. So we detect renames in the webview using **selection-scoped baselining** rather than transaction-step diffing:

1. When the selection **enters** a heading node, snapshot `{ baselineText, baselineSlug }`.
2. When the selection **leaves** that heading (or after an ~800 ms idle debounce), recompute the slug via `githubAnchorId()`.
3. If `slug !== baselineSlug` and `baselineSlug` is non-empty → emit one rename event `{ oldSlug, newSlug }`. Keystroke noise collapses to a single event because comparison happens only at the boundaries.

This naturally ignores brand-new headings (no baseline) and deleted headings (no current node).

### Finding affected links

- **In-doc:** walk the live document for link nodes whose href is `#oldSlug`.
- **Cross-file:** the host already has it — `BacklinkProvider` stores each `linkHref` verbatim including the `#anchor` fragment (`backlinkProvider.ts:65`), indexed by target file. Look up entries where the target is this file and the href ends with `#oldSlug`.

The webview asks the host for the cross-file count/files; the host responds `{ count, files[] }`. If the total is 0, do nothing (no prompt).

### Applying the fix

- **In-doc:** rewrite matching link nodes (`#oldSlug` → `#newSlug`) in a single ProseMirror transaction. (Per existing constraint: never mutate `editor.view.dom` outside a PM transaction — see `feedback_prosemirror_dom_writes`.)
- **Cross-file:** host `WorkspaceEdit` replacing the matching `linkHref` in each indexed source file, scoped to the correct target file + anchor.

## Slug reference

~~`githubAnchorId()` exists twice~~ — it actually existed **three** times (host `outlineProvider.ts`, host `markdownEditorProvider.ts`, and webview `editor-main.ts`), all byte-identical in behaviour. **Done in 2.7.0:** consolidated into a single dependency-free `src/anchoring.ts` (same shareability rule as `imageDisplayPath.ts` — no `vscode`/`node:*`/DOM), imported by both bundles. `test/unit/slugParity.test.ts` locks the slug behaviour and asserts no file redefines `githubAnchorId` (guards against re-divergence).

## Edge cases

- **Duplicate slugs (the nasty one).** Dedup uses encounter-order suffixes — `setup`, `setup-1`, `setup-2` (`editor-main.ts:4181`). Renaming one "Setup" heading shifts the `-1`/`-2` slugs of the *other* same-named headings, breaking links the user never touched. **v1 handles the unambiguous case only:** if the old slug's base name is duplicated in the document, skip the auto-fix and warn (_"'Setup' appears multiple times — links may need manual review"_). Disambiguating which `setup-N` a link meant is out of scope for v1.
- **Index freshness.** `BacklinkProvider` refreshes on save (`extension.ts:296`), so cross-file counts reflect the last-saved state of *other* files (fine — those files are on disk). The *current* file's unsaved in-doc links are counted by walking the live doc instead. Don't mix the two sources.
- **Explicit HTML anchors** (`<a id="...">`) are a separate link target from heading slugs and are not affected by a heading text rename — leave them alone.
- **Rapid successive renames** (rename A, then rename it again before saving): each settled rename is its own event; chain them so a link fixed in event 1 is found by event 2's new baseline.
- **Undo.** In-doc fix is part of the editor's undo stack. Cross-file `WorkspaceEdit` is its own undo entry — acceptable.

## Configuration

Per the project Settings rule, `mikedown.headingRename.updateLinks` must be registered in **three** places:

1. `package.json#contributes.configuration.properties` (enum `ask|always|never`, default `ask`).
2. `src/settings.ts` (reader).
3. The in-editor Settings modal in `src/webview/editor-main.ts#showSettingsModal`.

## Implementation sketch (suggested order)

1. **Rename detector** (webview) — selection-enter/leave baselining + debounce → rename event. Most unknowns; build and verify first in isolation.
2. **Host query + WorkspaceEdit** — given `{ file, oldSlug }`, return affected cross-file links; given confirmation, rewrite them.
3. **In-doc rewrite** (webview) — find `#oldSlug` link nodes, replace in one PM transaction.
4. **Prompt + preference** — wire `ask|always|never`, register the setting in all three places.
5. **Duplicate-slug guard** — detect ambiguity, warn, skip.

## Open questions — resolved

- ~~Under `ask`, should in-doc TOC fixes apply automatically?~~ **Decided: auto-fix in-doc, prompt only for cross-file.** The webview rewrites in-doc `#oldSlug` links in a single PM transaction immediately; the host prompt is reserved for cross-file edits.
- ~~Prompt surface?~~ **Decided: native VS Code modal** (`showInformationMessage(..., { modal: true }, 'Update Links')` in the host) for the cross-file confirm, and `showWarningMessage` for the duplicate-slug warning. Cross-file edits are a host concern and the messages are short.

## Acceptance criteria

Implemented in 2.7.0. Items marked ✅ are covered by code + unit tests + compile;
items marked 🔬 are implemented and verified by code review but still want a final
manual pass in a live VS Code window (integration suite not run this round).

- [x] ✅ Rename a heading that has an in-doc TOC link → the TOC link's anchor updates to the new slug. — `rewriteInDocLinks()` rewrites `#oldSlug` link marks in one PM transaction (`editor-main.ts`). 🔬 click-to-scroll behaviour relies on the existing anchor scroll path.
- [x] 🔬 Rename a heading referenced by another file's link → with `ask`, a prompt names the file(s) and count; confirming rewrites the cross-file link. — `fixCrossFileHeadingLinks()` (`markdownEditorProvider.ts`) queries `BacklinkProvider`, shows the modal, applies a `WorkspaceEdit`.
- [x] 🔬 Set preference to `always` → links fixed with no prompt. — host `pref === 'always'` skips the modal.
- [x] ✅ Set preference to `never` → no prompt, no edits. — webview gates the whole detector on `headingRenamePref !== 'never'`, so nothing is posted to the host.
- [x] ✅ Rename a heading with no inbound links → no prompt, no edits. — host returns early when `entries.length === 0`; in-doc rewrite is a no-op when no matching link marks exist.
- [x] ✅ Rename when a duplicate-named heading exists → no silent rewrite; a warning is shown. — `isRenameAmbiguous()` guard (unit-tested) → `headingRenameAmbiguous` → `showWarningMessage`.
- [x] ✅ Typing a rename character-by-character produces a single rename event, not one per keystroke. — selection-boundary baselining + 800 ms idle debounce; comparison only at boundaries (`detectHeadingRename`, unit-tested).
- [x] 🔬 Cross-file fixes are undoable as a single step; in-doc fixes undo with the editor. — one `WorkspaceEdit` for all cross-file edits; in-doc fix is a PM transaction on the editor's undo stack.
- [x] ✅ `mikedown.headingRename.updateLinks` is registered in `package.json`, `settings.ts`, and the in-editor Settings modal.
