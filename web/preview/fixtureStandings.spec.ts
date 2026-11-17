import { afterEach, describe, expect, it } from 'vitest';
import type { Standings } from '../src/core/api-client';
import { installFixtureBackend } from './fixtureBackend';
import { withGameRows } from './fixtureTesting';

/*
The fixture backend's game rankings over a window or all time, and the quarter hours
a game was played: these cases are the API integration tests' (`StandingsWindowTest`,
`StandingsDaysTest`, the standings' part of `IntervalQueryTest`), so the preview and
the API cannot drift apart unnoticed. Games: 1 Schach (duel), 2 Rommé (points,
lowest wins); persons: 1 Anna, 2 Ben, 3 Daniel, 4 Jule (the API tests' Carla).
*/

const AT_20 = '2026-11-14T20:00:00.000Z';
const AT_21 = '2026-11-14T21:00:00.000Z';
const FIRST_RUN = 'from=2026-11-14T20:00:00Z&to=2026-11-14T21:00:00Z';
/** 2026-11-14 20:00 UTC in milliseconds. */
const START_MS = '1794686400000';

async function get(path: string, ifNoneMatch?: string) {
  return fetch(
    path,
    ifNoneMatch === undefined
      ? undefined
      : { headers: { 'If-None-Match': ifNoneMatch } },
  );
}

async function standings(game: number, query = '', ifNoneMatch?: string) {
  return get(
    `/api/games/${String(game)}/standings${query === '' ? '' : `?${query}`}`,
    ifNoneMatch,
  );
}

async function ranked(game: number, query = ''): Promise<Standings> {
  const response = await standings(game, query);
  expect(response.status).toBe(200);
  return (await response.json()) as Standings;
}

const duelRow = (
  personId: number,
  name: string,
  points: number,
  wins: number,
  draws: number,
  losses: number,
  pendingCount = 0,
) => ({
  personId,
  name,
  points,
  wins,
  draws,
  losses,
  played: wins + draws + losses,
  pendingCount,
});

/** A row of a window or all time, which carries the average per result beside the sum. */
const pointsRow = (
  personId: number,
  name: string,
  sum: number,
  average: number,
  results: number,
  pendingCount = 0,
) => ({ personId, name, sum, average, results, pendingCount });

