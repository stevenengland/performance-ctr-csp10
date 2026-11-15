import { afterEach, describe, expect, it } from 'vitest';
import {
  ApiProblem,
  createAccount,
  deleteAccount,
  updateAccount,
  createDrink,
  createFactor,
  createPerson,
  deleteDrink,
  deleteEntry,
  deleteFactor,
  deletePerson,
  getDrink,
  getFactor,
  getPerson,
  updateDrink,
  updatePerson,
  listFactors,
  updateFactor,
  getHealth,
  getScoreboard,
  listDrinks,
  listEntries,
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

  it('resets passwords and changes admin rights, keeping the last admin', async () => {
    installFixtureBackend(sampleEvening());

    await expect(updateAccount(2, { password: 'kurz' })).rejects.toMatchObject({
      status: 422,
      errors: { password: 'Mindestens 10 Zeichen.' },
    });
    await expect(updateAccount(1, { isAdmin: false })).rejects.toMatchObject({
      status: 409,
      title: 'Der letzte Admin kann nicht entfernt werden.',
    });
    await expect(updateAccount(2, { isAdmin: true })).resolves.toEqual({
      id: 2,
      userName: 'ben',
      isAdmin: true,
    });
    await updateAccount(1, { isAdmin: false });
    await expect(listAccounts()).rejects.toMatchObject({ status: 403 });
    await signIn('ben', SAMPLE_PASSWORD);
    await expect(updateAccount(2, { isAdmin: false })).rejects.toMatchObject({
      status: 409,
    });
    await expect(updateAccount(9, { isAdmin: true })).rejects.toMatchObject({
      status: 404,
    });
    await updateAccount(2, { password: 'neues-passwort-1' });

    await expect(getSession()).rejects.toMatchObject({ status: 401 });
    await signIn('ben', 'neues-passwort-1');
    await expect(signIn('ben', SAMPLE_PASSWORD)).rejects.toMatchObject({
      status: 401,
    });
  });

  it('deletes accounts, keeping their entries without the account, but never the last admin', async () => {
    installFixtureBackend(sampleEvening());
    const before = await listEntries(3, todayFrom());

    await expect(deleteAccount(1)).rejects.toMatchObject({ status: 409 });
    await deleteAccount(2);

    expect((await listAccounts()).map((a) => a.userName)).toEqual([
      'anna',
      'daniel',
      'mara',
    ]);
    const after = await listEntries(3, todayFrom());
    expect(after.map(({ id }) => id)).toEqual(before.map(({ id }) => id));
    expect(
      after
        .filter((_entry, index) => before[index]?.accountName === 'ben')
        .every(({ accountName }) => accountName === null),
    ).toBe(true);
    await expect(deleteAccount(2)).rejects.toMatchObject({ status: 404 });
    await expect(signIn('ben', SAMPLE_PASSWORD)).rejects.toMatchObject({
      status: 401,
    });
  });

  it('signs out an account whose password is reset while it is signed in', async () => {
    installFixtureBackend(sampleEvening());
    await updateAccount(2, { isAdmin: true });
    await signIn('ben', SAMPLE_PASSWORD);

    await updateAccount(2, { password: 'neues-passwort-1' });

    await expect(getSession()).rejects.toMatchObject({ status: 401 });
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

  it('lists a person’s entries since from, newest first, with drink, factor and account', async () => {
    installFixtureBackend(sampleEvening());

    const daniel = await listEntries(3, todayFrom());

    expect(
      daniel.map(({ quantity, drink, factor, accountName }) => [
        `${String(quantity)}× ${drink.name}`,
        factor?.name ?? null,
        accountName,
      ]),
    ).toEqual([
      ['2× Bier', null, 'anna'],
      ['1× Aperol', null, 'anna'],
      ['2× Schnaps', 'Geburtstag', null],
      ['1× Margarita', null, 'daniel'],
      ['2× Bier', null, 'ben'],
    ]);
    expect(daniel[2]?.factor).toEqual({
      id: 1,
      name: 'Geburtstag',
      multiplier: 1.5,
    });
    const times = daniel.map(({ createdAt }) => createdAt);
    expect(times).toEqual([...times].sort().reverse());
    const tomorrow = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
    await expect(listEntries(3, tomorrow)).resolves.toEqual([]);
  });

  it('records the signed-in account with a new entry and forgets a deleted one, like the API', async () => {
    installFixtureBackend(sampleEvening());
    const id = '6f1c2d3e-4a5b-4c6d-8e7f-90a1b2c3d4e8';

    const added = await putEntry(id, { personId: 4, drinkId: 2, quantity: 1 });
    const [jule] = await listEntries(4, todayFrom());
    await deleteEntry(id);

    expect(Object.keys(added).sort()).toEqual([
      'createdAt',
      'drinkId',
      'factorId',
      'id',
      'personId',
      'quantity',
    ]);
    expect(jule).toMatchObject({ id, accountName: 'anna', factor: null });
    await expect(listEntries(4, todayFrom())).resolves.toEqual([]);
  });

  it('refuses an entry list for an unknown person, a malformed person id or instant', async () => {
    installFixtureBackend(sampleEvening());

    await expect(listEntries(99, todayFrom())).rejects.toMatchObject({
      status: 404,
    });
    await expect(listEntries(0, todayFrom())).rejects.toMatchObject({
      status: 422,
      errors: { personId: 'Person nicht gefunden.' },
    });
    await expect(listEntries(3, 'gestern')).rejects.toMatchObject({
      status: 422,
      errors: { from: 'Zeitpunkt nach ISO 8601 mit Zeitzone.' },
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

  it('renames and deletes persons with the API’s validation, their entries going with them', async () => {
    installFixtureBackend(sampleEvening());
    const daniel = (await listPersons()).find(({ name }) => name === 'Daniel');
    if (!daniel) throw new Error('no Daniel');

    await expect(updatePerson(daniel.id, 'anna')).rejects.toMatchObject({
      status: 409,
      title: 'Name ist bereits vergeben.',
    });
    await expect(updatePerson(daniel.id, ' ')).rejects.toMatchObject({
      status: 422,
      errors: { name: '1 bis 40 Zeichen.' },
    });
    await expect(updatePerson(daniel.id, ' Dani ')).resolves.toEqual({
      id: daniel.id,
      name: 'Dani',
    });
    expect((await standings(todayFrom())).rows[0]?.name).toBe('Dani');
    const { entryCount } = await getPerson(daniel.id);
    expect(entryCount).toBeGreaterThan(0);

    await deletePerson(daniel.id);

    expect((await listPersons()).map(({ name }) => name)).not.toContain('Dani');
    expect((await standings(todayFrom())).rows.map(({ name }) => name)).toEqual(
      ['Anna', 'Mara', 'Ben', 'Tom'],
    );
    await expect(getPerson(daniel.id)).rejects.toMatchObject({ status: 404 });
    await expect(deletePerson(daniel.id)).rejects.toMatchObject({
      status: 404,
    });
  });

  it('edits and deletes drinks with the API’s validation; points count at their current value', async () => {
    installFixtureBackend(sampleEvening());

    await expect(updateDrink(2, 'Wein', 1)).rejects.toMatchObject({
      status: 409,
    });
    await expect(updateDrink(2, 'Bier', 10_000)).rejects.toMatchObject({
      status: 422,
      errors: { points: 'Zahl von 0 bis 9.999,99.' },
    });
    await expect(updateDrink(2, 'Helles', 2)).resolves.toEqual({
      id: 2,
      name: 'Helles',
      points: 2,
    });
    const ben = (await standings(todayFrom())).rows.find(
      ({ name }) => name === 'Ben',
    );
    expect(ben).toMatchObject({
      score: 10,
      drinks: [{ drinkId: 2, name: 'Helles', count: 5 }],
    });
    expect((await getDrink(2)).entryCount).toBeGreaterThan(0);

    await deleteDrink(2);

    expect((await listDrinks()).map(({ id }) => id)).not.toContain(2);
    const rows = (await standings(todayFrom())).rows;
    expect(rows.map(({ name }) => name)).not.toContain('Ben');
    expect(
      rows.flatMap(({ drinks }) => drinks.map(({ drinkId }) => drinkId)),
    ).not.toContain(2);
    await expect(getDrink(2)).rejects.toMatchObject({ status: 404 });
  });
});
