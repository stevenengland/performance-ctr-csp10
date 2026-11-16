import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { DuelRow, Game, PointsRow } from '../../core/api-client';
import {
  contextLine,
  gameStandings,
  leaderLine,
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
    expect(contextLine(game('duel'))).toBe('Duell · seit 15.09.');
    expect(contextLine(game('points'))).toBe('Punktespiel · seit 15.09.');
  });

  it.each([
    [game('duel'), 'Remis möglich'],
    [game('duel', { drawsAllowed: false }), 'Kein Remis'],
    [game('points'), 'Höchste Summe gewinnt'],
    [game('points', { lowerWins: true }), 'Niedrigste Summe gewinnt'],
  ])('states the rule of %o as %s', (subject, rule) => {
    expect(ruleLine(subject)).toBe(rule);
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
        label: 'Platz 1, Anna, 3,5 Punkte, 5 Partien · 3 S · 1 R · 1 N',
      },
      {
        personId: 2,
        rank: 2,
        name: 'Ben',
        value: '1',
        valueText: '1 Punkt',
        details: '1 Partie · 1 S · 0 R · 0 N',
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
});
