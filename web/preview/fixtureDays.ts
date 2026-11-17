import { json, type RouteRequest } from './fixtureHttp';

/*
The fixture backend's mirror of the API's `QuarterHours`: the days-with-data reads
answer the start instants, ascending, of the distinct 15-minute UTC buckets that
hold a row that counts, by its recording instant. Instants are UTC milliseconds,
so no time zone is involved.
*/

const QUARTER_HOUR_MS = 900_000;

/** The distinct quarter hours the instants fall in, as their UTC start instants, ascending. */
export function quarterHours(instants: Iterable<string>): string[] {
  const buckets = new Set<number>();
  for (const instant of instants) {
    buckets.add(Math.floor(new Date(instant).getTime() / QUARTER_HOUR_MS));
  }
  return [...buckets]
    .sort((a, b) => a - b)
    .map((bucket) => new Date(bucket * QUARTER_HOUR_MS).toISOString());
}

/**
A days-with-data answer like the API's: `{instants}`, tagged with the bare data
revision, 304 to an unchanged tag.
*/
export function daysAnswer(
  { headers }: RouteRequest,
  revision: number,
  recordedAt: Iterable<string>,
): Response {
  const etag = `"${String(revision)}"`;
  if (headers.get('If-None-Match') === etag) {
    return new Response(null, { status: 304, headers: { ETag: etag } });
  }
  const response = json({ instants: quarterHours(recordedAt) });
  response.headers.set('ETag', etag);
  return response;
}
