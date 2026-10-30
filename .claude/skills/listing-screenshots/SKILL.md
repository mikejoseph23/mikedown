---
name: listing-screenshots
description: Refresh MikeDown's screenshots, i.e. the VS Code Marketplace listing images, the README images in assets/screenshots/ and the website copies in website/vscode/. Use when asked to update, retake, refresh or add Marketplace screenshots, listing images, README images or website screenshots, or after a release ships visible UI changes.
---

# Listing screenshots

`capture.sh` (next to this file) takes each shot in a throwaway VS Code instance and stages the images in `assets/screenshots/_new/` (gitignored). Nothing published changes until you promote them.

## How it works

- One fresh profile per shot in `/tmp/mdshots` (short paths: a long `--user-data-dir` overflows the socket path limit and VS Code exits silently). Settings are seeded per shot: theme (Default Light Modern / Default Dark Modern), no minimap, git and Copilot UI off, workspace trust off, `*.md` associated with `mikedown.editor`, `mikedown.ai.enabled` only for AI shots.
- This checkout of MikeDown and `stager/` are symlinked into `/tmp/mdshots-ext` as installed extensions. `--extensionDevelopmentPath` would put "[Extension Development Host]" in the title bar.
- `stager/` reads `/tmp/mdshots/shot.json` (written from `shots.json`): editor-group layout, which files open where (MikeDown or text editor), explorer on or off, then MikeDown commands (e.g. `mikedown.toggleSourceMode`). It writes `/tmp/mdshots/staged` when done and quits VS Code when the script touches `/tmp/mdshots/quit`.
- The window is set to 1200×955 pt with System Events and captured with `screencapture -l <id>` (the id comes from `winid.swift`), once with its shadow and once without (`-o`). Then:
  - README and Marketplace copy: `_new/<name>.jpg`, 1312×1068, white behind the shadow, sips quality 85.
  - Website copy: `_new/site/<name>.jpg`, 1198×953, window only, sips quality 70.
- Only the PID the script started is ever quit, gracefully first and with `kill -9` as a last resort. The `/tmp/mdshots*` profile dirs are removed after that instance has exited.

Needs a Retina display (2× capture) and Screen Recording plus Accessibility permission for the terminal.

## Procedure

1. `npm run compile`.
2. `.claude/skills/listing-screenshots/capture.sh --unattended`. If other sessions are driving VS Code windows by screen coordinates, keep clear of them with `MDSHOTS_POS=-2440,60` (the left display). Clicks meant for their window land on ours otherwise.
3. Interactive shots (Mike): `capture.sh --interactive`, or `--only slash-commands`. Each one stages, prints what to do, and captures when you press Enter (type `s` to skip). For `ai-rewrite`, either set up the local engine in the window, or pass `MDSHOTS_AI_SETTINGS=engines.json` (`mikedown.ai.engines` / `mikedown.ai.routing`, never keys).
4. **Review before promoting.** Open every image in `_new/` and `_new/site/`. Check the right theme, nothing personal on screen, no notifications or stray popovers, the text is readable (dark-theme highlights included), and the document is in the state described below.
5. Promote: `capture.sh --promote` (or `--promote a,b`). It copies `_new/*.jpg` into `assets/screenshots/`, and `_new/site/*.jpg` into `website/vscode/` for images the page already uses or that you name.
6. Update references (below), run `npx vitest run test/unit/site-shell.test.ts`, delete `_new/` and commit. The Marketplace only picks up new images with the next `.vsix`, because the listing renders the packaged README.

`capture.sh --list` shows every shot. `MDSHOTS_KEEP=1` leaves each window open until you press Enter, which helps when tuning a shot. Sample documents are in `assets/sample-docs/`. Everything in them is made up; keep it that way.

## Shots

| File | Theme | Doc | State | Alt text |
| --- | --- | --- | --- | --- |
| dark-mode-editor | dark | launch-plan.md | explorer open | A launch plan open in MikeDown in a dark theme: heading, a tip callout, a milestones table and a go/no-go task list, with the toolbar above and word count in the status bar. |
| light-mode-editor | light | launch-plan.md | explorer open | The same launch plan in a light theme. |
| source-mode | dark | launch-plan.md | `mikedown.toggleSourceMode` | The launch plan in source mode: raw markdown with line numbers and frontmatter, with the MikeDown toolbar still above it. |
| multi-doc-dark | dark | project-overview / capacity-model / release-notes | three groups (left, right top, right bottom) | Three markdown documents open at once in MikeDown across split editor groups: an architecture overview, a capacity model with a rendered formula, and release notes. |
| multi-doc-light | light | capacity-model / product-spec / meeting-notes | same layout | Three documents side by side in MikeDown in a light theme. |
| markdown-and-code | dark | product-spec.md + task-board.html | two groups, HTML in the text editor | A product spec in MikeDown on the left, with a task list and a highlighted code block, next to the HTML file it describes. |
| sidebar-dark | dark | engineering-handbook.md | `sidebar.visibility: always` | The engineering handbook with the document sidebar: outline, a backlink from the launch plan, tags and properties. |
| sidebar-light | light | engineering-handbook.md | same | The same sidebar in a light theme. |
| outline | light | project-overview.md | sidebar left, 240 px | The outline on the left of an architecture overview, each heading one click away. |
| toolbar-dropdown | dark | launch-plan.md | **you:** open the Insert dropdown (picture icon) | The Insert menu open on the MikeDown toolbar. |
| slash-commands | dark | launch-plan.md | **you:** new line, type `/ta` | The slash command menu filtered to Table and Task list as you type. |
| toolbar-edit-mode | light | launch-plan.md | **you:** gear > Customize Toolbar… | Customizing the toolbar in place: drag buttons to reorder, pin or hide them. |
| ai-rewrite | dark | launch-plan.md | **you:** select the intro, Cmd+Alt+K, Shorter, wait for the result | Experimental: an AI rewrite of the selected paragraph from a local model, with the time it took under the result. |
| ai-local-setup-dark | dark | launch-plan.md | **you:** LM Studio or oMLX running, click the sparkle button; don't click Use LM Studio | Experimental: one-click setup when a local AI server is already running. |
| ai-setup-wizard | light | launch-plan.md | **you:** sparkle button > Set up another way…, stop on the engine step | Experimental: the AI setup wizard offering the local LM Studio server or a cloud provider. |

The two setup shots run with AI off and no engines (a fresh profile's default): the sparkle button opens the first-run popover only while `mikedown.ai.enabled` is false; with it on, the button opens the AI menu instead.

The unattended shots are the first nine (no `prompt` in `shots.json`). To add or change a shot, edit `shots.json` (`layout` is the `vscode.setEditorLayout` argument; `group` is the 1-based group; `editor: "text"` opens the file in the text editor; `settings` are merged into the profile) and update this table.

## Updating references

- **README.md** uses `assets/screenshots/<name>.jpg` with alt text inline. For a new shot, add an image under the feature it shows (slash commands, toolbar customization, AI section), using the alt text above.
- **website/vscode/index.html** uses its own copies (`./<name>.jpg`) inside `<figure class="shot">`. Light/dark pairs use `<picture>` with a `prefers-color-scheme: light` `<source>`. Keep `width="1198" height="953"` on every `<img>` (multi-doc-dark used to be 1240×985; fix it when you promote), and update the alt text where the content changed (the hero still describes the old meeting notes). The site test checks that every `./*.jpg` the page references exists.
- `toolbar-dropdown.jpg` is README only, so its website copy is not promoted unless you name it.
