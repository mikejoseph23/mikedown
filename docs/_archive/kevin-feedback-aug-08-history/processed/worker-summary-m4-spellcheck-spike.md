# Worker Summary — M4: Spell Checker Spike & Approach Decision

**Status:** Complete — recommendation ready for user sign-off. No repo changes; nothing committed.

**Start:** 2026-08-13 20:17:35 EDT
**End:** 2026-08-13 20:26 EDT

---

## Headline

Native Electron spell check is **not available** — VS Code creates its window with
`webPreferences: { ..., spellcheck: false }`, so Chromium's spellchecker is off for the entire
workbench renderer, webviews included. Verified in three separate VS Code builds. The only viable
path is a **bundled hunspell dictionary checked in the webview (nspell) with ProseMirror inline
decorations for squiggles**. Measured cost: **+192 KB in the .vsix (+5.5%)**, **55 ms one-time
dictionary load**, **~7 ms to spell-check an entire 200 KB document**.

---

## Work completed

1. Confirmed the current state: `spellcheck` appears in `src/webview/` only as `spellcheck="false"`
   on find/replace and picker inputs. ProseMirror/TipTap never set the attribute on the
   contenteditable, so it currently defaults to *enabled* — meaning if Electron's spellchecker were
   live, MikeDown would already be showing squiggles. It doesn't.
2. Built a scratch probe workspace with a deliberately misspelled markdown file and opened it in
   (a) the user's installed VS Code and (b) a clean dev instance
   (`.vscode-test/vscode-darwin-arm64-1.126.0`) launched with `--extensionDevelopmentPath` +
   `--disable-extensions` against the repo's current build.
3. Grepped the shipped VS Code app bundles for the window's `webPreferences` — decisive evidence
   (below).
4. Benchmarked `nspell` + `dictionary-en` / `dictionary-en-gb` in a scratch npm project outside the
   repo (`/tmp/mdspike/bench`, since deleted): load time, memory, throughput on a real document,
   suggestion latency, runtime `add()`/`remove()`.
5. Read `src/webview/findreplace.ts` (existing decoration plugin), `src/webview/contextmenu.ts` +
   the right-click dispatcher in `editor-main.ts`, the settings modal tab structure, `src/settings.ts`,
   and the webview HTML/CSP in `src/markdownEditorProvider.ts` to size the integration.

## Empirical findings

**1. Native spellcheck is disabled at the Electron window level.**

`Visual Studio Code.app/Contents/Resources/app/out/main.js` creates the code window with:

```
webPreferences: { ...t, enableWebSQL:!1, spellcheck:!1, zoomFactor:..., autoplayPolicy:"user-gesture-required" }
```

`spellcheck:!1` is `spellcheck: false`. Present in all three builds checked: the user's installed
`/Applications/Visual Studio Code.app`, `.vscode-test/vscode-darwin-1.109.5` (the repo's minimum
`engines.vscode`), and `.vscode-test/vscode-darwin-arm64-1.126.0`. Webviews are iframes inside that
renderer and inherit the WebContents setting, so there is no per-webview opt-in — no squiggles, no
language selection, no native "Add to Dictionary", and no `dictionarySuggestions` in the context-menu
params. The visual probe agreed: no squiggles in the MikeDown editor.

*Confound found and ruled out:* the user has `streetsidesoftware.code-spell-checker` (cSpell)
installed, which underlines misspellings in the **plain text** editor. Those underlines are that
extension's diagnostics, not native spellcheck, and cSpell cannot reach a custom editor's webview at
all — so MikeDown's WYSIWYG mode has no spell check today even though source-adjacent editing does.
That asymmetry is probably what prompted Kevin's feedback.

**2. Bundled dictionary approach measured (nspell + hunspell `dictionary-en`).**

| Measure | Result |
| --- | --- |
| Dictionary raw | 552 KB `.dic` + 3 KB `.aff` |
| Dictionary gzipped (≈ size added to the .vsix zip) | **192 KB** |
| `nspell` library JS | ~27 KB (+ one tiny dep, `is-buffer`) |
| Dictionary parse / index build | **55 ms**, one-time |
| Heap after load | ~11 MB |
| Check README.md (15.7 KB, 2,230 words) | **1.5 ms** |
| Check a 200 KB document (28,383 words) | **6.6 ms** |
| `suggest()` for one misspelling | 1.2–6.8 ms |
| Re-check one 57-word paragraph, ×100 | 0.8 ms total |

`nspell` accepts the `.aff`/`.dic` as plain strings (no Node `Buffer` needed — webview-safe) and
exposes runtime `add(word)` / `remove(word)`, which covers both the persisted custom dictionary and
session-only "Ignore". `dictionary-en-gb` is the same size (552 KB) if a second locale ships.

