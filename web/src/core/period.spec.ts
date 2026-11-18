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
  localDaysOf,
  addMonths,
  monthOf,
  monthWindow,
  periodKey,
  queryOf,
  sameDate,
  step,
  weekOf,
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

  it.each([
    // Any day of a week chooses that week, held as its Monday.
    [date(2026, 11, 16), date(2026, 11, 16)],
    [date(2026, 11, 19), date(2026, 11, 16)],
    [date(2026, 11, 22), date(2026, 11, 16)],
    [date(2026, 11, 23), date(2026, 11, 23)],
    // Across a month and a year end.
    [date(2026, 3, 1), date(2026, 2, 23)],
    [date(2026, 1, 1), date(2025, 12, 29)],
  ])('holds the week of %o as its Monday %o', (day, monday) => {
    expect(weekOf(day)).toEqual({ kind: 'week', date: monday });
  });

  it('sends a week as its local Monday midnight up to the next Monday’s', () => {
    expect(queryOf(weekOf(date(2026, 11, 18)))).toEqual({
      from: '2026-11-15T23:00:00.000Z',
      to: '2026-11-22T23:00:00.000Z',
    });
  });

  it.each([
    // The clocks go back on Sunday 25.10.2026: the week has 169 hours.
    [
      date(2026, 10, 19),
      '2026-10-18T22:00:00.000Z',
      '2026-10-25T23:00:00.000Z',
      169,
    ],
    // The clocks go forward on Sunday 29.03.2026: the week has 167 hours.
    [
      date(2026, 3, 23),
      '2026-03-22T23:00:00.000Z',
      '2026-03-29T22:00:00.000Z',
      167,
    ],
    // Across the year end.
    [
      date(2025, 12, 29),
      '2025-12-28T23:00:00.000Z',
      '2026-01-04T23:00:00.000Z',
      168,
    ],
  ])(
    'builds a week’s window by calendar addition, its full local Monday to Sunday (%o)',
    (monday, from, to, hours) => {
      const window = queryOf(weekOf(monday));

      expect(window).toEqual({ from, to });
      expect((Date.parse(to) - Date.parse(from)) / 3_600_000).toBe(hours);
    },
  );

  it('sends all time as scope=all, never a sentinel date, and the current run without any window', () => {
    expect(queryOf({ kind: 'all' })).toEqual({ scope: 'all' });
    expect(queryOf({ kind: 'run' })).toEqual({});
  });

  it('names each period apart, the same calendar day alike', () => {
    expect(
      [
        { kind: 'day', date: date(2026, 11, 14) },
        { kind: 'day', date: date(2026, 11, 4) },
        weekOf(date(2026, 11, 4)),
        { kind: 'all' },
        { kind: 'run' },
      ].map((period) => periodKey(period as never)),
    ).toEqual([
      'day-2026-11-14',
      'day-2026-11-04',
      'week-2026-11-02',
      'all',
      'run',
    ]);
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

  it('labels the bar Diese Woche, Letzte Woche or the week number and its days', () => {
    const today = date(2026, 11, 17);

    expect(barLabel(weekOf(today), today)).toBe('Diese Woche');
    expect(barLabel(weekOf(date(2026, 11, 10)), today)).toBe('Letzte Woche');
    expect(barLabel(weekOf(date(2026, 11, 2)), today)).toBe(
      'KW 45 · 02.11.–08.11.',
    );
  });

  it('names a week in the top bar by its number and days, the current one too', () => {
    const today = date(2026, 11, 17);

    expect(contextLine(weekOf(today), today)).toBe('KW 47 · 16.11.–22.11.');
    expect(contextLine(weekOf(date(2026, 11, 10)), today)).toBe(
      'KW 46 · 09.11.–15.11.',
    );
  });

  it.each([
    // The Thursday rule: a week belongs to the year its Thursday lies in.
    [date(2025, 12, 29), 'KW 1 · 29.12.–04.01.'],
    [date(2026, 1, 1), 'KW 1 · 29.12.–04.01.'],
    [date(2026, 12, 31), 'KW 53 · 28.12.–03.01.'],
    [date(2027, 1, 3), 'KW 53 · 28.12.–03.01.'],
    [date(2027, 1, 4), 'KW 1 · 04.01.–10.01.'],
    [date(2021, 1, 1), 'KW 53 · 28.12.–03.01.'],
    // Weeks with a daylight-saving change.
    [date(2026, 3, 29), 'KW 13 · 23.03.–29.03.'],
    [date(2026, 10, 25), 'KW 43 · 19.10.–25.10.'],
  ])('numbers the week of %o by ISO 8601: %s', (day, line) => {
    expect(contextLine(weekOf(day), date(2027, 6, 1))).toBe(line);
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
      ['day', 'week', 'all', 'run'].map((kind) => kindLabel(kind as never)),
    ).toEqual(['Tag', 'Woche', 'Gesamt', 'Aktuell']);
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

  it('steps a week back and forward but never past the current week', () => {
    const today = date(2026, 11, 17);
    const lastWeek = weekOf(date(2026, 11, 9));

    expect(step(lastWeek, -1, today)).toEqual(weekOf(date(2026, 11, 2)));
    expect(step(lastWeek, -3, today)).toEqual(weekOf(date(2026, 10, 19)));
    expect(step(lastWeek, 1, today)).toEqual(weekOf(today));
    expect(step(weekOf(today), 1, today)).toEqual(weekOf(today));
    expect(step(weekOf(date(2026, 1, 1)), -1, today)).toEqual(
      weekOf(date(2025, 12, 22)),
    );
  });

  it('keeps only the periods that contain the present live', () => {
    const today = date(2026, 11, 16);

    expect(isLive({ kind: 'day', date: today }, today)).toBe(true);
    expect(isLive({ kind: 'day', date: date(2026, 11, 15) }, today)).toBe(
      false,
    );
    expect(isLive(weekOf(date(2026, 11, 22)), today)).toBe(true);
    expect(isLive(weekOf(date(2026, 11, 15)), today)).toBe(false);
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

  /** A span `[from, to)` in UTC, from minutes: `span('2026-11-13T22:45', '2026-11-13T23:15')`. */
  const span = (from: string, to: string) => ({
    from: `${from}:00.000Z`,
    to: `${to}:00.000Z`,
  });

  it('finds the local days the sessions with data touch, each day once, ascending; a session over midnight touches both days', () => {
    const spans = [
      span('2026-11-13T22:45', '2026-11-13T23:15'), // Friday 23:45 to Saturday 00:15 in Berlin
      span('2026-11-14T20:15', '2026-11-14T22:00'),
      span('2026-11-16T19:00', '2026-11-16T19:15'),
    ];

    expect(localDaysOf(spans)).toEqual([
      date(2026, 11, 13),
      date(2026, 11, 14),
      date(2026, 11, 16),
    ]);
    process.env.TZ = 'America/New_York';
    expect(localDaysOf(spans)).toEqual([
      date(2026, 11, 13),
      date(2026, 11, 14),
      date(2026, 11, 16),
    ]);
    process.env.TZ = 'Asia/Kathmandu'; // +05:45: 18:15Z is midnight
    expect(localDaysOf([span('2026-11-13T18:00', '2026-11-13T18:30')])).toEqual(
      [date(2026, 11, 13), date(2026, 11, 14)],
    );
    expect(localDaysOf([span('2026-11-13T18:00', '2026-11-13T18:15')])).toEqual(
      [date(2026, 11, 13)],
    );
    expect(localDaysOf([])).toEqual([]);
  });

  it('finds the local days of sessions on a day the clocks change on and over a year’s end', () => {
    expect(
      localDaysOf([
        span('2026-10-24T21:45', '2026-10-24T22:15'), // Saturday 23:45 summer time to Sunday 00:15
        span('2026-10-25T22:45', '2026-10-25T23:00'), // 23:45 winter time, still Sunday
        span('2026-12-31T22:45', '2027-01-01T00:00'), // New Year’s Eve 23:45 to 01:00
      ]),
    ).toEqual([
      date(2026, 10, 24),
      date(2026, 10, 25),
      date(2026, 12, 31),
      date(2027, 1, 1),
    ]);
  });

  it.each([
    [
      'Europe/Berlin',
      date(2026, 11, 1),
      '2026-10-31T23:00:00.000Z',
      '2026-11-30T23:00:00.000Z',
    ],
    [
      'Europe/Berlin',
      date(2026, 10, 1),
      '2026-09-30T22:00:00.000Z',
      '2026-10-31T23:00:00.000Z',
    ],
    [
      'Europe/Berlin',
      date(2026, 12, 1),
      '2026-11-30T23:00:00.000Z',
      '2026-12-31T23:00:00.000Z',
    ],
    [
      'Asia/Kathmandu',
      date(2026, 2, 1),
      '2026-01-31T18:15:00.000Z',
      '2026-02-28T18:15:00.000Z',
    ],
    [
      'Pacific/Marquesas',
      date(2028, 2, 1),
      '2028-02-01T09:30:00.000Z',
      '2028-03-01T09:30:00.000Z',
    ],
  ])(
    'builds a month’s window in %s from local midnight of its first day to the next month’s (%o)',
    (zone, month, from, to) => {
      process.env.TZ = zone;

      expect(monthWindow(month)).toEqual({ from, to });
      expect(monthWindow({ ...month, day: 17 })).toEqual({ from, to });
    },
  );

  it('steps months by calendar addition over a year’s end', () => {
    expect(addMonths(date(2026, 12, 1), 1)).toEqual(date(2027, 1, 1));
    expect(addMonths(date(2026, 1, 1), -1)).toEqual(date(2025, 12, 1));
    expect(monthOf(date(2026, 11, 17))).toEqual(date(2026, 11, 1));
  });
});
