import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type {
  DuelRow,
  Game,
  MatchItem,
  PointsRow,
  ResultItem,
} from '../../core/api-client';
import {
  contextLine,
  currentRun,
  gameAsRanked,
  gameHistoryPath,
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
      }),
    ).toEqual(game('points', { startedAt: restarted, lowerWins: true }));
    expect(
      gameAsRanked(game('duel', { drawsAllowed: false }), {
        kind: 'duel',
        startedAt: restarted,
        rows: [],
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
        },
      ],
    };
    const ownRestart = game('duel', { startedAt: restarted });

    expect(currentRun(ownRestart, older)).toEqual({
      kind: 'duel',
      startedAt: restarted,
      rows: [],
    });
    expect(gameAsRanked(ownRestart, currentRun(ownRestart, older))).toEqual(
      ownRestart,
    );
    // A restart elsewhere: the ranking is newer than the game, and it wins.
    const remote = { ...older, startedAt: restarted };
    expect(currentRun(game('duel'), remote)).toBe(remote);
    expect(currentRun(game('duel'), undefined)).toBeUndefined();
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
});
const pointsRow = (
  personId: number,
  name: string,
  sum: number,
  results: number,
): PointsRow => ({ personId, name, sum, results });

describe('a game’s ranking in words', () => {
  it('ranks a duel’s places in the API’s order with points in German format and the record', () => {
    const places = gameStandings({
      kind: 'duel',
      startedAt: STARTED,
      rows: [duelRow(1, 'Anna', [3, 1, 1]), duelRow(2, 'Ben', [1, 0, 0])],
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

  it('gives tied places consecutive ranks, as the drink Rangliste does', () => {
    const places = gameStandings({
      kind: 'duel',
      startedAt: STARTED,
      rows: [duelRow(1, 'Anna', [1, 0, 0]), duelRow(2, 'Ben', [1, 0, 0])],
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

  it('names the leader for the Spiele list, or that nothing was recorded yet', () => {
    expect(
      leaderLine({
        kind: 'duel',
        startedAt: STARTED,
        rows: [duelRow(1, 'Anna', [4, 0, 1]), duelRow(2, 'Ben', [1, 0, 4])],
      }),
    ).toBe('1. Anna · 4 Punkte');
    expect(
      leaderLine({
        kind: 'points',
        startedAt: STARTED,
        lowerWins: false,
        rows: [pointsRow(4, 'Mara', -20, 1)],
      }),
    ).toBe('1. Mara · −20 Punkte');
    expect(leaderLine({ kind: 'duel', startedAt: STARTED, rows: [] })).toBe(
      'noch keine Ergebnisse',
    );
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
      },
      {
        id: 'm1',
        first: ben,
        second: anna,
        outcome: 'draw',
        createdAt: '2026-11-08T20:30:00.000Z',
        accountName: 'ben',
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

  it('names a deleted side “gelöschte Person” and a deleted account “gelöschtes Konto”', () => {
    const [row] = matchRows([
      {
        id: 'm1',
        first: null,
        second: ben,
        outcome: 'first',
        createdAt: '2026-11-15T20:00:00.000Z',
        accountName: null,
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
      },
      {
        id: 'r1',
        person: anna,
        points: 1,
        createdAt: '2026-11-15T20:05:00.000Z',
        accountName: null,
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
