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

export interface PeriodResource<S, T> {
  /** The shown selection's value; empty while nothing is shown or until its first answer. */
  state: Readonly<Ref<DeepReadonly<PolledState<T>>>>;
  /** Shows another selection (`undefined`: none); the one shown before is forgotten. */
  show(selection: S | undefined): void;
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
a 304 only ever applies to it; showing another one forgets the previous one and
drops every answer still on its way for it, so a slow answer for `Gestern` can
never overwrite `Heute`. A selection that contains the present is polled every
10 s; a closed one is read when shown, on focus, when the page becomes visible and
after the device's own writes. Failures keep the last value, marked stale.
*/
export function createPeriodResource<S, T>(
  reads: PeriodReads<S, T>,
): PeriodResource<S, T> {
  const shown = shallowRef<{ key: string; resource: PolledResource<T> }>();
  let screens = 0;

  function show(selection: S | undefined) {
    const key = selection === undefined ? undefined : reads.key(selection);
    if (key === shown.value?.key) return;
    const previous = shown.value?.resource;
    if (screens > 0) previous?.stop();
    previous?.clear();
    shown.value = undefined;
    if (selection === undefined || key === undefined) return;
    const resource = createPolledResource(reads.read(selection), {
      polls: () => reads.live(selection),
    });
    shown.value = { key, resource };
    if (screens > 0) resource.start();
  }

  return {
    state: computed(
      () => shown.value?.resource.state.value ?? NOTHING_SHOWN,
    ) as PeriodResource<S, T>['state'],
    show,
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
