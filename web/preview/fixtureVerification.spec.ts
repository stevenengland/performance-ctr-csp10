import { afterEach, describe, expect, it } from 'vitest';
import {
  deleteAccount,
  getPending,
  getScoreboard,
  getStandings,
  listMatches,
  listResults,
  listPending,
  putEntry,
  putMatch,
  putResult,
  rejectEntry,
  rejectMatch,
  rejectResult,
  restartGame,
  signIn,
  verifyEntry,
  verifyMatch,
  verifyResult,
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
/** Last night's Tischtennis match Jule – Tom, Tom won; mara recorded it, and it waits. */
const JULE_TOM = '00000000-0000-4000-a000-000000000013';
/** Tonight's Rommé: Daniel's 14 (ben) waits beside his counted results; Jule's only result, a 0 (anna), waits too. */
const DANIELS_14 = '00000000-0000-4000-b000-000000000009';
const JULES_0 = '00000000-0000-4000-b000-000000000010';

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

  it('lists the rows the signed-in account may verify, newest first, with their count', async () => {
    installFixtureBackend(sampleEvening());

    const page = await firstPage();

    expect(page.items.map(({ id }) => id)).toEqual([
      JULES_BEER,
      JULES_APEROL,
      DANIELS_14,
      JULE_TOM,
    ]);
    expect(page).toMatchObject({ next: null, count: 4 });
    expect(page.items[2]).toMatchObject({
      kind: 'result',
      accountName: 'ben',
      game: { name: 'Rommé' },
      earlierRun: false,
      person: { name: 'Daniel' },
      points: 14,
    });
    expect(page.items[3]).toMatchObject({
      kind: 'match',
      accountName: 'mara',
      game: { name: 'Tischtennis' },
      earlierRun: false,
      first: { name: 'Jule' },
      second: { name: 'Tom' },
      outcome: 'second',
    });
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
      DANIELS_14,
      JULE_TOM,
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

  it('rejects another account’s entry: it is gone, leaves the queue, and the log says reject, not delete', async () => {
    const fixtures = sampleEvening();
    installFixtureBackend(fixtures);
    const events = (await newest(100)).length;

    await rejectEntry(JULES_BEER);

    expect(fixtures.entries.map(({ id }) => id)).not.toContain(JULES_BEER);
    expect((await firstPage()).items.map(({ id }) => id)).toEqual([
      JULES_APEROL,
      DANIELS_14,
      JULE_TOM,
    ]);
    const log = await newest(100);
    expect(log).toHaveLength(events + 1);
    expect(log[0] && told(log[0])).toMatchObject({
      operation: 'reject',
      subjectKind: 'entry',
      subjectId: JULES_BEER,
      userName: 'anna',
      before: { person: 'Jule', drink: 'Bier', pending: true },
      after: null,
    });
  });

  it('refuses to reject the recorder’s own entry (403), a verified one (409) and a missing one (404), recording nothing', async () => {
    installFixtureBackend(sampleEvening());
    await verifyEntry(JULES_BEER);
    const events = (await newest(100)).length;

    await expect(rejectEntry(MARAS_WINE)).rejects.toMatchObject({
      status: 403,
      type: 'urn:performance:problem:own-row',
    });
    await expect(rejectEntry(JULES_BEER)).rejects.toMatchObject({
      status: 409,
      type: 'urn:performance:problem:already-verified',
    });
    await expect(
      rejectEntry('00000000-0000-4000-8000-000000000999'),
    ).rejects.toMatchObject({ status: 404 });

    expect(await newest(100)).toHaveLength(events);
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

    expect(first.count).toBe(27);
    expect(first.items).toHaveLength(20);
    expect(second.items).toHaveLength(7);
    expect(second.count).toBe(22);
    expect(second.next).toBeNull();
    expect(
      new Set([...first.items, ...second.items].map(({ id }) => id)).size,
    ).toBe(27);
  });

  it('verifies another account’s match: it counts on both sides, leaves the queue, and the log says verify', async () => {
    installFixtureBackend(sampleEvening());
    const before = await getStandings(3);
    if (before === 'unchanged') throw new Error('asked without condition');

    await verifyMatch(JULE_TOM);

    const after = await getStandings(3);
    if (after === 'unchanged') throw new Error('asked without condition');
    const place = (standings: typeof after, name: string) =>
      standings.standings.kind === 'duel'
        ? standings.standings.rows.find((row) => row.name === name)
        : undefined;
    expect(place(before, 'Jule')).toMatchObject({ played: 2, pendingCount: 1 });
    expect(place(after, 'Jule')).toMatchObject({ played: 3, pendingCount: 0 });
    expect(place(after, 'Tom')).toMatchObject({ played: 3, pendingCount: 0 });
    expect((await firstPage()).items.map(({ id }) => id)).not.toContain(
      JULE_TOM,
    );
    const [event] = await newest(1);
    expect(event && told(event)).toMatchObject({
      operation: 'verify',
      subjectKind: 'match',
      subjectId: JULE_TOM,
      before: { game: 'Tischtennis', pending: true },
      after: { game: 'Tischtennis', pending: false },
    });
  });

  it('rejects another account’s match and refuses its own (403), a verified one (409) and a missing one (404)', async () => {
    const fixtures = sampleEvening();
    installFixtureBackend(fixtures);
    await signIn('mara', SAMPLE_PASSWORD);
    await expect(rejectMatch(JULE_TOM)).rejects.toMatchObject({ status: 403 });
    await expect(verifyMatch(JULE_TOM)).rejects.toMatchObject({ status: 403 });
    await signIn('anna', SAMPLE_PASSWORD);

    await rejectMatch(JULE_TOM);

    expect(fixtures.matches.map(({ id }) => id)).not.toContain(JULE_TOM);
    const [event] = await newest(1);
    expect(event && told(event)).toMatchObject({
      operation: 'reject',
      subjectKind: 'match',
      subjectId: JULE_TOM,
      after: null,
    });
    await expect(rejectMatch(JULE_TOM)).rejects.toMatchObject({ status: 404 });
    await expect(
      rejectMatch('00000000-0000-4000-a000-000000000002'),
    ).rejects.toMatchObject({ status: 409 });
  });

  it('records a new match pending, unranked until verified, and marks it in the Verlauf and an earlier run in the queue', async () => {
    installFixtureBackend(sampleEvening());
    await signIn('ben', SAMPLE_PASSWORD);
    const id = '6f1c2d3e-4a5b-4c6d-8e7f-90a1b2c3d4e9';
    await putMatch(id, {
      gameId: 3,
      firstPersonId: 5,
      secondPersonId: 1,
      outcome: 'first',
    });
    await signIn('anna', SAMPLE_PASSWORD);
    const standings = await getStandings(3);
    if (standings === 'unchanged') throw new Error('asked without condition');
    const history = await listMatches(3);
    await restartGame(3);

    const queued = (await firstPage()).items.find((item) => item.id === id);

    expect(standings.standings).toMatchObject({
      unranked: [{ personId: 1, name: 'Anna', pendingCount: 1 }],
    });
    expect(
      standings.standings.kind === 'duel' &&
        standings.standings.rows.find(({ name }) => name === 'Mara'),
    ).toMatchObject({ played: 2, pendingCount: 1 });
    expect(history.items[0]).toMatchObject({ id, pending: true });
    expect(queued).toMatchObject({ kind: 'match', earlierRun: true });
  });

  it('verifies another account’s result: it counts, leaves the queue, and the log says verify', async () => {
    installFixtureBackend(sampleEvening());
    const before = await getStandings(1);
    if (before === 'unchanged') throw new Error('asked without condition');

    await verifyResult(DANIELS_14);

    const after = await getStandings(1);
    if (after === 'unchanged') throw new Error('asked without condition');
    const place = (standings: typeof after, name: string) =>
      standings.standings.kind === 'points'
        ? standings.standings.rows.find((row) => row.name === name)
        : undefined;
    expect(place(before, 'Daniel')).toMatchObject({
      sum: -11,
      results: 2,
      pendingCount: 1,
    });
    expect(place(after, 'Daniel')).toMatchObject({
      sum: 3,
      results: 3,
      pendingCount: 0,
    });
    expect((await firstPage()).items.map(({ id }) => id)).not.toContain(
      DANIELS_14,
    );
    const [event] = await newest(1);
    expect(event && told(event)).toMatchObject({
      operation: 'verify',
      subjectKind: 'result',
      subjectId: DANIELS_14,
      before: { game: 'Rommé', person: 'Daniel', points: 14, pending: true },
      after: { game: 'Rommé', person: 'Daniel', points: 14, pending: false },
    });
  });

  it('lists a person whose results all wait without a rank, even on a zero in a lowest-wins game', async () => {
    installFixtureBackend(sampleEvening());

    const answer = await getStandings(1);
    if (answer === 'unchanged') throw new Error('asked without condition');

    expect(answer.standings).toMatchObject({
      kind: 'points',
      lowerWins: true,
      unranked: [{ name: 'Jule', pendingCount: 1 }],
    });
    expect(answer.standings.rows.map(({ name }) => name)).not.toContain('Jule');
    expect(answer.standings.rows[0]?.name).toBe('Daniel');
  });

  it('rejects another account’s result and refuses its own (403), a verified one (409) and a missing one (404)', async () => {
    const fixtures = sampleEvening();
    installFixtureBackend(fixtures);
    await expect(rejectResult(JULES_0)).rejects.toMatchObject({ status: 403 });
    await expect(verifyResult(JULES_0)).rejects.toMatchObject({ status: 403 });

    await rejectResult(DANIELS_14);

    expect(fixtures.results.map(({ id }) => id)).not.toContain(DANIELS_14);
    const [event] = await newest(1);
    expect(event && told(event)).toMatchObject({
      operation: 'reject',
      subjectKind: 'result',
      subjectId: DANIELS_14,
      after: null,
    });
    await expect(rejectResult(DANIELS_14)).rejects.toMatchObject({
      status: 404,
    });
    await expect(
      rejectResult('00000000-0000-4000-b000-000000000005'),
    ).rejects.toMatchObject({ status: 409 });
  });

  it('records a new result pending, outside the sum until verified, and marks it in the Verlauf and an earlier run in the queue', async () => {
    installFixtureBackend(sampleEvening());
    await signIn('ben', SAMPLE_PASSWORD);
    const id = '6f1c2d3e-4a5b-4c6d-8e7f-90a1b2c3d4ea';
    await putResult(id, { gameId: 1, personId: 1, points: -20 });
    await signIn('anna', SAMPLE_PASSWORD);
    const standings = await getStandings(1);
    if (standings === 'unchanged') throw new Error('asked without condition');
    const history = await listResults(1);
    await restartGame(1);

    const queued = (await firstPage()).items.find((item) => item.id === id);

    expect(
      standings.standings.rows.find(({ name }) => name === 'Anna'),
    ).toMatchObject({ sum: 15, results: 2, pendingCount: 1 });
    expect(history.items[0]).toMatchObject({ id, pending: true });
    expect(queued).toMatchObject({ kind: 'result', earlierRun: true });
  });
});
