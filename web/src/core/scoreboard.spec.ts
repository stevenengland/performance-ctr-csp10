import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Scoreboard } from './api-client';
import {
  counterOf,
  refreshScoreboard,
  scoreOf,
  useScoreboard,
} from './scoreboard';

const board: Scoreboard = {
  rows: [
    {
      personId: 1,
      name: 'Daniel',
      score: 13.5,
      count: 6,
      drinks: [
        { drinkId: 1, name: 'Bier', count: 4 },
        { drinkId: 2, name: 'Margarita', count: 2 },
      ],
    },
  ],
};

function answer(body: Scoreboard) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('today’s scoreboard', () => {
  const zone = process.env.TZ;
  afterEach(() => {
    vi.unstubAllGlobals();
    process.env.TZ = zone;
  });

  it('asks for the standings since local midnight, sent as UTC', async () => {
    process.env.TZ = 'Europe/Berlin';
    const fetch = vi.fn(async () => answer(board));
    vi.stubGlobal('fetch', fetch);

    await refreshScoreboard(() => new Date('2026-11-15T22:41:00Z'));

    expect(fetch).toHaveBeenCalledWith(
      '/api/scoreboard?from=2026-11-14T23%3A00%3A00.000Z',
      expect.anything(),
    );
    expect(useScoreboard().value).toEqual(board);
  });

  it('drops an answer that a newer refresh overtook', async () => {
    let answerFirst: (response: Response) => void = () => undefined;
    const fetch = vi
      .fn()
      .mockImplementationOnce(
        () =>
          new Promise<Response>((resolve) => {
            answerFirst = resolve;
          }),
      )
      .mockImplementationOnce(async () => answer(board));
    vi.stubGlobal('fetch', fetch);

    const first = refreshScoreboard();
    await refreshScoreboard();
    answerFirst(answer({ rows: [] }));
    await first;

    expect(useScoreboard().value).toEqual(board);
  });

  it('keeps the last standings when a refresh fails', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => answer(board)),
    );
    await refreshScoreboard();
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => Promise.reject(new TypeError('offline'))),
    );

    await refreshScoreboard();

    expect(useScoreboard().value).toEqual(board);
  });

  it('reads a person’s score and drink counters, 0 without entries', () => {
    expect(scoreOf(board, 1)).toBe(13.5);
    expect(scoreOf(board, 2)).toBe(0);
    expect(counterOf(board, 1, 2)).toBe(2);
    expect(counterOf(board, 1, 3)).toBe(0);
    expect(counterOf(undefined, 1, 1)).toBe(0);
  });
});
