# Worker summary: M9 — @mikedown/angular

**Status:** Completed

- **Start:** 2026-10-24 16:49 EDT
- **End:** 2026-10-24 17:04 EDT
- **Worktree:** `/Users/michaeljosephwork/git/mikedown/.claude/worktrees/agent-a7c7b71d317fa8141`
- **Branch:** `worktree-agent-a7c7b71d317fa8141` (reset from stale `4172f62` to `0a9d1b8` first; the tree was clean)
- **Commits:** `bc7408e` (library, README, tooling), `c3b6a88` (test app, `test:angular`, CI)

## Work completed

- [x] **ng-packagr library, Angular 17 partial Ivy, isolated toolchain.** `packages/angular/` with its own `package-lock.json`, outside the root workspaces (the `!packages/angular` negation was already there). Toolchain: `@angular/*` ~17.3.12, `ng-packagr` ~17.3.0, TypeScript ~5.4.5, zone.js ~0.14.10, on Node 22.20.0 / npm 11.6.1 (builds in about 1.2 s). Core comes in as `"file:../core"` (an npm link; nothing is installed into `packages/core/node_modules`). Published from `dist/` (README, LICENSE, CHANGELOG copied via `ng-package.json` assets). Source started from the LymeStarter copy.
- [x] **Fork differences as generic inputs.** Built on `bindMikeDownValue` (no reimplemented debounce, pristine loads or theme). Inputs: `preserveBrackets` (via the binding's `outputTransform`) with exported `unescapeBrackets`, `darkSelector`, `settings` (form defaults `contentWidth: '100%'`, `fontSize: 15`, no font < `settings` < localStorage), `imageUpload`, `imageBaseUrl`, `imageSrcResolver`, `minHeight`, `placeholder` (now passed to core; CSS hack gone), `features`, `readOnly`, `theme`, output `ready`. Added: `debounceMs`, `spellcheckDictionaryUrl`, `inputId`, `ariaLabel`, `ariaLabelledBy` (accessibility contract). Frame SCSS reads `--mikedown-field-*` with neutral fallbacks; classes are `mikedown-field__*` / `mikedown-field--*`.
- [x] **Selectors and module.** `selector: 'mikedown-editor, lyme-markdown-editor'`, standalone. `MikeDownModule` built (imports and exports the component).
- [x] **Floor APIs only.** Decorator `@Input`s (`booleanAttribute` transform, 16.1+), `inject()` in field initializers, `Router` injected `{ optional: true }`. Editor is created only in the browser (`isPlatformBrowser`).
- [x] **Peers.** `@angular/core`, `common`, `forms`, `router` `>=17.0.0 <23.0.0`; `rxjs ^7.5.0`; `@mikedown/core ^0.2.0-rc.0`. `tslib` is the only dependency. `sideEffects: false`.
- [x] **Spec ported to the M0 runner.** `packages/angular/test-app/` (Angular 19.2, Karma 6.4, Jasmine 5, ChromeHeadless, own lockfile) compiles the library source through a tsconfig path. 25 specs: the LymeStarter spec, the legacy fork's `preserveBrackets` and shell-theme tests, plus pristine same-value writes, `debounceMs`, external write cancelling a pending debounce, blur flush and touched, disabled before init, `darkSelector` for `.dark-theme` and `html[data-mode=dark]` (and pinning stops following), OS theme, `<label for>` / `inputId`, placeholder, settings merge order, the alias selector through `MikeDownModule`. A mutation check (identity `outputTransform`, no `darkSelector`) made 3 of them fail as expected.
- [x] **README.** Install (npm, Yarn peer line), supported versions table, `angular.json` styles and dictionaries assets, standalone, NgModule, reactive forms, `ngModel`, inputs table, dark mode, settings order, `--mikedown-field-*` table, bracket tokens, images, accessibility, behaviour notes, migration from the vendored copies.
- [x] **M0 "What changes" lines for M9:** peers include `@angular/common` and `@angular/router`; runner at `packages/angular/test-app/` with `test:angular`; legacy `preserveBrackets` tests ported; `settings` merge order and frame variables applied.

## Files modified

- New: `packages/angular/{package.json,package-lock.json,ng-package.json,tsconfig.json,tsconfig.lib.json,.gitignore,README.md,LICENSE.md,CHANGELOG.md}`, `packages/angular/src/public-api.ts`, `packages/angular/src/lib/{mikedown-editor.component.ts,.html,.scss,angular-mikedown-host.ts,mikedown.module.ts,unescape-brackets.ts}`, `packages/angular/test-app/{package.json,package-lock.json,angular.json,karma.conf.cjs,tsconfig.json,tsconfig.spec.json,src/mikedown-editor.component.spec.ts}`, `test/packages/angular-shape.test.ts`.
- Shared (small hunks): root `package.json` (one line: `test:angular`), `.github/workflows/ci.yml` (test-app `npm ci` line, `test:angular` step), `test/packages/package-shape.test.ts` (one line: a non-workspace package's core devDependency is `file:../core`), `scripts/version-npm.mjs` (keeps `file:` core specs instead of overwriting them with `^X`, and refreshes non-workspace lockfiles). Root `package-lock.json` unchanged.

## Test status

| Command | Result |
| --- | --- |
| `npm run build --prefix packages/angular` | OK, 1.2 s |
| `npm run test:angular` | 25/25 SUCCESS (ChromeHeadless 156) |
| `npm run test:packages` | 30 passed (2 files) |
| `npm run lint` | 0 errors (1066 existing warnings) |
| `npm run compile` | OK |
| `npm run test:unit` | 1563 passed, 2 todo |
| `npm run test:edge` | 22 passed |
| `node scripts/version-npm.mjs 0.2.0-rc.1 --dry-run` | bumps angular and its peer, leaves `file:../core` |
| `npm run release:npm -- --only angular` | dry run OK, 24 files, 41 kB packed, from `dist/` |
| `npm ci --prefix packages/angular` and `--prefix packages/angular/test-app` | OK from clean |
| Consumer smoke, Angular 17.3.12 (`ng new` 17, tarballs of core + angular) | `ng build` OK, 8 s, initial 2.83 MB / 712 kB transfer, dictionaries copied |
| Consumer smoke, Angular 19.2.25 | `ng build` OK, 8 s, initial 2.98 MB / 733 kB transfer, dictionaries copied |

## Issues or blockers

- **Core finding (not fixed here; for T1/M14):** an Angular build fails with `Could not resolve "mermaid"` when `mermaid` is not installed. esbuild resolves core's `import('mermaid')` at build time even though it is lazy and `mermaid` is an optional peer. The smokes pass once `mermaid` is installed, and the Angular README tells users to install it. Vite and the other wrappers likely hit the same thing; either make `mermaid` a required peer like `katex`, or document it in every README.
- Build warnings (not errors) for CommonJS `nspell` and `markdown-it-task-lists` (and mermaid's deps); README says to use `allowedCommonJsDependencies`.

## Notes for orchestrator

- `unescapeBrackets` lives in `@mikedown/angular`, not core. M5 already gave the binding `outputTransform`, so React and Vue can pass any transform. Moving the helper into core would be a one-file change if wanted.
- Inputs not live after creation (documented as "read once"): `darkSelector`, `features`, `placeholder`, `debounceMs`, `spellcheckDictionaryUrl`, `inputId`, `ariaLabel`, `ariaLabelledBy`. `theme`, `readOnly`, `settings` (via `handle.updateSettings`) apply live.
- `inputId` instead of `id`: an `@Input() id` would also put the same id on the host element (duplicate ids).
- Relative links without a router now fall back to `location.assign` (the copy did nothing).
- When LymeStarter / Quantico move to the package (angular-core-extraction or M16): `darkSelector`, a `settings` font, and mapping `--mikedown-field-*` to `--ls-*` / `--lyme-md-*`; `lyme-md__*` classes are renamed. The README's migration section lists this.
- Merge note: four wrappers touch `ci.yml` and root `package.json`; my hunks are one script line and two CI lines.
- Publish command (do not run without Mike): `npm run release:npm -- --only angular --publish --otp <code>` (publishes from `packages/angular/dist` with `--tag rc`).

## Review Materials

- Package: `/Users/michaeljosephwork/git/mikedown/.claude/worktrees/agent-a7c7b71d317fa8141/packages/angular/README.md`
- Component: `/Users/michaeljosephwork/git/mikedown/.claude/worktrees/agent-a7c7b71d317fa8141/packages/angular/src/lib/mikedown-editor.component.ts`
- Spec: `/Users/michaeljosephwork/git/mikedown/.claude/worktrees/agent-a7c7b71d317fa8141/packages/angular/test-app/src/mikedown-editor.component.spec.ts`
- Smoke script and throwaway apps: `/private/tmp/claude-503/-Users-michaeljosephwork-git-mikedown/bcdeef5a-0084-4a26-a5d3-4847724c0e44/scratchpad/m9/smoke.sh` (`EXTRA=mermaid bash smoke.sh <worktree> 17|19`), apps in `.../scratchpad/m9/ng17` and `.../scratchpad/m9/ng19`; `npx ng serve` in either shows two editors on one page.
