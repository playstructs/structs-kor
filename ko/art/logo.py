"""우주상사's badge and guild logo, in the style of webapp's SN Corp badge.

webapp's badge (public/img/logo-snc.gif) is 32x32 pixel art: "sn.c" in a
one-pixel box, in the interface's steel blue (115, 148, 165), shown at 192px
in sign-up with the motto over its lower rows (from row 23). This draws the
guild's tag, 우상, the same way: Galmuri11 (the Korean pixel face in
ko/public/ko/fonts) at its 12px grid, in a box, above row 22.

  - ko/public/ko/img/uju-badge.png: 192x192, sign-up's badge
    (ConnectingToCorp2, Orientation2)
  - ko/public/ko/img/uju-logo.png: 256x256, the guild's logo in guild.json

    python3 -m pip install pillow fonttools brotli
    python3 ko/art/logo.py
"""
import io
from pathlib import Path

from fontTools.ttLib import TTFont
from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parents[2]
FONT = ROOT / "ko/public/ko/fonts/Galmuri11.woff2"
OUT = ROOT / "ko/public/ko/img"

TEXT = "우상"
COLOR = (115, 148, 165, 255)
GRID = 32
# The box's top left, and the padding between box and letters.
BOX_X, BOX_Y = 2, 6
PAD = 1


def face():
    """Galmuri11 at its own pixel size, from the woff2 the site serves."""
    font = TTFont(FONT)
    font.flavor = None
    ttf = io.BytesIO()
    font.save(ttf)
    ttf.seek(0)
    return ImageFont.truetype(ttf, 12)


def badge():
    image = Image.new("RGBA", (GRID, GRID), (0, 0, 0, 0))
    draw = ImageDraw.Draw(image)
    draw.fontmode = "1"  # whole pixels, no smoothing
    font = face()
    left, top, right, bottom = draw.textbbox((0, 0), TEXT, font=font)
    width, height = right - left, bottom - top
    box = (BOX_X, BOX_Y, BOX_X + width + 2 * PAD + 1, BOX_Y + height + 2 * PAD + 1)
    if box[2] >= GRID or box[3] >= 22:
        raise SystemExit(f"{TEXT} does not fit the badge above the motto: {box}")
    # Centred across the grid.
    shift = (GRID - (box[2] - box[0] + 1)) // 2 - BOX_X
    box = (box[0] + shift, box[1], box[2] + shift, box[3])
    draw.rectangle(box, outline=COLOR)
    draw.text((box[0] + 1 + PAD - left, box[1] + 1 + PAD - top), TEXT, font=font, fill=COLOR)
    return image


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    image = badge()
    for name, size in (("uju-badge.png", 192), ("uju-logo.png", 256)):
        image.resize((size, size), Image.NEAREST).save(OUT / name, optimize=True)
        print(f"wrote {OUT / name}")


if __name__ == "__main__":
    main()
