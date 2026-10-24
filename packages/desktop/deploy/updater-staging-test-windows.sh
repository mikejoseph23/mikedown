#!/usr/bin/env bash
# packages/desktop/deploy/updater-staging-test-windows.sh
# Mac-side driver for the Windows half of the updater staging harness.
# Runs everything over SSH; nothing is pushed, published or sent to iadev.net.
#
#   1. Copies the working tree (not the git history, so uncommitted work is
#      tested and nothing has to be on origin) to the build box (BEAST) and
#      runs updater-staging-test.ps1 -Mode Build there: an UNSIGNED staging
#      installer of version N (0.0.9) and the updater_cases test executable.
#   2. Signs the update payloads here (the minisign key is Mac-only):
#        N's installer                          real key, signed version N
#        the genuine Trusted-Signed 0.1.0 .exe  its released .sig (deploy/dist/0.1.0)
#        an UNSIGNED installer as "0.1.0"       real key (update key OK, Authenticode absent)
#        the genuine .exe with a byte changed   real key (update key OK, Authenticode broken)
#        the genuine .exe                       throwaway key (different-key case)
#   3. Copies the bundle to the run box (DEVBOX1) and runs
#      updater-staging-test.ps1 -Mode Run there; its [case] lines come back here.
#
# Usage: updater-staging-test-windows.sh [--skip-build] [--keep]
#   --skip-build   reuse deploy/dist/staging-windows/built from an earlier run
#   --keep         leave the staging server running on the run box
# Env: MIKEDOWN_BUILD_HOST (michaeljoseph@192.168.50.39), MIKEDOWN_RUN_HOST
#      (michaeljoseph-work@192.168.50.42), MIKEDOWN_LEGACY_DIST (deploy/dist/0.1.0),
#      TAURI_SIGNING_PRIVATE_KEY_PATH (~/.tauri/mikedown.key).
# Exit code: 0 all PASS/SKIP, 1 any FAIL, 10 a machine was unreachable.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PKG_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
REPO_ROOT="$(cd "$PKG_DIR/../.." && pwd)"
export PATH="$HOME/.cargo/bin:$PATH"

SKIP_BUILD=false; KEEP=false
while [[ $# -gt 0 ]]; do
    case "$1" in
        --skip-build) SKIP_BUILD=true; shift ;;
        --keep) KEEP=true; shift ;;
        -h|--help) awk 'NR == 1 && /^#!/ { next } /^#/ { sub(/^# ?/, ""); print; next } { exit }' "$0"; exit 0 ;;
        *) echo "Unknown option: $1" >&2; exit 2 ;;
    esac
done

BUILD_HOST="${MIKEDOWN_BUILD_HOST:-michaeljoseph@192.168.50.39}"
RUN_HOST="${MIKEDOWN_RUN_HOST:-michaeljoseph-work@192.168.50.42}"
LEGACY_DIST="${MIKEDOWN_LEGACY_DIST:-$SCRIPT_DIR/dist/0.1.0}"
LEGACY_CONF_COMMIT=a2715d9
N=0.0.9
PORT=18765
NEXT=0.1.0
SUFFIX=-windows-x64-setup.exe
KEY_PATH="${TAURI_SIGNING_PRIVATE_KEY_PATH:-$HOME/.tauri/mikedown.key}"
SSH=(ssh -o BatchMode=yes -o ConnectTimeout=10 -o ServerAliveInterval=30)
WORK="$SCRIPT_DIR/dist/staging-windows"
BUILT="$WORK/built"; BUNDLE="$WORK/bundle"
REMOTE='C:\temp\mikedown-u4'; REMOTE_SLASH='C:/temp/mikedown-u4'

reachable() { "${SSH[@]}" "$1" "echo ok" >/dev/null 2>&1; }
for h in "$BUILD_HOST" "$RUN_HOST"; do
    reachable "$h" || { echo "cannot reach $h over SSH (see estate-facts.yaml)" >&2; exit 10; }
done
[[ -f "$LEGACY_DIST/MikeDown-$NEXT$SUFFIX" && -f "$LEGACY_DIST/MikeDown-$NEXT$SUFFIX.sig" ]] \
    || { echo "the released $NEXT installer and .sig are not in $LEGACY_DIST (set MIKEDOWN_LEGACY_DIST)" >&2; exit 1; }

mkdir -p "$WORK"
if [[ "$SKIP_BUILD" == false || ! -f "$BUILT/MikeDown-$N$SUFFIX" || ! -f "$BUILT/updater_cases.exe" ]]; then
    echo "[1/4] building the unsigned staging $N installer and the test exe on $BUILD_HOST"
    rm -rf "$BUILT"; mkdir -p "$BUILT"
    TAR="$WORK/tree.tar"
    ( cd "$REPO_ROOT" && COPYFILE_DISABLE=1 tar -cf "$TAR" \
        --exclude=node_modules --exclude=target --exclude='deploy/dist' --exclude='.git' --exclude='._*' --exclude='.DS_Store' \
        package.json package-lock.json tsconfig.json dictionaries scripts packages/core packages/desktop )
    "${SSH[@]}" "$BUILD_HOST" "mkdir $REMOTE\\tree 2>nul & echo ok" >/dev/null
    scp -q -o BatchMode=yes "$TAR" "$BUILD_HOST:$REMOTE_SLASH/tree.tar"
    "${SSH[@]}" "$BUILD_HOST" "tar -xf $REMOTE\\tree.tar -C $REMOTE\\tree" >/dev/null
    "${SSH[@]}" "$BUILD_HOST" "powershell -NoProfile -ExecutionPolicy Bypass -File $REMOTE\\tree\\packages\\desktop\\deploy\\updater-staging-test.ps1 -Mode Build -Tree $REMOTE\\tree -Out $REMOTE\\out -N $N -Port $PORT" \
        2>&1 | tee "$WORK/build.log" | tail -n 12
    scp -q -o BatchMode=yes "$BUILD_HOST:$REMOTE_SLASH/out/MikeDown-$N$SUFFIX" "$BUILD_HOST:$REMOTE_SLASH/out/updater_cases.exe" "$BUILT/"
