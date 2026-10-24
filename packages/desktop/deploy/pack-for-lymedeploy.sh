#!/usr/bin/env bash
# packages/desktop/deploy/pack-for-lymedeploy.sh
# Publish a staged MikeDown Desktop release through LymeDeploy:
#
#   pack     deploy/dist/<v>/upload/  ->  MikeDown.Downloads.<v>.nupkg (verified)
#   push     lymedeploy push-package
#   release  lymedeploy create-release --project mikedown-downloads
#   deploy   lymedeploy deploy --environment Production --wait  (blocks until
#            succeeded / failed / cancelled), then verify-published.sh
#
# Modeled on ~/git/lymescribe/deploy/pack-for-lymedeploy.sh and release.sh.
# The project (deploy/lymedeploy/deploy.yaml) runs publish-files into the
# /mikedown folder on IADEV-2025: adds and replaces, never prunes (older
# versions stay for rollback), manifests strictly last, web.config protected,
# ACLs reset; then smoke-tests the manifests; then (once enabled) purges
# Cloudflare for every manifest URL on apex and www.
#
# Run it AFTER release.sh has staged and checked the folder.
#
# Usage:
#   pack-for-lymedeploy.sh [--version x.y.z] [options]
#
#   --version x.y.z      Release to publish (default: the version in package.json)
#   --upload DIR         Staged folder (default: deploy/dist/<v>/upload)
#   --out DIR            Where the .nupkg goes (default: deploy/dist/<v>)
#   --project SLUG       LymeDeploy project (default: mikedown-downloads)
#   --environment ENV    Environment (default: Production)
#   --release-version V  LymeDeploy release version (default: <v>). Use e.g.
#                        0.2.0-r2 to cut a new release of the same package,
#                        which is the only way a deployment picks up project
#                        variables added after the first release was created.
#   --from-pack | --from-push | --from-release | --from-deploy
#                        Resume a publish that stopped partway.
#   --wait-timeout MIN   Minutes to wait for the deployment (default 15).
#                        Giving up is not a failure; the deployment carries on.
#   --dry-run            Build and verify the .nupkg, print every LymeDeploy
#                        command, run none of them. Needs no CLI or network.
#
# The CLI comes from $LYMEDEPLOY_CLI, else `lymedeploy` on PATH. Server and
# API key come from the CLI's own config; this script never reads or prints a key.

set -euo pipefail

print_usage() { awk 'NR == 1 && /^#!/ { next } /^#/ { sub(/^# ?/, ""); print; next } { exit }' "$0"; }

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PACKAGE_ID="MikeDown.Downloads"
DASHBOARD_URL="https://deploy.lymestack.com"

VERSION=""; UPLOAD=""; OUT_DIR=""; PROJECT="mikedown-downloads"; ENVIRONMENT="Production"
RELEASE_VERSION=""; START_AT="pack"; DRY_RUN=0; WAIT_MIN=15
while [[ $# -gt 0 ]]; do
    case "$1" in
        --version) VERSION="$2"; shift 2 ;;
        --upload) UPLOAD="$2"; shift 2 ;;
        --out) OUT_DIR="$2"; shift 2 ;;
        --project) PROJECT="$2"; shift 2 ;;
        --environment) ENVIRONMENT="$2"; shift 2 ;;
        --release-version) RELEASE_VERSION="$2"; shift 2 ;;
        --from-pack) START_AT="pack"; shift ;;
        --from-push) START_AT="push"; shift ;;
        --from-release) START_AT="release"; shift ;;
        --from-deploy) START_AT="deploy"; shift ;;
        --wait-timeout) WAIT_MIN="$2"; shift 2 ;;
        --dry-run) DRY_RUN=1; shift ;;
        -h|--help) print_usage; exit 0 ;;
        *) echo "Unknown arg: $1 (see --help)" >&2; exit 2 ;;
    esac
done

[[ -z "$VERSION" ]] && VERSION="$(node "$SCRIPT_DIR/sync-version.js" --check)"
[[ -z "$UPLOAD" ]] && UPLOAD="$SCRIPT_DIR/dist/$VERSION/upload"
[[ -z "$OUT_DIR" ]] && OUT_DIR="$SCRIPT_DIR/dist/$VERSION"
[[ -z "$RELEASE_VERSION" ]] && RELEASE_VERSION="$VERSION"
NUPKG="$OUT_DIR/$PACKAGE_ID.$VERSION.nupkg"

