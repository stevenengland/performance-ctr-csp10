import { readonly, shallowRef } from 'vue';
import * as api from './api-client';
import type { Game, GameChange, NewGame, Standings } from './api-client';
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
A game's ranking for the calling screen, kept current while it is open: the
game's one poller runs while any screen showing it is open (§6.6).
*/
export function useStandings(gameId: number) {
  return usePolledResource(rankings.of(gameId));
}

/** A game's ranking as last read, without polling it (the Spiele list reads on open and on focus). */
export function viewStandings(gameId: number) {
  return rankings.of(gameId).state;
}

/** Drops a game's ranking once the game is gone, so a game of that id would start empty. */
export function forgetStandings(gameId: number): void {
  rankings.forget(gameId);
}

/**
Reads a game's ranking now: on open, on focus and after the device's own
writes. Never rejects: a failed read keeps the ranking shown, marked stale.
*/
export function refreshStandings(gameId: number): Promise<void> {
  return rankings.of(gameId).refresh();
}
