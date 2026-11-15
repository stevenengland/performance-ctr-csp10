import { describe, expect, it } from 'vitest';
import { buildManifest, type Manifest } from '../contract/artifact.ts';
import { targetPolicy } from '../contract/policy.ts';
import { renderHtaccess } from './htaccess.ts';
import { remotePaths } from './layout.ts';
import {
  activateRelease,
  emptyState,
  parseState,
  PRUNE_WINDOW_MS,
  startRelease,
  type State,
} from './ledger.ts';
import type { Phase, PhaseName, PlanInput } from './phase.ts';
import { planNext } from './plan.ts';
import { prunePlan } from './prune.ts';
import type { FileCommand } from './ports.ts';
import type { Listing, RemoteState } from './remote-state.ts';

const sha = 'b'.repeat(64);
const now = new Date('2026-10-22T12:00:00Z');
const paths = remotePaths('/remote', 'site');
const policy = targetPolicy('http://h.test');

function manifestFor(id: string, files: [string, number][]): Manifest {
  return {
    ...buildManifest({
      commit: id.repeat(8).slice(0, 40),
      runId: '1',
      runAttempt: '1',
      buildTime: now,
      base: '/',
      files: files.map(([path, size]) => ({ path, size, sha256: sha })),
    }),
    releaseId: id,
  };
}
const r2 = manifestFor('r2', [
  ['index.html', 10],
  ['impressum/index.html', 11],
  ['404.html', 4],
  ['assets/a.css', 5],
  ['assets/b.css', 6],
]);
const listing = (entries: [string, number][], dirs: string[] = []): Listing =>
  new Map([
    ...entries.map(([name, size]): [string, { size: number; dir: boolean }] => [
      name,
      { size, dir: false },
    ]),
    ...dirs.map((d): [string, { size: number; dir: boolean }] => [
      d,
      { size: 4096, dir: true },
    ]),
  ]);
const tree = listing;

const activeR1: State = {
  releases: [
    {
      id: 'r1',
      commit: '1'.repeat(40),
      startedAt: '2026-10-21T00:00:00Z',
      activatedAt: '2026-10-21T00:10:00Z',
    },
  ],
};
const inProgressR2: State = {
  releases: [
    ...activeR1.releases,
    { id: 'r2', commit: r2.commit, startedAt: '2026-10-22T11:00:00Z' },
  ],
};
const accessDone = new Set<PhaseName>(['access-upload', 'access-commit']);
const prepared = {
  root: listing([], ['site', '.deploy']),
  deploy: listing([], ['manifests', 'staged']),
  site: tree([['.htaccess', 1]], ['assets']),
};

function input(
  overrides: Partial<RemoteState> & { completed?: Iterable<PhaseName> },
  extra: Partial<PlanInput> = {},
): PlanInput {
  const { completed = accessDone, ...remote } = overrides;
  return {
    remote: {
      state: emptyState(),
      manifests: new Map(),
      root: new Map(),
      deploy: new Map(),
      site: new Map(),
      assets: new Map(),
      staged: new Map(),
      version: undefined,
      ...remote,
    },
    manifest: r2,
    policy,
    aliases: [],
    paths,
    artifactDir: '/art',
    tempDir: '/work/tmp',
    now,
    completed: new Set(completed),
    ...extra,
  };
}
const transfer = (phase: Phase) =>
  phase.kind === 'transfer'
    ? phase
    : expect.fail(`expected a transfer phase, got ${phase.kind}`);
function target(command: FileCommand): string {
  if ('path' in command) return command.path;
  return 'remote' in command ? command.remote : command.to;
}
const ops = (phase: Phase) =>
  transfer(phase).commands.map((c) => `${c.op} ${target(c)}`);
const planFor = (...args: Parameters<typeof input>) => planNext(input(...args));
/** The transfer phase that planNext returns for this input. */
const nextTransfer = (...args: Parameters<typeof input>) =>
  transfer(planFor(...args));
const nextOps = (...args: Parameters<typeof input>) => ops(planFor(...args));

