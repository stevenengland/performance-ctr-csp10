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
  /** The server's value; undefined until the first answer. */
  value?: T;
  /** When the value was last confirmed by the server. */
  updatedAt?: Date;
  /** The latest refresh failed: the value shown is that of `updatedAt`. */
  stale: boolean;
}

/** One request on condition of the last ETag: the new value with its ETag, or `unchanged` (304). */
export type ConditionalFetch<T> = (
  etag: string | undefined,
) => Promise<{ value: T; etag: string | undefined } | 'unchanged'>;

export interface PolledResource<T> {
  state: Readonly<Ref<DeepReadonly<PolledState<T>>>>;
  /** Refetches now (on open, after the device's own writes) and polls on from there while a screen runs it. */
  refresh(): Promise<void>;
  /** A screen that shows the value starts the resource while it is open … */
  start(): void;
  /** … and stops it when it closes; the resource polls while any screen needs it. */
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
A server value kept current while a screen needs it. While started and the page
is visible, it asks every 10 s on condition of the last ETag, and at once on
focus and after the device's own writes; an answer a newer request overtook is
dropped. A failed refresh keeps the last value, marked stale, and retries with
backoff up to 60 s; a 503 with `Retry-After` shows the maintenance snackbar and
retries after that delay. Without a screen, `refresh` reads once and never polls.
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
    state: readonly(state) as PolledResource<T>['state'],
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

/** Runs the resource while the calling screen is open and returns its state. */
export function usePolledResource<T>(resource: PolledResource<T>) {
  resource.start();
  onScopeDispose(resource.stop);
  return resource.state;
}

export interface PolledResources<K, T> {
  /** The key's resource, created on first use and shared from then on. */
  of(key: K): PolledResource<T>;
  /** Drops the key's resource, e.g. once its subject is deleted. */
  forget(key: K): void;
}

/** At most one polled resource per key (e.g. per game), shared by every screen that shows it. */
export function createPolledResources<K, T>(
  fetchOf: (key: K) => ConditionalFetch<T>,
): PolledResources<K, T> {
  const resources = new Map<K, PolledResource<T>>();
  return {
    of(key) {
      let resource = resources.get(key);
      if (!resource) {
        resource = createPolledResource(fetchOf(key));
        resources.set(key, resource);
      }
      return resource;
    },
    forget(key) {
      resources.delete(key);
    },
  };
}
