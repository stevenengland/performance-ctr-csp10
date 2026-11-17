import type { AuditEvent } from '../src/core/api-client';
import { type FixtureEntry, type Fixtures, sampleEvening } from './fixtures';

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

/** The sample persons and drinks with only the given entries: `[person, drink, quantity, createdAt, pending?]`. */
export function withEntries(
  ...entries: [number, number, number, string, boolean?][]
): Fixtures {
  const fixtures = sampleEvening(new Date('2026-11-14T20:00:00Z'));
  fixtures.entries = entries.map(
    ([personId, drinkId, quantity, createdAt, pending = false], index) =>
      ({
        id: `00000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`,
        personId,
        drinkId,
        quantity,
        factorId: null,
        accountId: 1,
        createdAt,
        pending,
      }) satisfies FixtureEntry,
  );
  return fixtures;
}
