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

## Screenshots

Files are saved as `.jpg` (smaller bundle size for the marketplace listing); use Preview's Export-As to convert PNG captures.

Capture in this order:

| # | File | What to show |
|---|------|-------------|
| 1 | `dark-mode-editor.jpg` | Editor in dark theme, sidebar hidden (sidebar toggle in corner), WYSIWYG content visible |
| 2 | `light-mode-editor.jpg` | Same content, toggle to light theme via MikeDown theme toggle |
| 3 | `source-mode.jpg` | Press `Cmd+/` to switch to raw markdown source mode |
| 4 | `dropdown-menu.jpg` | Switch back to WYSIWYG (`Cmd+/`), click a toolbar dropdown menu (Format/Insert/Export) so it's open |
| 5 | `split-view-mark-down.jpg` | Two markdown files open side by side in MikeDown (split with `Cmd+\`) |
| 6 | `split-view-code.jpg` | Markdown in MikeDown on one side, a code file (e.g. `assets/sample-docs/task-board.html`) on the other |
| 7 | `context-menu.jpg` | Right-click on a link in the editor to show the context menu |
| 8 | `outline-feature-dark.jpg` | Sidebar fully open on the right side — pin button visible in the **on** state (filled blue pill), position-toggle arrow next to it, all three sections expanded (Properties + Outline + Backlinks), and the two-row footer at the bottom (`Modified … ago` / `N words · N chars · N min read`). Also visible: the four status-bar items at bottom-right (words / chars / read time, plus selection if you have text selected). Pick a doc with frontmatter so Properties has content — `assets/sample-docs/product-spec.md` works. |

## Notes

- Keep the same window size for all screenshots so they look consistent on the listing
- Sample content lives in `assets/sample-docs/` — use `product-spec.md` for most shots and `task-board.html` as the code file in split view
- Screenshots are bundled into the `.vsix` — to update the marketplace listing you must repackage and republish, pushing to git alone is not enough
