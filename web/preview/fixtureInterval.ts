import { validation } from './fixtureHttp';

/*
The fixture backend's mirror of the API's `IntervalQuery` and `Interval`: the one
place a windowed read's query becomes the instants it covers, so the scoreboard and
the entry list and a game's standings accept and reject the same windows with the
same problem.
*/

/** `from` (inclusive) up to `to` (exclusive); without `from`, all time. */
export interface Interval {
  from?: Date;
  to?: Date;
}

const INSTANT = 'Zeitpunkt nach ISO 8601 mit Zeitzone.';

/** A date, time and offset like the API's `Instant::parse`: `2026-11-14T23:00:00.000Z`, `…+01:00`. */
const ISO_INSTANT =
  /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{3}))?(?:Z|([+-])(\d{2}):(\d{2}))$/;

/** The instant `value` names, or `undefined` when it is none (also an impossible date). */
function instant(value: string): Date | undefined {
  const parts = ISO_INSTANT.exec(value);
  if (!parts) return undefined;
  const [year, month, day, hours, minutes, seconds] = parts
    .slice(1, 7)
    .map(Number) as [number, number, number, number, number, number];
  const local = new Date(
    Date.UTC(year, month - 1, day, hours, minutes, seconds),
  );
  const exists =
    local.getUTCFullYear() === year &&
    local.getUTCMonth() === month - 1 &&
    local.getUTCDate() === day &&
    local.getUTCHours() === hours &&
    local.getUTCMinutes() === minutes &&
    local.getUTCSeconds() === seconds;
  if (!exists) return undefined;
  const sign = parts[8] === '-' ? -1 : 1;
  const offset =
    parts[8] === undefined
      ? 0
      : sign * (Number(parts[9]) * 60 + Number(parts[10]));
  return new Date(local.getTime() - offset * 60_000 + Number(parts[7] ?? 0));
}

/** An optional text parameter like the API's `Query::text`: a list (`to[]=…`) reads as the empty text, the last of several values wins. */
export function queryText(
  query: URLSearchParams,
  name: string,
): string | undefined {
  if ([...query.keys()].some((key) => key.startsWith(`${name}[`))) return '';
  return query.getAll(name).at(-1);
}

/** `from` with an optional `to`, as the entry list takes it; a 422 for an invalid window. */
export function windowOf(query: URLSearchParams): Interval | Response {
  const from = instant(queryText(query, 'from') ?? '');
  if (!from) return validation({ from: INSTANT });
  const end = queryText(query, 'to');
  if (end === undefined) return { from };
  const to = instant(end);
  if (!to) return validation({ to: INSTANT });
  if (to <= from) return validation({ to: 'Zeitpunkt nach from.' });
  return { from, to };
}

/** A window, or all time with `scope=all`, as the scoreboard takes it; scope is checked first. */
export function windowOrAllTime(query: URLSearchParams): Interval | Response {
  const scope = queryText(query, 'scope');
  if (scope === undefined) return windowOf(query);
  if (scope !== 'all') return validation({ scope: 'Nur all.' });
  if (
    queryText(query, 'from') !== undefined ||
    queryText(query, 'to') !== undefined
  ) {
    return validation({ scope: 'Nicht zusammen mit from oder to.' });
  }
  return {};
}

/**
A window with an end at most `longestDays` days after its start, or all time with
`scope=all`, as the days-with-data reads take it.
*/
export function boundedWindowOrAllTime(
  query: URLSearchParams,
  longestDays: number,
): Interval | Response {
  const interval = windowOrAllTime(query);
  if (interval instanceof Response || interval.from === undefined) {
    return interval;
  }
  if (interval.to === undefined) return validation({ to: INSTANT });
  // Calendar days of 24 hours, as the offsets of both instants are fixed.
  if (
    interval.to.getTime() - interval.from.getTime() >
    longestDays * 86_400_000
  ) {
    return validation({
      to: `Höchstens ${String(longestDays)} Tage nach from.`,
    });
  }
  return interval;
}

/**
The current run (`'run'`) without `from`, `to` and `scope`, else a window or all
time, as a game's standings take it: whatever names a period, even empty or as a
list, is checked as the scoreboard checks it.
*/
export function windowAllTimeOrCurrentRun(
  query: URLSearchParams,
): Interval | 'run' | Response {
  const names = ['from', 'to', 'scope'];
  return names.some((name) => queryText(query, name) !== undefined)
    ? windowOrAllTime(query)
    : 'run';
}

/** Whether an instant lies in the interval. */
export function contains({ from, to }: Interval, at: string): boolean {
  const time = new Date(at).getTime();
  return (
    (from === undefined || time >= from.getTime()) &&
    (to === undefined || time < to.getTime())
  );
}

/** The interval's part of an ETag, like the API's: `<fromMs>`, `<fromMs>-<toMs>` or `all`. */
export function tagOf({ from, to }: Interval): string {
  if (from === undefined) return 'all';
  return to === undefined
    ? String(from.getTime())
    : `${String(from.getTime())}-${String(to.getTime())}`;
}
