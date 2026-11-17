import {
  type MaybeRefOrGetter,
  onScopeDispose,
  readonly,
  shallowRef,
  toValue,
  watch,
} from 'vue';
import * as api from './api-client';
import type { Game, GameChange, NewGame, Standings } from './api-client';
import { createDaysRead, type DaysRead } from './days-with-data';
import { calendarDateOf, isLive, type Period, periodKey } from './period';
import {
  createPeriodResource,
  usePeriodResource,
  windowedRead,
} from './period-resource';
import { createPolledResources, usePolledResource } from './polled-resource';

/** The games, shared by Verwalten and its Spiele screen; every screen refreshes them when it opens. */
const games = shallowRef<Game[]>();

export async function loadGames(): Promise<void> {
  games.value = await api.listGames();
}

export function useGames() {
  return readonly(games);
}

export async function createGame(game: NewGame): Promise<void> {
  await api.createGame(game);
  await loadGames();
}

export async function updateGame(
  id: number,
  change: GameChange,
): Promise<void> {
  await api.updateGame(id, change);
  await loadGames();
}

export async function deleteGame(id: number): Promise<void> {
  await api.deleteGame(id);
  forgetStandings(id);
  await loadGames();
}

/** Puts a game read from the server in place of the one shown. */
function show(game: Game): void {
  games.value = games.value?.map((shown) =>
    shown.id === game.id ? game : shown,
  );
}

/**
Starts the game's next run. Done once the server answers: the answer is the game
with its new start, and its ranking, empty until the next match or result, is
read again — a failed read only marks it stale, so nobody restarts twice.
*/
export async function restartGame(id: number): Promise<void> {
  show(await api.restartGame(id));
  await refreshStandings(id);
}

/** One polled ranking per game, created when a screen first needs it. */
const rankings = createPolledResources<number, Standings>(
  (gameId) => async (etag) => {
    const answer = await api.getStandings(gameId, etag);
    return answer === 'unchanged'
      ? 'unchanged'
      : { value: answer.standings, etag: answer.etag };
  },
);

/**
A game's ranking of its current run for the calling screen, kept current while it
is open and `shown` holds (a game's page shows it under `Aktuell`): the game's one
poller runs while any screen showing it is open (§6.6).
*/
export function useStandings(
  gameId: number,
  shown: MaybeRefOrGetter<boolean> = true,
) {
  const resource = rankings.of(gameId);
  if (shown === true) return usePolledResource(resource);
  let running = false;
  const run = (needed: boolean) => {
    if (needed === running) return;
    running = needed;
    if (needed) resource.start();
    else resource.stop();
  };
  watch(() => toValue(shown), run, { immediate: true });
  onScopeDispose(() => {
    run(false);
  });
  return resource.state;
}

/** The periods a game's page ranks apart from its current run (PRD #70). */
export type GamePeriod = Exclude<Period, { kind: 'run' }>;

/** What a game's page shows apart from its current run: the game and the period. */
export interface GameSelection {
  gameId: number;
  period: GamePeriod;
}

/**
The ranking a game's page shows of a day, a week or all time, counting every run:
data and ETags per game and period, so switching games or periods never shows or
asks with another's; the current week and all time are kept live, a past day or
week is read when shown, on focus and after the device's own writes.
*/
const periodStandings = createPeriodResource<GameSelection, Standings>({
  key: ({ gameId, period }) => `${String(gameId)}|${periodKey(period)}`,
  live: ({ period }) => isLive(period, calendarDateOf(new Date())),
  read: ({ gameId, period }) =>
    windowedRead(period, async (selection, etag) => {
      const answer = await api.getStandings(gameId, etag, selection);
      return answer === 'unchanged'
        ? 'unchanged'
        : { value: answer.standings, etag: answer.etag };
    }),
});
/** The game whose period ranking a screen shows. */
let periodShownOf: number | undefined;

/**
The ranking of the game and period the calling screen shows (`undefined`: none,
e.g. under `Aktuell`), while the screen is open. A game's page always opens on
`Aktuell`, so nothing of it is kept after the screen closes.
*/
export function usePeriodStandings(
  selection: MaybeRefOrGetter<GameSelection | undefined>,
) {
  watch(
    () => toValue(selection)?.gameId,
    (gameId) => {
      periodShownOf = gameId;
    },
    { immediate: true },
  );
  const state = usePeriodResource(periodStandings, selection);
  onScopeDispose(() => {
    periodStandings.show(undefined);
    periodShownOf = undefined;
  });
  return state;
}

/** The quarter hours each game was played, created when a screen first needs them. */
const playedDays = new Map<number, DaysRead>();

/** The quarter hours the game was played, all runs: its calendar's dots and its `Gesamt` line. */
export function gameDays(gameId: number): DaysRead {
  let days = playedDays.get(gameId);
  if (!days) {
    days = createDaysRead((etag) => api.getStandingsDays(gameId, etag));
    playedDays.set(gameId, days);
  }
  return days;
}

/** A game's ranking as last read, without polling it (the Spiele list reads on open and on focus). */
export function viewStandings(gameId: number) {
  return rankings.of(gameId).state;
}

/** Drops a game's ranking and its days once the game is gone, so a game of that id would start empty. */
export function forgetStandings(gameId: number): void {
  rankings.forget(gameId);
  playedDays.delete(gameId);
}

/**
Reads a game's ranking now: on open, on focus and after the device's own writes,
with the period and the days its page shows. Never rejects: a failed read keeps
the ranking shown, marked stale.
*/
export async function refreshStandings(gameId: number): Promise<void> {
  await Promise.all([
    rankings.of(gameId).refresh(),
    periodShownOf === gameId ? periodStandings.refresh() : undefined,
    playedDays.get(gameId)?.refresh(),
  ]);
}