`typo-js` was also installed for comparison: 1.9 MB installed because it ships its own dictionary
copies, and it has no advantage over nspell. Rejected.

**3. Squiggle rendering is feasible without touching `editor.view.dom`.**

`src/webview/findreplace.ts` is already an exact working template: a `Plugin` with a `state`
field holding a `DecorationSet`, `props.decorations` returning it, and `Decoration.inline(from, to,
{ class })`. Same shape works for misspellings; PM applies the class inside its own update cycle, so
the "never mutate `editor.view.dom` outside a transaction" constraint is satisfied by construction.
Styling is one CSS rule (`text-decoration: underline wavy var(--vscode-editorWarning-foreground)`).

## Recommended approach

**Bundle `nspell` + `dictionary-en` (and `dictionary-en-gb`), check in the webview, render squiggles
as ProseMirror inline decorations, and serve the dictionary files as webview resources.**

Shape of the implementation for M5:

- **New file `src/webview/spellcheck.ts`** — a TipTap `Extension` exporting a PM plugin, modelled on
  `findreplace.ts`. Holds the `DecorationSet` plus a `Map` of flagged ranges for the context menu.
- **Dictionary delivery.** Ship `dictionaries/en/index.{aff,dic}` in the extension (add the folder to
  `localResourceRoots`, keep it out of `.vscodeignore`) and `fetch()` it in the webview from an
  `asWebviewUri`. This requires adding **`connect-src ${webview.cspSource}`** to the CSP in
  `markdownEditorProvider.ts` (~line 1799) — today it is `default-src 'none'` with no `connect-src`,
  so `fetch` is blocked. That is a minimal widening: same-origin webview resources only, no external
  hosts, so the "fully offline" property is preserved. *Alternative if you'd rather not touch CSP:*
  the host reads the files and posts them over `postMessage` as a `dictionary` message. Slightly more
  code, ~550 KB per webview open instead of a browser-cached fetch. Fetch is the better default.
- **Load lazily.** Kick off the fetch + `nspell()` construction after first render (idle callback);
  55 ms should never sit on the document-open path. Until it resolves, no decorations.
- **Check incrementally.** Full pass when the dictionary lands; on `docChanged`, map the existing
  `DecorationSet` through `tr.mapping` and re-check only the block nodes touched by the transaction's
  step ranges, debounced ~300 ms. Skip the word the caret is currently inside so words aren't flagged
  mid-typing, and skip updates while `view.composing` is true (IME safety).
- **Tokenizer.** `[A-Za-z][A-Za-z'’]*` per text node, split on hyphens, skip tokens containing digits
  and all-caps acronyms. Worth doing well: an un-tuned tokenizer flagged 296 tokens in README.md, most
  of them `built-in`, `right-click`, `https`, `itemName`, `frontmatter` — i.e. tokenizer noise, not
  real misspellings.

Scope exclusions, and how each is enforced:

| Excluded | Mechanism |
| --- | --- |
| Fenced code blocks | skip nodes of type `codeBlock` during the `doc.descendants` walk |
| Inline code | skip text nodes carrying the `code` mark |
| URLs / links | skip text carrying the `link` mark, plus a URL-shaped-token regex guard for bare text |
| Wikilinks | skip the `wikilink` node (`src/webview/wikilink-node.ts`) |
| YAML frontmatter | **free** — frontmatter is stripped before the markdown reaches ProseMirror (`extractFrontmatter`, `editor-main.ts:258`) and lives in its own UI block, so it is never in the PM doc |
| Math | **n/a** — there is no math/KaTeX extension in the editor today |
| Mermaid blocks | covered by the `codeBlock` exclusion |

**Bundle-size estimate:** +192 KB compressed in the .vsix for the en-US dictionary (3.48 MB → ~3.67 MB,
+5.5%); +~380 KB if en-GB ships too. The dictionary is a static asset, so the webview JS bundle
(5.57 MB packaged) grows only by nspell itself, ~27 KB — do **not** inline the `.dic` into the bundle
via `asset/source`, that would add 552 KB to the JS and re-parse it on every editor open.

**Performance estimate:** 55 ms one-time dictionary load (off the critical path), ~7 ms for a full
re-check of a very large (200 KB) document, sub-millisecond for the per-keystroke incremental case,
~2 ms to produce suggestions on right-click. Memory ~11 MB per webview — note that with
`retainContextWhenHidden: true` this is per open document, so building the `nspell` instance once and
sharing it is not possible across webviews; ~11 MB × open tabs is the real cost. Acceptable, but worth
mentioning to the user.

Rejected alternatives: native Electron spellcheck (impossible, above); `cspell-lib` in the extension
host (multi-MB dependency, code-identifier oriented rather than prose, and adds a host round-trip per
check — no advantage for a prose editor); `typo-js` (larger, no benefit).

## Settings & UX spec

