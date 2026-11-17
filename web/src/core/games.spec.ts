import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { effectScope, nextTick, shallowRef } from 'vue';
import type { Standings } from './api-client';
import {
  type GamePeriod,
  type GameSelection,
  gameDays,
  refreshStandings,
  usePeriodStandings,
  useStandings,
  viewStandings,
} from './games';

const standings = (gameId: number, name = 'Anna'): Standings => ({
  kind: 'duel',
  startedAt: '2026-09-15T10:00:00.000Z',
  rows: [
    {
      personId: gameId,
      name,
      points: 1,
      wins: 1,
      draws: 0,
      losses: 0,
      played: 1,
      pendingCount: 0,
    },
  ],
  unranked: [],
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

describe('a game’s ranking of a period', () => {
  const zone = process.env.TZ;

  beforeEach(() => {
    process.env.TZ = 'Europe/Berlin';
    vi.useFakeTimers({
      now: new Date('2026-11-15T22:41:00Z'),
      toFake: ['Date', 'setTimeout', 'clearTimeout'],
    });
    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      get: () => 'visible',
    });
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    process.env.TZ = zone;
  });

  interface Asked {
    url: string;
    ifNoneMatch: string | undefined;
  }

  /**
  A fake API answering each game's ranking of any selection with ETag `"7-<query>"`
  and 304 on condition of it, its leader named after the measure asked for (`sum`,
  `average`, else `Anna`); `hold` keeps answers back until `release`.
  */
  function periodApi() {
    const asked: Asked[] = [];
    const held: (() => void)[] = [];
    let holding = false;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init: RequestInit) => {
        const ifNoneMatch = (init.headers as Record<string, string>)[
          'If-None-Match'
        ];
        const path = decodeURIComponent(url);
        asked.push({ url: path, ifNoneMatch });
        if (holding) await new Promise<void>((resolve) => held.push(resolve));
        const gameId = Number(/^\/api\/games\/(\d+)\//.exec(path)?.[1]);
        const etag = `"7-${path}"`;
        if (ifNoneMatch === etag) return new Response(null, { status: 304 });
        const measure = /measure=(\w+)/.exec(path)?.[1];
        return new Response(JSON.stringify(standings(gameId, measure)), {
          status: 200,
          headers: { 'Content-Type': 'application/json', ETag: etag },
        });
      }),
    );
    return {
      asked,
      hold() {
        holding = true;
      },
      release() {
        holding = false;
        for (const resolve of held.splice(0)) resolve();
      },
    };
  }

  const SATURDAY: GamePeriod = {
    kind: 'day',
    date: { year: 2026, month: 11, day: 14 },
  };
  const ALL: GamePeriod = { kind: 'all' };

  /** A game's page showing `selection` (changeable), open until `close`. */
  function page(first: GameSelection) {
    const selection = shallowRef<GameSelection | undefined>(first);
    const scope = effectScope();
    const ranking = scope.run(() => usePeriodStandings(selection));
    return { selection, ranking, close: () => scope.stop() };
  }

  it('reads a past day with its local window and all time with scope=all, polling only all time', async () => {
    const api = periodApi();
    const shown = page({ gameId: 2, period: SATURDAY });
    await wait(60);
    shown.selection.value = { gameId: 2, period: ALL };
    await wait(10);
    shown.close();

    expect(api.asked.map(({ url }) => url)).toEqual([
      '/api/games/2/standings?from=2026-11-13T23:00:00.000Z&to=2026-11-14T23:00:00.000Z',
      '/api/games/2/standings?scope=all',
      '/api/games/2/standings?scope=all',
    ]);
    expect(api.asked[2]?.ifNoneMatch).toBe(
      '"7-/api/games/2/standings?scope=all"',
    );
  });

  it('shows only the shown game’s ranking when another game’s answer arrives late, and sends no ETag of one game for another', async () => {
    const api = periodApi();
    const shown = page({ gameId: 2, period: ALL });
    await wait(0);
    api.hold();
    await wait(10);

    shown.selection.value = { gameId: 3, period: ALL };
    await wait(0);
    api.release();
    await wait(0);

    expect(shown.ranking?.value.value).toEqual(standings(3));
    shown.close();
    expect(api.asked.map(({ url, ifNoneMatch }) => [url, ifNoneMatch])).toEqual(
      [
        ['/api/games/2/standings?scope=all', undefined],
        [
          '/api/games/2/standings?scope=all',
          '"7-/api/games/2/standings?scope=all"',
        ],
        ['/api/games/3/standings?scope=all', undefined],
      ],
    );
  });

  it('asks for the measure with the window and keeps each measure’s ranking: switching back shows it at once, on condition of its ETag', async () => {
    const api = periodApi();
    const shown = page({ gameId: 2, period: ALL, measure: 'sum' });
    await wait(0);
    shown.selection.value = { gameId: 2, period: ALL, measure: 'average' };
    await wait(0);

    shown.selection.value = { gameId: 2, period: ALL, measure: 'sum' };
    await nextTick();

    expect(shown.ranking?.value.value).toEqual(standings(2, 'sum'));
    await wait(0);
    shown.close();
    expect(api.asked.map(({ url, ifNoneMatch }) => [url, ifNoneMatch])).toEqual(
      [
        ['/api/games/2/standings?scope=all&measure=sum', undefined],
        ['/api/games/2/standings?scope=all&measure=average', undefined],
        [
          '/api/games/2/standings?scope=all&measure=sum',
          '"7-/api/games/2/standings?scope=all&measure=sum"',
        ],
      ],
    );
  });

  it('shows the chosen measure’s ranking when the answers for quick switches arrive out of order', async () => {
    periodApi();
    const shown = page({ gameId: 2, period: ALL, measure: 'sum' });
    await wait(0);
    const api = periodApi();
    api.hold();
    shown.selection.value = { gameId: 2, period: ALL, measure: 'average' };
    await wait(0);
    shown.selection.value = { gameId: 2, period: ALL, measure: 'sum' };
    await wait(0);
    shown.selection.value = { gameId: 2, period: ALL, measure: 'average' };
    await wait(0);

    api.release();
    await wait(0);

    expect(shown.ranking?.value.value).toEqual(standings(2, 'average'));
    shown.close();
  });

  it('forgets every ranking of the page once it closes', async () => {
    const api = periodApi();
    const shown = page({ gameId: 2, period: ALL, measure: 'average' });
    await wait(0);
    shown.close();

    const again = page({ gameId: 2, period: ALL, measure: 'average' });
    await wait(0);
    again.close();

    expect(api.asked.map(({ ifNoneMatch }) => ifNoneMatch)).toEqual([
      undefined,
      undefined,
    ]);
  });

  it('is read again after the device’s own writes to its game, not to another game', async () => {
    const api = periodApi();
    const shown = page({ gameId: 2, period: SATURDAY });
    await wait(0);

    await refreshStandings(3);
    await refreshStandings(2);
    shown.close();
    await refreshStandings(2);

    expect(
      api.asked.filter(({ url }) => url.startsWith('/api/games/2/standings?')),
    ).toHaveLength(2);
  });

  it('reads the quarter hours a game was played per game, on condition of each game’s own ETag', async () => {
    const api = periodApi();
    const schach = gameDays(2);
    const rommé = gameDays(3);

    schach.start();
    rommé.start();
    await wait(0);
    window.dispatchEvent(new Event('focus'));
    await wait(0);
    schach.stop();
    rommé.stop();

    expect(api.asked.map(({ url, ifNoneMatch }) => [url, ifNoneMatch])).toEqual(
      [
        ['/api/games/2/standings/days', undefined],
        ['/api/games/3/standings/days', undefined],
        ['/api/games/2/standings/days', '"7-/api/games/2/standings/days"'],
        ['/api/games/3/standings/days', '"7-/api/games/3/standings/days"'],
      ],
    );
  });
});
