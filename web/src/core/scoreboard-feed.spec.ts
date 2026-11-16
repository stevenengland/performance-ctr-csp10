import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Scoreboard } from './api-client';
import {
  counterOf,
  createScoreboardFeed,
  scoreOf,
  type ScoreboardFeed,
} from './scoreboard-feed';
import { dismissSnackbar, useSnackbar } from './snackbar';

const board: Scoreboard = {
  rows: [
    {
      personId: 1,
      name: 'Daniel',
      photoUrl: null,
      score: 13.5,
      count: 6,
      pendingCount: 0,
      drinks: [
        { drinkId: 1, name: 'Bier', count: 4, recordedCount: 4 },
        { drinkId: 2, name: 'Margarita', count: 2, recordedCount: 2 },
      ],
    },
  ],
  unranked: [],
};
const empty: Scoreboard = { rows: [], unranked: [] };

type Reply = () => Response | Promise<Response>;

function json(body: Scoreboard, etag = '"1-0"'): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json', ETag: etag },
  });
}

const unchanged = () => new Response(null, { status: 304 });
const offline = () => Promise.reject(new TypeError('Failed to fetch'));
function maintenance(retryAfterSeconds: number): Response {
  return new Response(
    JSON.stringify({
      type: 'urn:performance:problem:maintenance',
      title: 'Wird aktualisiert – gleich wieder da',
      status: 503,
    }),
    {
      status: 503,
      headers: {
        'Content-Type': 'application/problem+json',
        'Retry-After': String(retryAfterSeconds),
      },
    },
  );
}

interface Call {
  from: string;
  ifNoneMatch: string | undefined;
}

/** A fake API: every scoreboard request takes the next reply (the last one repeats). */
function api(...replies: Reply[]) {
  const calls: Call[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init: RequestInit) => {
      const headers = init.headers as Record<string, string>;
      calls.push({
        from: new URL(url, 'http://app').searchParams.get('from') ?? '',
        ifNoneMatch: headers['If-None-Match'],
      });
      const reply = replies.length > 1 ? replies.shift() : replies[0];
      if (!reply) throw new Error('no reply');
      return reply();
    }),
  );
  return calls;
}

let visibility: DocumentVisibilityState = 'visible';
function becomeVisible(state: DocumentVisibilityState) {
  visibility = state;
  document.dispatchEvent(new Event('visibilitychange'));
}

/** Lets the pending fetch answers and their follow-ups settle. */
async function settle() {
  await vi.advanceTimersByTimeAsync(0);
}

async function wait(seconds: number) {
  await vi.advanceTimersByTimeAsync(seconds * 1000);
}

