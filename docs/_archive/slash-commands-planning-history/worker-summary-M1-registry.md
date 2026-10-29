# Worker Summary: M1 Command Registry + Matcher

**Status:** Completed

**Worktree:** `/Users/michaeljosephwork/git/mikedown/.claude/worktrees/agent-a847772eaa9ce9870`
**Branch:** `worktree-agent-a847772eaa9ce9870`
**Commit:** `6a1d943` — "Add slash command registry and matcher"

## Worktree trap note

Worktree HEAD was `e4d26d0` ("Release 2.10.4"), which does not contain `3fe9317`
in its ancestry (they're on different history). Tree was clean, so per the
worker prompt I ran `git reset --hard 3fe9317` before starting. All work is on
top of `3fe9317`.

## Work completed (all checkboxes)

- [x] Created `src/webview/slashcommands-registry.ts` — no DOM, no TipTap, no `vscode` imports.
- [x] Defined `SlashCommand { id, title, description, aliases, group, icon, keywords?, requiresNoFrontmatter? }`. No action field — M3/M6 own the id-to-action mapping.
- [x] Added all 27 commands from the Design Decisions command table: H1-H6, Paragraph, Quote, Bullet, Numbered, Task, Code, Mermaid, Table, Divider, all 5 callouts, Link, Wikilink, Image, Emoji, Properties (`requiresNoFrontmatter: true`), Date, Date and time.
- [x] `matchCommands(query, ctx, commands = SLASH_COMMANDS)`: tiers are exact (name or alias) then name-prefix then alias-prefix then (implicit) registry order within each tier. Empty query returns all available commands in registry order. `requiresNoFrontmatter` commands are filtered out when `ctx.hasFrontmatter` is true, before any matching.
- [x] `extractSlashQuery(textBefore, atBlockStart)`: scans back from the cursor for the longest trailing non-whitespace run; requires that run to start with `/`; if the `/` lands at index 0 of `textBefore`, requires `atBlockStart` to be true (otherwise there's no whitespace-or-start guarantee, so it declines to trigger). Returns `{ offset, query }` or `null`.
- [x] Exported `MERMAID_STARTER_DIAGRAM`, a 3-node `flowchart TD`.
- [x] `npm run compile` succeeds (webpack, both bundles unaffected -- new file isn't imported yet by design, per M1 scope).
- [x] Committed.

## Lint note (pre-existing repo issue, not introduced here)

`npm run lint` currently fails across the **entire** `src/webview/` directory
(247 errors before my change), because ESLint's `parserOptions.project` points
at `tsconfig.json`, which explicitly `exclude`s `src/webview`. I verified this
is pre-existing by lint-checking an untouched file (`callout-node.ts`) -- same
"TSConfig does not include this file" parsing error. My new file hits the
identical parsing error and nothing else; it is not adding any new lint
findings. I did not touch `.eslintrc`/tsconfig to fix this repo-wide
configuration mismatch since it's out of M1's scope (flagging for the
orchestrator/Mike -- likely worth its own small ticket).

Verified instead with `npx tsc -p tsconfig.webview.json --noEmit`: zero errors
attributable to `slashcommands-registry.ts` (the many errors that command
prints are all pre-existing, in `editor-main.ts` and other existing files).

## Test status

- `npm run compile` -- pass (both bundles built successfully).
- `npm run test:unit` -- pass, 35 files / 423 tests, no regressions.
- `npm run lint` -- pre-existing repo-wide failure unrelated to this file (see above); my file adds zero new distinct findings beyond the same pre-existing config parsing error every `src/webview/*.ts` file already has.
- Manual sanity check: compiled the new module standalone with `tsc` to plain JS and ran roughly 25 assertions in Node covering every alias in the Design Decisions table, the `/date` vs `/datetime` exact-vs-prefix ranking, `/h` ordering H1-H6, empty-query count with/without frontmatter, unknown query, case-insensitivity, frontmatter exclusion, and `extractSlashQuery` edge cases (`and/or`, `path/to`, a URL, block-start, after space/tab, trailing whitespace, empty string). All passed. This scratch script was not committed (throwaway; it lived only under /tmp and has been removed).

## Files modified

- `/Users/michaeljosephwork/git/mikedown/.claude/worktrees/agent-a847772eaa9ce9870/src/webview/slashcommands-registry.ts` (new, 349 lines)

## Issues/blockers

None blocking. See lint note above -- flagged, not fixed (out of scope, pre-existing, affects every webview file equally).

## Notes for orchestrator

- Registry order doubles as "group order": headings/paragraph/quote/divider -> basic; bullet/numbered/todo -> lists; the 5 callouts -> callouts; everything else (code, mermaid, table, link, wikilink, image, emoji, properties, date, datetime) -> insert. M2 can group directly off this order if it wants section headers in table order.
- `id` values chosen to match the "Name" column in the plan's table exactly (e.g. `h1`, `todo`, `warning`, `datetime`) so aliases are genuinely additional strings, not duplicates.
- `icon` values are placeholder keys (e.g. `heading-1`, `checklist`, `type-hierarchy` for mermaid, `settings-gear` for properties) -- M2 owns mapping these to the real toolbar icon set (`icons.*` in `editor-main.ts`); I did not cross-reference that set since M1 has no DOM/UI dependency.
- `extractSlashQuery`'s `atBlockStart` parameter: I interpreted it as "does index 0 of `textBefore` truly represent the start of the textblock" (vs. an arbitrary truncation point), since if `textBefore` is always the full block-prefix this parameter would be redundant. M2's plugin should pass `$from.parentOffset === 0` (or equivalent) as `atBlockStart` when building `textBefore` from `$from.parent.textBetween(0, $from.parentOffset, ...)`.
- `keywords?` field is defined per the spec but intentionally unused by `matchCommands` (spec only mentions id/alias in the ranking rule) -- left as an extension point.

**Review Materials:** `/Users/michaeljosephwork/git/mikedown/.claude/worktrees/agent-a847772eaa9ce9870/src/webview/slashcommands-registry.ts`

**Start time:** 2026-09-26 00:31
**End time:** 2026-09-26 00:41
