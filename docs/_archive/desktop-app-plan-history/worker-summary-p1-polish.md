# Worker summary: P1 desktop polish

**Status:** Done. Commit `4c16627` on `worktree-agent-a38223bb2831aed93` (worktree `/Users/michaeljosephwork/git/mikedown/.claude/worktrees/agent-a38223bb2831aed93`), on top of `c2ec484` (the worktree started at `b18d23c`; tree was clean, so it was reset as instructed). Not pushed. This summary is in the scratchpad because the sandbox blocked writing to the shared `.orchestrator/` path.

Start 17:54, end about 18:05 (2026-10-23).

## Work per checkbox

- [x] **Content width cap.** New `DESKTOP_CORE_SETTING_DEFAULTS` in `packages/desktop/src/settings/desktopSettings.ts` (`contentWidth: '900px'`, the core select's "Wide (900px)", plus the existing `spellCheckEnabled: true`), passed as `settings` in `main.ts`. Core's `margin: 0 auto` centers it. Picking Full Width in Settings applies (e2e checks this). Core and VS Code are unchanged.
- [x] **Open Containing Folder button.** New `.mdapp-btn--toolbar` class in `app.css`: filled with `--mikedown-button-bg/-hover/-text`, `--mikedown-focus-ring` focus-visible outline, a folder SVG icon (aria-hidden), and an `aria-label` on the button. It is a native `<button>`, so it takes keyboard focus. Stub behavior unchanged.
- [x] **Visual check.** Done with Playwright against the vite dev page (the same frontend, Tauri IPC mocked) at 1600 px wide, light and dark. The native Tauri window was **not** launched, so WKWebView rendering was not checked. Nothing was sent with osascript, and the OS appearance was not changed.
- [x] **Tests.** `test:unit` 83/83, `test:e2e` 4/4 (adds `test/e2e/layout.spec.ts`), `typecheck` clean. Root lint: 0 errors.

## Files

- `packages/desktop/src/settings/desktopSettings.ts`
- `packages/desktop/src/main.ts`
- `packages/desktop/src/ui/chrome.ts`
- `packages/desktop/src/styles/app.css`
- `packages/desktop/test/unit/desktopSettings.test.ts`
- `packages/desktop/test/e2e/layout.spec.ts` (new; `P1_SHOTS=<dir>` also saves screenshots)

## Issues

- `app.css` already used two tokens that don't exist in core, `--mikedown-surface-secondary` and `--mikedown-surface-hover`. They fall back silently. I left them as they are because they're out of scope.

## Review Materials

- /Users/michaeljosephwork/git/mikedown/.orchestrator/desktop-app-plan/artifacts/p1-polish/p1-light.png
- /Users/michaeljosephwork/git/mikedown/.orchestrator/desktop-app-plan/artifacts/p1-polish/p1-dark.png
- /Users/michaeljosephwork/git/mikedown/.orchestrator/desktop-app-plan/artifacts/p1-polish/p1-light-tabstrip.png
- /Users/michaeljosephwork/git/mikedown/.orchestrator/desktop-app-plan/artifacts/p1-polish/p1-dark-tabstrip.png