describe('the scoreboard feed', () => {
  const zone = process.env.TZ;
  let feed: ScoreboardFeed;

  beforeEach(() => {
    process.env.TZ = 'Europe/Berlin';
    vi.useFakeTimers({ now: new Date('2026-11-15T22:41:00Z') });
    visibility = 'visible';
    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      get: () => visibility,
    });
    dismissSnackbar();
    feed = createScoreboardFeed();
  });

  afterEach(() => {
    feed.stop();
    vi.useRealTimers();
    vi.unstubAllGlobals();
    process.env.TZ = zone;
  });

  it('asks for the standings since local midnight, sent as UTC, as soon as it starts', async () => {
    const calls = api(() => json(board));

    feed.start();
    await settle();

    expect(calls).toEqual([
      { from: '2026-11-14T23:00:00.000Z', ifNoneMatch: undefined },
    ]);
    expect(feed.state.value.board).toEqual(board);
  });

  it('refetches every 10 s while visible, on condition of the last ETag; 304 keeps the standings', async () => {
    const calls = api(() => json(board, '"7-1"'), unchanged);
    feed.start();
    await settle();

    await wait(9.9);
    expect(calls).toHaveLength(1);
    await wait(0.1);
    await wait(10);

    expect(calls.map(({ ifNoneMatch }) => ifNoneMatch)).toEqual([
      undefined,
      '"7-1"',
      '"7-1"',
    ]);
    expect(feed.state.value.board).toEqual(board);
    expect(feed.state.value.stale).toBe(false);
  });

  it('does not refetch while hidden and refetches immediately when visible again', async () => {
    const calls = api(() => json(board));
    feed.start();
    await settle();

    becomeVisible('hidden');
    await wait(60);
    expect(calls).toHaveLength(1);

    becomeVisible('visible');
    await settle();
    expect(calls).toHaveLength(2);
    await wait(10);
    expect(calls).toHaveLength(3);
  });

  it('does not poll on after an answer that arrives once the page is hidden', async () => {
    let answer: (response: Response) => void = () => undefined;
    const calls = api(
      () =>
        new Promise<Response>((resolve) => {
          answer = resolve;
        }),
    );
    feed.start();

    becomeVisible('hidden');
    answer(json(board));
    await wait(60);

    expect(calls).toHaveLength(1);
    expect(feed.state.value.board).toEqual(board);
  });

  it('refetches immediately on focus', async () => {
    const calls = api(() => json(board));
    feed.start();
    await settle();

    window.dispatchEvent(new Event('focus'));
    await settle();

    expect(calls).toHaveLength(2);
  });

  it('refetches immediately after the device’s own writes and polls 10 s from then', async () => {
    const calls = api(() => json(board));
    feed.start();
    await settle();
    await wait(6);

    await feed.refresh();
    expect(calls).toHaveLength(2);
    await wait(9.9);
    expect(calls).toHaveLength(2);
    await wait(0.1);
    expect(calls).toHaveLength(3);
  });

  it('stops polling and listening when its last screen stops it', async () => {
    const calls = api(() => json(board));
    feed.start();
    feed.start();
    await settle();

    feed.stop();
    await wait(10);
    expect(calls).toHaveLength(2);

    feed.stop();
    window.dispatchEvent(new Event('focus'));
    await wait(60);
    expect(calls).toHaveLength(2);
  });

  it('shows the new, empty day on the first refresh after local midnight', async () => {
    vi.setSystemTime(new Date('2026-11-15T22:59:55Z')); // 23:59:55 in Berlin
    const calls = api(
      () => json(board, '"7-1763161200000"'),
      () => json(empty, '"7-1763247600000"'),
    );
    feed.start();
    await settle();

    await wait(10);

    expect(calls.map(({ from }) => from)).toEqual([
      '2026-11-14T23:00:00.000Z',
      '2026-11-15T23:00:00.000Z',
    ]);
    expect(feed.state.value.board).toEqual(empty);
  });

  it('follows daylight saving: the day after the change starts an hour earlier in UTC', async () => {
    vi.setSystemTime(new Date('2026-03-29T21:59:55Z')); // 23:59:55 CEST, the day the clocks went forward
    const calls = api(() => json(empty));
    feed.start();
    await settle();

    await wait(10);

    expect(calls.map(({ from }) => from)).toEqual([
      '2026-03-28T23:00:00.000Z',
      '2026-03-29T22:00:00.000Z',
    ]);
  });

  it('drops an answer that a newer request overtook', async () => {
    let answerFirst: (response: Response) => void = () => undefined;
    api(
      () =>
        new Promise<Response>((resolve) => {
          answerFirst = resolve;
        }),
      () => json(board),
    );
    feed.start();

    await feed.refresh();
    answerFirst(json(empty));
    await settle();

    expect(feed.state.value.board).toEqual(board);
  });

  it('drops an answer for a day that ended while it was on its way, and asks for the new day', async () => {
    vi.setSystemTime(new Date('2026-11-15T22:59:59Z'));
    let answerLate: (response: Response) => void = () => undefined;
    const calls = api(
      () =>
        new Promise<Response>((resolve) => {
          answerLate = resolve;
        }),
      () => json(empty),
    );
    feed.start();

    vi.setSystemTime(new Date('2026-11-15T23:00:01Z'));
    answerLate(json(board));
    await settle();

    expect(calls.map(({ from }) => from)).toEqual([
      '2026-11-14T23:00:00.000Z',
      '2026-11-15T23:00:00.000Z',
    ]);
    expect(feed.state.value.board).toEqual(empty);
  });

  it('keeps the last standings with the time of their refresh when a refresh fails, and retries with backoff up to 60 s', async () => {
    const calls = api(() => json(board), offline);
    feed.start();
    await settle();
    expect(feed.state.value).toMatchObject({ stale: false });

    const retries: number[] = [];
    let seconds = 0;
    let seen = calls.length;
    while (retries.length < 7) {
      await wait(1);
      seconds += 1;
      if (calls.length > seen) {
        retries.push(seconds);
        seconds = 0;
        seen = calls.length;
      }
    }

    // The first failure is the regular refresh after 10 s.
    expect(retries).toEqual([10, 5, 10, 20, 40, 60, 60]);
    expect(feed.state.value.board).toEqual(board);
    expect(feed.state.value.stale).toBe(true);
    expect(feed.state.value.updatedAt).toEqual(
      new Date('2026-11-15T22:41:00Z'),
    );
  });

  it('is current again after the next successful refresh', async () => {
    api(offline, () => json(board));
    feed.start();
    await settle();
    expect(feed.state.value.stale).toBe(true);

    await wait(5);

    expect(feed.state.value.stale).toBe(false);
    expect(feed.state.value.board).toEqual(board);
  });

  it('shows the maintenance snackbar on 503 and retries after its Retry-After', async () => {
    const calls = api(
      () => json(board),
      () => maintenance(3),
      () => json(board),
    );
    feed.start();
    await settle();
    await wait(10);

    expect(useSnackbar().value?.text).toBe(
      'Wird aktualisiert – gleich wieder da',
    );
    expect(feed.state.value.board).toEqual(board);
    await wait(2.9);
    expect(calls).toHaveLength(2);
    await wait(0.1);
    expect(calls).toHaveLength(3);
  });
});

describe('reading the standings', () => {
  it('reads a person’s score and drink counters, 0 without entries', () => {
    expect(scoreOf(board, 1)).toBe(13.5);
    expect(scoreOf(board, 2)).toBe(0);
    expect(counterOf(board, 1, 2)).toBe(2);
    expect(counterOf(board, 1, 3)).toBe(0);
    expect(counterOf(undefined, 1, 1)).toBe(0);
  });
});
