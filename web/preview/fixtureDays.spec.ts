import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  type CalendarDate,
  calendarDateOf,
  isoDate,
  localDaysOf,
} from '../src/core/period';
import { installFixtureBackend } from './fixtureBackend';
import { sessionsOf } from './fixtureDays';
import { sampleEvening } from './fixtures';
import { withEntries } from './fixtureTesting';

/*
The fixture backend's days with drinks that count, at `GET /api/scoreboard/days`:
these cases are the API integration tests' (`ScoreboardDaysTest` and the days
cases of `IntervalQueryTest`), so the preview and the API cannot drift apart
unnoticed. Persons: 1 Anna, 2 Ben, 3 Daniel; drinks: 1 Aperol, 2 Bier.
*/

/** November 2026 in Berlin: 2026-10-31T23:00Z to 2026-11-30T23:00Z. */
const NOVEMBER =
  'from=2026-11-01T00:00:00%2B01:00&to=2026-12-01T00:00:00%2B01:00';
const INSTANT = 'Zeitpunkt nach ISO 8601 mit Zeitzone.';

/** A span `[from, to)` in UTC, from minutes: `span('2026-11-14T20:00', '2026-11-14T20:15')`. */
const span = (from: string, to: string) => ({
  from: `${from}:00.000Z`,
  to: `${to}:00.000Z`,
});

async function days(selection = 'scope=all', ifNoneMatch?: string) {
  return fetch(
    `/api/scoreboard/days?${selection}`,
    ifNoneMatch === undefined
      ? undefined
      : { headers: { 'If-None-Match': ifNoneMatch } },
  );
}

async function spans(selection?: string) {
  const response = await days(selection);
  expect(response.status).toBe(200);
  return ((await response.json()) as { spans: unknown[] }).spans;
}

