#!/usr/bin/env bash
# packages/desktop/deploy/remote-build-windows.sh
# Build the signed MikeDown Windows installer on BEAST and bring it back.
# Modeled on lymescribe/deploy/remote-build-msi.sh.
#
# Guarantees:
#   * BEAST builds an exact COMMIT (detached), the same one the Mac builds.
#     The commit must be on origin, because BEAST fetches it.
#   * BEAST's checkout (C:\git\mikedown, a clone) is restored afterwards, also
#     on failure; a dirty BEAST tree is never touched.
#   * The build and Authenticode signing run inside the Scheduled Task
#     "MikeDownRemoteBuild" (stored-password logon, so DPAPI works; key-auth
#     SSH fails with NTE_PERM, estate-facts id beast-signing-ssh-token-blocks-cng).
#   * The installer is verified Valid-signed on the box, copied back, re-hashed,
#     then given its updater signature here with the Mac-only minisign key.
#
# One-time setup at an RDP console on BEAST (needs the account password):
#   schtasks /create /tn "MikeDownRemoteBuild" /ru michaeljoseph /rp * /rl HIGHEST /f /sc ONCE /st 00:00 /sd 01/01/2020 /tr "powershell.exe -NoProfile -ExecutionPolicy Bypass -File C:\tools\remote-build\run-mikedown-build.ps1"
# The AZURE_CLIENT_ID / AZURE_CLIENT_SECRET / AZURE_TENANT_ID user env vars
# LymeScribe already uses on BEAST are reused; the wrapper sets the MikeDown
# dlib and metadata paths itself.
#
# Usage:
#   remote-build-windows.sh --version x.y.z [--sha <commit>] [--dest DIR]
#                           [--host user@host] [--allow-unpublished-core]
#
# Exit codes: 0 ok, 1 failure, 2 usage, 10 precondition (fall back to a
# manual build at the console: build-windows.ps1).

set -euo pipefail

print_usage() { awk 'NR == 1 && /^#!/ { next } /^#/ { sub(/^# ?/, ""); print; next } { exit }' "$0"; }

EX_OK=0; EX_FAIL=1; EX_USAGE=2; EX_PRECONDITION=10
VERSION=""; SHA=""; DEST=""; ALLOW_UNPUBLISHED=false
HOST="${MIKEDOWN_REMOTE_HOST:-michaeljoseph@192.168.50.39}"
while [[ $# -gt 0 ]]; do
    case "$1" in
        --version) VERSION="$2"; shift 2 ;;
        --sha) SHA="$2"; shift 2 ;;
        --dest) DEST="$2"; shift 2 ;;
        --host) HOST="$2"; shift 2 ;;
        --allow-unpublished-core) ALLOW_UNPUBLISHED=true; shift ;;
        -h|--help) print_usage; exit 0 ;;
        *) echo "Unknown arg: $1 (see --help)" >&2; exit $EX_USAGE ;;
    esac
done
[[ -n "$VERSION" ]] || { echo "ERROR: --version is required." >&2; exit $EX_USAGE; }

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PKG_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
REPO_ROOT="$(cd "$PKG_DIR/../.." && pwd)"
DEST="${DEST:-$SCRIPT_DIR/dist/$VERSION}"
EXE="MikeDown-$VERSION-windows-x64-setup.exe"
REPO_WIN='C:\git\mikedown'
TASK_NAME="MikeDownRemoteBuild"
REMOTE_TOOLS_DIR='C:\tools\remote-build'
REMOTE_WRAPPER="$REMOTE_TOOLS_DIR\\run-mikedown-build.ps1"
REMOTE_JOB_DIR='C:\temp\mikedown-build'
REMOTE_DONE_FILE="$REMOTE_JOB_DIR\\done.json"
REMOTE_LOG_FILE="$REMOTE_JOB_DIR\\build.log"
POLL_TIMEOUT_SECS=2400
POLL_INTERVAL_SECS=15
SSH_OPTS=(-o ConnectTimeout=10 -o BatchMode=yes -o LogLevel=ERROR)

say()  { echo "  $*"; }
fail() { echo "  x $*" >&2; }