describe('access overlay comes first on every run', () => {
  it('uploads .htaccess from the current policy before the marker, creating site/ when absent', () => {
    const phase = nextTransfer({ completed: [] });
    expect(phase.name).toBe('access-upload');
    expect(phase.files).toEqual([
      { name: '.htaccess', content: renderHtaccess(policy) },
    ]);
    expect(ops(phase)).toEqual([
      'mkdir /remote/site',
      'put /remote/site/.htaccess.part',
    ]);
  });

  it('commits only size-verified parts and runs even when the release is already active', () => {
    const htaccess = renderHtaccess(policy);
    const remote = {
      ...prepared,
      state: activeR1,
      site: tree([['.htaccess.part', Buffer.byteLength(htaccess)]], ['assets']),
      completed: ['access-upload'] as PhaseName[],
    };
    const phase = transfer(
      planNext({
        ...input(remote),
        manifest: manifestFor('r1', [['index.html', 1]]),
      }),
    );
    expect(phase.name).toBe('access-commit');
    expect(ops(phase)).toEqual(['rename /remote/site/.htaccess']);
    expect(() =>
      planFor({ ...remote, site: tree([['.htaccess.part', 1]], ['assets']) }),
    ).toThrow(/access upload incomplete: \.htaccess/);
  });
});

describe('marker', () => {
  it('removes a staged tree left from an earlier attempt of the same release before the ledger entry', () => {
    const phase = nextTransfer({
      ...prepared,
      state: activeR1,
      staged: new Map([
        [
          'r2',
          tree(
            [
              ['.verified', 0],
              ['index.html', 10],
            ],
            ['impressum'],
          ),
        ],
      ]),
    });
    expect(phase.name).toBe('marker');
    const commands = ops(phase);
    expect(commands.slice(0, 4)).toEqual([
      'rm /remote/.deploy/staged/r2/.verified',
      'rm /remote/.deploy/staged/r2/index.html',
      'rmdir /remote/.deploy/staged/r2/impressum',
      'rmdir /remote/.deploy/staged/r2',
    ]);
    expect(commands.at(-1)).toBe('rename /remote/.deploy/state.json');
  });

  it('creates the missing directories and writes the manifest and the ledger entry', () => {
    const phase = nextTransfer({
      root: listing([], ['site']),
      site: tree([['.htaccess', 1]]),
    });
    expect(phase.name).toBe('marker');
    expect(JSON.parse(phase.files[1]?.content ?? '')).toEqual({
      releases: [{ id: 'r2', commit: r2.commit, startedAt: now.toISOString() }],
    });
    expect(ops(phase)).toEqual([
      'mkdir /remote/.deploy',
      'mkdir /remote/.deploy/manifests',
      'mkdir /remote/.deploy/staged',
      'mkdir /remote/site/assets',
      'put /remote/.deploy/manifests/r2.json.part',
      'rename /remote/.deploy/manifests/r2.json',
      'put /remote/.deploy/state.json.part',
      'rename /remote/.deploy/state.json',
    ]);
  });

  it('emits no mkdir for directories the listings already show', () => {
    expect(
      nextOps({ ...prepared, state: activeR1 }).filter((o) =>
        o.startsWith('mkdir'),
      ),
    ).toEqual([]);
  });
});