/** Verified entries of Anna's Aperol at the given instants. */
function entriesAt(...instants: string[]) {
  return withEntries(
    ...instants.map((at): [number, number, number, string] => [1, 1, 1, at]),
  );
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

  it('lists the quarter hours with a verified entry as spans and leaves pending entries out', async () => {
    installFixtureBackend(
      withEntries(
        [1, 1, 1, '2026-11-15T20:00:00.000Z'],
        [1, 2, 1, '2026-11-14T20:00:00.000Z'],
        [2, 2, 1, '2026-11-15T20:14:59.999Z'],
        [3, 1, 1, '2026-11-15T20:15:00.000Z'],
        [1, 1, 1, '2026-11-15T21:15:00.000Z', true],
      ),
    );

    expect(await spans()).toEqual([
      span('2026-11-14T20:00', '2026-11-14T20:15'),
      span('2026-11-15T20:00', '2026-11-15T20:30'),
    ]);
  });

  it('answers an evening as one span, over midnight and pauses, until a pause of 6 hours', async () => {
    installFixtureBackend(
      entriesAt(
        '2026-11-13T20:00:00.000Z',
        '2026-11-13T20:20:00.000Z',
        '2026-11-13T20:44:59.999Z',
        '2026-11-13T21:05:00.000Z',
        '2026-11-13T23:50:00.000Z',
        '2026-11-14T00:05:00.000Z',
        '2026-11-14T06:14:59.999Z',
        '2026-11-14T12:15:00.000Z',
      ),
    );

    expect(await spans()).toEqual([
      span('2026-11-13T20:00', '2026-11-14T06:15'),
      span('2026-11-14T12:15', '2026-11-14T12:30'),
    ]);
  });

  it('has no span without an entry that counts', async () => {
    installFixtureBackend(
      withEntries([1, 1, 1, '2026-11-14T20:00:00.000Z', true]),
    );

    expect(await spans()).toEqual([]);
    expect(await spans(NOVEMBER)).toEqual([]);
  });

  it('lists in a window the spans of its entries only, cut at its bounds', async () => {
    installFixtureBackend(
      entriesAt(
        '2026-10-31T22:50:00.000Z',
        '2026-10-31T23:05:00.000Z',
        '2026-11-30T22:55:00.000Z',
        '2026-11-30T23:00:00.000Z',
      ),
    );

    expect(await spans(NOVEMBER)).toEqual([
      span('2026-10-31T23:00', '2026-10-31T23:15'),
      span('2026-11-30T22:45', '2026-11-30T23:00'),
    ]);
    expect(await spans()).toEqual([
      span('2026-10-31T22:45', '2026-10-31T23:15'),
      span('2026-11-30T22:45', '2026-11-30T23:15'),
    ]);
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

    expect(await spans()).toEqual([
      span('2026-11-14T20:00', '2026-11-14T21:15'),
    ]);
    expect(await spans(NOVEMBER)).toEqual([
      span('2026-11-14T20:00', '2026-11-14T21:15'),
    ]);
    expect(
      await spans('from=2026-11-14T20:00:00Z&to=2026-11-14T21:00:00Z'),
    ).toEqual([span('2026-11-14T20:00', '2026-11-14T20:15')]);
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
    expect(await spans()).toEqual([
      span('2026-11-14T23:45', '2026-11-15T00:00'),
    ]);
  });

  it('answers many entries in consecutive quarter hours as one span', async () => {
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

    expect(await spans()).toEqual([
      span('2026-11-14T20:00', '2026-11-14T20:45'),
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
        entriesAt(
          '2026-11-15T00:00:00.000Z',
          '2026-11-14T23:59:59.999Z',
          '2026-11-15T07:00:00.000Z',
        ),
      );

      expect(await spans()).toEqual([
        span('2026-11-14T23:45', '2026-11-15T00:15'),
        span('2026-11-15T07:00', '2026-11-15T07:15'),
      ]);
      expect(
        await spans('from=2026-11-15T00:00:00Z&to=2026-11-15T01:00:00Z'),
      ).toEqual([span('2026-11-15T00:00', '2026-11-15T00:15')]);
    },
  );

  it('needs a session', async () => {
    installFixtureBackend(sampleEvening());
    await fetch('/api/session', { method: 'DELETE' });

    expect((await days()).status).toBe(401);
  });

  it('is tagged with the data revision and the selection; an unchanged tag of the same selection answers 304', async () => {
    installFixtureBackend(entriesAt('2026-11-14T20:00:00.000Z'));
    const all = (await days()).headers.get('ETag') ?? '';
    const november = (await days(NOVEMBER)).headers.get('ETag');

    const conditional = await days('scope=all', all);
    const otherSelection = await days(NOVEMBER, all);

    expect(all).toBe('"0-all"');
    expect(november).toBe('"0-1793487600000-1796079600000"');
    expect([
      conditional.status,
      await conditional.text(),
      conditional.headers.get('ETag'),
    ]).toEqual([304, '', all]);
    expect([otherSelection.status, otherSelection.headers.get('ETag')]).toEqual(
      [200, november],
    );
  });

  it('changes its tag and spans with a verification and a delete', async () => {
    const fixtures = withEntries([1, 1, 1, '2026-11-14T20:00:00.000Z', true]);
    installFixtureBackend(fixtures);
    const entry = fixtures.entries[0];
    if (!entry) throw new Error('no entry');
    entry.accountId = 2;
    const pending = await days(NOVEMBER);

    await fetch(`/api/entries/${entry.id}/verification`, {
      method: 'PUT',
      body: '{}',
    });
    const verified = await days(NOVEMBER, pending.headers.get('ETag') ?? '');
    await fetch(`/api/entries/${entry.id}`, { method: 'DELETE' });
    const deleted = await days(NOVEMBER, verified.headers.get('ETag') ?? '');

    expect(await pending.json()).toEqual({ spans: [] });
    expect(await verified.json()).toEqual({
      spans: [span('2026-11-14T20:00', '2026-11-14T20:15')],
    });
    expect(await deleted.json()).toEqual({ spans: [] });
  });

  it.each([
    ['neither start nor end', '', { from: INSTANT }],
    ['an end without a start', 'to=2026-11-14T23:00:00Z', { from: INSTANT }],
    [
      'an end before the start',
      'from=2026-11-13T23:00:00Z&to=2026-11-13T22:59:59.999Z',
      { to: 'Zeitpunkt nach from.' },
    ],
    ['an empty scope', 'scope=', { scope: 'Nur all.' }],
    [
      'all time with a start',
      'scope=all&from=2026-11-13T23:00:00Z',
      { scope: 'Nicht zusammen mit from oder to.' },
    ],
  ])(
    'rejects %s with the scoreboard’s problem, on both days reads',
    async (_case, selection, errors) => {
      installFixtureBackend(sampleEvening());

      const scoreboard = await fetch(`/api/scoreboard?${selection}`);
      const drinks = await days(selection);
      const game = await fetch(`/api/games/1/standings/days?${selection}`);

      const body = await scoreboard.text();
      expect((JSON.parse(body) as { errors: unknown }).errors).toEqual(errors);
      expect([drinks.status, await drinks.text()]).toEqual([422, body]);
      expect([game.status, await game.text()]).toEqual([422, body]);
    },
  );

  it.each([
    ['a start without an end', 'from=2026-11-01T00:00:00%2B01:00', INSTANT],
    [
      'an end a millisecond more than 35 days after the start',
      'from=2026-11-01T00:00:00%2B01:00&to=2026-12-06T00:00:00.001%2B01:00',
      'Höchstens 35 Tage nach from.',
    ],
    [
      'a year',
      'from=2026-01-01T00:00:00Z&to=2027-01-01T00:00:00Z',
      'Höchstens 35 Tage nach from.',
    ],
  ])(
    'rejects %s on both days reads, an unknown game unread',
    async (_case, window, to) => {
      installFixtureBackend(sampleEvening());

      const drinks = await days(window);
      const game = await fetch(`/api/games/9/standings/days?${window}`);

      expect(drinks.status).toBe(422);
      const body = await drinks.text();
      expect((JSON.parse(body) as { errors: unknown }).errors).toEqual({ to });
      expect([game.status, await game.text()]).toEqual([422, body]);
    },
  );

  it('takes a window of exactly 35 days', async () => {
    installFixtureBackend(sampleEvening());
    const window =
      'from=2026-11-01T00:00:00%2B01:00&to=2026-12-06T00:00:00%2B01:00';

    expect((await days(window)).status).toBe(200);
    expect((await fetch(`/api/games/1/standings/days?${window}`)).status).toBe(
      200,
    );
  });
});

