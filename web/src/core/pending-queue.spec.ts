import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { shallowRef } from 'vue';
import type { Account, PendingPage } from './api-client';
import { createPendingQueue, type PendingQueue } from './pending-queue';

const anna: Account = { id: 1, userName: 'anna', isAdmin: true };
const ben: Account = { id: 2, userName: 'ben', isAdmin: false };

function page(count: number): PendingPage {
  return { items: [], next: null, count };
}

/** A fake API whose pending queue answers each account's page, the one signed in when asked. */
function api(pages: Record<number, () => PendingPage | Promise<PendingPage>>) {
  const signedIn = shallowRef<Account | null | undefined>(anna);
  const asked: (string | undefined)[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (_url: string, init: RequestInit) => {
      asked.push((init.headers as Record<string, string>)['If-None-Match']);
      const reply = pages[signedIn.value?.id ?? 0];
      if (!reply) throw new Error('nobody signed in');
      const body = await reply();
      return new Response(JSON.stringify(body), {
        status: 200,
        headers: {
          'Content-Type': 'application/json',
          ETag: `"7-${String(signedIn.value?.id)}"`,
        },
      });
    }),
  );
  return { signedIn, asked };
}

describe('the pending queue', () => {
  let queue: PendingQueue | undefined;

  beforeEach(() => {
    vi.useFakeTimers();
    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      get: () => 'visible',
    });
  });

  afterEach(() => {
    queue?.stop();
    queue = undefined;
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('reads the signed-in account’s first page and polls it on condition of its ETag', async () => {
    const { signedIn, asked } = api({ 1: () => page(3) });
    queue = createPendingQueue(signedIn);

    queue.start();
    await vi.advanceTimersByTimeAsync(10_000);

    expect(queue.state.value.page?.count).toBe(3);
    expect(asked).toEqual([undefined, '"7-1"']);
  });

  it('forgets the queue and its badge when another account signs in, and reads that account’s', async () => {
    const { signedIn, asked } = api({ 1: () => page(3), 2: () => page(1) });
    queue = createPendingQueue(signedIn);
    queue.start();
    await vi.advanceTimersByTimeAsync(0);

    signedIn.value = ben;

    expect(queue.state.value.page).toBeUndefined();
    await vi.advanceTimersByTimeAsync(0);
    expect(queue.state.value.page?.count).toBe(1);
    expect(asked).toEqual([undefined, undefined]);
  });

  it('discards an answer started under the previous session', async () => {
    let answerAnna: (page: PendingPage) => void = () => undefined;
    const { signedIn } = api({
      1: () =>
        new Promise<PendingPage>((resolve) => {
          answerAnna = resolve;
        }),
      2: () => page(1),
    });
    queue = createPendingQueue(signedIn);
    queue.start();

    signedIn.value = ben;
    await vi.advanceTimersByTimeAsync(0);
    answerAnna(page(5));
    await vi.advanceTimersByTimeAsync(0);

    expect(queue.state.value.page?.count).toBe(1);
  });

  it('keeps the queue while signed out or unknown until another account signs in', async () => {
    const { signedIn } = api({ 1: () => page(3), 2: () => page(1) });
    queue = createPendingQueue(signedIn);
    queue.start();
    await vi.advanceTimersByTimeAsync(0);

    signedIn.value = undefined;
    signedIn.value = null;
    signedIn.value = anna;
    expect(queue.state.value.page?.count).toBe(3);
    signedIn.value = null;
    signedIn.value = ben;
    expect(queue.state.value.page).toBeUndefined();
  });
});
