#!/usr/bin/env bash
# packages/desktop/deploy/updater-staging-test.sh
# Local end-to-end test of the updater: version N updates itself to N+1 from
# a staging latest.json on 127.0.0.1. Nothing built here is shippable: both
# builds carry a config overlay (temp file, never committed) that points the
# updater at http://127.0.0.1:<port>/latest.json with
# dangerousInsecureTransportProtocol.
#
#   1. Build N and N+1 (arm64, Developer ID signed, not notarized; locally
#      built files carry no quarantine, so Gatekeeper does not check them).
#      N+1 differs only in its version (overlay "version").
#   2. Serve N+1's .app.tar.gz (+ the updater .sig Tauri made with the real
#      key) and a latest.json, plus bad.json whose signature belongs to N.
#   3. --headless: cargo test --test updater_cases -- --ignored. The real
#      updater plugin checks, downloads, verifies and installs over a COPY of
#      N in deploy/dist/staging/install/, and the tampered manifest must fail.
#      Default (GUI): opens the N copy; the "Update available" toast should
#      appear; click Restart Now; the script waits for the copy to report N+1
#      and for the relaunched process.
#
# --headless runs every adversarial and continuity case (U4), one PASS/FAIL/SKIP
# line each, and exits non-zero on any FAIL (or a cargo failure):
#   per-target N to N+1; per-target 404 falls back to latest.json; tampered
#   artifact; manifest signed with a throwaway key; downgrade and same version;
#   replay (N artifact under an N+1 version, refused by requireSignedVersion);
#   offline (server down); skipped and snoozed versions on a silent check;
#   the codesign / Team ID pre-install check (accepts ours; refuses an ad-hoc
#   signed app, an unsigned app and garbage); the shipped endpoint config;
#   the real install over a copy of N; and continuity: the REAL 0.1.0 app
#   updates to N+1 through the legacy latest.json only (see CONTINUITY below).
#   The engine under test is the shipped src/commands/updater.rs, compiled
#   into tests/updater_cases.rs (see that file's header).
#
# CONTINUITY. The shipped 0.1.0 binary has https://www.iadev.net/mikedown/
# baked in, and the plugin has no run-time endpoint override. Without a hosts
# entry, a trusted CA, or a proxy (all system changes) it cannot be pointed at
# 127.0.0.1, so the real 0.1.0 PROCESS is never launched. The closest honest
# equivalent, labeled as such in the output: the updater plugin (same 2.14.0)
# configured with 0.1.0's own shipped plugins.updater block (read from git at
# $LEGACY_CONF_COMMIT, the commit 0.1.0 was built from: one endpoint,
# latest.json, same pubkey, requireSignedVersion) and version 0.1.0, installing
# over a COPY of the real, notarized 0.1.0 .app from deploy/dist/0.1.0/
# (override with MIKEDOWN_LEGACY_DIST). Only latest.json is served for it, and
# the server log is checked to prove no per-target file was requested.
#
# NOT AUTOMATED: install as a NON-ADMIN user into /Applications. macOS shows an
# admin-credentials prompt for the swap and the harness cannot fake it. That is
# a T2 hands-on step: run the default (GUI) mode below as a standard user with
# the app in /Applications, enter the admin password when asked, and confirm
# the relaunch reports N+1. Printed as SKIP.
#
# Usage: updater-staging-test.sh [--headless] [--port 18765] [--keep-serving] [--reuse]
#   --reuse   skip the two builds when deploy/dist/staging already has them
#   --keep-serving  leave the server up afterwards (T2: the paths are printed)
# Uses the app's normal app-data folder in GUI mode (logs/updater.log shows the
# check); headless cases use their own com.interappdev.mikedown.e2e.* folders.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PKG_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
REPO_ROOT="$(cd "$PKG_DIR/../.." && pwd)"
TAURI_DIR="$PKG_DIR/src-tauri"
export PATH="$HOME/.cargo/bin:$PATH"

HEADLESS=false; PORT=18765; KEEP=false; REUSE=false
LEGACY_CONF_COMMIT=a2715d9
while [[ $# -gt 0 ]]; do
    case "$1" in
        --headless) HEADLESS=true; shift ;;
        --port) PORT="$2"; shift 2 ;;
        --keep-serving) KEEP=true; shift ;;
        --reuse) REUSE=true; shift ;;
        -h|--help) awk 'NR == 1 && /^#!/ { next } /^#/ { sub(/^# ?/, ""); print; next } { exit }' "$0"; exit 0 ;;
        *) echo "Unknown option: $1" >&2; exit 2 ;;
    esac
done

