import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Scoreboard } from './api-client';
import type { PeriodResource } from './period-resource';
import { createPeriodScoreboard, type DrinksPeriod } from './period-scoreboard';

const board: Scoreboard = { rows: [], unranked: [] };

/** A fake API that records each scoreboard query with its ETag; `hold` keeps answers back until released. */
function api() {
  const calls: { query: string; ifNoneMatch: string | undefined }[] = [];
  const held: (() => void)[] = [];
  let holding = false;
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init: RequestInit) => {
      const headers = init.headers as Record<string, string>;
      calls.push({
        query: decodeURIComponent(new URL(url, 'http://app').search),
        ifNoneMatch: headers['If-None-Match'],
      });
      if (holding) await new Promise<void>((resolve) => held.push(resolve));
      return new Response(JSON.stringify(board), {
        status: 200,
        headers: { 'Content-Type': 'application/json', ETag: '"1-x"' },
      });
    }),
  );
  return {
    calls,
    hold() {
      holding = true;
    },
    release() {
      holding = false;
      for (const resolve of held.splice(0)) resolve();
    },
  };
}

const settle = () => vi.advanceTimersByTimeAsync(0);
const day = (date: string): DrinksPeriod => {
  const [year = 0, month = 0, dayOfMonth = 0] = date.split('-').map(Number);
  return { kind: 'day', date: { year, month, day: dayOfMonth } };
};

describe('the scoreboard of a period', () => {
  const zone = process.env.TZ;
  let scoreboard: PeriodResource<DrinksPeriod, Scoreboard> | undefined;

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
    scoreboard?.stop();
    scoreboard = undefined;
    vi.useRealTimers();
    vi.unstubAllGlobals();
    process.env.TZ = zone;
  });

  it('reads a past day from its local midnight to the next one and asks again only on focus, not by polling', async () => {
    const { calls } = api();
    scoreboard = createPeriodScoreboard();
    scoreboard.show(day('2026-11-14'));
    scoreboard.start();
    await settle();

    await vi.advanceTimersByTimeAsync(60_000);
    window.dispatchEvent(new Event('focus'));
    await settle();

    expect(calls).toEqual([
      {
        query: '?from=2026-11-13T23:00:00.000Z&to=2026-11-14T23:00:00.000Z',
        ifNoneMatch: undefined,
      },
      {
        query: '?from=2026-11-13T23:00:00.000Z&to=2026-11-14T23:00:00.000Z',
        ifNoneMatch: '"1-x"',
      },
    ]);
    expect(scoreboard.state.value.value).toEqual(board);
  });

  it('reads all time with scope=all and keeps it current every 10 s, as it contains the present', async () => {
    const { calls } = api();
    scoreboard = createPeriodScoreboard();
    scoreboard.show({ kind: 'all' });
    scoreboard.start();
    await settle();

    await vi.advanceTimersByTimeAsync(10_000);

    expect(calls.map(({ query }) => query)).toEqual([
      '?scope=all',
      '?scope=all',
    ]);
  });

  it('reads the same calendar day with a window rebuilt for the time zone in use after a change', async () => {
    const { calls } = api();
    scoreboard = createPeriodScoreboard();
    scoreboard.show(day('2026-11-14'));
    scoreboard.start();
    await settle();

    process.env.TZ = 'America/New_York';
    window.dispatchEvent(new Event('focus'));
    await settle();

    expect(calls.map(({ query }) => query)).toEqual([
      '?from=2026-11-13T23:00:00.000Z&to=2026-11-14T23:00:00.000Z',
      '?from=2026-11-14T05:00:00.000Z&to=2026-11-15T05:00:00.000Z',
    ]);
  });

  it('drops an answer for a window that changed while it was on its way, and asks for the rebuilt one', async () => {
    const fake = api();
    scoreboard = createPeriodScoreboard();
    scoreboard.show(day('2026-11-14'));
    fake.hold();
    scoreboard.start();
    await settle();

    process.env.TZ = 'America/New_York';
    fake.release();
    await settle();

    expect(fake.calls.map(({ query }) => query)).toEqual([
      '?from=2026-11-13T23:00:00.000Z&to=2026-11-14T23:00:00.000Z',
      '?from=2026-11-14T05:00:00.000Z&to=2026-11-15T05:00:00.000Z',
    ]);
    expect(scoreboard.state.value.value).toEqual(board);
  });
});
