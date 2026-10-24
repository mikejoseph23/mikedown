#!/usr/bin/env python3
"""Generate the MikeDown DMG install-window background art.

Same layout as LymeScribe's (600x400 pt window, arrow between two icon slots,
one instruction line), in MikeDown's palette: the app icon is a deep indigo
field with a periwinkle "M" and download arrow. The art draws guidance only;
Finder paints the real app icon (left) and /Applications alias (right) on top
at the coordinates make-dmg.sh positions them.

Renders at 2x (1200x800) and downscales a copy to 1x. make-dmg.sh fuses the
pair into a HiDPI TIFF (tiffutil -cathidpicheck) so Finder reads the art as
600x400 points.

Usage:
    python3 make-background.py            # writes background.png + background@2x.png here
    python3 make-background.py --out DIR

Requires Pillow. Deterministic.
"""

import argparse
import os
from PIL import Image, ImageDraw, ImageFont

BG_TOP      = (247, 246, 254)   # near-white, faint lavender
BG_BOTTOM   = (228, 226, 248)
LINE_PALE   = (150, 140, 235)   # text-line watermark (drawn at ~22% alpha)
TEXT_MUTED  = (66, 58, 120)     # deep indigo, 8:1 on the background
ARROW       = (124, 112, 226)   # periwinkle from the icon's M, darkened to read on light

W, H = 600, 400
SCALE = 2
APP_ICON_CENTER  = (150, 185)   # must match APP_POS in make-dmg.sh
APPS_ICON_CENTER = (450, 185)   # must match APPS_POS in make-dmg.sh


def _font(size):
    for path in ["/System/Library/Fonts/SFNSDisplay.ttf",
                 "/System/Library/Fonts/Helvetica.ttc",
                 "/Library/Fonts/Arial.ttf",
                 "/System/Library/Fonts/Supplemental/Arial.ttf"]:
        if os.path.exists(path):
            try:
                return ImageFont.truetype(path, size)
            except OSError:
                continue
    return ImageFont.load_default()


def _vertical_gradient(w, h, top, bottom):
    base = Image.new("RGB", (w, h), top)
    draw = ImageDraw.Draw(base)
    for y in range(h):
        t = y / max(1, h - 1)
        draw.line([(0, y), (w, y)],
                  fill=tuple(round(top[i] + (bottom[i] - top[i]) * t) for i in range(3)))
    return base


def render(scale=SCALE):
    w, h = W * scale, H * scale
    img = _vertical_gradient(w, h, BG_TOP, BG_BOTTOM)
    draw = ImageDraw.Draw(img, "RGBA")

    def s(v):
        return round(v * scale)

    # Faint "document lines" watermark along the bottom: markdown-ish rows of
    # rounded dashes, a heading bar then body lines, echoing the editor.
    rows = [  # (y, [(x0, x1), ...]) in logical pt; heading row is thicker
        (320, 7, [(40, 190)]),
        (336, 4, [(40, 330), (342, 420)]),
        (348, 4, [(40, 250), (262, 380), (392, 470)]),
        (360, 4, [(40, 300), (312, 360)]),
    ]
    for y, th, segs in rows:
        for x0, x1 in segs:
            draw.rounded_rectangle([s(x0), s(y - th / 2), s(x1), s(y + th / 2)],
                                   radius=s(th / 2), fill=LINE_PALE + (56,))
    # Mirror a shorter block on the right for balance.
    for y, th, segs in [(336, 4, [(480, 560)]), (348, 4, [(500, 560)]), (360, 4, [(470, 530)])]:
        for x0, x1 in segs:
            draw.rounded_rectangle([s(x0), s(y - th / 2), s(x1), s(y + th / 2)],
                                   radius=s(th / 2), fill=LINE_PALE + (56,))

    # Center arrow: app slot -> Applications slot.
    ay = s(APP_ICON_CENTER[1])
    a_x0 = s(APP_ICON_CENTER[0] + 78)
    a_x1 = s(APPS_ICON_CENTER[0] - 78)
    shaft_h = s(7)
    draw.rounded_rectangle([a_x0, ay - shaft_h, a_x1 - s(20), ay + shaft_h],
                           radius=shaft_h, fill=ARROW + (235,))
    head = s(22)
    draw.polygon([(a_x1, ay), (a_x1 - s(26), ay - head), (a_x1 - s(26), ay + head)],
                 fill=ARROW + (235,))

    # Instruction text, above the watermark so it stays legible.
    font = _font(s(17))
    instr = "Drag to Applications to install"
    iw = draw.textlength(instr, font=font)
    draw.text(((w - iw) / 2, s(288)), instr, font=font, fill=TEXT_MUTED)
    return img


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--out", default=os.path.dirname(os.path.abspath(__file__)))
    args = ap.parse_args()
    os.makedirs(args.out, exist_ok=True)
    img2x = render(SCALE)
    img1x = img2x.resize((W, H), Image.LANCZOS)
    for name, im in (("background.png", img1x), ("background@2x.png", img2x)):
        p = os.path.join(args.out, name)
        im.save(p)
        print(f"wrote {p} ({im.width}x{im.height})")


if __name__ == "__main__":
    main()