else
    echo "[1/4] reusing $BUILT"
fi

echo "[2/4] signing payloads (real key for the real-key cases, a throwaway key for the different-key case)"
rm -rf "$BUNDLE"; mkdir -p "$BUNDLE/serve" "$BUNDLE/lib"
export TAURI_SIGNING_PRIVATE_KEY; TAURI_SIGNING_PRIVATE_KEY="$(cat "$KEY_PATH")"
export TAURI_SIGNING_PRIVATE_KEY_PASSWORD="${TAURI_SIGNING_PRIVATE_KEY_PASSWORD:-$(security find-generic-password -s mikedown-updater-key -w)}"
sign_real() { ( cd "$PKG_DIR" && npx tauri signer sign --app-version "$2" "$1" >/dev/null 2>&1 ) || { echo "signing $1 failed" >&2; exit 1; }; }
S="$BUNDLE/serve"
cp "$BUILT/MikeDown-$N$SUFFIX" "$S/"; sign_real "$S/MikeDown-$N$SUFFIX" "$N"
cp "$LEGACY_DIST/MikeDown-$NEXT$SUFFIX" "$LEGACY_DIST/MikeDown-$NEXT$SUFFIX.sig" "$S/"
cp "$BUILT/MikeDown-$N$SUFFIX" "$S/MikeDown-$NEXT-unsigned$SUFFIX"; sign_real "$S/MikeDown-$NEXT-unsigned$SUFFIX" "$NEXT"
python3 - "$LEGACY_DIST/MikeDown-$NEXT$SUFFIX" "$S/MikeDown-$NEXT-badsig$SUFFIX" <<'PY'
import sys
b = bytearray(open(sys.argv[1], 'rb').read())
b[len(b) // 3] ^= 0xFF   # inside the signed payload, away from the certificate table at the end
open(sys.argv[2], 'wb').write(b)
PY
sign_real "$S/MikeDown-$NEXT-badsig$SUFFIX" "$NEXT"
mkdir -p "$WORK/wrongkey"
( cd "$PKG_DIR" && npx tauri signer generate -w "$WORK/wrongkey/throwaway.key" -p throwaway --ci -f >/dev/null 2>&1 )
cp "$S/MikeDown-$NEXT$SUFFIX" "$WORK/wrongkey/payload.exe"
( cd "$PKG_DIR" && env -u TAURI_SIGNING_PRIVATE_KEY -u TAURI_SIGNING_PRIVATE_KEY_PASSWORD npx tauri signer sign -f "$WORK/wrongkey/throwaway.key" -p throwaway --app-version "$NEXT" "$WORK/wrongkey/payload.exe" >/dev/null 2>&1 )
mv "$WORK/wrongkey/payload.exe.sig" "$S/MikeDown-$NEXT$SUFFIX.wrongkey.sig"

# The released 0.1.0 signature must verify against the shipped key and carry its signed version.
node "$SCRIPT_DIR/lib/verify-cli.js" "$PKG_DIR/src-tauri/tauri.conf.json" "$S/MikeDown-$NEXT$SUFFIX" "$S/MikeDown-$NEXT$SUFFIX.sig" "$NEXT" \
    || { echo "the released $NEXT installer's .sig does not verify against the shipped key" >&2; exit 1; }
cp "$BUILT/updater_cases.exe" "$BUNDLE/"
cp "$SCRIPT_DIR/staging-scenarios.js" "$SCRIPT_DIR/staging-serve.js" "$SCRIPT_DIR/updater-staging-test.ps1" "$BUNDLE/"
cp "$SCRIPT_DIR/lib/release-lib.js" "$SCRIPT_DIR/lib/minisign.js" "$BUNDLE/lib/"
cp "$PKG_DIR/package.json" "$BUNDLE/package.json"
git -C "$REPO_ROOT" show "$LEGACY_CONF_COMMIT:packages/desktop/src-tauri/tauri.conf.json" \
    | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>console.log(JSON.stringify(JSON.parse(s).plugins.updater,null,2)))' > "$BUNDLE/legacy-0.1.0-updater.json"

echo "[3/4] copying the bundle to $RUN_HOST"
"${SSH[@]}" "$RUN_HOST" "rmdir /s /q $REMOTE\\bundle 2>nul & mkdir $REMOTE\\bundle" >/dev/null
scp -q -r -o BatchMode=yes "$BUNDLE/." "$RUN_HOST:$REMOTE_SLASH/bundle/"

echo "[4/4] running the Windows cases on $RUN_HOST"
KEEPARG=""; [[ "$KEEP" == true ]] && KEEPARG=" -Keep"
rc=0
"${SSH[@]}" "$RUN_HOST" "powershell -NoProfile -ExecutionPolicy Bypass -File $REMOTE\\bundle\\updater-staging-test.ps1 -Mode Run -Bundle $REMOTE\\bundle -N $N -Next $NEXT -Port $PORT$KEEPARG" \
    2>&1 | tee "$WORK/run.log" || rc=$?
exit "$rc"
