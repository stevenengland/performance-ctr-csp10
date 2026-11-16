import { afterEach, describe, expect, it, vi } from 'vitest';
import { effectScope } from 'vue';
import { CENTRED, PhotoUnreadable } from '../../../core/person-photo';
import { usePhotoDraft } from './photo-draft';

/** A stand-in for a decoded picture; jsdom has no `ImageBitmap`. */
function bitmap(name: string) {
  return { name, width: 400, height: 300, close: vi.fn() };
}
type Picture = ReturnType<typeof bitmap>;

/** A decode the test settles by hand, in any order. */
function pending() {
  let settle!: { resolve: (picture: Picture) => void; reject: () => void };
  const promise = new Promise<Picture>((resolve, reject) => {
    settle = { resolve, reject: () => reject(new PhotoUnreadable()) };
  });
  return { promise, ...settle };
}

/** A draft in its own scope (as in a component), with hand-settled decodes. */
function draftOf() {
  const decodes: ReturnType<typeof pending>[] = [];
  const decode = vi.fn(() => {
    const next = pending();
    decodes.push(next);
    return next.promise as unknown as Promise<ImageBitmap>;
  });
  const encode = vi.fn(() => Promise.resolve('/9j/AA=='));
  const scope = effectScope();
  const draft = scope.run(() => usePhotoDraft({ decode, encode }));
  if (!draft) throw new Error('no draft');
  return { draft, decodes, encode, scope };
}

const shown = (draft: ReturnType<typeof usePhotoDraft>) =>
  (draft.picture.value as unknown as Picture | undefined)?.name;

