"""Raster icons from the favicon's 9x9 grid: favicon-32, apple-touch-icon, icon-192/512, and a
maskable 512 with the squares inside the safe zone. Run: python3 scripts/og/icons.py"""
from PIL import Image, ImageDraw

BG, SQ = '#133546', [((1, 1), '#43CDB6'), ((5, 1), '#EE7D69'), ((1, 5), '#EBAA49'), ((5, 5), '#C5D7D9')]

def icon(size, grid=9, offset=0):
    img = Image.new('RGB', (size, size), BG)
    d, u = ImageDraw.Draw(img), size / grid
    for (x, y), c in SQ:
        x0, y0 = (x + offset) * u, (y + offset) * u
        d.rectangle([round(x0), round(y0), round(x0 + 3 * u) - 1, round(y0 + 3 * u) - 1], fill=c)
    return img

for name, size in [('favicon-32', 32), ('apple-touch-icon', 180), ('icon-192', 192), ('icon-512', 512)]:
    icon(size).save(f'public/{name}.png', optimize=True)
icon(512, grid=13, offset=2).save('public/icon-maskable-512.png', optimize=True)
