# Screenshot Capture Guide

Instructions for recreating the marketplace screenshots.

## Setup

1. Open the `mikedown` project in VS Code
2. Resize the VS Code window to **1280x800**:
   ```bash
   osascript -e '
   tell application "System Events"
       tell process "Code"
           tell window 1
               set position to {100, 100}
               set size to {1280, 800}
           end tell
       end tell
   end tell'
   ```
   (Requires the terminal app to have Accessibility permission in System Settings > Privacy & Security > Accessibility)
3. Open a markdown file with varied content in MikeDown — `assets/sample-docs/product-spec.md` works well

## Capture Method

For every screenshot: **Cmd+Shift+4**, then press **Space** to switch to window capture mode, then click the VS Code window. This captures the exact window bounds with a drop shadow.

## Post-processing

Captures come off a Retina display at ~2624×2136 — way too large for the marketplace listing. Resize to ~1312 wide and convert to JPG (q85) in one pass with `sips`:

```bash
sips -Z 1312 -s format jpeg -s formatOptions 85 input.png --out output.jpg
```

Target file size is roughly 150–300 KB per shot.

## Screenshots

Capture in this order:

| # | File | What to show |
|---|------|-------------|
| 1 | `dark-mode-editor.jpg` | Editor in dark theme, sidebar hidden (sidebar toggle in corner — the v2.4 layout-pane SVG, not a hamburger), WYSIWYG content visible. Status-bar word/char/read-time items showing. |
| 2 | `light-mode-editor.jpg` | Same content, toggle to light theme via MikeDown theme toggle. |
| 3 | `source-mode.jpg` | Press `Cmd+/` to switch to raw markdown source mode. |
| 4 | `toolbar-dropdown.jpg` | Switch back to WYSIWYG (`Cmd+/`), click a toolbar dropdown menu (Format / Insert / Export) so it's open. |
| 5 | `multi-doc-dark.jpg` | Multiple markdown files open side by side in MikeDown (split with `Cmd+\`), dark theme. |
| 6 | `multi-doc-light.jpg` | Same idea, light theme. |
| 7 | `markdown-and-code.jpg` | Markdown in MikeDown on one side, a code file (e.g. `assets/sample-docs/task-board.html`) on the other. |
| 8 | `sidebar-dark.jpg` | Sidebar fully open — **pin button in the ON state** (filled blue pill background, upright icon), position-toggle arrow next to the pin, all three sections expanded (Properties + Outline + Backlinks with content), two-row footer at the bottom (`Modified … ago` / `N words · N chars · N min read`). Status-bar items at the bottom-right visible. Pick a doc with frontmatter so Properties has content — `assets/sample-docs/engineering-handbook.md` or `product-spec.md` both work. |
| 9 | `sidebar-light.jpg` | Same as #8 in light theme. |

## Notes

- Keep the same window size (1280×800) for all screenshots so they look consistent on the listing
- Sample content lives in `assets/sample-docs/` — `engineering-handbook.md` and `product-spec.md` both have frontmatter (good for the sidebar shots); `task-board.html` works as the code file in the markdown-and-code split
- Screenshots are bundled into the `.vsix` — to update the marketplace listing you must repackage and republish, pushing to git alone is not enough
