#!/usr/bin/env bash
# packages/desktop/deploy/build-mac.sh
# Build, sign, notarize and package MikeDown Desktop for macOS (universal).
# Modeled on lymescribe/deploy/build-mac-dmg.sh.
#
# Pipeline:
#   1. Gates: versions in sync (sync-version.js --check), @mikedown/core pin
#      (check-core-pin.js), Developer ID identity, updater key.
#   2. RELEASE=1 tauri build --target universal-apple-darwin --bundles app:
#      Tauri signs the .app with the Developer ID identity, hardened runtime
#      and src-tauri/Entitlements.plist (bundle.macOS.signingIdentity comes
#      from a generated config overlay), and writes the updater .app.tar.gz.
#   3. notarytool submit --wait + stapler staple on the APP (skippable), so
#      the ticket travels with the app when it is copied out of the DMG or
#      unpacked by the updater.
#   4. Updater payload rebuilt from the stapled app and signed with the
#      minisign key (tauri signer sign --app-version), so the bytes the
#      updater verifies are the bytes that ship.
#   5. Styled DMG via make-dmg.sh (background art, icon layout, hidden toolbar;
#      art source in assets/dmg/), DMG signature, notarize and staple the DMG
#      (skippable). Needs a logged-in GUI session (Finder lays the window out).
#   6. Verify: lipo, codesign --verify --deep --strict, spctl, stapler validate.
#
# Usage:
#   packages/desktop/deploy/build-mac.sh [options]
#
# Options:
#   --identity "<name>"        Signing identity. Default: $CODESIGN_IDENTITY or the
#                              first "Developer ID Application" in the keychain.
#   --notary-profile <name>    notarytool keychain profile. Default:
#                              $NOTARY_PROFILE, else mikedown-notary if stored,
#                              else lymescribe-notary (same Apple team).
#   --skip-notarize            Sign only (local dry run). Not shippable.
#   --output <dir>             Default: packages/desktop/deploy/dist/<version>
#   --allow-unpublished-core   Build against packages/core/dist while the pinned
#                              @mikedown/core version is not on npm yet.
#   --config <file>            Extra tauri config overlay (the staging updater
#                              test uses this; never for a real release).
#   --version-suffix <s>       Name artifacts MikeDown-<version><s>-... (tests).
#   --dmg-only                 Skip the build, app notarization and updater
#                              payload; restyle the DMG from an already signed
#                              and stapled MikeDown.app (default
#                              <output>/MikeDown.app) and sign, notarize and
#                              staple it. For iterating on the DMG look.
#   --app <path>               With --dmg-only: take the stapled app from here
#                              (pair with --output to leave the original dist
#                              folder untouched).
#
# Updater key: ~/.tauri/mikedown.key (override: $TAURI_SIGNING_PRIVATE_KEY_PATH),
# password from the login Keychain item "mikedown-updater-key"
# (override: $TAURI_SIGNING_PRIVATE_KEY_PASSWORD).
#
# Notarization credentials (one-time, if you want a MikeDown-named profile):
#   xcrun notarytool store-credentials mikedown-notary \
#     --apple-id <apple-id-email> --team-id UU626VCLYW --password <app-specific-password>

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PKG_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
REPO_ROOT="$(cd "$PKG_DIR/../.." && pwd)"
TAURI_DIR="$PKG_DIR/src-tauri"
export PATH="$HOME/.cargo/bin:$PATH"

IDENTITY="${CODESIGN_IDENTITY:-}"
NOTARY_PROFILE="${NOTARY_PROFILE:-}"
SKIP_NOTARIZE=false
OUTPUT_DIR=""
CORE_FLAG=""
EXTRA_CONFIG=""
SUFFIX=""
DMG_ONLY=false
APP_IN=""

while [[ $# -gt 0 ]]; do
    case "$1" in
        --identity)               IDENTITY="$2"; shift 2 ;;
        --notary-profile)         NOTARY_PROFILE="$2"; shift 2 ;;
        --skip-notarize)          SKIP_NOTARIZE=true; shift ;;
        --output)                 OUTPUT_DIR="$2"; shift 2 ;;
        --allow-unpublished-core) CORE_FLAG="--allow-unpublished-core"; shift ;;
        --config)                 EXTRA_CONFIG="$2"; shift 2 ;;
        --version-suffix)         SUFFIX="$2"; shift 2 ;;
        --dmg-only)               DMG_ONLY=true; shift ;;
        --app)                    APP_IN="$2"; shift 2 ;;
        -h|--help) awk 'NR == 1 && /^#!/ { next } /^#/ { sub(/^# ?/, ""); print; next } { exit }' "$0"; exit 0 ;;
        *) echo "Unknown option: $1 (try --help)" >&2; exit 2 ;;
    esac
done

# ── 1. Gates ─────────────────────────────────────────────────────────────────

VERSION="$(node "$SCRIPT_DIR/sync-version.js" --check)" || {
    echo "ERROR: versions out of sync; run node deploy/sync-version.js <version>." >&2; exit 1; }
[[ "$DMG_ONLY" == true ]] || node "$SCRIPT_DIR/check-core-pin.js" $CORE_FLAG

