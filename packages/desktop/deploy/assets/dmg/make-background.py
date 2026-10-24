#!/usr/bin/env python3
"""Generate the MikeDown DMG install-window background art.

Layout (600x400 pt content area, make-dmg.sh sizes the window so all of it
shows below the title bar):

    MikeDown                      product heading, deep violet from the icon
    WYSIWYG markdown editor       small muted subtitle
    [app]  ──────────▶  [Apps]    Finder paints both icons at the centers below
    Drag MikeDown to Applications to install
    #   ##   **   _   -   >   `   [ ]    faint markdown glyph row, a backdrop

Palette comes from the app icon (deep indigo-violet field, periwinkle "M",
sky-blue download arrow) on a near-white lavender wash, so Finder's black
icon labels stay high contrast in both light and dark appearance (the art is
opaque, so Finder's appearance does not change it).

The arrow is drawn as one shape into a mask, then filled with a gradient, so
the shaft and head never double up where they meet.

Renders at 2x (1200x800) and downscales a copy to 1x. make-dmg.sh fuses the
pair into a HiDPI TIFF (tiffutil -cathidpicheck) so Finder reads the art as
600x400 points.

Usage:
    python3 make-background.py            # writes background.png + background@2x.png here
    python3 make-background.py --out DIR

Requires Pillow and macOS system fonts (SF Pro, SF Mono; falls back to
Helvetica/Menlo). Deterministic.
"""

import argparse
import os
from PIL import Image, ImageDraw, ImageFont

BG_TOP     = (250, 249, 255)   # near-white, faint lavender
BG_BOTTOM  = (234, 232, 251)
TITLE      = (36, 28, 80)      # icon field (33,27,64)..(57,30,107), deep violet
SUBTITLE   = (104, 98, 150)    # muted violet-gray
CAPTION    = (84, 76, 140)     # indigo, ~6:1 on the background
ARROW_FROM = (128, 116, 232)   # periwinkle, the icon's "M" darkened to read on light
ARROW_TO   = (92, 150, 238)    # toward the icon's sky-blue down arrow
GLYPH      = (112, 100, 210)   # markdown glyph backdrop, drawn at low alpha

W, H = 600, 400
SCALE = 2
APP_ICON_CENTER  = (150, 196)   # must match APP_POS in make-dmg.sh
APPS_ICON_CENTER = (450, 196)   # must match APPS_POS in make-dmg.sh
ICON_HALF = 64                  # 128 pt icons (make-dmg.sh --icon-size)

TITLE_TEXT    = "MikeDown"
SUBTITLE_TEXT = "WYSIWYG markdown editor"
CAPTION_TEXT  = "Drag MikeDown to Applications to install"
GLYPHS = ["#", "**", "-", ">", "##", "`", "_", "[x]", "#"]


def _font(size, weight=None, mono=False, opsz=None):
    paths = (["/System/Library/Fonts/SFNSMono.ttf", "/System/Library/Fonts/Menlo.ttc"] if mono else
             ["/System/Library/Fonts/SFNS.ttf", "/System/Library/Fonts/Helvetica.ttc",
              "/Library/Fonts/Arial.ttf"])
    for path in paths:
        if not os.path.exists(path):
            continue
        try:
            f = ImageFont.truetype(path, size)
        except OSError:
            continue
        if weight:
            try:
                axes = f.get_variation_axes()
                want = {b"Weight": weight, b"Optical Size": opsz}
                f.set_variation_by_axes([
                    max(a["minimum"], min(a["maximum"], want.get(a.get("name")) or a["default"]))
                    for a in axes])
            except (OSError, AttributeError, KeyError):
                pass
        return f
    return ImageFont.load_default()


def _vertical_gradient(w, h, top, bottom):
    base = Image.new("RGB", (w, h), top)
    draw = ImageDraw.Draw(base)
    for y in range(h):
        t = y / max(1, h - 1)
        draw.line([(0, y), (w, y)],
                  fill=tuple(round(top[i] + (bottom[i] - top[i]) * t) for i in range(3)))
    return base


