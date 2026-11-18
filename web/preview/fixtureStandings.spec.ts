import { afterEach, describe, expect, it } from 'vitest';
import type { Standings } from '../src/core/api-client';
import { installFixtureBackend } from './fixtureBackend';
import { calendarDateOf, localDaysOf } from '../src/core/period';
import { sampleEvening } from './fixtures';
import { type ResultRow, withGameRows } from './fixtureTesting';

/*
The fixture backend's game rankings over a window or all time, by either measure,
and the quarter hours a game was played: these cases are the API integration
tests' (`StandingsWindowTest`, `StandingsMeasureTest`, `StandingsDaysTest`, the
standings' part of `IntervalQueryTest`), so the preview and the API cannot drift
apart unnoticed. Games: 1 Schach (duel), 2 Rommé (points, lowest wins), 3 Darts
(points, highest wins); persons: 1 Anna, 2 Ben, 3 Daniel, 4 Jule (the API tests'
Carla).
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

describe('the fixture backend’s points rankings by measure', () => {
  /*
  The cases of the API's `StandingsMeasureTest`; its Carla is Jule (4) here, its
  Daniel is Daniel (3). Games: 1 Schach (duel), 2 Rommé (lowest wins), 3 Darts
  (highest wins).
  */
  const realFetch = globalThis.fetch;
  afterEach(() => {
    globalThis.fetch = realFetch;
  });

  const SCHACH = 1;
  const ROMME = 2;
  const DARTS = 3;
  const DAY = 'from=2026-11-14T20:00:00Z&to=2026-11-15T20:00:00Z';

  /** Results of one person in one game, all at 20:00 of the first run. */
  const scores = (
    game: number,
    personId: number,
    points: number[],
  ): ResultRow[] =>
    points.map((value) => [personId, value, AT_20, 1, false, game]);

  async function rows(game: number, query: string) {
    return (await ranked(game, query)).rows;
  }

  it('ranks by the mean per verified result in the game’s direction, across a restart; equal means by name', async () => {
    const games = [ROMME, DARTS];
    installFixtureBackend(
      withGameRows(
        [],
        games.flatMap((game): ResultRow[] => [
          ...scores(game, 1, [10, 2]),
          ...scores(game, 2, [9]),
          ...scores(game, 4, [3, 3]),
          ...scores(game, 3, [6]),
          [4, 3, AT_21, 2, false, game],
          [4, 3, AT_21, 2, false, game],
          [4, 40, AT_21, 2, true, game],
        ]),
        { run: 2, startedAt: AT_21 },
      ),
    );
    const jule = pointsRow(4, 'Jule', 12, 3, 4, 1);
    const anna = pointsRow(1, 'Anna', 12, 6, 2);
    const daniel = pointsRow(3, 'Daniel', 6, 6, 1);
    const ben = pointsRow(2, 'Ben', 9, 9, 1);

    for (const selection of ['scope=all', DAY]) {
      expect(await rows(ROMME, `${selection}&measure=average`)).toEqual([
        jule,
        anna,
        daniel,
        ben,
      ]);
      expect(await rows(DARTS, `${selection}&measure=average`)).toEqual([
        ben,
        anna,
        daniel,
        jule,
      ]);
    }
  });

  it('ranks negative means over very different numbers of results by their exact values in both directions, before rounding', async () => {
    installFixtureBackend(
      withGameRows(
        [],
        [ROMME, DARTS].flatMap((game): ResultRow[] => [
          ...scores(game, 1, [-4, -3]),
          ...scores(game, 2, [-10, 0, 0]),
          ...scores(game, 4, [...Array.from({ length: 99 }, () => -3), -36]),
          ...scores(game, 3, [-15, 0, 0, 0]),
        ]),
      ),
    );
    const daniel = pointsRow(3, 'Daniel', -15, -3.8, 4);
    const anna = pointsRow(1, 'Anna', -7, -3.5, 2);
    const ben = pointsRow(2, 'Ben', -10, -3.3, 3);
    const jule = pointsRow(4, 'Jule', -333, -3.3, 100);

    for (const selection of ['scope=all', DAY]) {
      expect(await rows(ROMME, `${selection}&measure=average`)).toEqual([
        daniel,
        anna,
        ben,
        jule,
      ]);
      expect(await rows(DARTS, `${selection}&measure=average`)).toEqual([
        jule,
        ben,
        anna,
        daniel,
      ]);
      expect(await rows(ROMME, selection)).toEqual([jule, daniel, ben, anna]);
      expect(await rows(DARTS, selection)).toEqual([anna, ben, daniel, jule]);
    }
  });

  it('ranks by the sum without a measure and with measure=sum, every row carrying the rounded average', async () => {
    installFixtureBackend(
      withGameRows(
        [],
        [
          ...scores(ROMME, 1, [3, 4]),
          ...scores(ROMME, 2, [3, 3, 4]),
          ...scores(ROMME, 4, [6, 7, 7]),
          ...scores(ROMME, 3, [1, -1, -1, 0]),
        ],
      ),
    );
    const bySum = [
      pointsRow(3, 'Daniel', -1, -0.3, 4),
      pointsRow(1, 'Anna', 7, 3.5, 2),
      pointsRow(2, 'Ben', 10, 3.3, 3),
      pointsRow(4, 'Jule', 20, 6.7, 3),
    ];

    const byDefault = await standings(ROMME, 'scope=all');
    const sum = await standings(ROMME, 'scope=all&measure=sum');

    const body = await byDefault.text();
    expect((JSON.parse(body) as Standings).rows).toEqual(bySum);
    expect(await sum.text()).toBe(body);
    expect(await rows(ROMME, `${DAY}&measure=sum`)).toEqual(bySum);
  });

  it('ranks the sum highest first where the highest wins, across a restart; equal sums by name', async () => {
    installFixtureBackend(
      withGameRows(
        [],
        [
          ...scores(DARTS, 2, [9]),
          ...scores(DARTS, 1, [4, 5]),
          ...scores(DARTS, 4, [3]),
          ...scores(DARTS, 3, [5]),
          [4, -1, AT_21, 2, false, DARTS],
          [3, 7, AT_21, 2, false, DARTS],
        ],
        { run: 2, startedAt: AT_21 },
      ),
    );
    const bySum = [
      pointsRow(3, 'Daniel', 12, 6, 2),
      pointsRow(1, 'Anna', 9, 4.5, 2),
      pointsRow(2, 'Ben', 9, 9, 1),
      pointsRow(4, 'Jule', 2, 1, 2),
    ];

    for (const selection of [
      'scope=all',
      DAY,
      'scope=all&measure=sum',
      `${DAY}&measure=sum`,
    ]) {
      expect(await rows(DARTS, selection)).toEqual(bySum);
    }
  });

  it('orders two averages that round alike by their exact values', async () => {
    installFixtureBackend(
      withGameRows(
        [],
        [
          ...scores(ROMME, 1, [3, 3, 4]),
          ...scores(ROMME, 2, [3, 3, 3, 4]),
          ...scores(ROMME, 4, [...Array<number>(107).fill(3), 2]),
          ...scores(ROMME, 3, [...Array<number>(106).fill(3), 2]),
        ],
      ),
    );

    expect(await rows(ROMME, 'scope=all&measure=average')).toEqual([
      pointsRow(3, 'Daniel', 320, 3, 107),
      pointsRow(4, 'Jule', 323, 3, 108),
      pointsRow(2, 'Ben', 13, 3.3, 4),
      pointsRow(1, 'Anna', 10, 3.3, 3),
    ]);
  });

  it('breaks equal averages by name however their sums differ', async () => {
    installFixtureBackend(
      withGameRows([], [...scores(DARTS, 2, [4]), ...scores(DARTS, 1, [3, 5])]),
    );

    expect(await rows(DARTS, 'scope=all&measure=average')).toEqual([
      pointsRow(1, 'Anna', 8, 4, 2),
      pointsRow(2, 'Ben', 4, 4, 1),
    ]);
  });

  const known = { measure: 'Nur sum oder average.' };
  const period = { measure: 'Nur mit from oder scope=all.' };
  const points = { measure: 'Nur bei Punktespielen.' };

  it.each([
    ['an unknown measure', ROMME, 'scope=all&measure=median', known],
    ['a measure in capitals', ROMME, 'scope=all&measure=SUM', known],
    ['an empty measure', ROMME, `${DAY}&measure=`, known],
    ['a measure that is a list', ROMME, 'scope=all&measure[]=average', known],
    ['the sum in the current run', ROMME, 'measure=sum', period],
    ['the average in the current run', ROMME, 'measure=average', period],
    ['an unknown measure in the current run', ROMME, 'measure=median', known],
    ['the sum of a duel', SCHACH, 'scope=all&measure=sum', points],
    [
      'the average of a duel in a window',
      SCHACH,
      `${DAY}&measure=average`,
      points,
    ],
    [
      'the average of a duel in the current run',
      SCHACH,
      'measure=average',
      period,
    ],
  ])(
    'rejects %s, even with the current run’s tag, and leaves the current run as it was',
    async (_case, game, query, errors) => {
      installFixtureBackend(withGameRows([], [[1, 5, AT_20]]));
      const currentRun = await standings(game);
      const body = await currentRun.text();

      const rejected = await standings(
        game,
        query,
        currentRun.headers.get('ETag') ?? '',
      );

      expect(rejected.status).toBe(422);
      expect(rejected.headers.get('Content-Type')).toBe(
        'application/problem+json',
      );
      expect(((await rejected.json()) as { errors: unknown }).errors).toEqual(
        errors,
      );
      expect(await (await standings(game)).text()).toBe(body);
    },
  );

  it('checks a measure in the current run before it looks for the game', async () => {
    installFixtureBackend(withGameRows([]));

    expect((await standings(99, 'measure=average')).status).toBe(422);
    expect((await standings(99, 'scope=all&measure=average')).status).toBe(404);
  });

  it('tags the average apart from the sum, sent or not, and answers 304 only to the same one', async () => {
    installFixtureBackend(withGameRows([], [[1, 5, AT_20]]));
    const revision = (await standings(ROMME)).headers.get('ETag')?.slice(1, -1);
    const sum = `"${revision ?? ''}-all"`;
    const average = `"${revision ?? ''}-all-average"`;

    const tagOf = async (query: string) =>
      (await standings(ROMME, query)).headers.get('ETag');

    expect(await tagOf('scope=all')).toBe(sum);
    expect(await tagOf('scope=all&measure=sum')).toBe(sum);
    expect(await tagOf('scope=all&measure=average')).toBe(average);
    expect(await tagOf(`${DAY}&measure=average`)).toBe(
      `"${revision ?? ''}-${START_MS}-1794772800000-average"`,
    );
    expect(
      (await standings(ROMME, 'scope=all&measure=average', average)).status,
    ).toBe(304);
    expect(
      (await standings(ROMME, 'scope=all&measure=average', sum)).status,
    ).toBe(200);
    expect(
      (await standings(ROMME, 'scope=all&measure=sum', average)).status,
    ).toBe(200);
  });

  it('lists a person whose results all wait unranked under either measure, without an average', async () => {
    installFixtureBackend(
      withGameRows(
        [],
        [
          [1, 0, AT_20],
          [2, 4, AT_20, 1, true],
          [2, 6, AT_20, 1, true],
        ],
      ),
    );

    for (const measure of ['sum', 'average']) {
      const { rows: ranks, unranked } = await ranked(
        ROMME,
        `scope=all&measure=${measure}`,
      );

      expect([ranks, unranked]).toEqual([
        [pointsRow(1, 'Anna', 0, 0, 1)],
        [{ personId: 2, name: 'Ben', pendingCount: 2 }],
      ]);
    }
  });
});

