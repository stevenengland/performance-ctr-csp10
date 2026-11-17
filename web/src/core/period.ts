import { formatDayRange, formatFullDay, formatWeekdayDay } from './format';
import { messages } from './messages';

/**
A day of the calendar in the viewer's time zone (month 1–12), never an instant: a
chosen day stays the same day whatever the time zone, the clocks or the hour, and
its boundaries are built from it anew whenever they are needed.
*/
export interface CalendarDate {
  year: number;
  month: number;
  day: number;
}

/**
What a ranking covers (PRD #70): one calendar day, one ISO calendar week (Monday
to Sunday, held as its Monday), all time, or (games only) the current run since
the last restart. Pages offer the kinds they need.
*/
export type Period =
  | { kind: 'day'; date: CalendarDate }
  | { kind: 'week'; date: CalendarDate }
  | { kind: 'all' }
  | { kind: 'run' };

export type PeriodKind = Period['kind'];

/**
The query that selects a period's answer: a window `[from, to)` of UTC instants,
`scope=all` for all time, or nothing for the current run.
*/
export type PeriodQuery =
  { from: string; to: string } | { scope: 'all' } | Record<string, never>;

/** The calendar date `instant` falls on in the viewer's time zone. */
export function calendarDateOf(instant: Date): CalendarDate {
  return {
    year: instant.getFullYear(),
    month: instant.getMonth() + 1,
    day: instant.getDate(),
  };
}

/** Local midnight at the start of `date`, daylight saving aware. */
export function startOf(date: CalendarDate): Date {
  return new Date(date.year, date.month - 1, date.day);
}

/** The date `days` calendar days later (earlier when negative). */
export function addDays(date: CalendarDate, days: number): CalendarDate {
  return calendarDateOf(new Date(date.year, date.month - 1, date.day + days));
}

/** The week `date` lies in, held as its Monday: a picked day shows its week. */
export function weekOf(date: CalendarDate): Extract<Period, { kind: 'week' }> {
  const weekday = new Date(
    Date.UTC(date.year, date.month - 1, date.day),
  ).getUTCDay();
  return { kind: 'week', date: addDays(date, -((weekday + 6) % 7)) };
}

export function sameDate(a: CalendarDate, b: CalendarDate): boolean {
  return a.year === b.year && a.month === b.month && a.day === b.day;
}

/** Whether `a` lies after `b`. */
function after(a: CalendarDate, b: CalendarDate): boolean {
  return startOf(a).getTime() > startOf(b).getTime();
}

/** `2026-11-04`. */
function isoDate({ year, month, day }: CalendarDate): string {
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${String(year)}-${pad(month)}-${pad(day)}`;
}

/**
The ISO 8601 number of the week starting on `monday`: a week belongs to the year
its Thursday lies in, and week 1 is the one with the year's first Thursday.
*/
function weekNumber(monday: CalendarDate): number {
  const thursday = addDays(monday, 3);
  const dayOfYear =
    (Date.UTC(thursday.year, thursday.month - 1, thursday.day) -
      Date.UTC(thursday.year, 0, 1)) /
    86_400_000;
  return Math.floor(dayOfYear / 7) + 1;
}

/** `KW 45 · 02.11.–08.11.`. */
function weekLine(monday: CalendarDate): string {
  return messages.period.week(
    weekNumber(monday),
    formatDayRange(startOf(monday), startOf(addDays(monday, 6))),
  );
}

/** Whether the period is the day `today`. */
export function isToday(period: Period, today: CalendarDate): boolean {
  return period.kind === 'day' && sameDate(period.date, today);
}

/**
Whether the period contains the present, so new records can still change it: it is
kept live like today's ranking; a closed period is read when shown and on focus.
*/
export function isLive(period: Period, today: CalendarDate): boolean {
  switch (period.kind) {
    case 'day':
      return sameDate(period.date, today);
    case 'week':
      return sameDate(period.date, weekOf(today).date);
    case 'all':
    case 'run':
      return true;
  }
}

/**
The query of a period, built from its calendar date in the time zone in use now:
a day runs from its local midnight to the next one, so it has 23 or 25 hours on
the days the clocks change.
*/
export function queryOf(
  period: Exclude<Period, { kind: 'run' }>,
): Exclude<PeriodQuery, Record<string, never>>;
export function queryOf(period: Period): PeriodQuery;
export function queryOf(period: Period): PeriodQuery {
  switch (period.kind) {
    case 'day':
      return {
        from: startOf(period.date).toISOString(),
        to: startOf(addDays(period.date, 1)).toISOString(),
      };
    case 'week':
      return {
        from: startOf(period.date).toISOString(),
        to: startOf(addDays(period.date, 7)).toISOString(),
      };
    case 'all':
      return { scope: 'all' };
    case 'run':
      return {};
  }
}

/**
The period's identity: data and ETags are kept under it. The same calendar day is
the same period in every time zone; its window is rebuilt for every request.
*/
export function periodKey(period: Period): string {
  return period.kind === 'day' || period.kind === 'week'
    ? `${period.kind}-${isoDate(period.date)}`
    : period.kind;
}

/**
The period `by` steps (days or weeks) on, never past the one that contains
`today`; other kinds do not step.
*/
export function step(period: Period, by: number, today: CalendarDate): Period {
  switch (period.kind) {
    case 'day': {
      const date = addDays(period.date, by);
      return { kind: 'day', date: after(date, today) ? today : date };
    }
    case 'week': {
      const date = addDays(period.date, by * 7);
      return after(date, today) ? weekOf(today) : { kind: 'week', date };
    }
    case 'all':
    case 'run':
      return period;
  }
}

/** The switch's name of a kind: `Tag`, `Gesamt`, `Aktuell`. */
export function kindLabel(kind: PeriodKind): string {
  return messages.period.kinds[kind];
}

/**
The bar's name of a day (`Heute`, `Gestern`, `Sa., 14.11.`) or a week (`Diese
Woche`, `Letzte Woche`, `KW 45 · 02.11.–08.11.`).
*/
export function barLabel(
  period: Extract<Period, { kind: 'day' | 'week' }>,
  today: CalendarDate,
): string {
  if (period.kind === 'week') {
    const current = weekOf(today).date;
    if (sameDate(period.date, current)) return messages.period.thisWeek;
    if (sameDate(period.date, addDays(current, -7))) {
      return messages.period.lastWeek;
    }
    return weekLine(period.date);
  }
  if (sameDate(period.date, today)) return messages.period.today;
  if (sameDate(period.date, addDays(today, -1))) {
    return messages.period.yesterday;
  }
  return formatWeekdayDay(startOf(period.date));
}

/**
The top bar's context line: `Heute`, `Montag, 16.11.2026`, `KW 47 · 16.11.–22.11.`
(the current week too), `Gesamt`, `Aktuell`.
*/
export function contextLine(period: Period, today: CalendarDate): string {
  switch (period.kind) {
    case 'day':
      return sameDate(period.date, today)
        ? messages.period.today
        : formatFullDay(startOf(period.date));
    case 'week':
      return weekLine(period.date);
    case 'all':
    case 'run':
      return kindLabel(period.kind);
  }
}
