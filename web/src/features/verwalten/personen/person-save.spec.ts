import { flushPromises } from '@vue/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Person } from '../../../core/api-client';
import { loadPersons, usePersons } from '../../../core/catalog';
import { dismissSnackbar, useSnackbar } from '../../../core/snackbar';
import { PhotoUnreadable } from '../../../core/person-photo';
import { personSave, type PhotoChange } from './person-save';

const PHOTO = '/api/persons/2/photo?v=abc';
const NEW_PHOTO = '/api/persons/2/photo?v=def';
const CREATED_PHOTO = '/api/persons/3/photo?v=fed';
const daniel: Person = { id: 2, name: 'Daniel', photoUrl: PHOTO };
const anna: Person = { id: 1, name: 'Anna', photoUrl: null };

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function failure(title: string) {
  return new Response(JSON.stringify({ status: 500, title }), {
    status: 500,
    headers: { 'Content-Type': 'application/problem+json' },
  });
}

/**
A fake API over Anna and Daniel: creating (Jule, id 3), renames, photo uploads
(kept in `images`) and removals change what the list answers; a request named in `failing` (`'DELETE /api/persons/2/photo'`) answers 500.
*/
function server() {
  const persons = [anna, { ...daniel }];
  const calls: string[] = [];
  const images: string[] = [];
  const failing = new Set<string>();
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init: RequestInit) => {
      const call = `${init.method ?? 'GET'} ${url}`;
      calls.push(call);
      if (failing.has(call)) return failure(`${call} failed`);
      if (call === 'GET /api/persons') return json({ persons });
      if (call === 'POST /api/persons') {
        const created: Person = {
          id: 3,
          name: (JSON.parse(String(init.body)) as Person).name.trim(),
          photoUrl: null,
        };
        persons.push(created);
        return json(created, 201);
      }
      if (call === 'PUT /api/persons/3/photo') {
        const created = persons[2] as Person;
        images.push((JSON.parse(String(init.body)) as { image: string }).image);
        created.photoUrl = CREATED_PHOTO;
        return json(created);
      }
      if (call === 'PATCH /api/persons/3') {
        const created = persons[2] as Person;
        created.name = (JSON.parse(String(init.body)) as Person).name;
        return json(created);
      }
      const person = persons[1] as Person;
      if (call === 'PATCH /api/persons/2') {
        person.name = (JSON.parse(String(init.body)) as Person).name;
        return json(person);
      }
      if (call === 'DELETE /api/persons/2/photo') {
        person.photoUrl = null;
        return new Response(null, { status: 204 });
      }
      if (call === 'PUT /api/persons/2/photo') {
        images.push((JSON.parse(String(init.body)) as { image: string }).image);
        person.photoUrl = NEW_PHOTO;
        return json(person);
      }
      throw new Error(`unexpected ${call}`);
    }),
  );
  return { calls, images, failing };
}

/** The persons list as the store holds it, loaded once like a screen does. */
async function loadedList() {
  const api = server();
  await loadPersons();
  api.calls.length = 0;
  return api;
}

/** A framed photo whose encoding answers `image`, or fails with `failure`. */
function framed(image = 'AAAA', failure?: Error) {
  const encode = vi.fn(() =>
    failure ? Promise.reject(failure) : Promise.resolve(image),
  );
  return { encode, change: { kind: 'new', encode } as PhotoChange };
}

