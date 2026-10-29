# MikeDown Documentation

Archived planning documents for shipped features.

- [List Hotkeys](list-hotkeys.md) — keyboard shortcuts for list toggles and the sidebar, plus the Hotkeys settings tab (GitHub issue #3, shipped in 2.10.2)
- [Wikilink Support](wikilink-support.md) — `[[wikilink]]` parsing, navigation, and autocomplete (shipped in 2.9.0)
- [Slash Commands](slash-commands-planning.md) — the `/` command popup, its actions and settings
- [Customizable Toolbar](customizable-toolbar-plan.md) — toolbar registry, `mikedown.toolbarLayout`, in-place edit mode
- [AI Writing Features](ai-writing-features-plan.md) — rewrite family, Explain, Translate, thinking dial, `/summary`, `/title`, Properties Suggest

## Architecture decisions

- [Core Extraction Decisions](core-extraction-decisions.md) — why and how the editor became `@mikedown/core`
- [Wrappers and npm Decisions](wrappers-decisions.md) — package layout, lockstep versioning, wrapper design

## npm packages and Desktop

- [Wrappers and npm Plan](wrappers-npm-plan.md) — the `@mikedown/*` family, release tooling, website developers hub (T1 hands-on left for Mike)
- [MikeDown Desktop Plan](desktop-app-plan.md) — the Tauri app (T4 release-candidate hands-on left for Mike)
- [Desktop Auto-Update Plan](desktop-auto-update-plan.md) — updater engine, manifests, release pipeline, runbooks

## Development

- [Installation Instructions](installation-instructions.md) — dogfooding the dev build in VS Code
