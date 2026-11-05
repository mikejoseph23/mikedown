# MikeDown — Resume Prompt

## Project Overview

MikeDown is a WYSIWYG markdown editor (TipTap/ProseMirror) in an npm workspace. One editor core, `packages/core` (`@mikedown/core`), ships through:

- the VS Code extension (`src/`, thin shell `src/webview/editor-main.ts`);
- **MikeDown Desktop**, Tauri 2 at `packages/desktop/`;
- the npm family `@mikedown/core`, `web-component`, `react`, `vue`, `angular` (lockstep versions, independent of the extension's 2.x);
- the website `website/` (https://www.iadev.net/mikedown/).

See `CLAUDE.md` for critical constraints (never mutate `editor.view.dom` outside a PM transaction; the three-place Settings rule; the `tiptap-markdown` ES alias) and the release steps.

## Current Status

**All releases are out. `develop` has local commits not pushed yet (the Desktop hover fix and this RESUME); Mike decides when to push.**

- **Live:**
  - VS Code **2.17.1** (tags `v2.17.0`, `v2.17.1`), the first release with the AI features, Experimental and off by default;
  - Desktop **0.5.0** (tag `desktop-v0.5.0`);
  - npm family **0.3.0**;
  - site **`0.5.0-site.1`**.
- **Waiting for the next Desktop release:** the primary/danger button hover fix (`c5438eb`, Desktop only). Mike doesn't want a special update for it.
- **Not yet in Desktop or npm:** the issue #12 fixes (`8337754`) are only in the extension 2.17.1. They go out with the next Desktop and npm release.
- **Not merged to `main`.** The releases ran from `develop`, as before.

## Last Session Summary (2026-11-04)

1. **Desktop button hover fix** (`c5438eb`): the base `.mdapp-btn:hover` rule outranked the variants, so primary buttons (Save in the close dialog) hovered as white text on light grey. Primary and danger now have their own hover colors in `app.css` and `sidebar.css`, and the update window's one-off override is gone. Checked with computed styles in headless Chromium (light theme) and launched in the dev app; no Tauri hover check was reported back.
2. **AI transparency question, undecided:** users can't see the prompts or responses. The request log is metadata only, by design: VS Code's `MikeDown AI` output channel, and stderr on Desktop, which a Dock launch never shows. Proposed an **AI Activity** panel (see What's Next); Mike hasn't answered.

## Earlier Session Summary (2026-10-30)

1. **Desktop multi-window:**
   - New Window from the macOS Dock menu and the Windows taskbar jump list (`dock.rs`);
   - Open Containing Folder opens an outside file's folder in its own window (`open_folder_window`).
2. **Desktop 0.4.0** shipped the AI features (Experimental, off by default), then **0.5.0** shipped the table work.
3. **Table editing plan** (`table-editing-improvements-plan.md`, M1 to M4, orchestrator):
   - the Backspace cell-wipe fix;
   - Toggle header and Merge removed (they saved as HTML);
   - pipe/TSV paste, and copy as a markdown table;
   - row shortcuts (Mod+Enter, Mod+Shift+Enter, Mod+Alt+Backspace) and Move Row/Column;
   - a keyboard-usable size picker, "+" strips, and accessible grips;
   - the `mikedown.tables.padColumns` setting.
4. **Desktop site redesign** (`desktop-site-redesign-plan.md`) is all done:
   - the compare page and feature tour;
   - an AI section with three Desktop AI screenshots;
   - copy that says cloud AI means an API key billed by the provider, **not** a ChatGPT or Claude subscription (Copilot works through `vscode.lm` in VS Code only).
5. **Marketplace listing:**
   - the README has "New" lines above the fold (optional AI tools, and Desktop now available);
   - the README and the `website/vscode/` page have AI screenshots (`ai-rewrite`, `ai-local-setup-dark`, `ai-setup-wizard`), all marked Experimental.
6. **Blog:** `website/blog/` with a draft post, "Your own computer can run AI" (`website/blog/local-ai/`). It's deliberately **unlinked** (footer link removed) and `noindex`. It's still reachable by URL because the site-only pack includes `blog/`.
7. **Issue #12** (mzenker-PSS) is fixed in 2.17.1, replied to and closed:
   - Edit Link with only the caret in the link now applies (`extendMarkRange('link')`);
   - H6 is styled as a smaller H5, matching the PDF export.

**Decisions:** merged table cells were dropped, so tables stay GFM only. Enter in a table cell still inserts `<br>`. Plain-text paste recognizes pipe tables and TSV, not CSV.

**Gotcha:** Mike's npm 2FA is a **passkey**, so there is no OTP code. Mike runs `npm run release:npm -- --publish` in his own terminal and approves in the browser. Check with the registry directly (`curl https://registry.npmjs.org/@mikedown%2fcore`), because `npm view` lags.

## What's Next

1. **Decide on the AI Activity panel:** backlog it or build it. Off by default, shows the exact messages sent and the raw response per request, held in memory for the session only, with a manual "Save to file". One hook in `runAiCompletion` (core) covers both hosts. It would relax the engines plan's "never the prompt text" logging rule, so keep the logs themselves unchanged.
2. **AI roadmap, nothing scheduled.** Follow-ups are in `docs/ai-writing-features-plan.md` (Follow-ups) and `BACKLOG.md` (AI Recipes):
   - small: `/actions`, paste cleanup, table/Mermaid from prose, chunk-then-merge summaries, per-task benchmark, Recipes;
   - own plan: ghost text (recommended next; task and feature definitions exist, no UI), chat with this document (runner-up), alt text, then grammar review, workspace RAG, dictation.
3. **Mike, hands-on:**
   - In-app update to Desktop 0.5.0 from an older version, on a Mac and on Windows (Help > Check for Updates).
   - The Windows jump list ("New Window") on DEVBOX1.
   - The table checks from the table plan's Review Materials (`.orchestrator/table-editing-improvements-plan/processed/`): Backspace after a table now selects the table first. Decide whether that's acceptable.
4. **Blog:**
   - Review or split the local AI post, and check the claims listed in `BACKLOG.md`.
   - Then add the footer link back (`website/shared/partials.js` `renderFooter`, then `npm run sync:shell -w website`) and drop `noindex`.
5. **Blog post "Why Markdown? Why MikeDown?"** (`BACKLOG.md`): start with an interview of Mike, one question at a time.
6. **Next Desktop and npm patch:** pick up the #12 fixes and the hover fix (Desktop 0.5.1, npm 0.3.1) whenever there's more to ship.
7. **Older items** (previous RESUME):
   - the T4 Desktop half of `ai-setup-privacy-polish-plan.md`;
   - Q8;
   - npm "disallow tokens" 2FA per package;
   - re-encrypt the updater key;
   - the frontmatter YAML undo gap;
   - prune `.claude/worktrees/`.
8. **Optional cleanup:** `desktop-site-redesign-plan.md` and `table-editing-improvements-plan.md` are complete. Run `/iadev:repo-markdown-cleanup` to file them into `docs/` once Mike has finished the hand checks.

## Planning Docs

- `table-editing-improvements-plan.md`: done (M1 to M4); only hand checks remain.
- `desktop-site-redesign-plan.md`: done (M1 to M6, published as `0.5.0-site.1`).
- `ai-setup-privacy-polish-plan.md`: done except the T4 Desktop walk and Q8.
- `ai-inference-engines-plan.md`: done; M7 release prep happened with npm 0.3.0 and extension 2.17.0.
- `angular-core-extraction-plan.md`: M10 open; the M8 Quantico Creek hands-on is pending.
- `docs/README.md`: an index of the finished plans and decisions.

## Servers

- **VS Code dev host:** `npm run dev` (opens `test/workspace`; `sample.md` has a table).
- **Desktop dev:** `npm run dev` in `packages/desktop`. Quit the installed MikeDown first, or the single-instance plugin hands off to it.
- **Site:** `npm run dev:site` (port 5180, base `/mikedown/`).
- **AI engines:**
  - oMLX `http://127.0.0.1:8000/v1` (never print the key);
  - LM Studio on `:1234`.
- **Production:** LymeDeploy project `mikedown-downloads`.
  - Desktop: `packages/desktop/deploy/release.sh <bump> --notes-file release-notes/<v>.md`, then `pack-for-lymedeploy.sh --version <v>`.
  - Site only: `pack-for-lymedeploy.sh --site --site-n N` (the next one is `0.5.0-site.2`).
  - Browsers cache the pages; hard-reload to check.

## Key File Paths

- `packages/core/src/`
  - `table-commands.ts`, `table-clipboard.ts`, `table-align.ts`, `tabledrag.ts`, `tablepicker.ts`: tables.
  - `editor.ts`: the link dialog's `confirm()` (the #12 fix).
  - `styles/editor.css`: heading styles.
  - `ai-request.ts`: `runAiCompletion`, where every AI request passes (the AI Activity hook point).
- `packages/desktop/src/styles/app.css`, `sidebar.css`: `.mdapp-btn` and its variants.
- `src/ai/engineService.ts` (`logRequest`) and `packages/desktop/src-tauri/src/commands/ai/request_log.rs`: the metadata-only request log.
- `packages/desktop/src-tauri/src/dock.rs` and `commands/multiwindow.rs`: Dock menu, jump list, windows.
- `packages/desktop/deploy/`: `release.sh`, `pack-for-lymedeploy.sh`, `release-notes/`.
- `website/`
  - `mikedown-desktop/index.html`: the AI section and shots;
  - `vscode/`, `compare/`, `blog/` (unlinked draft);
  - `shared/partials.js`: header and footer.
- `.claude/skills/listing-screenshots/`: VS Code listing screenshots (now including the AI shots).

## Recent Git Log (`develop`)

- `c5438eb` Keep primary and danger button colors on hover in Desktop
- `af0674e` Update RESUME and mark the site plan's publish milestone done
- `0db994e` Release 2.17.1
- `8337754` Fix Edit Link with only the caret in a link, and style H6 like a smaller H5 (#12)
- `f3d9664` Release 2.17.0
- `5c68ec4` Add AI screenshots and a New line for AI and Desktop to the README and VS Code page
- `d1e3730` MikeDown Desktop 0.5.0
- `c5171a5` Keep the draft blog out of search results and add the Desktop 0.5.0 release notes

## Any Other Notes

- **Commits:** no AI attribution. A PreToolUse hook blocks commands containing the attribution strings, even in a grep.
- **Workers:** Mike prefers Agent-tool subagents over clipboard prompts. Tell subagents not to spawn agents of their own, because a Fable worker stalled that way. UI-driving agents (screenshots) take over the screen, so warn Mike first.
- **Issue replies:** mzenker-PSS has already been asked for a review (see memory).
- **Type checks:** the webview build is transpile-only, so check with `npx tsc -p tsconfig.webview.json --noEmit`.
- Never run machine-wide `pkill`; kill by PID.
