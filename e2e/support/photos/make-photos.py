"""Writes the pictures the photo specs pick. Run with Pillow (12.x): python3 make-photos.py — from this directory.

Both are red on the left and blue on the right as stored, so a spec can tell
from the framed photo's colours how it was turned and moved.
"""

from PIL import Image

RED = (220, 20, 20)
BLUE = (20, 20, 220)
ORIENTATION = 0x0112
ROTATE_90_CLOCKWISE = 6


def halves(width, height):
    image = Image.new('RGB', (width, height), BLUE)
    image.paste(RED, (0, 0, width // 2, height))
    return image


# 400 × 200, 2:1: centred in the square frame, the left half of the frame is red.
halves(400, 200).save('halves.png')

# Stored 400 × 200 with EXIF orientation 6: upright it is 200 × 400, red on top.
exif = Image.Exif()
exif[ORIENTATION] = ROTATE_90_CLOCKWISE
halves(400, 200).save('exif-rotated.jpg', quality=90, exif=exif.tobytes())
