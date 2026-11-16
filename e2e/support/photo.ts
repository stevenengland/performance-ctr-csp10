import { fileURLToPath } from 'node:url';
import type { Locator, Page } from '@playwright/test';

/**
The pictures the photo specs pick (made by `photos/make-photos.py`): both are red
on the left and blue on the right as stored. `halves.png` is 400 × 200;
`exif-rotated.jpg` is stored 400 × 200 with EXIF orientation 6, so upright it
is 200 × 400 with red on top.
*/
export const PICTURES = {
  halves: fileURLToPath(new URL('photos/halves.png', import.meta.url)),
  exifRotated: fileURLToPath(
    new URL('photos/exif-rotated.jpg', import.meta.url),
  ),
};

/** Bytes no browser of the specs decodes, named like a phone's HEIC photo. */
export const UNDECODABLE_HEIC = {
  name: 'IMG_0001.heic',
  mimeType: 'image/heic',
  buffer: Buffer.from('\0\0\0\x18ftypheic\0\0\0\0mif1heic'),
};

export type Colour = 'red' | 'blue' | 'other';

/**
The colour at each point (fractions of the width and height) of a canvas or a
loaded image, as drawn; JPEG's small colour shifts are allowed for.
*/
export function coloursAt(
  element: Locator,
  points: readonly (readonly [number, number])[],
): Promise<Colour[]> {
  return element.evaluate((node, at) => {
    let source: HTMLCanvasElement;
    if (node instanceof HTMLCanvasElement) {
      source = node;
    } else if (node instanceof HTMLImageElement) {
      source = document.createElement('canvas');
      source.width = node.naturalWidth;
      source.height = node.naturalHeight;
      source.getContext('2d')?.drawImage(node, 0, 0);
    } else {
      throw new Error('neither a canvas nor an image');
    }
    const context = source.getContext('2d');
    if (!context) throw new Error('no 2D context');
    return at.map(([x, y]) => {
      const [red = 0, , blue = 0] = context.getImageData(
        Math.min(source.width - 1, Math.floor(x * source.width)),
        Math.min(source.height - 1, Math.floor(y * source.height)),
        1,
        1,
      ).data;
      if (red > 150 && blue < 100) return 'red';
      if (blue > 150 && red < 100) return 'blue';
      return 'other';
    });
  }, points);
}

/** Picks a file through the platform's picker that the button opens. */
export async function pickWith(
  page: Page,
  button: Locator,
  path: string,
): Promise<void> {
  const [chooser] = await Promise.all([
    page.waitForEvent('filechooser'),
    button.click(),
  ]);
  await chooser.setFiles(path);
}

/** Width and height from a JPEG's frame header (SOF0–SOF2), or undefined. */
export function jpegSize(
  bytes: Buffer,
): { width: number; height: number } | undefined {
  let at = 2;
  while (at + 9 < bytes.length && bytes[at] === 0xff) {
    const marker = bytes[at + 1] ?? 0;
    if (marker >= 0xc0 && marker <= 0xc2) {
      return {
        height: bytes.readUInt16BE(at + 5),
        width: bytes.readUInt16BE(at + 7),
      };
    }
    at += 2 + bytes.readUInt16BE(at + 2);
  }
  return undefined;
}
