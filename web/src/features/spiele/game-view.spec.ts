import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type {
  DuelRow,
  Game,
  MatchItem,
  PointsRow,
  ResultItem,
  Standings,
} from '../../core/api-client';
import {
  contextLine,
  currentRun,
  gameAsRanked,
  gameHistoryPath,
  type GameStanding,
  gameStandings,
  historyContextLine,
  leaderLine,
  matchRows,
  outcomeText,
  recordPath,
  resultRows,
  resultText,
  ruleLine,
  settingLine,
  sinceLabel,
  unrankedGameStandings,
} from './game-view';

const game = (
  kind: Game['kind'],
  {
    drawsAllowed = true,
    lowerWins = false,
    startedAt = '2026-09-15T10:00:00Z',
  } = {},
): Game => ({
  id: 1,
  name: 'Schach',
  kind,
  drawsAllowed,
  lowerWins,
  startedAt,
});

describe('a game in words', () => {
  const zone = process.env.TZ;
  const now = new Date('2026-11-15T22:45:00Z');

  beforeEach(() => {
    process.env.TZ = 'Europe/Berlin';
  });
  afterEach(() => {
    process.env.TZ = zone;
  });

  it('dates an earlier start by its local day, without the year', () => {
    expect(sinceLabel('2026-09-15T10:00:00Z', now)).toBe('seit 15.09.');
    // 23:59 in Berlin, a minute before local midnight: still yesterday.
    expect(sinceLabel('2026-11-14T22:59:00Z', now)).toBe('seit 14.11.');
  });

  it('gives a start since local midnight as today with its time', () => {
    expect(sinceLabel('2026-11-15T18:30:00Z', now)).toBe('seit heute, 19:30');
    expect(sinceLabel('2026-11-14T23:00:00Z', now)).toBe('seit heute, 00:00');
  });

  it('puts the kind before the start in the context line', () => {
    expect(contextLine(game('duel'), now)).toBe('Duell · seit 15.09.');
    expect(contextLine(game('points'), now)).toBe('Punktespiel · seit 15.09.');
  });

  it.each([
    [{ kind: 'run' } as const, 'Duell · seit 15.09.'],
    [{ kind: 'all' } as const, 'Duell · Gesamt'],
    [
      { kind: 'day', date: { year: 2026, month: 11, day: 15 } } as const,
      'Duell · Heute',
    ],
    [
      { kind: 'day', date: { year: 2026, month: 11, day: 14 } } as const,
      'Duell · Samstag, 14.11.2026',
    ],
    [
      { kind: 'week', date: { year: 2026, month: 11, day: 9 } } as const,
      'Duell · KW 46 · 09.11.–15.11.',
    ],
  ])(
    'puts the kind before the period %o in the context line, the start under Aktuell',
    (period, line) => {
      expect(contextLine(game('duel'), now, period)).toBe(line);
    },
  );

  it.each([
    [game('duel'), 'Remis möglich'],
    [game('duel', { drawsAllowed: false }), 'Kein Remis'],
    [game('points'), 'Höchste Summe gewinnt'],
    [game('points', { lowerWins: true }), 'Niedrigste Summe gewinnt'],
  ])('states the rule of %o as %s', (subject, rule) => {
    expect(ruleLine(subject)).toBe(rule);
  });

  it('takes the run’s start and a points game’s direction from its ranking', () => {
    const restarted = '2026-11-15T21:00:00.000Z';

    expect(
      gameAsRanked(game('points'), {
        kind: 'points',
        startedAt: restarted,
        lowerWins: true,
        rows: [],
        unranked: [],
      }),
    ).toEqual(game('points', { startedAt: restarted, lowerWins: true }));
    expect(
      gameAsRanked(game('duel', { drawsAllowed: false }), {
        kind: 'duel',
        startedAt: restarted,
        rows: [],
        unranked: [],
      }),
    ).toEqual(game('duel', { drawsAllowed: false, startedAt: restarted }));
    expect(gameAsRanked(game('duel'), undefined)).toEqual(game('duel'));
  });

  it('counts a ranking read before the game’s known start as the new run, still empty', () => {
    const restarted = '2026-11-15T21:00:00.000Z';
    const older = {
      kind: 'duel' as const,
      startedAt: '2026-09-15T10:00:00Z',
      rows: [
        {
          personId: 1,
          name: 'Anna',
          points: 1,
          wins: 1,
          draws: 0,
          losses: 0,
          played: 1,
          pendingCount: 0,
        },
      ],
      unranked: [],
    };
    const ownRestart = game('duel', { startedAt: restarted });

    expect(currentRun(ownRestart, older)).toEqual({
      kind: 'duel',
      startedAt: restarted,
      rows: [],
      unranked: [],
    });
    expect(gameAsRanked(ownRestart, currentRun(ownRestart, older))).toEqual(
      ownRestart,
    );
    // A restart elsewhere: the ranking is newer than the game, and it wins.
    const remote = { ...older, startedAt: restarted };
    expect(currentRun(game('duel'), remote)).toBe(remote);
    expect(currentRun(game('duel'), undefined)).toBeUndefined();
  });

  it('counts a points ranking read before the game’s known start as the new run, with no one waiting', () => {
    const restarted = '2026-11-15T21:00:00.000Z';
    const older = {
      kind: 'points' as const,
      startedAt: '2026-09-15T10:00:00Z',
      lowerWins: false,
      rows: [pointsRow(1, 'Anna', 20, 1)],
      unranked: [{ personId: 2, name: 'Ben', pendingCount: 1 }],
    };

    expect(currentRun(game('points', { startedAt: restarted }), older)).toEqual(
      {
        kind: 'points',
        startedAt: restarted,
        lowerWins: false,
        rows: [],
        unranked: [],
      },
    );
  });

  it('keeps the setting line of Verwalten → Spiele', () => {
    expect(settingLine(game('duel', { drawsAllowed: false }))).toBe(
      'Duell · kein Remis',
    );
  });
});

