import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { effectScope } from 'vue';
import type { Standings } from './api-client';
import { refreshStandings, useStandings, viewStandings } from './games';

const standings = (gameId: number): Standings => ({
  kind: 'duel',
  startedAt: '2026-09-15T10:00:00.000Z',
  rows: [
    {
      personId: gameId,
      name: 'Anna',
      points: 1,
      wins: 1,
      draws: 0,
      losses: 0,
      played: 1,
    },
  ],
});

interface Call {
  gameId: number;
  ifNoneMatch: string | undefined;
}

/** A fake API whose ranking of each game never changes: ETag `"7"`, 304 on condition of it. */
function api() {
  const calls: Call[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init: RequestInit) => {
      const gameId = Number(/^\/api\/games\/(\d+)\/standings$/.exec(url)?.[1]);
      const ifNoneMatch = (init.headers as Record<string, string>)[
        'If-None-Match'
      ];
      calls.push({ gameId, ifNoneMatch });
      if (ifNoneMatch === '"7"') return new Response(null, { status: 304 });
      return new Response(JSON.stringify(standings(gameId)), {
        status: 200,
        headers: { 'Content-Type': 'application/json', ETag: '"7"' },
      });
    }),
  );
  return calls;
}

async function wait(seconds: number) {
  await vi.advanceTimersByTimeAsync(seconds * 1000);
}

/** A screen showing the game's ranking, open until `close`. */
function screen(gameId: number) {
  const scope = effectScope();
  const ranking = scope.run(() => useStandings(gameId));
  return { ranking, close: () => scope.stop() };
}

describe('a game’s ranking', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      get: () => 'visible',
    });
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('is polled once for every screen that shows it, and stops with the last one', async () => {
    const calls = api();
    const page = screen(11);
    const step = screen(11);
    await wait(0);
    expect(page.ranking?.value.value).toEqual(standings(11));
    expect(step.ranking?.value).toBe(page.ranking?.value);

    await wait(10);
    expect(calls).toEqual([
      { gameId: 11, ifNoneMatch: undefined },
      { gameId: 11, ifNoneMatch: '"7"' },
    ]);

    page.close();
    await wait(10);
    expect(calls).toHaveLength(3);

    step.close();
    await wait(60);
    expect(calls).toHaveLength(3);
  });

  it('keeps one poller per game', async () => {
    const calls = api();
    const schach = screen(12);
    const dame = screen(13);
    await wait(10);

    expect(calls.map(({ gameId }) => gameId)).toEqual([12, 13, 12, 13]);
    schach.close();
    dame.close();
  });

  it('can be read without polling, refreshed on demand', async () => {
    const calls = api();
    const ranking = viewStandings(14);

    await refreshStandings(14);
    await wait(60);

    expect(calls).toHaveLength(1);
    expect(ranking.value.value).toEqual(standings(14));
  });
});
