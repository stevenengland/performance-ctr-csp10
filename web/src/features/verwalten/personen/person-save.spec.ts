import { flushPromises } from '@vue/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Person } from '../../../core/api-client';
import { loadPersons, usePersons } from '../../../core/catalog';
import { dismissSnackbar, useSnackbar } from '../../../core/snackbar';
import { personSave } from './person-save';

const PHOTO = '/api/persons/2/photo?v=abc';
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
A fake API over Anna and Daniel: renames and photo removals change what the list
answers; a request named in `failing` (`'DELETE /api/persons/2/photo'`) answers 500.
*/
function server() {
  const persons = [anna, { ...daniel }];
  const calls: string[] = [];
  const failing = new Set<string>();
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init: RequestInit) => {
      const call = `${init.method ?? 'GET'} ${url}`;
      calls.push(call);
      if (failing.has(call)) return failure(`${call} failed`);
      if (call === 'GET /api/persons') return json({ persons });
      const person = persons[1] as Person;
      if (call === 'PATCH /api/persons/2') {
        person.name = (JSON.parse(String(init.body)) as Person).name;
        return json(person);
      }
      if (call === 'DELETE /api/persons/2/photo') {
        person.photoUrl = null;
        return new Response(null, { status: 204 });
      }
      throw new Error(`unexpected ${call}`);
    }),
  );
  return { calls, failing };
}

/** The persons list as the store holds it, loaded once like a screen does. */
async function loadedList() {
  const api = server();
  await loadPersons();
  api.calls.length = 0;
  return api;
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

    expect(outcome).toBe('saved');
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

    expect(outcome).toBe('saved');
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

    expect(outcome).toBe('saved');
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

    expect(outcome).toBe('photoNotSaved');
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

    expect(outcome).toBe('saved');
    expect(api.calls.slice(0, 1)).toEqual(['DELETE /api/persons/2/photo']);
    expect(api.calls).not.toContain('PATCH /api/persons/2');
  });

  it('still says the photo is not saved when its retry fails again', async () => {
    const api = await loadedList();
    api.failing.add('DELETE /api/persons/2/photo');
    const saving = personSave(daniel);
    const draft = { name: 'Dani', photo: { kind: 'remove' } } as const;
    await saving.save(draft);

    await expect(saving.save(draft)).resolves.toBe('photoNotSaved');
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
});
