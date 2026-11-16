/**
A person's photo, prepared in the browser: the chosen picture is decoded (EXIF
orientation applied), the member moves and zooms it inside a round frame, and the
framed square is re-encoded as a 256×256 JPEG — which also drops EXIF and GPS. The
server only checks the result (JPEG, 256×256, at most 64 KiB).
*/

/** Edge of the stored photo in pixels. */
export const PHOTO_SIZE = 256;
/** The server's cap on the stored photo. */
export const MAX_PHOTO_BYTES = 64 * 1024;
/** How far the member can zoom in, relative to "the picture just covers the frame". */
export const MAX_ZOOM = 4;

/** Up to two initials: first letters of the first and last word (`Anna Lena` → `AL`). */
export function initialsOf(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  const first = [...(words[0] ?? '')][0] ?? '';
  const last = words.length > 1 ? ([...(words.at(-1) ?? '')][0] ?? '') : '';
  return (first + last).toLocaleUpperCase('de-DE');
}

/**
The framing: `zoom` 1 means the picture just covers the square frame; `x`/`y` move
its centre away from the frame's centre, as fractions of the frame's edge.
*/
export interface Framing {
  zoom: number;
  x: number;
  y: number;
}

export const CENTRED: Framing = { zoom: 1, x: 0, y: 0 };

/** Where the picture lands in a square frame of `edge` pixels. */
export function placement(
  width: number,
  height: number,
  framing: Framing,
  edge: number,
): { left: number; top: number; width: number; height: number } {
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

/** Keeps the zoom in range and the frame covered: no empty edge ever shows. */
export function clampFraming(
  width: number,
  height: number,
  framing: Framing,
): Framing {
  const zoom = Math.min(MAX_ZOOM, Math.max(1, framing.zoom));
  const scale = zoom / Math.min(width, height);
  const slackX = (width * scale - 1) / 2;
  const slackY = (height * scale - 1) / 2;
  const clamp = (value: number, slack: number) =>
    Math.min(slack, Math.max(-slack, value));
  return { zoom, x: clamp(framing.x, slackX), y: clamp(framing.y, slackY) };
}

/** Decodes a chosen file; rejects what the browser cannot read (e.g. HEIC on desktop). */
export function decodePhoto(file: Blob): Promise<ImageBitmap> {
  return createImageBitmap(file, { imageOrientation: 'from-image' });
}

/** Draws the framed picture into a square canvas context of `edge` pixels. */
export function drawFramed(
  context: CanvasRenderingContext2D,
  picture: ImageBitmap,
  framing: Framing,
  edge: number,
): void {
  const at = placement(picture.width, picture.height, framing, edge);
  context.clearRect(0, 0, edge, edge);
  context.imageSmoothingQuality = 'high';
  context.drawImage(picture, at.left, at.top, at.width, at.height);
}

function toJpeg(canvas: HTMLCanvasElement, quality: number): Promise<Blob> {
  return new Promise((resolve, reject) =>
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error('encode'))),
      'image/jpeg',
      quality,
    ),
  );
}

async function base64Of(blob: Blob): Promise<string> {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

/** The framed square as the stored photo: a 256×256 JPEG under the cap, base64. */
export async function encodePhoto(
  picture: ImageBitmap,
  framing: Framing,
): Promise<string> {
  const canvas = document.createElement('canvas');
  canvas.width = PHOTO_SIZE;
  canvas.height = PHOTO_SIZE;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('canvas');
  drawFramed(context, picture, framing, PHOTO_SIZE);
  for (const quality of [0.85, 0.75, 0.6, 0.45]) {
    const blob = await toJpeg(canvas, quality);
    if (blob.size <= MAX_PHOTO_BYTES) return base64Of(blob);
  }
  throw new Error('too large');
}
