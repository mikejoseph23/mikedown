# M1 — Reproduce & Diagnose Remote Export Failure — Worker Summary

**Status:** Completed (with one item done via code-trace instead of hands-on GUI repro — see Issues/Blockers)

**Start time:** 2026-08-13 19:58 EDT
**End time:** 2026-08-13 20:18 EDT

## Work completed

All checklist items attempted. Diagnosis-only — no repo files modified, nothing committed.

## Findings per task

### 1. Screenshot from the Aug 8 call

Found on `~/Desktop`: `Screenshot 2026-08-13 at 6.17.50 PM.png` (also `Call with Kevin.m4a` / `Call with Kevin.txt` alongside it — not reviewed further, out of scope).

**Exact error text (transcribed from the image, a native Windows dialog, not a VS Code dialog):**

> **Get an app to open this 'vscode-remote' link**
>
> Your PC doesn't have an app that can open this link. Try looking for a compatible app in the Microsoft Store.
>
> [Browse Microsoft Store]

This is materially more specific than the planning doc's working assumption of a generic "download" prompt. It's the **Windows shell's "no registered handler for this URI scheme" dialog**, triggered because the OS is being asked to open a `vscode-remote://` URI directly — not a `file://` path, and not a download prompt.

This changes (and confirms) the mechanism: VS Code's remote-extension-host runtime rewrites `vscode.Uri.file(...)` values that originate in the **remote** extension host into `vscode-remote://<authority>/<path>` URIs automatically when they cross into a context that expects a URI (this is `Uri.file`'s scheme staying `file` internally, but `vscode.env.openExternal` on a remote-authored `file:` URI resolves through the remote URI resolver, which stamps the `vscode-remote` scheme before handing off to the OS shell). The local Windows shell has no handler registered for `vscode-remote:`, so it falls back to the Microsoft Store suggestion dialog. This matches the known-grounding hypothesis almost exactly, just with the precise OS-level symptom now confirmed.

### 2. Reproduction environment

- Docker Desktop is installed and the daemon is running (`docker info` succeeds, `docker-desktop` context, 24 CPUs / ~7.7GiB allotted).
- No `devcontainer` CLI is installed (`which devcontainer` → not found), and this is a headless agent context with no display server, no way to launch/drive an actual VS Code GUI window, and no way to interact with OS-level modal dialogs (like the one in the screenshot) even if a window could be opened.
- **I could not stand up a live, hands-on GUI VS Code Dev Container/WSL repro from this context.** `@vscode/test-electron` (used for `test:integration`) does not cover remoting — it boots a local VS Code instance, not a remote-attached one — so it cannot be repurposed for this either.
- Given that constraint, diagnosis proceeded via **code trace**, which is sufficient to identify the mechanism with high confidence (see below) but not sufficient to visually confirm the fix later — that hands-on step is explicitly called out as required in M3 and should stay there.

### 3. Extension host / extensionKind

- `package.json` has **no `extensionKind` field** and **no `browser` entry point** (only `"main": "./dist/extension.js"`).
- Per VS Code's default resolution rules, an extension with only a Node `main` and no declared `extensionKind` defaults to **`["workspace"]`** — meaning the extension host process runs on the **remote** side (the Dev Container / WSL / SSH host), not the local UI side.
- Confirmed via grep: **`vscode.env.remoteName` is not referenced anywhere in `src/`**, and **`extensionKind` does not appear in `package.json`**. There is currently zero remote-awareness in the codebase.
- Consequence: every call in `export.ts` — `os.tmpdir()`, `vscode.workspace.fs.writeFile`, `vscode.env.openExternal` — executes in the **remote** extension host. `os.tmpdir()` resolves to a temp directory on the remote filesystem, and the `vscode.Uri.file(tmpPath)` handed to `openExternal` is a remote-authored URI.

### 4. Which of the four paths fail remotely

By code trace (all four ultimately funnel through the same two functions in `export.ts`):

