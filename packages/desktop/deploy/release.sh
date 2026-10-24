#!/usr/bin/env bash
# packages/desktop/deploy/release.sh
# Cut a MikeDown Desktop release and stage it for upload. Publishing is a
# separate, explicit step (pack-for-lymedeploy.sh, or --publish here).
#
#   0. Show the release notes and make you confirm them (--yes skips), and
#      refuse to go on without the minisign updater key, before anything is
#      built: the notes go into every manifest, and a stale copy is the one
#      release mistake nothing downstream catches.
#   1. Bump the version in package.json, tauri.conf.json, Cargo.toml and
#      Cargo.lock together (sync-version.js) and commit "MikeDown Desktop x.y.z".
#   2. macOS: build-mac.sh (universal, Developer ID, notarized, stapled DMG and
#      signed updater .app.tar.gz).
#   3. Windows: remote-build-windows.sh (BEAST Scheduled Task, Trusted Signing,
#      updater .sig made here). The commit must be on origin first, so the
#      script stops after the Mac half and tells you to push, then re-run with
#      --no-bump. --windows-exe <file> takes an installer built at the console.
#   4. Manifests (make-latest-json.js): latest-darwin-aarch64.json,
#      latest-darwin-x86_64.json, latest-windows-x86_64.json for the platforms
#      that ship, and latest.json only for a full release (split-release rule).
#      Every signature is verified against tauri.conf.json's pubkey and must
#      carry the signed version, or nothing is written.
#   5. Stage deploy/dist/<version>/upload/ (versioned artifacts, manifests,
#      download page and its screenshots, web.config) and gate it with check-upload.js.
#
# Linux (preview): a full release also builds an unsigned x86_64 AppImage
# (linux/build-linux.sh, Docker) as MikeDown-<v>-linux-x86_64.AppImage. It is a
# manual download only: no signature, no updater, and NO manifest entry. The
# page links it (render-page.js fills the page's Linux blocks); without it the
# blocks are removed. --mac-only/--windows-only releases skip it.
#
# Usage:
#   release.sh <patch|minor|major|x.y.z> [options]
#   release.sh --no-bump [options]            (re-run for the current version)
#
# Options:
#   --notes-file <md>          Release notes (manifests, update window, page).
#   --mac-only                 Ship macOS only: darwin manifests, latest.json untouched.
#   --windows-only             Ship Windows only: windows manifest, latest.json untouched.
#   --windows-exe <file>       Use this signed installer instead of the remote build.
#   --no-linux                 Skip the Linux (preview) AppImage (full releases build it by default).
#   --skip-notarize            Signed, not notarized. Not shippable.
#   --allow-unpublished-core   See check-core-pin.js (needed until core is on npm).
#   --yes                      Don't ask about the release notes (you just read them).
#   --publish                  After staging, run pack-for-lymedeploy.sh (push,
#                              release, deploy, wait, verify-published.sh).
#   --dist <dir>               Artifacts folder (default deploy/dist/<version>).
#   --dry-run                  Bump, commit, build, sign and publish nothing. Checks
#                              every precondition, then, if the artifacts for the
#                              version are already in --dist, writes the manifests
#                              and the upload folder into a temp dir, gates it, and
#                              runs pack-for-lymedeploy.sh --dry-run on it.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PKG_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
REPO_ROOT="$(cd "$PKG_DIR/../.." && pwd)"
SITE_SRC="$REPO_ROOT/website/mikedown-desktop"
BASE_URL="https://www.iadev.net/mikedown/"

