import type { Inspection } from './operations.ts';
import { isNonEmptyString, parseJson } from './parse.ts';

export const COMMIT_SHA = /^[0-9a-f]{40}$/;

/**
How the candidate relates to the active commit: `descendant` includes the
active commit itself; `unknown` carries git's exit code.
*/
export type Ancestry =
  | { kind: 'none' | 'descendant' | 'ancestor' | 'unrelated' }
  | { kind: 'unknown'; code: number };

export type Order =
  { action: 'deploy' } | { action: 'skip' | 'fail'; message: string };

/**
Production only moves forward: a deploy run that was overtaken by a newer
commit skips, a commit outside main's history fails, and an order git cannot
establish fails, never skips. Rollback goes backward on purpose and does not
ask. The candidate is ordered against the active commit and, as `inProgress`,
against a release whose deploy started and did not finish: it may already
have switched the API and migrated the database.
*/
export function orderRelease(facts: {
  candidate: string;
  active: string;
  ancestry: Ancestry;
  inProgress?: boolean;
}): Order {
  const { candidate, active, ancestry, inProgress = false } = facts;
  switch (ancestry.kind) {
    case 'none':
    case 'descendant': {
      return { action: 'deploy' };
    }
    case 'ancestor': {
      return {
        action: 'skip',
        message: inProgress
          ? `release ${active} is in progress on production and is newer than ${candidate}; skipped so production never regresses`
          : `production is at ${active}, which is newer than ${candidate}; skipped so production never regresses`,
      };
    }
    case 'unknown': {
      return {
        action: 'fail',
        message: `cannot order ${candidate} against the active ${active} (git merge-base exit ${String(ancestry.code)})`,
      };
    }
    default: {
      return {
        action: 'fail',
        message: `production is at ${active} and ${candidate} is neither its descendant nor its ancestor; production moves backward only through the rollback workflow`,
      };
    }
  }
}

const SEVERITY: Record<Order['action'], number> = {
  deploy: 0,
  skip: 1,
  fail: 2,
};

/** Of the orders against the active and the in-progress commit, the strictest: fail, then skip, then deploy. */
export function strictest(orders: readonly Order[]): Order {
  return orders.reduce<Order>(
    (worst, order) =>
      SEVERITY[order.action] > SEVERITY[worst.action] ? order : worst,
    { action: 'deploy' },
  );
}

/** Reads the one JSON line `cli inspect` printed. */
export function parseInspection(json: string, file: string): Inspection {
  const malformed = (problem: string) =>
    new Error(`${file} is malformed: ${problem}`);
  const value = parseJson(json, file);
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw malformed('not an object');
  }
  const record = value as Record<string, unknown>;
  const retained = record.retained;
  if (!Array.isArray(retained) || !retained.every(isNonEmptyString)) {
    throw malformed('retained');
  }
  const release = (field: 'active' | 'inProgress') => {
    const value = record[field];
    if (value === undefined) return undefined;
    const { releaseId, commit } = (value ?? {}) as Record<string, unknown>;
    if (!isNonEmptyString(releaseId)) throw malformed(`${field}.releaseId`);
    if (typeof commit !== 'string' || !COMMIT_SHA.test(commit)) {
      throw malformed(`${field}.commit`);
    }
    return { releaseId, commit };
  };
  const active = release('active');
  const inProgress = release('inProgress');
  return {
    ...(active !== undefined && { active }),
    ...(inProgress !== undefined && { inProgress }),
    retained,
  };
}
