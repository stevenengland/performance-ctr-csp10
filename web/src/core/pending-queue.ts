import {
  computed,
  onScopeDispose,
  watch,
  type DeepReadonly,
  type Ref,
} from 'vue';
import { getPending, type Account, type PendingPage } from './api-client';
import { createPolledResource, type ConditionalFetch } from './polled-resource';
import { useSession } from './session';

export interface PendingQueueState {
  /** The first page of the queue with the count of all rows; undefined until the first answer. */
  page?: PendingPage;
  /** When the page was last confirmed by the server. */
  updatedAt?: Date;
  /** The latest refresh failed: the page shown is that of `updatedAt`. */
  stale: boolean;
}

export interface PendingQueue {
  state: Readonly<Ref<DeepReadonly<PendingQueueState>>>;
  /** Refetches now (after a verification) and polls on from there. */
  refresh(): Promise<void>;
  /** A screen that shows the queue or its badge starts it while it is open … */
  start(): void;
  /** … and stops it when it closes; it polls while any screen needs it. */
  stop(): void;
}

const firstPage: ConditionalFetch<PendingPage> = async (etag) => {
  const answer = await getPending(etag);
  return answer === 'unchanged'
    ? 'unchanged'
    : { value: answer.page, etag: answer.etag };
};

/**
The rows the signed-in account may verify (PRD #61), as `Offen` and its badge
show them: the first page of the queue as a polled resource (every 10 s while
visible on condition of the last ETag). Every account has its own queue, so when
another account signs in the queue is forgotten at once and every answer still
on its way is dropped. Signed out, nothing shows the queue; a session that is
only unknown for a moment (asked again after a 401 elsewhere) changes nothing.
*/
export function createPendingQueue(
  session: Readonly<Ref<DeepReadonly<Account> | null | undefined>>,
): PendingQueue {
  const resource = createPolledResource(firstPage);
  let owner = session.value?.id;
  watch(
    session,
    (account) => {
      if (!account || account.id === owner) return;
      owner = account.id;
      resource.reset();
    },
    { flush: 'sync' },
  );
  const state = computed(() => {
    const { value, updatedAt, stale } = resource.state.value;
    return { page: value, updatedAt, stale };
  });
  return {
    state,
    refresh: resource.refresh,
    start: resource.start,
    stop: resource.stop,
  };
}

const queue = createPendingQueue(useSession());

/** The signed-in account's queue for the calling screen: the shared queue runs while the screen is open. */
export function usePendingQueue() {
  queue.start();
  onScopeDispose(queue.stop);
  return queue.state;
}

/** Refetches the queue now, e.g. after a verification. */
export function refreshPending(): Promise<void> {
  return queue.refresh();
}
