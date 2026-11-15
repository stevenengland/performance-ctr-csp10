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
ask.
*/
export function orderRelease(facts: {
  candidate: string;
  active: string;
  ancestry: Ancestry;
}): Order {
  const { candidate, active, ancestry } = facts;
  switch (ancestry.kind) {
    case 'none':
    case 'descendant': {
      return { action: 'deploy' };
    }
    case 'ancestor': {
      return {
        action: 'skip',
        message: `production is at ${active}, which is newer than ${candidate}; skipped so production never regresses`,
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
  const active = record.active;
  if (active === undefined) return { retained };
  const { releaseId, commit } = (active ?? {}) as Record<string, unknown>;
  if (!isNonEmptyString(releaseId)) throw malformed('active.releaseId');
  if (typeof commit !== 'string' || !COMMIT_SHA.test(commit)) {
    throw malformed('active.commit');
  }
  return { active: { releaseId, commit }, retained };
}
