# OS webview notes (M0 smoke test)

How `@mikedown/core` behaves inside the two OS webviews Tauri uses, compared
with the jsdom reference (`test/unit/smoke.expected.md`, the same code path the
VS Code bundle runs). Method: `src/smoke/harness.ts` inside the real window
(`VITE_MIKEDOWN_SMOKE=1`, report via the Rust `smoke_report` command), then
`scripts/smoke-compare.mjs`, plus screenshots and the manual checklist at the
end. See the README's "smoke fixture and harness" section for the commands.

Legend: PASS / FAIL from the harness, MANUAL = needs a human at the GUI,
PENDING = not run yet (why, and the exact steps).

## WKWebView, macOS (2026-10-23)

- Machine: Mac Studio (arm64), macOS 26.6.2. The dev build ran under Rosetta
  because the Homebrew Rust at `/usr/local` is the x86_64 build (see
  "Toolchain" below); WebKit itself is the system framework either way.
- Reported by the harness: `webview_version` 21624.5.1.11.3 (WebKit 621 /
  Safari 26), Tauri 2.12.5, UA `Mozilla/5.0 (Macintosh; Intel Mac OS X
  10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko)` (no Safari/Version token,
  the usual WKWebView UA), `devicePixelRatio` 2, window inner size 1200×768
  (the 800 px window minus the 32 px title bar).

### Round-trip

| Check | Result |
| --- | --- |
| `initialMarkdown` → `getMarkdown()` equals `setMarkdown(fixture)` → `getMarkdown()` | PASS (deterministic) |
| Second pass through `setMarkdown(getMarkdown())` unchanged | PASS (idempotent) |
| Output identical to the jsdom reference (`smoke.expected.md`) | PASS, byte-identical |

