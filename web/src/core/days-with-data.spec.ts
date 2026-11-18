import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { DaysAnswer, DaysSelection, Span } from './api-client';
import {
  createDaysRead,
  createDaysReads,
  type DaysRead,
  type DaysReads,
} from './days-with-data';

const SATURDAY: Span[] = [
  { from: '2026-11-14T19:00:00.000Z', to: '2026-11-14T23:15:00.000Z' },
];
const SUNDAY: Span[] = [
  ...SATURDAY,
  { from: '2026-11-15T19:30:00.000Z', to: '2026-11-15T20:00:00.000Z' },
];
const NOVEMBER = { year: 2026, month: 11, day: 1 };
const OCTOBER = { year: 2026, month: 10, day: 1 };

/** The query of a selection as the API gets it: `scope=all` or `<from>/<to>`. */
const queryOf = (selection: DaysSelection) =>
  'scope' in selection ? 'scope=all' : `${selection.from}/${selection.to}`;

/**
A days read that answers `answers` in turn (the last one from then on) and records
each selection and ETag it was asked with; an answer's ETag names its selection and
the number of the request.
*/
function readOf(...answers: (Span[] | 'unchanged')[]) {
  const asked: (string | undefined)[] = [];
  const queries: string[] = [];
  const held: (() => void)[] = [];
  let holding = false;
  const read = vi.fn(
    async (
      selection: DaysSelection,
      etag?: string,
    ): Promise<DaysAnswer | 'unchanged'> => {
      asked.push(etag);
      queries.push(queryOf(selection));
      const number = asked.length;
      if (holding) await new Promise<void>((resolve) => held.push(resolve));
      const answer = answers.length > 1 ? answers.shift() : answers[0];
      if (answer === undefined) throw new Error('no answer');
      return answer === 'unchanged'
        ? 'unchanged'
        : { spans: answer, etag: `"${String(number)}"` };
    },
  );
  return {
    read,
    asked,
    queries,
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

describe('the all-time days-with-data read', () => {
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

  it('reads the sessions of all time when a screen starts it, and not before', async () => {
    const { read, asked, queries } = readOf(SATURDAY);
    days = createDaysRead(read);
    await settle();
    expect(asked).toEqual([]);

    days.start();
    await settle();

    expect(days.state.value.value).toEqual(SATURDAY);
    expect(asked).toEqual([undefined]);
    expect(queries).toEqual(['scope=all']);
  });

  it('does not poll, but reads again on focus on condition of its ETag; 304 keeps the spans', async () => {
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

  it('polls once every 10 s for two live screens, on while one of them stays, and from the moment a screen enters `Gesamt` again', async () => {
    const { read, asked } = readOf(SATURDAY, 'unchanged');
    days = createDaysRead(read);
    // Two screens show `Gesamt` (a page and the one stacked over it).
    days.start(true);
    days.start(true);
    await settle();
    await vi.advanceTimersByTimeAsync(10_000);
    expect(asked).toEqual([undefined, '"1"']);

    // The first one closes: the second keeps it live.
    days.stop(true);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(asked).toEqual([undefined, '"1"', '"1"']);

    // The second leaves `Gesamt`: nothing polls, and the spans stay.
    days.stop(true);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(asked).toEqual([undefined, '"1"', '"1"']);
    expect(days.state.value.value).toEqual(SATURDAY);

    // … and enters it again: read at once on condition of the ETag, then polled.
    days.start(true);
    await settle();
    await vi.advanceTimersByTimeAsync(10_000);
    expect(asked).toEqual([undefined, '"1"', '"1"', '"1"', '"1"']);
    days.stop(true);
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

  it('keeps the spans while no screen runs it, so a screen shows them at once', async () => {
    const { read } = readOf(SATURDAY);
    days = createDaysRead(read);
    days.start();
    await settle();

    days.stop();

    expect(days.state.value.value).toEqual(SATURDAY);
  });
});

describe('the month reads of the calendar', () => {
  const zone = process.env.TZ;
  let days: DaysReads | undefined;

  beforeEach(() => {
    process.env.TZ = 'Europe/Berlin';
    vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout'] });
    vi.setSystemTime(new Date('2026-11-17T21:00:00Z'));
    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      get: () => 'visible',
    });
  });

  afterEach(() => {
    days?.months.forget();
    days?.months.stop();
    days = undefined;
    vi.useRealTimers();
    process.env.TZ = zone;
  });

  it('reads the month shown in its window, from local midnight of its first day to the next month’s, and never polls it', async () => {
    const { read, queries } = readOf(SATURDAY);
    days = createDaysReads(read);

    days.months.show(NOVEMBER);
    days.months.start();
    await settle();
    await vi.advanceTimersByTimeAsync(120_000);

    expect(queries).toEqual([
      '2026-10-31T23:00:00.000Z/2026-11-30T23:00:00.000Z',
    ]);
    expect(days.months.state.value.value).toEqual(SATURDAY);
  });

  it('keeps each month’s spans and ETag apart: browsing back to a month shows its dots at once and asks on condition of its own ETag', async () => {
    const { read, asked, queries } = readOf(SATURDAY, [], 'unchanged');
    days = createDaysReads(read);
    days.months.show(NOVEMBER);
    days.months.start();
    await settle();

    days.months.show(OCTOBER);
    await settle();
    expect(days.months.state.value.value).toEqual([]);
    days.months.show(NOVEMBER);
    const shownAtOnce = days.months.state.value.value;
    await settle();

    expect(shownAtOnce).toEqual(SATURDAY);
    expect(days.months.state.value.value).toEqual(SATURDAY);
    expect(queries).toEqual([
      '2026-10-31T23:00:00.000Z/2026-11-30T23:00:00.000Z',
      '2026-09-30T22:00:00.000Z/2026-10-31T23:00:00.000Z',
      '2026-10-31T23:00:00.000Z/2026-11-30T23:00:00.000Z',
    ]);
    expect(asked).toEqual([undefined, undefined, '"1"']);
  });

  it('reads the shown month again on focus and after the device’s own writes, and nothing while the calendar is closed', async () => {
    const { read, queries } = readOf(SATURDAY, 'unchanged');
    days = createDaysReads(read);
    days.months.show(NOVEMBER);
    days.months.start();
    await settle();

    window.dispatchEvent(new Event('focus'));
    await settle();
    await days.refresh();
    days.months.show(undefined);
    days.months.stop();
    await days.refresh();
    window.dispatchEvent(new Event('focus'));
    await settle();

    expect(queries).toHaveLength(3);
  });

  it('asks for the month’s window in the new time zone once it changed while the month was kept, and shows that answer', async () => {
    const { read, queries } = readOf(SATURDAY, SUNDAY);
    days = createDaysReads(read);
    days.months.show(NOVEMBER);
    days.months.start();
    await settle();
    days.months.show(undefined);

    process.env.TZ = 'America/New_York';
    days.months.show(NOVEMBER);
    await settle();

    expect(queries).toEqual([
      '2026-10-31T23:00:00.000Z/2026-11-30T23:00:00.000Z',
      '2026-11-01T04:00:00.000Z/2026-12-01T05:00:00.000Z',
    ]);
    expect(days.months.state.value.value).toEqual(SUNDAY);
  });

  it('drops an answer for the month’s window of the time zone that changed while it was on its way, and asks for the new one', async () => {
    const api = readOf(SATURDAY, SUNDAY);
    days = createDaysReads(api.read);
    api.hold();
    days.months.show(NOVEMBER);
    days.months.start();
    await settle();

    process.env.TZ = 'Asia/Kathmandu';
    api.release();
    await settle();
    api.release();
    await settle();

    expect(api.queries).toEqual([
      '2026-10-31T23:00:00.000Z/2026-11-30T23:00:00.000Z',
      '2026-10-31T18:15:00.000Z/2026-11-30T18:15:00.000Z',
    ]);
    expect(days.months.state.value.value).toEqual(SUNDAY);
  });
});