const STARTED = '2026-09-15T10:00:00Z';
const duelRow = (
  personId: number,
  name: string,
  [wins, draws, losses]: [number, number, number],
): DuelRow => ({
  personId,
  name,
  points: wins + draws / 2,
  wins,
  draws,
  losses,
  played: wins + draws + losses,
  pendingCount: 0,
});
const pointsRow = (
  personId: number,
  name: string,
  sum: number,
  results: number,
  pendingCount = 0,
): PointsRow => ({ personId, name, sum, results, pendingCount });

describe('a game’s ranking in words', () => {
  it('ranks a duel’s places in the API’s order with points in German format and the record', () => {
    const places = gameStandings({
      kind: 'duel',
      startedAt: STARTED,
      rows: [duelRow(1, 'Anna', [3, 1, 1]), duelRow(2, 'Ben', [1, 0, 0])],
      unranked: [],
    });

    expect(places).toEqual([
      {
        personId: 1,
        rank: 1,
        name: 'Anna',
        value: '3,5',
        valueText: '3,5 Punkte',
        details: '5 Partien · 3 S · 1 R · 1 N',
        short: '5 Partien',
        label: 'Platz 1, Anna, 3,5 Punkte, 5 Partien · 3 S · 1 R · 1 N',
      },
      {
        personId: 2,
        rank: 2,
        name: 'Ben',
        value: '1',
        valueText: '1 Punkt',
        details: '1 Partie · 1 S · 0 R · 0 N',
        short: '1 Partie',
        label: 'Platz 2, Ben, 1 Punkt, 1 Partie · 1 S · 0 R · 0 N',
      },
    ]);
  });

  it('adds +n offen to a place while matches of the run wait, and lists who only waits without a rank', () => {
    const standings = {
      kind: 'duel' as const,
      startedAt: STARTED,
      rows: [
        { ...duelRow(1, 'Anna', [1, 0, 0]), pendingCount: 2 },
        duelRow(2, 'Ben', [0, 0, 1]),
      ],
      unranked: [{ personId: 3, name: 'Jule', pendingCount: 1 }],
    };

    expect(
      gameStandings(standings).map(({ pending, label }) => [pending, label]),
    ).toEqual([
      [
        '+2 offen',
        'Platz 1, Anna, 1 Punkt, 1 Partie · 1 S · 0 R · 0 N, +2 offen',
      ],
      [undefined, 'Platz 2, Ben, 0 Punkte, 1 Partie · 0 S · 0 R · 1 N'],
    ]);
    expect(unrankedGameStandings(standings)).toEqual([
      {
        personId: 3,
        name: 'Jule',
        pending: '+1 offen',
        label: 'Jule, +1 offen',
      },
    ]);
    expect(leaderLine({ ...standings, rows: [] })).toBe(
      'noch keine Ergebnisse',
    );
  });

  it('adds +n offen to a points place while results of the run wait, and lists who only waits without a rank', () => {
    const standings = {
      kind: 'points' as const,
      startedAt: STARTED,
      lowerWins: true,
      rows: [pointsRow(1, 'Anna', -3, 1, 1), pointsRow(2, 'Ben', 12, 1)],
      unranked: [{ personId: 3, name: 'Jule', pendingCount: 2 }],
    };

    expect(
      gameStandings(standings).map(({ pending, label }) => [pending, label]),
    ).toEqual([
      ['+1 offen', 'Platz 1, Anna, −3 Punkte, 1 Ergebnis, +1 offen'],
      [undefined, 'Platz 2, Ben, 12 Punkte, 1 Ergebnis'],
    ]);
    expect(unrankedGameStandings(standings)).toEqual([
      {
        personId: 3,
        name: 'Jule',
        pending: '+2 offen',
        label: 'Jule, +2 offen',
      },
    ]);
    expect(leaderLine({ ...standings, rows: [] })).toBe(
      'noch keine Ergebnisse',
    );
  });

  it('gives tied places consecutive ranks, as the drink Rangliste does', () => {
    const places = gameStandings({
      kind: 'duel',
      startedAt: STARTED,
      rows: [duelRow(1, 'Anna', [1, 0, 0]), duelRow(2, 'Ben', [1, 0, 0])],
      unranked: [],
    });

    expect(places.map(({ rank }) => rank)).toEqual([1, 2]);
  });

  it('shows a points game’s sums with a real minus sign and the result count, in the API’s order', () => {
    const places = gameStandings({
      kind: 'points',
      startedAt: STARTED,
      lowerWins: true,
      rows: [
        pointsRow(3, 'Daniel', -11, 2),
        pointsRow(1, 'Anna', 1, 1),
        pointsRow(2, 'Ben', 39, 2),
      ],
      unranked: [],
    });

    expect(
      places.map(({ rank, name, value, valueText, details }) => [
        rank,
        name,
        value,
        valueText,
        details,
      ]),
    ).toEqual([
      [1, 'Daniel', '−11', '−11 Punkte', '2 Ergebnisse'],
      [2, 'Anna', '1', '1 Punkt', '1 Ergebnis'],
      [3, 'Ben', '39', '39 Punkte', '2 Ergebnisse'],
    ]);
    expect(places[0]?.label).toBe('Platz 1, Daniel, −11 Punkte, 2 Ergebnisse');
    expect(places[0]?.short).toBe('2 Ergebnisse');
  });

  describe('of a points game’s week or all time by a measure', () => {
    /** Rows in the API's order for the average, which is not the sums' order. */
    const byAverage: Standings = {
      kind: 'points',
      startedAt: STARTED,
      lowerWins: true,
      rows: [
        { ...pointsRow(3, 'Daniel', -1, 4), average: -0.3 },
        { ...pointsRow(2, 'Ben', 172, 14), average: 12.3 },
        { ...pointsRow(1, 'Anna', 12, 1, 1), average: 12 },
      ],
      unranked: [],
    };
    const shown = (places: GameStanding[]) =>
      places.map(({ name, value, valueText, details, label }) => [
        name,
        value,
        valueText,
        details,
        label,
      ]);

    it('shows the sum as the value and the average in the details', () => {
      expect(shown(gameStandings(byAverage, 'sum'))).toEqual([
        [
          'Daniel',
          '−1',
          '−1 Punkt',
          '4 Ergebnisse · Ø −0,3',
          'Platz 1, Daniel, −1 Punkt, 4 Ergebnisse · Ø −0,3',
        ],
        [
          'Ben',
          '172',
          '172 Punkte',
          '14 Ergebnisse · Ø 12,3',
          'Platz 2, Ben, 172 Punkte, 14 Ergebnisse · Ø 12,3',
        ],
        [
          'Anna',
          '12',
          '12 Punkte',
          '1 Ergebnis · Ø 12',
          'Platz 3, Anna, 12 Punkte, 1 Ergebnis · Ø 12, +1 offen',
        ],
      ]);
    });

    it('shows the average as the value and the sum in the details, in the API’s order', () => {
      expect(shown(gameStandings(byAverage, 'average'))).toEqual([
        [
          'Daniel',
          '−0,3',
          'Ø −0,3 Punkte',
          '4 Ergebnisse · Summe −1',
          'Platz 1, Daniel, Ø −0,3 Punkte, 4 Ergebnisse · Summe −1',
        ],
        [
          'Ben',
          '12,3',
          'Ø 12,3 Punkte',
          '14 Ergebnisse · Summe 172',
          'Platz 2, Ben, Ø 12,3 Punkte, 14 Ergebnisse · Summe 172',
        ],
        [
          'Anna',
          '12',
          'Ø 12 Punkte',
          '1 Ergebnis · Summe 12',
          'Platz 3, Anna, Ø 12 Punkte, 1 Ergebnis · Summe 12, +1 offen',
        ],
      ]);
    });

    it('takes a row without its average as a broken answer, not as 0', () => {
      const broken: Standings = {
        ...byAverage,
        rows: [pointsRow(1, 'Anna', 12, 1)],
      };

      expect(() => gameStandings(broken, 'average')).toThrow(/average/);
      expect(() => gameStandings(broken, 'sum')).toThrow(/average/);
    });
  });

  it('names the leader for the Spiele list, or that nothing was recorded yet', () => {
    expect(
      leaderLine({
        kind: 'duel',
        startedAt: STARTED,
        rows: [duelRow(1, 'Anna', [4, 0, 1]), duelRow(2, 'Ben', [1, 0, 4])],
        unranked: [],
      }),
    ).toBe('1. Anna · 4 Punkte');
    expect(
      leaderLine({
        kind: 'points',
        startedAt: STARTED,
        lowerWins: false,
        rows: [pointsRow(4, 'Mara', -20, 1)],
        unranked: [],
      }),
    ).toBe('1. Mara · −20 Punkte');
    expect(
      leaderLine({ kind: 'duel', startedAt: STARTED, rows: [], unranked: [] }),
    ).toBe('noch keine Ergebnisse');
  });

  it('puts a match’s outcome in words', () => {
    expect(outcomeText('first', 'Anna', 'Ben')).toBe('Anna gewinnt');
    expect(outcomeText('second', 'Anna', 'Ben')).toBe('Ben gewinnt');
    expect(outcomeText('draw', 'Anna', 'Ben')).toBe('Remis');
  });

  it('puts a result in words with a real minus sign and its unit', () => {
    expect(resultText('Daniel', -20)).toBe('Daniel · −20 Punkte');
    expect(resultText('Daniel', 1)).toBe('Daniel · 1 Punkt');
    expect(resultText('Daniel', -1)).toBe('Daniel · −1 Punkt');
    expect(resultText('Daniel', 0)).toBe('Daniel · 0 Punkte');
  });

  it('starts a duel’s recording at Wer spielt? and a points game’s at Für wen?', () => {
    expect(recordPath(game('duel'))).toBe('/spiele/1/partie');
    expect(recordPath(game('points'))).toBe('/spiele/1/ergebnis');
  });
});

