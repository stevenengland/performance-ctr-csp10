import type { DeepReadonly } from 'vue';
import type { Game } from '../../core/api-client';
import { startOfToday } from '../../core/day-window';
import { formatDay, formatTime } from '../../core/format';
import { messages } from '../../core/messages';

export const gamePath = (gameId: number) => `/spiele/${String(gameId)}`;

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
