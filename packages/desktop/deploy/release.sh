#!/usr/bin/env bash
# packages/desktop/deploy/release.sh
# Cut a MikeDown Desktop release and stage it for upload. Nothing here
# uploads, purges, pushes or publishes: it ends by printing the checklist.
#
#   1. Bump the version in package.json, tauri.conf.json, Cargo.toml and
#      Cargo.lock together (sync-version.js) and commit "MikeDown Desktop x.y.z".
#   2. macOS: build-mac.sh (universal, Developer ID, notarized, stapled DMG and
#      signed updater .app.tar.gz).
#   3. Windows: remote-build-windows.sh (BEAST Scheduled Task, Trusted Signing,
#      updater .sig made here). The commit must be on origin first, so the
#      script stops after the Mac half and tells you to push, then re-run with
#      --no-bump. --windows-exe <file> takes an installer built at the console.
#   4. latest.json (make-latest-json.js), the download page and web.config,
#      all staged into deploy/dist/<version>/upload/ with versioned names only.
#
# Usage:
#   release.sh <patch|minor|major|x.y.z> [options]
#   release.sh --no-bump [options]            (re-run for the current version)
#
# Options:
#   --notes-file <md>          Release notes for latest.json and the page.
#   --skip-notarize            Dry run (signed, not notarized). Not shippable.
#   --allow-unpublished-core   See check-core-pin.js (needed until core is on npm).
#   --mac-only                 Skip Windows; latest.json gets darwin entries only.
#   --windows-exe <file>       Use this signed installer instead of the remote build.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PKG_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
REPO_ROOT="$(cd "$PKG_DIR/../.." && pwd)"
SITE_SRC="$REPO_ROOT/website/mikedown-desktop"
BASE_URL="https://www.iadev.net/mikedown/"

BUMP=""; NO_BUMP=false; NOTES=""; MAC_ARGS=(); CORE_FLAG=(); MAC_ONLY=false; WIN_EXE=""
while [[ $# -gt 0 ]]; do
    case "$1" in
        --no-bump) NO_BUMP=true; shift ;;
        --notes-file) NOTES="$2"; shift 2 ;;
        --skip-notarize) MAC_ARGS+=(--skip-notarize); shift ;;
        --allow-unpublished-core) CORE_FLAG=(--allow-unpublished-core); shift ;;
        --mac-only) MAC_ONLY=true; shift ;;
        --windows-exe) WIN_EXE="$2"; shift 2 ;;
        -h|--help) awk 'NR == 1 && /^#!/ { next } /^#/ { sub(/^# ?/, ""); print; next } { exit }' "$0"; exit 0 ;;
        -*) echo "Unknown option: $1" >&2; exit 2 ;;
        *) BUMP="$1"; shift ;;
    esac
done
[[ -n "$BUMP" || "$NO_BUMP" == true ]] || { echo "usage: release.sh <patch|minor|major|x.y.z> | --no-bump [options]" >&2; exit 2; }

if [[ -n "$(git -C "$REPO_ROOT" status --porcelain --untracked-files=no)" ]]; then
    echo "ERROR: commit or stash tracked changes first; a release builds a commit." >&2; exit 1
fi

# 1. Version
if [[ "$NO_BUMP" == true ]]; then
    VERSION="$(node "$SCRIPT_DIR/sync-version.js" --check)"
else
    VERSION="$(node "$SCRIPT_DIR/sync-version.js" "$BUMP" | tail -1)"
    git -C "$REPO_ROOT" add packages/desktop/package.json packages/desktop/src-tauri/tauri.conf.json \
        packages/desktop/src-tauri/Cargo.toml packages/desktop/src-tauri/Cargo.lock
    git -C "$REPO_ROOT" commit -q -m "MikeDown Desktop $VERSION"
fi
node "$SCRIPT_DIR/check-core-pin.js" ${CORE_FLAG[@]+"${CORE_FLAG[@]}"}
OUT="$SCRIPT_DIR/dist/$VERSION"
UPLOAD="$OUT/upload"
mkdir -p "$OUT"
echo "Release $VERSION from $(git -C "$REPO_ROOT" rev-parse --short HEAD) -> $OUT"

# 2. macOS
if [[ ! -f "$OUT/MikeDown-$VERSION-macos-universal.app.tar.gz.sig" ]]; then
    "$SCRIPT_DIR/build-mac.sh" --output "$OUT" ${MAC_ARGS[@]+"${MAC_ARGS[@]}"} ${CORE_FLAG[@]+"${CORE_FLAG[@]}"}
