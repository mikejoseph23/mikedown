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
#                        command, run none of them. Needs no CLI or network
#                        (except --site, which asks the live latest.json for the
#                        desktop version unless --desktop-version is given).
#
# Site mode (publish the website without a desktop release):
#   --site               Pack ONLY site files: website/dist (build it first:
#                        npm run build:site), the re-rendered desktop index.html
#                        and its screenshots. Never latest*.json, artifacts or
#                        web.config (the pack fails if any is present).
#   --desktop-version V  The published desktop version the page is rendered for
#                        (default: read from https://www.iadev.net/mikedown/latest.json)
#   --site-n N           Site build number; release/package version is
#                        <desktop-version>-site.N (default 1). N must be new.
#   --site-version V     Use this exact version instead (e.g. site-20261024.1).
#   --linux FILE         The published Linux AppImage the page links, for its size
#                        (default: deploy/dist/<desktop-version>/ if present, else
#                        the Linux blocks are dropped only with --no-linux).
#   --no-linux           Render the page without the Linux download.
#   --dist DIR           Built site folder (default: <repo>/website/dist).
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
SITE=0; DESKTOP_VERSION=""; SITE_N=1; SITE_VERSION=""; LINUX_FILE=""; NO_LINUX=0; SITE_DIST=""
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
        --site) SITE=1; shift ;;
        --desktop-version) DESKTOP_VERSION="$2"; shift 2 ;;
        --site-n) SITE_N="$2"; shift 2 ;;
        --site-version) SITE_VERSION="$2"; shift 2 ;;
        --linux) LINUX_FILE="$2"; shift 2 ;;
        --no-linux) NO_LINUX=1; shift ;;
        --dist) SITE_DIST="$2"; shift 2 ;;
        --dry-run) DRY_RUN=1; shift ;;
        -h|--help) print_usage; exit 0 ;;
        *) echo "Unknown arg: $1 (see --help)" >&2; exit 2 ;;
    esac
done

BASE_URL="https://www.iadev.net/mikedown/"
if [[ "$SITE" == 1 ]]; then
    # Site-only release. The package version is <desktop-version>-site.N: a
    # prerelease of the desktop version, so it sorts BELOW the desktop release
    # in semver. LymeDeploy never orders versions (a release version is a free
    # string, unique per project; the feed only needs a unique id+version), so
    # nothing here outranks or replaces the desktop release.
    if [[ -z "$DESKTOP_VERSION" ]]; then
        DESKTOP_VERSION="$(curl -fsS "${BASE_URL}latest.json?cb=$(date +%s)" | node -e 'process.stdout.write(JSON.parse(require("fs").readFileSync(0,"utf8")).version)')" \
            || { echo "ERROR: could not read the published desktop version from ${BASE_URL}latest.json; pass --desktop-version." >&2; exit 1; }
    fi
    [[ "$DESKTOP_VERSION" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]] || { echo "ERROR: desktop version '$DESKTOP_VERSION' is not x.y.z." >&2; exit 1; }
    [[ "$SITE_N" =~ ^[0-9]+$ ]] || { echo "ERROR: --site-n must be a number." >&2; exit 1; }
    if [[ -z "$VERSION" ]]; then
        VERSION="${SITE_VERSION:-$DESKTOP_VERSION-site.$SITE_N}"
    fi
    [[ "$VERSION" == *-site.* || "$VERSION" == site-* ]] || { echo "ERROR: a site version must contain '-site.' or start with 'site-' (got $VERSION), so it can never be mistaken for a desktop release." >&2; exit 1; }
    [[ -z "$SITE_DIST" ]] && SITE_DIST="$(cd "$SCRIPT_DIR/../../.." && pwd)/website/dist"
    [[ -z "$UPLOAD" ]] && UPLOAD="$SCRIPT_DIR/dist/site-$VERSION/upload"
    [[ -z "$OUT_DIR" ]] && OUT_DIR="$SCRIPT_DIR/dist/site-$VERSION"
else
    [[ -z "$VERSION" ]] && VERSION="$(node "$SCRIPT_DIR/sync-version.js" --check)"
    [[ -z "$UPLOAD" ]] && UPLOAD="$SCRIPT_DIR/dist/$VERSION/upload"
    [[ -z "$OUT_DIR" ]] && OUT_DIR="$SCRIPT_DIR/dist/$VERSION"
