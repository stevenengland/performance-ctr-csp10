import { afterEach, describe, expect, it } from 'vitest';
import {
  ApiProblem,
  createAccount,
  createDrink,
  createFactor,
  createPerson,
  deleteEntry,
  deleteFactor,
  getFactor,
  listFactors,
  updateFactor,
  getHealth,
  getScoreboard,
  listDrinks,
  listPersons,
  putEntry,
  getSession,
  listAccounts,
  signIn,
  signOut,
} from '../src/core/api-client';
import { todayFrom } from '../src/core/day-window';
import { installFixtureBackend } from './fixtureBackend';
import { SAMPLE_PASSWORD, sampleEvening } from './fixtures';

/** The standings since `from`, asked without condition. */
async function standings(from: string) {
  const answer = await getScoreboard(from);
  if (answer === 'unchanged') throw new Error('asked without condition');
  return answer.board;
}

describe('the fixture backend', () => {
  const realFetch = globalThis.fetch;
  afterEach(() => {
    globalThis.fetch = realFetch;
  });

  it('answers health through the app’s own API client', async () => {
    const fixtures = sampleEvening();
    installFixtureBackend(fixtures);

    await expect(getHealth()).resolves.toEqual(fixtures.health);
  });

  it('answers what it does not know with 503, like a server in maintenance', async () => {
    installFixtureBackend(sampleEvening());

    const response = await fetch('/api/verlauf');

    expect(response.status).toBe(503);
    expect(response.headers.get('Content-Type')).toBe(
      'application/problem+json',
    );
    await expect(ApiProblem.from(response)).resolves.toMatchObject({
      type: 'urn:performance:problem:maintenance',
    });
  });

  it('serves a current client', () => {
    const { health } = sampleEvening();

    expect(health.migration).toBe('ok');
    expect(health.minClientVersion).toBe('0.1.0');
  });

  it('starts signed in as an admin', async () => {
    installFixtureBackend(sampleEvening());

    await expect(getSession()).resolves.toMatchObject({
      userName: 'anna',
      isAdmin: true,
    });
  });

  it('signs out and in again in memory', async () => {
    installFixtureBackend(sampleEvening());

    await signOut();
    await expect(getSession()).rejects.toMatchObject({ status: 401 });
    await expect(signIn('ben', 'falsch')).rejects.toMatchObject({
      status: 401,
    });
    await expect(signIn('Ben', SAMPLE_PASSWORD)).resolves.toMatchObject({
      userName: 'ben',
      isAdmin: false,
    });
    await expect(listAccounts()).rejects.toMatchObject({ status: 403 });
  });

  it('creates accounts with the API’s validation', async () => {
    installFixtureBackend(sampleEvening());

    await expect(createAccount('jule', 'kurz')).rejects.toMatchObject({
      status: 422,
      errors: { password: 'Mindestens 10 Zeichen.' },
    });
    await expect(createAccount('ANNA', SAMPLE_PASSWORD)).rejects.toMatchObject({
      status: 409,
      title: 'Benutzername ist bereits vergeben.',
    });
    await createAccount('jule', SAMPLE_PASSWORD);

    expect((await listAccounts()).map((a) => a.userName)).toEqual([
      'anna',
      'ben',
      'daniel',
      'jule',
      'mara',
    ]);
  });

  it('serves a sample evening of today: persons, drinks and their standings', async () => {
    installFixtureBackend(sampleEvening());

    expect((await listPersons()).map(({ name }) => name)).toEqual([
      'Anna',
      'Ben',
      'Daniel',
      'Jule',
      'Mara',
      'Tom',
    ]);
    expect(await listDrinks()).toContainEqual({
      id: 2,
      name: 'Bier',
      points: 1,
    });
    const { rows } = await standings(todayFrom());
    expect(rows.map(({ name, score }) => [name, score])).toEqual([
      ['Daniel', 13.5],
      ['Anna', 9],
      ['Mara', 6],
      ['Ben', 5],
      ['Tom', 0.5],
    ]);
    expect(rows[3]?.drinks).toEqual([{ drinkId: 2, name: 'Bier', count: 5 }]);
    expect(await listFactors()).toEqual([
      { id: 1, name: 'Geburtstag', multiplier: 1.5 },
      { id: 2, name: 'Happy Hour', multiplier: 2 },
    ]);
    expect(rows[0]?.drinks).toContainEqual({
      drinkId: 2,
      name: 'Bier',
      count: 4,
    });
  });

  it('counts only entries since from', async () => {
    installFixtureBackend(sampleEvening());

    const tomorrow = new Date(Date.now() + 24 * 60 * 60 * 1000);

    expect(await standings(tomorrow.toISOString())).toEqual({ rows: [] });
  });

  it('answers the scoreboard with ETags from its in-memory revision', async () => {
    installFixtureBackend(sampleEvening());
    const first = await getScoreboard(todayFrom());
    if (first === 'unchanged') throw new Error('asked without condition');

    await expect(getScoreboard(todayFrom(), first.etag)).resolves.toBe(
      'unchanged',
    );
    const tomorrow = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
    await expect(getScoreboard(tomorrow, first.etag)).resolves.not.toBe(
      'unchanged',
    );
    await putEntry('6f1c2d3e-4a5b-4c6d-8e7f-90a1b2c3d4e7', {
      personId: 1,
      drinkId: 2,
      quantity: 1,
    });
    const after = await getScoreboard(todayFrom(), first.etag);
    expect(after).not.toBe('unchanged');
    expect(first.etag).toMatch(/^"\d+-\d+"$/);
  });

  it('adds entries idempotently and never brings an undone one back', async () => {
    installFixtureBackend(sampleEvening());
    const id = '6f1c2d3e-4a5b-4c6d-8e7f-90a1b2c3d4e5';
    const twoBeers = { personId: 4, drinkId: 2, quantity: 2 };

    const first = await putEntry(id, twoBeers);
    await expect(putEntry(id, twoBeers)).resolves.toEqual(first);
    const jule = async () =>
      (await standings(todayFrom())).rows.find((row) => row.name === 'Jule');
    expect((await jule())?.count).toBe(2);

    await expect(
      putEntry(id, { ...twoBeers, quantity: 3 }),
    ).rejects.toMatchObject({ status: 409 });
    await deleteEntry(id);
    await putEntry(id, twoBeers);
    expect(await jule()).toBeUndefined();
    await expect(deleteEntry(id)).rejects.toMatchObject({ status: 404 });
    await expect(
      putEntry('6f1c2d3e-4a5b-4c6d-8e7f-90a1b2c3d4e6', {
        ...twoBeers,
        personId: 99,
      }),
    ).rejects.toMatchObject({
      status: 422,
      errors: { personId: 'Person nicht gefunden.' },
    });
  });

  it('creates persons and drinks with the API’s validation', async () => {
    installFixtureBackend(sampleEvening());

    await expect(createPerson('  ')).rejects.toMatchObject({
      status: 422,
      errors: { name: '1 bis 40 Zeichen.' },
    });
    await expect(createPerson('daniel')).rejects.toMatchObject({
      status: 409,
      title: 'Name ist bereits vergeben.',
    });
    await expect(createDrink('Cola', null)).rejects.toMatchObject({
      status: 422,
      errors: { points: 'Zahl von 0 bis 9.999,99.' },
    });
    await createPerson(' Zoe ');
    await createDrink('Cola', 0.25);

    expect((await listPersons()).at(-1)).toEqual({ id: 7, name: 'Zoe' });
    expect(await listDrinks()).toContainEqual({
      id: 7,
      name: 'Cola',
      points: 0.25,
    });
  });

  it('manages factors with the API’s validation and applies their current multiplier', async () => {
    installFixtureBackend(sampleEvening());

    await expect(createFactor('happy hour', 3)).rejects.toMatchObject({
      status: 409,
    });
    await expect(createFactor('Rabatt', 0)).rejects.toMatchObject({
      status: 422,
      errors: { multiplier: 'Zahl über 0 bis 99,99.' },
    });
    const discount = await createFactor(' Rabatt ', 0.5);
    expect(discount).toEqual({ id: 3, name: 'Rabatt', multiplier: 0.5 });
    await putEntry('00000000-0000-4000-8000-000000000999', {
      personId: 6,
      drinkId: 4,
      quantity: 2,
      factorId: 3,
    });
    expect((await standings(todayFrom())).rows.at(-1)).toMatchObject({
      name: 'Tom',
      score: 1,
      count: 2,
    });

    await updateFactor(3, 'Rabatt', 1.5);
    expect(await getFactor(3)).toEqual({
      id: 3,
      name: 'Rabatt',
      multiplier: 1.5,
      entryCount: 1,
    });
    expect((await standings(todayFrom())).rows.at(-1)).toMatchObject({
      name: 'Tom',
      score: 2,
    });

    await deleteFactor(3);
    expect((await standings(todayFrom())).rows.at(-1)).toMatchObject({
      name: 'Tom',
      score: 1.5,
      count: 3,
    });
    await expect(getFactor(3)).rejects.toMatchObject({ status: 404 });
  });

  it('refuses an entry with an unknown factor and keeps the factor in the request', async () => {
    installFixtureBackend(sampleEvening());
    const id = '00000000-0000-4000-8000-000000000998';
    const entry = { personId: 1, drinkId: 2, quantity: 1 };

    await expect(putEntry(id, { ...entry, factorId: 9 })).rejects.toMatchObject(
      { status: 422, errors: { factorId: 'Faktor nicht gefunden.' } },
    );
    await putEntry(id, { ...entry, factorId: 2 });
    await expect(
      putEntry(id, { ...entry, factorId: null }),
    ).rejects.toMatchObject({ status: 409 });
  });
});
