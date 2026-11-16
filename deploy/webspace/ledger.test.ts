import { describe, expect, it } from 'vitest';
import {
  abandonedReleases,
  activateRelease,
  activeRelease,
  inProgressRelease,
  parseState,
  pruneLedger,
  PRUNE_WINDOW_MS,
  releaseStatus,
  retainedReleases,
  startRelease,
  summarize,
  type Release,
  type State,
} from './ledger.ts';

const state: State = {
  releases: [
    {
      id: 'r0',
      commit: '0'.repeat(40),
      startedAt: '2026-10-19T09:00:00Z',
      activatedAt: '2026-10-19T10:00:00Z',
      deactivatedAt: '2026-10-20T10:00:00Z',
    },
    {
      id: 'r1',
      commit: '1'.repeat(40),
      startedAt: '2026-10-20T09:00:00Z',
      activatedAt: '2026-10-20T10:00:00Z',
      deactivatedAt: '2026-10-21T10:00:00Z',
    },
    {
      id: 'rx',
      commit: 'x'.repeat(40),
      startedAt: '2026-10-21T09:30:00Z',
      deactivatedAt: '2026-10-21T09:45:00Z',
    },
    {
      id: 'r2',
      commit: '2'.repeat(40),
      startedAt: '2026-10-21T09:00:00Z',
      activatedAt: '2026-10-21T10:00:00Z',
      deactivatedAt: '2026-10-22T10:00:00Z',
    },
    {
      id: 'r3',
      commit: '3'.repeat(40),
      startedAt: '2026-10-22T09:00:00Z',
      activatedAt: '2026-10-22T10:00:00Z',
    },
  ],
};
const withInProgress: State = {
  releases: [
    ...state.releases,
    { id: 'r4', commit: '4'.repeat(40), startedAt: '2026-10-22T11:00:00Z' },
  ],
};

describe('parseState', () => {
  it('returns the empty ledger for a missing file', () => {
    expect(parseState(undefined)).toEqual({ releases: [] });
  });

  it('round-trips a valid ledger', () => {
    expect(parseState(JSON.stringify(withInProgress))).toEqual(withInProgress);
  });

  it.each([
    ['not JSON', '{'],
    ['releases', '{"releases":"x"}'],
    ['release 0', JSON.stringify({ releases: [{ id: 'a', commit: 'c' }] })],
    [
      'duplicate release id a',
      JSON.stringify({
        releases: [
          {
            id: 'a',
            commit: 'c',
            startedAt: 't',
            activatedAt: 't',
            deactivatedAt: 'u',
          },
          { id: 'a', commit: 'c', startedAt: 't' },
        ],
      }),
    ],
    [
      'two in-progress releases',
      JSON.stringify({
        releases: [
          { id: 'a', commit: 'c', startedAt: 't' },
          { id: 'b', commit: 'c', startedAt: 't' },
        ],
      }),
    ],
    [
      'release 0',
      JSON.stringify({
        releases: [{ id: 'a', commit: 'c', startedAt: 't', restartedAt: 'u' }],
      }),
    ],
    [
      'two active releases',
      JSON.stringify({
        releases: [
          { id: 'a', commit: 'c', startedAt: 't', activatedAt: 't' },
          { id: 'b', commit: 'c', startedAt: 't', activatedAt: 't' },
        ],
      }),
    ],
  ])('rejects a malformed ledger (%s)', (why, json) => {
    expect(() => parseState(json)).toThrow(
      new RegExp(String.raw`state\.json is malformed: ${why}`),
    );
  });
});

describe('ledger views', () => {
  it('finds the active and in-progress releases', () => {
    expect(activeRelease(state)?.id).toBe('r3');
    expect(inProgressRelease(state)).toBeUndefined();
    expect(inProgressRelease(withInProgress)?.id).toBe('r4');
    expect(activeRelease({ releases: [] })).toBeUndefined();
  });

  it('retains the active release plus the two most recently deactivated verified ones', () => {
    expect(retainedReleases(state).map((r) => r.id)).toEqual([
      'r3',
      'r2',
      'r1',
    ]);
  });

  it('lists abandoned releases and never retains them', () => {
    expect(abandonedReleases(state).map((r) => r.id)).toEqual(['rx']);
    expect(retainedReleases(state).map((r) => r.id)).not.toContain('rx');
  });
});