fi
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
    if [[ "$SITE" == 1 ]]; then
        echo "    $0 --site --desktop-version $DESKTOP_VERSION --site-version $VERSION --from-$1$([[ "$NO_LINUX" == 1 ]] && echo " --no-linux")${LINUX_FILE:+ --linux $LINUX_FILE}" >&2
    else
        echo "    $0 --version $VERSION${RELEASE_VERSION:+ --release-version $RELEASE_VERSION} --from-$1" >&2
    fi
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
if [[ "$SITE" == 1 ]]; then echo "  Publishing the MikeDown SITE $VERSION (desktop $DESKTOP_VERSION stays as is) through LymeDeploy"
else echo "  Publishing MikeDown Desktop $VERSION through LymeDeploy"; fi
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
if [[ "$SITE" != 1 && -d "$UPLOAD" ]]; then
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
    if [[ "$SITE" == 1 ]]; then
        [[ -d "$SITE_DIST" ]] || { echo "ERROR: $SITE_DIST does not exist. Run: npm run build:site" >&2; exit 1; }
        SITE_ARGS=(--dist "$SITE_DIST" --page-src "$SCRIPT_DIR/../../../website/mikedown-desktop" --desktop-version "$DESKTOP_VERSION" --out "$UPLOAD" --base-url "$BASE_URL")
        if [[ "$NO_LINUX" != 1 ]]; then
            [[ -z "$LINUX_FILE" ]] && LINUX_FILE="$SCRIPT_DIR/dist/$DESKTOP_VERSION/MikeDown-$DESKTOP_VERSION-linux-x86_64.AppImage"
            [[ -f "$LINUX_FILE" ]] || { echo "ERROR: $LINUX_FILE not found. The page's Linux size comes from the published AppImage; pass --linux FILE, or --no-linux if desktop $DESKTOP_VERSION has no Linux build." >&2; exit 1; }
            SITE_ARGS+=(--linux "$LINUX_FILE")
        fi
        say "site type: site-only (no manifests, no artifacts, no web.config)"
        node "$SCRIPT_DIR/stage-site.js" "${SITE_ARGS[@]}" || { resume_hint pack; exit 1; }
    else
        [[ -d "$UPLOAD" ]] || { echo "ERROR: $UPLOAD does not exist. Run release.sh first." >&2; exit 1; }
        say "release type: $PLATFORMS"
        node "$SCRIPT_DIR/check-upload.js" --dir "$UPLOAD" --version "$VERSION" --platforms "$PLATFORMS" || { resume_hint pack; exit 1; }
    fi
    mkdir -p "$OUT_DIR"
    rm -f "$NUPKG"
    # A .nupkg is a zip with a .nuspec; LymeDeploy reads the identity from the
    # .nuspec and publishes the archive root into the target folder. Stored,
    # not deflated: the payload is already-compressed DMG/tar.gz/NSIS/AppImage.
    PACKAGE_ID="$PACKAGE_ID" VERSION="$VERSION" SRC="$UPLOAD" NUPKG="$NUPKG" SITE="$SITE" python3 -I - <<'PYEOF'
