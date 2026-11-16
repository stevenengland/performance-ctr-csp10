import {
  onScopeDispose,
  readonly,
  shallowRef,
  type DeepReadonly,
  type Ref,
} from 'vue';
import { ApiProblem } from './api-client';
import { messages } from './messages';
import { showSnackbar } from './snackbar';

export const POLL_INTERVAL_MS = 10_000;
const FIRST_RETRY_MS = 5_000;
export const MAX_RETRY_MS = 60_000;

export interface PolledState<T> {
  /** The latest value; undefined until the first answer. */
  value?: T;
  /** When the value was last confirmed by the server. */
  updatedAt?: Date;
  /** The latest refresh failed: the value shown is that of `updatedAt`. */
  stale: boolean;
}

/** One conditional fetch: the value with its ETag, or `unchanged` for 304. */
export type ConditionalFetch<T> = (
  etag: string | undefined,
) => Promise<{ value: T; etag: string | undefined } | 'unchanged'>;

export interface PolledResource<T> {
  state: Readonly<Ref<DeepReadonly<PolledState<T>>>>;
  refresh(): Promise<void>;
  start(): void;
  stop(): void;
}

function backoff(failures: number): number {
  return Math.min(FIRST_RETRY_MS * 2 ** (failures - 1), MAX_RETRY_MS);
}

function maintenanceDelay(failure: unknown): number | undefined {
  return failure instanceof ApiProblem &&
    failure.status === 503 &&
    failure.retryAfterSeconds !== undefined
    ? failure.retryAfterSeconds * 1000
    : undefined;
}

/**
A server value kept current while a screen needs it: every 10 s on condition of
the last ETag while the page is visible, at once on focus and after the device's
own writes. An answer a newer request overtook is dropped; a failed refresh keeps
the last value, marked stale, and retries with backoff up to 60 s. This is the
scoreboard feed's mechanism without the drink endpoint and the day window.
*/
export function createPolledResource<T>(
  fetch: ConditionalFetch<T>,
): PolledResource<T> {
  const state = shallowRef<PolledState<T>>({ stale: false });
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
    try {
      const answer = await fetch(etag);
      if (request !== latest) return;
      failures = 0;
      if (answer !== 'unchanged') etag = answer.etag;
      const value = answer === 'unchanged' ? state.value.value : answer.value;
      state.value = { value, updatedAt: new Date(), stale: false };
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
    state: readonly(state) as Readonly<Ref<DeepReadonly<PolledState<T>>>>,
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

/** Runs the resource while the calling screen is open. */
export function usePolledResource<T>(resource: PolledResource<T>) {
  resource.start();
  onScopeDispose(resource.stop);
  return resource.state;
}
