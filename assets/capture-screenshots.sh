#!/bin/bash
# Screenshot Capture Script for MikeDown Editor
#
# This script launches VS Code with the extension in development mode,
# opens sample markdown files, and uses screencapture (macOS) to grab screenshots.
#
# Prerequisites:
#   - npm run compile (extension must be built)
#   - The sample docs in assets/sample-docs/
#
# Usage:
#   cd /Users/michaeljosephwork/git/markdown-WYSIWYG-vscode-extension
#   bash assets/capture-screenshots.sh
#
# Note: This launches a real VS Code window. You'll need to manually:
#   1. Wait for the extension to load
#   2. Arrange the windows as needed
#   3. Use Cmd+Shift+4 (macOS) or run the screencapture commands below
#
# For automated screenshots, consider using the Playwright script instead:
#   node assets/playwright-screenshots.mjs

set -e

PROJ_DIR="$(cd "$(dirname "$0")/.." && pwd)"
SAMPLE_DIR="$PROJ_DIR/assets/sample-docs"
SCREENSHOT_DIR="$PROJ_DIR/assets/screenshots"

echo "Building extension..."
cd "$PROJ_DIR"
npm run compile

echo ""
echo "Launching VS Code with sample docs..."
echo "The extension development host will open with the sample files."
echo ""
echo "Once the window is open and the extension has loaded:"
echo "  1. Open project-overview.md (should open in MikeDown WYSIWYG mode)"
echo "  2. Take screenshots with Cmd+Shift+4 or use these commands:"
echo ""
echo "  # Dark mode - full editor"
echo "  screencapture -w $SCREENSHOT_DIR/dark-editor.png"
echo ""
echo "  # Light mode - toggle theme first, then capture"
echo "  screencapture -w $SCREENSHOT_DIR/light-editor.png"
echo ""
echo "  # Split view - open two files side by side"
echo "  screencapture -w $SCREENSHOT_DIR/split-view.png"
echo ""
echo "  # Dropdown menu - click Aa dropdown, then capture"
echo "  screencapture -w $SCREENSHOT_DIR/dropdown-menu.png"
echo ""
echo "  # Source mode - toggle with Cmd+/, then capture"
echo "  screencapture -w $SCREENSHOT_DIR/source-mode.png"
echo ""

code --extensionDevelopmentPath="$PROJ_DIR" "$SAMPLE_DIR"
