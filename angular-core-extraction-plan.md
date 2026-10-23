# MikeDown Core Extraction and Angular Wrapper — Planning Document

## Summary

MikeDown's webview editor (TipTap + CodeMirror, `src/webview/`, ~17k LOC) has no `vscode` API dependency; its only host coupling is `postMessage`. This plan extracts it into a framework-agnostic npm package, **`@mikedown/core`**, that the VS Code extension and any web app share, then adds an Angular `ControlValueAccessor` wrapper to the LymeStack Angular shared folder and drops it into the Quantico Creek legacy app.

**Objectives**

1. One editor codebase. The VS Code webview becomes a thin host shell over `@mikedown/core`; every future extension (math, mermaid, callouts, slash commands) lands in both products.
2. A published package with a stable public API: `createMikeDownEditor(container, options)` plus a `MikeDownHost` adapter interface replacing every `vscode.postMessage` call.
3. An Angular wrapper `<lyme-markdown-editor>` in `~/git/lymestarter/ng-app/src/app/lymestack-shared/mikedown/` (a `lymetools sync` core folder, so every scaffolded app gets it).
4. Working in `~/git/quanticocreek/quantico-creek-angular-app` (Angular 14, TS 4.7, not a LymeStarter scaffold, so the wrapper is copied by hand).

**Critical success factors**

- The VS Code extension ships identically after the split: all unit, edge and integration tests green, `.vsix` builds, no behavior change.
- TipTap 3 and the core bundle compile under the legacy app's TS 4.7 / Angular 14 toolchain (spiked in M0 before anything else moves).
- The core has no VS Code CSS variables, no `acquireVsCodeApi`, no sidebar/backlinks/support-card code paths unless a host opts in.
- The wrapper is a plain reactive-forms control: `formControlName="notes"` just works.

**Defaults applied (override any of these):** incremental testing after each wave; Playwright off; no screenshots (visual judgment folded into hands-on passes); package name `@mikedown/core` published publicly to npm under the existing MIT license (M0 confirms the scope is available, fallback `mikedown-core`); primary target is the **legacy** Quantico Creek app with the Angular 19 assistant app as an optional follow-up; image upload in Quantico Creek is a separate optional milestone (M8) so the editor lands without a new API endpoint first.

### Milestone Progress Tracker

