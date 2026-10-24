#!/usr/bin/env bash
# packages/desktop/deploy/make-dmg.sh
# Build a laid-out, drag-to-install DMG from a (signed) .app bundle.
#
# Produces the classic install window: app icon on the left, an alias to
# /Applications on the right, a brand background with an arrow + "Drag to
# Applications to install" between them, hidden toolbar/sidebar, fixed window
# size, and a larger icon size.
#
# Method: manual hdiutil + an AppleScript Finder pass (no create-dmg
# dependency). The layout (.DS_Store + .background/) is baked into a read-write
# image, which is then converted to a compressed read-only UDZO DMG. Callers
# that sign/notarize must do so on the OUTPUT of this script — the layout is
# already inside it, so the bytes are final.
#
# Adapted from lymescribe/deploy/make-dmg.sh. Product-agnostic; build-mac.sh
# calls it for the MikeDown DMG, with the MikeDown art from
# assets/dmg/make-background.py.
#
# The layout pass runs under a unique temporary volume name and the volume is
# renamed to --volname just before detaching. That keeps Finder from confusing
# the image with a same-named volume that is already mounted (an older release
# DMG, say) and from touching it.
#
# Usage:
#   ./deploy/make-dmg.sh --app <App.app> --output <out.dmg> [options]
#
# Required:
#   --app <path>          The .app bundle (already signed by the caller).
#   --output <path>       Destination .dmg (overwritten if present).
#
# Options (sensible defaults baked for a 600x400 window):
#   --volname <name>      Volume name. Default: basename of app sans .app.
#   --background <png>    1x background image (e.g. 600x400). If a sibling
#                         "<name>@2x.png" exists, it is fused with this 1x art
#                         into a HiDPI TIFF (tiffutil -cathidpicheck) so Finder
#                         renders it at the right point size on Retina. Default:
#                         deploy/assets/dmg/background.png
#   --icon-size <px>      Finder icon size. Default: 128.
#   --window <WxH>        Logical window size in pt. Default: 600x400.
#   --app-pos <x,y>       App icon center. Default: 150,170.
#   --apps-pos <x,y>      /Applications alias center. Default: 450,170.
#   -h | --help           Show this header.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# ── Defaults ─────────────────────────────────────────────────────────────────
APP=""
OUTPUT=""
VOLNAME=""
BACKGROUND="$SCRIPT_DIR/assets/dmg/background.png"
ICON_SIZE=128
WIN_W=600
WIN_H=400
APP_POS="150,185"     # must match APP_ICON_CENTER in assets/dmg/make-background.py
APPS_POS="450,185"    # must match APPS_ICON_CENTER in assets/dmg/make-background.py

while [[ $# -gt 0 ]]; do
    case "$1" in
        --app)        APP="$2"; shift 2 ;;
        --output)     OUTPUT="$2"; shift 2 ;;
        --volname)    VOLNAME="$2"; shift 2 ;;
        --background) BACKGROUND="$2"; shift 2 ;;
        --icon-size)  ICON_SIZE="$2"; shift 2 ;;
        --window)     WIN_W="${2%x*}"; WIN_H="${2#*x}"; shift 2 ;;
        --app-pos)    APP_POS="$2"; shift 2 ;;
        --apps-pos)   APPS_POS="$2"; shift 2 ;;
        -h|--help)    sed -n '2,/^set -euo/p' "$0" | sed '$d' | sed 's/^# \{0,1\}//'; exit 0 ;;
        *) echo "make-dmg: unknown option: $1 (try --help)" >&2; exit 1 ;;
    esac
done

[[ -z "$APP"    ]] && { echo "make-dmg: --app is required" >&2; exit 1; }
[[ -z "$OUTPUT" ]] && { echo "make-dmg: --output is required" >&2; exit 1; }
[[ -d "$APP"    ]] || { echo "make-dmg: app not found: $APP" >&2; exit 1; }
[[ -f "$BACKGROUND" ]] || { echo "make-dmg: background not found: $BACKGROUND" >&2; exit 1; }

APP_NAME="$(basename "$APP")"                       # e.g. "LymeScribe Personal.app"
[[ -z "$VOLNAME" ]] && VOLNAME="${APP_NAME%.app}"

