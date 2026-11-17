import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { DaysAnswer } from './api-client';
import { createDaysRead, type DaysRead } from './days-with-data';

const SATURDAY = ['2026-11-14T20:00:00.000Z'];
const SUNDAY = [...SATURDAY, '2026-11-15T19:30:00.000Z'];

/** A days read that answers `answers` in turn (the last one from then on) and records each ETag it was asked with. */
function readOf(...answers: (string[] | 'unchanged')[]) {
  const asked: (string | undefined)[] = [];
  const read = vi.fn(
    async (etag?: string): Promise<DaysAnswer | 'unchanged'> => {
      asked.push(etag);
      const answer = answers.length > 1 ? answers.shift() : answers[0];
      if (answer === undefined) throw new Error('no answer');
      return answer === 'unchanged'
        ? 'unchanged'
        : { instants: answer, etag: `"${String(asked.length)}"` };
    },
  );
  return { read, asked };
}

const settle = () => vi.advanceTimersByTimeAsync(0);

describe('a days-with-data read', () => {
  let days: DaysRead | undefined;

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout'] });
    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      get: () => 'visible',
    });
  });

  afterEach(() => {
    days?.stop();
    days = undefined;
    vi.useRealTimers();
  });

  it('reads the quarter hours when a screen starts it, and not before', async () => {
    const { read, asked } = readOf(SATURDAY);
    days = createDaysRead(read);
    await settle();
    expect(asked).toEqual([]);

    days.start();
    await settle();

    expect(days.state.value.value).toEqual(SATURDAY);
    expect(asked).toEqual([undefined]);
  });

  it('does not poll, but reads again on focus on condition of its ETag; 304 keeps the instants', async () => {
    const { read, asked } = readOf(SATURDAY, 'unchanged');
    days = createDaysRead(read);
    days.start();
    await settle();

    await vi.advanceTimersByTimeAsync(60_000);
    expect(asked).toEqual([undefined]);
    window.dispatchEvent(new Event('focus'));
    await settle();

    expect(asked).toEqual([undefined, '"1"']);
    expect(days.state.value.value).toEqual(SATURDAY);
  });

  it('polls every 10 s on condition of its ETag while a screen runs it live, and stops polling when that screen stops', async () => {
    const { read, asked } = readOf(SATURDAY, 'unchanged', SUNDAY);
    days = createDaysRead(read);
    days.start(true);
    await settle();

    await vi.advanceTimersByTimeAsync(10_000);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(asked).toEqual([undefined, '"1"', '"1"']);
    expect(days.state.value.value).toEqual(SUNDAY);
    days.stop(true);
    days.start();
    await settle();
    await vi.advanceTimersByTimeAsync(60_000);

    expect(asked).toEqual([undefined, '"1"', '"1"', '"3"']);
  });

  it('reads again after the device’s own writes while a screen runs it, and on the next start otherwise', async () => {
    const { read, asked } = readOf(SATURDAY, SUNDAY);
    days = createDaysRead(read);
    days.start();
    await settle();

    await days.refresh();
    expect(days.state.value.value).toEqual(SUNDAY);
    days.stop();
    await days.refresh();
    expect(asked).toEqual([undefined, '"1"']);

    days.start();
    await settle();
    expect(asked).toEqual([undefined, '"1"', '"2"']);
    expect(days.state.value.value).toEqual(SUNDAY);
  });

  it('keeps the instants while no screen runs it, so a screen shows them at once', async () => {
    const { read } = readOf(SATURDAY);
    days = createDaysRead(read);
    days.start();
    await settle();

    days.stop();

    expect(days.state.value.value).toEqual(SATURDAY);
  });
});
