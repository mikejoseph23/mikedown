# Manual Test Script — v2.10.0 (spell check + print / view in browser)

Covers the two features that automated tests can't reach: the spell checker's real
rendering/interaction, and the remote export path (`asExternalUri` loopback server).

Time: ~15 min local, ~10 min more for the Dev Container pass.

## 0. Setup

```bash
npm run compile      # or `npm run watch` and leave it running
```

Then press `F5` in VS Code → an **Extension Development Host** window opens.

In that window, create a scratch file `spellcheck-test.md` anywhere and paste:

```markdown
# Speling Test Documnet

This paragraf has severall mistaeks in it.

Some `inlinecode wrongg` and a fenced block:

​```js
const mispeled = "notaword";
​```

This is ==highlited teext in a highlight== and should be ignored.

A [linkk to somewhere](https://example.com/notaword) and an image ![altt texxt](./nope.png).

Behaviour, colour, organise — British spellings.

MikeDown, TipTap, ProseMirror — proper nouns.
```

Open it with MikeDown (right-click → **Open with MikeDown**, or it opens by default
if you've set the association).

---

## 1. Spell check — rendering

| # | Step | Expected |
| --- | --- | --- |
| 1.1 | Look at the document | Blue (info-colored) squiggly underlines under `Speling`, `Documnet`, `paragraf`, `severall`, `mistaeks` |
| 1.2 | Look at the fenced code block and `` `inlinecode wrongg` `` | **No** squiggles (default `ignoreCodeBlocks: true`) |
| 1.3 | Look at `==highlited teext==` | **No** squiggles — highlighted text is excluded (commit `52bef90`) |
| 1.4 | Look at the link URL and image path | **No** squiggles on the URL/path; link *text* is checked normally |
| 1.5 | Type a new misspelling (`teh qwick broown`) | Squiggles appear as you type, within a beat — no flicker of the whole doc |
| 1.6 | Put the caret in the middle of a word you're still typing | The in-progress word isn't flagged mid-keystroke |
| 1.7 | Switch VS Code to a **light** theme, then a **dark** theme | Squiggles stay visible and legible in both |

## 2. Spell check — corrections & dictionary

| # | Step | Expected |
| --- | --- | --- |
| 2.1 | Right-click `paragraf` | Menu shows suggestions first (`paragraph` near the top), then a separator, then **Add to Dictionary** / **Ignore**, then the normal text menu (Bold, Italic, …) |
| 2.2 | Click the `paragraph` suggestion | Word is replaced, squiggle clears, undo (`Cmd+Z`) restores the misspelling |
| 2.3 | Right-click `mistaeks` → **Ignore** | Squiggle clears everywhere in the doc |
| 2.4 | Close the tab and reopen the file | The **ignored** word is squiggled again — Ignore is session-only by design |
| 2.5 | Right-click `severall` → **Add to Dictionary** | Squiggle clears immediately |
| 2.6 | Reopen the file | `severall` stays clean — it persisted to `mikedown.spellCheck.userWords` |
| 2.7 | Check Settings JSON (`Cmd+Shift+P` → Preferences: Open User Settings (JSON)) | `"mikedown.spellCheck.userWords": ["severall"]` is present |
| 2.8 | Remove it from settings JSON and save | Squiggle comes back in the open editor without a reload |
| 2.9 | Right-click a word with no plausible correction (e.g. `zzqxwv`) | Menu shows a disabled **No suggestions** row, still followed by Add/Ignore |

## 3. Spell check — settings modal (the primary UX)

Click the **gear** icon in the toolbar → **Spelling** tab.

| # | Step | Expected |
| --- | --- | --- |
| 3.1 | Toggle **Enable spell check** off | All squiggles disappear immediately in the open document |
| 3.2 | Toggle it back on | Squiggles return; no editor reload needed |
| 3.3 | Set language to **English (UK)** | `Behaviour`, `colour`, `organise` are clean; American-only spellings may now flag |
| 3.4 | Set language back to **English (US)** | `Behaviour`/`colour`/`organise` are flagged, `behavior`/`color` are clean |
| 3.5 | Toggle **Ignore code blocks** off | The fenced block and inline code now get squiggles |
| 3.6 | Open the modal in a **dark** theme | All controls (selects, checkboxes, buttons) are readable — no dark-on-dark text (fixed in `52bef90`) |
| 3.7 | Close the modal, check settings JSON | `mikedown.spellCheck.*` values match what you chose (settings write at Global scope) |

### 3b. cSpell interop (skip if you don't have Code Spell Checker installed)

| # | Step | Expected |
| --- | --- | --- |
| 3b.1 | Add `"cSpell.words": ["mistaeks"]` to your settings | MikeDown stops flagging `mistaeks` — cSpell's list is honored |
| 3b.2 | Right-click a different flagged word → Add to Dictionary | It lands in `mikedown.spellCheck.userWords`, **not** in `cSpell.words` — cSpell is read-only to us |

---

## 4. Export / Print / View in Browser — LOCAL (regression baseline)

Do this first, on a normal (non-remote) window. Use a document that has an image
and a relative link so asset rewriting is actually exercised.

| # | Step | Expected |
| --- | --- | --- |
| 4.1 | `Cmd+Shift+P` → **MikeDown: View in Browser** | Default browser opens a temp file (`file:///…/mikedown-preview-*.html`); content matches the editor, images render |
| 4.2 | `Cmd+Shift+P` → **MikeDown: Print / Export as PDF** | Browser opens (`mikedown-print-*.html`) and the print dialog pops **automatically**; "Save as PDF" produces a correct PDF |
| 4.3 | `Cmd+Shift+P` → **MikeDown: Export as HTML** | Save dialog → writes the file → toast "Exported to …"; opening it shows correct content |
| 4.4 | Repeat 4.1 a few times, then check `\$TMPDIR` | Old `mikedown-preview-*` / `mikedown-print-*` files get swept, not accumulated forever |
| 4.5 | Try all three on a doc with a mermaid diagram and a code block | Diagram and syntax highlighting survive into the exported HTML/PDF |

## 5. Export / Print / View in Browser — REMOTE (the actual fix)

This is the risky path: with `extensionKind: ["ui","workspace"]`, the extension may
now resolve UI-side against remote files.

**Setup:** open a folder in a real Dev Container (**Dev Containers: Reopen in
Container**), or WSL / Remote-SSH. Confirm the bottom-left indicator shows the
remote. Open a markdown file **from the remote workspace** in MikeDown.

| # | Step | Expected |
| --- | --- | --- |
| 5.1 | **MikeDown: View in Browser** | Your **local** browser opens on a forwarded `http://127.0.0.1:<port>/e/<token>` URL (or a `*.devtunnels.ms`-style forwarded host) — **not** a `vscode-remote://` error, not a blank page |
| 5.2 | Check the rendered page's images | Images load — they're served from `/a/<token>/…`, not broken `file://` links |
| 5.3 | Edit the doc, run View in Browser again | New page reflects the edit (a fresh token/entry, not a stale cache) |
| 5.4 | Take the URL from 5.1 and strip/alter the token | Request is rejected — the token gates access |
| 5.5 | **MikeDown: Print / Export as PDF** | Local browser opens the served page and the print dialog fires automatically; Save as PDF works |
| 5.6 | **MikeDown: Export as HTML** | Save dialog targets the **remote** filesystem; file is written there; relative image URLs are left alone (documented behavior) |
| 5.7 | Check the VS Code **Ports** panel | A forwarded port appears while the export page is open |
| 5.8 | Fallback path: block the browser open (e.g. run in a Codespace / a session where `openExternal` declines) | You get a **save dialog** ("Save for Printing" / "Save HTML") and a toast telling you where it landed + how to print — never an opaque error |
| 5.9 | Cancel that save dialog | Warning toast: "MikeDown couldn't open a browser from this remote session…" |
| 5.10 | Check the **Output → MikeDown / Extension Host** log | No unhandled errors; any fallback logged as `MikeDown: remote browser open failed` |

## 6. Remote regression spot-checks (`extensionKind` blast radius)

Still in the remote session, on a remote file:

| # | Step | Expected |
| --- | --- | --- |
| 6.1 | Paste an image from the clipboard | File is written into the configured folder **on the remote workspace**; it renders in the editor |
| 6.2 | Open the sidebar → **Backlinks** | Backlinks resolve against remote workspace files, not empty |
| 6.3 | Open the sidebar → **Outline** | Headings listed, clicking scrolls |
| 6.4 | Click a wikilink / relative markdown link | Opens the correct remote file |
| 6.5 | Open a file's git diff (Source Control → click the file) | Redirects to the source-text diff, not two broken custom editors |
| 6.6 | Spell check in the remote session | Squiggles appear — the bundled dictionaries load over the webview resource roots |

---

## 7. Sign-off

- [ ] Section 1 — spell check rendering
- [ ] Section 2 — corrections & dictionary
- [ ] Section 3 — settings modal
- [ ] Section 4 — local export (regression)
- [ ] Section 5 — remote export (the fix)
- [ ] Section 6 — remote regression spot-checks

Automated suites (run before or after — all three, since bare `vitest run` picks up
integration files and fails):

```bash
npm run test:unit
npm run test:edge
npm run test:integration
```

Log anything that fails against `kevin-feedback-aug-08.md` (milestone M3).