APP_X="${APP_POS%,*}";  APP_Y="${APP_POS#*,}"
APPS_X="${APPS_POS%,*}"; APPS_Y="${APPS_POS#*,}"

# Window bounds {left, top, right, bottom} in screen pt.
WIN_LEFT=200
WIN_TOP=120
WIN_RIGHT=$(( WIN_LEFT + WIN_W ))
WIN_BOTTOM=$(( WIN_TOP + WIN_H ))

LAYOUT_NAME="$VOLNAME-layout-$$"

# ── Scratch state + cleanup trap ─────────────────────────────────────────────
STAGING=""
RW_DMG=""
DEVICE=""
AS_ERR="$(mktemp /tmp/make-dmg-aserr.XXXXXX)"

cleanup() {
    [[ -n "$AS_ERR" && -f "$AS_ERR" ]] && rm -f "$AS_ERR"
    # Detach the mounted RW image if still attached, then remove scratch files.
    if [[ -n "$DEVICE" ]] && hdiutil info 2>/dev/null | grep -q "$DEVICE"; then
        hdiutil detach "$DEVICE" -quiet 2>/dev/null \
            || hdiutil detach "$DEVICE" -force -quiet 2>/dev/null || true
    fi
    [[ -n "$RW_DMG"  && -f "$RW_DMG"  ]] && rm -f "$RW_DMG"
    [[ -n "$STAGING" && -d "$STAGING" ]] && rm -rf "$STAGING"
}
trap cleanup EXIT

# ── 1. Stage contents (app + Applications symlink + .background) ──────────────
echo "  make-dmg: staging '$VOLNAME'"
STAGING="$(mktemp -d /tmp/make-dmg.XXXXXX)"
cp -R "$APP" "$STAGING/$APP_NAME"
ln -s /Applications "$STAGING/Applications"
mkdir "$STAGING/.background"

# Background: if a "<name>@2x.png" sibling exists, fuse it with the 1x art into
# a single HiDPI TIFF so Finder reads the art at the correct POINT size (a bare
# 1200x800 PNG would be misread as 1200x800 pt — 2x too big). Otherwise fall
# back to the plain image.
BG_DIR="$(cd "$(dirname "$BACKGROUND")" && pwd)"
BG_BASE="$(basename "$BACKGROUND")"
BG_AT2X="$BG_DIR/${BG_BASE%.png}@2x.png"
if [[ "$BG_BASE" != *@2x.png && -f "$BG_AT2X" ]]; then
    BG_NAME="background.tiff"
    tiffutil -cathidpicheck "$BACKGROUND" "$BG_AT2X" \
        -out "$STAGING/.background/$BG_NAME" >/dev/null
    echo "  make-dmg: built HiDPI background.tiff (1x + @2x)"
else
    BG_NAME="background.png"
    cp "$BACKGROUND" "$STAGING/.background/$BG_NAME"
fi

# ── 2. Create a read-write image sized to the staged contents (+ slack) ──────
SIZE_MB=$(( $(du -sm "$STAGING" | cut -f1) + 40 ))
RW_DMG="$(mktemp -u /tmp/make-dmg-rw.XXXXXX).dmg"
echo "  make-dmg: creating ${SIZE_MB}M read-write image"
hdiutil create -srcfolder "$STAGING" -volname "$LAYOUT_NAME" \
    -fs HFS+ -fsargs "-c c=64,a=16,e=16" \
    -format UDRW -size "${SIZE_MB}m" "$RW_DMG" -quiet

# ── 3. Mount it (hidden, no auto-open) ───────────────────────────────────────
echo "  make-dmg: mounting"
ATTACH_OUT="$(hdiutil attach "$RW_DMG" -readwrite -noverify -noautoopen -nobrowse)"
DEVICE="$(echo "$ATTACH_OUT" | grep -Eo '^/dev/disk[0-9]+' | head -1)"
[[ -d "/Volumes/$LAYOUT_NAME" ]] || { echo "make-dmg: mount point /Volumes/$LAYOUT_NAME missing" >&2; exit 1; }
# Let the volume settle before driving Finder.
sleep 1