describe('the fixture backend’s game rankings of a window or all time', () => {
  const realFetch = globalThis.fetch;
  afterEach(() => {
    globalThis.fetch = realFetch;
  });

  it('answers a request without parameters with the current run, tagged with the bare revision, without averages', async () => {
    installFixtureBackend(
      withGameRows(
        [
          [1, 2, 'first', AT_20, 1],
          [4, 1, 'draw', AT_21, 2],
        ],
        [
          [1, 12, AT_20, 1],
          [1, 7, AT_21, 2],
          [2, -3, AT_21, 2],
        ],
        { run: 2, startedAt: AT_21 },
      ),
    );

    const duel = await standings(1);
    const points = await standings(2);

    expect(duel.headers.get('ETag')).toMatch(/^"\d+"$/);
    expect(await duel.json()).toEqual({
      kind: 'duel',
      startedAt: AT_21,
      rows: [
        duelRow(1, 'Anna', 0.5, 0, 1, 0),
        duelRow(4, 'Jule', 0.5, 0, 1, 0),
      ],
      unranked: [],
    });
    expect(points.headers.get('ETag')).toMatch(/^"\d+"$/);
    expect(await points.json()).toEqual({
      kind: 'points',
      startedAt: AT_21,
      lowerWins: true,
      rows: [
        { personId: 2, name: 'Ben', sum: -3, results: 1, pendingCount: 0 },
        { personId: 1, name: 'Anna', sum: 7, results: 1, pendingCount: 0 },
      ],
      unranked: [],
    });
  });

  it('accumulates a duel’s matches of every run in the selection; a window ends before its end', async () => {
    installFixtureBackend(
      withGameRows(
        [
          [1, 2, 'first', AT_20, 1],
          [1, 2, 'draw', AT_20, 1],
          [2, 1, 'first', AT_21, 2],
          [4, 1, 'second', AT_21, 2],
          [4, 2, 'draw', AT_21, 2],
          [3, 4, 'first', AT_21, 2],
          [3, 4, 'first', AT_21, 2],
        ],
        [],
        { run: 2, startedAt: AT_21 },
      ),
    );

    const allTime = await ranked(1, 'scope=all');
    const firstRun = await ranked(1, FIRST_RUN);
    const secondRun = await ranked(1, 'from=2026-11-14T21:00:00Z');

    expect(allTime.startedAt).toBe(AT_21);
    expect(allTime.rows).toEqual([
      duelRow(1, 'Anna', 2.5, 2, 1, 1),
      duelRow(3, 'Daniel', 2, 2, 0, 0),
      duelRow(2, 'Ben', 2, 1, 2, 1),
      duelRow(4, 'Jule', 0.5, 0, 1, 3),
    ]);
    expect(firstRun.rows).toEqual([
      duelRow(1, 'Anna', 1.5, 1, 1, 0),
      duelRow(2, 'Ben', 0.5, 0, 1, 1),
    ]);
    expect(secondRun.rows).toEqual([
      duelRow(3, 'Daniel', 2, 2, 0, 0),
      duelRow(2, 'Ben', 1.5, 1, 1, 0),
      duelRow(1, 'Anna', 1, 1, 0, 1),
      duelRow(4, 'Jule', 0.5, 0, 1, 3),
    ]);
    expect((await ranked(1)).rows).toEqual(secondRun.rows);
  });

  it('adds up a points game’s results of every run as one attempt each, in its direction', async () => {
    installFixtureBackend(
      withGameRows(
        [],
        [
          [1, 10, AT_20, 1],
          [2, 4, AT_20, 1],
          [1, -3, AT_21, 2],
          [1, 5, AT_21, 2],
          [4, 6, AT_21, 2],
        ],
        { run: 2, startedAt: AT_21 },
      ),
    );

    const allTime = await ranked(2, 'scope=all');
    const firstRun = await ranked(2, FIRST_RUN);

    expect(allTime).toMatchObject({
      kind: 'points',
      startedAt: AT_21,
      lowerWins: true,
    });
    expect(allTime.rows).toEqual([
      pointsRow(2, 'Ben', 4, 4, 1),
      pointsRow(4, 'Jule', 6, 6, 1),
      pointsRow(1, 'Anna', 12, 4, 3),
    ]);
    expect(firstRun.rows).toEqual([
      pointsRow(2, 'Ben', 4, 4, 1),
      pointsRow(1, 'Anna', 10, 10, 1),
    ]);
  });

  it('rounds the average per result half away from zero to one decimal, ranked by the sum', async () => {
    installFixtureBackend(
      withGameRows(
        [],
        [
          [1, 3, AT_20],
          [1, 4, AT_20],
          [2, 3, AT_20],
          [2, 3, AT_20],
          [2, 4, AT_20],
          [3, -1, AT_20],
          [3, 0, AT_20],
          [3, 0, AT_20],
          [3, 0, AT_20],
        ],
      ),
    );

    const { rows } = await ranked(2, 'scope=all');

    expect(
      rows.map((row) => [row.name, 'average' in row && row.average]),
    ).toEqual([
      ['Daniel', -0.3],
      ['Anna', 3.5],
      ['Ben', 3.3],
    ]);
  });

  it('counts only verified rows in a window, names each person’s waiting ones there and lists who only waits apart', async () => {
    installFixtureBackend(
      withGameRows(
        [
          [1, 2, 'first', AT_20],
          [4, 3, 'first', AT_20, 1, true],
          [1, 4, 'draw', AT_20, 1, true],
          [1, 3, 'first', AT_21, 1, true],
        ],
        [
          [1, 5, AT_20],
          [1, 6, AT_20, 1, true],
          [2, 3, AT_20, 1, true],
          [1, 2, AT_21, 1, true],
        ],
      ),
    );

    const duel = await ranked(1, FIRST_RUN);
    const points = await ranked(2, FIRST_RUN);

    expect(duel.rows).toEqual([
      duelRow(1, 'Anna', 1, 1, 0, 0, 1),
      duelRow(2, 'Ben', 0, 0, 0, 1),
    ]);
    expect(duel.unranked).toEqual([
      { personId: 3, name: 'Daniel', pendingCount: 1 },
      { personId: 4, name: 'Jule', pendingCount: 2 },
    ]);
    expect(points.rows).toEqual([pointsRow(1, 'Anna', 5, 5, 1, 1)]);
    expect(points.unranked).toEqual([
      { personId: 2, name: 'Ben', pendingCount: 1 },
    ]);
  });

  it('tags the revision and the selection, and answers 304 only to the same one; a write is a new revision', async () => {
    installFixtureBackend(withGameRows([[1, 2, 'first', AT_20]]));
    const tags: Record<string, string> = {
      '': '"%d"',
      'from=2026-11-14T20:00:00Z': `"%d-${START_MS}"`,
      [FIRST_RUN]: `"%d-${START_MS}-1794690000000"`,
      'from=2026-11-14T21:00:00%2B01:00&to=2026-11-14T22:00:00Z': `"%d-${START_MS}-1794693600000"`,
      'scope=all': '"%d-all"',
    };
    const revision = (await standings(1)).headers.get('ETag')?.slice(1, -1);
    const tagOf = (query: string) =>
      (tags[query] ?? '').replace('%d', revision ?? '');

    for (const query of Object.keys(tags)) {
      expect((await standings(1, query)).headers.get('ETag')).toBe(
        tagOf(query),
      );
      expect((await standings(1, query, tagOf(query))).status).toBe(304);
      for (const other of Object.keys(tags).filter((key) => key !== query)) {
        expect((await standings(1, query, tagOf(other))).status).toBe(200);
      }
    }
    await fetch('/api/games/1/restart', { method: 'POST', body: '{}' });

    expect((await standings(1, 'scope=all', tagOf('scope=all'))).status).toBe(
      200,
    );
  });

  it('counts a deleted person’s side for no one in a window, the other side keeping its result', async () => {
    installFixtureBackend(
      withGameRows(
        [
          [1, 2, 'first', AT_20],
          [2, 4, 'first', AT_20],
        ],
        [
          [2, 4, AT_20],
          [4, 9, AT_20],
        ],
      ),
    );

    const deleted = await fetch('/api/persons/2', { method: 'DELETE' });

    expect(deleted.status).toBe(204);
    for (const query of ['scope=all', FIRST_RUN]) {
      expect((await ranked(1, query)).rows).toEqual([
        duelRow(1, 'Anna', 1, 1, 0, 0),
        duelRow(4, 'Jule', 0, 0, 0, 1),
      ]);
      expect((await ranked(2, query)).rows).toEqual([
        pointsRow(4, 'Jule', 9, 9, 1),
      ]);
    }
  });

  it('keeps a row recorded before a window’s end and verified after it in the window it was recorded in', async () => {
    const fixtures = withGameRows(
      [[1, 2, 'first', '2026-11-14T22:59:59.000Z', 1, true]],
      [[1, 5, '2026-11-14T22:59:59.000Z', 1, true]],
    );
    for (const row of [...fixtures.matches, ...fixtures.results]) {
      row.accountId = 2;
    }
    installFixtureBackend(fixtures);
    const recordedIn = 'from=2026-11-13T23:00:00Z&to=2026-11-14T23:00:00Z';
    const verifiedIn = 'from=2026-11-14T23:00:00Z&to=2026-11-15T23:00:00Z';

    for (const [kind, row] of [
      ['matches', fixtures.matches[0]],
      ['results', fixtures.results[0]],
    ] as const) {
      const verified = await fetch(
        `/api/${kind}/${row?.id ?? ''}/verification`,
        { method: 'PUT', body: '{}' },
      );
      expect(verified.status).toBe(204);
    }

    expect((await ranked(1, recordedIn)).rows).toEqual([
      duelRow(1, 'Anna', 1, 1, 0, 0),
      duelRow(2, 'Ben', 0, 0, 0, 1),
    ]);
    expect((await ranked(2, recordedIn)).rows).toEqual([
      pointsRow(1, 'Anna', 5, 5, 1),
    ]);
    for (const game of [1, 2]) {
      expect(await ranked(game, verifiedIn)).toMatchObject({
        rows: [],
        unranked: [],
      });
    }
  });

  it.each([
    ['an empty end', 'from=2026-11-13T23:00:00Z&to='],
    [
      'an end that is a list',
      'from=2026-11-13T23:00:00Z&to[]=2026-11-14T23:00:00Z',
    ],
    [
      'an end at the start',
      'from=2026-11-13T23:00:00Z&to=2026-11-14T00:00:00%2B01:00',
    ],
    ['an end without a start', 'to=2026-11-14T23:00:00Z'],
    ['an empty start', 'from='],
    ['a start that is no date', 'from=gestern'],
    ['all time with a start', 'scope=all&from=2026-11-13T23:00:00Z'],
    ['all time with an empty end', 'scope=all&to='],
    ['an unknown scope', 'scope=day'],
    ['an empty scope', 'scope='],
    ['a list of scopes', 'scope[]=all'],
  ])(
    'rejects %s exactly as the scoreboard does, before it looks for the game',
    async (_case, query) => {
      installFixtureBackend(withGameRows([]));

      const scoreboard = await get(`/api/scoreboard?${query}`);
      const body = await scoreboard.text();
      const ofGame = await standings(1, query);
      const ofUnknownGame = await standings(9, query);

      expect(scoreboard.status).toBe(422);
      expect([ofGame.status, await ofGame.text()]).toEqual([422, body]);
      expect([ofUnknownGame.status, await ofUnknownGame.text()]).toEqual([
        422,
        body,
      ]);
    },
  );

  it('answers 404 for an unknown game with a valid selection', async () => {
    installFixtureBackend(withGameRows([]));

    expect((await standings(9, 'scope=all')).status).toBe(404);
    expect((await standings(9, FIRST_RUN)).status).toBe(404);
  });
});