BUMP=""; NO_BUMP=false; NOTES=""; MAC_ARGS=(); CORE_FLAG=(); MAC_ONLY=false; WIN_ONLY=false; WIN_EXE=""
ASSUME_YES=false; DRY_RUN=false; PUBLISH=false; DIST=""; NO_LINUX=false
while [[ $# -gt 0 ]]; do
    case "$1" in
        --no-bump) NO_BUMP=true; shift ;;
        --notes-file) NOTES="$2"; shift 2 ;;
        --skip-notarize) MAC_ARGS+=(--skip-notarize); shift ;;
        --allow-unpublished-core) CORE_FLAG=(--allow-unpublished-core); shift ;;
        --mac-only) MAC_ONLY=true; shift ;;
        --windows-only) WIN_ONLY=true; shift ;;
        --windows-exe) WIN_EXE="$2"; shift 2 ;;
        --no-linux) NO_LINUX=true; shift ;;
        --yes|-y) ASSUME_YES=true; shift ;;
        --dry-run) DRY_RUN=true; shift ;;
        --publish) PUBLISH=true; shift ;;
        --dist) DIST="$2"; shift 2 ;;
        -h|--help) awk 'NR == 1 && /^#!/ { next } /^#/ { sub(/^# ?/, ""); print; next } { exit }' "$0"; exit 0 ;;
        -*) echo "Unknown option: $1" >&2; exit 2 ;;
        *) BUMP="$1"; shift ;;
    esac
done
die() { echo "ERROR: $*" >&2; exit 1; }
[[ -n "$BUMP" || "$NO_BUMP" == true ]] || { echo "usage: release.sh <patch|minor|major|x.y.z> | --no-bump [options]" >&2; exit 2; }
[[ "$MAC_ONLY" == true && "$WIN_ONLY" == true ]] && die "--mac-only and --windows-only are exclusive."
[[ -n "$WIN_EXE" && "$MAC_ONLY" == true ]] && die "--windows-exe makes no sense with --mac-only."
[[ -n "$NOTES" && ! -f "$NOTES" ]] && die "notes file $NOTES not found."
SHIP_MAC=true; SHIP_WIN=true; SHIP_LINUX=true
[[ "$WIN_ONLY" == true ]] && SHIP_MAC=false
[[ "$MAC_ONLY" == true ]] && SHIP_WIN=false
[[ "$MAC_ONLY" == true || "$WIN_ONLY" == true || "$NO_LINUX" == true ]] && SHIP_LINUX=false
if [[ "$SHIP_MAC" == true && "$SHIP_WIN" == true ]]; then PLATFORMS="mac,windows"; KIND="full release"; VERIFY_FLAG=""
elif [[ "$SHIP_MAC" == true ]]; then PLATFORMS="mac"; KIND="macOS-only release"; VERIFY_FLAG="--mac-only"
else PLATFORMS="windows"; KIND="Windows-only release"; VERIFY_FLAG="--windows-only"; fi

DIRTY="$(git -C "$REPO_ROOT" status --porcelain --untracked-files=no)"
if [[ -n "$DIRTY" ]]; then
    [[ "$DRY_RUN" == true ]] || die "commit or stash tracked changes first; a release builds a commit."
    echo "(dry run) tracked changes present; a real run would stop here." >&2
fi

# Version (a dry run computes the bump without writing it)
CURRENT="$(node "$SCRIPT_DIR/sync-version.js" --check)"
if [[ "$NO_BUMP" == true ]]; then
    VERSION="$CURRENT"
else
    VERSION="$(node -e 'import(process.argv[1]).then(m => console.log(m.bumpVersion(process.argv[2], process.argv[3])))' \
        "$SCRIPT_DIR/lib/release-lib.js" "$CURRENT" "$BUMP")"
fi
[[ -z "$DIST" ]] && DIST="$SCRIPT_DIR/dist/$VERSION"
echo "MikeDown Desktop $VERSION, $KIND$([[ "$DRY_RUN" == true ]] && echo ' (DRY RUN: nothing is bumped, built, signed or published)')"

# ── 0a. Release notes: the one thing that stays human ───────────────────────
echo ""
echo "──── Release notes for $VERSION ($([[ -n "$NOTES" ]] && echo "$NOTES" || echo 'no --notes-file')) ────"
if [[ -n "$NOTES" && -s "$NOTES" ]]; then sed 's/^/  /' "$NOTES"
else echo "  (none: the update window will say \"No release notes were provided for this version.\")"; fi
echo "────"
if [[ "$ASSUME_YES" != true && "$DRY_RUN" != true ]]; then
    [[ -t 0 ]] || die "not a terminal, so the notes cannot be confirmed; pass --yes once you have read them."
    read -r -p "  Do these notes describe $VERSION (and not the last release)? [y/N] " reply
    [[ "$reply" =~ ^[Yy]$ ]] || { echo "Stopped. Fix the notes, then re-run."; exit 1; }