Four settings, each to be registered in all three required places —
`package.json#contributes.configuration.properties`, `src/settings.ts` (add a `spellCheck` block to
`MikeDownSettings`, following the existing `wikilink` / `sidebar` nesting pattern), and the in-editor
Settings modal:

| Setting | Type | Default | Notes |
| --- | --- | --- | --- |
| `mikedown.spellCheck.enabled` | boolean | `true` | master switch; when off, plugin returns `DecorationSet.empty` and never loads the dictionary |
| `mikedown.spellCheck.language` | enum `"en"` \| `"en-GB"` | `"en"` | changing it re-fetches and rebuilds |
| `mikedown.spellCheck.ignoreCodeBlocks` | boolean | `true` | when false, code blocks and inline code are checked too |
| `mikedown.spellCheck.userWords` | string[] | `[]` | the custom dictionary; written back by "Add to Dictionary" |

Settings modal placement: the modal is tabbed (`appearance` / `behavior` / `markdown` / `images` /
`about`, `editor-main.ts:1447`). Add a **"Spelling"** tab — four rows plus a small editable list for
`userWords` with add/remove. A `makeToggleRow` equivalent and `makeSelectRow` already exist. Saving
follows the existing `{ type: 'saveSettings', settings: {...} }` path.

`userWords` should be written at **global** scope by default so the dictionary follows the user across
workspaces (and rides Settings Sync); the VS Code settings UI still lets them scope it per-workspace.
Optional nicety worth considering: also honour `cSpell.words` read-only, since this user already has
the cSpell extension configured — costs three lines and immediately inherits their existing word list.

Correction UX (right-click):

- The `contextmenu` listener in `editor-main.ts:2781` gains a first branch, before the link/image/
  code-block checks: `editor.view.posAtCoords({ left: e.clientX, top: e.clientY })` → look the
  position up in the plugin's flagged-range map. If it hits, build a spelling menu.
- Spelling menu (a new `buildSpellingMenu()` in `contextmenu.ts`, same `ContextMenuEntry[]` shape):
  up to 5 `spell.suggest(word)` entries at the top (each replaces the range via
  `editor.chain().focus().insertContentAt({from, to}, suggestion).run()` — a proper transaction),
  a separator, **Add to Dictionary** (appends to `mikedown.spellCheck.userWords`, calls
  `spell.add(word)`, re-checks), **Ignore** (session-only `spell.add(word)`, not persisted), a
  separator, then the normal text-menu entries so nothing is lost by right-clicking on a misspelling.
- No collision with MikeDown's own context menu: the menu is fully custom (`contextmenu.ts`) and
  `preventDefault()`s the browser menu already, so the native "Add to Dictionary" item was never going
  to appear anyway — this is a pure addition to an existing dispatcher.

## Issues or blockers

None blocking. Three things needing the user's decision at sign-off:

1. **CSP change.** Adding `connect-src ${webview.cspSource}` is the clean way to load the dictionary.
   If the user would rather leave the CSP untouched, use the `postMessage` fallback.
2. **Locales.** Ship en-US only (+192 KB), or en-US + en-GB (+380 KB)? Additional hunspell locales
   exist as `dictionary-*` npm packages; shipping many would inflate the .vsix, so a future
   "point at your own `.aff`/`.dic`" setting is the scalable answer.
3. **Memory.** ~11 MB per open MikeDown tab, a consequence of `retainContextWhenHidden: true`.

Notes on tidiness: a stray VS Code window from the visual probe (workspace `spellprobe`, from the
user's installed VS Code) may still be open on the user's desktop — safe to close, nothing was
modified. The clean dev instance was killed; its throwaway profile and the benchmark project under
`/tmp/mdspike` were deleted. The fresh-profile dev instance triggered one macOS "Code is trying to add
a new helper tool" auth prompt (VS Code's auto-update helper); it was cancelled/dismissed with the
process, and no credentials were entered.

## Notes for orchestrator

- `git status` is clean of my changes — only the pre-existing untracked `kevin-feedback-aug-08.md`.
  Nothing compiled or written into the repo by me. (`dist/` and `out/webview/` were rebuilt at 20:19
  by another worker, not by this one.)
- M5 is a well-scoped implementation now: one new webview file (`spellcheck.ts`, expect ~250–350 LOC),
  a `buildSpellingMenu()` in `contextmenu.ts`, one branch in the `contextmenu` dispatcher, a new
  Settings-modal tab, the usual three-place settings registration, one CSP line, one
  `localResourceRoots` entry, plus `dictionaries/` in the package. It touches
  `markdownEditorProvider.ts` and `package.json` — **coordinate with M7**, which is also editing
  `package.json`.
- Worth telling the user directly: the reason spell check "works" in the plain markdown editor but not
  in MikeDown is their cSpell extension, which structurally cannot see a custom editor's webview.