describe('saving a person in the dialog', () => {
  beforeEach(dismissSnackbar);
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('sends only the photo removal when the name is unchanged', async () => {
    const api = await loadedList();

    const outcome = await personSave(daniel).save({
      name: 'Daniel',
      photo: { kind: 'remove' },
    });

    expect(outcome).toEqual({ kind: 'saved' });
    expect(api.calls.slice(0, 1)).toEqual(['DELETE /api/persons/2/photo']);
  });

  it('renames first and removes the photo second', async () => {
    const api = await loadedList();

    await personSave(daniel).save({ name: 'Dani', photo: { kind: 'remove' } });

    expect(api.calls.slice(0, 2)).toEqual([
      'PATCH /api/persons/2',
      'DELETE /api/persons/2/photo',
    ]);
  });

  it('sends no name request for a name that only differs by surrounding spaces', async () => {
    const api = await loadedList();

    await personSave(daniel).save({
      name: ' Daniel ',
      photo: { kind: 'remove' },
    });

    expect(api.calls).not.toContain('PATCH /api/persons/2');
  });

  it('sends nothing when nothing changed', async () => {
    const api = await loadedList();

    const outcome = await personSave(daniel).save({
      name: 'Daniel',
      photo: { kind: 'keep' },
    });
    await flushPromises();

    expect(outcome).toEqual({ kind: 'saved' });
    expect(api.calls).toEqual([]);
  });

  it('puts the answers in the list at once and reloads it on its own', async () => {
    const api = await loadedList();

    await personSave(daniel).save({ name: 'Dani', photo: { kind: 'remove' } });

    expect(usePersons().value?.[1]).toEqual({
      id: 2,
      name: 'Dani',
      photoUrl: null,
    });
    expect(api.calls).toEqual([
      'PATCH /api/persons/2',
      'DELETE /api/persons/2/photo',
      'GET /api/persons',
    ]);
  });

  it('counts the save when the reload fails, keeps the answers in the list and shows the list’s error', async () => {
    const api = await loadedList();
    api.failing.add('GET /api/persons');

    const outcome = await personSave(daniel).save({
      name: 'Dani',
      photo: { kind: 'remove' },
    });
    await flushPromises();

    expect(outcome).toEqual({ kind: 'saved' });
    expect(usePersons().value?.[1]).toEqual({
      id: 2,
      name: 'Dani',
      photoUrl: null,
    });
    expect(useSnackbar().value?.text).toBe('GET /api/persons failed');
  });

  it('says the photo is not saved when the rename committed and the removal failed', async () => {
    const api = await loadedList();
    api.failing.add('DELETE /api/persons/2/photo');
    const saving = personSave(daniel);

    const outcome = await saving.save({
      name: 'Dani',
      photo: { kind: 'remove' },
    });

    expect(outcome).toEqual({
      kind: 'photoNotSaved',
      failure: expect.anything(),
    });
    expect(saving.person).toEqual({ id: 2, name: 'Dani', photoUrl: PHOTO });
    expect(usePersons().value?.[1]).toEqual(saving.person);
  });

  it('retries only the removal after a partial save', async () => {
    const api = await loadedList();
    api.failing.add('DELETE /api/persons/2/photo');
    const saving = personSave(daniel);
    const draft = { name: 'Dani', photo: { kind: 'remove' } } as const;
    await saving.save(draft);
    api.failing.clear();
    api.calls.length = 0;

    const outcome = await saving.save(draft);

    expect(outcome).toEqual({ kind: 'saved' });
    expect(api.calls.slice(0, 1)).toEqual(['DELETE /api/persons/2/photo']);
    expect(api.calls).not.toContain('PATCH /api/persons/2');
  });

  it('still says the photo is not saved when its retry fails again', async () => {
    const api = await loadedList();
    api.failing.add('DELETE /api/persons/2/photo');
    const saving = personSave(daniel);
    const draft = { name: 'Dani', photo: { kind: 'remove' } } as const;
    await saving.save(draft);

    await expect(saving.save(draft)).resolves.toMatchObject({
      kind: 'photoNotSaved',
    });
  });

  it('fails as a whole when nothing committed', async () => {
    const api = await loadedList();
    api.failing.add('DELETE /api/persons/2/photo');

    await expect(
      personSave(daniel).save({ name: 'Daniel', photo: { kind: 'remove' } }),
    ).rejects.toMatchObject({ status: 500 });
    expect(api.calls).toEqual(['DELETE /api/persons/2/photo']);
  });

  it('sends no photo request when the rename fails', async () => {
    const api = await loadedList();
    api.failing.add('PATCH /api/persons/2');

    await expect(
      personSave(daniel).save({ name: 'Dani', photo: { kind: 'remove' } }),
    ).rejects.toMatchObject({ status: 500 });
    expect(api.calls).toEqual(['PATCH /api/persons/2']);
  });

  describe('a new photo', () => {
    it('encodes the photo before anything is sent, then renames, then puts the photo', async () => {
      const api = await loadedList();
      const photo = framed('/9j/AA==');
      let sentBeforeEncoding: string[] | undefined;
      photo.encode.mockImplementation(() => {
        sentBeforeEncoding = [...api.calls];
        return Promise.resolve('/9j/AA==');
      });

      const outcome = await personSave(daniel).save({
        name: 'Dani',
        photo: photo.change,
      });

      expect(outcome).toEqual({ kind: 'saved' });
      expect(sentBeforeEncoding).toEqual([]);
      expect(api.calls.slice(0, 2)).toEqual([
        'PATCH /api/persons/2',
        'PUT /api/persons/2/photo',
      ]);
      expect(api.images).toEqual(['/9j/AA==']);
    });

    it('sends only the photo when the name is unchanged', async () => {
      const api = await loadedList();

      await personSave(daniel).save({
        name: 'Daniel',
        photo: framed().change,
      });

      expect(api.calls.slice(0, 1)).toEqual(['PUT /api/persons/2/photo']);
    });

    it('puts the acknowledged photo in the list at once and reloads it on its own', async () => {
      const api = await loadedList();
      const saving = personSave(daniel);

      await saving.save({ name: 'Daniel', photo: framed().change });

      expect(saving.person).toEqual({ ...daniel, photoUrl: NEW_PHOTO });
      expect(usePersons().value?.[1]).toEqual(saving.person);
      expect(api.calls).toEqual([
        'PUT /api/persons/2/photo',
        'GET /api/persons',
      ]);
    });

    it('counts the save when the photo committed and only the reload fails', async () => {
      const api = await loadedList();
      api.failing.add('GET /api/persons');

      const outcome = await personSave(daniel).save({
        name: 'Daniel',
        photo: framed().change,
      });
      await flushPromises();

      expect(outcome).toEqual({ kind: 'saved' });
      expect(usePersons().value?.[1]?.photoUrl).toBe(NEW_PHOTO);
      expect(useSnackbar().value?.text).toBe('GET /api/persons failed');
    });

    it('sends nothing, not even a pending rename, when the photo cannot be encoded', async () => {
      const api = await loadedList();
      const unreadable = new PhotoUnreadable();

      await expect(
        personSave(daniel).save({
          name: 'Dani',
          photo: framed('', unreadable).change,
        }),
      ).rejects.toBe(unreadable);
      expect(api.calls).toEqual([]);
    });

    it('says the photo is not saved when the rename committed and the upload failed, and retries only the upload', async () => {
      const api = await loadedList();
      api.failing.add('PUT /api/persons/2/photo');
      const saving = personSave(daniel);
      const draft = { name: 'Dani', photo: framed('/9j/AA==').change };

      await expect(saving.save(draft)).resolves.toMatchObject({
        kind: 'photoNotSaved',
      });
      api.failing.clear();
      api.calls.length = 0;
      api.images.length = 0;

      await expect(saving.save(draft)).resolves.toEqual({ kind: 'saved' });
      expect(api.calls.slice(0, 1)).toEqual(['PUT /api/persons/2/photo']);
      expect(api.images).toEqual(['/9j/AA==']);
    });

    it('fails as a whole when only the upload was pending and it failed', async () => {
      const api = await loadedList();
      api.failing.add('PUT /api/persons/2/photo');

      await expect(
        personSave(daniel).save({ name: 'Daniel', photo: framed().change }),
      ).rejects.toMatchObject({ status: 500 });
    });
  });

  describe('a new person', () => {
    const jule: Person = { id: 3, name: 'Jule', photoUrl: null };

    it('encodes the photo before anything is sent, then creates the person, then puts the photo', async () => {
      const api = await loadedList();
      const photo = framed('/9j/AA==');
      let sentBeforeEncoding: string[] | undefined;
      photo.encode.mockImplementation(() => {
        sentBeforeEncoding = [...api.calls];
        return Promise.resolve('/9j/AA==');
      });
      const saving = personSave(undefined);

      const outcome = await saving.save({ name: 'Jule', photo: photo.change });

      expect(outcome).toEqual({ kind: 'saved' });
      expect(sentBeforeEncoding).toEqual([]);
      expect(api.calls).toEqual([
        'POST /api/persons',
        'PUT /api/persons/3/photo',
        'GET /api/persons',
      ]);
      expect(api.images).toEqual(['/9j/AA==']);
      expect(saving.person).toEqual({ ...jule, photoUrl: CREATED_PHOTO });
    });

    it('creates a person without a photo with the POST alone', async () => {
      const api = await loadedList();
      const saving = personSave(undefined);

      await saving.save({ name: 'Jule', photo: { kind: 'keep' } });

      expect(api.calls).toEqual(['POST /api/persons', 'GET /api/persons']);
      expect(saving.person).toEqual(jule);
    });

    it('puts the created person in the list at once, before the reload answers', async () => {
      const api = await loadedList();
      api.failing.add('GET /api/persons');
      const saving = personSave(undefined);

      const outcome = await saving.save({
        name: 'Jule',
        photo: framed().change,
      });

      expect(outcome).toEqual({ kind: 'saved' });
      expect(usePersons().value?.map(({ name }) => name)).toEqual([
        'Anna',
        'Daniel',
        'Jule',
      ]);
      expect(usePersons().value?.[2]).toEqual(saving.person);
    });

    it('keeps the created person and counts the save when only the reload fails', async () => {
      const api = await loadedList();
      api.failing.add('GET /api/persons');
      const saving = personSave(undefined);

      const outcome = await saving.save({
        name: 'Jule',
        photo: { kind: 'keep' },
      });
      await flushPromises();

      expect(outcome).toEqual({ kind: 'saved' });
      expect(saving.person).toEqual(jule);
      expect(usePersons().value).toContainEqual(jule);
      expect(useSnackbar().value?.text).toBe('GET /api/persons failed');
    });

    it('keeps the list in alphabetical order', async () => {
      await loadedList();

      await personSave(undefined).save({
        name: 'Ben',
        photo: { kind: 'keep' },
      });

      expect(usePersons().value?.map(({ name }) => name)).toEqual([
        'Anna',
        'Ben',
        'Daniel',
      ]);
    });

    it('says the photo is not saved when the person was created and the upload failed, and retries only the upload', async () => {
      const api = await loadedList();
      api.failing.add('PUT /api/persons/3/photo');
      const saving = personSave(undefined);
      const draft = { name: 'Jule', photo: framed('/9j/AA==').change };

      await expect(saving.save(draft)).resolves.toMatchObject({
        kind: 'photoNotSaved',
      });
      expect(saving.person).toEqual(jule);
      expect(usePersons().value).toContainEqual(jule);
      api.failing.clear();
      api.calls.length = 0;
      api.images.length = 0;

      await expect(saving.save(draft)).resolves.toEqual({ kind: 'saved' });
      expect(api.calls).toEqual([
        'PUT /api/persons/3/photo',
        'GET /api/persons',
      ]);
      expect(api.images).toEqual(['/9j/AA==']);
    });

    it('renames the created person, never creating it twice, when the name changed before the retry', async () => {
      const api = await loadedList();
      api.failing.add('PUT /api/persons/3/photo');
      const saving = personSave(undefined);
      const photo = framed().change;
      await saving.save({ name: 'Jule', photo });
      api.failing.clear();
      api.calls.length = 0;

      await saving.save({ name: 'Julia', photo });

      expect(api.calls.slice(0, 2)).toEqual([
        'PATCH /api/persons/3',
        'PUT /api/persons/3/photo',
      ]);
    });

    it('sends nothing when the photo cannot be encoded', async () => {
      const api = await loadedList();
      const unreadable = new PhotoUnreadable();
      const saving = personSave(undefined);

      await expect(
        saving.save({ name: 'Jule', photo: framed('', unreadable).change }),
      ).rejects.toBe(unreadable);
      expect(api.calls).toEqual([]);
      expect(saving.person).toBeUndefined();
    });

    it('sends no photo when creating fails, and creates on the next try', async () => {
      const api = await loadedList();
      api.failing.add('POST /api/persons');
      const saving = personSave(undefined);
      const draft = { name: 'Jule', photo: framed().change };

      await expect(saving.save(draft)).rejects.toMatchObject({ status: 500 });
      expect(api.calls).toEqual(['POST /api/persons']);
      expect(saving.person).toBeUndefined();
      api.failing.clear();
      api.calls.length = 0;

      await expect(saving.save(draft)).resolves.toEqual({ kind: 'saved' });
      expect(api.calls.slice(0, 2)).toEqual([
        'POST /api/persons',
        'PUT /api/persons/3/photo',
      ]);
    });
  });
});