describe('the fixture backend’s quarter hours a game was played', () => {
  const realFetch = globalThis.fetch;
  afterEach(() => {
    globalThis.fetch = realFetch;
  });

  async function days(game: number, ifNoneMatch?: string) {
    return get(`/api/games/${String(game)}/standings/days`, ifNoneMatch);
  }

  async function instants(game: number): Promise<string[]> {
    const response = await days(game);
    expect(response.status).toBe(200);
    return ((await response.json()) as { instants: string[] }).instants;
  }

  it('lists the quarter hours of a duel’s verified matches in every run, one for both players', async () => {
    installFixtureBackend(
      withGameRows(
        [
          [1, 2, 'first', AT_20, 1],
          [4, 3, 'draw', '2026-11-14T20:10:00.000Z', 1],
          [2, 4, 'second', '2026-11-15T20:10:00.000Z', 2],
          [1, 3, 'first', '2026-11-15T20:40:00.000Z', 2, true],
        ],
        [[1, 10, '2026-11-15T20:40:00.000Z', 2]],
        { run: 2 },
      ),
    );

    expect(await instants(1)).toEqual([
      '2026-11-14T20:00:00.000Z',
      '2026-11-15T20:00:00.000Z',
    ]);
  });

  it('lists the quarter hours of a points game’s verified results in every run', async () => {
    installFixtureBackend(
      withGameRows(
        [[1, 2, 'first', AT_21, 2]],
        [
          [1, 10, AT_20, 1],
          [2, 7, AT_20, 1],
          [4, 4, '2026-11-14T20:45:00.000Z', 2],
          [3, 2, AT_21, 2, true],
        ],
        { run: 2 },
      ),
    );

    expect(await instants(2)).toEqual([
      '2026-11-14T20:00:00.000Z',
      '2026-11-14T20:45:00.000Z',
    ]);
  });

  it('counts exactly what the ranking counts: a match while one side names a person, no deleted person’s result', async () => {
    installFixtureBackend(
      withGameRows(
        [
          [1, 2, 'first', AT_20],
          [4, 3, 'first', '2026-11-14T20:15:00.000Z'],
        ],
        [
          [1, 10, '2026-11-14T20:15:00.000Z'],
          [4, 4, '2026-11-14T20:30:00.000Z'],
        ],
      ),
    );

    for (const person of [2, 3, 4]) {
      await fetch(`/api/persons/${String(person)}`, { method: 'DELETE' });
    }

    expect(await instants(1)).toEqual(['2026-11-14T20:00:00.000Z']);
    expect(await instants(2)).toEqual(['2026-11-14T20:15:00.000Z']);
    expect((await ranked(1)).rows.map(({ name }) => name)).toEqual(['Anna']);
    expect(
      (await ranked(2)).rows.map((row) => [
        row.name,
        'sum' in row ? row.sum : undefined,
      ]),
    ).toEqual([['Anna', 10]]);
  });

  it('keeps a row recorded before midnight and verified the next day in the quarter hour it was recorded in', async () => {
    const fixtures = withGameRows(
      [[1, 2, 'draw', '2026-11-14T23:59:30.000Z', 1, true]],
      [[1, 3, '2026-11-14T23:59:30.000Z', 1, true]],
    );
    for (const row of [...fixtures.matches, ...fixtures.results]) {
      row.accountId = 2;
    }
    installFixtureBackend(fixtures);

    await fetch(`/api/matches/${fixtures.matches[0]?.id ?? ''}/verification`, {
      method: 'PUT',
      body: '{}',
    });
    await fetch(`/api/results/${fixtures.results[0]?.id ?? ''}/verification`, {
      method: 'PUT',
      body: '{}',
    });

    expect(await instants(1)).toEqual(['2026-11-14T23:45:00.000Z']);
    expect(await instants(2)).toEqual(['2026-11-14T23:45:00.000Z']);
  });

  it('answers many rows in one quarter hour as one instant', async () => {
    const start = new Date(AT_20).getTime();
    const at = (i: number) =>
      new Date(
        start + Math.floor(i / 750) * 900_000 + (i % 750) * 1200,
      ).toISOString();
    installFixtureBackend(
      withGameRows(
        Array.from({ length: 1500 }, (_, i) => [
          1,
          2,
          'first',
          at(i),
          (i % 2) + 1,
        ]),
        Array.from({ length: 1500 }, (_, i) => [
          (i % 4) + 1,
          5,
          at(i),
          (i % 2) + 1,
        ]),
        { run: 2 },
      ),
    );

    const quarters = ['2026-11-14T20:00:00.000Z', '2026-11-14T20:15:00.000Z'];
    expect(await instants(1)).toEqual(quarters);
    expect(await instants(2)).toEqual(quarters);
  });

  it('answers 404 for an unknown or deleted game', async () => {
    installFixtureBackend(withGameRows([]));
    await fetch('/api/games/2', { method: 'DELETE' });

    const unknown = await days(9);
    const deleted = await days(2);

    expect(unknown.status).toBe(404);
    expect(await unknown.json()).toMatchObject({
      type: 'urn:performance:problem:not-found',
    });
    expect(deleted.status).toBe(404);
  });

  it('tags the answer with the data revision and answers 304 while it holds; a verification and a delete change it', async () => {
    const fixtures = withGameRows([
      [1, 2, 'first', AT_20],
      [1, 3, 'first', AT_21, 1, true],
    ]);
    const waiting = fixtures.matches[1];
    if (waiting) waiting.accountId = 2;
    installFixtureBackend(fixtures);
    const first = await days(1);
    const tag = first.headers.get('ETag') ?? '';

    expect(tag).toMatch(/^"\d+"$/);
    expect((await days(1, tag)).status).toBe(304);
    await fetch(`/api/matches/${waiting?.id ?? ''}/verification`, {
      method: 'PUT',
      body: '{}',
    });
    const verified = await days(1, tag);
    expect(verified.status).toBe(200);
    await fetch(`/api/matches/${fixtures.matches[0]?.id ?? ''}`, {
      method: 'DELETE',
    });
    expect(
      (await days(1, verified.headers.get('ETag') ?? undefined)).status,
    ).toBe(200);
  });
});
