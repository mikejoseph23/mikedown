# Desktop auto-update: hands-on pass (T2)

Staged 2026-10-24. Nothing here touches iadev.net except where flagged. Run the macOS walk first, then Windows.

Release notes served by both staging servers (so the window has something to judge): a heading, a bulleted list with a **bold** word and `inline code`, a numbered list, and a link to `https://www.iadev.net/mikedown/`.

## macOS (Mac Studio)

Staged: N = 0.1.0 staging build (updater points at `http://127.0.0.1:18765`, never production), N+1 = 0.1.1 served locally.

- N app: `/Users/Shared/mikedown-staging/MikeDown.app` (Developer ID signed, not notarized, no quarantine flag).
- Server docroot: `/Users/michaeljosephwork/git/mikedown/packages/desktop/deploy/dist/staging/serve`
- Server log: `/Users/michaeljosephwork/git/mikedown/packages/desktop/deploy/dist/staging/http-handson.log`
- App log: `~/Library/Application Support/com.interappdev.mikedown/logs/updater.log`
- App state: `~/Library/Application Support/com.interappdev.mikedown/updater-state.json`

### 0. Start the server (account: michaeljosephwork)

It was left running in the background. Check:

```bash
curl -s http://127.0.0.1:18765/pertarget/latest-darwin-aarch64.json | head -3
```

Should print JSON with `"version": "0.1.1"`. If not (connection refused, e.g. after a reboot):

```bash
cd /Users/michaeljosephwork/git/mikedown/packages/desktop/deploy/dist/staging && nohup python3 -u -m http.server 18765 --bind 127.0.0.1 --directory serve > http-handson.log 2>&1 &
```

### 1. Install N into /Applications (account: macadmin)

`/Applications/MikeDown.app` already exists (a real 0.1.0 from earlier). This replaces it.

```bash
su - macadmin
osascript -e 'quit app "MikeDown"' 2>/dev/null
rm -rf /Applications/MikeDown.app
ditto /Users/Shared/mikedown-staging/MikeDown.app /Applications/MikeDown.app
exit
```

Expect: `/usr/libexec/PlistBuddy -c "Print :CFBundleShortVersionString" /Applications/MikeDown.app/Contents/Info.plist` prints `0.1.0`. Everything below is your normal non-admin account (`michaeljosephwork`).

### 2. Reset updater state (account: michaeljosephwork)

```bash
rm -f ~/Library/Application\ Support/com.interappdev.mikedown/updater-state.json
```

System Settings > Notifications: make sure MikeDown is allowed (alerts or banners) once it appears there.

### 3. Notification click (U2)

1. Launch `/Applications/MikeDown.app`. Immediately click another app (Finder, Terminal) so no MikeDown window is focused. The first silent check runs about 10 s after launch.
2. Expect: an OS notification "MikeDown 0.1.1 is available" (the in-app notice may also be there, bottom-right).
3. Do NOT click the notification yet. Wait a few seconds, then click the MikeDown Dock icon (or the notification). Expect: the update window opens ("a new version", within 10 minutes of the notification).
4. If it does not open: check `updater.log` and tell me; also try again after quitting and `rm`-ing the state file.

### 4. Window, light and dark

1. Title "A new version of MikeDown is available"; subtitle "MikeDown 0.1.1 is available. You have 0.1.0."; no major-update line (patch bump).
2. "What's new" shows the heading, bullets (bold word bold, inline code monospaced), the numbered list, the link. Clicking the link opens your browser, not the window.
3. Three buttons: Skip This Version (left), Remind Me Later, Install and Relaunch (primary, default).
4. Toggle the theme with the theme button; check the window in light and dark: text contrast, button states, scroll area, no stray white or black blocks.

### 5. Remind Me Later, then manual check

1. Click Remind Me Later. Quit and relaunch. Expect: no notice and no notification (snoozed).
2. Help > Check for Updates…. Expect: "Checking for updates…" then the window again (manual check clears the snooze).

### 6. Settings > App > Updates

Open Settings (gear) > App > Updates. Expect: "Automatically check for updates" toggle, "Last checked: <a moment ago>", Check Now. Toggle it off and on (stays set after reopening Settings). Click Check Now: the window shows again (or "up to date" if you already updated).

### 7. Failed state

1. Stop the server: `pkill -f "http.server 18765"`.
2. Help > Check for Updates…. Expect: "Couldn't reach the update server. Check your connection and try again." Nothing hangs; `updater.log` has one line.
3. Restart the server (command in step 0) and check again: window returns.

### 8. Hide during download, dirty file, install

1. Open any file in MikeDown, type something, leave it dirty.
2. In the update window click Install and Relaunch. Expect: progress bar "Downloading update… NN%", then "Verifying…". The download is a few MB over loopback so it may flash by; try clicking Hide right away. Expect: the window hides, the app keeps working, and Help > Check for Updates… brings it back (progress or "Update ready"). If it is too quick to catch, say so and skip.
3. Then the dirty-file dialog appears. Click Cancel. Expect: app stays open, window shows "Update ready. Install when you're ready." with the button enabled.
4. Click Install and Relaunch again. In the dirty-file dialog choose Save.
5. Expect: macOS asks for an admin name and password (`/Applications` is not writable by your account). Enter the `macadmin` credentials.
6. Expect: the app quits and relaunches by itself. Help > About shows 0.1.1.
7. Check `updater.log` ends with an install success line. Relaunch: no update offered.

