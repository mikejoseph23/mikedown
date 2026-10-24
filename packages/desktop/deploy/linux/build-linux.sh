#!/usr/bin/env bash
# packages/desktop/deploy/linux/build-linux.sh
# EXPERIMENTAL: build an unsigned x86_64 Linux AppImage of MikeDown Desktop in
# a linux/amd64 Docker container (Rosetta/QEMU on Apple Silicon). Not a
# release: no signing, no updater artifacts, and the updater is compiled out
# of the running app (MIKEDOWN_CHANNEL=store baked in at build time), since
# latest.json has no Linux entry.
#
# Usage:
#   packages/desktop/deploy/linux/build-linux.sh [--output <dir>] [--smoke]
#
#   --output <dir>  Default: packages/desktop/deploy/dist/linux-experiment
#   --smoke         After the build, start the AppImage under xvfb for a few
#                   seconds and print missing-library / startup errors.
#
# The repo is mounted read-only and copied into a volume, so the host checkout
# never gets Linux node_modules or a Linux target dir. Named volumes cache the
# copy, npm, cargo registry and cargo target between runs.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../../../.." && pwd)"
OUTPUT_DIR="$SCRIPT_DIR/../dist/linux-experiment"
SMOKE=0
while [[ $# -gt 0 ]]; do
    case "$1" in
        --output) OUTPUT_DIR="$2"; shift 2 ;;
        --smoke)  SMOKE=1; shift ;;
        -h|--help) awk 'NR == 1 && /^#!/ { next } /^#/ { sub(/^# ?/, ""); print; next } { exit }' "$0"; exit 0 ;;
        *) echo "Unknown option: $1" >&2; exit 2 ;;
    esac
done
mkdir -p "$OUTPUT_DIR"
OUTPUT_DIR="$(cd "$OUTPUT_DIR" && pwd)"
DOCKER="${DOCKER:-docker}"
command -v "$DOCKER" >/dev/null || DOCKER=/usr/local/bin/docker
IMAGE=mikedown-linux-build

"$DOCKER" build --platform linux/amd64 -t "$IMAGE" "$SCRIPT_DIR"

"$DOCKER" run --rm --platform linux/amd64 \
    -v "$REPO_ROOT":/src:ro \
    -v "$OUTPUT_DIR":/out \
    -v mikedown-linux-work:/work \
    -v mikedown-linux-npm:/root/.npm \
    -v mikedown-linux-cargo-registry:/usr/local/cargo/registry \
    -v mikedown-linux-tauri-cache:/root/.cache/tauri \
    -e SMOKE="$SMOKE" \
    "$IMAGE" bash -euo pipefail -c '
        rsync -a --delete --exclude node_modules --exclude target --exclude dist \
            --exclude .git --exclude .claude --exclude .orchestrator /src/ /work/repo/
        cd /work/repo
        npm ci --no-audit --no-fund
        npm run build:core
        cd packages/desktop
        # Experiment-only profile overrides: skip fat LTO and single codegen
        # unit (slow under emulation). The committed release profile stays.
        export CARGO_PROFILE_RELEASE_LTO=false CARGO_PROFILE_RELEASE_CODEGEN_UNITS=16
        export CARGO_TARGET_DIR=/work/target
        export MIKEDOWN_CHANNEL=store       # compiles the updater out (option_env!)
        export APPIMAGE_EXTRACT_AND_RUN=1   # linuxdeploy runs without FUSE in Docker
        export NO_STRIP=1
        # Under Rosetta/QEMU the AppImage magic bytes (ELF offset 8: "AI\x02")
        # make the kernel refuse linuxdeploy and its plugins ("Exec format
        # error"). Zero them on the tools Tauri caches, then retry once (the
        # retry reuses the compiled binary).
        unmagic() { for f in "$@"; do [[ -f "$f" ]] && printf "\0\0\0" | dd of="$f" bs=1 seek=8 conv=notrunc status=none; done; return 0; }
        unmagic /root/.cache/tauri/*.AppImage
        npx tauri build --bundles appimage --ci || { unmagic /root/.cache/tauri/*.AppImage; npx tauri build --bundles appimage --ci; }
        APPIMAGE=$(ls -t /work/target/release/bundle/appimage/*.AppImage | head -1)
        cp "$APPIMAGE" /out/
        file "$APPIMAGE"; ls -lh "$APPIMAGE"
        if [[ "$SMOKE" == 1 ]]; then
            echo "── smoke: ldd of the extracted binary"
            rm -rf /tmp/smoke && mkdir /tmp/smoke && cd /tmp/smoke
            cp "$APPIMAGE" ./app.AppImage && unmagic ./app.AppImage   # host copy keeps its magic
            ./app.AppImage --appimage-extract >/dev/null
            ldd squashfs-root/usr/bin/* | grep "not found" || echo "ldd: no missing libraries"
            echo "── smoke: run 15s under xvfb"
            HOME=/tmp/smoke-home; mkdir -p $HOME
            timeout 15 dbus-run-session -- xvfb-run -a ./app.AppImage --appimage-extract-and-run 2>&1 | tail -40 || true
            echo "(exit 124 from timeout means it was still running)"
        fi
    '
echo "AppImage in $OUTPUT_DIR"
