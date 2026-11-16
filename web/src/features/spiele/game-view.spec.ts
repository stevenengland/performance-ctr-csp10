import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Game } from '../../core/api-client';
import { contextLine, ruleLine, settingLine, sinceLabel } from './game-view';

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