else
    echo "macOS artifacts already staged in $OUT; delete them to rebuild."
fi

# 3. Windows
WIN_NAME="MikeDown-$VERSION-windows-x64-setup.exe"
if [[ "$MAC_ONLY" != true ]]; then
    if [[ -n "$WIN_EXE" ]]; then
        cp "$WIN_EXE" "$OUT/$WIN_NAME"
        KEY_PATH="${TAURI_SIGNING_PRIVATE_KEY_PATH:-$HOME/.tauri/mikedown.key}"
        TAURI_SIGNING_PRIVATE_KEY_PASSWORD="${TAURI_SIGNING_PRIVATE_KEY_PASSWORD:-$(security find-generic-password -s mikedown-updater-key -w)}" \
            bash -c 'cd "$0" && env -u TAURI_SIGNING_PRIVATE_KEY npx tauri signer sign -f "$1" --app-version "$2" "$3" >/dev/null' \
            "$PKG_DIR" "$KEY_PATH" "$VERSION" "$OUT/$WIN_NAME"
        echo "WARNING: $WIN_NAME came from --windows-exe; its Authenticode signature was not checked on this Mac."
    elif [[ ! -f "$OUT/$WIN_NAME.sig" ]]; then
        set +e
        "$SCRIPT_DIR/remote-build-windows.sh" --version "$VERSION" --dest "$OUT" ${CORE_FLAG[@]+"${CORE_FLAG[@]}"}
        rc=$?
        set -e
        if [[ $rc -ne 0 ]]; then
            echo ""
            echo "Windows build did not complete (exit $rc). The Mac half is staged."
            [[ $rc -eq 10 ]] && echo "Fix the precondition above (usually: git push origin HEAD), then: $0 --no-bump ${CORE_FLAG[*]}"
            exit $rc
        fi
    fi
fi

# 4. Manifest, page, web.config
NOTES_ARGS=()
[[ -n "$NOTES" ]] && NOTES_ARGS=(--notes-file "$NOTES")
node "$SCRIPT_DIR/make-latest-json.js" --version "$VERSION" --dir "$OUT" --base-url "$BASE_URL" ${NOTES_ARGS[@]+"${NOTES_ARGS[@]}"}

rm -rf "$UPLOAD"
mkdir -p "$UPLOAD"
for f in "MikeDown-$VERSION-macos-universal.dmg" "MikeDown-$VERSION-macos-universal.app.tar.gz" \
         "MikeDown-$VERSION-macos-universal.app.tar.gz.sig" "$WIN_NAME" "$WIN_NAME.sig" latest.json; do
    [[ -f "$OUT/$f" ]] && cp "$OUT/$f" "$UPLOAD/"
done
cp "$SITE_SRC/index.html" "$UPLOAD/index.html"
cp "$SCRIPT_DIR/site/web.config" "$UPLOAD/web.config"
( cd "$UPLOAD" && shasum -a 256 * > SHA256SUMS.txt )

echo ""
echo "Staged for upload: $UPLOAD"
ls -l "$UPLOAD" | awk 'NR > 1 {printf "  %10s  %s\n", $5, $NF}'
cat <<EOF

Upload checklist (nothing has left this Mac):
  1. Push the release commit:  git push origin HEAD   (and tag: git tag desktop-v$VERSION && git push origin desktop-v$VERSION)
  2. RDP to iadev-prod and copy $UPLOAD/* into the /mikedown virtual
     directory's folder (Get-WebVirtualDirectory -Site Interapp; expected
     C:\\WebApps\\Downloads\\mikedown). ARTIFACTS FIRST, latest.json LAST.
     Keep earlier versions' files (rollback = swap latest.json back).
     First release only: create the vdir, and merge web.config rather than overwrite.
     Run icacls <file> /reset on anything moved in from %TEMP% (IIS 401 trap).
  3. Purge Cloudflare for https://www.iadev.net/mikedown/latest.json and
     https://iadev.net/mikedown/latest.json (and /mikedown/ for the page).
  4. Verify over HTTPS with a cache buster:
       curl -sI "https://www.iadev.net/mikedown/latest.json?cb=\$(date +%s)"
       curl -s  "https://www.iadev.net/mikedown/latest.json?cb=\$(date +%s)" | grep '"version": "$VERSION"'
       for f in \$(cut -c67- $UPLOAD/SHA256SUMS.txt); do curl -s "https://www.iadev.net/mikedown/\$f" | shasum -a 256; done
  5. On a Mac and a Windows box running the previous version: Help > Check for
     Updates... shows $VERSION; Restart Now installs and relaunches it.
EOF