So the serializer differences that exist (hard break `\` dropped, task list
items spaced out as a loose list, bare fence becomes `plaintext`) are core
behavior, identical in VS Code, not webview artifacts.

### Rendering

| Block | Result |
| --- | --- |
| Table (with alignment row) | PASS, 1 table |
| Task list incl. nested | PASS, 3 items |
| Callouts `[!NOTE]` / `[!WARNING]` | PASS, 2, kinds kept (screenshot) |
| Highlight `==…==` | PASS |
| Code fences (`ts`, bare, mermaid source) | PASS, 3 `<pre>` |
| Footnote ref | PASS |
| Image element | PASS (element; the fixture path is relative, so it shows the missing-image state until M2 resolves `images/` through the host) |
| KaTeX inline + display | PASS, 2 `.katex` |
| Mermaid SVG | PASS, 1 svg, rendered within the 10 s wait |

### Editing and UI

| Check | Result | Notes |
| --- | --- | --- |
| `focus()` → `activeElement` is `.ProseMirror`, selection inside it | PASS | |
| `document.hasFocus()` | FAIL as expected | The window was not frontmost while the harness ran; true once the window is activated |
| `contenteditable="true"` on the PM root | PASS | |
| `spellcheck="false"` on `<body>` | PASS | No double underlines; core's Hunspell squiggles only |
| Typing via TipTap + `toggleBold` | PASS | `**bold**` in markdown |
| Insert 2×2 table | PASS | 4 → 7 table lines |
| `/date` slash command | PASS (real keystrokes) | `insertContent('/date')` does not trigger the suggestion matcher (same in jsdom), so the harness reports MANUAL; typed through `osascript keystroke "/date"` + Enter the menu opened and `2026-10-23` was inserted (`slash-menu.png`, `typed.png`) |
| Typing a sentence with real keystrokes (`Teh quick brown fox typed by osascript.`) | PASS | Text landed once, caret stayed put; core's spell checker underlined `Teh` and `osascript` with a single squiggle (no native WebKit underline underneath) |
| `openSettings` → `isModalOpen()` | PASS | |
| Escape closes the modal | PASS | |
| `toggleSource` shows CodeMirror, markdown unchanged | PASS | |
| `toggleSource` back to rich text, markdown unchanged | PASS | |
| Paste plain text (synthetic `ClipboardEvent` with `DataTransfer`) | PASS | WebKit lets a page construct `DataTransfer` + `ClipboardEvent`; PM's paste handler consumed it (`defaultPrevented=true`) and both lines landed |
| `navigator.clipboard` read/write/readText/writeText, `ClipboardItem` | present | All functions exist; actual reads need user activation, see manual list |
| Cmd+wheel zoom | PASS | `--mikedown-font-size` unset → 21px after three synthetic wheel-ups (`metaKey`+`ctrlKey`); core listens on `window`, works in WKWebView |
| `setTheme('dark'/'light')` swaps tokens | PASS | surface `#1f1f21` / `#ffffff` |
| `theme: 'auto'` follows the OS appearance | PASS | Flipped with `osascript … set dark mode to true` while the window was open; screenshots `light.png` / `dark.png` show the editor recolored with no reload |
| Scrollbars | overlay (width 0) | macOS overlay scrollbars; nothing to style |
| `CompositionEvent`, `InputEvent.getTargetRanges` (beforeinput) | present | ProseMirror uses beforeinput on WebKit; IME itself is manual |

### WebKit-specific differences found

None functional. Cosmetic / environmental only:

1. UA string lacks a `Version/x Safari/x` token; anything that sniffs for
   Safari would miss. Core does not sniff (it feature-tests), so no change.
2. Overlay scrollbars: the content column shows no gutter, so the editor's
   right padding is the only inset. Looks fine; VS Code shows a scrollbar
   gutter instead. No action.
3. `document.hasFocus()` is false until the window is activated (normal for
   every webview); core's focus logic uses `activeElement`, not `hasFocus()`.

### Manual checklist (macOS)

Run `npm run dev:desktop`, click into the editor, then:

- [ ] Type `/date` then Enter: today's date is inserted (ISO by default).
- [ ] Type a sentence with a deliberate misspelling: red squiggle appears once
      (core's), not twice (no native WebKit underline).
- [ ] IME: switch to a Japanese or Chinese input source, type `nihongo`, pick a
      candidate, confirm: text lands once, no duplicated or dropped characters,
      no selection jump. Also check a dead-key accent (Option+e, then e).
- [ ] Cmd+V with real clipboard content from another app (plain text, rich
      text from a browser, an image): plain text pastes as paragraphs, rich
      text converts to markdown, an image is refused with the core notice
      (no `uploadImage` host in M0).
- [ ] Cmd+C in the editor, Cmd+V in another app: markdown-ish rich text arrives.
- [ ] Cmd+wheel / trackpad pinch: zoom steps feel like the VS Code extension.
- [ ] System Settings → Appearance → Dark: the window recolors without reload
      (scripted equivalent already passed).
- [ ] Right-click: core's context menu, not the WebKit default (M2 confirms once
      the native menu exists).

## WebView2, Windows (2026-10-23, harness over SSH; GUI checklist pending)

- Machine: BEAST (192.168.50.39), Windows 11 Pro, WebView2 runtime
  155.0.4283.62 (Edge/Chromium 155), rustup-installed Rust 1.99.1
  (`stable-x86_64-pc-windows-msvc`, installed for this test with
  `winget install Rustlang.Rustup`), Visual Studio 18 Community C++ tools,
  Node 22.20.0. Repo copy at `C:\git\mikedown` (tarball of this branch, not a
  git clone).
- Build: `npm run build -w packages/desktop` with `VITE_MIKEDOWN_SMOKE=1`,
  release profile, 2 min 11 s for Rust plus 7.3 s for Vite. Bundles:
  `MikeDown_0.1.0_x64_en-US.msi` 5.75 MiB, `MikeDown_0.1.0_x64-setup.exe`
  (NSIS) 4.93 MiB, `mikedown-desktop.exe` 9.25 MB. Tauri downloaded WiX and
  NSIS on first use.
- Run: the release exe launched over SSH (session 0, no visible desktop) with
  `MIKEDOWN_SMOKE_DIR=C:\temp\mikedown-smoke`; WebView2 initialised fine
  there and the harness reported within 5 s. UA
  `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like
  Gecko) Chrome/155.0.0.0 Safari/537.36 Edg/155.0.0.0`, `devicePixelRatio` 1,
  inner size 1028×744 (session 0's virtual desktop, not the configured
  1200×800), `coreFrom: dist` (release resolution of the pinned package).

### Results

Every harness check that passed in WKWebView passed in WebView2 with the same
detail values, and the round-trip markdown is byte-identical to the jsdom
reference (so WKWebView, WebView2, jsdom and the VS Code bundle all agree).
Differences from WKWebView:

| Item | WKWebView | WebView2 |
| --- | --- | --- |
| `document.hasFocus()` | false (window behind the terminal) | true (only window in its session) |
| Scrollbar width | 0 (overlay) | 15 px classic gutter; the content column is narrower by that much. Cosmetic; M11 can style it with `::-webkit-scrollbar` or `scrollbar-width: thin` if it looks heavy |
| `devicePixelRatio` | 2 | 1 on this VM; HiDPI Windows needs a look at icon crispness in M11 |
| Harness run time | ~20 s | ~5 s (Mermaid/KaTeX settled faster) |

No functional WebView2-specific break found. `/date` via `insertContent` is
MANUAL for the same reason as on macOS (the suggestion matcher wants real
input).

### Manual checklist (Windows, PENDING: needs a console or RDP session)

The only logged-on session on BEAST is disconnected (`query user` → `Disc`),
so a visible window and screenshots need a human. Steps:

1. RDP to BEAST as `michaeljoseph` (disconnect afterwards, do not sign out).
2. `C:\git\mikedown` already has `node_modules`, `packages\core\dist` and the
   release build. Either run
   `packages\desktop\src-tauri\target\release\mikedown-desktop.exe` (smoke
   build: it re-runs the harness and writes to `%MIKEDOWN_SMOKE_DIR%` if set,
   otherwise just shows the fixture), or `npm run dev -w packages/desktop`
   for hot reload (needs `$env:Path = "$env:USERPROFILE\.cargo\bin;$env:Path"`).
3. Walk the macOS manual checklist with Ctrl instead of Cmd. Add: Microsoft
   Pinyin / Japanese IME composition; classic scrollbar look; Alt+F4;
   Settings → Personalization → Colors → Dark flips the window without reload
   (the `theme: 'auto'` path is identical to macOS, where the scripted flip
   passed); Ctrl+wheel and touchpad pinch.
4. Screenshot and append a short "GUI pass" note here.

## Release bundle (macOS)

`npm run tauri build` on the Mac, 2026-10-23, x86_64 (see Toolchain), release
profile with `opt-level = "s"`, LTO, `strip`, `panic = "abort"`. Tauri embeds
the Vite output (7.7 MB on disk, mostly Mermaid chunks, KaTeX and the two
Hunspell dictionaries) into the executable, brotli-compressed, so the app is
one binary plus the icon:

| Item | Value |
| --- | --- |
| `MikeDown.app` | 9.6 MiB (binary 9.2 MiB, `Resources/` 416 KiB = icon) |
| `MikeDown_0.1.0_x64.dmg` | 6.36 MiB |
| Rust compile, release, cold | 2 min 14 s; Vite build 4.4 s |
| First launch after the build, to window visible | 3.5 s (unsigned x86_64 binary: Gatekeeper scan plus Rosetta translation on first run; a native arm64 signed build will not pay this) |
| Warm relaunch, to window visible | 0.52 to 0.59 s over three runs, measured with `open -n` and an AppleScript poll (about 0.3 s of that is the poll's own overhead, so the real figure is under half a second) |

Target was ≤ 15 MB before resources: met with room for the welcome document
and app chrome. The equivalent Electron app would start near 100 MB.

## Toolchain

- macOS: rustc/cargo 1.94.1 from Homebrew at `/usr/local` (the Intel Homebrew
  prefix, so the compiler and every artifact are x86_64 and run under
  Rosetta on this arm64 Mac). Tauri builds fine with it, but a shipping build
  must be native: install rustup (`curl https://sh.rustup.rs -sSf | sh`),
  which defaults to `aarch64-apple-darwin` on Apple Silicon, or `brew install
  rust` from the arm64 Homebrew at `/opt/homebrew`. For a universal binary add
  the other target and build with `--target universal-apple-darwin` (M10).
- Windows: see README "Prerequisites".