fi

# ── 0b. The minisign updater key: refuse to sign without it ─────────────────
KEY_PATH="${TAURI_SIGNING_PRIVATE_KEY_PATH:-$HOME/.tauri/mikedown.key}"
[[ -s "$KEY_PATH" ]] || die "updater signing key missing at $KEY_PATH. Restore it from backup; a release signed with any other key can never be installed by an existing copy."
if [[ -z "${TAURI_SIGNING_PRIVATE_KEY_PASSWORD:-}" ]]; then
    security find-generic-password -s mikedown-updater-key >/dev/null 2>&1 \
        || die "Keychain item mikedown-updater-key (the key's password) not found; set TAURI_SIGNING_PRIVATE_KEY_PASSWORD or restore it."
fi
echo "Updater key: $KEY_PATH (password from $([[ -n "${TAURI_SIGNING_PRIVATE_KEY_PASSWORD:-}" ]] && echo env || echo 'Keychain mikedown-updater-key'))"

# ── 1. Version bump + commit ────────────────────────────────────────────────
if [[ "$NO_BUMP" != true ]]; then
    if [[ "$DRY_RUN" == true ]]; then
        echo "(dry run) would run: sync-version.js $BUMP  ($CURRENT -> $VERSION) and commit \"MikeDown Desktop $VERSION\""
    else
        node "$SCRIPT_DIR/sync-version.js" "$BUMP" >/dev/null
        git -C "$REPO_ROOT" add packages/desktop/package.json packages/desktop/src-tauri/tauri.conf.json \
            packages/desktop/src-tauri/Cargo.toml packages/desktop/src-tauri/Cargo.lock
        git -C "$REPO_ROOT" commit -q -m "MikeDown Desktop $VERSION"
    fi
fi
node "$SCRIPT_DIR/check-core-pin.js" ${CORE_FLAG[@]+"${CORE_FLAG[@]}"}
[[ "$DRY_RUN" == true ]] || mkdir -p "$DIST"
echo "Release $VERSION from $(git -C "$REPO_ROOT" rev-parse --short HEAD) -> $DIST"

MAC_TAR="MikeDown-$VERSION-macos-universal.app.tar.gz"
MAC_DMG="MikeDown-$VERSION-macos-universal.dmg"
WIN_NAME="MikeDown-$VERSION-windows-x64-setup.exe"
LINUX_NAME="MikeDown-$VERSION-linux-x86_64.AppImage"

# ── 2. macOS ────────────────────────────────────────────────────────────────
if [[ "$SHIP_MAC" == true ]]; then
    if [[ -f "$DIST/$MAC_TAR.sig" ]]; then
        echo "macOS artifacts already in $DIST; delete them to rebuild."
    elif [[ "$DRY_RUN" == true ]]; then
        echo "(dry run) would run: build-mac.sh --output $DIST ${MAC_ARGS[*]-} ${CORE_FLAG[*]-}"
    else
        "$SCRIPT_DIR/build-mac.sh" --output "$DIST" ${MAC_ARGS[@]+"${MAC_ARGS[@]}"} ${CORE_FLAG[@]+"${CORE_FLAG[@]}"}
    fi
fi

# ── 2b. Linux (preview) ─────────────────────────────────────────────────────
if [[ "$SHIP_LINUX" == true ]]; then
    if [[ -f "$DIST/$LINUX_NAME" ]]; then
        echo "Linux AppImage already in $DIST; delete it to rebuild."
    elif [[ "$DRY_RUN" == true ]]; then
        echo "(dry run) would run: linux/build-linux.sh --output $DIST, then rename MikeDown_${VERSION}_amd64.AppImage to $LINUX_NAME"
    else
        "$SCRIPT_DIR/linux/build-linux.sh" --output "$DIST"
        [[ -f "$DIST/MikeDown_${VERSION}_amd64.AppImage" ]] || die "build-linux.sh did not leave MikeDown_${VERSION}_amd64.AppImage in $DIST."
        mv "$DIST/MikeDown_${VERSION}_amd64.AppImage" "$DIST/$LINUX_NAME"
    fi
