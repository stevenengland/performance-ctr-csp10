import { computed, onScopeDispose, type DeepReadonly, type Ref } from 'vue';
import { getScoreboard, type Scoreboard } from './api-client';
import { todayFrom } from './day-window';
import { createPolledResource, type ConditionalFetch } from './polled-resource';

export interface ScoreboardState {
  /** Today's standings; undefined until the first answer. */
  board?: Scoreboard;
  /** When the standings were last confirmed by the server. */
  updatedAt?: Date;
  /** The latest refresh failed: the standings shown are those of `updatedAt`. */
  stale: boolean;
}

export interface ScoreboardFeed {
  state: Readonly<Ref<DeepReadonly<ScoreboardState>>>;
  /** Refetches now (after the device's own writes) and polls on from there. */
  refresh(): Promise<void>;
  /** A screen that shows the standings starts the feed while it is open … */
  start(): void;
  /** … and stops it when it closes; the feed runs while any screen needs it. */
  stop(): void;
}

/**
Today's standings since local midnight: each request computes the day window
anew, so the standings reset at midnight, and an answer for a day that ended
while it was on its way is dropped for one for the new day.
*/
const todaysScoreboard: ConditionalFetch<Scoreboard> = async (etag) => {
  const from = todayFrom(new Date());
  const answer = await getScoreboard(from, etag);
  if (todayFrom(new Date()) !== from) return todaysScoreboard(etag);
  return answer === 'unchanged'
    ? 'unchanged'
    : { value: answer.board, etag: answer.etag };
};

/**
Today's standings, shared by every screen that shows scores or counters (the
Rangliste, the add flow's tiles and its top bar): the drink instance of the
polled resource (every 10 s while visible on condition of the last ETag, at once
on focus and after the device's own writes, stale with backoff on failure).
*/
export function createScoreboardFeed(): ScoreboardFeed {
  const resource = createPolledResource(todaysScoreboard);
  const state = computed(() => {
    const { value, updatedAt, stale } = resource.state.value;
    return { board: value, updatedAt, stale };
  });
  return {
    state,
    refresh: resource.refresh,
    start: resource.start,
    stop: resource.stop,
  };
}

const feed = createScoreboardFeed();

/** Today's standings for the calling screen: the shared feed runs while the screen is open. */
export function useScoreboardFeed() {
  feed.start();
  onScopeDispose(feed.stop);
  return feed.state;
}

/** Refetches the standings now, e.g. after the device's own writes. */
export function refreshScoreboard(): Promise<void> {
  return feed.refresh();
}

/** A person's total score today; 0 without entries. */
export function scoreOf(
  board: DeepReadonly<Scoreboard> | undefined,
  personId: number,
) {
  return board?.rows.find((row) => row.personId === personId)?.score ?? 0;
}

/** A person's counter for one drink today; 0 without entries. */
export function counterOf(
  board: DeepReadonly<Scoreboard> | undefined,
  personId: number,
  drinkId: number,
): number {
  const row = board?.rows.find((candidate) => candidate.personId === personId);
  return row?.drinks.find((drink) => drink.drinkId === drinkId)?.count ?? 0;
}
