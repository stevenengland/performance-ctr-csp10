import type { MaybeRefOrGetter } from 'vue';
import { getScoreboard, type Scoreboard } from './api-client';
import {
  calendarDateOf,
  isLive,
  type Period,
  periodKey,
  queryOf,
} from './period';
import {
  createPeriodResource,
  type PeriodResource,
  usePeriodResource,
} from './period-resource';
import type { ConditionalFetch } from './polled-resource';

/** The periods the drinks scoreboard ranks. */
export type DrinksPeriod = Extract<Period, { kind: 'day' | 'week' | 'all' }>;

/**
The scoreboard of a period, its window built from the period's calendar date for
each request; an answer for a window that changed while it was on its way (the
time zone changed) is dropped for one for the rebuilt window.
*/
function scoreboardOf(period: DrinksPeriod): ConditionalFetch<Scoreboard> {
  const read: ConditionalFetch<Scoreboard> = async (etag) => {
    const selection = queryOf(period);
    const answer = await getScoreboard(selection, etag);
    if (JSON.stringify(queryOf(period)) !== JSON.stringify(selection)) {
      return read(etag);
    }
    return answer === 'unchanged'
      ? 'unchanged'
      : { value: answer.board, etag: answer.etag };
  };
  return read;
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
