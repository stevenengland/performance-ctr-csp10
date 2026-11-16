import { onScopeDispose, readonly, shallowReadonly, shallowRef } from 'vue';
import {
  CENTRED,
  decodePhoto,
  encodePhoto,
  type Framing,
} from '../../../core/person-photo';

/** How the draft decodes and encodes; the browser's by default. */
export interface PhotoDraftCodec {
  decode: (file: Blob) => Promise<ImageBitmap>;
  encode: (picture: ImageBitmap, framing: Framing) => Promise<string>;
}

/**
The photo being framed in the person dialog (§7i), an asynchronous resource with
a lifecycle:

- Each pick starts a new generation and **the latest pick wins**: a decode that
  finishes after a newer pick, after `cancelPicks` or after `discard` is thrown
  away and its picture closed. A pick that cannot be decoded rejects (when it is
  still the latest) and keeps the previous photo.
- Every working image is closed when it is replaced, discarded, when the scope
  ends (the dialog unmounts) and once it is encoded. The encoded photo is kept,
  so saving again sends the same image; the framing is frozen from then on.
*/
export function usePhotoDraft({
  decode = decodePhoto,
  encode = encodePhoto,
}: Partial<PhotoDraftCodec> = {}) {
  /** The working image on show; closed (but still shown on the canvas) once encoded. */
  const picture = shallowRef<ImageBitmap>();
  const framing = shallowRef<Framing>(CENTRED);
  let image: string | undefined;
  const encoded = shallowRef(false);
  let generation = 0;

  /** Resolves to whether the picked photo is now on show (false once a newer pick or a discard replaced it). */
  async function pick(file: Blob): Promise<boolean> {
    const mine = ++generation;
    let next: ImageBitmap;
    try {
      next = await decode(file);
    } catch (failure) {
      if (mine === generation) throw failure;
      return false;
    }
    if (mine !== generation) {
      next.close();
      return false;
    }
    release();
    picture.value = next;
    framing.value = CENTRED;
    return true;
  }

  /** Drops the picks still decoding; the photo on show stays. */
  function cancelPicks(): void {
    generation += 1;
  }

  /** Drops the photo and every pick still decoding. */
  function discard(): void {
    cancelPicks();
    release();
  }

  function release(): void {
    picture.value?.close();
    picture.value = undefined;
    image = undefined;
    encoded.value = false;
  }

  /** The stored photo (base64 JPEG) of the framed picture, made once. */
  async function encodeDraft(): Promise<string> {
    if (image !== undefined) return image;
    const current = picture.value;
    if (!current) throw new Error('no photo to encode');
    const made = await encode(current, framing.value);
    current.close();
    if (picture.value === current) {
      image = made;
      encoded.value = true;
    }
    return made;
  }

  onScopeDispose(discard);

  return {
    picture: shallowReadonly(picture),
    framing,
    encoded: readonly(encoded),
    pick,
    cancelPicks,
    discard,
    encode: encodeDraft,
  };
}

export type PhotoDraft = ReturnType<typeof usePhotoDraft>;