def _horizontal_gradient(w, h, left, right):
    g = Image.new("RGB", (w, h))
    draw = ImageDraw.Draw(g)
    for x in range(w):
        t = x / max(1, w - 1)
        draw.line([(x, 0), (x, h)],
                  fill=tuple(round(left[i] + (right[i] - left[i]) * t) for i in range(3)))
    return g


def _centered(draw, text, font, y, w, fill, tracking=0):
    if not tracking:
        tw = draw.textlength(text, font=font)
        draw.text(((w - tw) / 2, y), text, font=font, fill=fill)
        return
    widths = [draw.textlength(c, font=font) for c in text]
    x = (w - (sum(widths) + tracking * (len(text) - 1))) / 2
    for c, cw in zip(text, widths):
        draw.text((x, y), c, font=font, fill=fill)
        x += cw + tracking


def render(scale=SCALE):
    w, h = W * scale, H * scale

    def s(v):
        return round(v * scale)

    img = _vertical_gradient(w, h, BG_TOP, BG_BOTTOM)
    draw = ImageDraw.Draw(img, "RGBA")

    # Markdown glyph backdrop: one evenly spaced row of syntax marks along the
    # bottom, faint enough to read as texture, inset from both window edges.
    gfont = _font(s(18), mono=True)
    layer = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    ld = ImageDraw.Draw(layer)
    gy = s(360)
    margin = s(44)
    step = (w - 2 * margin) / (len(GLYPHS) - 1)
    for i, g in enumerate(GLYPHS):
        gw = ld.textlength(g, font=gfont)
        alpha = 40 if i % 2 == 0 else 28
        ld.text((margin + i * step - gw / 2, gy), g, font=gfont, fill=GLYPH + (alpha,))
    img = Image.alpha_composite(img.convert("RGBA"), layer).convert("RGB")
    draw = ImageDraw.Draw(img, "RGBA")

    # Heading + subtitle.
    _centered(draw, TITLE_TEXT, _font(s(34), weight=580, opsz=34), s(34), w, TITLE)
    _centered(draw, SUBTITLE_TEXT, _font(s(13), weight=500), s(82), w, SUBTITLE)

    # Arrow from the app slot to the Applications slot, as a single shape.
    cy = s(APP_ICON_CENTER[1])
    x0 = s(APP_ICON_CENTER[0] + ICON_HALF + 22)
    x1 = s(APPS_ICON_CENTER[0] - ICON_HALF - 22)
    shaft = s(5)          # half-thickness
    head_len, head_half = s(20), s(14)
    mask = Image.new("L", (w, h), 0)
    md = ImageDraw.Draw(mask)
    md.rounded_rectangle([x0, cy - shaft, x1 - head_len + s(2), cy + shaft], radius=shaft, fill=255)
    md.polygon([(x1, cy), (x1 - head_len, cy - head_half), (x1 - head_len, cy + head_half)], fill=255)
    grad = _horizontal_gradient(w, h, ARROW_FROM, ARROW_TO)
    img.paste(grad, (0, 0), mask)

    # Instruction line.
    draw = ImageDraw.Draw(img, "RGBA")
    _centered(draw, CAPTION_TEXT, _font(s(15), weight=440), s(316), w, CAPTION)
    return img


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--out", default=os.path.dirname(os.path.abspath(__file__)))
    args = ap.parse_args()
    os.makedirs(args.out, exist_ok=True)
    img2x = render(SCALE)
    img1x = render(1)   # native 1x render: crisper text than a downscale
    for name, im in (("background.png", img1x), ("background@2x.png", img2x)):
        p = os.path.join(args.out, name)
        im.save(p)
        print(f"wrote {p} ({im.width}x{im.height})")


if __name__ == "__main__":
    main()