describe('the fixture backend’s sessions a game was played', () => {
  const realFetch = globalThis.fetch;
  afterEach(() => {
    globalThis.fetch = realFetch;
  });

  /** November 2026 in Berlin: 2026-10-31T23:00Z to 2026-11-30T23:00Z. */
  const NOVEMBER =
    'from=2026-11-01T00:00:00%2B01:00&to=2026-12-01T00:00:00%2B01:00';

  /** A span `[from, to)` in UTC, from minutes. */
  const span = (from: string, to: string) => ({
    from: `${from}:00.000Z`,
    to: `${to}:00.000Z`,
  });

  async function days(
    game: number,
    selection = 'scope=all',
    ifNoneMatch?: string,
  ) {
    return get(
      `/api/games/${String(game)}/standings/days?${selection}`,
      ifNoneMatch,
    );
  }

  async function spans(game: number, selection?: string) {
    const response = await days(game, selection);
    expect(response.status).toBe(200);
    return ((await response.json()) as { spans: unknown[] }).spans;
  }

  it('lists the sessions of a duel’s verified matches in every run, once for both players', async () => {
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

    expect(await spans(1)).toEqual([
      span('2026-11-14T20:00', '2026-11-14T20:15'),
      span('2026-11-15T20:00', '2026-11-15T20:15'),
    ]);
  });

  it('lists the sessions of a points game’s verified results in every run', async () => {
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

    expect(await spans(2)).toEqual([
      span('2026-11-14T20:00', '2026-11-14T21:00'),
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

    for (const selection of ['scope=all', NOVEMBER]) {
      expect(await spans(1, selection)).toEqual([
        span('2026-11-14T20:00', '2026-11-14T20:15'),
      ]);
      expect(await spans(2, selection)).toEqual([
        span('2026-11-14T20:15', '2026-11-14T20:30'),
      ]);
    }
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

    const quarter = [span('2026-11-14T23:45', '2026-11-15T00:00')];
    expect(await spans(1)).toEqual(quarter);
    expect(await spans(2)).toEqual(quarter);
  });

  it('answers many rows in consecutive quarter hours as one span', async () => {
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

    const quarters = [span('2026-11-14T20:00', '2026-11-14T20:30')];
    expect(await spans(1)).toEqual(quarters);
    expect(await spans(2)).toEqual(quarters);
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

  it('lists in a window the sessions of its rows only, of any run', async () => {
    installFixtureBackend(
      withGameRows(
        [
          [1, 2, 'first', '2026-10-31T22:50:00.000Z', 1],
          [1, 2, 'first', '2026-10-31T23:05:00.000Z', 2],
          [1, 2, 'first', '2026-11-30T23:00:00.000Z', 2],
        ],
        [
          [1, 5, '2026-11-30T22:59:59.999Z', 1],
          [1, 5, '2026-11-30T23:00:00.000Z', 2],
        ],
        { run: 2 },
      ),
    );

    expect(await spans(1, NOVEMBER)).toEqual([
      span('2026-10-31T23:00', '2026-10-31T23:15'),
    ]);
    expect(await spans(2, NOVEMBER)).toEqual([
      span('2026-11-30T22:45', '2026-11-30T23:00'),
    ]);
    expect(await spans(1)).toEqual([
      span('2026-10-31T22:45', '2026-10-31T23:15'),
      span('2026-11-30T23:00', '2026-11-30T23:15'),
    ]);
  });

  it('tags the answer with the data revision and the selection and answers 304 while it holds; a verification and a delete change it', async () => {
    const fixtures = withGameRows([
      [1, 2, 'first', AT_20],
      [1, 3, 'first', AT_21, 1, true],
    ]);
    const waiting = fixtures.matches[1];
    if (waiting) waiting.accountId = 2;
    installFixtureBackend(fixtures);
    const first = await days(1);
    const tag = first.headers.get('ETag') ?? '';

    expect(tag).toMatch(/^"\d+-all"$/);
    expect((await days(1, NOVEMBER)).headers.get('ETag')).toMatch(
      /^"\d+-1793487600000-1796079600000"$/,
    );
    expect((await days(1, 'scope=all', tag)).status).toBe(304);
    expect((await days(1, NOVEMBER, tag)).status).toBe(200);
    await fetch(`/api/matches/${waiting?.id ?? ''}/verification`, {
      method: 'PUT',
      body: '{}',
    });
    const verified = await days(1, 'scope=all', tag);
    expect(verified.status).toBe(200);
    await fetch(`/api/matches/${fixtures.matches[0]?.id ?? ''}`, {
      method: 'DELETE',
    });
    expect(
      (await days(1, 'scope=all', verified.headers.get('ETag') ?? undefined))
        .status,
    ).toBe(200);
  });
});

describe('the sample’s games over all time', () => {
  const realFetch = globalThis.fetch;
  afterEach(() => {
    globalThis.fetch = realFetch;
  });

  const leaders = ({ rows }: Standings) =>
    rows.map((row) =>
      'sum' in row
        ? `${row.name} ${String(row.sum)} (${String(row.results)})`
        : row.name,
    );

  it('ranks earlier runs under Gesamt, so it differs from the current run', async () => {
    installFixtureBackend(sampleEvening());

    expect(leaders(await ranked(1))).toEqual([
      'Daniel -11 (2)',
      'Anna 15 (2)',
      'Ben 39 (2)',
      'Mara 79 (2)',
    ]);
    expect(leaders(await ranked(1, 'scope=all'))).toEqual([
      'Tom 12 (4)',
      'Anna 71 (5)',
      'Daniel 84 (6)',
      'Ben 112 (6)',
      'Mara 210 (6)',
    ]);
    expect(leaders(await ranked(2))[0]).toBe('Anna');
    expect(leaders(await ranked(2, 'scope=all'))[0]).toBe('Tom');
  });

  it('has Rommé played on six days, tonight and five earlier evenings', async () => {
    installFixtureBackend(sampleEvening());
    const response = await get('/api/games/1/standings/days?scope=all');
    const { spans } = (await response.json()) as {
      spans: { from: string; to: string }[];
    };

    const days = localDaysOf(spans);

    expect(days).toHaveLength(6);
    expect(days.at(-1)).toEqual(calendarDateOf(new Date()));
  });
});
