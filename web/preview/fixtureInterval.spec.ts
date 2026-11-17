import { afterEach, describe, expect, it } from 'vitest';
import type { HistoryEntry, Scoreboard } from '../src/core/api-client';
import { installFixtureBackend } from './fixtureBackend';
import { sampleEvening } from './fixtures';
import { withEntries } from './fixtureTesting';

/*
The fixture backend takes windows like the API (`IntervalQuery`): these cases are
the API integration tests' (`IntervalQueryTest`, `ScoreboardTest`), so the preview
and the API cannot drift apart unnoticed.
*/

const INSTANT = 'Zeitpunkt nach ISO 8601 mit Zeitzone.';
const AFTER_FROM = 'Zeitpunkt nach from.';

async function get(path: string, ifNoneMatch?: string) {
  return fetch(
    path,
    ifNoneMatch === undefined
      ? undefined
      : { headers: { 'If-None-Match': ifNoneMatch } },
  );
}

async function board(query: string): Promise<Scoreboard> {
  const response = await get(`/api/scoreboard?${query}`);
  expect(response.status).toBe(200);
  return (await response.json()) as Scoreboard;
}

const scores = ({ rows }: Scoreboard) =>
  rows.map(({ name, score }) => [name, score]);

describe('the fixture backend’s windows', () => {
  const realFetch = globalThis.fetch;
  afterEach(() => {
    globalThis.fetch = realFetch;
  });

  it('counts only entries before the end of a window; an entry exactly at the end is outside', async () => {
    installFixtureBackend(
      withEntries(
        [3, 2, 2, '2026-11-14T20:00:00.000Z'],
        [3, 2, 5, '2026-11-14T20:00:00.000Z', true],
        [2, 1, 1, '2026-11-14T20:00:00.000Z', true],
        [1, 2, 4, '2026-11-14T23:00:00.000Z'],
        [3, 1, 1, '2026-11-14T23:00:00.000Z'],
      ),
    );

    const day = await board(
      'from=2026-11-13T23:00:00.000Z&to=2026-11-14T23:00:00.000Z',
    );

    expect(day.rows).toEqual([
      {
        personId: 3,
        name: 'Daniel',
        photoUrl: expect.any(String),
        score: 2,
        count: 2,
        pendingCount: 1,
        drinks: [{ drinkId: 2, name: 'Bier', count: 2, recordedCount: 7 }],
      },
    ]);
    expect(day.unranked).toEqual([
      {
        personId: 2,
        name: 'Ben',
        photoUrl: null,
        pendingCount: 1,
        drinks: [{ drinkId: 1, name: 'Aperol', count: 0, recordedCount: 1 }],
      },
    ]);
  });

  it('counts everything since from without an end, as before windows had one', async () => {
    installFixtureBackend(
      withEntries(
        [3, 2, 4, '2026-11-14T20:00:00.000Z'],
        [3, 2, 1, '2026-11-15T00:00:00.000Z'],
        [1, 2, 2, '2026-11-20T00:00:00.000Z'],
      ),
    );

    expect(scores(await board('from=2026-11-15T00:00:00Z'))).toEqual([
      ['Anna', 2],
      ['Daniel', 1],
    ]);
    expect(
      await board(`from=${encodeURIComponent('2026-11-15T01:00:00+01:00')}`),
    ).toEqual(await board('from=2026-11-15T00:00:00Z'));
  });

  it('takes an end with any offset', async () => {
    installFixtureBackend(
      withEntries(
        [3, 2, 2, '2026-11-14T20:00:00.000Z'],
        [1, 2, 4, '2026-11-14T23:00:00.000Z'],
      ),
    );

    const utc = await board(
      'from=2026-11-13T23:00:00.000Z&to=2026-11-14T23:00:00.000Z',
    );
    const berlin = await board(
      `from=2026-11-13T23:00:00.000Z&to=${encodeURIComponent('2026-11-15T00:00:00+01:00')}`,
    );

    expect(scores(utc)).toEqual([['Daniel', 2]]);
    expect(berlin).toEqual(utc);
  });

  it('keeps an entry verified after the end of its window in the window it was recorded in', async () => {
    const fixtures = withEntries([3, 2, 2, '2026-11-14T22:59:00.000Z', true]);
    installFixtureBackend(fixtures);
    const late = fixtures.entries[0];
    if (!late) throw new Error('no entry');
    late.accountId = 2;

    const verified = await fetch(`/api/entries/${late.id}/verification`, {
      method: 'PUT',
      body: '{}',
    });

    expect(verified.status).toBe(204);
    expect(
      scores(
        await board(
          'from=2026-11-13T23:00:00.000Z&to=2026-11-14T23:00:00.000Z',
        ),
      ),
    ).toEqual([['Daniel', 2]]);
    expect(
      await board('from=2026-11-14T23:00:00.000Z&to=2026-11-15T23:00:00.000Z'),
    ).toEqual({ rows: [], unranked: [] });
  });

  it('ranks every entry ever recorded with scope=all', async () => {
    installFixtureBackend(
      withEntries(
        [3, 2, 2, '2026-10-01T20:00:00.000Z'],
        [2, 2, 1, '2026-10-01T20:00:00.000Z', true],
        [1, 6, 2, '2026-11-14T20:00:00.000Z'],
        [3, 2, 1, '2026-11-14T20:00:00.000Z'],
      ),
    );

    const allTime = await board('scope=all');

    expect(scores(allTime)).toEqual([
      ['Anna', 4],
      ['Daniel', 3],
    ]);
    expect(allTime.unranked.map(({ name }) => name)).toEqual(['Ben']);
  });

  it('lists a person’s entries of a window with an end, the entry at the end left out', async () => {
    installFixtureBackend(
      withEntries(
        [3, 2, 2, '2026-11-13T22:59:59.999Z'],
        [3, 2, 1, '2026-11-14T20:00:00.000Z'],
        [3, 6, 1, '2026-11-14T23:00:00.000Z'],
      ),
    );

    const response = await get(
      '/api/entries?personId=3&from=2026-11-13T23:00:00.000Z&to=2026-11-14T23:00:00.000Z',
    );
    const { entries } = (await response.json()) as {
      entries: HistoryEntry[];
    };

    expect(entries.map(({ createdAt }) => createdAt)).toEqual([
      '2026-11-14T20:00:00.000Z',
    ]);
  });

  it.each([
    ['an empty end', 'from=2026-11-13T23:00:00Z&to=', { to: INSTANT }],
    [
      'an end that is a date only',
      'from=2026-11-13T23:00:00Z&to=2026-11-14',
      { to: INSTANT },
    ],
    [
      'an end without an offset',
      'from=2026-11-13T23:00:00Z&to=2026-11-14T23:00:00',
      { to: INSTANT },
    ],
    [
      'an end that is no date',
      'from=2026-11-13T23:00:00Z&to=morgen',
      { to: INSTANT },
    ],
    [
      'an end that is a list',
      'from=2026-11-13T23:00:00Z&to[]=2026-11-14T23:00:00Z',
      { to: INSTANT },
    ],
    [
      'an end at the start',
      'from=2026-11-13T23:00:00Z&to=2026-11-14T00:00:00%2B01:00',
      { to: AFTER_FROM },
    ],
    [
      'an end before the start',
      'from=2026-11-13T23:00:00Z&to=2026-11-13T22:59:59.999Z',
      { to: AFTER_FROM },
    ],
    ['an end without a start', 'to=2026-11-14T23:00:00Z', { from: INSTANT }],
    ['neither start nor end', '', { from: INSTANT }],
  ])(
    'rejects %s alike on the scoreboard and the entry list',
    async (_case, window, errors) => {
      installFixtureBackend(sampleEvening());

      const scoreboard = await get(`/api/scoreboard?${window}`);
      const entries = await get(`/api/entries?personId=1&${window}`);

      expect(scoreboard.status).toBe(422);
      expect(scoreboard.headers.get('Content-Type')).toBe(
        'application/problem+json',
      );
      const body = await scoreboard.text();
      expect((JSON.parse(body) as { errors: unknown }).errors).toEqual(errors);
      expect([entries.status, await entries.text()]).toEqual([422, body]);
    },
  );

  it.each([
    ['missing', ''],
    ['a date only', '?from=2026-11-14'],
    ['no time zone', '?from=2026-11-14T00:00:00'],
    ['not a date', '?from=gestern'],
    ['an impossible date', '?from=2026-13-45T00:00:00Z'],
    ['a null byte', '?from=2026-11-14T00:00:00Z%00'],
  ])('rejects a start that is %s', async (_case, query) => {
    installFixtureBackend(sampleEvening());

    const response = await get(`/api/scoreboard${query}`);

    expect(response.status).toBe(422);
    expect(await response.json()).toMatchObject({
      errors: { from: INSTANT },
    });
  });

  it.each([
    [
      'all time with a start',
      'scope=all&from=2026-11-13T23:00:00Z',
      { scope: 'Nicht zusammen mit from oder to.' },
    ],
    [
      'all time with an end',
      'scope=all&to=2026-11-13T23:00:00Z',
      { scope: 'Nicht zusammen mit from oder to.' },
    ],
    [
      'all time with a window',
      'scope=all&from=2026-11-13T23:00:00Z&to=2026-11-14T23:00:00Z',
      { scope: 'Nicht zusammen mit from oder to.' },
    ],
    [
      'all time with an empty start',
      'scope=all&from=',
      { scope: 'Nicht zusammen mit from oder to.' },
    ],
    ['an unknown scope', 'scope=day', { scope: 'Nur all.' }],
    [
      'an unknown scope with a start',
      'scope=ALL&from=2026-11-13T23:00:00Z',
      { scope: 'Nur all.' },
    ],
    ['an empty scope', 'scope=', { scope: 'Nur all.' }],
    ['a list of scopes', 'scope[]=all', { scope: 'Nur all.' }],
  ])(
    'rejects %s: all time is the only scope and excludes a window',
    async (_case, query, errors) => {
      installFixtureBackend(sampleEvening());

      const response = await get(`/api/scoreboard?${query}`);

      expect(response.status).toBe(422);
      expect(response.headers.get('Content-Type')).toBe(
        'application/problem+json',
      );
      expect(await response.json()).toMatchObject({ errors });
    },
  );

  it('tags each selection apart and answers 304 only to its own tag', async () => {
    installFixtureBackend(withEntries([3, 2, 2, '2026-11-14T20:00:00.000Z']));
    const selections = [
      'from=2026-11-13T23:00:00.000Z',
      'from=2026-11-13T23:00:00.000Z&to=2026-11-14T23:00:00.000Z',
      'from=2026-11-13T23:00:00.000Z&to=2026-11-15T23:00:00.000Z',
      'from=2026-11-12T23:00:00.000Z&to=2026-11-14T23:00:00.000Z',
      'scope=all',
    ];
    const tags = await Promise.all(
      selections.map(
        async (query) =>
          (await get(`/api/scoreboard?${query}`)).headers.get('ETag') ?? '',
      ),
    );

    const answers: number[][] = [];
    for (const query of selections) {
      const row: number[] = [];
      for (const tag of tags) {
        row.push((await get(`/api/scoreboard?${query}`, tag)).status);
      }
      answers.push(row);
    }

    expect(new Set(tags).size).toBe(selections.length);
    expect(tags).toEqual([
      '"0-1794610800000"',
      '"0-1794610800000-1794697200000"',
      '"0-1794610800000-1794783600000"',
      '"0-1794524400000-1794697200000"',
      '"0-all"',
    ]);
    expect(answers).toEqual([
      [304, 200, 200, 200, 200],
      [200, 304, 200, 200, 200],
      [200, 200, 304, 200, 200],
      [200, 200, 200, 304, 200],
      [200, 200, 200, 200, 304],
    ]);
  });

  it('tags the same selection alike whatever the offset', async () => {
    installFixtureBackend(sampleEvening());
    const utc =
      (
        await get(
          '/api/scoreboard?from=2026-11-13T23:00:00.000Z&to=2026-11-14T23:00:00.000Z',
        )
      ).headers.get('ETag') ?? '';

    const berlin = await get(
      `/api/scoreboard?from=${encodeURIComponent('2026-11-14T00:00:00+01:00')}&to=${encodeURIComponent('2026-11-15T00:00:00+01:00')}`,
      utc,
    );

    expect(berlin.status).toBe(304);
  });

  it('changes the tag of a window with an end and of all time with a write', async () => {
    installFixtureBackend(withEntries([3, 2, 1, '2026-11-14T20:00:00.000Z']));
    const window = 'from=2026-11-13T23:00:00.000Z&to=2026-11-14T23:00:00.000Z';
    const tagOf = async (query: string) =>
      (await get(`/api/scoreboard?${query}`)).headers.get('ETag') ?? '';
    const windowTag = await tagOf(window);
    const allTimeTag = await tagOf('scope=all');

    await fetch('/api/entries/6f1c2d3e-4a5b-4c6d-8e7f-90a1b2c3d4e5', {
      method: 'PUT',
      body: JSON.stringify({ personId: 2, drinkId: 2, quantity: 1 }),
    });

    expect((await get(`/api/scoreboard?${window}`, windowTag)).status).toBe(
      200,
    );
    expect((await get('/api/scoreboard?scope=all', allTimeTag)).status).toBe(
      200,
    );
  });
});
