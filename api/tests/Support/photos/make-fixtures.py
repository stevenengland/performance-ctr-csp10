"""Writes the JPEG fixtures of CleanJpegTest. The test image has no GD, so they are made here.

Run with Pillow (12.x): python3 make-fixtures.py — from this directory.
`metadata-cleaned.jpg` is what CleanJpeg must turn `metadata.jpg` into, derived by
the walk below, which is independent of the PHP code under test.
"""

import random

from PIL import Image, ImageCms

GPS_IFD = 0x8825
XMP = (
    b'<x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:RDF '
    b'xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#"/></x:xmpmeta>'
)
KEPT = {0xD8, 0xDB, 0xC4, 0xDD, 0xC0, 0xC1, 0xC2, 0xDA, 0xD9}


def gradient(mode, width=256, height=256):
    image = Image.new('RGB', (width, height))
    image.putdata([(x, y, (x * y) % 256) for y in range(height) for x in range(width)])
    return image.convert(mode)


def noise(width=256, height=256):
    rng = random.Random(44)
    return Image.frombytes('RGB', (width, height), rng.randbytes(width * height * 3))


def metadata_bearing(path):
    exif = Image.Exif()
    exif[0x010F] = 'Testkamera'
    exif[GPS_IFD] = {1: 'N', 2: (52.0, 31.0, 12.0), 3: 'E', 4: (13.0, 24.0, 36.0)}
    icc = ImageCms.ImageCmsProfile(ImageCms.createProfile('sRGB')).tobytes()
    gradient('RGB').save(
        path, quality=85, exif=exif.tobytes(), icc_profile=icc, xmp=XMP,
        comment=b'Kommentar', restart_marker_blocks=16,
    )


def kept_segments(data):
    """SOI, the whitelisted segments and each SOS with its scan data, then EOI."""
    out, i = bytearray(data[:2]), 2
    while data[i + 1] != 0xD9:
        marker, length = data[i + 1], int.from_bytes(data[i + 2:i + 4], 'big')
        end = i + 2 + length
        if marker == 0xDA:
            while not (data[end] == 0xFF and data[end + 1] not in (0x00, *range(0xD0, 0xD8))):
                end += 1
        if marker in KEPT:
            out += data[i:end]
        i = end
    return bytes(out + data[i:i + 2])


metadata_bearing('metadata.jpg')
with open('metadata.jpg', 'rb') as source, open('metadata-cleaned.jpg', 'wb') as cleaned:
    cleaned.write(kept_segments(source.read()))
gradient('RGB').save('progressive.jpg', quality=85, progressive=True)
gradient('L').save('grayscale.jpg', quality=85)
gradient('CMYK').save('cmyk.jpg', quality=85)
gradient('RGB', height=192).save('not-square.jpg', quality=85)
noise().save('oversized.jpg', quality=70, subsampling=0)