# PowerShell over SSH (lands in cmd.exe): base64 UTF-16LE. Write-Output only.
run_ps() {
    local enc
    enc="$(printf '%s' "$1" | iconv -f UTF-8 -t UTF-16LE | base64 | tr -d '\n')"
    ssh "${SSH_OPTS[@]}" "$HOST" "powershell -NoProfile -NonInteractive -EncodedCommand $enc"
}

echo ""
say "Remote Windows build: MikeDown $VERSION on ${HOST#*@}"

# 1. Local preconditions
if [[ -n "$(git -C "$REPO_ROOT" status --porcelain --untracked-files=no)" ]]; then
    fail "local tree has uncommitted changes; BEAST can only build a commit."; exit $EX_PRECONDITION
fi
[[ -z "$SHA" ]] && SHA="$(git -C "$REPO_ROOT" rev-parse HEAD)"
SHA="$(git -C "$REPO_ROOT" rev-parse "$SHA")"
if [[ -z "$(git -C "$REPO_ROOT" branch -r --contains "$SHA" 2>/dev/null)" ]]; then
    fail "commit ${SHA:0:10} is not on any remote branch; BEAST fetches from origin. Push first (git push origin HEAD)."
    exit $EX_PRECONDITION
fi
if ! ssh "${SSH_OPTS[@]}" "$HOST" "cd" >/dev/null 2>&1; then
    fail "cannot reach $HOST over SSH."; exit $EX_PRECONDITION
fi
STATE="$(run_ps "if (-not (Test-Path '$REPO_WIN\\.git')) { Write-Output 'NOCLONE=1' } else { Set-Location '$REPO_WIN'; Write-Output ('DIRTY=' + ((git status --porcelain --untracked-files=no) -join '|')) }" 2>/dev/null | tr -d '\r')" || true
if grep -q '^NOCLONE=1' <<<"$STATE"; then
    fail "$REPO_WIN on BEAST is not a git clone (the M0 tarball snapshot). See deploy/README.md, 'BEAST one-time setup'."
    exit $EX_PRECONDITION
fi
if [[ -n "$(sed -n 's/^DIRTY=//p' <<<"$STATE")" ]]; then
    fail "BEAST's $REPO_WIN has uncommitted changes: $(sed -n 's/^DIRTY=//p' <<<"$STATE" | tr '|' ',')"
    exit $EX_PRECONDITION
fi
if ! ssh "${SSH_OPTS[@]}" "$HOST" "schtasks /query /tn $TASK_NAME" >/dev/null 2>&1; then
    fail "scheduled task \"$TASK_NAME\" is not registered on $HOST. Register it once at an RDP console:"
    say "  schtasks /create /tn \"$TASK_NAME\" /ru michaeljoseph /rp * /rl HIGHEST /f /sc ONCE /st 00:00 /sd 01/01/2020 /tr \"powershell.exe -NoProfile -ExecutionPolicy Bypass -File $REMOTE_WRAPPER\""
    exit $EX_PRECONDITION
fi
say "ok: tree clean, ${SHA:0:10} on origin, BEAST clone clean, task registered"

# 2. Wrapper + job, trigger
run_ps "New-Item -ItemType Directory -Force -Path '$REMOTE_TOOLS_DIR','$REMOTE_JOB_DIR' | Out-Null
Remove-Item -Force -ErrorAction SilentlyContinue '$REMOTE_DONE_FILE'
Write-Output 'PREP-OK'" >/dev/null 2>&1
scp -q "${SSH_OPTS[@]}" "$SCRIPT_DIR/beast/run-mikedown-build.ps1" "$HOST:$(echo "$REMOTE_WRAPPER" | tr '\\' '/')" \
    || { fail "could not copy the wrapper to $HOST."; exit $EX_FAIL; }
JOB_JSON="$(printf '{"Sha":"%s","Version":"%s","AllowUnpublishedCore":%s}' "$SHA" "$VERSION" "$ALLOW_UNPUBLISHED")"
JOB_B64="$(printf '%s' "$JOB_JSON" | base64 | tr -d '\n')"
run_ps "[System.IO.File]::WriteAllText('$REMOTE_JOB_DIR\\job.json', [System.Text.Encoding]::UTF8.GetString([System.Convert]::FromBase64String('$JOB_B64')), (New-Object System.Text.UTF8Encoding(\$false)))
Write-Output 'JOB-OK'" >/dev/null 2>&1
ssh "${SSH_OPTS[@]}" "$HOST" "schtasks /run /tn $TASK_NAME" >/dev/null 2>&1 || { fail "schtasks /run failed."; exit $EX_FAIL; }
say "task triggered; polling every ${POLL_INTERVAL_SECS}s (timeout ${POLL_TIMEOUT_SECS}s)"