hr()   { printf -- '-%.0s' {1..64}; echo; }
say()  { echo "  $*"; }
step() { echo ""; hr; echo "  $*"; hr; }
step_index() { case "$1" in pack) echo 1 ;; push) echo 2 ;; release) echo 3 ;; deploy) echo 4 ;; esac; }
should_run() { [[ "$(step_index "$1")" -ge "$(step_index "$START_AT")" ]]; }
resume_hint() {
    echo "" >&2
    echo "  Resume from this step once it is fixed:" >&2
    echo "    $0 --version $VERSION${RELEASE_VERSION:+ --release-version $RELEASE_VERSION} --from-$1" >&2
    echo "" >&2
}

# ── 0. CLI first: a missing CLI should cost a second, not a pack ─────────────
CLI=""
if [[ -n "${LYMEDEPLOY_CLI:-}" ]]; then
    [[ -x "$LYMEDEPLOY_CLI" ]] || { echo "ERROR: \$LYMEDEPLOY_CLI ($LYMEDEPLOY_CLI) is not executable." >&2; exit 1; }
    CLI="$LYMEDEPLOY_CLI"
elif command -v lymedeploy >/dev/null 2>&1; then
    CLI="$(command -v lymedeploy)"
elif [[ "$DRY_RUN" == 1 ]]; then
    CLI="lymedeploy"
    echo "  (dry run) the LymeDeploy CLI is not on PATH; a real run needs it." >&2
else
    cat >&2 <<EOF
ERROR: the LymeDeploy CLI was not found. Point \$LYMEDEPLOY_CLI at it or put
'lymedeploy' on PATH. To build it (writes nothing into the lymedeploy repo):

  dotnet publish ~/git/lymedeploy/WebApi/LymeDeploy.Cli/LymeDeploy.Cli.csproj \\
      -c Release --artifacts-path /tmp/lymedeploy-cli-build -o ~/.local/lymedeploy-cli
  ln -sf ~/.local/lymedeploy-cli/lymedeploy ~/.local/bin/lymedeploy

Packing alone still works: $0 --version $VERSION --dry-run
EOF
    exit 1
fi

run() { # echo, then run unless --dry-run
    say "\$ $*"
    [[ "$DRY_RUN" == 1 ]] && return 0
    "$@"
}

echo ""
hr
echo "  Publishing MikeDown Desktop $VERSION through LymeDeploy"
hr
say "staged     $UPLOAD"
say "package    $PACKAGE_ID $VERSION  ->  $NUPKG"
say "project    $PROJECT  ->  $ENVIRONMENT   (release $RELEASE_VERSION)"
say "CLI        $CLI"
[[ "$START_AT" != pack ]] && say "starting at  $START_AT (earlier steps skipped)"
[[ "$DRY_RUN" == 1 ]] && say "DRY RUN: nothing is pushed, released or deployed"

# Which platforms the staged folder ships: latest.json means a full release;
# otherwise the per-target manifests say which half. check-upload.js then
# holds the folder to that (a full release missing a platform fails there).
PLATFORMS=""
if [[ -d "$UPLOAD" ]]; then
    if [[ -f "$UPLOAD/latest.json" ]]; then PLATFORMS="mac,windows"
    elif [[ -f "$UPLOAD/latest-darwin-aarch64.json" && ! -f "$UPLOAD/latest-windows-x86_64.json" ]]; then PLATFORMS="mac"
    elif [[ -f "$UPLOAD/latest-windows-x86_64.json" && ! -f "$UPLOAD/latest-darwin-aarch64.json" ]]; then PLATFORMS="windows"
    else PLATFORMS="mac,windows"; fi
fi
VERIFY_FLAG=""
[[ "$PLATFORMS" == mac ]] && VERIFY_FLAG="--mac-only"
[[ "$PLATFORMS" == windows ]] && VERIFY_FLAG="--windows-only"

