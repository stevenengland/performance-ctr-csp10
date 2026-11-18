import { contains, type Interval, tagOf } from './fixtureInterval';
import { json } from './fixtureHttp';

/*
The fixture backend's mirror of the API's `QuarterHours` and `DaysActions`: a
days-with-data read takes a window of at most 35 days or `scope=all` and answers
the sessions of the 15-minute UTC buckets that hold a row that counts, by its
recording instant: spans from the start of a session's first bucket to the end of
its last, where a pause shorter than 6 hours does not end a session. Instants are
UTC milliseconds, so no time zone is involved.
*/

/** The longest window a days read takes, like the API's `DaysActions::LONGEST_WINDOW_DAYS`. */
export const LONGEST_DAYS_WINDOW = 35;

const QUARTER_HOUR_MS = 900_000;
/** A pause of 24 quarter hours (6 hours) or more without rows ends a session. */
const PAUSE_QUARTERS = 24;

/** The sessions of the quarter hours the instants fall in, as UTC spans `[from, to)`, ascending. */
export function sessionsOf(
  instants: Iterable<string>,
): { from: string; to: string }[] {
  const buckets = [
    ...new Set(
      [...instants].map((instant) =>
        Math.floor(new Date(instant).getTime() / QUARTER_HOUR_MS),
      ),
    ),
  ].sort((a, b) => a - b);
  const sessions: { first: number; last: number }[] = [];
  for (const bucket of buckets) {
    const current = sessions.at(-1);
    if (current && bucket - current.last <= PAUSE_QUARTERS)
      current.last = bucket;
    else sessions.push({ first: bucket, last: bucket });
  }
  return sessions.map(({ first, last }) => ({
    from: new Date(first * QUARTER_HOUR_MS).toISOString(),
    to: new Date((last + 1) * QUARTER_HOUR_MS).toISOString(),
  }));
}

/**
A days-with-data answer like the API's for the selection (checked before, by
`boundedWindowOrAllTime`): `{spans}` of the instants in it, tagged with the data
revision and the selection, 304 to an unchanged tag.
*/
export function daysAnswer(
  headers: Headers,
  interval: Interval,
  revision: number,
  recordedAt: Iterable<string>,
): Response {
  const etag = `"${String(revision)}-${tagOf(interval)}"`;
  if (headers.get('If-None-Match') === etag) {
    return new Response(null, { status: 304, headers: { ETag: etag } });
  }
  const inside = [...recordedAt].filter((at) => contains(interval, at));
  const response = json({ spans: sessionsOf(inside) });
  response.headers.set('ETag', etag);
  return response;
}