If the admin prompt does not appear or the install fails, the window should show "The update couldn't be installed. Please try again, or download it from the MikeDown website." with a link. Note exactly what you saw.

### 9. Clean up

```bash
pkill -f "http.server 18765"
```

As `macadmin`, put the real 0.1.0 back if you want it: `ditto /Users/michaeljosephwork/git/mikedown/packages/desktop/deploy/dist/0.1.0/MikeDown.app /Applications/MikeDown.app`.

## Windows (DEVBOX1 over RDP)

Staged: N = 0.0.9 unsigned staging installer built from the current tree (updater points at `http://127.0.0.1:18765`). N+1 = the genuine Trusted-Signed 0.1.0 installer, served locally. Caveat: N+1 is the already released 0.1.0, which has no new update window, and once installed it will make normal read-only update checks against production iadev.net (nothing is written). Everything before the swap exercises the new window from N.

- Account: `michaeljoseph-work` (RDP into DEVBOX1, 192.168.50.42). No UAC prompt should appear at any point (per-user install).
- Bundle: `C:\temp\mikedown-u4\bundle` ; N installer `C:\temp\mikedown-u4\bundle\serve\MikeDown-0.0.9-windows-x64-setup.exe`
- Server log: `C:\temp\mikedown-u4\bundle\work\http-handson.log`
- App data and logs: `%APPDATA%\com.interappdev.mikedown` (`logs\updater.log`, `updater-state.json`). It currently holds an `updater-state.json` from an earlier harness run: delete it first.
- Install dir: `%LOCALAPPDATA%\MikeDown`

### 0. Start the server and install N

In PowerShell on DEVBOX1 (the server dies when the window closes; leave it open):

```powershell
Remove-Item "$env:APPDATA\com.interappdev.mikedown\updater-state.json" -ErrorAction SilentlyContinue
node C:\temp\mikedown-u4\bundle\staging-serve.js --dir C:\temp\mikedown-u4\bundle\serve --port 18765 --log C:\temp\mikedown-u4\bundle\work\http-handson.log
```

In a second PowerShell:

```powershell
curl.exe -s http://127.0.0.1:18765/pertarget/latest-windows-x86_64.json | Select-String '"version"'
& C:\temp\mikedown-u4\bundle\serve\MikeDown-0.0.9-windows-x64-setup.exe
```

Expect the first command to show `"version": "0.1.0"`. Run the installer wizard (per-user, no UAC), finish, then launch MikeDown from the Start menu. Help > About should show 0.0.9. (SmartScreen may warn about the unsigned staging installer: More info > Run anyway.)

### 1. Notification click (U2)

1. Launch MikeDown, then immediately click another app (Explorer, Notepad) so no MikeDown window is focused. First check runs about 10 s after launch.
2. Expect: a Windows toast "MikeDown 0.1.0 is available". Do not click it yet.
3. Click MikeDown in the taskbar (or the toast) within 10 minutes. Expect: the update window opens.

### 2. Window, light and dark

Same checks as macOS section 4, with "MikeDown 0.1.0 is available. You have 0.0.9." as the subtitle. Toggle the theme button; check both themes.

### 3. Skip This Version, Remind Me Later, manual check

1. Click Skip This Version. Quit and relaunch. Expect: no notice and no toast.
2. Help > Check for Updates…. Expect: the window is back (a manual check clears the skip).
3. Click Remind Me Later, relaunch: no notice. Help > Check for Updates… shows the window again.

### 4. Settings > App > Updates

Same as macOS section 6.

### 5. Failed state

Stop the server (Ctrl+C in its PowerShell window), then Help > Check for Updates…. Expect "Couldn't reach the update server. Check your connection and try again." Restart the server (command in step 0), check again: the window returns.

### 6. Hide during download, dirty file, install

1. Open a file, type, leave it dirty.
2. Install and Relaunch. Expect the progress bar then "Verifying…". Try Hide right away (the download is fast on loopback; skip if it is too quick), then bring the window back with Help > Check for Updates….
3. Dirty-file dialog: Cancel. Expect "Update ready. Install when you're ready." with the button enabled.
4. Install and Relaunch again, Save in the dirty-file dialog.
5. Expect: "Installing. MikeDown will reopen in a moment." The app closes and reopens on 0.1.0 within about 15 s, with no UAC prompt and no installer window left behind. Time it. If it closes and does not reopen, that is the `quiet` NSIS risk: tell me.
6. Help > About shows 0.1.0. `%APPDATA%\com.interappdev.mikedown\logs\updater.log` shows the install and relaunch.

### 7. Clean up

Ctrl+C the server. Uninstall via Settings > Apps > MikeDown, or `& "$env:LOCALAPPDATA\MikeDown\uninstall.exe"`.

## Report back

Pass/fail per numbered step, plus screenshots of anything that looks off in light or dark. Sign-off is yours; no publish happens until you say so.
