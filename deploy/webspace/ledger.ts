import { isNonEmptyString, parseJson } from '../contract/parse.ts';

/**
The release ledger in `.deploy/state.json`: every release that got a marker,
with the timestamps its lifecycle derives from. This module owns the shape,
its invariants (at most one in-progress and one active release) and every
transition, so no caller re-derives a status from the timestamps.
*/
export interface Release {
  id: string;
  commit: string;
  startedAt: string;
  activatedAt?: string;
  deactivatedAt?: string;
  /** Set while a release that was live before is being activated again. */
  restartedAt?: string;
}

export interface State {
  releases: Release[];
}

export type ReleaseStatus = 'in-progress' | 'active' | 'previous' | 'abandoned';

/** How long a deactivated release's assets stay for HTML still open in browsers. */
export const PRUNE_WINDOW_MS = 24 * 60 * 60 * 1000;

const RETAINED_PREVIOUS = 2;

export function releaseStatus(release: Release): ReleaseStatus {
  if (release.restartedAt !== undefined) return 'in-progress';
  if (release.activatedAt === undefined) {
    return release.deactivatedAt === undefined ? 'in-progress' : 'abandoned';
  }
  return release.deactivatedAt === undefined ? 'active' : 'previous';
}

const withStatus = (status: ReleaseStatus) => (release: Release) =>
  releaseStatus(release) === status;

export function emptyState(): State {
  return { releases: [] };
}

function isOptionalString(value: unknown): value is string | undefined {
  return value === undefined || typeof value === 'string';
}

interface ReleaseRecord {
  id: string;
  commit: string;
  startedAt: string;
  activatedAt: string | undefined;
  deactivatedAt: string | undefined;
  restartedAt: string | undefined;
}

/** A restart only follows an activation. */
function isReleaseRecord(
  record: Record<string, unknown>,
): record is Record<string, unknown> & ReleaseRecord {
  const { id, commit, startedAt, activatedAt, deactivatedAt, restartedAt } =
    record;
  return (
    isNonEmptyString(id) &&
    isNonEmptyString(commit) &&
    isNonEmptyString(startedAt) &&
    isOptionalString(activatedAt) &&
    isOptionalString(deactivatedAt) &&
    isOptionalString(restartedAt) &&
    (restartedAt === undefined || activatedAt !== undefined)
  );
}

function toRelease(value: unknown): Release | undefined {
  if (typeof value !== 'object' || value === null) return undefined;
  const record = value as Record<string, unknown>;
  if (!isReleaseRecord(record)) return undefined;
  const { id, commit, startedAt, activatedAt, deactivatedAt, restartedAt } =
    record;
  return {
    id,
    commit,
    startedAt,
    ...(activatedAt !== undefined && { activatedAt }),
    ...(deactivatedAt !== undefined && { deactivatedAt }),
    ...(restartedAt !== undefined && { restartedAt }),
  };
}

const STATE_FILE = 'state.json';
const malformed = (fault: string) =>
  new Error(`${STATE_FILE} is malformed: ${fault}`);

function toReleases(value: unknown): Release[] {
  if (typeof value !== 'object' || value === null) throw malformed('releases');
  const list = (value as Record<string, unknown>).releases;
  if (!Array.isArray(list)) throw malformed('releases');
  const releases: Release[] = [];
  const ids = new Set<string>();
  for (const [index, item] of list.entries()) {
    const release = toRelease(item);
    if (release === undefined) throw malformed(`release ${String(index)}`);
    if (ids.has(release.id)) {
      throw malformed(`duplicate release id ${release.id}`);
    }
    ids.add(release.id);
    releases.push(release);
  }
  if (releases.filter(withStatus('in-progress')).length > 1) {
    throw malformed('two in-progress releases');
  }
  if (releases.filter(withStatus('active')).length > 1) {
    throw malformed('two active releases');
  }
  return releases;
}

export function parseState(json: string | undefined): State {
  return json === undefined
    ? emptyState()
    : { releases: toReleases(parseJson(json, STATE_FILE)) };
}

export function inProgressRelease(state: State): Release | undefined {
  return state.releases.find(withStatus('in-progress'));
}

