import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  type CalendarDate,
  addDays,
  barLabel,
  calendarDateOf,
  contextLine,
  isLive,
  isToday,
  kindLabel,
  periodKey,
  queryOf,
  sameDate,
  step,
} from './period';

const date = (year: number, month: number, day: number): CalendarDate => ({
  year,
  month,
  day,
});

describe('the period module', () => {
  const zone = process.env.TZ;

  beforeEach(() => {
    process.env.TZ = 'Europe/Berlin';
  });

  afterEach(() => {
    process.env.TZ = zone;
  });

  it('takes the local calendar date of an instant, not its UTC date', () => {
    expect(calendarDateOf(new Date('2026-11-15T23:30:00Z'))).toEqual(
      date(2026, 11, 16),
    );
    process.env.TZ = 'America/New_York';
    expect(calendarDateOf(new Date('2026-11-15T23:30:00Z'))).toEqual(
      date(2026, 11, 15),
    );
  });

  it.each([
    [date(2026, 11, 16), -1, date(2026, 11, 15)],
    [date(2026, 3, 1), -1, date(2026, 2, 28)],
    [date(2028, 3, 1), -1, date(2028, 2, 29)],
    [date(2026, 1, 1), -1, date(2025, 12, 31)],
    [date(2025, 12, 31), 1, date(2026, 1, 1)],
    [date(2026, 10, 25), 1, date(2026, 10, 26)],
  ])('adds calendar days: %o %i → %o', (from, days, to) => {
    expect(addDays(from, days)).toEqual(to);
  });

  it('sends a day as its local midnight up to the next one', () => {
    expect(queryOf({ kind: 'day', date: date(2026, 11, 14) })).toEqual({
      from: '2026-11-13T23:00:00.000Z',
      to: '2026-11-14T23:00:00.000Z',
    });
  });

  it.each([
    // The clocks go back: the day has 25 hours.
    [
      date(2026, 10, 25),
      '2026-10-24T22:00:00.000Z',
      '2026-10-25T23:00:00.000Z',
    ],
    // The clocks go forward: the day has 23 hours.
    [date(2026, 3, 29), '2026-03-28T23:00:00.000Z', '2026-03-29T22:00:00.000Z'],
    // Across the year end.
    [
      date(2026, 12, 31),
      '2026-12-30T23:00:00.000Z',
      '2026-12-31T23:00:00.000Z',
    ],
  ])(
    'builds a day’s window by calendar addition, not by adding hours (%o)',
    (day, from, to) => {
      expect(queryOf({ kind: 'day', date: day })).toEqual({ from, to });
    },
  );

  it('rebuilds a day’s window in the time zone in use when it is asked', () => {
    const day = { kind: 'day', date: date(2026, 11, 14) } as const;
    const berlin = queryOf(day);

    process.env.TZ = 'America/New_York';

    expect(berlin).toEqual({
      from: '2026-11-13T23:00:00.000Z',
      to: '2026-11-14T23:00:00.000Z',
    });
    expect(queryOf(day)).toEqual({
      from: '2026-11-14T05:00:00.000Z',
      to: '2026-11-15T05:00:00.000Z',
    });
    expect(periodKey(day)).toBe('day-2026-11-14');
  });

  it('sends all time as scope=all, never a sentinel date, and the current run without any window', () => {
    expect(queryOf({ kind: 'all' })).toEqual({ scope: 'all' });
    expect(queryOf({ kind: 'run' })).toEqual({});
  });

  it('names each period apart, the same calendar day alike', () => {
    expect(
      [
        { kind: 'day', date: date(2026, 11, 14) },
        { kind: 'day', date: date(2026, 11, 4) },
        { kind: 'all' },
        { kind: 'run' },
      ].map((period) => periodKey(period as never)),
    ).toEqual(['day-2026-11-14', 'day-2026-11-04', 'all', 'run']);
  });

  it('labels the bar Heute, Gestern or the short weekday and date', () => {
    const today = date(2026, 11, 16);

    expect(barLabel({ kind: 'day', date: today }, today)).toBe('Heute');
    expect(barLabel({ kind: 'day', date: date(2026, 11, 15) }, today)).toBe(
      'Gestern',
    );
    expect(barLabel({ kind: 'day', date: date(2026, 11, 14) }, today)).toBe(
      'Sa., 14.11.',
    );
    expect(barLabel({ kind: 'day', date: date(2025, 12, 31) }, today)).toBe(
      'Mi., 31.12.',
    );
  });

  it('names the period in the top bar: Heute, the full date, Gesamt or Aktuell', () => {
    const today = date(2026, 11, 17);

    expect(contextLine({ kind: 'day', date: today }, today)).toBe('Heute');
    expect(contextLine({ kind: 'day', date: date(2026, 11, 16) }, today)).toBe(
      'Montag, 16.11.2026',
    );
    expect(contextLine({ kind: 'all' }, today)).toBe('Gesamt');
    expect(contextLine({ kind: 'run' }, today)).toBe('Aktuell');
  });

  it('names the kinds as the switch shows them', () => {
    expect(
      ['day', 'all', 'run'].map((kind) => kindLabel(kind as never)),
    ).toEqual(['Tag', 'Gesamt', 'Aktuell']);
  });

  it('steps a day back and forward but never past today', () => {
    const today = date(2026, 11, 16);
    const yesterday = { kind: 'day', date: date(2026, 11, 15) } as const;

    expect(step(yesterday, -1, today)).toEqual({
      kind: 'day',
      date: date(2026, 11, 14),
    });
    expect(step(yesterday, 1, today)).toEqual({ kind: 'day', date: today });
    expect(step({ kind: 'day', date: today }, 1, today)).toEqual({
      kind: 'day',
      date: today,
    });
    expect(step({ kind: 'all' }, -1, today)).toEqual({ kind: 'all' });
  });

  it('keeps only the periods that contain the present live', () => {
    const today = date(2026, 11, 16);

    expect(isLive({ kind: 'day', date: today }, today)).toBe(true);
    expect(isLive({ kind: 'day', date: date(2026, 11, 15) }, today)).toBe(
      false,
    );
    expect(isLive({ kind: 'all' }, today)).toBe(true);
    expect(isLive({ kind: 'run' }, today)).toBe(true);
  });

  it('tells today and equal dates apart', () => {
    const today = date(2026, 11, 16);

    expect(isToday({ kind: 'day', date: date(2026, 11, 16) }, today)).toBe(
      true,
    );
    expect(isToday({ kind: 'day', date: date(2026, 11, 15) }, today)).toBe(
      false,
    );
    expect(isToday({ kind: 'all' }, today)).toBe(false);
    expect(sameDate(date(2026, 1, 2), date(2026, 1, 2))).toBe(true);
    expect(sameDate(date(2026, 1, 2), date(2026, 2, 1))).toBe(false);
  });
});
