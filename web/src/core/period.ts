import { formatFullDay, formatWeekdayDay } from './format';
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
What a ranking covers (PRD #70): one calendar day, all time, or (games only) the
current run since the last restart. Pages offer the kinds they need.
*/
export type Period =
  { kind: 'day'; date: CalendarDate } | { kind: 'all' } | { kind: 'run' };

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

/** Whether the period is the day `today`. */
export function isToday(period: Period, today: CalendarDate): boolean {
  return period.kind === 'day' && sameDate(period.date, today);
}

/**
Whether the period contains the present, so new records can still change it: it is
kept live like today's ranking; a closed period is read when shown and on focus.
*/
export function isLive(period: Period, today: CalendarDate): boolean {
  return period.kind === 'day' ? sameDate(period.date, today) : true;
}

/**
The query of a period, built from its calendar date in the time zone in use now:
a day runs from its local midnight to the next one, so it has 23 or 25 hours on
the days the clocks change.
*/
export function queryOf(period: Period): PeriodQuery {
  switch (period.kind) {
    case 'day':
      return {
        from: startOf(period.date).toISOString(),
        to: startOf(addDays(period.date, 1)).toISOString(),
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
  return period.kind === 'day'
    ? `${period.kind}-${isoDate(period.date)}`
    : period.kind;
}

/** The period `by` steps (days) on, never past `today`; other kinds do not step. */
export function step(period: Period, by: number, today: CalendarDate): Period {
  if (period.kind !== 'day') return period;
  const date = addDays(period.date, by);
  return { kind: 'day', date: after(date, today) ? today : date };
}

/** The switch's name of a kind: `Tag`, `Gesamt`, `Aktuell`. */
export function kindLabel(kind: PeriodKind): string {
  return messages.period.kinds[kind];
}

/** The bar's name of a day: `Heute`, `Gestern`, `Sa., 14.11.`. */
export function barLabel(
  period: Extract<Period, { kind: 'day' }>,
  today: CalendarDate,
): string {
  if (sameDate(period.date, today)) return messages.period.today;
  if (sameDate(period.date, addDays(today, -1))) {
    return messages.period.yesterday;
  }
  return formatWeekdayDay(startOf(period.date));
}

/** The top bar's context line: `Heute`, `Montag, 16.11.2026`, `Gesamt`, `Aktuell`. */
export function contextLine(period: Period, today: CalendarDate): string {
  if (period.kind !== 'day') return kindLabel(period.kind);
  return sameDate(period.date, today)
    ? messages.period.today
    : formatFullDay(startOf(period.date));
}