# ── 4. AppleScript Finder layout pass ────────────────────────────────────────
echo "  make-dmg: applying Finder layout"
LAYOUT_OK=false
for attempt in 1 2 3; do
    # The close/open cycle forces Finder to commit the view options + icon
    # positions to the volume's .DS_Store before we read them back.
    # `|| true` so a transient AppleScript error doesn't trip `set -e` — the
    # read-back check below decides success, and AS_ERR captures the reason.
    POS="$(osascript 2>"$AS_ERR" <<EOF || true
tell application "Finder"
    tell disk "$LAYOUT_NAME"
        open
        delay 0.5
        set current view of container window to icon view
        set toolbar visible of container window to false
        set statusbar visible of container window to false
        set the bounds of container window to {$WIN_LEFT, $WIN_TOP, $WIN_RIGHT, $WIN_BOTTOM}
        set theViewOptions to the icon view options of container window
        set arrangement of theViewOptions to not arranged
        set icon size of theViewOptions to $ICON_SIZE
        set text size of theViewOptions to 13
        set background picture of theViewOptions to file ".background:$BG_NAME"
        set position of item "$APP_NAME" of container window to {$APP_X, $APP_Y}
        set position of item "Applications" of container window to {$APPS_X, $APPS_Y}
        delay 0.5
        update without registering applications
        delay 0.5
        close
        open
        delay 0.5
        -- Read back so the caller can confirm the layout actually stuck.
        set p1 to position of item "$APP_NAME" of container window
        set p2 to position of item "Applications" of container window
        close
        return (item 1 of p1 as text) & " " & (item 2 of p1 as text) & " " & (item 1 of p2 as text) & " " & (item 2 of p2 as text)
    end tell
end tell
EOF
)"
    # Expect the icons to land where we put them (allow a few pt of snap slop).
    read -r GOT_AX GOT_AY GOT_SX GOT_SY <<<"$POS"
    if [[ -n "$GOT_AX" ]] \
        && (( ${GOT_AX%.*} >= APP_X - 8  && ${GOT_AX%.*} <= APP_X + 8 )) \
        && (( ${GOT_SX%.*} >= APPS_X - 8 && ${GOT_SX%.*} <= APPS_X + 8 )); then
        LAYOUT_OK=true
        echo "  make-dmg: positions verified — app=($GOT_AX,$GOT_AY) apps=($GOT_SX,$GOT_SY)"
        break
    fi
    echo "  make-dmg: layout attempt $attempt didn't stick (got '$POS'), retrying…" >&2
    [[ -s "$AS_ERR" ]] && echo "    AppleScript: $(tr '\n' ' ' < "$AS_ERR")" >&2
    sleep 2
done

if [[ "$LAYOUT_OK" != true ]]; then
    echo "make-dmg: ERROR — Finder layout failed/unverified after 3 attempts." >&2
    echo "          (AppleScript+Finder needs a logged-in GUI session; it" >&2
    echo "           cannot run headless / over a bare SSH session.)" >&2
    exit 1
fi

# Final volume name (the layout ran under a temporary one). Done after Finder
# has closed the window so it does not rewrite the .DS_Store afterwards.
sleep 1
diskutil rename "/Volumes/$LAYOUT_NAME" "$VOLNAME" >/dev/null \
    || { echo "make-dmg: ERROR renaming volume to '$VOLNAME'" >&2; exit 1; }
sync

# ── 5. Detach cleanly ────────────────────────────────────────────────────────
echo "  make-dmg: detaching"
hdiutil detach "$DEVICE" -quiet \
    || { sleep 2; hdiutil detach "$DEVICE" -force -quiet; }
DEVICE=""   # detached — keep the trap from double-detaching

# ── 6. Convert RW → compressed read-only UDZO ────────────────────────────────
echo "  make-dmg: converting to compressed UDZO"
mkdir -p "$(dirname "$OUTPUT")"
rm -f "$OUTPUT"
hdiutil convert "$RW_DMG" -format UDZO -imagekey zlib-level=9 -o "$OUTPUT" -quiet

echo "  make-dmg: wrote $OUTPUT"