/** A small deterministic generator of numbers in `[0, 1)` (a linear congruential one). */
function random(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state * 1_103_515_245 + 12_345) % 2_147_483_648;
    return state / 2_147_483_648;
  };
}

const QUARTER_HOUR_MS = 900_000;

/**
A set of quarter hours with data near `around`: a few evenings of runs of quarter
hours, some of them with gaps, some an hour or a day apart.
*/
function quarterHoursNear(around: string, next: () => number): string[] {
  const start = Math.floor(Date.parse(around) / QUARTER_HOUR_MS);
  const quarters = new Set<number>();
  let at = start - Math.floor(next() * 4 * 96);
  const evenings = 1 + Math.floor(next() * 8);
  for (let evening = 0; evening < evenings; evening += 1) {
    const length = 1 + Math.floor(next() * 40);
    const density = 0.2 + next() * 0.8;
    for (let quarter = 0; quarter < length; quarter += 1) {
      if (quarter === 0 || next() < density) quarters.add(at + quarter);
    }
    at += length + Math.floor(next() * 4 * 24 * 2);
  }
  return [...quarters].map((quarter) =>
    new Date(quarter * QUARTER_HOUR_MS).toISOString(),
  );
}

/** The local days the quarter hours fall on, as the client found them before the spans: each quarter hour's own. */
function daysOfQuarterHours(instants: readonly string[]): CalendarDate[] {
  const days = new Map<string, CalendarDate>();
  for (const instant of [...instants].sort()) {
    const day = calendarDateOf(new Date(instant));
    days.set(isoDate(day), day);
  }
  return [...days.values()];
}

describe('the local days of the sessions', () => {
  const zone = process.env.TZ;

  afterEach(() => {
    process.env.TZ = zone;
  });

  /* Days the clocks change on, a year’s end, and an ordinary day, per zone. */
  it.each([
    [
      'Europe/Berlin',
      ['2026-03-29T01:00:00Z', '2026-10-25T01:00:00Z', '2026-12-31T23:00:00Z'],
    ],
    [
      'America/New_York',
      ['2026-03-08T07:00:00Z', '2026-11-01T06:00:00Z', '2027-01-01T05:00:00Z'],
    ],
    ['Asia/Kathmandu', ['2026-11-13T18:15:00Z', '2026-12-31T18:15:00Z']],
    ['Pacific/Marquesas', ['2026-11-14T09:30:00Z', '2027-01-01T09:30:00Z']],
    ['Australia/Lord_Howe', ['2026-04-04T15:00:00Z', '2026-10-03T15:30:00Z']],
    ['America/St_Johns', ['2026-03-08T05:30:00Z', '2026-11-01T04:30:00Z']],
  ])(
    'are exactly the days of their quarter hours in %s (generated sets)',
    (timeZone, aroundInstants) => {
      process.env.TZ = timeZone;
      const next = random(70);
      for (const around of aroundInstants) {
        for (let set = 0; set < 150; set += 1) {
          const quarterHours = quarterHoursNear(around, next);

          const fromSpans = localDaysOf(sessionsOf(quarterHours));

          expect(fromSpans).toEqual(daysOfQuarterHours(quarterHours));
          expect(fromSpans[0]).toEqual(daysOfQuarterHours(quarterHours)[0]);
        }
      }
    },
  );
});