N="$(node "$SCRIPT_DIR/sync-version.js" --check)"
NEXT="$(node -e 'import("'"$SCRIPT_DIR"'/lib/release-lib.js").then(m => console.log(m.bumpVersion(process.argv[1], "patch")))' "$N")"
IDENTITY="${CODESIGN_IDENTITY:-$(security find-identity -v -p codesigning | grep "Developer ID Application" | head -1 | sed 's/.*"\(.*\)"/\1/')}"
KEY_PATH="${TAURI_SIGNING_PRIVATE_KEY_PATH:-$HOME/.tauri/mikedown.key}"
export TAURI_SIGNING_PRIVATE_KEY="$(cat "$KEY_PATH")"
export TAURI_SIGNING_PRIVATE_KEY_PASSWORD="${TAURI_SIGNING_PRIVATE_KEY_PASSWORD:-$(security find-generic-password -s mikedown-updater-key -w)}"
unset APPLE_ID APPLE_PASSWORD APPLE_TEAM_ID APPLE_API_KEY APPLE_API_ISSUER APPLE_API_KEY_PATH

STAGE="$SCRIPT_DIR/dist/staging"
LEGACY_DIST="${MIKEDOWN_LEGACY_DIST:-$SCRIPT_DIR/dist/0.1.0}"
if [[ "$REUSE" == true && -f "$STAGE/serve/MikeDown-$NEXT-staging.app.tar.gz.sig" && -d "$STAGE/pristine/MikeDown.app" ]]; then
    echo "Reusing the builds in $STAGE"
    rm -rf "$STAGE/install" "$STAGE/install-legacy" "$STAGE/http.log"
else
    REUSE=false
    rm -rf "$STAGE"
fi
mkdir -p "$STAGE/serve" "$STAGE/install" "$STAGE/bad"
BASE="http://127.0.0.1:$PORT"
# What the GUI builds bake in: the shipped endpoint order, pointed at the staging server.
ENDPOINT="$BASE/pertarget/latest.json"
ENDPOINT_TARGET="$BASE/pertarget/latest-{{target}}-{{arch}}.json"
echo "Staging updater test: $N -> $NEXT via $BASE (NOT a release build)"

overlay() { # $1 = version, $2 = file
    cat > "$2" <<JSON
{
  "version": "$1",
  "plugins": { "updater": { "endpoints": ["$ENDPOINT_TARGET", "$ENDPOINT"], "dangerousInsecureTransportProtocol": true } },
  "bundle": { "createUpdaterArtifacts": true, "macOS": { "signingIdentity": "$IDENTITY" } }
}
JSON
}
overlay "$N" "$STAGE/overlay-n.json"
overlay "$NEXT" "$STAGE/overlay-next.json"

BUNDLE="$TAURI_DIR/target/aarch64-apple-darwin/release/bundle/macos"
build() { # $1 = overlay
    ( cd "$PKG_DIR" && RELEASE=1 npx tauri build --target aarch64-apple-darwin --bundles app --config "$1" >"$STAGE/build-$(basename "$1" .json).log" 2>&1 ) \
        || { echo "build failed, see $STAGE/build-$(basename "$1" .json).log" >&2; exit 1; }
}

if [[ "$REUSE" == false ]]; then
    ( cd "$REPO_ROOT" && npm run build:core >/dev/null )
    echo "[1/5] building $N"
    build "$STAGE/overlay-n.json"
    mkdir -p "$STAGE/pristine"
    ditto "$BUNDLE/MikeDown.app" "$STAGE/pristine/MikeDown.app"
    cp "$BUNDLE/MikeDown.app.tar.gz" "$STAGE/serve/MikeDown-$N-staging.app.tar.gz"
    cp "$BUNDLE/MikeDown.app.tar.gz.sig" "$STAGE/serve/MikeDown-$N-staging.app.tar.gz.sig"

    echo "[2/5] building $NEXT"
    build "$STAGE/overlay-next.json"
    cp "$BUNDLE/MikeDown.app.tar.gz" "$STAGE/serve/MikeDown-$NEXT-staging.app.tar.gz"
    cp "$BUNDLE/MikeDown.app.tar.gz.sig" "$STAGE/serve/MikeDown-$NEXT-staging.app.tar.gz.sig"
fi
ditto "$STAGE/pristine/MikeDown.app" "$STAGE/install/MikeDown.app"

