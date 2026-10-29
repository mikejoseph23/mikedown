# Worker summary: M6 `@mikedown/web-component`

**Status:** Completed

- **Worktree:** `/Users/michaeljosephwork/git/mikedown/.claude/worktrees/agent-a8f6208e89b5de7bc`
- **Branch:** `worktree-agent-a8f6208e89b5de7bc` (reset from stale `4172f62` to base `0a9d1b8` first)
- **Commits (on `0a9d1b8`):**
  - `0a8d082` Set editor list markers explicitly so page resets cannot strip them (core CSS, departure 7)
  - `362ea88` Re-apply the bound theme only when it changes (core binding bug fix, see Issues)
  - `f4d6c5f` Add @mikedown/web-component: the <mikedown-editor> custom element
- **Start / end:** 16:49 / 17:10 (2026-10-24)

## Work completed (per checkbox)

- **Element:** `MikeDownElement extends HTMLElement` (SSR-safe base), light DOM, built on `bindMikeDownValue`. Root exports the class and `defineMikeDownElement(tag = 'mikedown-editor')` (idempotent; a second tag gets a subclass). `./define` registers it. `sideEffects` is `["./dist/define.js", "./dist/mikedown-editor.standalone.js"]` (decisions doc wins over the plan's "only define"). tsup `splitting` keeps one class in a shared chunk for both entries.
- **Labelable/focusable:** a click whose target is the element (label activation) focuses the editor; `internals.labels` are forwarded as `aria-labelledby` (ids added when missing); `aria-label`/`aria-labelledby` forwarded; element keeps its own id; `landmark: false`; `focus()` override.
- **Attributes (reflected):** all eleven, plus `debounce` (extra). `value` attribute reflects `defaultValue` (initial and reset value); changing it later replaces the content. The live value is not written back to the attribute (would serialize the document into the DOM per keystroke).
- **Properties:** `value`, `defaultValue`, `features` (reflected as JSON), `settings` (live via `updateSettings`), `host` (rebuilds), `handle` (read-only), plus `form`, `labels`, `validity`, `validationMessage`, `willValidate`, `checkValidity()`, `reportValidity()`, `type`. Upgrade-time property shadowing handled.
- **Events:** `change` (`detail.value`, debounced, at once on blur) and `ready` (`detail.handle`, one microtask after creation so late listeners hear it), both bubbling and composed. Native `change` events from inputs inside the editor are stopped at the element.
- **Initial value:** `value` attribute, else child `<textarea>` (hidden, disabled, its `name`/`required`/`placeholder` adopted) or `<script type="text/markdown">` (dedented).
- **Form-associated:** `formAssociated`, `setFormValue` on every keystroke, `valueMissing` anchored on the surface, `formResetCallback`, `formDisabledCallback`, `formStateRestoreCallback`. Fallback hidden `<input>` when internals lack `setFormValue` (jsdom, old browsers).
- **Lifecycle:** create on connect, destroy on disconnect; moves keep the value (pending edit reported once first). Create-time options (placeholder, features, dark-selector, dictionary URL, debounce, ARIA, host) rebuild in a microtask, keeping the text.
- **CDN bundle:** `dist/mikedown-editor.standalone.js` via `scripts/build-standalone.mjs` (esbuild): core, peers and minified core CSS (KaTeX `@import` removed) inlined; guarded `<style id="mikedown-styles">`; KaTeX CSS `<link>` only when math is on; `import('katex'|'mermaid')` rewritten to `katex@0.16.47/+esm` and `mermaid@11.15.0/dist/mermaid.esm.min.mjs` on jsDelivr (pins read from installed versions; a static import fails the build). **2,560 kB raw, 779.1 kB gzipped** (budget 850 kB, asserted in `test/packages/web-component-shape.test.ts`). jsDelivr and unpkg URLs (pinned `@0.2.0`) in the README.
- **THIRD_PARTY_NOTICES.md:** generated from the esbuild metafile (81 packages: 78 MIT, 1 BSD-2-Clause, 1 BSD-3-Clause, 1 ISC; every one has license text), in `files`, committed.
- **Demo:** `packages/web-component/demo/index.html`: form with two editors (value attribute + required; child textarea), submit shows FormData, reset, page dark toggle via `dark-selector`, and a Tailwind preflight fixture section.
- **Tests:** `packages/web-component/test/element.test.ts`, 48 tests (definition, attribute/property sync, live theme/readonly/disabled, dark-selector, min-height, features rebuild, settings, host, upgrade props, value, events, inner change suppression, textarea/script init, fallback FormData/submit/disabled/reset/validity, fake-internals path for setFormValue/setValidity/reset/disabled/restore, labels and focus, disconnect/move/reconnect).
- **README:** install, bundler, CDN, attribute/property/event tables, forms, server-rendered (Rails/Django/Razor/script), htmx, labels, styling, frameworks, known limitations, license. CHANGELOG added.
- **M0 lines:** form/validity members, guarded style injection, preflight fixture, core list-style fix, shared-portal README note, 850 kB budget, dictionary folder-base URL: all applied.

## Files modified

- New: `packages/web-component/` (package.json, tsconfig.json, tsup.config.ts, scripts/build-standalone.mjs, src/{element,index,define,standalone,hooks,virtual.d}.ts, test/element.test.ts, demo/index.html, README.md, CHANGELOG.md, LICENSE.md, THIRD_PARTY_NOTICES.md), `test/packages/web-component-shape.test.ts`
- Shared, small hunks: root `package.json` (one line: `test:web-component`), `package-lock.json` (from `npm install`: the workspace link plus npm's own `peer`/`dev` flag churn)
- Core: `packages/core/src/styles/editor.css` (list markers), `packages/core/src/binding.ts` + `packages/core/test/binding.test.ts` (theme loop fix)

## Test status

- `npm run compile`: green
- `npm run lint`: 0 errors (1066 existing warnings)
- `npm run test:unit`: 118 files, 1564 passed
- `npm run test:edge`: 22 passed
- `npm run test:packages`: 38 passed (both shape files)
- `npm run test:web-component`: 48 passed
- `npm run typecheck -w packages/web-component`: green
- `npm run release:npm -- --only web-component`: dry run OK, 15 files, 804.5 kB packed, 2.68 MB unpacked
- Real browser (Chrome, demo served statically from the package folder): element defined, all three editors created, real `ElementInternals` path (no fallback input), FormData has both fields, `required` gives `valueMissing` and `:invalid`, reset restores, `dark-selector` flips all editors, label click focuses, disabled fieldset excludes the value and makes it read-only, KaTeX and Mermaid load from jsDelivr, preflight fixture keeps `disc` markers and heading sizes.

## Issues or blockers

1. **Core binding bug (fixed, `362ea88`):** with a class-based `darkSelector`, `bindMikeDownValue` froze the page in a real browser. Its subtree class observer called `handle.setTheme` on every class change; `setTheme` re-renders and dispatches a PM transaction, whose class writes woke the observer again (infinite microtask loop). jsdom never showed it. Now it applies only on a real change; explicit `setTheme` still always applies. This affects M7, M8 and M9 too (Angular legacy `.dark-theme` is exactly this case), so they should rebase onto it. This is a second core change beyond the list fix the prompt allowed; flagging for review.
2. **Core singleton (not fixed, documented):** `features.math: false` on one editor calls core's module-global `setMathRenderingEnabled(false)`, turning KaTeX off for every editor on the page. Added to the README's known limitations next to the shared-portal note; worth a `BACKLOG.md` line under the existing "Shared module singletons" entry.

## Notes for orchestrator

- **Departure from the decisions doc:** the accessible name follows ARIA precedence (`aria-labelledby`, then `aria-label`, then `internals.labels`); the doc says labels first. Native controls behave this way and an explicit author attribute should win. Easy to flip in `#accessibleName()` if Mike prefers the doc's order.
- The root `test:unit` does not run `packages/web-component/test` (it lists folders). CI therefore does not run the element tests yet; T2's `test:wrappers` (`npm run test --workspaces --if-present`) picks up the package's `test` script. I did not touch `ci.yml`.
- The package's `test` script is `vitest run --root ../.. packages/web-component/test` (uses the root config and its `@mikedown/core` alias).
- `npm run demo -w packages/web-component` builds and serves with Vite on port 5197; any static server on the package folder also works.
- README CDN URLs pin `@0.2.0`, which exists only after M15.
- Publish (Mike, after M15 sign-off): `npm run release:npm -- --only web-component --publish --otp <code>` (needs core published first).

## Review Materials

- Demo: `cd /Users/michaeljosephwork/git/mikedown && npm run demo -w packages/web-component`, then open `http://localhost:5197/demo/`. Type in both editors, Submit, Reset, clear Summary and Submit (validation), switch Page theme to Dark, scroll to the preflight fixture.
- README: `/Users/michaeljosephwork/git/mikedown/.claude/worktrees/agent-a8f6208e89b5de7bc/packages/web-component/README.md`
- Element: `/Users/michaeljosephwork/git/mikedown/.claude/worktrees/agent-a8f6208e89b5de7bc/packages/web-component/src/element.ts`
