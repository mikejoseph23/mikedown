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
#   3. --headless: cargo test --test updater_staging -- --ignored. The real
#      updater plugin checks, downloads, verifies and installs over a COPY of
#      N in deploy/dist/staging/install/, and the tampered manifest must fail.
#      Default (GUI): opens the N copy; the "Update available" toast should
#      appear; click Restart Now; the script waits for the copy to report N+1
#      and for the relaunched process.
#
# Usage: updater-staging-test.sh [--headless] [--port 18765] [--keep-serving]
# Uses the app's normal app-data folder (logs/updater.log shows the check).

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PKG_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
REPO_ROOT="$(cd "$PKG_DIR/../.." && pwd)"
TAURI_DIR="$PKG_DIR/src-tauri"
export PATH="$HOME/.cargo/bin:$PATH"

HEADLESS=false; PORT=18765; KEEP=false
while [[ $# -gt 0 ]]; do
    case "$1" in
        --headless) HEADLESS=true; shift ;;
        --port) PORT="$2"; shift 2 ;;
        --keep-serving) KEEP=true; shift ;;
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
rm -rf "$STAGE"
mkdir -p "$STAGE/serve" "$STAGE/install"
ENDPOINT="http://127.0.0.1:$PORT/latest.json"
echo "Staging updater test: $N -> $NEXT via $ENDPOINT (NOT a release build)"

overlay() { # $1 = version, $2 = file
    cat > "$2" <<JSON
{
  "version": "$1",
  "plugins": { "updater": { "endpoints": ["$ENDPOINT"], "dangerousInsecureTransportProtocol": true } },
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

( cd "$REPO_ROOT" && npm run build:core >/dev/null )
echo "[1/4] building $N"
build "$STAGE/overlay-n.json"
ditto "$BUNDLE/MikeDown.app" "$STAGE/install/MikeDown.app"
cp "$BUNDLE/MikeDown.app.tar.gz" "$STAGE/serve/MikeDown-$N-staging.app.tar.gz"
cp "$BUNDLE/MikeDown.app.tar.gz.sig" "$STAGE/serve/MikeDown-$N-staging.app.tar.gz.sig"

echo "[2/4] building $NEXT"
build "$STAGE/overlay-next.json"
cp "$BUNDLE/MikeDown.app.tar.gz" "$STAGE/serve/MikeDown-$NEXT-staging.app.tar.gz"
cp "$BUNDLE/MikeDown.app.tar.gz.sig" "$STAGE/serve/MikeDown-$NEXT-staging.app.tar.gz.sig"

manifest() { # $1 = signature file, $2 = out
    node -e '
      const fs = require("fs");
      const [ver, sigFile, file, base, out] = process.argv.slice(1);
      const sig = fs.readFileSync(sigFile, "utf8").trim();
      const p = { signature: sig, url: base + file };
      fs.writeFileSync(out, JSON.stringify({ version: ver, notes: "Staging test build.", pub_date: new Date().toISOString().replace(/\.\d{3}Z$/, "Z"),
        platforms: { "darwin-aarch64": p, "darwin-x86_64": p } }, null, 2));
    ' "$NEXT" "$1" "MikeDown-$NEXT-staging.app.tar.gz" "http://127.0.0.1:$PORT/" "$2"
}
manifest "$STAGE/serve/MikeDown-$NEXT-staging.app.tar.gz.sig" "$STAGE/serve/latest.json"
manifest "$STAGE/serve/MikeDown-$N-staging.app.tar.gz.sig" "$STAGE/serve/bad.json"

echo "[3/4] serving $STAGE/serve on 127.0.0.1:$PORT"
python3 -m http.server "$PORT" --bind 127.0.0.1 --directory "$STAGE/serve" >"$STAGE/http.log" 2>&1 &
SERVER=$!
[[ "$KEEP" == true ]] || trap 'kill $SERVER 2>/dev/null || true' EXIT
for _ in 1 2 3 4 5 6 7 8 9 10; do curl -sf "$ENDPOINT" >/dev/null && break; sleep 0.5; done

INSTALLED="$STAGE/install/MikeDown.app"
installed_version() { /usr/libexec/PlistBuddy -c "Print :CFBundleShortVersionString" "$INSTALLED/Contents/Info.plist"; }
echo "      installed copy reports $(installed_version)"

if [[ "$HEADLESS" == true ]]; then
    echo "[4/4] headless: updater plugin check -> download -> verify -> install"
    MIKEDOWN_E2E_ENDPOINT="$ENDPOINT" MIKEDOWN_E2E_BAD_ENDPOINT="http://127.0.0.1:$PORT/bad.json" \
    MIKEDOWN_E2E_APP="$INSTALLED" MIKEDOWN_E2E_CURRENT="$N" MIKEDOWN_E2E_EXPECT="$NEXT" \
        cargo test --manifest-path "$TAURI_DIR/Cargo.toml" --test updater_staging -- --ignored --nocapture --test-threads 1 2>&1 \
        | tee "$STAGE/headless.log" | grep -E "^\[e2e\]|test result|panicked|FAILED"
    grep -q "test result: ok. 2 passed" "$STAGE/headless.log" || { echo "headless test FAILED (see $STAGE/headless.log)" >&2; exit 1; }
    echo "      installed copy now reports $(installed_version)"
    codesign --verify --deep --strict --verbose=1 "$INSTALLED" 2>&1 | sed 's/^/      /'
    echo "      server log:"; sed 's/^/        /' "$STAGE/http.log"
    exit 0
fi

echo "[4/4] GUI: opening $N. Expect the 'Update available' toast; click Restart Now."
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