describe('assets, staging, activation', () => {
  const base = { ...prepared, state: inProgressR2 };

  it('uploads missing and short assets to .part names without removing anything', () => {
    const phase = nextTransfer({
      ...base,
      assets: listing([
        ['a.css', 3],
        ['stale.css.part', 9],
      ]),
    });
    expect(phase.name).toBe('assets-upload');
    expect(ops(phase)).toEqual([
      'put /remote/site/assets/a.css.part',
      'put /remote/site/assets/b.css.part',
    ]);
  });

  it('renames only size-verified parts into place', () => {
    const phase = nextTransfer({
      ...base,
      assets: listing([
        ['a.css.part', 5],
        ['b.css.part', 2],
      ]),
    });
    expect(phase.name).toBe('assets-commit');
    expect(ops(phase)).toEqual(['rename /remote/site/assets/a.css']);
  });

  const assets = listing([
    ['a.css', 5],
    ['b.css', 6],
  ]);

  it('stages missing html, creating only the directories the staged tree lacks', () => {
    const phase = nextTransfer({
      ...base,
      assets,
      staged: new Map([['r2', tree([['index.html', 10]])]]),
    });
    expect(phase.name).toBe('staging-upload');
    expect(ops(phase)).toEqual([
      'mkdir /remote/.deploy/staged/r2/impressum',
      'put /remote/.deploy/staged/r2/404.html',
      'put /remote/.deploy/staged/r2/impressum/index.html',
    ]);
    expect(nextOps({ ...base, assets })).toContain(
      'mkdir /remote/.deploy/staged/r2',
    );
  });

  it('writes .verified once every staged file has its size, then activates what remains', () => {
    const staged = tree(
      [
        ['index.html', 10],
        ['impressum/index.html', 11],
        ['404.html', 4],
      ],
      ['impressum'],
    );
    const verified = nextTransfer({
      ...base,
      assets,
      staged: new Map([['r2', staged]]),
    });
    expect(verified.name).toBe('staging-verified');
    expect(ops(verified)).toEqual(['put /remote/.deploy/staged/r2/.verified']);

    const remaining = tree(
      [
        ['.verified', 0],
        ['impressum/index.html', 11],
        ['404.html', 4],
      ],
      ['impressum'],
    );
    const activation = nextTransfer({
      ...base,
      assets,
      staged: new Map([['r2', remaining]]),
    });
    expect(activation.name).toBe('activation');
    expect(ops(activation)).toEqual([
      'mkdir /remote/site/impressum',
      'rename /remote/site/404.html',
      'rename /remote/site/impressum/index.html',
    ]);
  });
});

describe('version, checks, record, finish', () => {
  const activated = {
    ...prepared,
    state: inProgressR2,
    manifests: new Map([
      ['r1', manifestFor('r1', [['index.html', 1]])],
      ['r2', r2],
    ]),
    assets: listing([
      ['a.css', 5],
      ['b.css', 6],
    ]),
    staged: new Map([['r2', tree([['.verified', 0]], ['impressum'])]]),
    site: tree(
      [
        ['.htaccess', 1],
        ['index.html', 10],
        ['404.html', 4],
        ['impressum/index.html', 11],
      ],
      ['assets', 'impressum'],
    ),
  };
  const version = JSON.stringify({ release: 'r2', commit: r2.commit });

  it('places version.json after activation and skips it once the file names the release', () => {
    const upload = nextTransfer(activated);
    expect(upload.name).toBe('version-upload');
    expect(upload.files).toEqual([{ name: 'version.json', content: version }]);
    const commit = nextTransfer({
      ...activated,
      site: new Map([
        ...activated.site,
        ['version.json.part', { size: Buffer.byteLength(version), dir: false }],
      ]),
      completed: [...accessDone, 'version-upload'],
    });
    expect(commit.name).toBe('version-commit');
    expect(planFor({ ...activated, version: 'r2' }).kind).toBe('http');
  });

  it('runs the http checks, then records, then finishes by removing the staging evidence', () => {
    const http = planFor({ ...activated, version: 'r2' });
    expect(http.kind === 'http' ? http.checks.length : 0).toBeGreaterThan(0);
    const record = nextTransfer({
      ...activated,
      version: 'r2',
      completed: [...accessDone, 'http-checks'],
    });
    expect(record.name).toBe('record');
    expect(JSON.parse(record.files[0]?.content ?? '')).toEqual(
      activateRelease(inProgressR2, 'r2', now),
    );
    expect(activateRelease(inProgressR2, 'r2', now).releases).toEqual([
      { ...activeR1.releases[0], deactivatedAt: now.toISOString() },
      {
        id: 'r2',
        commit: r2.commit,
        startedAt: '2026-10-22T11:00:00Z',
        activatedAt: now.toISOString(),
      },
    ]);
    const recorded = activateRelease(inProgressR2, 'r2', now);
    const finish = nextTransfer({
      ...activated,
      state: recorded,
      version: 'r2',
      assets: listing([
        ['a.css', 5],
        ['b.css', 6],
        ['junk.css.part', 1],
      ]),
      completed: [...accessDone, 'http-checks'],
    });
    expect(finish.name).toBe('finish');
    expect(ops(finish)).toEqual([
      'rm /remote/.deploy/staged/r2/.verified',
      'rmdir /remote/.deploy/staged/r2/impressum',
      'rmdir /remote/.deploy/staged/r2',
      'rm /remote/site/assets/junk.css.part',
    ]);
    expect(
      planFor({
        ...activated,
        state: recorded,
        version: 'r2',
        staged: new Map(),
        completed: [...accessDone, 'http-checks', 'finish'],
      }),
    ).toEqual({ kind: 'done' });
  });

  it('an already active release still gets its checks and finish, never a marker', () => {
    const recorded = activateRelease(inProgressR2, 'r2', now);
    const phase = planFor({
      ...activated,
      state: recorded,
      version: 'r2',
      staged: new Map(),
    });
    expect(phase.kind).toBe('http');
  });
});