| Path | Command / flow | Function | Remote-safe? |
|---|---|---|---|
| Export as PDF / Print | `mikedown.print` → webview `requestPrint` → `printDocument` message (`markdownEditorProvider.ts:538-540`) | `openRenderedInBrowser(..., { autoPrint: true })` | **No** — fails |
| View in Browser | `mikedown.viewInBrowser` → `viewInBrowser` message (`markdownEditorProvider.ts:534-536`) | `openRenderedInBrowser(...)` | **No** — fails |
| Export as HTML | `mikedown.exportHtml` → `exportHtml` message (`markdownEditorProvider.ts:529-532`) | `writeRenderedHtml(...)` | **Yes** — unaffected (see item 6) |
| In-webview print (`printReady`) | `markdownEditorProvider.ts:542-545` | No host action — handled entirely by `window.print()` inside the browser tab that `openRenderedInBrowser` already opened | Inherits the failure of whichever flow opened it (View in Browser or Print) — it never gets a chance to run because the browser tab never opens |

So: **3 of 4 fail** (Print/PDF, View in Browser, and by extension in-webview print since it depends on a browser tab that never opens). **Export as HTML does not fail** — it's the one already-safe path, confirming the planning doc's assumption.

### 5. Trace of `src/export.ts:152-181` (`openRenderedInBrowser`)

Confirmed line-by-line (current file, lines 160-182):

- `path.join(os.tmpdir(), ...)` (line 178) — `os.tmpdir()` runs in the extension host process, which (per item 3) is the **remote** process. This resolves to a path like `/tmp/mikedown-print-....html` **on the container/WSL/SSH host**, not on Kevin's Windows machine.
- `vscode.Uri.file(tmpPath)` (line 179) — constructs a `file:` URI scoped to that remote path.
- `vscode.workspace.fs.writeFile(tmpUri, ...)` (line 180) — writes the file; this succeeds fine, because `vscode.workspace.fs` is remote-URI-aware and correctly writes to the remote filesystem. No error here.
- `vscode.env.openExternal(tmpUri)` (line 181) — this is the failure point. `openExternal` is documented to accept `Uri` and hand it to the OS to open. When the extension host is remote, VS Code intercepts this and, instead of transparently proxying the file, resolves the URI through the remote-URI machinery, which is what produces the `vscode-remote://` scheme the OS then can't dispatch — exactly matching the screenshot.

This confirms the known-grounding note precisely: **the temp file does land on the remote filesystem, and `openExternal(Uri.file(...))` is what triggers the failure dialog.**

### 6. `extensionKind` implications

- Currently absent → defaults to `["workspace"]` → extension host runs remotely → every `export.ts` call above is remote-executed.
- Declaring `extensionKind: ["ui", "workspace"]` would let VS Code run the extension on the **local (UI)** side when a UI host is available, falling back to `workspace` when it isn't (e.g., isolated remote environments like GitHub Codespaces or SSH into a box with no local VS Code counterpart) — VS Code auto-selects based on what's available, extensions don't get to force one over the other per-session.
- **This alone does not fully fix the bug** even if declared, because:
  - It doesn't guarantee `ui` execution — Codespaces / some SSH targets have no UI-side extension host at all, and remote execution stays required as a fallback.
  - The custom editor's `resolveCustomTextEditor` and all `vscode.workspace.fs` document I/O still need to work against the remote document, so simply forcing `ui` risks breaking file access to the actual remote document being edited unless handled carefully (`ui`-kind extensions on a workspace-scoped resource can hit cross-host friction).
  - It also doesn't fix the two other candidate fixes' need for explicit remote-detection logic — even in a `ui`-preferred world, Codespaces/pure-SSH-without-local-passthrough would still exercise the remote path.
- Bottom line: `extensionKind` is a *complementary* lever, not a substitute for explicit remote handling in `export.ts`.

### 7. Is `showSaveDialog`-based HTML export (`export.ts:138`) actually unaffected?

Yes — confirmed unaffected by trace. `writeRenderedHtml` (lines 134-149):

- `vscode.window.showSaveDialog(...)` — VS Code natively remotes this UI: the dialog is drawn **locally** in the VS Code window (whether local or remote-attached), and the resulting `Uri` the user picks is whatever filesystem they navigated to in that dialog (by default the remote filesystem, since that's the FS namespace the dialog browses, but it's still a *user-directed*, dialog-mediated write — no `openExternal` call, no OS-level URI hand-off).
- `vscode.workspace.fs.writeFile(uri, ...)` — writes wherever the user picked, remote-URI-aware.
- No call to `vscode.env.openExternal` or any other local-only API.