# A throwaway key (never ~/.tauri/mikedown.key) signs N+1's payload for the "different key" case.
if [[ ! -f "$STAGE/serve/MikeDown-$NEXT-staging.app.tar.gz.wrongkey.sig" ]]; then
    mkdir -p "$STAGE/wrongkey"
    ( cd "$PKG_DIR" && npx tauri signer generate -w "$STAGE/wrongkey/throwaway.key" -p throwaway --ci -f >/dev/null 2>&1 )
    cp "$STAGE/serve/MikeDown-$NEXT-staging.app.tar.gz" "$STAGE/wrongkey/payload.app.tar.gz"
    ( cd "$PKG_DIR" && env -u TAURI_SIGNING_PRIVATE_KEY -u TAURI_SIGNING_PRIVATE_KEY_PATH -u TAURI_SIGNING_PRIVATE_KEY_PASSWORD \
        npx tauri signer sign -f "$STAGE/wrongkey/throwaway.key" -p throwaway --app-version "$NEXT" "$STAGE/wrongkey/payload.app.tar.gz" >/dev/null 2>&1 )
    mv "$STAGE/wrongkey/payload.app.tar.gz.sig" "$STAGE/serve/MikeDown-$NEXT-staging.app.tar.gz.wrongkey.sig"
fi

# Payloads the codesign pre-check must refuse.
rm -rf "$STAGE/bad"; mkdir -p "$STAGE/bad/x1" "$STAGE/bad/x2"
tar -xzf "$STAGE/serve/MikeDown-$NEXT-staging.app.tar.gz" -C "$STAGE/bad/x1"
tar -xzf "$STAGE/serve/MikeDown-$NEXT-staging.app.tar.gz" -C "$STAGE/bad/x2"
codesign --force --deep -s - "$STAGE/bad/x1/MikeDown.app" 2>/dev/null
tar -czf "$STAGE/bad/adhoc.app.tar.gz" -C "$STAGE/bad/x1" MikeDown.app
codesign --remove-signature "$STAGE/bad/x2/MikeDown.app" 2>/dev/null
tar -czf "$STAGE/bad/unsigned.app.tar.gz" -C "$STAGE/bad/x2" MikeDown.app
echo "this is not an archive" > "$STAGE/bad/garbage.bin"

# 0.1.0 as shipped: its updater block (from the repo history) and a copy of the real app.
LEGACY_CONF="$STAGE/legacy-0.1.0-updater.json"
LEGACY_APP="$STAGE/install-legacy/MikeDown.app"
LEGACY_OK=true; LEGACY_WHY=""
if ! git -C "$REPO_ROOT" show "$LEGACY_CONF_COMMIT:packages/desktop/src-tauri/tauri.conf.json" 2>/dev/null \
    | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const u=JSON.parse(s).plugins.updater;if(u.endpoints.length!==1||u.requireSignedVersion!==true)process.exit(1);console.log(JSON.stringify(u,null,2))})' > "$LEGACY_CONF"; then
    LEGACY_OK=false; LEGACY_WHY="could not read 0.1.0's updater block from the repo history ($LEGACY_CONF_COMMIT)"
elif [[ ! -d "$LEGACY_DIST/MikeDown.app" ]]; then
    LEGACY_OK=false; LEGACY_WHY="the real 0.1.0 app is not at $LEGACY_DIST/MikeDown.app (set MIKEDOWN_LEGACY_DIST)"
else
    mkdir -p "$STAGE/install-legacy"; ditto "$LEGACY_DIST/MikeDown.app" "$LEGACY_APP"
fi

echo "[3/5] scenarios and server on 127.0.0.1:$PORT"
node "$SCRIPT_DIR/staging-scenarios.js" --serve "$STAGE/serve" --n "$N" --next "$NEXT" --base "$BASE" \
    --keys darwin-aarch64,darwin-x86_64 --suffix -staging.app.tar.gz --platform mac
python3 -u -m http.server "$PORT" --bind 127.0.0.1 --directory "$STAGE/serve" >"$STAGE/http.log" 2>&1 &
SERVER=$!
[[ "$KEEP" == true ]] || trap 'kill $SERVER 2>/dev/null || true' EXIT
for _ in 1 2 3 4 5 6 7 8 9 10; do curl -sf "$BASE/pertarget/latest.json" >/dev/null && break; sleep 0.5; done
: > "$STAGE/http.log"

INSTALLED="$STAGE/install/MikeDown.app"
installed_version() { /usr/libexec/PlistBuddy -c "Print :CFBundleShortVersionString" "$INSTALLED/Contents/Info.plist"; }
echo "      installed copy reports $(installed_version)"

