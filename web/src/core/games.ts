import { readonly, shallowRef, type ShallowRef } from 'vue';
import * as api from './api-client';
import type { Game, GameChange, NewGame, Standings } from './api-client';
import { showProblem } from './snackbar';

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
  rankings.delete(id);
  await loadGames();
}

/** Each game's ranking as last read, shared by the screens that show it. */
const rankings = new Map<number, ShallowRef<Standings | undefined>>();

function rankingOf(gameId: number): ShallowRef<Standings | undefined> {
  let ranking = rankings.get(gameId);
  if (!ranking) {
    ranking = shallowRef<Standings>();
    rankings.set(gameId, ranking);
  }
  return ranking;
}

/** A game's ranking; undefined until it was first read. */
export function useStandings(gameId: number) {
  return readonly(rankingOf(gameId));
}

/**
Reads a game's ranking now: when its page opens and after the device's own
writes. A failed read keeps the ranking shown and states the problem in the
snackbar.
*/
export async function refreshStandings(gameId: number): Promise<void> {
  try {
    rankingOf(gameId).value = await api.getStandings(gameId);
  } catch (failure) {
    showProblem(failure);
  }
}
