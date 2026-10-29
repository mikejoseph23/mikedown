# Worker Summary: T2 Release verification (automated half)

**Status:** Completed. Start about 00:55 EDT, end 01:03 EDT (2026-10-24). No commits, nothing pushed or published.

## Harness tallies (HEAD contains 872da72)

- macOS `updater-staging-test.sh --headless` (fresh builds): **20 PASS, 0 FAIL, 1 SKIP** (the SKIP is the non-admin `/Applications` install, a hands-on step).
- Windows `updater-staging-test-windows.sh` (BEAST build, DEVBOX1 run): **23 PASS, 0 FAIL, 2 SKIP** (the two macOS-only cases).

## Staged

- **Mac N** (0.1.0 staging build, endpoints at `http://127.0.0.1:18765`): `/Users/Shared/mikedown-staging/MikeDown.app` (signed, no quarantine, ready for `macadmin` to `ditto` into `/Applications`).
- **Mac N+1** (0.1.1): served from `/Users/michaeljosephwork/git/mikedown/packages/desktop/deploy/dist/staging/serve` on `http://127.0.0.1:18765`. Release notes in the per-target and `latest.json` manifests were replaced with a heading, bullets with a bold word and inline code, a numbered list and a link. Server is running in the background now (python, log `.../dist/staging/http-handson.log`); it will not survive a reboot.
- **Windows N** (0.0.9 unsigned staging installer, from the current tree): `C:\temp\mikedown-u4\bundle\serve\MikeDown-0.0.9-windows-x64-setup.exe` on DEVBOX1. **N+1** is the genuine Trusted-Signed 0.1.0 installer in the same folder, notes patched the same way. The Windows server is NOT running (it dies when the SSH session ends); Mike starts it in step 0 of the checklist.
- DEVBOX1 currently has MikeDown uninstalled; `%APPDATA%\com.interappdev.mikedown\updater-state.json` is a leftover from harness runs and the checklist deletes it.

## Issues

- Windows build on BEAST first failed: `C:\git\mikedown\node_modules` lacked `@tauri-apps/plugin-notification` (added by U2). I extracted the 2.7.0 package from `npm pack` into that folder by hand (`npm install` there errors with an `edgesOut` crash). BEAST's checkout node_modules is now ahead of its lockfile state; a proper `npm ci` there would be cleaner.
- Windows N+1 is the released 0.1.0, which lacks the new window and, once installed, will do its normal read-only update check against production iadev.net. Noted in the checklist.
- `/Applications/MikeDown.app` on the Mac already holds a real 0.1.0; the checklist replaces it and says how to restore it.
- Notification-click and Hide-during-download are the least certain steps (loopback download is near instant). The checklist says what to report.

## Review Materials

- Hands-on checklist: `/Users/michaeljosephwork/git/mikedown/desktop-auto-update-handson.md` (uncommitted)
- Mac server restart:
  `cd /Users/michaeljosephwork/git/mikedown/packages/desktop/deploy/dist/staging && nohup python3 -u -m http.server 18765 --bind 127.0.0.1 --directory serve > http-handson.log 2>&1 &`
- Windows server (PowerShell on DEVBOX1):
  `node C:\temp\mikedown-u4\bundle\staging-serve.js --dir C:\temp\mikedown-u4\bundle\serve --port 18765 --log C:\temp\mikedown-u4\bundle\work\http-handson.log`
- Windows N install: run `C:\temp\mikedown-u4\bundle\serve\MikeDown-0.0.9-windows-x64-setup.exe`.