| Milestone | Model | Status | Duration (min) | Notes |
|---|---|---|---|---|
| [M0 — Decisions and compatibility spike](#m0--decisions-and-compatibility-spike) | Opus | ✅ Complete (approved) | 10 | Gate: user approves `core-extraction-decisions.md` |
| [M1 — Workspace restructure](#m1--workspace-restructure) | Sonnet | ✅ Complete | 7 | npm workspaces, `packages/core` |
| [M2 — Host adapter and factory](#m2--host-adapter-and-factory) | Opus | ✅ Complete | 31 | Replaces ~50 `postMessage` sites |
| [T1 — VS Code parity tests](#t1--vs-code-parity-tests) | Sonnet | ✅ Complete (signed off) | 11 | unit + integration + hands-on; gap-fill added 9 integration tests |
| [M3 — Theme tokens and CSS packaging](#m3--theme-tokens-and-css-packaging) | Opus | ✅ Complete | 31 | 81 `--vscode-*` vars → 54 `--mikedown-*` tokens |
| [M4 — Core package build, demo and publish](#m4--core-package-build-demo-and-publish) | Sonnet | ✅ Complete (publish pending npm login) | 6 | ESM + d.ts + css, `0.1.0-rc.1` |
| [T2 — Core package tests](#t2--core-package-tests) | Sonnet | ✅ Complete (signed off; orchestrator ran hands-on in Chrome) | 5 | demo page hands-on, bundle checks; 3 gap-fills |
| [M5 — Angular wrapper in LymeStarter](#m5--angular-wrapper-in-lymestarter) | Opus | ✅ Complete | 12 | `lymestack-shared/mikedown/`; demo `/dev/markdown-editor` |
| [T3 — Wrapper tests](#t3--wrapper-tests) | Sonnet | ✅ Complete (signed off) | 8 | TestBed CVA specs + hands-on |
| [M6 — Quantico Creek legacy app integration](#m6--quantico-creek-legacy-app-integration) | Opus | ✅ Complete | 16 | KB article editor; Material token mapping |
| [T4 — Quantico Creek hands-on](#t4--quantico-creek-hands-on) | Sonnet | ✅ Signed off | — | hands-on |
| [M7 — Release wiring and docs](#m7--release-wiring-and-docs) | Sonnet | ✅ Done except version bumps (blocked on publish) | — | vsix + core publish in one step |
| [M8 — Image upload for Quantico Creek (optional)](#m8--image-upload-for-quantico-creek-optional) | Sonnet | ✅ Code done, hands-on pending | — | API endpoint + `uploadImage` host hook |
| [M9 — Assistant app integration (optional)](#m9--assistant-app-integration-optional) | Sonnet | ✅ Complete | 3 | Angular 19; lead-panel notes editor |
| [M10 — Bot protection for AI endpoints](#m10--bot-protection-for-ai-endpoints) | Opus | ⬜ Not Started | — | Rate limiting + CAPTCHA in the Quantico Creek API; independent of the core work |
| [M11 — Opt-in wrapper (lymetools `optionalFolders`)](#m11--opt-in-wrapper-lymetools-optionalfolders) | Opus | ✅ Complete | — | `lymestack-optional/mikedown`; `lymetools adopt <path>`; scaffold strips it |

**Model Assignment Guidelines:** Haiku for mechanical/boilerplate; Sonnet for well-defined feature work; Opus for architecture, ambiguous decisions, and all front-end UI design work.

[Return to Top](#mikedown-core-extraction-and-angular-wrapper--planning-document)

---

## Table of Contents

- [Summary](#summary)
- [Current state (verified 2026-10-22)](#current-state-verified-2026-10-22)
- [Target architecture](#target-architecture)
- [Worker rules](#worker-rules)
- [M0 — Decisions and compatibility spike](#m0--decisions-and-compatibility-spike)
- [M1 — Workspace restructure](#m1--workspace-restructure)
- [M2 — Host adapter and factory](#m2--host-adapter-and-factory)
- [T1 — VS Code parity tests](#t1--vs-code-parity-tests)
- [M3 — Theme tokens and CSS packaging](#m3--theme-tokens-and-css-packaging)
- [M4 — Core package build, demo and publish](#m4--core-package-build-demo-and-publish)
- [T2 — Core package tests](#t2--core-package-tests)
- [M5 — Angular wrapper in LymeStarter](#m5--angular-wrapper-in-lymestarter)
- [T3 — Wrapper tests](#t3--wrapper-tests)
- [M6 — Quantico Creek legacy app integration](#m6--quantico-creek-legacy-app-integration)
- [T4 — Quantico Creek hands-on](#t4--quantico-creek-hands-on)
- [M7 — Release wiring and docs](#m7--release-wiring-and-docs)
- [M8 — Image upload for Quantico Creek (optional)](#m8--image-upload-for-quantico-creek-optional)
- [M9 — Assistant app integration (optional)](#m9--assistant-app-integration-optional)
- [M10 — Bot protection for AI endpoints](#m10--bot-protection-for-ai-endpoints)
- [M11 — Opt-in wrapper (lymetools `optionalFolders`)](#m11--opt-in-wrapper-lymetools-optionalfolders)
- [Parallel Development Recommendations](#parallel-development-recommendations)
- [Gap-Filling Prompts](#gap-filling-prompts)
- [Progress Log / Notes](#progress-log--notes)

---

## Current state (verified 2026-10-22)

- **Two webpack bundles.** Extension host (`src/extension.ts` → `dist/extension.js`, target node) and webview (`src/webview/editor-main.ts` → `out/webview/editor-main.js`, target web, `tsconfig.webview.json`). The webview has zero `vscode` Node imports.
- **Host coupling is all `postMessage`.** `editor-main.ts` (5,712 lines) calls `acquireVsCodeApi()` once (line 216) and `vscode.postMessage` at about 50 sites; `imagepaste.ts`, `imagepick.ts`, `slashcommands.ts` receive the function via `setPostMessage` setters. Inbound messages are handled in one `window.addEventListener('message')` switch. Message shapes are documented in the file header.
- **DOM shell** comes from `markdownEditorProvider.ts#getHtmlForWebview` (~line 2160): `#toolbar`, `#editor-container`, `#source-container`, 20 CSS files plus `katex.min.css`. The webview code uses `getElementById` for those three and for overlays it creates itself.
- **Theme.** The CSS uses 81 distinct `--vscode-*` custom properties (count from `src/webview/*.css`). Fonts, width and similar already go through `--mikedown-*` properties set from the settings broadcast.
- **VS Code only features** that must become opt-in: outline sidebar (`outlineSidebar.ts`, 1,460 lines: Properties / Outline / Backlinks / Tags / footer), wikilink and tag autocomplete (host-resolved), heading-rename backlink fixing, support card (`supportCard.ts`), "View in Browser" / print / export, diff request, keybindings link, source-mode toggle round-trip through the host.
- **Dependencies:** `@tiptap/core` ^3.20, `tiptap-markdown` ^0.9 (webpack alias forces the ES build — the UMD build breaks under strict mode), CodeMirror 6, `mermaid` ^11 (dynamic imports forced eager for the CSP), `katex`, `lowlight`, `nspell` (spellcheck dictionaries under `dictionaries/`).
- **Tests:** vitest unit suite in `test/unit/` (50 files, jsdom), `test/edge-cases`, `test/performance`, VS Code integration under `test/integration/`.
- **LymeStarter Angular side** is vendored, not packaged: `ng-app/src/app/lymestack-shared` is a `lymetools sync` core folder (`lymestack-ownership.json`, owner `copy`). Angular 19.2, TS 5.5. There is no Angular library project and no npm feed; the .NET side uses a folder NuGet feed on the Storage share.
- **Quantico Creek:** `quantico-creek-angular-app` is Angular 14.2 / TS 4.7 / Angular Material with `ngx-markdown` 14 and `marked` 4 already present (read-only markdown rendering exists somewhere; the worker in M6 locates it). `quantico-creek-assistant-app` is Angular 19.2 / TS 5.7 with `marked` 15. Neither has `lymetools.json`; neither is a LymeStarter scaffold.

[Return to Top](#mikedown-core-extraction-and-angular-wrapper--planning-document)

---

## Target architecture

```
mikedown/                          npm workspace root (VS Code extension stays here)
├── package.json                   "workspaces": ["packages/*"]
├── packages/
│   └── core/                      @mikedown/core
│       ├── package.json           ESM + types + css exports, no vscode dep
│       ├── src/                   ← moved from src/webview (git mv, history kept)
│       │   ├── index.ts           createMikeDownEditor, MikeDownHost, types
│       │   ├── host.ts            MikeDownHost interface + NoopHost
│       │   ├── editor.ts          the factory (carved out of editor-main.ts)
│       │   ├── extensions/…       callout, highlight, math, mermaid, …
│       │   ├── ui/…               toolbar, contextmenu, settings modal, sidebar (opt-in)
│       │   └── styles/            editor.css … + tokens.css (--mikedown-* defaults)
│       ├── demo/index.html        plain-HTML smoke page (vite or a static server)
│       └── test/                  the jsdom unit tests that only touch core
├── src/
│   ├── extension.ts, markdownEditorProvider.ts, …   (unchanged host side)
│   └── webview/editor-main.ts     ~200 lines: VsCodeHost (postMessage) + createMikeDownEditor()
└── test/integration/              VS Code tests (unchanged)
```

**Core public API (M2 fixes the exact shape; this is the intent):**

```ts
export interface MikeDownHost {
  // document
  onChange(markdown: string, meta: { pristine: boolean }): void;
  onStats?(stats: { words: number; chars: number } | null): void;
  // navigation
  openLink?(href: string, behavior?: 'default' | 'openNewTab'): void;
  // settings
  loadSettings?(): Partial<MikeDownSettings> | Promise<Partial<MikeDownSettings>>;
  saveSettings?(patch: Partial<MikeDownSettings>, opts?: { silent?: boolean }): void;
  // images (absent = image paste/pick disabled)
  uploadImage?(file: { mime: string; bytes: Uint8Array; name?: string }): Promise<{ src: string; alt?: string }>;
  // optional knowledge-base features (absent = feature off)
  resolveWikilinks?(targets: string[]): Promise<Record<string, WikilinkResolution>>;
  getLinkSuggestions?(): Promise<LinkSuggestion[]>;
  getTags?(): Promise<Array<{ tag: string; count: number }>>;
  // host-specific actions surfaced in toolbar/menus (absent = hidden)
  exportHtml?(html: string): void;
  printDocument?(html: string): void;
  viewInBrowser?(html: string): void;
}

export interface MikeDownOptions {
  host: MikeDownHost;
  initialMarkdown?: string;
  settings?: Partial<MikeDownSettings>;      // overrides loadSettings()
  features?: Partial<MikeDownFeatures>;      // toolbar, sidebar, sourceMode, slashCommands, spellcheck, math, mermaid, …
  theme?: 'light' | 'dark' | 'auto';
  readOnly?: boolean;
}

export interface MikeDownEditorHandle {
  setMarkdown(markdown: string, opts?: { pristine?: boolean }): void;
  getMarkdown(): string;
  focus(): void;
  setReadOnly(readOnly: boolean): void;
  setTheme(theme: 'light' | 'dark'): void;
  command(name: MikeDownCommand, args?: unknown): void;   // same names the VS Code commands forward today
  on(event: 'change' | 'focus' | 'blur' | 'ready', fn: (...a: any[]) => void): () => void;
  destroy(): void;
}

export function createMikeDownEditor(container: HTMLElement, options: MikeDownOptions): MikeDownEditorHandle;
```

**Angular wrapper** (`lymestack-shared/mikedown/`): `MikeDownEditorComponent` implementing `ControlValueAccessor`, inputs `theme`, `features`, `readOnly`, `placeholder`, `imageUpload: (file) => Observable<{src, alt?}>`, output `ready`. Debounces `onChange` into `onChange(value)` of the CVA; `writeValue` calls `setMarkdown` with `pristine: true` so external loads never dirty the form.

**VS Code shell**: `src/webview/editor-main.ts` becomes `VsCodeHost implements MikeDownHost` (each method is one `postMessage`), the inbound message switch maps `update`/`command`/`settings`/… to handle calls, and `--vscode-*` → `--mikedown-*` mapping lives in a VS Code-only `vscode-theme.css`.

[Return to Top](#mikedown-core-extraction-and-angular-wrapper--planning-document)

---

## Worker rules

Apply to every milestone below.

- Read `CLAUDE.md` in whichever repo you are working in before starting (`~/git/mikedown`, `~/git/lymestarter`, `~/git/quanticocreek`).
- Complete **every** checkbox in your milestone. Do not skip items as low priority or slightly out of scope. If you believe an item should be dropped or deferred, say so in your summary for the orchestrator to decide, but attempt it unless it is truly blocked.
- **Never mutate `editor.view.dom` outside a ProseMirror transaction** (see the MikeDown `CLAUDE.md`, commit `f5415e0`).
- Keep the `tiptap-markdown` ES-module alias (or its equivalent in the core build) and the `mainFields: ['module', 'browser', 'main']` ordering.
- The VS Code extension must keep working at every commit: `npm run compile`, `npm run test:unit`, `npm run test:edge` green before each commit in M1–M4.
- Commits: no feature branches (work on `main` in MikeDown; LymeStarter and Quantico Creek follow their own `CLAUDE.md` branch rules), no AI attribution, one commit per logical step. Do not push.
- When done: commit, write `.orchestrator/worker-summary-<milestone-slug>.md` (what changed, what was skipped and why, files touched, follow-ups), update the tracker row and Progress Log in this document, then prompt the user to clear the context.
- In the LymeStarter repo, do not edit anything under a `lymetools sync` core folder other than the new `lymestack-shared/mikedown/` folder, and never edit inside LymeStack template core from a downstream app.

[Return to Top](#mikedown-core-extraction-and-angular-wrapper--planning-document)

---

## M0 — Decisions and compatibility spike

**Recommended model:** Opus. Ambiguous decisions plus a toolchain compatibility investigation.

**Goal:** settle the decisions that would otherwise be re-litigated mid-extraction, and prove the two risky assumptions before anything moves. Output is `core-extraction-decisions.md` at the MikeDown repo root; the user reviews and approves it before M1 starts.

**Tasks**

- [x] **Package name and registry.** Run `npm view @mikedown/core` and `npm org ls mikedown` (or check npmjs.com) to see whether the `@mikedown` scope is free; if not, use `mikedown-core`. Record the decision and the publishing account (`npm whoami` currently returns `ENEEDAUTH`; note that the user has to `npm login` once before M4). Also record the fallback if the user prefers not to publish publicly: `npm pack` tarballs in `/Volumes/Storage/LymeStack/packages/npm/` consumed as `file:` dependencies (mirrors the .NET folder feed in `~/git/lymestarter/framework-package-design.md`).
- [x] **Angular 14 / TS 4.7 spike.** In the scratchpad, `npx @angular/cli@14 new spike --minimal --skip-git`, add `@tiptap/core@^3.20`, `@tiptap/starter-kit`, `tiptap-markdown@^0.9`, `@codemirror/state`, `@codemirror/view`, `katex`, `lowlight`, `mermaid@^11`, import each in a component, and run `ng build`. Record every error. Expected trouble spots: TipTap 3 `.d.ts` files using TS ≥ 5 syntax (mitigation: `skipLibCheck: true`, already common in Angular apps), `mermaid` dynamic `import()` chunking (fine under esbuild, no CSP in a normal app), `nspell` and dictionary loading (core should make spellcheck opt-in with a host-supplied dictionary URL). Conclude with one of: **compatible as-is**, **compatible with `skipLibCheck`**, or **requires a `mikedown-core` build that pre-bundles TipTap** (then M4 ships a self-contained bundle with its own `.d.ts`, which is the recommended shape anyway).
- [x] **Angular 19 build spike.** Same imports in `~/git/lymestarter/ng-app` on a throwaway branch of the scratch copy (do not commit): confirm `ng build` succeeds and note the bundle size delta.
- [x] **Core build tool.** Recommend one: `tsup` (esbuild, trivial ESM + d.ts), `vite build` in library mode, or a second webpack config. Recommendation to evaluate: tsup with `mermaid`, `katex`, `@codemirror/*`, `@tiptap/*` marked **external** (peer deps) so the consuming app dedupes them, plus `tiptap-markdown` **bundled** (its UMD entry is broken and consumers should not have to alias it). Record the decision and the `exports` map (`.`, `./styles.css`, `./tokens.css`).
- [x] **Feature split.** Produce the table of every host-facing message type from the `editor-main.ts` header (both directions) with its disposition: **core API**, **host adapter method**, **VS Code shell only**, or **dropped**. This table is the spec M2 implements.
- [x] **Settings ownership.** Decide which `mikedown.*` settings the core owns (fonts, width, slash commands, spellcheck, math, mermaid, theme) versus VS Code only (image paste folder pattern, support prompt, heading-rename backlink fix, sidebar defaults). The core `MikeDownSettings` type is the owned subset; the Settings modal shows only sections whose settings the host supports.
- [x] **Quantico Creek target screen.** Grep `quantico-creek-angular-app/src/app` for `ngx-markdown`, `markdown`, `notes`, and large `textarea` fields; list the candidate screens with route and component path; recommend the first one (one editable notes field is enough for M6).
- [x] Write `core-extraction-decisions.md` with all of the above and a short "what would change in this plan" note for each decision. **Gate:** stop and ask the user to review the file. Do not start M1 until approved.

**Review locator:** `~/git/mikedown/core-extraction-decisions.md`.

[Return to Top](#mikedown-core-extraction-and-angular-wrapper--planning-document)

---

## M1 — Workspace restructure

**Recommended model:** Sonnet. Mechanical but must keep three build pipelines working.

**Goal:** `packages/core` exists, holds the former `src/webview` sources with git history, and the VS Code extension builds and tests exactly as before.

**Tasks**

- [x] Add `"workspaces": ["packages/*"]` to the root `package.json`; create `packages/core/package.json` (name from M0, `"private": true` until M4, `"type": "module"`, `main`/`module`/`types`/`exports` placeholders, `peerDependencies` per M0, `license: MIT`).
- [x] `git mv src/webview packages/core/src` (keep every file name; `editor.js` and the `.d.ts` shims go too). Move `src/imageDisplayPath.ts`, `src/tagExtract.ts`, `src/wordCount.ts` and any other `src/*.ts` the webview bundle imports into `packages/core/src/shared/`, and re-import them from the extension host via the package path (they are the only host-side files the webview bundle used).
- [x] Re-create `src/webview/editor-main.ts` as a thin file that `import`s the moved entry (`packages/core/src/editor-main.ts` for now; M2 replaces this with the factory). Update `webpack.config.js` webview `entry`, `tsconfig.webview.json` `include`/`rootDir`, and the CSS path list in `markdownEditorProvider.ts#getHtmlForWebview` to `packages/core/src/styles/` (move the `.css` files into `styles/` in the same commit).
- [x] Move dependencies used only by the webview bundle (`@tiptap/*`, `tiptap-markdown`, `@codemirror/*`, `mermaid`, `katex`, `lowlight`, `nspell`, `markdown-it-footnote`, …) from the root `package.json` into `packages/core/package.json`; keep `katex` CSS and `dictionaries/` resolvable from the extension (`node_modules` hoisting handles the CSS path; verify the `katex.min.css` path in the provider still resolves, otherwise reference `require.resolve`).
- [x] Update `vitest.config.ts` so `npm run test:unit` and `npm run test:edge` still find every test; move tests that import only core modules into `packages/core/test/` and leave host-side tests in `test/unit/`. Fix import paths.
- [x] Update `.vscodeignore` / `vsce` packaging so `packages/core/src` and `packages/core/node_modules` are not shipped in the `.vsix` (only `out/webview/editor-main.js`, the CSS, `dictionaries/`, `katex.min.css`). Build with `npm run vsix` and check the `.vsix` size is within 10% of `mikedown-editor-2.14.2.vsix`.
- [x] Update `CLAUDE.md` (architecture table, file paths) and `README.md` developer section for the new layout.
- [x] `npm run compile`, `npm run lint`, `npm run test:unit`, `npm run test:edge` green. Commit.

[Return to Top](#mikedown-core-extraction-and-angular-wrapper--planning-document)

---

## M2 — Host adapter and factory

**Recommended model:** Opus. This is the architectural core of the project and touches a 5,700-line file.

**Goal:** `createMikeDownEditor(container, options)` and `MikeDownHost` exist; no file under `packages/core/src` references `acquireVsCodeApi`, `vscode`, or `postMessage`; the VS Code shell implements the host and behaves identically.

**Tasks**

- [x] Create `packages/core/src/host.ts` with the `MikeDownHost` interface from the M0 message table and a `NoopHost` (every optional method absent; `onChange` is a no-op).
- [x] Create `packages/core/src/editor.ts` exporting `createMikeDownEditor`. Carve the body of `editor-main.ts` into it: build the DOM shell the editor needs **inside `container`** (toolbar, editor container, source container, overlays) instead of relying on ids from the host page; keep ids as `data-mikedown-*` attributes or scoped class names so two editors can coexist on one page. Replace every `getElementById` with lookups scoped to the container.
- [x] Replace each `vscode.postMessage({ type: X, … })` call (about 50 sites in `editor-main.ts`, plus the `setPostMessage` setters in `imagepaste.ts`, `imagepick.ts`, `slashcommands.ts`) with the corresponding `host.<method>()` from the M0 table. Where the host method is optional, the feature is hidden or disabled when it is absent (toolbar buttons for print/export/browser, `/image` slash command, wikilink and tag autocomplete, sidebar Backlinks/Tags sections, keybindings link in Settings).
- [x] Replace the inbound `window.addEventListener('message')` switch with handle methods (`setMarkdown`, `command`, `applySettings`, `setTags`, `setBacklinks`, `setProperties`, `resolveImageResult` …). Request/response pairs (`savePastedImage`/`pastedImageResult`, `pickImage`/`pickedImageResult`, `resolveWikilinks`, `getLinkSuggestions`, `checkLinks`, `requestDiff`) become Promise-returning host methods; keep the `requestId` plumbing only inside the VS Code shell.
- [x] Make the features gated: `features.sidebar` (default off outside VS Code), `features.toolbar`, `features.sourceMode`, `features.slashCommands`, `features.spellcheck` (requires `settings.spellcheckDictionaryUrl` or a host-provided loader), `features.math`, `features.mermaid`, `features.supportCard` (VS Code only, default off), `features.findReplace`, `features.frontmatter`.
- [x] Implement `handle.setMarkdown(md, { pristine })`, `getMarkdown()`, `setReadOnly`, `setTheme`, `focus`, `on`, `destroy` (destroy must remove every global listener the current code attaches to `window`/`document`: keyboard hotkeys, wheel zoom, resize, paste handlers). Grep for `window.addEventListener` and `document.addEventListener` and route each through a disposables list.
- [x] Re-write `src/webview/editor-main.ts` as the VS Code shell: `acquireVsCodeApi()`, `class VsCodeHost implements MikeDownHost` where each method posts the existing message shape, the inbound message listener calling the handle, and `createMikeDownEditor(document.getElementById('editor-root'), { host, features: { sidebar: true, supportCard: true, … } })`. Update `getHtmlForWebview` to render a single `#editor-root`. **No change to any message shape**, so `markdownEditorProvider.ts` is untouched except the HTML shell.
- [x] Move the message protocol documentation from the old file header into `src/webview/editor-main.ts` (it is VS Code specific) and write a short API doc comment at the top of `packages/core/src/index.ts`.
- [x] `npm run compile`, `npm run lint`, `npm run test:unit`, `npm run test:edge` green; update any unit test that reached into the old globals. Commit after each of: host interface + factory skeleton, outbound replacement, inbound replacement, shell rewrite.

[Return to Top](#mikedown-core-extraction-and-angular-wrapper--planning-document)

---

## T1 — VS Code parity tests

**Recommended model:** Sonnet.

**Modes:** unit/integration (vitest + `@vscode/test-electron`) and a short hands-on pass in the dev host. No screenshots.

**Automated**

- [x] Add `packages/core/test/factory.test.ts` (jsdom): `createMikeDownEditor` with `NoopHost` mounts into a bare `<div>`, `setMarkdown` then `getMarkdown` round-trips the `test/fixtures` documents used by `roundtrip.test.ts`, `onChange` fires once per user edit with `pristine: false`, `destroy()` leaves no listeners on `window` (spy on `addEventListener`/`removeEventListener` and assert the counts match) and removes all child nodes.
- [x] Add `packages/core/test/host-gating.test.ts`: with `uploadImage` absent, pasting an image is a no-op and `/image` is missing from the slash menu; with `printDocument` absent the print toolbar button is not rendered; two editors on one page keep independent state and toolbar active states.
- [x] Add `test/unit/vscodeHost.test.ts`: every `VsCodeHost` method posts exactly the message shape documented in the shell header (snapshot the payloads).
- [x] `npm run test:unit`, `npm run test:edge`, `npm run test:integration` all green. Record counts in the Progress Log.

**Hands-on (user, about 10 minutes)**

Start: `cd ~/git/mikedown && npm run dev` (opens a dev VS Code on `test/workspace`). Open any `.md` with MikeDown and walk through:

- [x] Type, bold (`Cmd+B`), insert a table from the toolbar picker, paste an image from the clipboard (file appears next to the doc), `Cmd+/` to source mode and back, `/date` slash command, open Settings from the gear and change the body font (persists after reload), toggle the sidebar and click an Outline entry, print via toolbar (print dialog opens), close and reopen the tab (content intact, not dirty). Expected: each behaves as in 2.14.2. Orchestrator pauses here for sign-off.

[Return to Top](#mikedown-core-extraction-and-angular-wrapper--planning-document)

---

## M3 — Theme tokens and CSS packaging

**Recommended model:** Opus. This is front-end design work: the editor has to look intentional inside a Material app, not like a transplanted VS Code panel.

**Goal:** the core CSS references only `--mikedown-*` tokens with sensible light and dark defaults; the VS Code shell maps `--vscode-*` onto them; the package ships one `styles.css` plus `tokens.css`.

**Tasks**

- [x] Inventory the 81 `--vscode-*` properties used across `packages/core/src/styles/*.css` (`grep -oh -- '--vscode-[a-zA-Z-]*' | sort -u`) and group them into a token set of roughly 25–35 `--mikedown-*` names (surface, surface-raised, text, text-muted, border, accent, accent-text, selection, code-bg, link, danger, scrollbar, focus-ring, shadow, radius, font-ui, font-mono …). Write the mapping table into `packages/core/src/styles/tokens.md`.
- [x] Create `packages/core/src/styles/tokens.css`: `:root` light defaults and `[data-mikedown-theme="dark"]` dark defaults, plus `@media (prefers-color-scheme: dark)` when `theme: 'auto'`. Pick values that read well next to Angular Material's default indigo/pink and a neutral gray page: generous line height, 1px hairline borders, soft focus ring, no hard black. Reference the look of Apple Notes and Notion over VS Code.
- [x] Rewrite every `var(--vscode-…)` in the core CSS to `var(--mikedown-…)`. Concatenate the 20 CSS files into `styles.css` at build time (order matters: editor, tables, images, codeblocks, mermaid, math, footnotes, links, findreplace, contextmenu, tablepicker, tabledrag, tasklist, linkautocomplete, toolbar-dropdown, outline-sidebar, emojipicker, slashcommands, spellcheck, settings-modal). Scope every selector under `.mikedown-root` so the styles cannot leak into a host app's page.
- [x] Create `src/webview/vscode-theme.css` (VS Code shell only) that sets each `--mikedown-*` token from the matching `--vscode-*` variable, and load it after `styles.css` in `getHtmlForWebview`. Verify the three VS Code themes used in `manual-test-script.md` look unchanged.
- [x] `katex.min.css`: import it from `styles.css` via the package (`@import 'katex/dist/katex.min.css'`) so consumers get it automatically; keep the VS Code shell loading its own copy (CSP).
- [x] Settings modal and toolbar: audit spacing, icon sizes and hover states at 14px and 16px base font sizes outside VS Code (the demo page in M4 is the test bed; stub it early with a plain `index.html` if needed). Fix anything that depended on VS Code's compact density.
- [x] `npm run compile`, tests green. Commit.

[Return to Top](#mikedown-core-extraction-and-angular-wrapper--planning-document)

---

## M4 — Core package build, demo and publish

**Recommended model:** Sonnet.

**Goal:** `npm run build -w packages/core` produces `dist/index.js` (ESM), `dist/index.d.ts`, `dist/styles.css`, `dist/tokens.css`; a plain HTML demo runs against the built package; `0.1.0-rc.1` is published (or packed to the share, per M0).

**Tasks**

- [x] Add the build tool chosen in M0 (default: `tsup`) to `packages/core` with `entry: src/index.ts`, `format: ['esm']`, `dts: true`, `sourcemap: true`, externals per M0, `tiptap-markdown` bundled from its ES entry via an alias/`noExternal`. Add a CSS step (`postcss-import` or a 10-line Node script) that concatenates and scopes the stylesheets into `dist/styles.css`.
- [x] `package.json` `exports`: `"."` → `dist/index.js` + types, `"./styles.css"`, `"./tokens.css"`; `files: ["dist", "README.md", "LICENSE.md"]`; `sideEffects: ["*.css"]`; remove `"private"`.
- [x] Dictionaries: expose `dictionaries/en_US.aff|dic` under `dist/dictionaries/` and document `settings.spellcheckDictionaryUrl` pointing at them (consumers copy them to their assets).
- [x] Add `packages/core/demo/index.html` plus `demo.ts` (served by `vite` dev server or `npx serve` after build): two editors side by side, a theme toggle, a "log markdown" button, an `uploadImage` stub returning an object URL. No Angular.
- [x] Add `README.md` for the package: install, minimal example, host interface, features table, theming, CSP note (mermaid), peer dependency list and versions.
- [x] Root scripts: `build:core`, `demo:core`; make `npm run compile` for the extension consume **source** (webpack alias `@mikedown/core` → `packages/core/src`) so VS Code development keeps hot rebuilds and never depends on a published version.
- [ ] Publish: `npm login` is the user's step (prompt them, do not attempt credentials). Then `npm publish -w packages/core --tag rc --access public` (or `npm pack` to `/Volumes/Storage/LymeStack/packages/npm/` per M0). Record the version in the Progress Log. **Pending:** npm not logged in; packed `0.1.0-rc.1` instead (see worker-summary-m4.md).
- [x] Commit.

[Return to Top](#mikedown-core-extraction-and-angular-wrapper--planning-document)

---

## T2 — Core package tests

**Recommended model:** Sonnet.

**Modes:** unit (vitest) plus a hands-on pass on the demo page. No screenshots: the demo page is the visual gate and the user is already opening it.

**Automated**

- [x] `packages/core/test/package-shape.test.ts`: after `npm run build -w packages/core`, assert `dist/index.js` exists, is ESM (no `require(`), contains no `acquireVsCodeApi` or `--vscode-` strings; `dist/styles.css` contains no `--vscode-` and every selector is scoped under `.mikedown-root` (parse with `postcss` and walk rules); `dist/index.d.ts` exports `createMikeDownEditor`, `MikeDownHost`, `MikeDownEditorHandle`.
- [x] Consumer smoke test: in the scratchpad, `npm init -y`, install the packed tarball, `node -e "import('@mikedown/core')"` succeeds (jsdom not needed for import).
- [x] Bundle size budget: `dist/index.js` gzipped under 400 KB with externals excluded; record the number.
- [x] All MikeDown suites still green.

**Hands-on (user, about 10 minutes)**

Start: `cd ~/git/mikedown && npm run demo:core`, open the printed URL (default `http://localhost:5173`).

- [x] Two editors render with distinct content; typing in one does not affect the other. Toggle theme: dark tokens apply to both. Paste an image: it appears (object URL). `Cmd+/` source mode works. Slash menu opens with `/`. Settings gear opens the modal with only core sections (no VS Code-only sections like image paste folders or support prompt). Resize the window to 400px wide: toolbar wraps, no horizontal scroll. Judge the look here: spacing, borders, focus ring, dark mode. Orchestrator pauses for sign-off.

[Return to Top](#mikedown-core-extraction-and-angular-wrapper--planning-document)

---

## M5 — Angular wrapper in LymeStarter

**Recommended model:** Opus. Angular forms integration plus the component's visual fit inside the LymeStack shell.

**Repo:** `~/git/lymestarter` (read its `CLAUDE.md` first). New folder `ng-app/src/app/lymestack-shared/mikedown/`, which is already inside a `lymetools sync` core folder so downstream scaffolds receive it.

**Tasks**

- [x] Wire `host.resolveImageSrc(src)` in the wrapper (added to core by the image-src gap-fill, 2026-10-22): map relative image paths to an API URL when one exists; otherwise leave them unresolved so the core shows its missing-image placeholder.
- [x] `npm install @mikedown/core@rc` (or the `file:` tarball per M0) in `ng-app`; add `@import '@mikedown/core/styles.css'` and `tokens.css` to the shared styles entry the LymeStack skins use (find where `lymestack-skins` loads global SCSS and follow that pattern), and map the `--mikedown-*` tokens from the skin's own CSS variables so the editor follows the active skin.
- [x] Create `mikedown-editor.component.ts` (`selector: 'lyme-markdown-editor'`, **standalone** for Angular 19; M6 adapts for 14): `ControlValueAccessor` registered via `NG_VALUE_ACCESSOR`; `@Input() theme: 'light'|'dark'|'auto'`, `features`, `readOnly`, `placeholder`, `minHeight`, `imageUpload?: (file) => Observable<{ src: string; alt?: string }>`; `@Output() ready`. Create the editor in `ngAfterViewInit` inside `NgZone.runOutsideAngular`, re-enter the zone to emit CVA changes, debounce `onChange` 150ms, `writeValue` → `setMarkdown(value ?? '', { pristine: true })`, `setDisabledState` → `setReadOnly`, `ngOnDestroy` → `destroy()`.
- [x] Host implementation `AngularMikeDownHost`: `onChange` → CVA, `openLink` → `window.open` for http(s) and `Router.navigateByUrl` for relative paths, `uploadImage` → the input callback (absent = disabled), `loadSettings`/`saveSettings` → `localStorage` key `mikedown.settings` (per-user convenience only).
- [x] Add `mikedown-editor.component.html/.scss` with the host-side chrome: a 1px border using the skin's border token, focus-within accent ring, `min-height`, and an invalid state (`.ng-invalid.ng-touched`) that matches Material form-field error styling. Design it to sit naturally beside `mat-form-field` controls: same corner radius, same label typography.
- [x] Add a demo page under `lymestack-dev` (the template's dev-only folder) with a reactive form: the editor bound to `notes`, a plain `mat-input` beside it, a "Load sample" button calling `patchValue`, a "Disable" toggle, and a `<pre>` showing `form.value.notes` live. Register its route following the folder's existing pattern.
- [x] Add `index.ts` barrel and a short `README.md` in the folder (usage, inputs, how to pass an `imageUpload`).
- [x] If `lymestack-ownership.json` needs the new path listed (it should not, being under `lymestack-shared`), say so in the summary rather than editing the file.
- [x] `ng build` green, `ng lint` clean. Commit per the LymeStarter `CLAUDE.md` branch rules.

[Return to Top](#mikedown-core-extraction-and-angular-wrapper--planning-document)

---

## T3 — Wrapper tests

**Recommended model:** Sonnet.

**Modes:** Angular TestBed unit specs plus a hands-on pass on the dev page. No screenshots.

**Automated**

- [x] `mikedown-editor.component.spec.ts` (Karma/Jest, whichever `ng-app` uses): `writeValue('# Hi')` renders an `h1` inside `.mikedown-root` and does **not** emit a change; a dispatched edit through the handle emits exactly one debounced `onChange` with the new markdown; `setDisabledState(true)` makes the editor read-only and the toolbar inert; destroying the fixture removes the editor DOM and leaves no `window` listeners; `imageUpload` absent → pasting an image does nothing; present → the returned `src` appears in the markdown.
- [x] A spec mounting the component inside `FormGroup` with `Validators.required`: empty → invalid, typed text → valid, `reset()` → empty and pristine.
- [x] `ng test --watch=false` green.

**Hands-on (user, about 5 minutes)**

Start: `cd ~/git/lymestarter/ng-app && npm start` and the API per the LymeStarter `CLAUDE.md`; log in with the template's dev admin account named there; navigate to the dev page route added in M5 (the worker records the exact URL in the Progress Log).

- [x] Type in the editor and watch the `<pre>` update; "Load sample" fills the editor without marking the form dirty; "Disable" greys the editor; switch skins (if the shell has a skin switcher) and confirm the editor recolors; judge the fit next to the `mat-input`. Orchestrator pauses for sign-off.

[Return to Top](#mikedown-core-extraction-and-angular-wrapper--planning-document)

---

## M6 — Quantico Creek legacy app integration

**Recommended model:** Opus. Angular 14 compatibility work plus fitting the control into an existing Material screen.

**Repo:** `~/git/quanticocreek/quantico-creek-angular-app` (Angular 14.2, TS 4.7). Read `~/git/quanticocreek/CLAUDE.md` and `agents.md` first. Target screen per `core-extraction-decisions.md` (M0).

**Tasks**

- [x] Install `@mikedown/core` (same version as M5) and apply the M0 spike's mitigation (`skipLibCheck`, or nothing if compatible). `ng build` must pass before any UI work.
- [x] Copy `lymestack-shared/mikedown/` from LymeStarter into `src/app/shared/mikedown/` and adapt for Angular 14: convert the standalone component to one declared and exported by a new `MikeDownModule` (standalone is only developer preview in 14); replace any `inject()`-style or signal APIs with constructor injection; keep the file names identical so future re-syncs are a diff, and add a header comment `// Copied from lymestarter ng-app/src/app/lymestack-shared/mikedown @ <commit>`.
- [x] Add the global styles (`styles.css`, `tokens.css`) to `angular.json` `styles` or `src/styles.scss`, and map `--mikedown-*` tokens from the app's Material theme (`@use '@angular/material' as mat; mat.get-color-from-palette(...)` or the existing theme SCSS variables).
- [x] Replace the chosen screen's markdown `textarea` (or add the editor beside the existing `ngx-markdown` rendering) with `<lyme-markdown-editor formControlName="…">`. Keep the existing save path untouched: the control emits a markdown string, the form posts the same field it did before. Preserve any existing `required`/length validators.
- [x] Make sure read-only views of the same field still render through `ngx-markdown` (no behavior change for readers).
- [x] `ng build --configuration production` green, `ng lint` clean, existing specs green. Commit on the branch the Quantico Creek `CLAUDE.md` prescribes.

[Return to Top](#mikedown-core-extraction-and-angular-wrapper--planning-document)

---

## T4 — Quantico Creek hands-on

**Recommended model:** Sonnet (writes the checklist and any missing spec; the user runs the pass).

**Modes:** hands-on only. The screen already exists; the only new judgment is whether the editor fits and saves correctly.

**Automated**

- [x] If the target component has a spec, extend it: the form field is populated from the loaded entity and the save payload carries the edited markdown. `ng test --watch=false` green.

**Hands-on (user, about 10 minutes)**

Start: API via `~/git/quanticocreek/Run.bat` equivalent on macOS per `CLAUDE.md` (worker records the exact commands and the dev login in the Progress Log); `cd quantico-creek-angular-app && npm start`; open `http://localhost:4200` and the route recorded for the target screen.

- [ ] Open an existing record: the notes field shows the saved markdown rendered WYSIWYG. Edit, add a bullet list and a bold word, save, reload: the change persisted and the read-only view (`ngx-markdown`) renders it. Leave the field empty where it is required: the Material error appears and save is blocked. Check the editor's look against the surrounding Material fields in both of the app's themes if it has two. Orchestrator pauses for sign-off.

[Return to Top](#mikedown-core-extraction-and-angular-wrapper--planning-document)

---

## M7 — Release wiring and docs

**Recommended model:** Sonnet.

**Tasks**

- [x] `npm run vsix` also bumps `packages/core` to the same version and runs `build:core`; add `npm run release:core` that publishes (or packs to the share). Document the order in `CLAUDE.md`: core publish first, then vsix.
- [x] `CHANGELOG.md`: entry for the extraction (no user-facing change in VS Code; note the new package).
- [x] (docs + `mergeFiles` done; version bump blocked on publish) `~/git/lymestarter`: note the new shared control in whatever doc lists `lymestack-shared` components; bump the pinned `@mikedown/core` version from rc to the released one. Also add `ng-app/package.json` to `mergeFiles` in `lymestack-ownership.json` (decision 2026-10-22) so downstream syncs surface the `@mikedown/core` dependency; drop the vendored tarball once the registry version is pinned.
- [x] (CLAUDE.md note done; version bump blocked on publish) `~/git/quanticocreek`: same version bump; add a line to its `CLAUDE.md` pointing at `src/app/shared/mikedown/` and its LymeStarter origin.
- [x] Update `RESUME.md` and `BACKLOG.md` in MikeDown (follow-ups: M8/M9 if not done, a React wrapper if ever wanted, publishing dictionaries separately).
- [x] Final full test run in MikeDown (`test:unit`, `test:edge`, `test:integration`) green. Commit in each repo.

[Return to Top](#mikedown-core-extraction-and-angular-wrapper--planning-document)

---

## M8 — Image upload for Quantico Creek (optional)

**Recommended model:** Sonnet. Standard API + wiring. Read `~/.claude/claude-md-sections/dotnet.md` first.

**Tasks**

- [x] In `QuanticoCreekApi`, add `POST /api/markdown-images` (multipart, authenticated) that stores the file where the app already keeps uploaded documents (follow the existing Azure OCR document upload path for storage location and naming) and returns `{ src }` as a URL the SPA can load.
- [x] Angular: an `imageUpload` function in the target component that posts the file and maps the response, passed as `[imageUpload]` to the editor.
- [x] Unit test the controller (happy path, rejects non-image MIME, size cap).
- [ ] Hands-on: paste a screenshot into the notes field, save, reload, the image renders in both the editor and the `ngx-markdown` view.

[Return to Top](#mikedown-core-extraction-and-angular-wrapper--planning-document)

---

## M9 — Assistant app integration (optional)

**Recommended model:** Sonnet. Angular 19: the LymeStarter component copies in unchanged.

**Tasks**

- [x] Copy `lymestack-shared/mikedown/` into `quantico-creek-assistant-app/src/app/shared/mikedown/` with the origin-commit header; install `@mikedown/core`; add styles and token mapping.
- [x] Use it on the assistant app's first markdown-editable field (worker identifies it: the app renders markdown with `marked` 15 somewhere).
- [x] `ng build` green; a short hands-on pass (open, edit, save, reload).

[Return to Top](#mikedown-core-extraction-and-angular-wrapper--planning-document)

---

## M10 — Bot protection for AI endpoints

**Recommended model:** Opus. Touches auth, entitlements and request limits in the Quantico Creek API.

**Goal:** stop bots and scripted callers from burning AI usage credits through the assistant app's API. Requirement raised 2026-10-22; it was discussed earlier but never recorded. Independent of the core extraction chain; can run at any time (read `~/git/quanticocreek/CLAUDE.md` first).

**Tasks**

- [ ] Inventory every API endpoint that calls an AI provider (grep the Quantico Creek API for the AI client / SDK usage) and record which are anonymous versus authenticated.
- [ ] Add server-side rate limiting on those endpoints (per user when authenticated, per IP otherwise), with limits in configuration and a clear 429 response the Angular app can show.
- [ ] Add a CAPTCHA challenge (Cloudflare Turnstile or hCaptcha, worker recommends one) on the anonymous entry points, verified server-side before any AI call is made.
- [ ] Add a daily per-user / per-IP usage cap on AI calls and log usage so abuse is visible.
- [ ] Wire the assistant app (Angular 19) to render the challenge and handle 429 / cap-reached responses.
- [ ] Tests for the limiter and the cap logic; hands-on pass showing a blocked bot-style burst and a normal user unaffected.

[Return to Top](#mikedown-core-extraction-and-angular-wrapper--planning-document)

---

## M11 — Opt-in wrapper (lymetools `optionalFolders`)

**Recommended model:** Opus. Two repos (`~/git/lymetools`, `~/git/lymestarter`), a new ownership class in the sync engine.

**Decision (2026-10-22):** the Angular wrapper must not ship in every scaffold. M5 placed it in `lymestack-shared/mikedown/` (core folder) and M7 made `ng-app/package.json` a merge file to carry `@mikedown/core`; both are reversed here.

**Tasks**

- [x] lymetools: add `optionalFolders` to `OwnershipManifest` (same entry shape as `coreFolders`); `sync` treats an optional folder as core only when the app has adopted it (folder present or ledger record), otherwise skips and reports `optional, not adopted` under `--check`; `lymetools adopt <path>` copies the folder from upstream and records it; help text and `SyncTests` updated; old manifests without the key still parse.
- [x] LymeStarter: `git mv` the wrapper to `ng-app/src/app/lymestack-optional/mikedown/`; move the demo out of `lymestack-dev` into the optional folder and register its route from a merge file inside `lymestack:optional mikedown` markers; same markers around the `styles.scss` `@use`; manifest entry; `@mikedown/core` dependency and vendored tarball stripped at scaffold time the way `templateOnly` content is; README adoption steps; `docs/architecture.md` and `CLAUDE.md` ownership text updated; `ng build`, `ng test`, `ng lint` green.

[Return to Top](#mikedown-core-extraction-and-angular-wrapper--planning-document)

---

## Parallel Development Recommendations

**Sequential blockers**

- **M0 → everything.** Nothing moves until the decisions file is approved and the Angular 14 spike has a verdict.
- **M1 → M2 → T1 → M3 → M4 → T2** is a strict chain inside the MikeDown repo; each rewrites files the next depends on, and the extension must stay green at each step. One worker at a time in `~/git/mikedown`.
- **M4 (published rc) → M5.** The wrapper needs an installable package.
- **M5 → M6, M9.** Both copy the wrapper from LymeStarter.
- **M6 → T4 → M8.**

**Parallel groups**

| Group | Milestones | Condition |
|---|---|---|
| A | M3 (theme) and M4 (build config, demo skeleton, README) | Only after M2 lands; M3 owns `packages/core/src/styles/*`, M4 owns `packages/core/package.json`, `tsup.config.ts`, `demo/`, `README.md`. M4's CSS concatenation step waits for M3's file list. |
| B | M5 (LymeStarter) and M7's documentation items | After T2. Different repos, no shared files. |
| C | M6 (legacy app) and M9 (assistant app) | After T3. Different app folders in the same repo; commit on separate commits. |
| D | M8 (API) and M7 | After T4. |
| F | M11 (opt-in wrapper) | Done 2026-10-22. lymetools `f1fae56`, `0559e8a`; LymeStarter `5624990`, `d1e3e5a`, `bacc877`. |
| E | M10 (API bot protection) | No dependency on the core chain; any time, but not in the same wave as M8 (both touch the Quantico Creek API). |

**Orchestrator context management.** Dispatching several worker prompts fills the orchestrator context. When waiting on workers, prompt the user to run `/compact`; monitor context usage and suggest compacting proactively near the limit. After compacting, resume from `.orchestrator/state.json`.

[Return to Top](#mikedown-core-extraction-and-angular-wrapper--planning-document)

---

## Gap-Filling Prompts

When a milestone finishes with items skipped or partially done, the orchestrator issues a gap-filling prompt that:

- Uses the same structure as the original milestone prompt (header, mission, reference to this document, worker rules).
- Is labeled **"Worker Context: [Milestone Name] - Gap Fill"**.
- States what the original attempt completed, which files it modified, and the exact unchecked items remaining.
- Lists other active workers and their directories (MikeDown, LymeStarter, Quantico Creek) to avoid conflicts.
- Ends with the standard completion steps: commit code changes, write `.orchestrator/worker-summary-[milestone-slug]-gap.md`, update this document's tracker and Progress Log, prompt the user to clear the context.

[Return to Top](#mikedown-core-extraction-and-angular-wrapper--planning-document)

---

## Progress Log / Notes

**2026-10-22 19:45** - M8 code done (Quantico Creek `master` `99d7e30` API, `3274bbb` SPA, not pushed). `POST /api/markdown-images` (authenticated, image MIME + size cap) stores under the existing documents data folder and returns `{ src }`; anonymous GET serves only image types by random name. KB article editor passes `[imageUpload]`; AI prompt form intentionally left out (prompt text goes to the model as plain text). Fixed a macOS relative data-path 500 on GET. 958 .NET tests (10 new), 125 SPA specs, build green. Hands-on paste/save/reload pending (Google SSO blocks curl). Follow-ups: anonymous GET policy, orphan image cleanup.

**2026-10-22 19:40** - M7 part 2 done (LymeStarter `develop` `6509da5`, Quantico Creek `master` `a7f3f40`, not pushed): shared-components doc entry for `<lyme-markdown-editor>`, `ng-app/package.json` added to `mergeFiles` in `lymestack-ownership.json` (JSON parses; no `lymetools` on this machine to dry-run the sync), Quantico `CLAUDE.md` pointer to `src/app/shared/mikedown/`. Version bumps remain blocked on the `@mikedown/core` publish.

**2026-10-22 19:35** - Gap-fill: AI prompt form (`/admin/ai/ai-prompts/edit/:id`) now uses `<lyme-markdown-editor>`; textarea and preview removed (Quantico Creek `master` `3cfd785`, not pushed). The serializer escaped `[Token]` placeholders to `\[Token\]`, so the wrapper gained a `preserveBrackets` input; a core-level option is logged as a follow-up. 124 specs green, build green.

**2026-10-22 19:30** - Gap-fill: KB article editor preview pane removed (Quantico Creek `master` `3ad1a39`, not pushed); editor spans full width at 480 px min height. 117 specs green, build green. Next gap-fill dispatched: AI prompt form (`/admin/ai/ai-prompts/edit/:id`) moves from textarea + preview to `<lyme-markdown-editor>`.

**2026-10-22 19:25** - T4 hands-on signed off by Mike in the running app (KB article editor renders, edits, preview matches). Follow-up gap-fill dispatched: remove the redundant ngx-markdown preview pane now that the editor is WYSIWYG.

**2026-10-22 19:05** - T4 automated part done (Quantico Creek `master` `06af745`, not pushed). New `kb-article-editor.component.spec.ts` checks the markdown field is populated from the loaded article and the save payload carries the edited markdown. Specs 115 to 117, all green. CommonJS build warnings silenced via `allowedCommonJsDependencies`. No `required` validator on markdown, so the required-field hands-on step does not apply. Hands-on recipe in `.orchestrator/angular-core-extraction-plan/worker-summary-t4.md`.

**2026-10-22 18:57** - M6 complete (Quantico Creek `master` `0cc63c4`, `2db4ce1`, `a23f051`, `58cf5f7`, not pushed). The KB article editor (`/admin/knowledge-base/edit/:id`) now uses `<lyme-markdown-editor>` through `[(ngModel)]="model.markdown"`. The save payload is unchanged and the ngx-markdown preview stays. The wrapper lives in `src/app/shared/mikedown/` behind a new `MikeDownModule`, with constructor injection, `.dark-theme` shell detection and tokens from the Material theme (no `color-mix()`). Only `skipLibCheck` was needed. Production build green, with the editor in the lazy KB chunk (632 kB transfer). Specs went from 105 to 115, all green, and eslint shows no new problems. Headless check against a mocked API passed. All 15 shipped KB articles round-trip with their `<!-- -->` notes intact; two tables normalize spacing. T4 note: the markdown field has no `required` validator. Summary: `.orchestrator/angular-core-extraction-plan/worker-summary-m6.md`.

**2026-10-22 18:45** - M9 complete. Wrapper copied into the assistant app (`src/app/shared/mikedown/`), `@mikedown/core` vendored as a tarball, theme mapped onto the assistant palette. No editable markdown field existed, so a "Notes for our team" editor was added to the lead panel (session-persisted, not yet sent to the API). Build green, 43 tests pass, headless open/edit/reload verified. Quantico commits `7da3600`, `ec6eb5e`. Summary: `.orchestrator/angular-core-extraction-plan/worker-summary-m9.md`.

**2026-10-22 18:45** - T3 automated block done (LymeStarter `develop` `f86e512`, not pushed). 9 new Karma specs for `lyme-markdown-editor`: writeValue, debounce, disabled, destroy and window listeners, image paste with and without `imageUpload`, FormGroup required/reset, ngModel. `ng test --watch=false`: 549 before, 558 after, all green. Hands-on at http://localhost:4200/dev/markdown-editor (no login on `/dev`; API must answer `localhost:5218/AppConfig`; CLAUDE.md names no API start command or dev account). Summary: `.orchestrator/angular-core-extraction-plan/worker-summary-t3.md`.

**2026-10-22 18:20** - M7 part 1 complete. `vsix` syncs core version and builds core; `release:core` publishes or packs; release order in CLAUDE.md; CHANGELOG, RESUME, BACKLOG updated. Tests: unit 933/2 todo, edge 22, integration 47, core-package 7, lint 0 errors. LymeStarter and Quantico Creek version bumps pending.

Newest first. Format: `**YYYY-MM-DD HH:MM** - entry`.

**2026-10-22 17:10** - M11 complete. lymetools `develop` `f1fae56`, `0559e8a`: `optionalFolders` ownership class (entry adds `dependencies` and `files` to the coreFolders shape), top-level `lymetools adopt <path>`, adoption recorded under ledger `coreFolders`, `--check` lists `not-adopted`, `scaffold app` strips optional folders, their deps and `lymestack:optional-begin/end` blocks. LymeStarter `develop` `5624990`, `d1e3e5a`, `bacc877`: wrapper and demo in `lymestack-optional/mikedown/`, demo route and theme `@use` in optional blocks of `app.routes.ts` / `styles.scss`, `ng-app/package.json` stays a merge file. lymetools 933 passed; ng build OK, ng test 558; no ESLint config in LymeStarter so `ng lint` not run. End to end: fresh scaffold has no mikedown traces and builds; adopt then `--check` clean. **Follow-ups:** (1) `setup-project-lymestarter` skill in claude-shared-settings needs the matching strip step; (2) `lymetools scaffold app` against real LymeStarter was already broken (no `about` route, invalid `portal-features.ts`, doctor placeholder), backlog in lymetools; (3) sync does not refresh an adopted folder's `files` (tarball bump is a hand copy until the registry publish); (4) lymetools tests need arm64 `/usr/local/share/dotnet/dotnet`, the Homebrew x64 dotnet fails 17 SyncTests under Rosetta.

**2026-10-22 16:05** - Added M11: wrapper becomes opt-in. New lymetools `optionalFolders` ownership class plus `lymetools adopt`; wrapper moves to `lymestack-optional/mikedown/`. Reverses the M5 placement and the M7 `package.json` merge-file rationale. Dispatched (Opus) as a clipboard worker outside the orchestrator session.

**2026-10-22 18:27** - M5 complete (LymeStarter `develop` `3574592`, `1ad8b86`, `ec75b35`, not pushed). The standalone `lyme-markdown-editor` CVA and `AngularMikeDownHost` are in `lymestack-shared/mikedown/`. The core is vendored as a `file:` tarball in `ng-app/vendor/`. Its CSS loads from `styles.scss`, with `--mikedown-*` mapped to `--ls-*`, so it follows theme, skin and dark mode. Demo at `/dev/markdown-editor`. `ng build` green; there is no `ng lint` target, and an ad hoc angular-eslint run was clean. Headless Chromium checks passed (debounce, pristine load, invalid/disabled states, `.form-control` parity in light, dark and airy, KaTeX, Mermaid, placeholder, destroy). Deviations: no Angular Material in the template, so the editor matches Bootstrap `.form-control`. Open: downstream sync does not carry the npm dependency (orchestrator decision), and lowlight is 1 MB of the 2.6 MB lazy chunk. Summary: `.orchestrator/angular-core-extraction-plan/worker-summary-m5.md`.

**2026-10-22 18:11** - Image source gap fill: core now has `host.resolveImageSrc` (qualified `http/https/data/blob` render as is, others go through the host, else the placeholder with the raw path; stored `src` untouched), a `Mod-/` source toggle gated by `hostOwnsShortcuts` (VS Code passes true), and host-neutral Settings copy for spelling and tags. 933 unit, 22 edge, 47 integration, 7 core-package, lint 0 errors. Tarball repacked. See worker-summary-imagesrc-gapfill.md.

**2026-10-22 18:03** - T2 gap fill: Editor B was blank because its demo container had no height and every core child is absolutely positioned, so the root collapsed to 0px. Core root now has a `--mikedown-min-height` floor (240px; VS Code sets 0), demo sizes Editor B and fits at 400px. Regression test `packages/core/test/two-editors.test.ts`. Hands-on walk: pass except Cmd+/ (no core keybinding outside VS Code) and two VS Code-worded settings descriptions; both left as follow-ups. Unit 920 / 2 todo, edge 22, integration 47, core package 7, lint 0 errors. Summary: `.orchestrator/angular-core-extraction-plan/worker-summary-t2-gapfill.md`.

**2026-10-22 17:57** - T2 automated block complete; hands-on pending (user). Added `packages/core/test/package-shape.test.ts` (7 tests) and root script `test:core-package`. `dist/index.js` is 112.3 KB gzipped (budget 400 KB). Packed tarball installs and imports in a clean project; TS 4.7.4 fixture passes with `skipLibCheck`, no mermaid/katex/nspell types in `.d.ts`. Unit 916 / 2 todo, edge 22, integration 47, lint 0 errors. Summary: `.orchestrator/angular-core-extraction-plan/worker-summary-t2.md`.

**2026-10-22 17:50** - Callout gap fill done. Body text duplicated on parse ("TextText") because the callout markdown-it rule pre-parsed inline children and markdown-it's own inline rule appended a second copy. Fixed in `callout-node.ts` (children left empty); full-extension-set regression test added. **v2.14.2 is affected**, so a patch release is needed. Unit 909 / edge 22 / integration 47 green. Summary: `.orchestrator/angular-core-extraction-plan/worker-summary-callout-gapfill.md`.

**2026-10-22 17:41** - M3 complete. The core CSS reads only `--mikedown-*` tokens (54, mapped in `packages/core/src/styles/tokens.md`; more than the 25 to 35 aimed for, to keep the VS Code themes unchanged) and every selector is scoped under `.mikedown-root` or the new `.mikedown-portal` overlay container. `tokens.css` has light, dark and auto defaults; `src/webview/vscode-theme.css` maps the VS Code theme onto the tokens and holds the VS Code-only rules. Theme is `data-mikedown-theme` on the root; font, width and sidebar state moved off `<html>`/`<body>`. `npm run build:css -w packages/core` writes `dist/styles.css` (with the KaTeX import) and `dist/tokens.css`; `npm run demo -w packages/core` opens a stub demo. A headless-Chrome computed-style diff of the webview in five themes shows only the documented merges. Unit 907 (2 todo), edge 22, integration 47, lint 0 errors. Found a pre-existing bug for routing: callout bodies duplicate on parse (`> [!NOTE]\n> Text` loads as "TextText", present at the M1 tip). Summary: `.orchestrator/angular-core-extraction-plan/worker-summary-m3.md`.

**2026-10-22 16:16** - T1 automated block complete; hands-on pending (user). Added `packages/core/test/factory.test.ts`, `packages/core/test/host-gating.test.ts` and `test/unit/vscodeHost.test.ts`. Counts: unit 859 to 906 passed (2 todo), edge 22, integration 38, lint 0 errors. Found and fixed one core bug: a second `setSlashHiddenCommands` call made `/properties` show with the sidebar off. Removed stray `tagExtract.ts-E`. Summary: `.orchestrator/angular-core-extraction-plan/worker-summary-t1.md`.

**2026-10-22 16:04** - M2 complete. `createMikeDownEditor` (`packages/core/src/editor.ts`) builds its DOM inside the container with classes, not ids, keeps state per instance and tears down every global listener in `destroy()`. `MikeDownHost` and the handle follow decisions section 5. `src/webview/editor-main.ts` is the VS Code shell (`VsCodeHost`, listener, support card, VS Code settings rows through `extraSettingsSections`); the provider changed only in its HTML (`#editor-root`). Compile, 859 unit, 22 edge, lint 0 errors, 38 integration. Content width stays unpersisted (known gap). Some module singletons and body-level classes remain shared across instances (follow-up for M3/M4). Summary: `.orchestrator/angular-core-extraction-plan/worker-summary-m2.md`.

**2026-10-22 15:35** - M1 complete. `packages/core` (`@mikedown/core`, private) holds the former `src/webview` with history, styles in `styles/`, host-shared modules in `shared/` (imported by the host as `@mikedown/core/shared/*` through aliases). Compile, 859 unit, 22 edge tests and lint unchanged; `.vsix` +0.6% vs 2.14.2. Katex stays a root dependency so its CSS ships. Summary: `.orchestrator/angular-core-extraction-plan/worker-summary-m1.md`.

**2026-10-22 15:23** - Added M10 (bot protection for AI endpoints: rate limiting, CAPTCHA, usage cap in the Quantico Creek API). Previously discussed, never recorded. Independent of the core chain; parallel group E.

**2026-10-22 16:26** - T1 gap-fill complete. Nine hands-on items automated in `test/integration/parityGapfill.test.ts` (table, bold, source toggle, `/date`, font persistence, sidebar pref, reopen, diff redirect, HTML export) through an env-gated webview test hook. Integration 38 to 47; unit 906 and edge 22 unchanged. Remaining hands-on: clipboard image paste, print dialog, visual checks. Summary: `.orchestrator/angular-core-extraction-plan/worker-summary-t1-gapfill.md`.

**2026-10-22 15:00** - M0 complete. `@mikedown/core` scope is free. Angular 14 / TS 4.7 is compatible with `skipLibCheck` (build and runtime pass; core `.d.ts` must not expose mermaid/nspell/katex types). Angular 19 builds clean (+0.55 kB initial). Build tool tsup; tiptap-markdown stays a plain dependency. Message and settings tables written. Quantico target: KB article editor. Awaiting approval of `core-extraction-decisions.md`.

**2026-10-22 14:40** - Planning document created. Verified facts recorded in [Current state](#current-state-verified-2026-10-22): webview bundle has ~50 `postMessage` sites and one `acquireVsCodeApi` call, 81 `--vscode-*` CSS variables, TipTap 3.20 / tiptap-markdown 0.9; LymeStarter Angular is vendored via `lymetools sync` (no npm feed); Quantico Creek legacy app is Angular 14 / TS 4.7, assistant app Angular 19. `npm whoami` is not logged in (needed before M4). Playwright declined. Open gate: M0 decisions file.

**2026-10-22 17:52** - M4 complete. `@mikedown/core` `0.1.0-rc.1` builds with tsup (ESM, d.ts, styles.css, tokens.css, dictionaries); Mermaid and KaTeX load lazily; two-editor demo (`npm run demo:core`) and package README added; the extension builds core from source via a webpack alias. Compile, 909 unit, 22 edge, 47 integration, lint 0 errors; VSIX still about 4.5 MB. Not published: `npm whoami` is ENEEDAUTH. Tarball packed at `.orchestrator/angular-core-extraction-plan/artifacts/mikedown-core-0.1.0-rc.1.tgz`; run `npm publish -w packages/core --tag rc --access public` after `npm login` and creating the `mikedown` org. Summary: `.orchestrator/angular-core-extraction-plan/worker-summary-m4.md`.

**2026-10-22 18:49** - M9 gap-fill: lead panel "Notes for our team" editor now hidden behind `leadNotesEditor` environment flag, default off (API field pending). Quanticocreek commit 4bc6303; build and 45 specs green. Summary: `.orchestrator/angular-core-extraction-plan/worker-summary-m9-gapfill.md`.

[Return to Top](#mikedown-core-extraction-and-angular-wrapper--planning-document)
