import type { DeepReadonly } from 'vue';
import type { Game, Outcome, Standings } from '../../core/api-client';
import { startOfToday } from '../../core/day-window';
import {
  formatDay,
  formatNumber,
  formatSigned,
  formatTime,
} from '../../core/format';
import { messages } from '../../core/messages';

export const gamePath = (gameId: number) => `/spiele/${String(gameId)}`;
/** The duel recording flow's first step, `Wer spielt?`. */
export const matchPath = (gameId: number) => `${gamePath(gameId)}/partie`;

function kindLabel(kind: Game['kind']): string {
  return kind === 'duel' ? messages.spiele.duel : messages.spiele.points;
}

/** `seit 15.09.`, or `seit heute, 19:30` when the game was (re)started today. */
export function sinceLabel(startedAt: string, now: Date = new Date()): string {
  const start = new Date(startedAt);
  return start >= startOfToday(now)
    ? messages.spiele.sinceToday(formatTime(start))
    : messages.spiele.since(formatDay(start));
}

/** The game's context line in the list and the top bar: `Duell · seit 15.09.`. */
export function contextLine(game: DeepReadonly<Game>): string {
  return messages.spiele.context(
    kindLabel(game.kind),
    sinceLabel(game.startedAt),
  );
}

/** The game's setting in Verwalten → Spiele: `Duell · Remis möglich`. */
export function settingLine(game: DeepReadonly<Game>): string {
  const setting =
    game.kind === 'duel'
      ? game.drawsAllowed
        ? messages.spiele.drawsAllowed
        : messages.spiele.noDraws
      : game.lowerWins
        ? messages.spiele.lowerWins
        : messages.spiele.higherWins;
  return messages.spiele.setting(kindLabel(game.kind), setting);
}

/** The rule that decides the ranking, shown above it: `Remis möglich`, `Niedrigste Summe gewinnt`. */
export function ruleLine(game: DeepReadonly<Game>): string {
  if (game.kind === 'duel') {
    return game.drawsAllowed
      ? messages.spiele.drawsAllowed
      : messages.spiele.noDrawsRule;
  }
  return game.lowerWins
    ? messages.spiele.lowerWins
    : messages.spiele.higherWins;
}

/** One place of a game's ranking, formatted for display. */
export interface GameStanding {
  personId: number;
  /** The position: tied places get consecutive ranks, as in the drink Rangliste. */
  rank: number;
  name: string;
  /** The big number: duel points `3,5`, or a points sum `−20`. */
  value: string;
  /** With its unit: `3,5 Punkte`. */
  valueText: string;
  /** `5 Partien · 3 S · 1 R · 1 N`, or `3 Ergebnisse`. */
  details: string;
  /** The person tile's line in a recording flow: `5 Partien`, or `3 Ergebnisse`. */
  short: string;
  label: string;
}

function place(
  index: number,
  { personId, name }: { personId: number; name: string },
  value: string,
  points: number,
  details: string,
  short: string,
): GameStanding {
  const valueText = messages.spiele.gamePoints(value, points);
  return {
    personId,
    rank: index + 1,
    name,
    value,
    valueText,
    details,
    short,
    label: messages.spiele.place(index + 1, name, valueText, details),
  };
}

/** The API's ranking as a game's page shows it, in the API's order. */
export function gameStandings(
  standings: DeepReadonly<Standings>,
): GameStanding[] {
  if (standings.kind === 'duel') {
    return standings.rows.map((row, index) =>
      place(
        index,
        row,
        formatNumber(row.points),
        row.points,
        messages.spiele.record(row.played, row.wins, row.draws, row.losses),
        messages.spiele.played(row.played),
      ),
    );
  }
  return standings.rows.map((row, index) => {
    const count = messages.spiele.resultCount(row.results);
    return place(index, row, formatSigned(row.sum), row.sum, count, count);
  });
}

/** The game's leader in the Spiele list: `1. Anna · 4 Punkte`, or `noch keine Ergebnisse`. */
export function leaderLine(standings: DeepReadonly<Standings>): string {
  const [leader] = gameStandings(standings);
  return leader
    ? messages.spiele.leader(leader.name, leader.valueText)
    : messages.spiele.noResults;
}

/** A match's outcome in words: `Anna gewinnt`, `Remis`. */
export function outcomeText(
  outcome: Outcome,
  first: string,
  second: string,
): string {
  if (outcome === 'draw') return messages.spiele.draw;
  return messages.spiele.wins(outcome === 'first' ? first : second);
}