if [[ "$HEADLESS" == true ]]; then
    DEAD_PORT=$((PORT + 1))
    if nc -z 127.0.0.1 "$DEAD_PORT" 2>/dev/null; then echo "port $DEAD_PORT is in use; the offline case needs it free" >&2; exit 1; fi
    echo "[4/5] headless cases (real plugin, real engine code, shipped public key, requireSignedVersion)"
    RESULTS="$STAGE/results.txt"; : > "$RESULTS"
    SKIPARGS=(--skip windows_install_hand_over)
    [[ "$LEGACY_OK" == true ]] || SKIPARGS+=(--skip install_over_real_0_1_0_through_the_legacy_path)
    rc=0
    MIKEDOWN_E2E_BASE="$BASE" MIKEDOWN_E2E_DEAD_PORT="$DEAD_PORT" \
    MIKEDOWN_E2E_CURRENT="$N" MIKEDOWN_E2E_EXPECT="$NEXT" MIKEDOWN_E2E_GOOD_FILE="MikeDown-$NEXT-staging.app.tar.gz" \
    MIKEDOWN_E2E_PRECHECK_OK="$STAGE/serve/MikeDown-$NEXT-staging.app.tar.gz" \
    MIKEDOWN_E2E_PRECHECK_BAD="ad-hoc signed app=$STAGE/bad/adhoc.app.tar.gz;app with its signature removed=$STAGE/bad/unsigned.app.tar.gz;a file that is not an archive=$STAGE/bad/garbage.bin" \
    MIKEDOWN_E2E_INSTALL_APP="$INSTALLED" MIKEDOWN_E2E_LEGACY_APP="$LEGACY_APP" MIKEDOWN_E2E_LEGACY_CONF="$LEGACY_CONF" \
        cargo test --manifest-path "$TAURI_DIR/Cargo.toml" --test updater_cases -- --ignored --nocapture --test-threads 1 ${SKIPARGS[@]+"${SKIPARGS[@]}"} >"$STAGE/headless.log" 2>&1 || rc=$?
    grep -o '\[case\] .*' "$STAGE/headless.log" > "$RESULTS" || true

    add() { echo "[case] $1: $2 $3" >> "$RESULTS"; }
    if [[ "$LEGACY_OK" != true ]]; then add "continuity: real 0.1.0 app updates through the legacy latest.json path" SKIP "$LEGACY_WHY"; fi
    add "non-admin install into /Applications" SKIP "needs the macOS admin prompt; T2 hands-on step (see the header of this script)"

    ARCH="$(uname -m | sed 's/arm64/aarch64/')"
    L="$STAGE/http.log"
    if grep -q "GET /fallback/latest-darwin-$ARCH.json HTTP/1.1\" 404" "$L" && grep -q 'GET /fallback/latest.json HTTP/1.1" 200' "$L"; then
        add "server log: per-target 404 then latest.json 200" PASS "(in that order)"
    else add "server log: per-target 404 then latest.json 200" FAIL "see $L"; fi
    if grep -q "GET /pertarget/latest-darwin-$ARCH.json HTTP/1.1\" 200" "$L" && ! grep -q 'GET /pertarget/latest.json' "$L"; then
        add "server log: per-target file served, latest.json never asked for" PASS ""
    else add "server log: per-target file served, latest.json never asked for" FAIL "see $L"; fi
    if [[ "$LEGACY_OK" == true ]]; then
        if grep -q 'GET /legacy/latest.json HTTP/1.1" 200' "$L" && ! grep -q 'GET /legacy/latest-' "$L"; then
            add "server log: 0.1.0 config asked only for latest.json" PASS ""
        else add "server log: 0.1.0 config asked only for latest.json" FAIL "see $L"; fi
    fi
    if ! grep -q ": PASS" "$RESULTS"; then echo "no case reported PASS; cargo output follows" >&2; tail -40 "$STAGE/headless.log" >&2; fi

    echo "[5/5] results"
    sed -e 's/^\[case\] //' "$RESULTS" | sed 's/^/      /'
    P=$(grep -c ': PASS' "$RESULTS" || true); F=$(grep -c ': FAIL' "$RESULTS" || true); S=$(grep -c ': SKIP' "$RESULTS" || true)
    echo "      installed copy now reports $(installed_version)"
    echo "TOTAL: $P PASS, $F FAIL, $S SKIP"
    echo "      files: $STAGE/headless.log  $STAGE/results.txt  $L  (served: $STAGE/serve)"
    if [[ "$F" -gt 0 || "$rc" -ne 0 ]]; then echo "FAILED (cargo exit $rc)" >&2; exit 1; fi
    exit 0
fi

echo "[4/5] GUI: opening $N. Expect the 'Update available' toast; click Restart Now."
open -n "$INSTALLED"
for _ in $(seq 1 120); do
    [[ "$(installed_version)" == "$NEXT" ]] && break
    sleep 2.5
done
if [[ "$(installed_version)" != "$NEXT" ]]; then
    echo "The copy still reports $(installed_version) after 5 minutes. Check ~/Library/Application Support/com.interappdev.mikedown/logs/updater.log" >&2
    exit 1
fi
sleep 5
echo "Installed $NEXT. Running MikeDown processes from the staging copy:"
pgrep -fl "$INSTALLED/Contents/MacOS/" || echo "  (none: the relaunch did not happen)"
echo "Updater log tail:"
tail -n 8 "$HOME/Library/Application Support/com.interappdev.mikedown/logs/updater.log" | sed 's/^/  /'
