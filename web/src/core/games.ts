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
  rankings.forget(id);
  await loadGames();
}

/** Starts the game's next run: its new start and its ranking, empty until the next match or result, are read again. */
export async function restartGame(id: number): Promise<void> {
  await api.restartGame(id);
  await Promise.all([loadGames(), refreshStandings(id)]);
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

/**
Reads a game's ranking now: on open, on focus and after the device's own
writes. Never rejects: a failed read keeps the ranking shown, marked stale.
*/
export function refreshStandings(gameId: number): Promise<void> {
  return rankings.of(gameId).refresh();
}