if [[ -z "$IDENTITY" ]]; then
    IDENTITY=$(security find-identity -v -p codesigning 2>/dev/null \
        | grep "Developer ID Application" | head -1 | sed 's/.*"\(.*\)"/\1/')
    [[ -n "$IDENTITY" ]] || { echo "ERROR: no Developer ID Application identity in the keychain (pass --identity)." >&2; exit 1; }
fi

if [[ "$SKIP_NOTARIZE" != true && -z "$NOTARY_PROFILE" ]]; then
    for p in mikedown-notary lymescribe-notary; do
        if xcrun notarytool history --keychain-profile "$p" >/dev/null 2>&1; then NOTARY_PROFILE="$p"; break; fi
    done
    [[ -n "$NOTARY_PROFILE" ]] || { echo "ERROR: no notarytool keychain profile (see --help), or pass --skip-notarize." >&2; exit 1; }
fi

KEY_PATH="${TAURI_SIGNING_PRIVATE_KEY_PATH:-$HOME/.tauri/mikedown.key}"
if [[ "$DMG_ONLY" != true ]]; then
[[ -f "$KEY_PATH" ]] || { echo "ERROR: updater private key missing at $KEY_PATH (see deploy/README.md)." >&2; exit 1; }
if [[ -z "${TAURI_SIGNING_PRIVATE_KEY_PASSWORD:-}" ]]; then
    TAURI_SIGNING_PRIVATE_KEY_PASSWORD="$(security find-generic-password -s mikedown-updater-key -w)" || {
        echo "ERROR: Keychain item mikedown-updater-key not readable." >&2; exit 1; }
fi
export TAURI_SIGNING_PRIVATE_KEY="$(cat "$KEY_PATH")"
export TAURI_SIGNING_PRIVATE_KEY_PASSWORD
fi

NAME="MikeDown-$VERSION$SUFFIX"
OUTPUT_DIR="${OUTPUT_DIR:-$SCRIPT_DIR/dist/$VERSION$SUFFIX}"
mkdir -p "$OUTPUT_DIR"
WORK="$(mktemp -d -t mikedown-mac-build)"
trap 'rm -rf "$WORK"' EXIT

echo ""
echo "MikeDown Desktop $VERSION$SUFFIX (macOS universal)"
echo "  Identity:  $IDENTITY"
echo "  Notarize:  $([[ "$SKIP_NOTARIZE" == true ]] && echo SKIPPED || echo "profile '$NOTARY_PROFILE'")"
echo "  Output:    $OUTPUT_DIR"
[[ -n "$EXTRA_CONFIG" ]] && echo "  Overlay:   $EXTRA_CONFIG (NOT a release build)"
echo ""

if [[ "$DMG_ONLY" != true ]]; then

# ── 2. Build + sign (Tauri) ──────────────────────────────────────────────────

echo "[1/6] tauri build (universal, signed, hardened runtime)"
cat > "$WORK/release.conf.json" <<JSON
{ "bundle": { "createUpdaterArtifacts": true, "macOS": { "signingIdentity": "$IDENTITY", "hardenedRuntime": true } } }
JSON
CONFIG_ARGS=(--config "$WORK/release.conf.json")
[[ -n "$EXTRA_CONFIG" ]] && CONFIG_ARGS+=(--config "$EXTRA_CONFIG")

# Tauri notarizes on its own when these are set; this script notarizes with a
# keychain profile instead, after the build, so keep Tauri out of it.
unset APPLE_ID APPLE_PASSWORD APPLE_TEAM_ID APPLE_API_KEY APPLE_API_ISSUER APPLE_API_KEY_PATH

( cd "$REPO_ROOT" && npm run build:core >/dev/null )
( cd "$PKG_DIR" && RELEASE=1 npx tauri build --target universal-apple-darwin --bundles app "${CONFIG_ARGS[@]}" )

BUNDLE_DIR="$TAURI_DIR/target/universal-apple-darwin/release/bundle/macos"
APP_SRC="$BUNDLE_DIR/MikeDown.app"
[[ -d "$APP_SRC" ]] || { echo "ERROR: build did not produce $APP_SRC" >&2; exit 1; }

# Work on a copy so the target dir keeps Tauri's output untouched.
APP="$WORK/MikeDown.app"
ditto "$APP_SRC" "$APP"

ARCHS="$(lipo -archs "$APP/Contents/MacOS/mikedown-desktop" 2>/dev/null || lipo -archs "$APP/Contents/MacOS/MikeDown")"
echo "      architectures: $ARCHS"
[[ "$ARCHS" == *arm64* && "$ARCHS" == *x86_64* ]] || { echo "ERROR: not universal: $ARCHS" >&2; exit 1; }
codesign --verify --deep --strict "$APP"
echo "      codesign --verify --deep --strict: OK"

# ── 3. Notarize + staple the app ─────────────────────────────────────────────