ELAPSED=0
until ssh "${SSH_OPTS[@]}" "$HOST" "powershell -NoProfile -Command \"if (Test-Path '$REMOTE_DONE_FILE') { exit 0 } else { exit 1 }\"" >/dev/null 2>&1; do
    sleep "$POLL_INTERVAL_SECS"; ELAPSED=$((ELAPSED + POLL_INTERVAL_SECS))
    [[ "$ELAPSED" -lt "$POLL_TIMEOUT_SECS" ]] || { fail "timed out waiting for $REMOTE_DONE_FILE."; exit $EX_FAIL; }
done

# 3. Result
mkdir -p "$DEST"
DONE_JSON="$(run_ps "Get-Content -Raw '$REMOTE_DONE_FILE'" 2>/dev/null | tr -d '\r')"
run_ps "if (Test-Path '$REMOTE_LOG_FILE') { Get-Content -Raw '$REMOTE_LOG_FILE' }" 2>/dev/null | tr -d '\r' > "$DEST/windows-build.log" || true
field() { node -e 'const j=JSON.parse(process.argv[1]); const v=j[process.argv[2]]; process.stdout.write(v==null?"":String(v))' "$DONE_JSON" "$1"; }
[[ "$(field restoreOk)" == "true" ]] && say "BEAST restored to $(field restoredTo)" || fail "BEAST restore: $(field restoredTo) (check it at the console)"
if [[ "$(field ok)" != "true" ]]; then
    fail "remote build failed: $(field errorMessage)"; say "log: $DEST/windows-build.log"; exit $EX_FAIL
fi
R_SHA="$(field sha256)"; R_SIZE="$(field size)"; R_SIG="$(field exeSignature)"
[[ "$R_SIG" == "Valid" ]] || { fail "installer Authenticode status $R_SIG"; exit $EX_FAIL; }
[[ "${R_SIZE:-0}" -gt 2000000 ]] || { fail "installer is only ${R_SIZE:-0} bytes"; exit $EX_FAIL; }

# signtool verify /pa on the box, for the record.
run_ps "\$st = Get-ChildItem \"\${env:ProgramFiles(x86)}\\Windows Kits\\10\\bin\" -Directory | Sort-Object Name -Descending | ForEach-Object { Join-Path \$_.FullName 'x64\\signtool.exe' } | Where-Object { Test-Path \$_ } | Select-Object -First 1
& \$st verify /pa '$(field exePath)' 2>&1 | ForEach-Object { Write-Output \$_ }" 2>/dev/null | tr -d '\r' > "$DEST/verify-windows.txt" || true

scp -q "${SSH_OPTS[@]}" "$HOST:$(field exePath | tr '\\' '/')" "$DEST/$EXE" || { fail "scp failed."; exit $EX_FAIL; }
L_SHA="$(shasum -a 256 "$DEST/$EXE" | awk '{print $1}')"
[[ "$L_SHA" == "$R_SHA" ]] || { fail "copied installer hash differs from the box"; rm -f "$DEST/$EXE"; exit $EX_FAIL; }
say "ok: $EXE ($((R_SIZE / 1024)) KB), Authenticode Valid, SHA-256 matches"

# 4. Updater signature (Mac-only key)
KEY_PATH="${TAURI_SIGNING_PRIVATE_KEY_PATH:-$HOME/.tauri/mikedown.key}"
TAURI_SIGNING_PRIVATE_KEY_PASSWORD="${TAURI_SIGNING_PRIVATE_KEY_PASSWORD:-$(security find-generic-password -s mikedown-updater-key -w)}"
export TAURI_SIGNING_PRIVATE_KEY_PASSWORD
( cd "$PKG_DIR" && env -u TAURI_SIGNING_PRIVATE_KEY npx tauri signer sign -f "$KEY_PATH" --app-version "$VERSION" "$DEST/$EXE" >/dev/null )
[[ -s "$DEST/$EXE.sig" ]] || { fail "no updater signature written"; exit $EX_FAIL; }
say "ok: updater signature $DEST/$EXE.sig"
exit $EX_OK
