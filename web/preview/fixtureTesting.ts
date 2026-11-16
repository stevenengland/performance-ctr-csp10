import type { AuditEvent } from '../src/core/api-client';

/* Helpers the fixture backend's specs share. */

/** The newest `limit` events of the log, as the API answers them. */
export async function newest(limit: number): Promise<AuditEvent[]> {
  const response = await fetch(`/api/audit?limit=${String(limit)}`);
  const page = (await response.json()) as { events: AuditEvent[] };
  return page.events;
}

/** An event as Protokoll tells it apart: who did what to which values, and why. */
export const told = ({
  operation,
  subjectKind,
  subjectId,
  actor,
  before,
  after,
  cause,
}: AuditEvent) => ({
  operation,
  subjectKind,
  subjectId,
  userName: actor.userName,
  before,
  after,
  cause: cause && { subjectKind: cause.subjectKind, name: cause.name },
});