describe('cleanup', () => {
  const activated = {
    ...prepared,
    state: inProgressR2,
    assets: listing([
      ['a.css', 5],
      ['b.css', 6],
    ]),
    staged: new Map([['r2', tree([['.verified', 0]], ['impressum'])]]),
    version: 'r2',
  };

  it('removes the files a recorded release put there and this one lacks, and the directories that become empty', () => {
    const r1 = manifestFor('r1', [
      ['index.html', 10],
      ['alt/index.html', 3],
      ['new/deep/index.html', 2],
    ]);
    const site = tree(
      [
        ['.htaccess', 1],
        ['version.json', 1],
        ['version.json.part', 1],
        ['index.html', 10],
        ['404.html', 4],
        ['impressum/index.html', 11],
        ['alt/index.html', 3],
        ['new/deep/index.html', 2],
        ['index.html.part', 1],
      ],
      ['assets', 'impressum', 'alt', 'new', 'new/deep'],
    );
    const phase = nextTransfer({
      ...activated,
      manifests: new Map([
        ['r1', r1],
        ['r2', r2],
      ]),
      site,
    });
    expect(phase.name).toBe('cleanup');
    expect(ops(phase)).toEqual([
      'rm /remote/site/alt/index.html',
      'rm /remote/site/new/deep/index.html',
      'rm /remote/site/version.json.part',
      'rmdir /remote/site/new/deep',
      'rmdir /remote/site/new',
      'rmdir /remote/site/alt',
    ]);
  });

  it('keeps the shared asset directory when the release has no assets', () => {
    const pagesOnly = manifestFor('r2', [
      ['index.html', 10],
      ['404.html', 4],
    ]);
    const site = tree(
      [
        ['.htaccess', 1],
        ['version.json', 1],
        ['index.html', 10],
        ['404.html', 4],
      ],
      ['assets'],
    );
    const plan = planFor(
      {
        ...activated,
        site,
        staged: new Map([['r2', tree([['.verified', 0]])]]),
      },
      { manifest: pagesOnly },
    );
    expect(plan.kind).toBe('http');
  });

  it('emits nothing when the docroot holds only the manifest, the overlay and assets', () => {
    const site = tree(
      [
        ['.htaccess', 1],
        ['version.json', 1],
        ['index.html', 10],
        ['404.html', 4],
        ['impressum/index.html', 11],
      ],
      ['assets', 'impressum'],
    );
    expect(planFor({ ...activated, site }).kind).toBe('http');
  });
});

/** The ISO time `offsetMs` before now. */
const ago = (offsetMs: number) =>
  new Date(now.getTime() - offsetMs).toISOString();
const withAssets = (id: string, assets: string[]) =>
  manifestFor(id, [
    ['index.html', 1],
    ...assets.map((a): [string, number] => [a, 1]),
  ]);

/** Ledger releases r0 to r4 and the abandoned rx, deactivated at the given times. */
const pruneHistory = (
  r0At: string,
  r1At: string,
  rxAt: string,
): State['releases'] => [
  {
    id: 'r0',
    commit: 'c',
    startedAt: ago(6 * PRUNE_WINDOW_MS),
    activatedAt: ago(5 * PRUNE_WINDOW_MS),
    deactivatedAt: r0At,
  },
  {
    id: 'r1',
    commit: 'c',
    startedAt: ago(5 * PRUNE_WINDOW_MS),
    activatedAt: ago(4 * PRUNE_WINDOW_MS),
    deactivatedAt: r1At,
  },
  {
    id: 'rx',
    commit: 'c',
    startedAt: ago(3.5 * PRUNE_WINDOW_MS),
    deactivatedAt: rxAt,
  },
  {
    id: 'r2',
    commit: 'c',
    startedAt: ago(3 * PRUNE_WINDOW_MS),
    activatedAt: ago(3 * PRUNE_WINDOW_MS),
    deactivatedAt: ago(2 * PRUNE_WINDOW_MS),
  },
  {
    id: 'r3',
    commit: 'c',
    startedAt: ago(2 * PRUNE_WINDOW_MS),
    activatedAt: ago(2 * PRUNE_WINDOW_MS),
    deactivatedAt: ago(PRUNE_WINDOW_MS / 2),
  },
  {
    id: 'r4',
    commit: 'c',
    startedAt: ago(PRUNE_WINDOW_MS / 2),
    activatedAt: ago(PRUNE_WINDOW_MS / 2),
  },
];

