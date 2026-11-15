/**
A deploy never moves the API below the live schema: the schema needs no
backward compatibility (rollback returns only to a release with the live
schema), so older PHP on a newer schema is never safe. The live schema comes
from two places, because either can be missing: what live health reports (the
database's real state), and what the releases the ledger names as active or in
progress expect, since an in-progress release may have switched the API pointer
and migrated before it was cut off.
*/
export interface SchemaFloorFacts {
  candidate: { releaseId: string; schemaVersion: number };
  /** The schema version live health reports; undefined when it did not answer. */
  live: number | undefined;
  /** The active and the in-progress release with the schema version each expects. */
  recorded: readonly {
    releaseId: string;
    schemaVersion: number;
    inProgress: boolean;
  }[];
}

const ADVICE =
  'a deploy never moves below the live schema: deploy the newer release again or fix forward';

/** Why the candidate would move below the live schema, or undefined when it does not. */
export function schemaFloorProblem(
  facts: SchemaFloorFacts,
): string | undefined {
  const { candidate, live, recorded } = facts;
  const expects = `release ${candidate.releaseId} expects schema version ${String(candidate.schemaVersion)}`;
  if (live !== undefined && candidate.schemaVersion < live) {
    return `${expects}, but the live database is at schema version ${String(live)}; ${ADVICE}`;
  }
  const above = recorded
    .filter((release) => release.schemaVersion > candidate.schemaVersion)
    .toSorted((a, b) => b.schemaVersion - a.schemaVersion)[0];
  if (above === undefined) return undefined;
  const role = above.inProgress ? 'in progress' : 'active';
  return `${expects}, but release ${above.releaseId} (${role}) expects schema version ${String(above.schemaVersion)}; ${ADVICE}`;
}
