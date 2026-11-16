import type { DeepReadonly } from 'vue';
import type {
  Game,
  MatchItem,
  Outcome,
  ResultItem,
  Standings,
} from '../../core/api-client';
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
/** The points recording flow's first step, `Für wen?`. */
export const resultPath = (gameId: number) => `${gamePath(gameId)}/ergebnis`;
/** The first step of a game's recording flow, by its kind. */
export const recordPath = (game: Readonly<Pick<Game, 'id' | 'kind'>>) =>
  game.kind === 'duel' ? matchPath(game.id) : resultPath(game.id);
/** The game's Verlauf: its matches or results since the start. */
export const gameHistoryPath = (gameId: number) =>
  `${gamePath(gameId)}/verlauf`;

function kindLabel(kind: Game['kind']): string {
  return kind === 'duel' ? messages.spiele.duel : messages.spiele.points;
}

/**
`seit 15.09.`, or `seit heute, 19:30` when the game was (re)started today. `now` is
any instant of the current day: a screen passes `useToday()`, so the label moves
on at midnight while it stays open.
*/
export function sinceLabel(startedAt: string, now: Date): string {
  const start = new Date(startedAt);
  return start >= startOfToday(now)
    ? messages.spiele.sinceToday(formatTime(start))
    : messages.spiele.since(formatDay(start));
}

/**
The game as its ranking was read: the ranking carries the run's start and, on a
points game, its direction, so a restart or rule edit on another device shows
with the ranking it changed.
*/
export function gameAsRanked(
  game: DeepReadonly<Game>,
  standings: DeepReadonly<Standings> | undefined,
): DeepReadonly<Game> {
  if (!standings) return game;
  return {
    ...game,
    startedAt: standings.startedAt,
    ...(standings.kind === 'points' ? { lowerWins: standings.lowerWins } : {}),
  };
}

/** The game's context line in the list and the top bar: `Duell · seit 15.09.`. */
export function contextLine(game: DeepReadonly<Game>, now: Date): string {
  return messages.spiele.context(
    kindLabel(game.kind),
    sinceLabel(game.startedAt, now),
  );
}

/** The Verlauf's context line in the top bar: `Schach · seit 15.09.`. */
export function historyContextLine(
  game: DeepReadonly<Game>,
  now: Date,
): string {
  return messages.spiele.historyContext(
    game.name,
    sinceLabel(game.startedAt, now),
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

/** A result in words, as the saved snackbar shows it: `Daniel · −20 Punkte`. */
export function resultText(name: string, points: number): string {
  return messages.spiele.savedResult(
    name,
    messages.spiele.gamePoints(formatSigned(points), points),
  );
}

/** One match or result of a game's Verlauf, formatted for display and deletion. */
export interface GameHistoryRow {
  id: string;
  /** `Anna – Ben`, or `Daniel · −20 Punkte`. */
  title: string;
  /** `Anna gewinnt · 15.11., 21:00 · anna`, or `15.11., 22:12 · anna`. */
  details: string;
  /** The delete button's accessible name: `Anna – Ben vom 15.11. löschen`. */
  removeLabel: string;
  /** What the confirmation dialog names: `Anna – Ben · Anna gewinnt am 15.11. um 21:00`. */
  removeBody: string;
}

function historyRow(
  id: string,
  title: string,
  what: string,
  { createdAt, accountName }: { createdAt: string; accountName: string | null },
  outcome?: string,
): GameHistoryRow {
  const at = new Date(createdAt);
  const day = formatDay(at);
  const time = formatTime(at);
  const details = messages.spiele.details(
    day,
    time,
    accountName ?? messages.verlauf.deletedAccount,
  );
  return {
    id,
    title,
    details: outcome === undefined ? details : `${outcome} · ${details}`,
    removeLabel: messages.spiele.removeRecorded(title, day),
    removeBody: messages.spiele.removeRecordedBody(what, day, time),
  };
}

/** A duel's matches as its Verlauf shows them, in the API's order (newest first). */
export function matchRows(items: DeepReadonly<MatchItem[]>): GameHistoryRow[] {
  return items.map((item) => {
    const first = item.first?.name ?? messages.spiele.deletedPerson;
    const second = item.second?.name ?? messages.spiele.deletedPerson;
    const pairing = messages.spiele.pairing(first, second);
    const outcome = outcomeText(item.outcome, first, second);
    return historyRow(
      item.id,
      pairing,
      messages.spiele.savedMatch(pairing, outcome),
      item,
      outcome,
    );
  });
}

/** A points game's results as its Verlauf shows them, in the API's order (newest first). */
export function resultRows(
  items: DeepReadonly<ResultItem[]>,
): GameHistoryRow[] {
  return items.map((item) => {
    const title = resultText(item.person.name, item.points);
    return historyRow(item.id, title, title, item);
  });
}