describe('the photo draft of the person dialog', () => {
  const scopes: ReturnType<typeof effectScope>[] = [];
  afterEach(() => {
    for (const scope of scopes.splice(0)) scope.stop();
  });
  function setUp() {
    const made = draftOf();
    scopes.push(made.scope);
    return made;
  }

  it('shows a picked photo centred', async () => {
    const { draft, decodes } = setUp();
    draft.framing.value = { zoom: 2, x: 0.1, y: 0 };

    const picture = bitmap('a');

    const picked = draft.pick(new Blob(['a']));
    decodes[0]?.resolve(picture);
    await picked;

    // The picture itself, not a proxy: the canvas draws only a real ImageBitmap.
    expect(draft.picture.value).toBe(picture);
    expect(draft.framing.value).toEqual(CENTRED);
  });

  it('keeps the latest pick when an earlier decode finishes after it, closing the earlier picture', async () => {
    const { draft, decodes } = setUp();
    const first = bitmap('first');
    const second = bitmap('second');

    const picks = [draft.pick(new Blob(['1'])), draft.pick(new Blob(['2']))];
    decodes[1]?.resolve(second);
    decodes[0]?.resolve(first);

    await expect(Promise.all(picks)).resolves.toEqual([false, true]);
    expect(shown(draft)).toBe('second');
    expect(first.close).toHaveBeenCalled();
    expect(second.close).not.toHaveBeenCalled();
  });

  it('replaces an earlier photo whose decode finished first, closing it', async () => {
    const { draft, decodes } = setUp();
    const first = bitmap('first');
    const second = bitmap('second');

    const picks = [draft.pick(new Blob(['1'])), draft.pick(new Blob(['2']))];
    decodes[0]?.resolve(first);
    await Promise.resolve();
    decodes[1]?.resolve(second);
    await Promise.all(picks);

    expect(shown(draft)).toBe('second');
    expect(first.close).toHaveBeenCalled();
  });

  it('closes every picture across repeated replacing and discarding', async () => {
    const { draft, decodes } = setUp();
    const pictures = ['a', 'b', 'c'].map(bitmap);

    for (const [index, picture] of pictures.entries()) {
      const picked = draft.pick(new Blob([picture.name]));
      decodes[index]?.resolve(picture);
      await picked;
    }
    draft.discard();

    expect(shown(draft)).toBeUndefined();
    for (const picture of pictures) {
      expect(picture.close).toHaveBeenCalledTimes(1);
    }
  });

  it('discards and closes a decode that finishes after the draft was discarded', async () => {
    const { draft, decodes } = setUp();
    const late = bitmap('late');

    const picked = draft.pick(new Blob(['late']));
    draft.discard();
    decodes[0]?.resolve(late);
    await picked;

    expect(shown(draft)).toBeUndefined();
    expect(late.close).toHaveBeenCalled();
  });

  it('closes the picture when its scope ends (the dialog unmounts)', async () => {
    const { draft, decodes, scope } = setUp();
    const picture = bitmap('a');
    const picked = draft.pick(new Blob(['a']));
    decodes[0]?.resolve(picture);
    await picked;

    scope.stop();

    expect(picture.close).toHaveBeenCalled();
  });

  it('keeps the previous photo and its framing when a newer pick cannot be decoded', async () => {
    const { draft, decodes } = setUp();
    const first = bitmap('first');
    const picked = draft.pick(new Blob(['1']));
    decodes[0]?.resolve(first);
    await picked;
    draft.framing.value = { zoom: 2, x: 0.2, y: 0 };

    const failing = draft.pick(new Blob(['heic']));
    decodes[1]?.reject();

    await expect(failing).rejects.toBeInstanceOf(PhotoUnreadable);
    expect(shown(draft)).toBe('first');
    expect(draft.framing.value).toEqual({ zoom: 2, x: 0.2, y: 0 });
    expect(first.close).not.toHaveBeenCalled();
  });

  it('ignores the failure of a pick a newer one replaced', async () => {
    const { draft, decodes } = setUp();

    const outdated = draft.pick(new Blob(['heic']));
    const latest = draft.pick(new Blob(['2']));
    decodes[0]?.reject();
    decodes[1]?.resolve(bitmap('latest'));

    await expect(outdated).resolves.toBe(false);
    await latest;
    expect(shown(draft)).toBe('latest');
  });

  it('drops picks still decoding once saving starts, keeping the shown photo', async () => {
    const { draft, decodes } = setUp();
    const picked = draft.pick(new Blob(['a']));
    decodes[0]?.resolve(bitmap('a'));
    await picked;
    const late = bitmap('late');

    const latePick = draft.pick(new Blob(['late']));
    draft.cancelPicks();
    decodes[1]?.resolve(late);
    await latePick;

    expect(shown(draft)).toBe('a');
    expect(late.close).toHaveBeenCalled();
  });

  it('encodes the framed photo once, closing its picture, and freezes the framing', async () => {
    const { draft, decodes, encode } = setUp();
    const picture = bitmap('a');
    const picked = draft.pick(new Blob(['a']));
    decodes[0]?.resolve(picture);
    await picked;
    draft.framing.value = { zoom: 1.5, x: 0.1, y: 0 };

    await expect(draft.encode()).resolves.toBe('/9j/AA==');
    await expect(draft.encode()).resolves.toBe('/9j/AA==');

    expect(encode).toHaveBeenCalledTimes(1);
    expect(encode).toHaveBeenCalledWith(picture, { zoom: 1.5, x: 0.1, y: 0 });
    expect(picture.close).toHaveBeenCalled();
    expect(draft.encoded.value).toBe(true);
    expect(shown(draft)).toBe('a');
  });

  it('keeps the picture open and the draft framable when encoding fails', async () => {
    const { draft, decodes, encode } = setUp();
    const picture = bitmap('a');
    const picked = draft.pick(new Blob(['a']));
    decodes[0]?.resolve(picture);
    await picked;
    encode.mockRejectedValueOnce(new PhotoUnreadable());

    await expect(draft.encode()).rejects.toBeInstanceOf(PhotoUnreadable);

    expect(picture.close).not.toHaveBeenCalled();
    expect(draft.encoded.value).toBe(false);
    expect(shown(draft)).toBe('a');
  });

  it('starts a new pick unencoded', async () => {
    const { draft, decodes } = setUp();
    const picked = draft.pick(new Blob(['a']));
    decodes[0]?.resolve(bitmap('a'));
    await picked;
    await draft.encode();

    const next = draft.pick(new Blob(['b']));
    decodes[1]?.resolve(bitmap('b'));
    await next;

    expect(draft.encoded.value).toBe(false);
    expect(shown(draft)).toBe('b');
  });
});
