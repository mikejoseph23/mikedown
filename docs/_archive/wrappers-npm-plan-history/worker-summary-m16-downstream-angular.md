# M16 worker summary: downstream onto @mikedown/angular

**Status:** Completed. **Date:** 2026-10-24.

## Work completed

1. LymeStarter (`develop`): optional `mikedown/` folder now holds only `_mikedown-theme.scss`, new `_mikedown-field.scss` (maps `--mikedown-field-*` onto the `--ls-*` input tokens), the demo and README. Vendored component, host, spec, template and index deleted. Demo imports `@mikedown/angular` and uses `<mikedown-editor darkSelector="html[data-mode=dark]" [settings]>` with the Roboto stack. Installed `@mikedown/angular@^0.2.0`, `@mikedown/core@^0.2.0` (`mermaid` was already a dependency). `lymestack-ownership.json` optional folder gained `@mikedown/angular` in `dependencies`.
2. Quantico assistant app: `shared/mikedown/` keeps `_mikedown-theme.scss` (the `--ls-*` shim replaced by `--mikedown-field-*` mapping) and README; `lead-panel` uses `<mikedown-editor>` from the package with the Roboto `settings` and `ariaLabelledBy`. Core to `^0.2.0`.
3. Legacy Angular 14 app: one-line comment atop its vendored wrapper. Quantico `CLAUDE.md` MikeDown line updated.
4. LymeStarter `docs/architecture.md` optional-component section updated (package, registry deps, stale TODO removed). Optional folder README rewritten for the package.

## Commits

- LymeStarter `develop`: 7f85ca3
- Quantico `master`: d9b7cb6 (assistant app), b027710 (legacy comment)

## Tests

- LymeStarter `ng build`: green (only CommonJS/selector warnings, no budget errors). `ng test --watch=false --browsers=ChromeHeadless`: 549 of 549 pass.
- Quantico assistant `ng build`: green, no budget errors. `ng test`: 36 of 36 pass.
- Adopt: `lymetools adopt` (repo build, arm64 dotnet) into a scratch app: success, 6 files, next-step dependency list now includes `@mikedown/angular`. lymetools `Adopt|Optional` tests: 16 of 16 pass.
- Strip: `lymetools scaffold app` of the new commit produces an app with no `lymestack-optional` folder and no mikedown lines in `package.json` or `styles.scss`.

## Issues / notes for orchestrator

- `lymetools scaffold app` reports an unrelated error on `HEAD~1` and `HEAD` alike: `app.routes.ts has no 'about' route` (template-changed); the strip steps ran before it. Not caused by M16.
- The installed `~/.dotnet/tools/lymetools` predates `adopt`; used the repo build. The x64 dotnet under Rosetta refuses to spawn git; use `/usr/local/share/dotnet/dotnet`.
- Visual check of the editor frame/dark mode in a browser was not done; build and unit tests only.
- Untracked `docs/package-lock.json` and `e2e/package-lock.json` in LymeStarter left alone. Nothing pushed.

## Review Materials

None required. Optionally eyeball `/dev/markdown-editor` in LymeStarter (frame border, focus ring, dark mode).
