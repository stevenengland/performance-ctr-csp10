import type { MaybeRefOrGetter } from 'vue';
import { getScoreboard, type Scoreboard } from './api-client';
import { calendarDateOf, isLive, type Period, periodKey } from './period';
import {
  createPeriodResource,
  type PeriodResource,
  usePeriodResource,
  windowedRead,
} from './period-resource';
import type { ConditionalFetch } from './polled-resource';

/** The periods the drinks scoreboard ranks. */
export type DrinksPeriod = Extract<Period, { kind: 'day' | 'week' | 'all' }>;

/** The scoreboard of a period, its window built anew for each request. */
function scoreboardOf(period: DrinksPeriod): ConditionalFetch<Scoreboard> {
  return windowedRead(period, async (selection, etag) => {
    const answer = await getScoreboard(selection, etag);
    return answer === 'unchanged'
      ? 'unchanged'
      : { value: answer.board, etag: answer.etag };
  });
}

/**
The drinks scoreboard of any period but today, which the shared scoreboard feed
keeps (so choosing another period never changes what Zählen shows): data and
ETags per period, the current week and all time kept live, a past day or week
read when shown, on focus and after the device's own writes.
*/
export function createPeriodScoreboard(): PeriodResource<
  DrinksPeriod,
  Scoreboard
> {
  return createPeriodResource({
    key: periodKey,
    live: (period) => isLive(period, calendarDateOf(new Date())),
    read: scoreboardOf,
  });
}

const scoreboards = createPeriodScoreboard();

/** The scoreboard of the period the calling screen shows (`undefined`: none), while the screen is open. */
export function usePeriodScoreboard(
  period: MaybeRefOrGetter<DrinksPeriod | undefined>,
) {
  return usePeriodResource(scoreboards, period);
}

/** Reads the shown period's scoreboard again, e.g. after the device's own writes. */
export function refreshPeriodScoreboard(): Promise<void> {
  return scoreboards.refresh();
}
