/**
"Heute": the current calendar day from 00:00 in the browser's time zone (daylight
saving aware). The API gets its start as a UTC instant (`from`).
*/
export function startOfToday(now: Date = new Date()): Date {
  return new Date(now.getFullYear(), now.getMonth(), now.getDate());
}

/** The `from` of every request for today's data: local midnight as an ISO-8601 UTC instant. */
export function todayFrom(now: Date = new Date()): string {
  return startOfToday(now).toISOString();
}
