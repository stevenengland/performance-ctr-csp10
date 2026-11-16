/**
A person's photo in the browser. A person without one shows their initials
(`PersonAvatar`). A chosen picture is decoded into a bounded working image, the
member moves and zooms it inside a round frame (`PhotoCrop`), and the framed
square is re-encoded as the stored photo: a 256 × 256 JPEG of at most 64 KiB.
The server cleans and checks whatever it gets; this keeps normal uploads small.
*/

/** Edge of the stored photo in pixels. */
export const PHOTO_SIZE = 256;
/** The server's cap on the stored photo. */
export const MAX_PHOTO_BYTES = 64 * 1024;
/** How far the member can zoom in, relative to "the picture just covers the frame". */
export const MAX_ZOOM = 4;
/** The working image's longer side at most, so a camera picture never sits in memory at full size. */
export const MAX_WORKING_EDGE = 2048;
/** JPEG qualities tried in turn until the photo fits under the cap. */
export const JPEG_QUALITIES = [0.85, 0.75, 0.6, 0.45] as const;

/** Up to two initials: the first letters of the first and last word (`Anna Lena` → `AL`). */
export function initialsOf(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  const first = firstLetter(words[0]);
  const last = words.length > 1 ? firstLetter(words.at(-1)) : '';
  return (first + last).toLocaleUpperCase('de-DE');
}

/** By code point, so a letter outside the BMP is not cut in half. */
function firstLetter(word: string | undefined): string {
  return [...(word ?? '')][0] ?? '';
}

/**
The member's framing: `zoom` 1 means the picture just covers the square frame;
`x`/`y` move the picture's centre away from the frame's centre, in fractions of
the frame's edge, so a framing means the same at every frame size.
*/
export interface Framing {
  readonly zoom: number;
  readonly x: number;
  readonly y: number;
}

export const CENTRED: Framing = { zoom: 1, x: 0, y: 0 };

export interface Placement {
  left: number;
  top: number;
  width: number;
  height: number;
}

/** Where a `width` × `height` picture lands in a square frame of `edge` pixels. */
export function placement(
  width: number,
  height: number,
  framing: Framing,
  edge: number,
): Placement {
  const scale = (edge / Math.min(width, height)) * framing.zoom;
  const drawnWidth = width * scale;
  const drawnHeight = height * scale;
  return {
    left: (edge - drawnWidth) / 2 + framing.x * edge,
    top: (edge - drawnHeight) / 2 + framing.y * edge,
    width: drawnWidth,
    height: drawnHeight,
  };
}

/** The zoom kept from 1 to `MAX_ZOOM` and the offsets kept so the picture always covers the frame. */
export function clampFraming(
  width: number,
  height: number,
  framing: Framing,
): Framing {
  const zoom = within(framing.zoom, 1, MAX_ZOOM);
  const scale = zoom / Math.min(width, height);
  const slackX = (width * scale - 1) / 2;
  const slackY = (height * scale - 1) / 2;
  return {
    zoom,
    x: within(framing.x, -slackX, slackX),
    y: within(framing.y, -slackY, slackY),
  };
}

/** `value` kept from `min` to `max`; never `-0`, so a framing compares equal to its literal. */
function within(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value)) + 0;
}

/** A chosen file the browser cannot decode (HEIC on most desktops) or a frame it cannot encode as a small JPEG. */
export class PhotoUnreadable extends Error {
  constructor(options?: ErrorOptions) {
    super('The browser cannot decode or encode this photo.', options);
    this.name = 'PhotoUnreadable';
  }
}

/** Width of the probe that tells a picture's upright aspect, unless that would make it too tall. */
const PROBE_WIDTH = 256;
const UPRIGHT = { imageOrientation: 'from-image' } as const;

/**
Decodes a chosen file upright (EXIF orientation applied) into the working image:
its longer side at most `MAX_WORKING_EDGE`, scaled by the decode itself, so the
full-size picture is never kept. Two small decodes come first. One pixel wide,
the picture is as many pixels tall as it is times taller than wide (rounded up),
which bounds the second: as wide as `PROBE_WIDTH` allows while its height stays
in bounds. That one tells the aspect precisely enough to pick the width that
keeps the working image's longer side in bounds. Rejects with `PhotoUnreadable`
what the browser cannot decode, and a picture more than `MAX_WORKING_EDGE`
times taller than wide, which no working image in bounds could show.
*/
export async function decodePhoto(file: Blob): Promise<ImageBitmap> {
  try {
    const rough = await heightAt(file, 1);
    if (rough > MAX_WORKING_EDGE) throw new PhotoUnreadable();
    const probeWidth = Math.max(
      1,
      Math.min(PROBE_WIDTH, Math.floor(MAX_WORKING_EDGE / (rough + 1))),
    );
    const aspect = ((await heightAt(file, probeWidth)) + 1) / probeWidth;
    return await createImageBitmap(file, {
      ...UPRIGHT,
      resizeWidth: Math.max(
        1,
        Math.floor(Math.min(1, 1 / aspect) * MAX_WORKING_EDGE),
      ),
      resizeQuality: 'high',
    });
  } catch (failure) {
    if (failure instanceof PhotoUnreadable) throw failure;
    throw new PhotoUnreadable({ cause: failure });
  }
}

/** The height of the picture decoded upright at `width`, its bitmap closed at once. */
async function heightAt(file: Blob, width: number): Promise<number> {
  const probe = await createImageBitmap(file, {
    ...UPRIGHT,
    resizeWidth: width,
  });
  const { height } = probe;
  probe.close();
  return height;
}

/** Draws the framed picture into a square canvas context of `edge` pixels, on white (a JPEG has no transparency). */
export function drawFramed(
  context: CanvasRenderingContext2D,
  picture: ImageBitmap,
  framing: Framing,
  edge: number,
): void {
  const at = placement(picture.width, picture.height, framing, edge);
  context.fillStyle = '#fff';
  context.fillRect(0, 0, edge, edge);
  context.imageSmoothingQuality = 'high';
  context.drawImage(picture, at.left, at.top, at.width, at.height);
}

/**
The framed square as the stored photo: a 256 × 256 JPEG at quality 0.85, lowered
step by step until it is at most 64 KiB, in base64. Rejects with
`PhotoUnreadable` when the browser cannot make one.
*/
export async function encodePhoto(
  picture: ImageBitmap,
  framing: Framing,
): Promise<string> {
  const canvas = document.createElement('canvas');
  canvas.width = PHOTO_SIZE;
  canvas.height = PHOTO_SIZE;
  const context = canvas.getContext('2d');
  if (!context) throw new PhotoUnreadable();
  drawFramed(context, picture, framing, PHOTO_SIZE);
  for (const quality of JPEG_QUALITIES) {
    const jpeg = await jpegOf(canvas, quality);
    if (jpeg.size <= MAX_PHOTO_BYTES) return base64Of(jpeg);
  }
  throw new PhotoUnreadable();
}

function jpegOf(canvas: HTMLCanvasElement, quality: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (blob?.type === 'image/jpeg') resolve(blob);
        else reject(new PhotoUnreadable());
      },
      'image/jpeg',
      quality,
    );
  });
}

async function base64Of(blob: Blob): Promise<string> {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}