if [[ "$SKIP_NOTARIZE" != true ]]; then
    echo "[2/6] Notarizing the app (a few minutes)"
    ditto -c -k --sequesterRsrc --keepParent "$APP" "$WORK/app.zip"
    xcrun notarytool submit "$WORK/app.zip" --keychain-profile "$NOTARY_PROFILE" --wait | tee "$WORK/notary-app.txt"
    grep -q "status: Accepted" "$WORK/notary-app.txt" || { echo "ERROR: app notarization not accepted (see notarytool log)." >&2; exit 1; }
    xcrun stapler staple "$APP"
    xcrun stapler validate "$APP"
else
    echo "[2/6] Notarization SKIPPED"
fi

# ── 4. Updater payload ───────────────────────────────────────────────────────

echo "[3/6] Updater payload (.app.tar.gz + minisign signature)"
TARBALL="$OUTPUT_DIR/$NAME-macos-universal.app.tar.gz"
rm -f "$TARBALL" "$TARBALL.sig"
COPYFILE_DISABLE=1 tar -C "$WORK" -czf "$TARBALL" MikeDown.app
( cd "$PKG_DIR" && env -u TAURI_SIGNING_PRIVATE_KEY npx tauri signer sign -f "$KEY_PATH" --app-version "$VERSION" "$TARBALL" >/dev/null )
[[ -s "$TARBALL.sig" ]] || { echo "ERROR: no signature written for $TARBALL" >&2; exit 1; }

else
    # --dmg-only: reuse an already signed and stapled app.
    APP_FROM="${APP_IN:-$OUTPUT_DIR/MikeDown.app}"
    [[ -d "$APP_FROM" ]] || { echo "ERROR: --dmg-only needs a stapled app at $APP_FROM (use --app)." >&2; exit 1; }
    xcrun stapler validate "$APP_FROM" >/dev/null || { echo "ERROR: $APP_FROM is not stapled." >&2; exit 1; }
    APP="$WORK/MikeDown.app"
    ditto "$APP_FROM" "$APP"
    codesign --verify --deep --strict "$APP"
    TARBALL=""
    echo "[1-3/6] skipped (--dmg-only, app from $APP_FROM)"
fi

# ── 5. DMG ───────────────────────────────────────────────────────────────────

echo "[4/6] DMG"
DMG="$OUTPUT_DIR/$NAME-macos-universal.dmg"
rm -f "$DMG"
"$SCRIPT_DIR/make-dmg.sh" --app "$APP" --output "$DMG" --volname "MikeDown" \
    --background "$SCRIPT_DIR/assets/dmg/background.png"
codesign --force --sign "$IDENTITY" --timestamp "$DMG"

if [[ "$SKIP_NOTARIZE" != true ]]; then
    echo "[5/6] Notarizing the DMG"
    xcrun notarytool submit "$DMG" --keychain-profile "$NOTARY_PROFILE" --wait | tee "$WORK/notary-dmg.txt"
    grep -q "status: Accepted" "$WORK/notary-dmg.txt" || { echo "ERROR: DMG notarization not accepted." >&2; exit 1; }
    xcrun stapler staple "$DMG"
else
    echo "[5/6] DMG notarization SKIPPED"
fi

# Keep the signed (and stapled) app beside the artifacts for inspection and
# for the staging updater test.
if [[ "${APP_FROM:-}" != "$OUTPUT_DIR/MikeDown.app" ]]; then
    rm -rf "$OUTPUT_DIR/MikeDown.app"
    ditto "$APP" "$OUTPUT_DIR/MikeDown.app"
fi

# ── 6. Verify ────────────────────────────────────────────────────────────────

echo "[6/6] Verification"
VERIFY="$OUTPUT_DIR/verify-macos.txt"
{
    echo "## codesign --verify --deep --strict --verbose=2 MikeDown.app"
    codesign --verify --deep --strict --verbose=2 "$OUTPUT_DIR/MikeDown.app" 2>&1 || true
    echo "## codesign -dv MikeDown.app"
    codesign -dv --verbose=2 "$OUTPUT_DIR/MikeDown.app" 2>&1 | grep -E "Authority|TeamIdentifier|Timestamp|flags|Runtime" || true
    echo "## spctl -a -vv MikeDown.app"
    spctl -a -vv "$OUTPUT_DIR/MikeDown.app" 2>&1 || true
    echo "## stapler validate MikeDown.app"
    xcrun stapler validate "$OUTPUT_DIR/MikeDown.app" 2>&1 || true
    echo "## spctl -a -t open --context context:primary-signature -vv $(basename "$DMG")"
    spctl -a -t open --context context:primary-signature -vv "$DMG" 2>&1 || true
    echo "## stapler validate $(basename "$DMG")"
    xcrun stapler validate "$DMG" 2>&1 || true
    echo "## sizes"
    ls -l "$DMG" ${TARBALL:+"$TARBALL" "$TARBALL.sig"} | awk '{print $5, $NF}'
} | tee "$VERIFY"

echo ""
echo "Done:"
echo "  $DMG"
[[ -n "$TARBALL" ]] && echo "  $TARBALL (+ .sig)"
if [[ "$SKIP_NOTARIZE" == true ]]; then
    echo ""
    echo "  NOT NOTARIZED: Gatekeeper will reject this build on other Macs. Do not ship it."
fi
