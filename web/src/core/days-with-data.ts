import type { DeepReadonly, Ref } from 'vue';
import {
  type DaysAnswer,
  type DaysSelection,
  getScoreboardDays,
  type Span,
} from './api-client';
import { type CalendarDate, isoDate, monthWindow } from './period';
import {
  createPeriodResource,
  type PeriodResource,
  rebuiltRead,
} from './period-resource';
import {
  type ConditionalFetch,
  createPolledResource,
  type PolledState,
} from './polled-resource';

/** How many months the calendar showed before keep their spans and ETag, so browsing back to one shows its dots at once. */
const KEPT_MONTHS = 3;

/** One days-with-data request of a selection, on condition of an ETag. */
export type DaysFetch = (
  selection: DaysSelection,
  etag?: string,
) => Promise<DaysAnswer | 'unchanged'>;

/**
The all-time days-with-data read (PRD #70): the sessions with rows that count, as
UTC spans, which the `Gesamt` line counts in the viewer's local days.
*/
export interface DaysRead {
  /** The spans; `value` is undefined until the first answer. */
  state: Readonly<Ref<DeepReadonly<PolledState<Span[]>>>>;
  /** Reads again now, e.g. after the device's own writes; nothing while no screen runs it. */
  refresh(): Promise<void>;
  /**
  A screen that shows the line starts the read while it does; `live` while it shows
  a period that contains the present (all time), which polls it …
  */
  start(live?: boolean): void;
  /** … and stops it after, as it started it; the spans are kept for the next start. */
  stop(live?: boolean): void;
}

/**
The days-with-data reads of a ranking: all time for the `Gesamt` line and, one
window at a time, the month the calendar shows for its dots.
*/
export interface DaysReads {
  all: DaysRead;
  /**
  The month shown (as its first day), read when shown, on focus and after the
  device's own writes, never polled: the calendar shows it while its dialog is open.
  */
  months: PeriodResource<CalendarDate, Span[]>;
  /** Reads again what a screen shows of them, after the device's own writes. */
  refresh(): Promise<void>;
}

/**
What a page gives the period picker for its calendar marks and its `Gesamt` line:
the reads, the mark a dotted day is described with, and the line with the first day and the number of days (`Alle Tage seit
27.10.2026 · 15 Abende` for drinks, the runs and `Spieltage` for a game).
*/
export interface DaysWithData {
  reads: DaysReads;
  summary: (since: string, days: number) => string;
  /** What a calendar day's dot says to a screen reader: `Gezählt`, `Gespielt`. */
  mark: string;
}

/** A days answer as a polled resource takes it. */
async function polledAnswer(
  answer: Promise<DaysAnswer | 'unchanged'>,
): ReturnType<ConditionalFetch<Span[]>> {
  const settled = await answer;
  return settled === 'unchanged'
    ? settled
    : { value: settled.spans, etag: settled.etag };
}

/**
The all-time read kept current while a screen needs it: read on start, on focus,
when the page becomes visible and after the device's own writes, each time on
condition of the last ETag. It is polled every 10 s only while a screen runs it
live: `Gesamt` is kept live, and its line with it.
*/
export function createDaysRead(read: DaysFetch): DaysRead {
  const resource = createPolledResource<Span[]>(
    (etag) => polledAnswer(read({ scope: 'all' }, etag)),
    { polls: () => liveScreens > 0 },
  );
  let screens = 0;
  let liveScreens = 0;
  return {
    state: resource.state,
    refresh: () => (screens > 0 ? resource.refresh() : Promise.resolve()),
    start(live = false) {
      screens += 1;
      if (live) liveScreens += 1;
      resource.start();
      // Already run by another screen: read now, so the polling starts.
      if (live && screens > 1) void resource.refresh();
    },
    stop(live = false) {
      if (screens === 0) return;
      screens -= 1;
      if (live && liveScreens > 0) liveScreens -= 1;
      resource.stop();
    },
  };
}

/** The all-time read and the month reads of one days-with-data resource. */
export function createDaysReads(read: DaysFetch): DaysReads {
  const all = createDaysRead(read);
  const months = createPeriodResource<CalendarDate, Span[]>(
    {
      key: isoDate,
      live: () => false,
      read: (month) =>
        rebuiltRead(
          () => monthWindow(month),
          (window, etag) => polledAnswer(read(window, etag)),
        ),
    },
    { keeps: KEPT_MONTHS },
  );
  return {
    all,
    months,
    refresh: async () => {
      await Promise.all([all.refresh(), months.refresh()]);
    },
  };
}

/** The sessions with drinks that count: the Rangliste's calendar marks and `Gesamt` line. */
export const scoreboardDays = createDaysReads(getScoreboardDays);
