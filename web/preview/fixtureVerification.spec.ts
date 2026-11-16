import { afterEach, describe, expect, it } from 'vitest';
import {
  deleteAccount,
  getPending,
  getScoreboard,
  listPending,
  putEntry,
  signIn,
  verifyEntry,
  type PendingPage,
} from '../src/core/api-client';
import { todayFrom } from '../src/core/day-window';
import { installFixtureBackend } from './fixtureBackend';
import { newest, told } from './fixtureTesting';
import { SAMPLE_PASSWORD, sampleEvening } from './fixtures';

/** The sample entries: Mara's Wein waits, logged by anna; Jule's Aperol (mara) and Bier (ben) wait too. */
const MARAS_WINE = '00000000-0000-4000-8000-000000000014';
const JULES_APEROL = '00000000-0000-4000-8000-000000000015';
const JULES_BEER = '00000000-0000-4000-8000-000000000016';

/** The first page of the signed-in account's queue, asked without condition. */
async function firstPage(): Promise<PendingPage> {
  const answer = await getPending();
  if (answer === 'unchanged') throw new Error('asked without condition');
  return answer.page;
}

describe('the fixture backend’s four-eyes rule', () => {
  const realFetch = globalThis.fetch;
  afterEach(() => {
    globalThis.fetch = realFetch;
  });

  it('lists the entries the signed-in account may verify, newest first, with their count', async () => {
    installFixtureBackend(sampleEvening());

    const page = await firstPage();

    expect(page.items.map(({ id }) => id)).toEqual([JULES_BEER, JULES_APEROL]);
    expect(page).toMatchObject({ next: null, count: 2 });
    expect(page.items[0]).toMatchObject({
      kind: 'entry',
      accountName: 'ben',
      person: { name: 'Jule' },
      drink: { name: 'Bier' },
      quantity: 2,
      factor: null,
    });
  });

  it('verifies another account’s entry: it counts, leaves the queue, and the log says verify', async () => {
    installFixtureBackend(sampleEvening());

    await verifyEntry(JULES_BEER);

    const board = await getScoreboard(todayFrom());
    if (board === 'unchanged') throw new Error('asked without condition');
    expect(board.board.rows.find(({ name }) => name === 'Jule')).toMatchObject({
      score: 2,
      pendingCount: 1,
    });
    expect((await firstPage()).items.map(({ id }) => id)).toEqual([
      JULES_APEROL,
    ]);
    const [event] = await newest(1);
    expect(event && told(event)).toMatchObject({
      operation: 'verify',
      subjectKind: 'entry',
      subjectId: JULES_BEER,
      userName: 'anna',
      before: { person: 'Jule', drink: 'Bier', pending: true },
      after: { person: 'Jule', drink: 'Bier', pending: false },
    });
  });

  it('refuses the recorder (403) and a missing entry (404); a verified entry stays as it is', async () => {
    installFixtureBackend(sampleEvening());
    await verifyEntry(JULES_BEER);
    const events = (await newest(100)).length;
    const tagged = await getScoreboard(todayFrom());
    if (tagged === 'unchanged') throw new Error('asked without condition');

    await expect(verifyEntry(MARAS_WINE)).rejects.toMatchObject({
      status: 403,
      type: 'urn:performance:problem:own-row',
    });
    await expect(
      verifyEntry('00000000-0000-4000-8000-000000000999'),
    ).rejects.toMatchObject({ status: 404 });
    await expect(verifyEntry(JULES_BEER)).resolves.toBeUndefined();

    expect(await newest(100)).toHaveLength(events);
    await expect(getScoreboard(todayFrom(), tagged.etag)).resolves.toBe(
      'unchanged',
    );
  });

  it('answers the first page on condition of an ETag of the revision and the account', async () => {
    installFixtureBackend(sampleEvening());
    const answer = await getPending();
    if (answer === 'unchanged') throw new Error('asked without condition');

    await expect(getPending(answer.etag)).resolves.toBe('unchanged');
    await signIn('ben', SAMPLE_PASSWORD);
    const bens = await getPending(answer.etag);

    expect(bens).not.toBe('unchanged');
  });

  it('lets anyone verify an entry whose recorder was deleted, and names no recorder', async () => {
    installFixtureBackend(sampleEvening());
    await signIn('mara', SAMPLE_PASSWORD);
    await putEntry('6f1c2d3e-4a5b-4c6d-8e7f-90a1b2c3d4e8', {
      personId: 6,
      drinkId: 2,
      quantity: 1,
    });
    await signIn('anna', SAMPLE_PASSWORD);
    await deleteAccount(4);

    const [tom] = (await firstPage()).items;
    await signIn('ben', SAMPLE_PASSWORD);

    expect(tom).toMatchObject({ person: { name: 'Tom' }, accountName: null });
    await expect(
      verifyEntry('6f1c2d3e-4a5b-4c6d-8e7f-90a1b2c3d4e8'),
    ).resolves.toBeUndefined();
  });

  it('pages by the last row shown, so rows verified meanwhile never hide later ones', async () => {
    const fixtures = sampleEvening();
    installFixtureBackend(fixtures);
    await signIn('ben', SAMPLE_PASSWORD);
    for (let n = 1; n <= 23; n += 1) {
      await putEntry(`6f1c2d3e-4a5b-4c6d-8e7f-${String(n).padStart(12, '0')}`, {
        personId: 6,
        drinkId: 2,
        quantity: 1,
      });
    }
    await signIn('anna', SAMPLE_PASSWORD);

    const first = await firstPage();
    for (const { id } of first.items.slice(0, 5)) await verifyEntry(id);
    if (first.next === null) throw new Error('no next page');
    const second = await listPending(first.next);

    expect(first.count).toBe(25);
    expect(first.items).toHaveLength(20);
    expect(second.items).toHaveLength(5);
    expect(second.count).toBe(20);
    expect(second.next).toBeNull();
    expect(
      new Set([...first.items, ...second.items].map(({ id }) => id)).size,
    ).toBe(25);
  });
});
