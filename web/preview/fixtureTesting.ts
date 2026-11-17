import type { AuditEvent, Outcome } from '../src/core/api-client';
import {
  type FixtureEntry,
  type FixtureMatch,
  type FixtureResult,
  type Fixtures,
  sampleEvening,
} from './fixtures';

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

/** A match of `withGameRows`'s Schach: first, second, outcome, createdAt, run (default 1), pending. */
export type MatchRow = [
  number | null,
  number | null,
  Outcome,
  string,
  number?,
  boolean?,
];
/** A result of `withGameRows`'s Rommé: person, points, createdAt, run (default 1), pending. */
export type ResultRow = [number, number, string, number?, boolean?];

/**
The sample persons (1 Anna, 2 Ben, 3 Daniel, 4 Jule, …) with two games, like the
API integration tests': 1 Schach, a duel with draws, and 2 Rommé, a points game
where the lowest sum wins, both in `run` since `startedAt`, holding only the given
matches and results.
*/
export function withGameRows(
  matches: MatchRow[],
  results: ResultRow[] = [],
  { run = 1, startedAt = '2026-11-14T20:00:00.000Z' } = {},
): Fixtures {
  const fixtures = sampleEvening(new Date('2026-11-14T20:00:00Z'));
  fixtures.games = [
    {
      id: 1,
      name: 'Schach',
      kind: 'duel',
      drawsAllowed: true,
      lowerWins: false,
      run,
      startedAt,
    },
    {
      id: 2,
      name: 'Rommé',
      kind: 'points',
      drawsAllowed: true,
      lowerWins: true,
      run,
      startedAt,
    },
  ];
  fixtures.matches = matches.map(
    ([first, second, outcome, createdAt, inRun = 1, pending = false], index) =>
      ({
        id: `00000000-0000-4000-a000-${String(index + 1).padStart(12, '0')}`,
        gameId: 1,
        run: inRun,
        firstPersonId: first,
        secondPersonId: second,
        outcome,
        accountId: 1,
        createdAt,
        pending,
      }) satisfies FixtureMatch,
  );
  fixtures.results = results.map(
    ([personId, points, createdAt, inRun = 1, pending = false], index) =>
      ({
        id: `00000000-0000-4000-b000-${String(index + 1).padStart(12, '0')}`,
        gameId: 2,
        run: inRun,
        personId,
        points,
        accountId: 1,
        createdAt,
        pending,
      }) satisfies FixtureResult,
  );
  return fixtures;
}