describe('releaseStatus', () => {
  it.each([
    ['in-progress', { startedAt: 't' }],
    ['abandoned', { startedAt: 't', deactivatedAt: 'u' }],
    ['active', { startedAt: 't', activatedAt: 'u' }],
    ['previous', { startedAt: 't', activatedAt: 'u', deactivatedAt: 'v' }],
    [
      'in-progress',
      {
        startedAt: 't',
        activatedAt: 'u',
        deactivatedAt: 'v',
        restartedAt: 'w',
      },
    ],
  ] as const)('is %s for %o', (status, times) => {
    expect(releaseStatus({ id: 'a', commit: 'c', ...times })).toBe(status);
  });
});

describe('transitions', () => {
  const at = new Date('2026-10-23T12:00:00Z');
  const iso = at.toISOString();
  const [r0, r1, rx, r2, r3] = state.releases as [
    Release,
    Release,
    Release,
    Release,
    Release,
  ];

  it('starts a new release after the others and abandons the one in progress', () => {
    const next = startRelease(withInProgress, { id: 'r5', commit: 'c5' }, at);
    expect(next.releases.at(-2)).toEqual({
      id: 'r4',
      commit: '4'.repeat(40),
      startedAt: '2026-10-22T11:00:00Z',
      deactivatedAt: iso,
    });
    expect(next.releases.at(-1)).toEqual({
      id: 'r5',
      commit: 'c5',
      startedAt: iso,
    });
  });

  it('restarts an abandoned release from scratch', () => {
    const next = startRelease(state, { id: 'rx', commit: rx.commit }, at);
    expect(next.releases.find((r) => r.id === 'rx')).toEqual({
      id: 'rx',
      commit: rx.commit,
      startedAt: iso,
    });
  });

  it('restarts a previous release with its history, so it stays a rollback target', () => {
    const next = startRelease(state, { id: 'r1', commit: r1.commit }, at);
    expect(next.releases.find((r) => r.id === 'r1')).toEqual({
      ...r1,
      restartedAt: iso,
    });
    expect(inProgressRelease(next)?.id).toBe('r1');
    expect(activeRelease(next)?.id).toBe('r3');
    expect(retainedReleases(next).map((r) => r.id)).toEqual(['r3', 'r2', 'r1']);
  });

  it('a superseded restart falls back to previous, deactivated now and still retained', () => {
    const rollingBack = startRelease(
      state,
      { id: 'r1', commit: r1.commit },
      at,
    );
    const next = startRelease(rollingBack, { id: 'r5', commit: 'c5' }, at);
    expect(next.releases.find((r) => r.id === 'r1')).toEqual({
      ...r1,
      deactivatedAt: iso,
    });
    expect(abandonedReleases(next).map((r) => r.id)).toEqual(['rx']);
    expect(retainedReleases(next).map((r) => r.id)).toEqual(['r3', 'r1', 'r2']);
  });

  it('activation makes the release active and deactivates the active one', () => {
    const rollingBack = startRelease(
      state,
      { id: 'r1', commit: r1.commit },
      at,
    );
    const next = activateRelease(rollingBack, 'r1', at);
    expect(next.releases).toEqual([
      r0,
      {
        id: 'r1',
        commit: r1.commit,
        startedAt: r1.startedAt,
        activatedAt: iso,
      },
      rx,
      r2,
      { ...r3, deactivatedAt: iso },
    ]);
  });

  it('an interrupted rollback, then a fresh deploy, keeps its target past the 24 h window', () => {
    const rollingBack = startRelease(
      state,
      { id: 'r1', commit: r1.commit },
      at,
    );
    const superseded = startRelease(
      rollingBack,
      { id: 'r5', commit: 'c5' },
      at,
    );
    const live = activateRelease(superseded, 'r5', at);
    const later = new Date(at.getTime() + 2 * PRUNE_WINDOW_MS);
    const { kept, dropped } = pruneLedger(live, later);
    expect(retainedReleases(live).map((r) => r.id)).toEqual(['r5', 'r3', 'r1']);
    expect(kept.map((r) => r.id)).toEqual(['r1', 'r3', 'r5']);
    expect(dropped.map((r) => r.id)).toEqual(['r0', 'rx', 'r2']);
  });
});

describe('summarize', () => {
  it('reports the active, in-progress, retained and abandoned ids', () => {
    expect(summarize(state)).toEqual({
      active: 'r3',
      inProgress: undefined,
      retained: ['r3', 'r2', 'r1'],
      abandoned: ['rx'],
    });
    expect(summarize(withInProgress).inProgress).toBe('r4');
  });
});