describe('prune', () => {
  const r4 = withAssets('r4', ['assets/r4.css', 'assets/shared.css']);
  const manifests = new Map([
    ['r0', withAssets('r0', ['assets/shared.css', 'assets/r0-only.css'])],
    ['r1', withAssets('r1', ['assets/shared.css', 'assets/r1-only.css'])],
    ['rx', withAssets('rx', ['assets/rx-only.css'])],
    ['r2', withAssets('r2', ['assets/r2.css'])],
    ['r3', withAssets('r3', ['assets/r3.css'])],
    ['r4', r4],
  ]);
  const assets = listing([
    ['shared.css', 1],
    ['r0-only.css', 1],
    ['r1-only.css', 1],
    ['rx-only.css', 1],
    ['r2.css', 1],
    ['r3.css', 1],
    ['r4.css', 1],
    ['orphan.css', 1],
    ['junk.css.part', 1],
  ]);

  it('keeps an interrupted rollback target, its manifest and assets after a fresh deploy and 24 h', () => {
    const live: State = {
      releases: [
        {
          id: 'r0',
          commit: 'c',
          startedAt: ago(4 * PRUNE_WINDOW_MS),
          activatedAt: ago(4 * PRUNE_WINDOW_MS),
          deactivatedAt: ago(3 * PRUNE_WINDOW_MS),
        },
        {
          id: 'r1',
          commit: 'c',
          startedAt: ago(3 * PRUNE_WINDOW_MS),
          activatedAt: ago(3 * PRUNE_WINDOW_MS),
        },
      ],
    };
    const before = new Date(now.getTime() - 2 * PRUNE_WINDOW_MS);
    const rollingBack = startRelease(live, { id: 'r0', commit: 'c' }, before);
    const deployed = activateRelease(
      startRelease(rollingBack, { id: 'r4', commit: 'c' }, before),
      'r4',
      before,
    );
    const plan = prunePlan(deployed, manifests, assets, now);
    expect(plan.releases.map((r) => r.id)).toEqual(['r0', 'r1', 'r4']);
    expect(plan.removeManifests).toEqual([]);
    expect(plan.removeAssets).not.toContain('r0-only.css');
  });

  it('drops an unretained release exactly 24 h after deactivation, never a second earlier', () => {
    const plan = prunePlan(
      {
        releases: pruneHistory(
          ago(PRUNE_WINDOW_MS),
          ago(PRUNE_WINDOW_MS - 1000),
          ago(PRUNE_WINDOW_MS - 1000),
        ),
      },
      manifests,
      assets,
      now,
    );
    // r2 is neither retained (r3 and r1 were deactivated later) nor inside the window.
    expect(plan.removeManifests).toEqual(['r0', 'r2']);
    expect(plan.removeAssets).toEqual(['orphan.css', 'r0-only.css', 'r2.css']);
    expect(plan.releases.map((r) => r.id)).toEqual(['r1', 'rx', 'r3', 'r4']);
  });

  it('treats an abandoned release like any other for the window and keeps a shared asset', () => {
    const plan = prunePlan(
      {
        releases: pruneHistory(
          ago(3 * PRUNE_WINDOW_MS),
          ago(3 * PRUNE_WINDOW_MS),
          ago(PRUNE_WINDOW_MS),
        ),
      },
      manifests,
      assets,
      now,
    );
    expect(plan.removeManifests).toEqual(['r0', 'r1', 'rx']);
    expect(plan.removeAssets).toEqual([
      'orphan.css',
      'r0-only.css',
      'r1-only.css',
      'rx-only.css',
    ]);
    expect(plan.removeAssets).not.toContain('shared.css');
  });

  it('never drops a retained release regardless of age', () => {
    const old: State = {
      releases: [
        {
          id: 'r2',
          commit: 'c',
          startedAt: ago(9 * PRUNE_WINDOW_MS),
          activatedAt: ago(9 * PRUNE_WINDOW_MS),
          deactivatedAt: ago(8 * PRUNE_WINDOW_MS),
        },
        {
          id: 'r3',
          commit: 'c',
          startedAt: ago(8 * PRUNE_WINDOW_MS),
          activatedAt: ago(8 * PRUNE_WINDOW_MS),
          deactivatedAt: ago(7 * PRUNE_WINDOW_MS),
        },
        {
          id: 'r4',
          commit: 'c',
          startedAt: ago(7 * PRUNE_WINDOW_MS),
          activatedAt: ago(7 * PRUNE_WINDOW_MS),
        },
      ],
    };
    expect(
      prunePlan(
        old,
        manifests,
        listing([
          ['r2.css', 1],
          ['r3.css', 1],
          ['r4.css', 1],
          ['shared.css', 1],
        ]),
        now,
      ),
    ).toEqual({
      releases: old.releases,
      removeAssets: [],
      removeManifests: [],
    });
  });

  it('finish removes every staged leftover, the pruned assets and manifests, and rewrites the ledger', () => {
    const state: State = {
      releases: pruneHistory(
        ago(2 * PRUNE_WINDOW_MS),
        ago(2 * PRUNE_WINDOW_MS),
        ago(2 * PRUNE_WINDOW_MS),
      ),
    };
    const phase = nextTransfer(
      {
        ...prepared,
        state,
        // A manifest the ledger does not name is an orphan.
        manifests: new Map([...manifests, ['ghost', withAssets('ghost', [])]]),
        assets,
        version: 'r4',
        staged: new Map([
          ['rx', tree([['index.html', 1]])],
          ['r4', tree([['.verified', 0]])],
        ]),
        site: tree(
          [
            ['.htaccess', 1],
            ['version.json', 1],
            ['index.html', 1],
          ],
          ['assets'],
        ),
        completed: [...accessDone, 'http-checks', 'cleanup'],
      },
      { manifest: r4 },
    );
    expect(phase.name).toBe('finish');
    expect(ops(phase)).toEqual([
      'rm /remote/.deploy/staged/rx/index.html',
      'rmdir /remote/.deploy/staged/rx',
      'rm /remote/.deploy/staged/r4/.verified',
      'rmdir /remote/.deploy/staged/r4',
      'rm /remote/site/assets/junk.css.part',
      'rm /remote/site/assets/orphan.css',
      'rm /remote/site/assets/r0-only.css',
      'rm /remote/site/assets/r1-only.css',
      'rm /remote/site/assets/rx-only.css',
      'rm /remote/.deploy/manifests/r0.json',
      'rm /remote/.deploy/manifests/r1.json',
      'rm /remote/.deploy/manifests/rx.json',
      'rm /remote/.deploy/manifests/ghost.json',
      'put /remote/.deploy/state.json.part',
      'rename /remote/.deploy/state.json',
    ]);
    expect(
      parseState(phase.files[0]?.content).releases.map((r) => r.id),
    ).toEqual(['r2', 'r3', 'r4']);
  });

  it('finish never touches the target root: foreign files, also *.part, stay', () => {
    const phase = nextTransfer(
      {
        ...prepared,
        state: { releases: pruneHistory(ago(0), ago(0), ago(0)) },
        manifests,
        version: 'r4',
        staged: new Map([['r4', tree([['.verified', 0]])]]),
        root: listing(
          [
            ['notes.part', 1],
            ['foreign.txt', 1],
          ],
          ['site', '.deploy', 'httpdocs'],
        ),
        completed: [...accessDone, 'http-checks', 'cleanup'],
      },
      { manifest: r4 },
    );
    expect(phase.name).toBe('finish');
    const inRoot = /^\w+ \/remote\/[^/]+$/;
    expect(ops(phase).filter((op) => inRoot.test(op))).toEqual([]);
  });
});
