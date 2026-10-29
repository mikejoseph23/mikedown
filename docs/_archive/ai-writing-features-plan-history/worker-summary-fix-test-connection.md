# Worker summary: fix greyed Test connection

Status: Completed
Start 22:20, end 22:37

## Work completed
- Cause found: not state. In jsdom and in the real harness the button is enabled, un-aria-disabled and focused after a test. The screenshot pixels match the VS Code shell with the editor theme forced to light: muted text is exactly #717171 (the forced-light `--vscode-descriptionForeground` override) while the button text is #cccccc, the dark theme's secondary button foreground. `src/webview/vscode-theme.css` forced light/dark blocks override the VS Code vars but not the `--vscode-button-secondary*` / `--vscode-button-border` ones, so a dark VS Code theme gave pale text on a light page (and the reverse).
- Fix: forced light sets secondary bg #e5e5e5, fg #3b3b3b, hover #cccccc; forced dark sets #3a3d41, #ffffff, #45494e; both set `--vscode-button-border: transparent`. Affects every `settings-btn--secondary`, not only Test connection.
- Tests: regression in `packages/core/test/ai-settings.test.ts` (Test connection enabled, not aria-disabled, focused after a test; passes before and after, rules out the state leads); `test/unit/vscodeThemeForced.test.ts` (forced blocks define the secondary button vars).
- Not verified in a real VS Code dev host (inferred from pixel colours); Mike should confirm with editorTheme forced to light on a dark VS Code theme.

## Files modified
- src/webview/vscode-theme.css
- test/unit/vscodeThemeForced.test.ts (new)
- packages/core/test/ai-settings.test.ts

## Test status
- npm run lint: 0 errors (1218 existing warnings)
- npm run build:core: ok
- npm run test:unit: 161 files, 2796 passed, 2 todo

## Issues
- `packages/core/src/ai-rewrite.ts` has an uncommitted change that is not mine; left alone.
- The `.ai-form-actions` opacity 0.55 rule was not the cause.

## Notes for orchestrator
- Desktop uses core tokens.css and was not changed.

Review Materials: none
