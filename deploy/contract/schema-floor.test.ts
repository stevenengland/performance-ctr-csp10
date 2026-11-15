import { describe, expect, it } from 'vitest';
import { schemaFloorProblem } from './schema-floor.ts';

const candidate = { releaseId: 'r-a', schemaVersion: 1 };
const ADVICE =
  'a deploy never moves below the live schema: deploy the newer release again or fix forward';

describe('schemaFloorProblem', () => {
  it('lets a first deploy through: no health, no releases', () => {
    expect(
      schemaFloorProblem({ candidate, live: undefined, recorded: [] }),
    ).toBeUndefined();
  });

  it('lets the same or a newer schema through', () => {
    expect(
      schemaFloorProblem({
        candidate: { releaseId: 'r-c', schemaVersion: 2 },
        live: 2,
        recorded: [{ releaseId: 'r-b', schemaVersion: 2, inProgress: true }],
      }),
    ).toBeUndefined();
  });

  it('refuses a candidate below the schema live health reports', () => {
    expect(schemaFloorProblem({ candidate, live: 2, recorded: [] })).toBe(
      `release r-a expects schema version 1, but the live database is at schema version 2; ${ADVICE}`,
    );
  });

  it('refuses a candidate below an in-progress release when health is silent', () => {
    expect(
      schemaFloorProblem({
        candidate,
        live: undefined,
        recorded: [
          { releaseId: 'r-a', schemaVersion: 1, inProgress: false },
          { releaseId: 'r-b', schemaVersion: 2, inProgress: true },
        ],
      }),
    ).toBe(
      `release r-a expects schema version 1, but release r-b (in progress) expects schema version 2; ${ADVICE}`,
    );
  });

  it('refuses a candidate below the active release even when health reports less', () => {
    expect(
      schemaFloorProblem({
        candidate,
        live: 1,
        recorded: [{ releaseId: 'r-b', schemaVersion: 3, inProgress: false }],
      }),
    ).toBe(
      `release r-a expects schema version 1, but release r-b (active) expects schema version 3; ${ADVICE}`,
    );
  });
});