This path never touches `os.tmpdir()` or `openExternal`, so it has no exposure to the failure mechanism at all. It is genuinely safe as-is.

## Recommended fix

**Primary recommendation: detect `vscode.env.remoteName` and route around `openExternal(Uri.file(...))` when remote.** Concretely:

1. In `openRenderedInBrowser`, check `vscode.env.remoteName`. When it's `undefined` (local session), keep the exact current behavior — temp file + `openExternal` — byte-for-byte, zero regression risk.
2. When remote, do **not** attempt to `openExternal` a remote-authored URI at all. Two sub-options, in order of preference:
   - **(a) `vscode.env.asExternalUri()`** — pass the remote temp file's URI through this API, which VS Code documents as converting a URI meaningful on the extension host side into one openable by the local machine (e.g., via the remote's forwarded HTTP tunnel, if the temp file were served rather than filesystem-opened). This requires serving the HTML over a small local HTTP listener in the remote extension host (since `asExternalUri` is designed around forwarded ports/URLs, not arbitrary local file paths) — more moving parts, but keeps the "just opens" UX intact and works for View in Browser and Print alike.
   - **(b) Save-then-instruct fallback** — reuse the already-safe `showSaveDialog` flow (`writeRenderedHtml`) instead of a silent temp file, and show an actionable message telling the user where the file landed and that they should open it from their local machine (or, for Print, that a local double-click + Ctrl/Cmd+P is needed since a remote host can't pop a local print dialog either way). Simpler, no new server/tunnel code, but loses the "click and it just opens" UX for View in Browser/Print in remote sessions.
3. Recommend **(b) as the actual first-ship fix**, with (a) as a stretch goal / follow-up: (a) requires standing up a local HTTP server bound in the remote host and reasoning about port-forwarding lifecycle (start/stop per export, cleanup, collision handling) — real complexity for M2, which is already flagged Opus-level. (b) fully resolves the reported bug (no more OS error dialog) with a much smaller, easily tested change, and it's consistent with the pattern `export.ts:138` already uses successfully.
4. `extensionKind: ["ui", "workspace"]` — recommend adding this too, but as a **complement**, not the fix. It reduces how often the remote path triggers at all (when a local UI extension host is available) but must not be relied on as the sole fix since Codespaces/pure-SSH targets still force `workspace`-only execution.

**Trade-off summary:**

| Approach | Fixes the bug | New complexity | UX in remote |
|---|---|---|---|
| `remoteName` detect + save-then-instruct (recommended for M2) | Yes | Low | One extra click/instruction, no crash |
| `remoteName` detect + `asExternalUri()` over local HTTP server | Yes | Medium-high (server lifecycle, port forwarding) | Same as local (auto-opens) |
| `extensionKind: ["ui","workspace"]` alone | Partial (only when a local UI host exists) | Low | No fix in Codespaces/pure-SSH |
| All three combined | Yes, most robust | Medium | Best available in each environment |

## Issues or blockers

- **No hands-on GUI repro was possible from this headless agent context.** Docker is available and running, but there is no display server, no way to launch/interact with a real VS Code window, and no way to observe/interact with the native OS dialog shown in the screenshot. This diagnosis is code-trace-based, cross-checked against the screenshot's exact error text, which is precise enough to identify the mechanism with high confidence. **M3's hands-on/manual testing requirement (real Dev Container + WSL session) remains necessary and should not be skipped** — this M1 pass cannot substitute for it.
- The screenshot's dialog title ("Get an app to open this 'vscode-remote' link") confirms the URI-scheme-handoff mechanism precisely; the planning document's working assumption ("download" prompt) was close but not exact — worth updating the doc's language when the orchestrator reviews (not done here, per instructions not to edit the planning doc).

## Notes for orchestrator

- Recommend gating M2 on the user choosing between fix (b) alone vs. (b)+(a). Given Kevin's use case (Docker container on Windows) is a common attach-then-drop-off case, (b) alone likely satisfies him; (a) is a nicer long-term UX but meaningfully larger scope.
- `extensionKind` change is low-risk and cheap — suggest bundling it into M2 regardless of which URI approach is chosen.
- The `Call with Kevin.m4a` / `.txt` files on `~/Desktop` were not reviewed (out of scope for M1's screenshot task) but may be useful for M9 (follow-up with Kevin) if there's an item he "couldn't recall."