fi

# ── 3. Windows ──────────────────────────────────────────────────────────────
if [[ "$SHIP_WIN" == true ]]; then
    if [[ -n "$WIN_EXE" ]]; then
        if [[ "$DRY_RUN" == true ]]; then
            echo "(dry run) would copy $WIN_EXE to $DIST/$WIN_NAME and sign it (tauri signer sign --app-version $VERSION)"
        else
            cp "$WIN_EXE" "$DIST/$WIN_NAME"
            TAURI_SIGNING_PRIVATE_KEY_PASSWORD="${TAURI_SIGNING_PRIVATE_KEY_PASSWORD:-$(security find-generic-password -s mikedown-updater-key -w)}" \
                bash -c 'cd "$0" && env -u TAURI_SIGNING_PRIVATE_KEY npx tauri signer sign -f "$1" --app-version "$2" "$3" >/dev/null' \
                "$PKG_DIR" "$KEY_PATH" "$VERSION" "$DIST/$WIN_NAME"
            echo "WARNING: $WIN_NAME came from --windows-exe; its Authenticode signature was not checked on this Mac."
        fi
    elif [[ -f "$DIST/$WIN_NAME.sig" ]]; then
        echo "Windows installer already in $DIST; delete it to rebuild."
    elif [[ "$DRY_RUN" == true ]]; then
        echo "(dry run) would run: remote-build-windows.sh --version $VERSION --dest $DIST ${CORE_FLAG[*]-}"
    else
        set +e
        "$SCRIPT_DIR/remote-build-windows.sh" --version "$VERSION" --dest "$DIST" ${CORE_FLAG[@]+"${CORE_FLAG[@]}"}
        rc=$?
        set -e
        if [[ $rc -ne 0 ]]; then
            echo ""
            echo "Windows build did not complete (exit $rc).$([[ "$SHIP_MAC" == true ]] && echo ' The Mac half is staged.')"
            [[ $rc -eq 10 ]] && echo "Fix the precondition above (usually: git push origin HEAD), then: $0 --no-bump $([[ -n "$NOTES" ]] && echo "--notes-file $NOTES ")${CORE_FLAG[*]-}"
            exit $rc
        fi
    fi
fi

