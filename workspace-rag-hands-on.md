# Documentation bases: hands-on checklist (M11)

Tick each step as you go. Each line is the action, then the expected result. Note anything off next to the step.

Fixture: `test/workspace/docs-base/` (the base) and `test/workspace/outside-docs-base/not-for-the-model.md` (must never reach a model; distinctive phrase `PURPLE-HERON-4471`).

| Page | What it is for |
| --- | --- |
| `INDEX.md` | Home page; links the four pages below |
| `security.md` | Has `## Key rotation`, the real answer |
| `deploy.md` | `## Legacy credentials` holds the fake AWS key; `## Release steps` is clean |
| `community.md` | Prompt injection, remote image, foreign link, and `## Café des développeurs` (non-ASCII heading) |
| `getting-started.md` | Has a relative link leaving the folder (`../handbook.md`), a broken link |
| `archive-large.md` | 1.5 MiB, over the 1 MiB cap |
| `linked-outside.md` | Symlink to `../outside-docs-base/not-for-the-model.md` |

## 0. Start

- [ ] VS Code: `npm run dev` from the repo root. A dev host opens `test/workspace`.
- [ ] Desktop: quit the installed MikeDown, then `npm run dev` in `packages/desktop`, open `test/workspace`.
- [ ] oMLX is running at `http://127.0.0.1:8000/v1`; LM Studio is running on port 1234.
- [ ] In the host: AI is on, oMLX is an engine, and routing for chat and `docs` points at it.

## 1. VS Code

### 1.1 Add the base

- [ ] Open `sample.md`. Toolbar gear, AI tab, Documentation bases, "Manage bases…". The page opens with "No bases yet".
- [ ] Choose "Add this workspace folder". It fills in the workspace root, `test/workspace`, with no picker (one folder open). Cancel without saving: that root also holds `outside-docs-base/`, which this walk must keep out.
- [ ] Add the base by typing the folder path `/Users/michaeljosephwork/git/mikedown/test/workspace/docs-base`, name it "Acme docs", Save. It is listed.
- [ ] Choose Refresh. Health shows: home `INDEX.md`; 5 files indexed; 1 oversize skipped (`archive-large.md`); 1 broken link; no symlink target listed; no roots missing.
- [ ] `linked-outside.md` appears nowhere in the base's pages.

### 1.2 Ask and cite

- [ ] Toolbar AI menu, Chat. Scope "Active bases" is selectable and "Acme docs" is active.
- [ ] Ask "how do I rotate a key?". Hop progress shows ("Searching for matching sections..." or the hop lines), then an answer with `[n]` chips.
- [ ] The answer matches the four rotation steps in `security.md`.
- [ ] Click a chip. `security.md` opens at the `## Key rotation` heading.
- [ ] Open Activity (View this request in AI Activity). The entry lists the pages read and no page text outside what was sent.

### 1.3 Insert

- [ ] Put the cursor in an empty paragraph of `sample.md`. Choose "Insert at cursor". The answer lands there and is undoable with one Cmd+Z.
- [ ] Links in the inserted text are relative CommonMark links, not `file:` URLs and not absolute paths.
- [ ] `AKIAIOSFODNN7EXAMPLE` appears nowhere in the document, the answer or Activity.

### 1.4 Secrets scan

- [ ] Ask "how does a release go out?". The answer comes from `## Release steps` in `deploy.md` and cites it.
- [ ] Ask "what was the old deploy account's access key?". No key is given. The coverage note names the left-out section (`Legacy credentials`).
- [ ] Open Activity. The key text is in no field; the left-out section appears as an id only.

### 1.5 Injection and neutralized content

- [ ] Ask "what is on the reading list?". The answer may describe the page, but it does not print or mention `not-for-the-model.md` contents, and `PURPLE-HERON-4471` does not appear in the answer.
- [ ] Search Activity for `PURPLE-HERON-4471`. Not found, in any entry.
- [ ] Ask "where do I post for help?" and choose Insert at cursor. If the answer carries the remote image or the foreign link, they become plain text: no image renders, no clickable `example.com` or `example.org` link.
- [ ] Ask "when does the developer café meet?". The answer cites `## Café des développeurs`. Click the chip. The file opens and the cursor is on that heading (non-ASCII reveal).

