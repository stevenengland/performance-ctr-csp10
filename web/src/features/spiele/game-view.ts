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
export const gameHistoryPath = (gameId: number) =>
  `${gamePath(gameId)}/verlauf`;
/** The first step of a game's recording flow: `/partie` for duels, `/ergebnis` for points. */
export const recordPath = (game: Readonly<Pick<Game, 'id' | 'kind'>>) =>
  `${gamePath(game.id)}/${game.kind === 'duel' ? 'partie' : 'ergebnis'}`;

export function kindLabel(kind: Game['kind']): string {
  return kind === 'duel' ? messages.spiele.duel : messages.spiele.points;
}

/** `seit 15.09.`, or `seit heute, 19:30` when the game was (re)started today. */
export function sinceLabel(startedAt: string, now: Date = new Date()): string {
  const start = new Date(startedAt);
  return start >= startOfToday(now)
    ? messages.spiele.sinceToday(formatTime(start))
    : messages.spiele.since(formatDay(start));
}

/** The game's context line in the top bar and the list: `Duell · seit 15.09.`. */
export function contextLine(game: DeepReadonly<Game>): string {
  return messages.spiele.context(
    kindLabel(game.kind),
    sinceLabel(game.startedAt),
  );
}

/** The game's setting in Verwalten → Spiele: `Duell · Remis möglich`. */
export function settingLine(game: DeepReadonly<Game>): string {
  if (game.kind === 'duel') {
    return messages.spiele.setting(
      messages.spiele.duel,
      game.drawsAllowed
        ? messages.spiele.drawsAllowed
        : messages.spiele.noDraws,
    );
  }
  return messages.spiele.setting(
    messages.spiele.points,
    game.lowerWins ? messages.spiele.lowerWins : messages.spiele.higherWins,
  );
}

/** The rule that decides the ranking, shown above it: `Niedrigste Summe gewinnt`, `Remis möglich`. */
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
  rank: number;
  name: string;
  /** The big number: duel points `7,5`, or a points sum `−20`. */
  value: string;
  /** With its unit: `7,5 Punkte`. */
  valueText: string;
  /** `5 Partien · 3 S · 1 R · 1 N`, or `3 Ergebnisse`. */
  details: string;
  /** For a tile: `5 Partien`, or `3 Ergebnisse`. */
  short: string;
  label: string;
}

/** The API's ranking as the game page shows it; the rank is the position. */
export function gameStandings(
  standings: DeepReadonly<Standings>,
): GameStanding[] {
  if (standings.kind === 'duel') {
    return standings.rows.map((row, index) => {
      const value = formatNumber(row.points);
      const valueText = messages.spiele.duelPoints(value, row.points);
      const details = messages.spiele.record(
        row.played,
        row.wins,
        row.draws,
        row.losses,
      );
      return {
        personId: row.personId,
        rank: index + 1,
        name: row.name,
        value,
        valueText,
        details,
        short: messages.spiele.played(row.played),
        label: messages.spiele.place(index + 1, row.name, valueText, details),
      };
    });
  }
  return standings.rows.map((row, index) => {
    const value = formatSigned(row.sum);
    const valueText = messages.spiele.sumPoints(value, row.sum);
    const details = messages.spiele.resultCount(row.results);
    return {
      personId: row.personId,
      rank: index + 1,
      name: row.name,
      value,
      valueText,
      details,
      short: details,
      label: messages.spiele.place(index + 1, row.name, valueText, details),
    };
  });
}

const nameOr = (person: { name: string } | null) =>
  person?.name ?? messages.spiele.deletedPerson;

/** `Anna gewinnt`, `Remis`; a deleted winner reads `gelöschte Person gewinnt`. */
export function outcomeText(
  outcome: Outcome,
  first: string,
  second: string,
): string {
  if (outcome === 'draw') return messages.spiele.draw;
  return messages.spiele.wins(outcome === 'first' ? first : second);
}

/** One row of a game's Verlauf. */
export interface GameHistoryRow {
  id: string;
  title: string;
  details: string;
  removeLabel: string;
  removeBody: string;
}

function detailsOf(createdAt: string, accountName: string | null) {
  const at = new Date(createdAt);
  return {
    date: formatDay(at),
    time: formatTime(at),
    account: accountName ?? messages.verlauf.deletedAccount,
  };
}

export function matchRows(items: DeepReadonly<MatchItem[]>): GameHistoryRow[] {
  return items.map((item) => {
    const first = nameOr(item.first);
    const second = nameOr(item.second);
    const pairing = messages.spiele.pairing(first, second);
    const { date, time, account } = detailsOf(item.createdAt, item.accountName);
    const outcome = outcomeText(item.outcome, first, second);
    return {
      id: item.id,
      title: pairing,
      details: `${outcome} · ${messages.spiele.details(date, time, account)}`,
      removeLabel: messages.spiele.remove(`${pairing} vom ${date}`),
      removeBody: messages.spiele.removeBody(
        messages.spiele.savedMatch(pairing, outcome),
        date,
        time,
      ),
    };
  });
}

export function resultRows(
  items: DeepReadonly<ResultItem[]>,
): GameHistoryRow[] {
  return items.map((item) => {
    const points = messages.spiele.sumPoints(
      formatSigned(item.points),
      item.points,
    );
    const title = messages.spiele.savedResult(item.person.name, points);
    const { date, time, account } = detailsOf(item.createdAt, item.accountName);
    return {
      id: item.id,
      title,
      details: messages.spiele.details(date, time, account),
      removeLabel: messages.spiele.remove(`${title} vom ${date}`),
      removeBody: messages.spiele.removeBody(title, date, time),
    };
  });
}
