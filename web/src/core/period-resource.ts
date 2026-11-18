import {
  computed,
  onScopeDispose,
  shallowRef,
  toValue,
  watch,
  type DeepReadonly,
  type MaybeRefOrGetter,
  type Ref,
} from 'vue';
import type { ScoreboardSelection } from './api-client';
import { type Period, queryOf } from './period';
import {
  createPolledResource,
  type ConditionalFetch,
  type PolledResource,
  type PolledState,
} from './polled-resource';

/** How a page reads what its selection (a period, on a game page with the measure) shows. */
export interface PeriodReads<S, T> {
  /** The query identity of a selection: data and ETags are kept under it. */
  key(selection: S): string;
  /** Whether the selection contains the present, so it is polled like today's ranking. */
  live(selection: S): boolean;
  /** The conditional read of a selection; it builds the window anew for every request. */
  read(selection: S): ConditionalFetch<T>;
}

export interface PeriodOptions {
  /**
  How many selections shown before keep their value and ETag (default none), so
  showing one again shows its value at once and asks on condition of its ETag.
  */
  keeps?: number;
}

export interface PeriodResource<S, T> {
  /** The shown selection's value; empty while nothing is shown or until its first answer. */
  state: Readonly<Ref<DeepReadonly<PolledState<T>>>>;
  /** Shows another selection (`undefined`: none); the one shown before is kept or forgotten. */
  show(selection: S | undefined): void;
  /** Forgets the shown selection and every kept one. */
  forget(): void;
  /** Reads the shown selection again now, e.g. after the device's own writes. */
  refresh(): Promise<void>;
  /** A screen that shows the selection starts the resource while it is open … */
  start(): void;
  /** … and stops it when it closes; the shown value is kept for its return. */
  stop(): void;
}

const NOTHING_SHOWN: PolledState<never> = { stale: false };

/**
The value of whichever selection a page shows, one selection at a time. Each
selection gets its own polled resource, so its ETag is only ever sent with it and
a 304 only ever applies to it; showing another one stops the previous one, so a
slow answer for `Gestern` can never overwrite `Heute`. The previous one is
forgotten with every answer still on its way for it, or, as far as `keeps`
reaches, kept unread (an answer on its way lands in it, never in the shown one).
A selection that contains the present is polled every 10 s; a closed one is read
when shown, on focus, when the page becomes visible and after the device's own
writes. Failures keep the last value, marked stale.
*/
export function createPeriodResource<S, T>(
  reads: PeriodReads<S, T>,
  { keeps = 0 }: PeriodOptions = {},
): PeriodResource<S, T> {
  const shown = shallowRef<{ key: string; resource: PolledResource<T> }>();
  /** The selections shown before, kept unread, the one shown last at the end. */
  const kept = new Map<string, PolledResource<T>>();
  let screens = 0;

  function hidePrevious() {
    const previous = shown.value;
    shown.value = undefined;
    if (!previous) return;
    if (screens > 0) previous.resource.stop();
    kept.set(previous.key, previous.resource);
    for (const [key, resource] of kept) {
      if (kept.size <= keeps) break;
      resource.clear();
      kept.delete(key);
    }
  }

  function show(selection: S | undefined) {
    const key = selection === undefined ? undefined : reads.key(selection);
    if (key === shown.value?.key) return;
    const reused = key === undefined ? undefined : kept.get(key);
    if (key !== undefined) kept.delete(key);
    hidePrevious();
    if (selection === undefined || key === undefined) return;
    const resource =
      reused ??
      createPolledResource(reads.read(selection), {
        polls: () => reads.live(selection),
      });
    shown.value = { key, resource };
    if (screens > 0) resource.start();
  }

  function forget() {
    show(undefined);
    for (const resource of kept.values()) resource.clear();
    kept.clear();
  }

  return {
    state: computed(
      () => shown.value?.resource.state.value ?? NOTHING_SHOWN,
    ) as PeriodResource<S, T>['state'],
    show,
    forget,
    refresh: () => shown.value?.resource.refresh() ?? Promise.resolve(),
    start() {
      screens += 1;
      if (screens === 1) shown.value?.resource.start();
    },
    stop() {
      if (screens === 0) return;
      screens -= 1;
      if (screens === 0) shown.value?.resource.stop();
    },
  };
}

/**
The conditional read of a selection that is built anew for each request, from the
calendar and the time zone (a period's or a month's window); an answer for a
selection that changed while it was on its way (the time zone changed) is dropped
for one for the rebuilt selection.
*/
export function rebuiltRead<S, T>(
  selectionOf: () => S,
  read: (
    selection: S,
    etag: string | undefined,
  ) => ReturnType<ConditionalFetch<T>>,
): ConditionalFetch<T> {
  const conditional: ConditionalFetch<T> = async (etag) => {
    const selection = selectionOf();
    const answer = await read(selection, etag);
    if (JSON.stringify(selectionOf()) !== JSON.stringify(selection)) {
      return conditional(etag);
    }
    return answer;
  };
  return conditional;
}

/** The conditional read of a period with a window or all time, the window built from the period's calendar date for each request. */
export function windowedRead<T>(
  period: Exclude<Period, { kind: 'run' }>,
  read: (
    selection: ScoreboardSelection,
    etag: string | undefined,
  ) => ReturnType<ConditionalFetch<T>>,
): ConditionalFetch<T> {
  return rebuiltRead(() => queryOf(period), read);
}

/** Shows what the calling screen selects and runs the resource while the screen is open. */
export function usePeriodResource<S, T>(
  resource: PeriodResource<S, T>,
  selection: MaybeRefOrGetter<S | undefined>,
) {
  watch(
    () => toValue(selection),
    (selected) => {
      resource.show(selected);
    },
    { immediate: true },
  );
  resource.start();
  onScopeDispose(resource.stop);
  return resource.state;
}
