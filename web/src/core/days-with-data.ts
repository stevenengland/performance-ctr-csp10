import type { DeepReadonly, Ref } from 'vue';
import { type DaysAnswer, getScoreboardDays } from './api-client';
import { createPolledResource, type PolledState } from './polled-resource';

/**
A days-with-data read (PRD #70): the UTC start instants of the quarter hours with
rows that count, all time, which the calendar marks (bucketed into the viewer's
local days) and the `Gesamt` line counts.
*/
export interface DaysRead {
  /** The instants; `value` is undefined until the first answer. */
  state: Readonly<Ref<DeepReadonly<PolledState<string[]>>>>;
  /** Reads again now, e.g. after the device's own writes; nothing while no screen runs it. */
  refresh(): Promise<void>;
  /** A screen that shows the marks or the line starts the read while it does … */
  start(): void;
  /** … and stops it after; the instants are kept for the next start. */
  stop(): void;
}

/**
What a page gives the period picker for its calendar marks and its `Gesamt` line:
the read, and the line with the first day and the number of days (`Alle Tage seit
27.10.2026 · 15 Abende` for drinks, the runs and `Spieltage` for a game).
*/
export interface DaysWithData {
  read: DaysRead;
  summary: (since: string, days: number) => string;
}

/**
A days-with-data read kept current while a screen needs it: read on start, on focus,
when the page becomes visible and after the device's own writes, each time on
condition of the last ETag. It is not polled: what it shows changes only when a
day gets its first or loses its last row that counts.
*/
export function createDaysRead(
  read: (etag?: string) => Promise<DaysAnswer | 'unchanged'>,
): DaysRead {
  const resource = createPolledResource<string[]>(
    async (etag) => {
      const answer = await read(etag);
      return answer === 'unchanged'
        ? answer
        : { value: answer.instants, etag: answer.etag };
    },
    { polls: () => false },
  );
  let screens = 0;
  return {
    state: resource.state,
    refresh: () => (screens > 0 ? resource.refresh() : Promise.resolve()),
    start() {
      screens += 1;
      resource.start();
    },
    stop() {
      if (screens === 0) return;
      screens -= 1;
      resource.stop();
    },
  };
}

/** The quarter hours with drinks that count: the Rangliste's calendar marks and `Gesamt` line. */
export const scoreboardDays = createDaysRead(getScoreboardDays);
