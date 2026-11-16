import {
  onScopeDispose,
  readonly,
  shallowRef,
  type DeepReadonly,
  type Ref,
} from 'vue';
import { ApiProblem, getScoreboard, type Scoreboard } from './api-client';
import { todayFrom } from './day-window';
import { messages } from './messages';
import { showSnackbar } from './snackbar';

export const POLL_INTERVAL_MS = 10_000;
const FIRST_RETRY_MS = 5_000;
export const MAX_RETRY_MS = 60_000;

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

/** Waits after the n-th failure in a row: 5, 10, 20, 40, then 60 s. */
function backoff(failures: number): number {
  return Math.min(FIRST_RETRY_MS * 2 ** (failures - 1), MAX_RETRY_MS);
}

/** Retry-After in ms, for a 503 that names one (a migration is running). */
function maintenanceDelay(failure: unknown): number | undefined {
  return failure instanceof ApiProblem &&
    failure.status === 503 &&
    failure.retryAfterSeconds !== undefined
    ? failure.retryAfterSeconds * 1000
    : undefined;
}

/**
Today's standings, shared by every screen that shows scores or counters (the
Rangliste, the add flow's tiles and its top bar). While a screen needs it and the
page is visible, it asks every 10 s on condition of the last ETag, and at once on
focus and after the device's own writes. Each request computes the day window
anew, so the standings reset at local midnight; an answer that a newer request or
a new day overtook is dropped. A failed refresh keeps the last standings, marked
stale, and retries with backoff up to 60 s; a 503 with `Retry-After` shows the
maintenance snackbar and retries after that delay.
*/
export function createScoreboardFeed(): ScoreboardFeed {
  const state = shallowRef<ScoreboardState>({ stale: false });
  let etag: string | undefined;
  let latest = 0;
  let failures = 0;
  let screens = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;

  const visible = () => document.visibilityState === 'visible';

  function cancel() {
    clearTimeout(timer);
    timer = undefined;
  }

  function schedule(delayMs: number) {
    cancel();
    if (screens > 0 && visible()) timer = setTimeout(poll, delayMs);
  }

  function poll() {
    void refresh();
  }

  async function refresh(): Promise<void> {
    latest += 1;
    const request = latest;
    const from = todayFrom(new Date());
    try {
      const answer = await getScoreboard(from, etag);
      if (request !== latest) return;
      if (todayFrom(new Date()) !== from) {
        await refresh();
        return;
      }
      failures = 0;
      if (answer !== 'unchanged') etag = answer.etag;
      const board = answer === 'unchanged' ? state.value.board : answer.board;
      state.value = { board, updatedAt: new Date(), stale: false };
      schedule(POLL_INTERVAL_MS);
    } catch (failure) {
      if (request !== latest) return;
      failures += 1;
      state.value = { ...state.value, stale: true };
      const maintenance = maintenanceDelay(failure);
      if (maintenance !== undefined) {
        showSnackbar({ text: messages.maintenance });
      }
      schedule(maintenance ?? backoff(failures));
    }
  }

  function onVisibilityChange() {
    if (visible()) poll();
    else cancel();
  }

  return {
    state: readonly(state),
    refresh,
    start() {
      screens += 1;
      if (screens > 1) return;
      document.addEventListener('visibilitychange', onVisibilityChange);
      window.addEventListener('focus', poll);
      poll();
    },
    stop() {
      if (screens === 0) return;
      screens -= 1;
      if (screens > 0) return;
      document.removeEventListener('visibilitychange', onVisibilityChange);
      window.removeEventListener('focus', poll);
      cancel();
    },
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
