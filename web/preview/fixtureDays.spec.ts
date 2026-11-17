import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { installFixtureBackend } from './fixtureBackend';
import { sampleEvening } from './fixtures';
import { withEntries } from './fixtureTesting';

/*
The fixture backend's days with drinks that count, at `GET /api/scoreboard/days`:
these cases are the API integration tests' (`ScoreboardDaysTest`), so the preview
and the API cannot drift apart unnoticed. Persons: 1 Anna, 2 Ben, 3 Daniel;
drinks: 1 Aperol, 2 Bier.
*/

async function days(ifNoneMatch?: string) {
  return fetch(
    '/api/scoreboard/days',
    ifNoneMatch === undefined
      ? undefined
      : { headers: { 'If-None-Match': ifNoneMatch } },
  );
}

async function instants(): Promise<string[]> {
  const response = await days();
  expect(response.status).toBe(200);
  return ((await response.json()) as { instants: string[] }).instants;
}

describe('the fixture backend’s days with drinks that count', () => {
  const realFetch = globalThis.fetch;
  const zone = process.env.TZ;

  beforeEach(() => {
    process.env.TZ = 'Europe/Berlin';
  });

  afterEach(() => {
    globalThis.fetch = realFetch;
    process.env.TZ = zone;
  });

  it('lists the start of each quarter hour with a verified entry ascending and leaves pending entries out', async () => {
    installFixtureBackend(
      withEntries(
        [1, 1, 1, '2026-11-15T20:00:00.000Z'],
        [1, 2, 1, '2026-11-14T20:00:00.000Z'],
        [2, 2, 1, '2026-11-15T20:14:59.999Z'],
        [3, 1, 1, '2026-11-15T20:15:00.000Z'],
        [1, 1, 1, '2026-11-15T21:15:00.000Z', true],
      ),
    );

    expect(await instants()).toEqual([
      '2026-11-14T20:00:00.000Z',
      '2026-11-15T20:00:00.000Z',
      '2026-11-15T20:15:00.000Z',
    ]);
  });

  it('has no instant without an entry that counts', async () => {
    installFixtureBackend(
      withEntries([1, 1, 1, '2026-11-14T20:00:00.000Z', true]),
    );

    expect(await instants()).toEqual([]);
  });

  it('counts exactly what the ranking counts: not pending entries, nor those of a deleted person or drink', async () => {
    installFixtureBackend(
      withEntries(
        [1, 1, 1, '2026-11-14T20:00:00.000Z'],
        [1, 2, 1, '2026-11-14T20:15:00.000Z', true],
        [2, 1, 1, '2026-11-14T20:30:00.000Z'],
        [3, 2, 1, '2026-11-14T20:45:00.000Z'],
        [3, 1, 1, '2026-11-14T21:00:00.000Z'],
      ),
    );

    await fetch('/api/persons/2', { method: 'DELETE' });
    await fetch('/api/drinks/2', { method: 'DELETE' });
    const ranked = (await (
      await fetch('/api/scoreboard?scope=all')
    ).json()) as {
      rows: { name: string; count: number }[];
    };

    expect(await instants()).toEqual([
      '2026-11-14T20:00:00.000Z',
      '2026-11-14T21:00:00.000Z',
    ]);
    expect(ranked.rows.map(({ name, count }) => [name, count])).toEqual([
      ['Anna', 1],
      ['Daniel', 1],
    ]);
  });

  it('keeps an entry recorded before midnight and verified the next day in the quarter hour it was recorded in', async () => {
    const fixtures = withEntries([1, 1, 1, '2026-11-14T23:59:30.000Z', true]);
    installFixtureBackend(fixtures);
    const late = fixtures.entries[0];
    if (!late) throw new Error('no entry');
    late.accountId = 2;

    const verified = await fetch(`/api/entries/${late.id}/verification`, {
      method: 'PUT',
      body: '{}',
    });

    expect(verified.status).toBe(204);
    expect(await instants()).toEqual(['2026-11-14T23:45:00.000Z']);
  });

  it('answers many entries in one quarter hour as one instant', async () => {
    const start = new Date('2026-11-14T20:00:00Z').getTime();
    installFixtureBackend(
      withEntries(
        ...Array.from(
          { length: 3000 },
          (_, i): [number, number, number, string] => [
            (i % 3) + 1,
            1,
            1,
            new Date(
              start + Math.floor(i / 1000) * 900_000 + (i % 1000) * 900,
            ).toISOString(),
          ],
        ),
      ),
    );

    expect(await instants()).toEqual([
      '2026-11-14T20:00:00.000Z',
      '2026-11-14T20:15:00.000Z',
      '2026-11-14T20:30:00.000Z',
    ]);
  });

  it.each([
    ['an hour ahead, as the local server', 'Europe/Berlin'],
    ['behind UTC by a half hour', 'Pacific/Marquesas'],
  ])(
    'takes the quarter hours in UTC whatever the time zone is: %s',
    async (_case, timeZone) => {
      process.env.TZ = timeZone;
      installFixtureBackend(
        withEntries(
          [1, 1, 1, '2026-11-15T00:00:00.000Z'],
          [2, 1, 1, '2026-11-14T23:59:59.999Z'],
        ),
      );

      expect(await instants()).toEqual([
        '2026-11-14T23:45:00.000Z',
        '2026-11-15T00:00:00.000Z',
      ]);
    },
  );

  it('needs a session', async () => {
    installFixtureBackend(sampleEvening());
    await fetch('/api/session', { method: 'DELETE' });

    expect((await days()).status).toBe(401);
  });

  it('is tagged with the data revision; an unchanged tag answers 304', async () => {
    installFixtureBackend(withEntries([1, 1, 1, '2026-11-14T20:00:00.000Z']));
    const first = await days();
    const tag = first.headers.get('ETag') ?? '';

    const conditional = await days(tag);

    expect(tag).toBe('"0"');
    expect(conditional.status).toBe(304);
    expect(await conditional.text()).toBe('');
    expect(conditional.headers.get('ETag')).toBe(tag);
  });

  it('changes its tag and instants with a verification and a delete', async () => {
    const fixtures = withEntries([1, 1, 1, '2026-11-14T20:00:00.000Z', true]);
    installFixtureBackend(fixtures);
    const entry = fixtures.entries[0];
    if (!entry) throw new Error('no entry');
    entry.accountId = 2;
    const pending = await days();

    await fetch(`/api/entries/${entry.id}/verification`, {
      method: 'PUT',
      body: '{}',
    });
    const verified = await days(pending.headers.get('ETag') ?? '');
    await fetch(`/api/entries/${entry.id}`, { method: 'DELETE' });
    const deleted = await days(verified.headers.get('ETag') ?? '');

    expect(await pending.json()).toEqual({ instants: [] });
    expect(await verified.json()).toEqual({
      instants: ['2026-11-14T20:00:00.000Z'],
    });
    expect(await deleted.json()).toEqual({ instants: [] });
  });
});
