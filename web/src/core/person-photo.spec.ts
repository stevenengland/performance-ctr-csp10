import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  CENTRED,
  clampFraming,
  decodePhoto,
  encodePhoto,
  initialsOf,
  JPEG_QUALITIES,
  MAX_PHOTO_BYTES,
  MAX_WORKING_EDGE,
  MAX_ZOOM,
  PHOTO_SIZE,
  PhotoUnreadable,
  placement,
} from './person-photo';

describe('initialsOf', () => {
  it.each([
    ['Anna', 'A'],
    ['Anna Lena', 'AL'],
    ['Anna Lena Schmidt', 'AS'],
    ['  daniel   von   berg ', 'DB'],
    ['Øyvind Ærø', 'ØÆ'],
    ['😀 Tom', '😀T'],
    ['', ''],
  ])(
    'takes the first letters of the first and last word of %j',
    (name, initials) => {
      expect(initialsOf(name)).toBe(initials);
    },
  );
});

describe('placement', () => {
  it('centres a landscape picture so its height just covers the frame', () => {
    expect(placement(400, 200, CENTRED, 100)).toEqual({
      left: -50,
      top: 0,
      width: 200,
      height: 100,
    });
  });

  it('centres a portrait picture so its width just covers the frame', () => {
    expect(placement(300, 600, CENTRED, 256)).toEqual({
      left: 0,
      top: -128,
      width: 256,
      height: 512,
    });
  });

  it('zooms around the frame’s centre', () => {
    expect(placement(100, 100, { zoom: 2, x: 0, y: 0 }, 100)).toEqual({
      left: -50,
      top: -50,
      width: 200,
      height: 200,
    });
  });

  it('moves the picture by fractions of the frame’s edge', () => {
    expect(placement(400, 200, { zoom: 1, x: 0.25, y: 0 }, 100)).toEqual({
      left: -25,
      top: 0,
      width: 200,
      height: 100,
    });
  });

  it('frames the same part of the picture at every frame size', () => {
    const framing = { zoom: 1.5, x: -0.1, y: 0.2 };
    const small = placement(640, 480, framing, 232);
    const large = placement(640, 480, framing, 256);
    const ratio = 256 / 232;

    expect(large.left).toBeCloseTo(small.left * ratio);
    expect(large.top).toBeCloseTo(small.top * ratio);
    expect(large.width).toBeCloseTo(small.width * ratio);
  });
});

describe('clampFraming', () => {
  /** True when the placed picture covers the whole frame of edge 1. */
  function covers(width: number, height: number, framing = CENTRED) {
    const at = placement(width, height, framing, 1);
    const tolerance = 1e-9;
    return (
      at.left <= tolerance &&
      at.top <= tolerance &&
      at.left + at.width >= 1 - tolerance &&
      at.top + at.height >= 1 - tolerance
    );
  }

  it('keeps the zoom between 1 and the maximum', () => {
    expect(clampFraming(100, 100, { zoom: 0.2, x: 0, y: 0 }).zoom).toBe(1);
    expect(clampFraming(100, 100, { zoom: 9, x: 0, y: 0 }).zoom).toBe(MAX_ZOOM);
  });

  it('stops a move at the picture’s edge', () => {
    expect(clampFraming(400, 200, { zoom: 1, x: 3, y: -3 })).toEqual({
      zoom: 1,
      x: 0.5,
      y: 0,
    });
  });

  it('allows more movement the further it zooms in', () => {
    expect(clampFraming(200, 200, { zoom: 2, x: -3, y: 3 })).toEqual({
      zoom: 2,
      x: -0.5,
      y: 0.5,
    });
  });

  it('pulls the picture back over the frame when zooming out', () => {
    const zoomedIn = clampFraming(300, 200, { zoom: 3, x: 1, y: 1 });

    const zoomedOut = clampFraming(300, 200, { ...zoomedIn, zoom: 1 });

    expect(covers(300, 200, zoomedOut)).toBe(true);
    expect(zoomedOut).toEqual({ zoom: 1, x: 0.25, y: 0 });
  });

  it.each([
    [4032, 3024],
    [1, 2048],
    [2048, 7],
    [500, 500],
  ])('never uncovers the frame of a %i × %i picture', (width, height) => {
    for (const framing of [
      { zoom: 1, x: 9, y: 9 },
      { zoom: 1.37, x: -9, y: 0.3 },
      { zoom: 4, x: 0.6, y: -9 },
      { zoom: -1, x: -9, y: -9 },
    ]) {
      expect(covers(width, height, clampFraming(width, height, framing))).toBe(
        true,
      );
    }
  });
});

/** A stand-in for a decoded picture; jsdom has no `ImageBitmap`. */
function bitmap(width: number, height: number) {
  return { width, height, close: vi.fn() } as unknown as ImageBitmap;
}

