"""Korean victory and defeat banners for structs-webapp's Lottie animations.

webapp's banners (public/lottie/{victory,defeat}-banner) are 28 pixel-art
frames of 96x32: a flash, a box opening, the word (clean frames and glitch
frames), the box closing. Only the frames with letters are redrawn here:

  - the clean frame is the original with its letters replaced by 승리 or 패배,
    drawn here (GLYPHS) with two-pixel strokes like webapp's wide pixel face,
    on the box's full twelve rows, since Hangul needs more height than Latin;
  - each glitch frame is the original's distortion, measured row by row
    against the clean original (sideways shifts of the band, blanked rows,
    dimmed pixels), applied to the Korean clean frame.

The frames go to ko/public/lottie/, which the build serves over webapp's at
the same paths. banners.json records the upstream frames they were drawn
from; ko/audit.cjs reports them as stale if upstream redraws its banners.

    python3 -m pip install pillow
    python3 ko/art/banners.py
"""
import hashlib
import json
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parents[2]
UPSTREAM = ROOT / "structs-webapp/src/public/lottie"
OUT = ROOT / "ko/public/lottie"
RECORD = Path(__file__).with_name("banners.json")

# The box's inside, where the letters are.
BOX_LEFT, BOX_RIGHT = 16, 80
BAND_TOP, BAND_BOTTOM = 10, 22
MAX_SHIFT = 8

BANNERS = {
    "victory-banner": {"word": "승리", "clean": 13, "frames": range(11, 21)},
    "defeat-banner": {"word": "패배", "clean": 14, "frames": range(12, 21)},
}


# Twelve rows each, # is ink.
GLYPHS = {
    "승": [
        "..........####..........",
        "......####....####......",
        "..####............####..",
        "........................",
        "########################",
        "########################",
        "........................",
        "....################....",
        "..####............####..",
        "..##................##..",
        "..####............####..",
        "....################....",
    ],
    "리": [
        "##############....##",
        "##############....##",
        "............##....##",
        "............##....##",
        "............##....##",
        "##############....##",
        "##############....##",
        "##................##",
        "##................##",
        "##................##",
        "##############....##",
        "##############....##",
    ],
    "패": [
        "############..##...##",
        "############..##...##",
        "...##..##.....##...##",
        "...##..##.....##...##",
        "...##..##.....##...##",
        "...##..##.....####.##",
        "...##..##.....####.##",
        "...##..##.....##...##",
        "...##..##.....##...##",
        "...##..##.....##...##",
        "############..##...##",
        "############..##...##",
    ],
    "배": [
        "##........##..##...##",
        "##........##..##...##",
        "##........##..##...##",
        "##........##..##...##",
        "##........##..##...##",
        "############..####.##",
        "############..####.##",
        "##........##..##...##",
        "##........##..##...##",
        "##........##..##...##",
        "############..##...##",
        "############..##...##",
    ],
}
GAP = 6


def word_bitmap(word):
    """The word's syllables side by side; True is ink."""
    rows = ["" for _ in GLYPHS[word[0]]]
    for index, syllable in enumerate(word):
        for y, line in enumerate(GLYPHS[syllable]):
            rows[y] += ("." * GAP if index else "") + line
    return [[char == "#" for char in line] for line in rows]


def palette(frame):
    """Band background, ink and the dimmed ink of a clean frame."""
    pixels = frame.load()
    counts = {}
    for y in range(BAND_TOP, BAND_BOTTOM):
        for x in range(BOX_LEFT, BOX_RIGHT):
            counts[pixels[x, y]] = counts.get(pixels[x, y], 0) + 1
    background, ink = sorted(counts, key=counts.get, reverse=True)[:2]
    dim = tuple((a + b) // 2 for a, b in zip(ink[:3], background[:3])) + (255,)
    return background, ink, dim


def korean_clean(original, bitmap, background, ink):
    frame = original.copy()
    pixels = frame.load()
    for y in range(BAND_TOP, BAND_BOTTOM):
        for x in range(BOX_LEFT, BOX_RIGHT):
            pixels[x, y] = background
    height, width = len(bitmap), len(bitmap[0])
    left = BOX_LEFT + (BOX_RIGHT - BOX_LEFT - width) // 2
    top = BAND_BOTTOM - height
    for y, row in enumerate(bitmap):
        for x, on in enumerate(row):
            if on:
                pixels[left + x, top + y] = ink
    return frame


def row(frame, y):
    pixels = frame.load()
    return [pixels[x, y] for x in range(frame.width)]


def shifted(clean_row, shift, background):
    """The band row moved sideways, as webapp's glitches move it."""
    out = list(clean_row)
    transparent = (0, 0, 0, 0)
    for x in range(BOX_LEFT, BOX_RIGHT):
        out[x] = transparent if clean_row[x] == transparent else background
    for x in range(BOX_LEFT, BOX_RIGHT):
        target = x + shift
        if 0 <= target < len(out):
            out[target] = clean_row[x]
    return out


def measure(glitch, clean, background, ink):
    """Per band row: ('blank',) or ('shift', s), and the dimmed pixels."""
    rows = {}
    for y in range(BAND_TOP, BAND_BOTTOM):
        glitch_row, clean_row = row(glitch, y), row(clean, y)
        has_ink = any(pixel == ink for pixel in glitch_row)
        if not has_ink and any(pixel == ink for pixel in clean_row):
            rows[y] = ("blank",)
            continue
        best = min(
            range(-MAX_SHIFT, MAX_SHIFT + 1),
            key=lambda s: (sum(a != b for a, b in zip(shifted(clean_row, s, background), glitch_row)), abs(s)),
        )
        rows[y] = ("shift", best)
    return rows


def apply(rows, korean, glitch, background, ink, dim):
    frame = glitch.copy()
    pixels = frame.load()
    glitch_pixels = glitch.load()
    for y, (kind, *args) in rows.items():
        korean_row = row(korean, y)
        if kind == "blank":
            new = [background if BOX_LEFT <= x < BOX_RIGHT else pixel for x, pixel in enumerate(korean_row)]
        else:
            new = shifted(korean_row, args[0], background)
            # Where the original's band reached past the box, so does ours.
            for x, pixel in enumerate(row(glitch, y)):
                if pixel != (0, 0, 0, 0) and new[x] == (0, 0, 0, 0):
                    new[x] = background
        for x, pixel in enumerate(new):
            pixels[x, y] = pixel
            # The original's dimmed pixels land on our ink where it is there.
            if glitch_pixels[x, y] not in (ink, background, (0, 0, 0, 0)) and pixel == ink:
                pixels[x, y] = dim
    return frame


def sha256(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def main():
    record = {}
    for name, banner in BANNERS.items():
        source = UPSTREAM / name / "images"
        target = OUT / name / "images"
        target.mkdir(parents=True, exist_ok=True)
        clean = Image.open(source / f"img_{banner['clean']}.png").convert("RGBA")
        background, ink, dim = palette(clean)
        korean = korean_clean(clean, word_bitmap(banner["word"]), background, ink)
        for index in banner["frames"]:
            path = source / f"img_{index}.png"
            original = Image.open(path).convert("RGBA")
            rows = measure(original, clean, background, ink)
            apply(rows, korean, original, background, ink, dim).save(target / path.name)
            record[f"public/lottie/{name}/images/{path.name}"] = sha256(path)
    RECORD.write_text(json.dumps(record, indent=2) + "\n")
    print(f"wrote {len(record)} frames")


if __name__ == "__main__":
    main()
