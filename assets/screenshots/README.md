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

Capture in this order:

| # | File | What to show |
|---|------|-------------|
| 1 | `dark-mode-editor.png` | Editor in dark theme, sidebar hidden (`Cmd+B`), WYSIWYG content visible |
| 2 | `light-mode-editor.png` | Same content, toggle to light theme via MikeDown theme toggle |
| 3 | `source-mode.png` | Press `Cmd+/` to switch to raw markdown source mode |
| 4 | `dropdown-menu.png` | Switch back to WYSIWYG (`Cmd+/`), click a toolbar dropdown menu (Format/Insert/Export) so it's open |
| 5 | `split-view-mark-down.png` | Two markdown files open side by side in MikeDown (split with `Cmd+\`) |
| 6 | `split-view-code.png` | Markdown in MikeDown on one side, a code file (e.g. `assets/sample-docs/task-board.html`) on the other |
| 7 | `context-menu.png` | Right-click on a link in the editor to show the context menu |

## Notes

- Keep the same window size for all screenshots so they look consistent on the listing
- Sample content lives in `assets/sample-docs/` — use `product-spec.md` for most shots and `task-board.html` as the code file in split view
- Screenshots are bundled into the `.vsix` — to update the marketplace listing you must repackage and republish, pushing to git alone is not enough
