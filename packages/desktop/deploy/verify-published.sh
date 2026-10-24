#!/usr/bin/env bash
# packages/desktop/deploy/verify-published.sh
# Post-publish check of https://www.iadev.net/mikedown/ for one release.
# Read-only: it only fetches. Run it after every publish and after a purge.
#
#   verify-published.sh <version> [--mac-only | --windows-only]
#
# For each of latest-darwin-aarch64.json, latest-darwin-x86_64.json,
# latest-windows-x86_64.json and latest.json it:
#   - fetches www and apex, each cache-busted (origin) and plain (what the
#     updater gets from Cloudflare's edge), and requires all four to match;
#   - checks the Tauri static shape and the version (the shipped platforms'
#     files and, for a full release, latest.json must announce <version>; a
#     split release requires latest.json to still be there at its old version);
#   - HEADs every artifact URL for 200 and a Content-Length equal to the
#     manifest's size, downloads it, and checks sha256 and the minisign
#     signature against src-tauri/tauri.conf.json's pubkey, including the
#     signed version (requireSignedVersion).
# Exits non-zero on any failure. Options after the version are passed to
# verify-published.js (--base-url, --www, --apex, --pubkey) for staging use.

set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

case "${1:-}" in
    -h|--help) awk 'NR == 1 && /^#!/ { next } /^#/ { sub(/^# ?/, ""); print; next } { exit }' "$0"; exit 0 ;;
    ""|-*) echo "usage: verify-published.sh <version> [--mac-only | --windows-only]" >&2; exit 2 ;;
esac
VERSION="$1"; shift
PLATFORMS="mac,windows"; PASS=()
while [[ $# -gt 0 ]]; do
    case "$1" in
        --mac-only) PLATFORMS="mac"; shift ;;
        --windows-only) PLATFORMS="windows"; shift ;;
        --base-url|--www|--apex|--pubkey) PASS+=("$1" "$2"); shift 2 ;;
        *) echo "Unknown option: $1" >&2; exit 2 ;;
    esac
done
exec node "$SCRIPT_DIR/verify-published.js" --version "$VERSION" --platforms "$PLATFORMS" ${PASS[@]+"${PASS[@]}"}