describe('a game’s Verlauf in words', () => {
  const zone = process.env.TZ;

  beforeEach(() => {
    process.env.TZ = 'Europe/Berlin';
  });
  afterEach(() => {
    process.env.TZ = zone;
  });

  const anna = { id: 1, name: 'Anna' };
  const ben = { id: 2, name: 'Ben' };

  it('opens at the game’s Verlauf, titled with the game and its start', () => {
    expect(gameHistoryPath(2)).toBe('/spiele/2/verlauf');
    expect(
      historyContextLine(game('duel'), new Date('2026-11-15T22:45:00Z')),
    ).toBe('Schach · seit 15.09.');
  });

  it('shows a match as its pairing with outcome, local date and time and account', () => {
    const items: MatchItem[] = [
      {
        id: 'm2',
        first: anna,
        second: ben,
        outcome: 'first',
        createdAt: '2026-11-15T20:00:00.000Z',
        accountName: 'anna',
        pending: false,
      },
      {
        id: 'm1',
        first: ben,
        second: anna,
        outcome: 'draw',
        createdAt: '2026-11-08T20:30:00.000Z',
        accountName: 'ben',
        pending: false,
      },
    ];

    expect(matchRows(items)).toEqual([
      {
        id: 'm2',
        title: 'Anna – Ben',
        details: 'Anna gewinnt · 15.11., 21:00 · anna',
        removeLabel: 'Anna – Ben vom 15.11. löschen',
        removeBody: 'Anna – Ben · Anna gewinnt am 15.11. um 21:00',
      },
      {
        id: 'm1',
        title: 'Ben – Anna',
        details: 'Remis · 08.11., 21:30 · ben',
        removeLabel: 'Ben – Anna vom 08.11. löschen',
        removeBody: 'Ben – Anna · Remis am 08.11. um 21:30',
      },
    ]);
  });

  it('marks a match that waits for verification offen', () => {
    const [waiting, counting] = matchRows([
      {
        id: 'm2',
        first: anna,
        second: ben,
        outcome: 'first',
        createdAt: '2026-11-15T20:00:00.000Z',
        accountName: 'anna',
        pending: true,
      },
      {
        id: 'm1',
        first: anna,
        second: ben,
        outcome: 'draw',
        createdAt: '2026-11-15T19:00:00.000Z',
        accountName: 'anna',
        pending: false,
      },
    ]);

    expect([waiting?.pending, counting?.pending]).toEqual(['offen', undefined]);
  });

  it('marks a result that waits for verification offen', () => {
    const [waiting, counting] = resultRows([
      {
        id: 'r2',
        person: anna,
        points: -4,
        createdAt: '2026-11-15T20:00:00.000Z',
        accountName: 'anna',
        pending: true,
      },
      {
        id: 'r1',
        person: ben,
        points: 9,
        createdAt: '2026-11-15T19:00:00.000Z',
        accountName: 'anna',
        pending: false,
      },
    ]);

    expect([waiting?.pending, counting?.pending]).toEqual(['offen', undefined]);
  });

  it('names a deleted side “gelöschte Person” and a deleted account “gelöschtes Konto”', () => {
    const [row] = matchRows([
      {
        id: 'm1',
        first: null,
        second: ben,
        outcome: 'first',
        createdAt: '2026-11-15T20:00:00.000Z',
        accountName: null,
        pending: false,
      },
    ]);

    expect(row?.title).toBe('gelöschte Person – Ben');
    expect(row?.details).toBe(
      'gelöschte Person gewinnt · 15.11., 21:00 · gelöschtes Konto',
    );
  });

  it('shows a result as person and points with a real minus sign, local date and time and account', () => {
    const items: ResultItem[] = [
      {
        id: 'r2',
        person: { id: 3, name: 'Daniel' },
        points: -20,
        createdAt: '2026-11-15T21:12:00.000Z',
        accountName: 'anna',
        pending: false,
      },
      {
        id: 'r1',
        person: anna,
        points: 1,
        createdAt: '2026-11-15T20:05:00.000Z',
        accountName: null,
        pending: false,
      },
    ];

    expect(resultRows(items)).toEqual([
      {
        id: 'r2',
        title: 'Daniel · −20 Punkte',
        details: '15.11., 22:12 · anna',
        removeLabel: 'Daniel · −20 Punkte vom 15.11. löschen',
        removeBody: 'Daniel · −20 Punkte am 15.11. um 22:12',
      },
      {
        id: 'r1',
        title: 'Anna · 1 Punkt',
        details: '15.11., 21:05 · gelöschtes Konto',
        removeLabel: 'Anna · 1 Punkt vom 15.11. löschen',
        removeBody: 'Anna · 1 Punkt am 15.11. um 21:05',
      },
    ]);
  });
});
