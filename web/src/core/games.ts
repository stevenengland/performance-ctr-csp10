import { readonly, shallowRef } from 'vue';
import * as api from './api-client';
import type { Game, GameChange, NewGame, Standings } from './api-client';
import {
  createPolledResource,
  usePolledResource,
  type PolledResource,
} from './polled-resource';

/** The games, shared by the Spiele destination and Verwalten → Spiele. */
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

export async function restartGame(id: number): Promise<void> {
  await api.restartGame(id);
  await Promise.all([loadGames(), refreshStandings(id)]);
}

/** One polled ranking per game, created when a screen first needs it. */
const feeds = new Map<number, PolledResource<Standings>>();

function feedOf(gameId: number): PolledResource<Standings> {
  let feed = feeds.get(gameId);
  if (!feed) {
    feed = createPolledResource<Standings>(async (etag) => {
      const answer = await api.getStandings(gameId, etag);
      return answer === 'unchanged'
        ? 'unchanged'
        : { value: answer.standings, etag: answer.etag };
    });
    feeds.set(gameId, feed);
  }
  return feed;
}

function forgetStandings(gameId: number): void {
  feeds.get(gameId)?.stop();
  feeds.delete(gameId);
}

/** A game's ranking for the calling screen, kept current while it is open. */
export function useStandings(gameId: number) {
  return usePolledResource(feedOf(gameId));
}

/** Refetches a game's ranking now, e.g. after the device's own writes. */
export function refreshStandings(gameId: number): Promise<void> {
  return feedOf(gameId).refresh();
}