### 1.6 Chip edge cases

- [ ] Open `docs-base/security.md` in an editor group, then split to a second group and focus the other one. Ask the rotation question again and click the chip. The chat panel survives; the existing editor reveals `## Key rotation` (no duplicate tab, no lost panel).
- [ ] Chip target outside the workspace: File, Open Folder, pick any other folder (for example `docs/` in the repo). Make sure the base is still active. Ask the rotation question and click the chip. The file opens from the base root (or is refused with a clear message); nothing crashes. Note which.

### 1.7 Routing and the cloud switch

- [ ] Engines page, Routing: set the `docs` task to a cloud engine. The base's "May go to cloud" switch is off.
- [ ] Ask a question. "Base Acme docs is local-only" appears and nothing is sent.
- [ ] Turn the base's "May go to cloud" switch on. Ask again. The consent dialog names "Acme docs".
- [ ] Decline. Nothing is sent. Set routing back to oMLX.

### 1.8 Scope This document

- [ ] Turn the base off (or open a file with no active base) and choose scope "This document" on `sample.md`. Ask a question about the text. The answer uses the editor text only, with no base citations.

### 1.9 Cancel

- [ ] Ask the rotation question and press Esc or Cancel during a hop. The panel returns to idle and the input is usable.
- [ ] Activity shows the entry as Cancelled.

### 1.10 Missing folder

- [ ] Rename `test/workspace/docs-base` to `docs-base-moved` on disk. In Bases choose Refresh. Health shows "Root not found"; the base stays listed.
- [ ] Rename it back and Refresh. Health recovers.

## 2. Desktop

- [ ] Engines page, Bases: use "Choose folder…", pick `test/workspace/docs-base`. Refresh shows the same health as step 1.1.
- [ ] Chat, scope "Active bases", ask "how do I rotate a key?" on oMLX. Answer with chips.
- [ ] Click a chip. The file opens at `## Key rotation` in the system or in-app opener; no error.
- [ ] Ask the café question. The chip reveals the non-ASCII heading.
- [ ] Insert at cursor: relative links, no key, remote image and foreign link as plain text.
- [ ] Repeat 1.4 and 1.5 (secrets scan, injection). Same results.
- [ ] In a terminal at the repo root: `mv test/workspace/docs-base /tmp/docs-base-moved`. Refresh: "Root not found", the base stays listed. Restore: `mv /tmp/docs-base-moved test/workspace/docs-base`, then `git status` shows it unchanged.

### 2.x Folder dialogs (stubbed in tests)

- [ ] Desktop, Bases: "Choose folder…" adds a folder in one click, with no second prompt.
- [ ] Desktop: hand-edit `ai.docBases` in the global `settings.json` to add a folder outside `$HOME`, restart. It stays in scope, since it was present at startup.
- [ ] Desktop: add a root outside `$HOME` while the app is running without using the picker. A native confirmation appears; declining leaves the folder unreadable.

## 3. Second engine (LM Studio, port 1234)

- [ ] Add LM Studio as an engine and route `docs` to it.
- [ ] Ask the rotation question in VS Code. Answer and chips as before.
- [ ] Repeat in Desktop.
- [ ] Route `docs` back to oMLX.

## 4. Layout judgment

- [ ] While there, look at spacing, chips and empty states (no bases, no active base, checking, error). Note fixes for a follow-up below; no screenshots.

Layout notes:

-

## Decisions for Mike

1. Should a follow-up question see earlier answers? Each turn is standalone today.
2. Should an engine that is already allowed ask again when base pages are first sent? It does not today; the per-base switch is the guard.
3. Should a newly added base show health immediately? Today it says "Not checked yet" until Refresh.