# ── 1. Pack ──────────────────────────────────────────────────────────────────
if should_run pack; then
    step "1. Pack: check the staged folder, build and verify the .nupkg"
    [[ -d "$UPLOAD" ]] || { echo "ERROR: $UPLOAD does not exist. Run release.sh first." >&2; exit 1; }
    say "release type: $PLATFORMS"
    node "$SCRIPT_DIR/check-upload.js" --dir "$UPLOAD" --version "$VERSION" --platforms "$PLATFORMS" || { resume_hint pack; exit 1; }
    mkdir -p "$OUT_DIR"
    rm -f "$NUPKG"
    # A .nupkg is a zip with a .nuspec; LymeDeploy reads the identity from the
    # .nuspec and publishes the archive root into the target folder. Stored,
    # not deflated: the payload is already-compressed DMG/tar.gz/NSIS/AppImage.
    PACKAGE_ID="$PACKAGE_ID" VERSION="$VERSION" SRC="$UPLOAD" NUPKG="$NUPKG" python3 -I - <<'PYEOF'
import os, zipfile
pid, ver, src, out = (os.environ[k] for k in ('PACKAGE_ID', 'VERSION', 'SRC', 'NUPKG'))
nuspec = f'''<?xml version="1.0" encoding="utf-8"?>
<package xmlns="http://schemas.microsoft.com/packaging/2013/05/nuspec.xsd">
  <metadata>
    <id>{pid}</id>
    <version>{ver}</version>
    <authors>Interapp Development, Inc.</authors>
    <description>MikeDown Desktop {ver} downloads and updater manifests, published to iadev.net/mikedown/ by LymeDeploy.</description>
  </metadata>
</package>
'''
content_types = '''<?xml version="1.0" encoding="utf-8"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="nuspec" ContentType="application/octet" />
  <Default Extension="dmg" ContentType="application/octet-stream" />
  <Default Extension="exe" ContentType="application/octet-stream" />
  <Default Extension="gz" ContentType="application/gzip" />
  <Default Extension="json" ContentType="application/json" />
  <Default Extension="html" ContentType="text/html" />
  <Default Extension="config" ContentType="application/xml" />
  <Default Extension="txt" ContentType="text/plain" />
  <Default Extension="png" ContentType="image/png" />
  <Default Extension="AppImage" ContentType="application/octet-stream" />
</Types>
'''
names = sorted(n for n in os.listdir(src) if n != '.DS_Store')
dirs = [n for n in names if os.path.isdir(os.path.join(src, n))]
if dirs:
    raise SystemExit(f'ERROR: {src} has subfolders {dirs}; the payload must be flat.')
with zipfile.ZipFile(out, 'w', zipfile.ZIP_STORED) as z:
    z.writestr(f'{pid}.nuspec', nuspec)
    z.writestr('[Content_Types].xml', content_types)
    for n in names:
        z.write(os.path.join(src, n), n)
# Round trip: readable, flat, and exactly the folder's files at their sizes.
with zipfile.ZipFile(out) as z:
    if z.testzip():
        raise SystemExit(f'ERROR: {out} is corrupt.')
    payload = {i.filename: i.file_size for i in z.infolist()
               if i.filename not in (f'{pid}.nuspec', '[Content_Types].xml')}
    if any('/' in n for n in payload):
        raise SystemExit('ERROR: nested entries in the package.')
    want = {n: os.path.getsize(os.path.join(src, n)) for n in names}
    if payload != want:
        raise SystemExit(f'ERROR: package contents differ from {src}.')
print(f'  packed {len(payload)} files, {sum(payload.values())/1048576:.1f} MB, verified')
PYEOF
    say "wrote $NUPKG ($(du -h "$NUPKG" | cut -f1))"
fi