import os, zipfile
pid, ver, src, out = (os.environ[k] for k in ('PACKAGE_ID', 'VERSION', 'SRC', 'NUPKG'))
site = os.environ.get('SITE') == '1'
what = 'site' if site else 'Desktop'
nuspec = f'''<?xml version="1.0" encoding="utf-8"?>
<package xmlns="http://schemas.microsoft.com/packaging/2013/05/nuspec.xsd">
  <metadata>
    <id>{pid}</id>
    <version>{ver}</version>
    <authors>Interapp Development, Inc.</authors>
    <description>MikeDown {what} {ver}, published to iadev.net/mikedown/ by LymeDeploy.</description>
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
if site:
    # Site payload has subfolders (vscode/, developers/, site-assets/). Entry
    # names are '/'-separated paths from the folder root. Every extension in a
    # package needs a content type (OPC); unknown ones fall back to octet-stream.
    names = []
    for root, ds, fs in os.walk(src):
        ds.sort()
        for f in sorted(fs):
            if f != '.DS_Store':
                names.append(os.path.relpath(os.path.join(root, f), src).replace(os.sep, '/'))
    names.sort()
    known = {'nuspec', 'dmg', 'exe', 'gz', 'json', 'html', 'config', 'txt', 'png', 'AppImage'}
    extra = {'js': 'text/javascript', 'css': 'text/css', 'jpg': 'image/jpeg', 'jpeg': 'image/jpeg',
             'ico': 'image/x-icon', 'svg': 'image/svg+xml', 'woff2': 'font/woff2', 'woff': 'font/woff',
             'webp': 'image/webp', 'map': 'application/json', 'mjs': 'text/javascript',
             'webmanifest': 'application/manifest+json'}
    exts = {n.rsplit('.', 1)[1] for n in names if '.' in n.rsplit('/', 1)[-1]} - known
    add = ''.join('  <Default Extension="%s" ContentType="%s" />\n' % (e, extra.get(e, 'application/octet-stream')) for e in sorted(exts))
    content_types = content_types.replace('</Types>', add + '</Types>')
else:
    names = sorted(n for n in os.listdir(src) if n != '.DS_Store')
    dirs = [n for n in names if os.path.isdir(os.path.join(src, n))]
    if dirs:
        raise SystemExit(f'ERROR: {src} has subfolders {dirs}; the payload must be flat.')
with zipfile.ZipFile(out, 'w', zipfile.ZIP_STORED) as z:
    z.writestr(f'{pid}.nuspec', nuspec)
    z.writestr('[Content_Types].xml', content_types)
    for n in names:
        z.write(os.path.join(src, n), n)
# Round trip: readable, exactly the folder's files at their sizes (flat unless site).
with zipfile.ZipFile(out) as z:
    if z.testzip():
        raise SystemExit(f'ERROR: {out} is corrupt.')
    payload = {i.filename: i.file_size for i in z.infolist()
               if i.filename not in (f'{pid}.nuspec', '[Content_Types].xml')}
    if not site and any('/' in n for n in payload):
        raise SystemExit('ERROR: nested entries in the package.')
    want = {n: os.path.getsize(os.path.join(src, n)) for n in names}
    if payload != want:
        raise SystemExit(f'ERROR: package contents differ from {src}.')
    if site:
        bad = [n for n in payload if n.rsplit('/', 1)[-1].lower() in ('web.config', 'sha256sums.txt')
               or n.rsplit('/', 1)[-1].startswith('latest')
               or n.endswith(('.dmg', '.exe', '.gz', '.sig', '.AppImage', '.nupkg', '.msi', '.pkg'))]
        if bad:
            raise SystemExit(f'ERROR: site package must not contain {bad}.')
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
        --package "$PACKAGE_ID=$VERSION" --notes "MikeDown $([[ "$SITE" == 1 ]] && echo "site (desktop $DESKTOP_VERSION unchanged)" || echo "Desktop") $VERSION"
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
    if [[ "$SITE" == 1 ]]; then
        if [[ "$DRY_RUN" == 1 ]]; then
            say "\$ node $SCRIPT_DIR/verify-site.js --dir $UPLOAD --desktop-version $DESKTOP_VERSION"
        elif ! node "$SCRIPT_DIR/verify-site.js" --dir "$UPLOAD" --desktop-version "$DESKTOP_VERSION"; then
            echo "  The deployment succeeded but verification failed. Re-run: node $SCRIPT_DIR/verify-site.js --dir $UPLOAD --desktop-version $DESKTOP_VERSION" >&2
            exit 1
        fi
    elif [[ "$DRY_RUN" == 1 ]]; then
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
if [[ "$SITE" == 1 ]]; then
    step "Published the MikeDown site $VERSION (desktop $DESKTOP_VERSION untouched)"
    say "Still yours: commit/tag the site change if you want one. No Cloudflare purge is needed"
    say "unless a cache rule was added for /mikedown/ (it was DYNAMIC on 2026-10-24)."
    exit 0
fi
step "Published MikeDown Desktop $VERSION"
say "Still yours: tag desktop-v$VERSION and push; if the purge step is still disabled"
say "in $PROJECT, purge the manifest URLs by hand (both apex and www)."