# ── 4 + 5. Manifests, upload folder, gate ───────────────────────────────────
NEED=()
[[ "$SHIP_MAC" == true ]] && NEED+=("$MAC_TAR" "$MAC_TAR.sig" "$MAC_DMG")
[[ "$SHIP_WIN" == true ]] && NEED+=("$WIN_NAME" "$WIN_NAME.sig")
[[ "$SHIP_LINUX" == true ]] && NEED+=("$LINUX_NAME")
MISSING=()
for f in "${NEED[@]}"; do [[ -f "$DIST/$f" ]] || MISSING+=("$f"); done
if [[ ${#MISSING[@]} -gt 0 ]]; then
    [[ "$DRY_RUN" == true ]] || die "missing from $DIST after the builds: ${MISSING[*]}"
    echo ""
    echo "Dry run complete. Not in $DIST yet, so manifests and staging were not exercised: ${MISSING[*]}"
    echo "(Point --dist at a folder that has them to dry-run the rest.)"
    exit 0
fi

if [[ "$DRY_RUN" == true ]]; then
    WORK="$(mktemp -d -t mikedown-release-dry-run)"
    MANIFEST_DIR="$WORK"; UPLOAD="$WORK/upload"
    echo ""
    echo "(dry run) manifests and upload folder go to $WORK; $DIST is only read."
else
    MANIFEST_DIR="$DIST"; UPLOAD="$DIST/upload"
fi

NOTES_ARGS=()
[[ -n "$NOTES" ]] && NOTES_ARGS=(--notes-file "$NOTES")
echo ""
echo "Manifests ($KIND):"
node "$SCRIPT_DIR/make-latest-json.js" --version "$VERSION" --dir "$DIST" --out-dir "$MANIFEST_DIR" \
    --platforms "$PLATFORMS" --base-url "$BASE_URL" ${NOTES_ARGS[@]+"${NOTES_ARGS[@]}"}

rm -rf "$UPLOAD"
mkdir -p "$UPLOAD"
STAGE=()
[[ "$SHIP_MAC" == true ]] && STAGE+=("$DIST/$MAC_DMG" "$DIST/$MAC_TAR")
[[ "$SHIP_WIN" == true ]] && STAGE+=("$DIST/$WIN_NAME")
[[ "$SHIP_LINUX" == true ]] && STAGE+=("$DIST/$LINUX_NAME")
for m in latest-darwin-aarch64.json latest-darwin-x86_64.json latest-windows-x86_64.json latest.json; do
    [[ -f "$MANIFEST_DIR/$m" ]] && STAGE+=("$MANIFEST_DIR/$m")
done
cp "${STAGE[@]}" "$UPLOAD/"
# The page's Linux blocks are filled from the staged AppImage (or removed).
LINUX_ARGS=()
[[ "$SHIP_LINUX" == true ]] && LINUX_ARGS=(--linux "$DIST/$LINUX_NAME")
node "$SCRIPT_DIR/render-page.js" --in "$SITE_SRC/index.html" --out "$UPLOAD/index.html" --version "$VERSION" --base-url "$BASE_URL" \
    ${LINUX_ARGS[@]+"${LINUX_ARGS[@]}"}
# The page's screenshots sit next to it; check-upload.js insists on exactly the
# images index.html shows.
find "$SITE_SRC" -maxdepth 1 -type f -name '*.png' -exec cp {} "$UPLOAD/" \;
cp "$SCRIPT_DIR/site/web.config" "$UPLOAD/web.config"
( cd "$UPLOAD" && shasum -a 256 -- * > SHA256SUMS.txt )
node "$SCRIPT_DIR/check-upload.js" --dir "$UPLOAD" --version "$VERSION" --platforms "$PLATFORMS" --base-url "$BASE_URL"

echo ""
echo "Staged for upload: $UPLOAD"
ls -l "$UPLOAD" | awk 'NR > 1 {printf "  %10s  %s\n", $5, $NF}'

if [[ "$DRY_RUN" == true ]]; then
    echo ""
    "$SCRIPT_DIR/pack-for-lymedeploy.sh" --version "$VERSION" --upload "$UPLOAD" --out "$WORK" --dry-run
    echo ""
    echo "Release dry run complete for $VERSION ($KIND). Scratch output: $WORK"
    exit 0
fi

if [[ "$PUBLISH" == true ]]; then
    "$SCRIPT_DIR/pack-for-lymedeploy.sh" --version "$VERSION" --upload "$UPLOAD" --out "$DIST"
    exit $?
fi

cat <<EOF

Next (nothing has left this Mac):
  1. Push the release commit:  git push origin HEAD   (tag: git tag desktop-v$VERSION && git push origin desktop-v$VERSION)
  2. Publish through LymeDeploy (pack, push, release, deploy to Production, wait, verify):
       $SCRIPT_DIR/pack-for-lymedeploy.sh --version $VERSION
     or rehearse it first with --dry-run. First time only: create the project with
       lymedeploy apply -f $SCRIPT_DIR/lymedeploy/deploy.yaml --dry-run   (then without --dry-run)
  3. If the project's purge step is still disabled, purge Cloudflare by hand for every
     manifest on apex and www (latest.json, latest-darwin-aarch64.json,
     latest-darwin-x86_64.json, latest-windows-x86_64.json) and /mikedown/.
  4. Verify what clients see (also run by step 2):
       $SCRIPT_DIR/verify-published.sh $VERSION $VERIFY_FLAG
  5. On a Mac and a Windows box running the previous version: Help > Check for
     Updates... finds $VERSION and installs it.
EOF