# ── 2. Push ──────────────────────────────────────────────────────────────────
if should_run push; then
    step "2. Push $PACKAGE_ID $VERSION to the LymeDeploy feed"
    [[ -f "$NUPKG" ]] || { echo "ERROR: $NUPKG not found (run from --from-pack)." >&2; exit 1; }
    set +e
    run "$CLI" push-package "$NUPKG"
    RC=$?
    set -e
    if [[ "$RC" != 0 ]]; then
        echo "  push failed (exit $RC); NOT creating a release." >&2
        [[ "$RC" == 4 ]] && echo "  Exit 4 is Conflict: $PACKAGE_ID $VERSION is already on the feed. If it is this exact package, resume with --from-release; if not, ship a new version." >&2
        [[ "$RC" == 5 ]] && echo "  Exit 5 is Unauthorized: the API key was rejected (lymedeploy login / apikey create)." >&2
        resume_hint push; exit 1
    fi
fi

# ── 3. Release ───────────────────────────────────────────────────────────────
if should_run release; then
    step "3. Create release $RELEASE_VERSION in $PROJECT"
    set +e
    run "$CLI" create-release --project "$PROJECT" --version "$RELEASE_VERSION" \
        --package "$PACKAGE_ID=$VERSION" --notes "MikeDown Desktop $VERSION"
    RC=$?
    set -e
    if [[ "$RC" == 4 ]]; then
        say "release $RELEASE_VERSION already exists; continuing to the deploy."
    elif [[ "$RC" != 0 ]]; then
        echo "  create-release failed (exit $RC)." >&2
        [[ "$RC" == 3 ]] && echo "  Exit 3 is NotFound: does project '$PROJECT' exist? (lymedeploy apply -f $SCRIPT_DIR/lymedeploy/deploy.yaml)" >&2
        [[ "$RC" == 5 ]] && echo "  Exit 5 is Unauthorized: the API key was rejected." >&2
        resume_hint release; exit 1
    fi
fi

# ── 4. Deploy, wait, verify ──────────────────────────────────────────────────
if should_run deploy; then
    step "4. Deploy $RELEASE_VERSION to $ENVIRONMENT and wait"
    set +e
    run "$CLI" deploy --project "$PROJECT" --version "$RELEASE_VERSION" --environment "$ENVIRONMENT" \
        --wait --wait-timeout "$WAIT_MIN"
    RC=$?
    set -e
    case "$RC" in
        0) [[ "$DRY_RUN" == 1 ]] || say "deployment succeeded." ;;
        9)  echo "  The deployment FAILED or was cancelled. MikeDown $VERSION is NOT published." >&2
            echo "  Step logs: $DASHBOARD_URL ($PROJECT -> $ENVIRONMENT -> $RELEASE_VERSION)." >&2
            resume_hint deploy; exit 1 ;;
        10) echo "  Gave up waiting after $WAIT_MIN min. Not a failure: the deployment is probably still running." >&2
            echo "  Check: $CLI status --project $PROJECT --version $RELEASE_VERSION   or $DASHBOARD_URL" >&2
            echo "  When it shows succeeded: $SCRIPT_DIR/verify-published.sh $VERSION $VERIFY_FLAG" >&2
            exit 1 ;;
        4)  echo "  Exit 4 is Conflict: a deployment of $PROJECT to $ENVIRONMENT is already running. Wait for it." >&2
            resume_hint deploy; exit 1 ;;
        *)  echo "  deploy failed (exit $RC). A 400 usually means the environment progression is not Production-only." >&2
            resume_hint deploy; exit 1 ;;
    esac

    step "5. Verify what the internet sees"
    if [[ "$DRY_RUN" == 1 ]]; then
        say "\$ $SCRIPT_DIR/verify-published.sh $VERSION $VERIFY_FLAG"
    elif ! "$SCRIPT_DIR/verify-published.sh" "$VERSION" $VERIFY_FLAG; then
        echo "" >&2
        echo "  The deployment succeeded but verification failed. If it says 'stale edge cache'," >&2
        echo "  purge Cloudflare for the manifests (apex and www) and re-run:" >&2
        echo "    $SCRIPT_DIR/verify-published.sh $VERSION $VERIFY_FLAG" >&2
        exit 1
    fi
fi

if [[ "$DRY_RUN" == 1 ]]; then
    step "Dry run complete: package built and verified, nothing pushed or deployed"
    exit 0
fi
step "Published MikeDown Desktop $VERSION"
say "Still yours: tag desktop-v$VERSION and push; if the purge step is still disabled"
say "in $PROJECT, purge the manifest URLs by hand (both apex and www)."