export function activeRelease(state: State): Release | undefined {
  return state.releases.find(withStatus('active'));
}

export function abandonedReleases(state: State): Release[] {
  return state.releases.filter(withStatus('abandoned'));
}

function descending(left: string, right: string): number {
  if (left === right) return 0;
  return left < right ? 1 : -1;
}

/** Most recently deactivated first; a tie goes to the later activation. */
function byDeactivationDescending(a: Release, b: Release): number {
  return (
    descending(a.deactivatedAt ?? '', b.deactivatedAt ?? '') ||
    descending(a.activatedAt ?? '', b.activatedAt ?? '')
  );
}

/**
The rollback targets: the active release and the two most recently
deactivated releases that were live. A previously live release being
activated again keeps its place, so an interrupted rollback can be re-run.
*/
export function retainedReleases(state: State): Release[] {
  const active = activeRelease(state);
  const wasLive = (release: Release) =>
    release.activatedAt !== undefined && release !== active;
  const previous = state.releases
    .filter(
      (release) => wasLive(release) && release.deactivatedAt !== undefined,
    )
    .toSorted(byDeactivationDescending)
    .slice(0, RETAINED_PREVIOUS);
  // A restart of the release that was active has no deactivation to rank by.
  const restartedActive = state.releases.filter(
    (release) => wasLive(release) && release.deactivatedAt === undefined,
  );
  return [
    ...(active === undefined ? [] : [active]),
    ...restartedActive,
    ...previous,
  ];
}

/** The marker: the release starts, and any other in-progress release is deactivated. */
export function startRelease(
  state: State,
  release: { id: string; commit: string },
  now: Date,
): State {
  const at = now.toISOString();
  const fresh: Release = {
    id: release.id,
    commit: release.commit,
    startedAt: at,
  };
  const releases = state.releases.map((entry): Release => {
    if (entry.id === release.id) {
      // A release that was live keeps its history, so it stays a rollback target.
      return entry.activatedAt === undefined
        ? fresh
        : { ...entry, restartedAt: at };
    }
    if (releaseStatus(entry) !== 'in-progress') return entry;
    const { id, commit, startedAt, activatedAt } = entry;
    return {
      id,
      commit,
      startedAt,
      ...(activatedAt !== undefined && { activatedAt }),
      deactivatedAt: at,
    };
  });
  const isKnown = state.releases.some((entry) => entry.id === release.id);
  return { releases: isKnown ? releases : [...releases, fresh] };
}

/** The record: the release becomes active, and the previously active one is deactivated. */
export function activateRelease(state: State, id: string, now: Date): State {
  const at = now.toISOString();
  return {
    releases: state.releases.map((release): Release => {
      if (release.id === id) {
        return {
          id: release.id,
          commit: release.commit,
          startedAt: release.startedAt,
          activatedAt: at,
        };
      }
      return releaseStatus(release) === 'active'
        ? { ...release, deactivatedAt: at }
        : release;
    }),
  };
}

/** Splits the ledger into the releases to keep and those past the window that no rollback needs. */
export function pruneLedger(
  state: State,
  now: Date,
): { kept: Release[]; dropped: Release[] } {
  const retained = new Set(
    retainedReleases(state).map((release) => release.id),
  );
  const droppable = (release: Release) => {
    const status = releaseStatus(release);
    return (
      (status === 'previous' || status === 'abandoned') &&
      !retained.has(release.id) &&
      now.getTime() - Date.parse(release.deactivatedAt ?? '') >= PRUNE_WINDOW_MS
    );
  };
  return {
    kept: state.releases.filter((release) => !droppable(release)),
    dropped: state.releases.filter((release) => droppable(release)),
  };
}

export interface Summary {
  active: string | undefined;
  inProgress: string | undefined;
  retained: string[];
  abandoned: string[];
}

function ids(releases: readonly Release[]): string[] {
  return releases.map((release) => release.id);
}

/** The ledger facts the deploy log opens with; progress details stay with the planner. */
export function summarize(state: State): Summary {
  return {
    active: activeRelease(state)?.id,
    inProgress: inProgressRelease(state)?.id,
    retained: ids(retainedReleases(state)),
    abandoned: ids(abandonedReleases(state)),
  };
}