describe('decodePhoto', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  /** A browser whose pictures are `width` × `height` once upright. */
  function browser(width: number, height: number) {
    const decoded: ImageBitmap[] = [];
    const decode = vi.fn(
      async (_file: Blob, options: ImageBitmapOptions = {}) => {
        const resizedWidth =
          options.resizeWidth ??
          Math.round((width * (options.resizeHeight ?? height)) / height);
        const resizedHeight =
          options.resizeHeight ?? Math.round((height * resizedWidth) / width);
        const picture = bitmap(resizedWidth, resizedHeight);
        decoded.push(picture);
        return picture;
      },
    );
    vi.stubGlobal('createImageBitmap', decode);
    return { decode, decoded };
  }

  it.each([
    [4032, 3024],
    [3024, 4032],
    [6000, 1000],
    [1000, 6000],
    [3000, 3000],
    [3001, 2999],
    [120, 90],
  ])(
    'decodes a %i × %i picture upright into a working image of at most 2048 px, in its aspect',
    async (width, height) => {
      const { decode } = browser(width, height);

      const picture = await decodePhoto(new Blob(['photo']));

      const longer = Math.max(picture.width, picture.height);
      expect(longer).toBeLessThanOrEqual(MAX_WORKING_EDGE);
      expect(longer).toBeGreaterThan(MAX_WORKING_EDGE * 0.99);
      expect(picture.width / picture.height).toBeCloseTo(width / height, 1);
      for (const [, options] of decode.mock.calls) {
        expect(options).toMatchObject({ imageOrientation: 'from-image' });
      }
    },
  );

  it('decodes no picture at full size and keeps only the working image', async () => {
    const { decode, decoded } = browser(4032, 3024);

    const picture = await decodePhoto(new Blob(['photo']));

    for (const [, options] of decode.mock.calls) {
      expect(options?.resizeWidth).toBeLessThanOrEqual(MAX_WORKING_EDGE);
    }
    for (const other of decoded.filter((each) => each !== picture)) {
      expect(other.close).toHaveBeenCalled();
    }
    expect(picture.close).not.toHaveBeenCalled();
  });

  it.each([
    [1000, 20000],
    [1, 2048],
    [20000, 1000],
    [2048, 1],
    [500, 30000],
  ])(
    'decodes no bitmap of a %i × %i picture with a side over 2048 px, probes included',
    async (width, height) => {
      const { decoded } = browser(width, height);

      const picture = await decodePhoto(new Blob(['photo']));

      for (const each of decoded) {
        expect(Math.max(each.width, each.height)).toBeLessThanOrEqual(
          MAX_WORKING_EDGE,
        );
      }
      expect(Math.max(picture.width, picture.height)).toBeGreaterThan(
        MAX_WORKING_EDGE * 0.95,
      );
    },
  );

  it('rejects a picture more than 2048 times taller than wide as unreadable', async () => {
    const { decoded } = browser(1, 4096);

    await expect(decodePhoto(new Blob(['photo']))).rejects.toBeInstanceOf(
      PhotoUnreadable,
    );
    for (const each of decoded) {
      expect(Math.max(each.width, each.height)).toBeLessThanOrEqual(4096);
      expect(each.close).toHaveBeenCalled();
    }
  });

  it('rejects a file the browser cannot decode as unreadable', async () => {
    vi.stubGlobal(
      'createImageBitmap',
      vi.fn(() => Promise.reject(new DOMException('no', 'InvalidStateError'))),
    );

    await expect(decodePhoto(new Blob(['heic']))).rejects.toBeInstanceOf(
      PhotoUnreadable,
    );
  });
});

describe('encodePhoto', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  /**
  A canvas whose JPEG at each quality has the given size, recording where the
  picture is drawn; jsdom draws and encodes nothing.
  */
  function canvas(sizeAt: (quality: number) => number, type = 'image/jpeg') {
    const drawn: unknown[][] = [];
    const qualities: number[] = [];
    const context = {
      fillStyle: '',
      imageSmoothingQuality: 'low',
      fillRect: vi.fn(),
      drawImage: vi.fn((...args: unknown[]) => drawn.push(args)),
    };
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(
      context as unknown as CanvasRenderingContext2D,
    );
    vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation(
      function (this: HTMLCanvasElement, done, _type, quality) {
        qualities.push(Number(quality));
        const size = sizeAt(Number(quality));
        done(new Blob([new Uint8Array(size).fill(0xff)], { type }));
      },
    );
    return { drawn, qualities };
  }

  it('draws the framed picture into a 256 × 256 JPEG at quality 0.85, as base64', async () => {
    const { drawn, qualities } = canvas(() => 3);
    const picture = bitmap(400, 200);
    const framing = { zoom: 1.5, x: 0.1, y: -0.2 };

    const image = await encodePhoto(picture, framing);

    const at = placement(400, 200, framing, PHOTO_SIZE);
    expect(drawn).toEqual([[picture, at.left, at.top, at.width, at.height]]);
    expect(qualities).toEqual([0.85]);
    expect(image).toBe('////');
  });

  it('lowers the quality step by step until the photo fits under 64 KiB', async () => {
    const { qualities } = canvas((quality) =>
      quality > 0.6 ? MAX_PHOTO_BYTES + 1 : MAX_PHOTO_BYTES,
    );

    const image = await encodePhoto(bitmap(300, 300), CENTRED);

    expect(qualities).toEqual([0.85, 0.75, 0.6]);
    expect(atob(image)).toHaveLength(MAX_PHOTO_BYTES);
  });

  it('fails as unreadable when even the lowest quality is too large', async () => {
    const { qualities } = canvas(() => MAX_PHOTO_BYTES + 1);

    await expect(encodePhoto(bitmap(300, 300), CENTRED)).rejects.toBeInstanceOf(
      PhotoUnreadable,
    );
    expect(qualities).toEqual([...JPEG_QUALITIES]);
  });

  it('fails as unreadable when the browser cannot encode a JPEG', async () => {
    canvas(() => 3, 'image/png');

    await expect(encodePhoto(bitmap(300, 300), CENTRED)).rejects.toBeInstanceOf(
      PhotoUnreadable,
    );
  });
});
