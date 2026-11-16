import { afterEach, describe, expect, it } from 'vitest';
import {
  ApiProblem,
  changePassword,
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
  deletePersonPhoto,
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
  putPersonPhoto,
  getSession,
  listAccounts,
  listAuditEvents,
  signIn,
  signOut,
} from '../src/core/api-client';
import { todayFrom } from '../src/core/day-window';
import { auditDays } from '../src/features/verwalten/protokoll/audit-rows';
import { installFixtureBackend } from './fixtureBackend';
import { newest, told } from './fixtureTesting';
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

  it('changes the own password with the API’s validation', async () => {
    installFixtureBackend(sampleEvening());

    await expect(
      changePassword(SAMPLE_PASSWORD, 'ä'.repeat(37)),
    ).rejects.toMatchObject({
      status: 422,
      errors: { newPassword: 'Höchstens 72 Byte (Umlaute zählen doppelt).' },
    });
    await expect(
      changePassword('falsch', 'ein-neues-passwort'),
    ).rejects.toMatchObject({
      status: 422,
      errors: { currentPassword: 'Passwort falsch.' },
    });
    await changePassword(SAMPLE_PASSWORD, 'ä'.repeat(36));
    await signOut();
    await expect(signIn('anna', 'ä'.repeat(36))).resolves.toMatchObject({
      userName: 'anna',
    });
  });

  it('creates accounts with the API’s validation', async () => {
    installFixtureBackend(sampleEvening());

    await expect(createAccount('jule', 'kurz')).rejects.toMatchObject({
      status: 422,
      errors: { password: 'Mindestens 10 Zeichen.' },
    });
    // bcrypt's limit counts bytes: 37 umlauts are 74 (as the API answers).
    await expect(createAccount('jule', 'ä'.repeat(37))).rejects.toMatchObject({
      status: 422,
      errors: { password: 'Höchstens 72 Byte (Umlaute zählen doppelt).' },
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
    await expect(
      updateAccount(2, { password: 'a'.repeat(72) + 'new' }),
    ).rejects.toMatchObject({
      status: 422,
      errors: { password: 'Höchstens 72 Byte (Umlaute zählen doppelt).' },
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
    // A replay answers the original instant, like the API's retry keys.
    await expect(putEntry(id, twoBeers)).resolves.toEqual(first);
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

  it('answers sample photos for Anna, Daniel and Mara and none for the others', async () => {
    installFixtureBackend(sampleEvening());

    const persons = await listPersons();
    const daniel = await getPerson(3);

    expect(persons.map(({ name, photoUrl }) => [name, photoUrl])).toEqual([
      ['Anna', expect.stringMatching(/sample-sunset.*\.jpg$/)],
      ['Ben', null],
      ['Daniel', expect.stringMatching(/sample-beer.*\.jpg$/)],
      ['Jule', null],
      ['Mara', expect.stringMatching(/sample-hills.*\.jpg$/)],
      ['Tom', null],
    ]);
    expect(daniel.photoUrl).toBe(persons[2]?.photoUrl);
  });

  it('answers each scoreboard row with its person’s photoUrl', async () => {
    const fixtures = sampleEvening();
    const photoUrl = `/api/persons/1/photo?v=${'0'.repeat(64)}`;
    fixtures.persons = fixtures.persons.map((person) =>
      person.id === 1 ? { ...person, photoUrl } : person,
    );
    installFixtureBackend(fixtures);

    const { rows } = await standings(todayFrom());

    expect(rows.map((row) => [row.name, row.photoUrl])).toEqual([
      ['Daniel', fixtures.persons[2]?.photoUrl],
      ['Anna', photoUrl],
      ['Mara', fixtures.persons[4]?.photoUrl],
      ['Ben', null],
      ['Tom', null],
    ]);
  });

  it('removes a person’s photo, also when there is none, and refuses an unknown person', async () => {
    installFixtureBackend(sampleEvening());
    const anna = (await listPersons()).find(({ name }) => name === 'Anna');
    if (!anna) throw new Error('no Anna');

    await deletePersonPhoto(anna.id);
    await deletePersonPhoto(anna.id);

    expect((await getPerson(anna.id)).photoUrl).toBeNull();
    const { rows } = await standings(todayFrom());
    expect(rows.find(({ name }) => name === 'Anna')?.photoUrl).toBeNull();
    await expect(deletePersonPhoto(99)).rejects.toMatchObject({
      status: 404,
    });
  });

  it('keeps an uploaded photo as a data: URL on the person and their scoreboard row', async () => {
    installFixtureBackend(sampleEvening());
    const image = '/9j/2Q==';

    const ben = await putPersonPhoto(2, image);

    const photoUrl = `data:image/jpeg;base64,${image}`;
    expect(ben).toEqual({ id: 2, name: 'Ben', photoUrl });
    expect((await getPerson(2)).photoUrl).toBe(photoUrl);
    const { rows } = await standings(todayFrom());
    expect(rows.find(({ name }) => name === 'Ben')?.photoUrl).toBe(photoUrl);
  });

  it('refuses a photo that is no base64 JPEG like the API, and an unknown person', async () => {
    installFixtureBackend(sampleEvening());

    for (const image of ['iVBORw0KGgo=', '/9j/ not base64', '']) {
      await expect(putPersonPhoto(2, image)).rejects.toMatchObject({
        status: 422,
        errors: {
          image: 'Kein gültiges Foto (JPEG, 256 × 256, höchstens 64 KB).',
        },
      });
    }
    await expect(putPersonPhoto(99, '/9j/2Q==')).rejects.toMatchObject({
      status: 404,
    });
    expect((await getPerson(2)).photoUrl).toBeNull();
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

    expect((await listPersons()).at(-1)).toEqual({
      id: 7,
      name: 'Zoe',
      photoUrl: null,
    });
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
      photoUrl: daniel.photoUrl,
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

describe('the fixture backend’s audit log', () => {
  const realFetch = globalThis.fetch;
  afterEach(() => {
    globalThis.fetch = realFetch;
  });

  it('serves its sample events to admins, newest first and a page at a time', async () => {
    const fixtures = sampleEvening();
    installFixtureBackend(fixtures);

    const pages = [await listAuditEvents()];
    for (let next = pages[0]?.next; next != null; next = pages.at(-1)?.next) {
      pages.push(await listAuditEvents(next));
    }

    expect(pages.length).toBeGreaterThan(1);
    expect(pages[0]?.events).toHaveLength(20);
    const events = pages.flatMap((page) => page.events);
    const ids = events.map(({ id }) => id);
    expect(ids).toEqual([...ids].sort((a, b) => b - a));
    expect(new Set(ids).size).toBe(fixtures.audit.length);
    await expect(newest(100)).resolves.toEqual(events);
    const pageOfAll = await fetch(`/api/audit?limit=${String(ids.length)}`);
    await expect(pageOfAll.json()).resolves.toMatchObject({ next: null });
  });

  it('starts with several days, a cascade and an account that no longer exists', async () => {
    const fixtures = sampleEvening();
    installFixtureBackend(fixtures);
    const events = await newest(100);

    const days = new Set(
      events.map(({ occurredAt }) => new Date(occurredAt).toDateString()),
    );
    expect(days.size).toBeGreaterThanOrEqual(3);
    const caused = events.filter(({ cause }) => cause !== null);
    expect(caused.length).toBeGreaterThan(1);
    for (const { cause, subjectKind } of caused) {
      expect(subjectKind).toBe('entry');
      expect(events.find(({ id }) => id === cause?.id)).toMatchObject({
        operation: 'delete',
        subjectKind: cause?.subjectKind,
        before: { name: cause?.name },
      });
    }
    const accounts = fixtures.accounts.map(({ account }) => account.userName);
    expect(events.some(({ actor }) => !accounts.includes(actor.userName))).toBe(
      true,
    );
    // Tonight's entries were counted, so the log has them.
    const entryIds = new Set(events.map(({ subjectId }) => subjectId));
    expect(fixtures.entries.every(({ id }) => entryIds.has(id))).toBe(true);
    // A photo change, as Protokoll shows it.
    const rows = auditDays(events).flatMap(({ rows }) => rows);
    expect(rows).toContainEqual(
      expect.objectContaining({
        title: 'Person Anna',
        changes: 'Foto gesetzt',
      }),
    );
  });

  it('records a person’s photo being set, changed and removed, and nothing when it stays', async () => {
    const fixtures = sampleEvening();
    installFixtureBackend(fixtures);
    const seeded = fixtures.audit.length;
    const first = '/9j/2Q==';
    const second = '/9j/2Z==';

    await putPersonPhoto(2, first);
    await putPersonPhoto(2, first);
    await putPersonPhoto(2, second);
    await updatePerson(2, 'Benno');
    await deletePersonPhoto(2);
    await deletePersonPhoto(2);

    const photo = (image: string) => `data:image/jpeg;base64,${image}`;
    const update = (
      before: { name: string; photo: string | null },
      after: { name: string; photo: string | null },
    ) => ({
      operation: 'update',
      subjectKind: 'person',
      subjectId: '2',
      userName: 'anna',
      before,
      after,
      cause: null,
    });
    expect((await newest(4)).map(told).reverse()).toEqual([
      update(
        { name: 'Ben', photo: null },
        { name: 'Ben', photo: photo(first) },
      ),
      update(
        { name: 'Ben', photo: photo(first) },
        { name: 'Ben', photo: photo(second) },
      ),
      update(
        { name: 'Ben', photo: photo(second) },
        { name: 'Benno', photo: photo(second) },
      ),
      update(
        { name: 'Benno', photo: photo(second) },
        { name: 'Benno', photo: null },
      ),
    ]);
    expect(fixtures.audit).toHaveLength(seeded + 4);
    const rows = auditDays(await newest(4)).flatMap(({ rows }) => rows);
    expect(rows.map(({ changes }) => changes)).toEqual([
      'Foto entfernt',
      'Name: Ben → Benno',
      'Foto geändert',
      'Foto gesetzt',
    ]);
  });

  it('answers only admins, and invalid paging with the API’s validation', async () => {
    installFixtureBackend(sampleEvening());

    for (const query of ['before=0', 'before=x', 'limit=0', 'limit=101']) {
      const response = await fetch(`/api/audit?${query}`);
      expect(response.status, query).toBe(422);
    }
    await expect(
      (await fetch('/api/audit?before=1&limit=0')).json(),
    ).resolves.toMatchObject({
      errors: { limit: '1 bis 100.' },
    });
    await expect(
      (await fetch('/api/audit?before=-3')).json(),
    ).resolves.toMatchObject({
      errors: { before: 'Positive ganze Zahl.' },
    });

    await signIn('ben', SAMPLE_PASSWORD);
    await expect(listAuditEvents()).rejects.toMatchObject({ status: 403 });
    await signOut();
    await expect(listAuditEvents()).rejects.toMatchObject({ status: 401 });
  });

  it('records the viewer’s catalog writes, and nothing for a save that changes nothing or fails', async () => {
    const fixtures = sampleEvening();
    installFixtureBackend(fixtures);
    const seeded = fixtures.audit.length;

    const drink = await createDrink('Sekt', 2);
    await updateDrink(drink.id, 'Sekt', 2.5);
    await updateDrink(drink.id, 'Sekt', 2.5);
    await expect(updateDrink(drink.id, 'Bier', 1)).rejects.toMatchObject({
      status: 409,
    });
    await expect(createPerson(' ')).rejects.toMatchObject({ status: 422 });
    const person = await createPerson('Lea');
    await updatePerson(person.id, 'Lena');
    await deleteDrink(drink.id);
    await deletePerson(person.id);

    expect((await newest(6)).map(told).reverse()).toEqual([
      {
        operation: 'create',
        subjectKind: 'drink',
        subjectId: String(drink.id),
        userName: 'anna',
        before: null,
        after: { name: 'Sekt', points: 2 },
        cause: null,
      },
      {
        operation: 'update',
        subjectKind: 'drink',
        subjectId: String(drink.id),
        userName: 'anna',
        before: { name: 'Sekt', points: 2 },
        after: { name: 'Sekt', points: 2.5 },
        cause: null,
      },
      {
        operation: 'create',
        subjectKind: 'person',
        subjectId: String(person.id),
        userName: 'anna',
        before: null,
        after: { name: 'Lea', photo: null },
        cause: null,
      },
      {
        operation: 'update',
        subjectKind: 'person',
        subjectId: String(person.id),
        userName: 'anna',
        before: { name: 'Lea', photo: null },
        after: { name: 'Lena', photo: null },
        cause: null,
      },
      {
        operation: 'delete',
        subjectKind: 'drink',
        subjectId: String(drink.id),
        userName: 'anna',
        before: { name: 'Sekt', points: 2.5 },
        after: null,
        cause: null,
      },
      {
        operation: 'delete',
        subjectKind: 'person',
        subjectId: String(person.id),
        userName: 'anna',
        before: { name: 'Lena', photo: null },
        after: null,
        cause: null,
      },
    ]);
    expect(fixtures.audit).toHaveLength(seeded + 6);
    expect(fixtures.audit.at(-1)?.occurredAt).toMatch(/^\d{4}-\d\d-\d\dT.+Z$/);
  });

  it('records what a person’s, drink’s or factor’s deletion does to each of its entries, caused by it', async () => {
    const fixtures = sampleEvening();
    installFixtureBackend(fixtures);
    const entriesOf = (personId: number) =>
      fixtures.entries.filter((entry) => entry.personId === personId).length;
    const danielsEntries = entriesOf(3);
    // Daniel's matches stay with his side cleared and his results go; their events come last.
    const danielsMatchesAndResults =
      fixtures.matches.filter(
        (match) => match.firstPersonId === 3 || match.secondPersonId === 3,
      ).length +
      fixtures.results.filter((result) => result.personId === 3).length;

    await deletePerson(3);
    const personEvents = (
      await newest(danielsMatchesAndResults + danielsEntries + 1)
    ).slice(danielsMatchesAndResults);
    const deletion = personEvents.at(-1);
    expect(deletion).toMatchObject({
      operation: 'delete',
      subjectKind: 'person',
      subjectId: '3',
      before: { name: 'Daniel' },
    });
    expect(personEvents.slice(0, -1).map(told)).toEqual(
      Array.from({ length: danielsEntries }, () =>
        expect.objectContaining({
          operation: 'delete',
          subjectKind: 'entry',
          userName: 'anna',
          before: expect.objectContaining({ person: 'Daniel' }) as unknown,
          after: null,
          cause: { subjectKind: 'person', name: 'Daniel' },
        }),
      ),
    );
    expect(personEvents[0]?.cause?.id).toBe(deletion?.id);

    // Happy Hour counts one of Ben's entries: it stays and counts ×1.
    await deleteFactor(2);
    const [entry, factor] = (await newest(2)).map(told);
    expect(factor).toMatchObject({
      operation: 'delete',
      before: { name: 'Happy Hour', multiplier: 2 },
    });
    expect(entry).toEqual({
      operation: 'update',
      subjectKind: 'entry',
      subjectId: expect.any(String) as unknown,
      userName: 'anna',
      before: {
        person: 'Ben',
        drink: 'Bier',
        points: 1,
        quantity: 2,
        factor: { name: 'Happy Hour', multiplier: 2 },
      },
      after: {
        person: 'Ben',
        drink: 'Bier',
        points: 1,
        quantity: 2,
        factor: null,
      },
      cause: { subjectKind: 'factor', name: 'Happy Hour' },
    });

    const radler = fixtures.entries.filter(({ drinkId }) => drinkId === 4);
    await deleteDrink(4);
    const drinkEvents = await newest(radler.length + 1);
    expect(drinkEvents.slice(0, -1).map(({ subjectId }) => subjectId)).toEqual(
      radler
        .map(({ id }) => id)
        .sort()
        .reverse(),
    );
    expect(drinkEvents.slice(0, -1).map(({ cause }) => cause?.name)).toEqual(
      radler.map(() => 'Radler'),
    );
  });

  it('records a counted and a deleted entry, but not a replayed or conflicting request', async () => {
    const fixtures = sampleEvening();
    installFixtureBackend(fixtures);
    const id = '9b2f4a10-1c2d-4e5f-8a9b-0c1d2e3f4a5b';
    const seeded = fixtures.audit.length;

    await putEntry(id, { personId: 1, drinkId: 6, quantity: 2, factorId: 1 });
    await putEntry(id, { personId: 1, drinkId: 6, quantity: 2, factorId: 1 });
    await expect(
      putEntry(id, { personId: 1, drinkId: 6, quantity: 3, factorId: 1 }),
    ).rejects.toMatchObject({ status: 409 });
    await expect(
      putEntry('9b2f4a10-1c2d-4e5f-8a9b-0c1d2e3f4a5c', {
        personId: 99,
        drinkId: 6,
        quantity: 1,
      }),
    ).rejects.toMatchObject({ status: 422 });
    await deleteEntry(id);
    await putEntry(id, { personId: 1, drinkId: 6, quantity: 2, factorId: 1 });

    const snapshot = {
      person: 'Anna',
      drink: 'Wein',
      points: 2,
      quantity: 2,
      factor: { name: 'Geburtstag', multiplier: 1.5 },
    };
    expect(fixtures.audit).toHaveLength(seeded + 2);
    expect((await newest(2)).map(told).reverse()).toEqual([
      {
        operation: 'create',
        subjectKind: 'entry',
        subjectId: id,
        userName: 'anna',
        before: null,
        after: snapshot,
        cause: null,
      },
      {
        operation: 'delete',
        subjectKind: 'entry',
        subjectId: id,
        userName: 'anna',
        before: snapshot,
        after: null,
        cause: null,
      },
    ]);
  });
});
