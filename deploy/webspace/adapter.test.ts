import { describe, expect, it } from 'vitest';
import { targetPolicy, type WebspaceSettings } from '../contract/policy.ts';
import {
  FakeHttp,
  FakeLocalFiles,
  FakeRemote,
  fakeArtifact,
  fakeRuntimeConfig,
} from '../../tests/support/fake-remote.ts';
import { interrupt } from '../../tests/support/interrupt.ts';
import { createAdapter } from './adapter.ts';
import { httpChecks } from './checks.ts';
import { renderHtaccess } from './htaccess.ts';
import { renderRuntimeConfig } from './runtime-config.ts';
import { parseState, PRUNE_WINDOW_MS, retainedReleases } from './ledger.ts';
import type { FileTransport } from './ports.ts';

const now = new Date('2026-10-22T12:00:00Z');
const settings: WebspaceSettings = {
  remoteRoot: '/remote',
  docroot: 'site',
  aliases: ['www.h.test'],
};
const policy = targetPolicy('http://h.test');
/** Extra activated files per release, one folder each, so cleanup has folders to remove. */
const extras = (...names: string[]) => names.map((name) => `${name}/icon.svg`);

function harness(
  remote?: FakeRemote,
  local = new FakeLocalFiles(),
  options: {
    transport?: FileTransport;
    http?: FakeHttp;
    clock?: () => Date;
    settings?: WebspaceSettings;
  } = {},
) {
  const fake = remote ?? new FakeRemote(local);
  const site = `/remote/${(options.settings ?? settings).docroot}`;
  const http = options.http ?? new FakeHttp(fake, site);
  const log: string[] = [];
  const adapter = createAdapter({
    transport: options.transport ?? fake,
    http,
    files: local,
    settings: options.settings ?? settings,
    runtimeConfig: fakeRuntimeConfig,
    now: options.clock ?? (() => now),
    log: (l) => {
      log.push(l);
    },
  });
  return { fake, local, http, log, adapter };
}
const steps = (fake: FakeRemote) =>
  fake.steps.map((s) => s.step).filter((s) => !s.startsWith('observe'));
const state = (fake: FakeRemote) =>
  parseState(fake.files.get('/remote/.deploy/state.json'));

describe('a deploy on an empty remote', () => {
  it('writes the access overlay first, then publishes, verifies, records and finishes', async () => {
    const { fake, local, http, adapter, log } = harness();
    const a = await fakeArtifact(local, '/art/a', '1'.repeat(40));
    const outcome = await adapter.deploy(a, policy);
    expect(outcome).toEqual({
      releaseId: a.manifest.releaseId,
      commit: a.manifest.commit,
    });
    expect(steps(fake)).toEqual([
      'access-upload',
      'access-commit',
      'marker',
      'assets-upload',
      'assets-commit',
      'app-upload',
      'app-verified',
      'staging-upload',
      'staging-verified',
      'config-upload',
      'config-commit',
      'activation',
      'shell',
      'version-upload',
      'version-commit',
      'record',
      'finish',
    ]);
    expect(fake.files.get('/remote/config/runtime.php')).toBe(
      renderRuntimeConfig(fakeRuntimeConfig),
    );
    expect(fake.files.get('/remote/app/0.1.0-1111111/release.php')).toContain(
      '0.1.0+1111111',
    );
    expect(fake.files.get('/remote/site/.htaccess')).toBe(
      renderHtaccess(policy),
    );
    expect(fake.files.get('/remote/site/index.html')).toContain(
      'Release 1111111',
    );
    expect(fake.files.get('/remote/site/img/app.svg')).toBeDefined();
    expect(fake.files.get('/remote/site/sw.js')).toBeDefined();
    expect(fake.files.get('/remote/site/assets/app.1111111.css')).toBe(
      'body{content:"1111111"}',
    );
    expect(
      JSON.parse(fake.files.get('/remote/site/version.json') ?? ''),
    ).toEqual({ release: a.manifest.releaseId, commit: a.manifest.commit });
    expect(http.calls).toEqual([
      httpChecks(a.manifest, policy, ['www.h.test']),
    ]);
    expect(state(fake).releases).toEqual([
      {
        id: a.manifest.releaseId,
        commit: a.manifest.commit,
        startedAt: now.toISOString(),
        activatedAt: now.toISOString(),
      },
    ]);
    expect(
      fake.files
        .keys()
        .filter((p) => p.includes('/staged/') || p.endsWith('.part'))
        .toArray(),
    ).toEqual([]);
    expect(
      fake.dirs.has(`/remote/.deploy/staged/${a.manifest.releaseId}`),
    ).toBe(false);
    expect(log.some((l) => l.startsWith('remote: active none'))).toBe(true);
    expect(log.includes('step access-upload')).toBe(true);
  });

  it('rejects a sub-path base before touching the remote', async () => {
    const { fake, local, adapter } = harness();
    const a = await fakeArtifact(local, '/art/a', '1'.repeat(40));
    await expect(
      adapter.deploy(a, { ...policy, base: '/preview/' }),
    ).rejects.toThrow(/supports base "\/" only/);
    expect(fake.steps).toEqual([]);
  });
});

async function twoReleases() {
  const h = harness();
  const a = await fakeArtifact(
    h.local,
    '/art/a',
    '1'.repeat(40),
    extras('impressum', 'alt'),
  );
  const b = await fakeArtifact(
    h.local,
    '/art/b',
    '2'.repeat(40),
    extras('impressum', 'kontakt'),
  );
  await h.adapter.deploy(a, policy);
  await h.adapter.deploy(b, policy);
  return { ...h, a, b };
}

describe('a second deploy and a rollback', () => {
  it("keeps both releases' assets and re-activates the first on rollback", async () => {
    const { fake, local, adapter, a, b } = await twoReleases();
    // Equal-length index.html across releases: sizes alone cannot tell them apart.
    expect(local.files.get('/art/a/web/index.html')?.length).toBe(
      local.files.get('/art/b/web/index.html')?.length,
    );
    expect(fake.files.get('/remote/site/index.html')).toContain(
      'Release 2222222',
    );
    expect(fake.files.has('/remote/site/assets/app.1111111.css')).toBe(true);
    expect(fake.files.has('/remote/site/assets/app.2222222.css')).toBe(true);
    expect(retainedReleases(state(fake)).map((r) => r.id)).toEqual([
      b.manifest.releaseId,
      a.manifest.releaseId,
    ]);

    await adapter.rollback(a, a.manifest.releaseId, policy);
    expect(fake.files.get('/remote/site/index.html')).toContain(
      'Release 1111111',
    );
    expect(
      JSON.parse(fake.files.get('/remote/site/version.json') ?? '') as unknown,
    ).toMatchObject({ release: a.manifest.releaseId });
    expect(fake.files.has('/remote/site/assets/app.2222222.css')).toBe(true);
    expect(
      state(fake).releases.find((r) => r.id === a.manifest.releaseId),
    ).toMatchObject({ activatedAt: now.toISOString() });
    expect(
      state(fake).releases.find((r) => r.id === b.manifest.releaseId),
    ).toMatchObject({ deactivatedAt: now.toISOString() });
  });

  it(
    'a rollback cut off at any command boundary completes when it is re-run',
    {
      timeout: 60_000,
    },
    async () => {
      const { fake: seed, local, a } = await twoReleases();
      const seeded = seed.snapshot();
      const reference = harness(FakeRemote.from(seeded, local), local);
      await reference.adapter.rollback(a, a.manifest.releaseId, policy);
      const expected = reference.fake.snapshot();
      const total = reference.fake.steps.reduce(
        (n, s) => n + s.commands.length,
        0,
      );

      for (let k = 0; k <= total; k += 1) {
        const fake = FakeRemote.from(seeded, local);
        const broken = interrupt(fake, { count: k });
        await expect(
          harness(fake, local, { transport: broken }).adapter.rollback(
            a,
            a.manifest.releaseId,
            policy,
          ),
          `k=${String(k)}`,
        ).rejects.toThrow(/simulated disconnect/);
        await harness(fake, local).adapter.rollback(
          a,
          a.manifest.releaseId,
          policy,
        );
        expect(fake.snapshot(), `final state after k=${String(k)}`).toEqual(
          expected,
        );
      }
    },
  );

  it('refuses to roll back to a release that never went live, even while it is in progress', async () => {
    const { fake, local, adapter } = await twoReleases();
    const c = await fakeArtifact(local, '/art/c', '3'.repeat(40));
    const failing = new FakeHttp(fake);
    failing.failWith = 'http check failed: simulated';
    await expect(
      harness(fake, local, { http: failing }).adapter.deploy(c, policy),
    ).rejects.toThrow(/simulated/);
    await expect(
      adapter.rollback(c, c.manifest.releaseId, policy),
    ).rejects.toThrow(/not retained/);
  });

  it('rejects a mismatching artifact, an incompatible base and an unknown release without writing', async () => {
    const { fake, adapter, a } = await twoReleases();
    const before = fake.snapshot();
    const stepsBefore = fake.steps.length;
    await expect(
      adapter.rollback(
        { dir: a.dir, manifest: { ...a.manifest, commit: '9'.repeat(40) } },
        a.manifest.releaseId,
        policy,
      ),
    ).rejects.toThrow(/does not match retained release/);
    await expect(
      adapter.rollback(a, a.manifest.releaseId, {
        ...policy,
        base: '/preview/',
      }),
    ).rejects.toThrow(/not compatible with target base/);
    await expect(
      adapter.rollback(a, 'no-such-release', policy),
    ).rejects.toThrow(/not retained; retained releases: /);
    expect(fake.snapshot()).toEqual(before);
    expect(
      fake.steps.slice(stepsBefore).every((s) => s.step.startsWith('observe')),
    ).toBe(true);
  });

  it('re-deploying the active release reconciles the overlay and re-checks without a marker', async () => {
    const { fake, local, b, http } = await twoReleases();
    const realiased: WebspaceSettings = {
      ...settings,
      aliases: ['www.h.test', 'alt.h.test'],
    };
    const again = harness(fake, local, { settings: realiased, http });
    const before = fake.steps.length;
    await again.adapter.deploy(b, policy);
    const rerun = fake.steps.slice(before).map((s) => s.step);
    expect(rerun.filter((s) => !s.startsWith('observe'))).toEqual([
      'access-upload',
      'access-commit',
      'config-upload',
      'config-commit',
    ]);
    expect(http.healthCalls.at(-1)?.url).toBe('http://h.test/api/health');
    expect(http.calls.at(-1)).toEqual(
      httpChecks(b.manifest, policy, ['www.h.test', 'alt.h.test']),
    );
  });

  it('inspect reports the active release with its commit and the retained ids without writing', async () => {
    const { fake, adapter, a, b } = await twoReleases();
    const before = fake.snapshot();
    const stepsBefore = fake.steps.length;
    const inspection = await adapter.inspect(policy);
    expect(inspection.active).toEqual({
      releaseId: b.manifest.releaseId,
      commit: b.manifest.commit,
    });
    expect(new Set(inspection.retained)).toEqual(
      new Set([a.manifest.releaseId, b.manifest.releaseId]),
    );
    expect(fake.snapshot()).toEqual(before);
    expect(
      fake.steps.slice(stepsBefore).every((s) => s.step.startsWith('observe')),
    ).toBe(true);
  });
});

describe('a target that names its served folder', () => {
  const named: WebspaceSettings = { ...settings, docroot: 'httpdocs' };

  it('deploys into that folder and keeps .deploy in the root', async () => {
    const { fake, local, adapter } = harness(undefined, undefined, {
      settings: named,
    });
    const a = await fakeArtifact(local, '/art/a', '1'.repeat(40));
    await adapter.deploy(a, policy);
    expect(fake.files.get('/remote/httpdocs/index.html')).toContain(
      'Release 1111111',
    );
    expect(fake.files.has('/remote/httpdocs/.htaccess')).toBe(true);
    expect(fake.files.has('/remote/httpdocs/assets/app.1111111.css')).toBe(
      true,
    );
    expect(fake.files.has('/remote/.deploy/state.json')).toBe(true);
    expect(fake.dirs.has('/remote/site')).toBe(false);
  });

  it('inspects and rolls back in that folder', async () => {
    const { fake, local, adapter } = harness(undefined, undefined, {
      settings: named,
    });
    const a = await fakeArtifact(local, '/art/a', '1'.repeat(40));
    const b = await fakeArtifact(local, '/art/b', '2'.repeat(40));
    await adapter.deploy(a, policy);
    await adapter.deploy(b, policy);
    await adapter.rollback(a, a.manifest.releaseId, policy);
    expect(fake.files.get('/remote/httpdocs/index.html')).toContain(
      'Release 1111111',
    );
    const { active } = await adapter.inspect(policy);
    expect(active).toEqual({
      releaseId: a.manifest.releaseId,
      commit: a.manifest.commit,
    });
  });

  it('publishes the active release into a newly named folder when it is deployed again', async () => {
    const { fake, local, adapter } = harness();
    const a = await fakeArtifact(local, '/art/a', '1'.repeat(40));
    await adapter.deploy(a, policy);
    const moved = harness(fake, local, { settings: named });
    await moved.adapter.deploy(a, policy);
    expect(fake.files.get('/remote/httpdocs/index.html')).toContain(
      'Release 1111111',
    );
    expect(fake.files.has('/remote/httpdocs/assets/app.1111111.css')).toBe(
      true,
    );
    const { active, retained } = await moved.adapter.inspect(policy);
    expect(active?.releaseId).toBe(a.manifest.releaseId);
    expect(retained).toEqual([a.manifest.releaseId]);
  });
});

describe('a served folder that holds files the deploy did not upload', () => {
  const named: WebspaceSettings = { ...settings, docroot: 'httpdocs' };
  const hostFiles = [
    '/remote/httpdocs/favicon.ico',
    '/remote/httpdocs/notes.part',
    '/remote/httpdocs/.well-known/acme-challenge/token',
    '/remote/httpdocs/alt/host.txt',
  ];

  it('keeps them while releases add and drop files', async () => {
    const local = new FakeLocalFiles();
    const fake = new FakeRemote(local);
    for (const dir of ['', '/.well-known', '/.well-known/acme-challenge']) {
      fake.dirs.add(`/remote/httpdocs${dir}`);
    }
    fake.dirs.add('/remote/httpdocs/cgi-bin');
    const { adapter } = harness(fake, local, { settings: named });
    const a = await fakeArtifact(
      local,
      '/art/a',
      '1'.repeat(40),
      extras('impressum', 'alt'),
    );
    const b = await fakeArtifact(local, '/art/b', '2'.repeat(40));
    for (const file of hostFiles.slice(0, 3)) fake.files.set(file, 'host');
    await adapter.deploy(a, policy);
    fake.files.set('/remote/httpdocs/alt/host.txt', 'host');
    await adapter.deploy(b, policy);
    expect(hostFiles.filter((file) => !fake.files.has(file))).toEqual([]);
    expect(fake.dirs.has('/remote/httpdocs/cgi-bin')).toBe(true);
    expect(fake.files.has('/remote/httpdocs/alt/icon.svg')).toBe(false);
  });
});

describe('a configured hashed-asset folder', () => {
  it("keeps the earlier release's assets in that folder and renders its caching rule", async () => {
    const custom = { ...policy, assetDir: '_build' };
    const { fake, local, adapter } = harness();
    const a = await fakeArtifact(local, '/art/a', '1'.repeat(40), [], '_build');
    const b = await fakeArtifact(local, '/art/b', '2'.repeat(40), [], '_build');
    await adapter.deploy(a, custom);
    await adapter.deploy(b, custom);
    expect(
      fake.files
        .keys()
        .filter((path) => path.startsWith('/remote/site/_build/'))
        .toArray()
        .toSorted(),
    ).toEqual([
      '/remote/site/_build/app.1111111.css',
      '/remote/site/_build/app.1111111.js',
      '/remote/site/_build/app.2222222.css',
      '/remote/site/_build/app.2222222.js',
    ]);
    expect(fake.dirs.has('/remote/site/assets')).toBe(false);
    expect(fake.files.get('/remote/site/.htaccess')).toBe(
      renderHtaccess(custom),
    );
    expect(fake.files.get('/remote/site/.htaccess')).toContain('m#^/_build/#');
  });
});

describe('inspect on an empty remote', () => {
  it('reports no active release and no retained ids', async () => {
    const { fake, adapter } = harness();
    expect(await adapter.inspect(policy)).toEqual({ retained: [] });
    expect(fake.files.size).toBe(0);
  });
});

describe('recovery after a disconnect at every command boundary', () => {
  it(
    'a re-run always ends in the uninterrupted final state while the docroot keeps index.html',
    {
      timeout: 60_000,
    },
    async () => {
      // Reference: A active, then B deployed without interruption.
      const seedLocal = new FakeLocalFiles();
      const seed = harness(undefined, seedLocal);
      const a = await fakeArtifact(
        seedLocal,
        '/art/a',
        '1'.repeat(40),
        extras('impressum', 'alt'),
      );
      const b = await fakeArtifact(
        seedLocal,
        '/art/b',
        '2'.repeat(40),
        extras('impressum', 'kontakt'),
      );
      await seed.adapter.deploy(a, policy);
      const seeded = seed.fake.snapshot();
      const reference = harness(FakeRemote.from(seeded, seedLocal), seedLocal);
      await reference.adapter.deploy(b, policy);
      const expected = reference.fake.snapshot();
      const total = reference.fake.steps.reduce(
        (n, s) => n + s.commands.length,
        0,
      );
      expect(total).toBeGreaterThan(40);

      for (let k = 0; k <= total; k += 1) {
        const fake = FakeRemote.from(seeded, seedLocal);
        const broken = interrupt(fake, { count: k });
        const first = harness(fake, seedLocal, { transport: broken });
        await expect(
          first.adapter.deploy(b, policy),
          `k=${String(k)}`,
        ).rejects.toThrow(/simulated disconnect/);
        expect(broken.fired, `k=${String(k)}`).toBe(true);
        expect(
          fake.files.has('/remote/site/index.html'),
          `docroot at k=${String(k)}`,
        ).toBe(true);
        expect(
          fake.files.has('/remote/site/.htaccess'),
          `.htaccess at k=${String(k)}`,
        ).toBe(true);
        const second = harness(fake, seedLocal);
        await second.adapter.deploy(b, policy);
        expect(fake.snapshot(), `final state after k=${String(k)}`).toEqual(
          expected,
        );
      }
    },
  );
});

async function abandonedB() {
  const local = new FakeLocalFiles();
  const h = harness(undefined, local);
  const a = await fakeArtifact(
    local,
    '/art/a',
    '1'.repeat(40),
    extras('impressum', 'alt'),
  );
  const b = await fakeArtifact(
    local,
    '/art/b',
    '2'.repeat(40),
    extras('impressum', 'new'),
  );
  const c = await fakeArtifact(
    local,
    '/art/c',
    '3'.repeat(40),
    extras('impressum', 'kontakt'),
  );
  await h.adapter.deploy(a, policy);
  // Interrupt B right after its activation step completed.
  const probe = harness(FakeRemote.from(h.fake.snapshot(), local), local);
  await probe.adapter.deploy(b, policy);
  let count = 0;
  for (const s of probe.fake.steps) {
    count += s.commands.length;
    if (s.step === 'activation') break;
  }
  // interrupt counts only the commands sent through it, i.e. B's run.
  const broken = interrupt(h.fake, { count });
  await expect(
    harness(h.fake, local, { transport: broken }).adapter.deploy(b, policy),
  ).rejects.toThrow(/simulated disconnect/);
  expect(h.fake.files.get('/remote/site/new/icon.svg')).toBeDefined();
  return { ...h, a, b, c, local };
}

describe('an abandoned release', () => {
  it('is superseded cleanly: its files vanish, its ledger entry and asset stay for the window', async () => {
    const { fake, adapter, a, b, c } = await abandonedB();
    await adapter.deploy(c, policy);
    expect(fake.files.has('/remote/site/new/icon.svg')).toBe(false);
    expect(fake.dirs.has('/remote/site/new')).toBe(false);
    expect(fake.files.has('/remote/site/alt/icon.svg')).toBe(false);
    expect(fake.files.get('/remote/site/index.html')).toContain(
      'Release 3333333',
    );
    const ledger = state(fake).releases;
    expect(ledger.find((r) => r.id === b.manifest.releaseId)).toEqual({
      id: b.manifest.releaseId,
      commit: b.manifest.commit,
      startedAt: now.toISOString(),
      deactivatedAt: now.toISOString(),
    });
    expect(ledger.find((r) => r.id === a.manifest.releaseId)).toMatchObject({
      deactivatedAt: now.toISOString(),
    });
    expect(fake.files.has('/remote/site/assets/app.2222222.css')).toBe(true);
    expect(
      fake.files.has(`/remote/.deploy/manifests/${b.manifest.releaseId}.json`),
    ).toBe(true);
    expect([...fake.dirs].filter((d) => d.includes('/staged/'))).toEqual([]);
  });

  it('is pruned together with its unique asset once 24 h have passed', async () => {
    const { fake, local, a, b, c } = await abandonedB();
    await harness(fake, local).adapter.deploy(c, policy);
    const later = new Date(now.getTime() + PRUNE_WINDOW_MS + 1000);
    const d = await fakeArtifact(local, '/art/d', '4'.repeat(40));
    await harness(fake, local, { clock: () => later }).adapter.deploy(
      d,
      policy,
    );
    const ids = state(fake).releases.map((r) => r.id);
    expect(ids).not.toContain(b.manifest.releaseId);
    expect(ids).toEqual(
      expect.arrayContaining([
        a.manifest.releaseId,
        c.manifest.releaseId,
        d.manifest.releaseId,
      ]),
    );
    expect(fake.files.has('/remote/site/assets/app.2222222.css')).toBe(false);
    expect(
      fake.files.has(`/remote/.deploy/manifests/${b.manifest.releaseId}.json`),
    ).toBe(false);
    expect(fake.files.has('/remote/site/assets/app.1111111.css')).toBe(true);
  });
});

describe('failed http checks', () => {
  it('leave the release in progress, record nothing and prune nothing; a re-run completes it', async () => {
    const local = new FakeLocalFiles();
    const h = harness(undefined, local);
    const a = await fakeArtifact(local, '/art/a', '1'.repeat(40));
    await h.adapter.deploy(a, policy);
    const e = await fakeArtifact(local, '/art/e', '5'.repeat(40));
    const http = new FakeHttp(h.fake);
    http.failWith = 'http check failed: simulated';
    const failing = harness(h.fake, local, { http });
    const stepsBefore = h.fake.steps.length;
    const assetsBefore = h.fake.files
      .keys()
      .filter((p) => p.includes('/assets/'))
      .toArray();
    await expect(failing.adapter.deploy(e, policy)).rejects.toThrow(
      /http check failed: simulated/,
    );
    expect(
      state(h.fake).releases.find((r) => r.id === e.manifest.releaseId),
    ).toEqual({
      id: e.manifest.releaseId,
      commit: e.manifest.commit,
      startedAt: now.toISOString(),
    });
    expect(
      JSON.parse(
        h.fake.files.get('/remote/site/version.json') ?? '',
      ) as unknown,
    ).toMatchObject({ release: e.manifest.releaseId });
    expect(
      h.fake.files
        .keys()
        .filter((p) => p.includes('/assets/'))
        .toArray(),
    ).toEqual(expect.arrayContaining(assetsBefore));
    expect(h.fake.steps.slice(stepsBefore).map((s) => s.step)).not.toContain(
      'record',
    );
    await harness(h.fake, local).adapter.deploy(e, policy);
    expect(
      state(h.fake).releases.find((r) => r.id === e.manifest.releaseId),
    ).toMatchObject({ activatedAt: now.toISOString() });
  });
});

describe('a stale staging marker from an earlier attempt', () => {
  it('is cleared when the release starts again, so a rollback re-stages its files', async () => {
    const local = new FakeLocalFiles();
    const fake = new FakeRemote(local);
    const z = await fakeArtifact(local, '/art/z', '9'.repeat(40));
    const a = await fakeArtifact(local, '/art/a', '1'.repeat(40));
    const y = await fakeArtifact(local, '/art/y', '2'.repeat(40));
    await harness(fake, local).adapter.deploy(z, policy);
    // A is recorded but its finish is cut off: staged/<A>/.verified survives.
    const finishFails: FileTransport = {
      run: (step, commands) =>
        step === 'finish'
          ? Promise.reject(new Error('simulated disconnect in finish'))
          : fake.run(step, commands),
    };
    await expect(
      harness(fake, local, { transport: finishFails }).adapter.deploy(
        a,
        policy,
      ),
    ).rejects.toThrow(/finish/);
    // Y goes live but fails its checks, then the operator rolls back to A.
    const failing = new FakeHttp(fake);
    failing.failWith = 'http check failed: simulated';
    await expect(
      harness(fake, local, { http: failing }).adapter.deploy(y, policy),
    ).rejects.toThrow(/simulated/);
    await harness(fake, local).adapter.rollback(
      a,
      a.manifest.releaseId,
      policy,
    );
    expect(fake.files.get('/remote/site/index.html')).toContain(
      'Release 1111111',
    );
    expect(fake.files.get('/remote/site/img/app.svg')).toContain('1111111');
    expect(
      JSON.parse(fake.files.get('/remote/site/version.json') ?? '') as unknown,
    ).toMatchObject({ release: a.manifest.releaseId });
  });
});

describe('a failed observation', () => {
  it('aborts the deploy instead of treating the remote as empty', async () => {
    const local = new FakeLocalFiles();
    const h = harness(undefined, local);
    const a = await fakeArtifact(local, '/art/a', '1'.repeat(40));
    const b = await fakeArtifact(local, '/art/b', '2'.repeat(40));
    await h.adapter.deploy(a, policy);
    const before = h.fake.snapshot();
    const stepsBefore = h.fake.steps.length;
    const denied: FileTransport = {
      run: (step, commands) =>
        commands.some((c) => c.op === 'get' && c.remote.endsWith('/state.json'))
          ? Promise.reject(
              new Error(`transfer step "${step}" failed: Permission denied`),
            )
          : h.fake.run(step, commands),
    };
    await expect(
      harness(h.fake, local, { transport: denied }).adapter.deploy(b, policy),
    ).rejects.toThrow(/Permission denied/);
    // Only the access overlay (re-rendered, identical) may have been written.
    expect(h.fake.snapshot()).toEqual(before);
    expect(h.fake.steps.slice(stepsBefore).map((s) => s.step)).toEqual([
      'observe-1',
      'observe-2',
    ]);
  });
});

const served = (fake: FakeRemote, path: string) =>
  fake.files.get(`/remote/site/${path}`) ?? '';

describe('API-first activation', () => {
  const shell = ['index.html', 'manifest.webmanifest', 'sw.js'];

  it('switches the API pointer, asks health, and only then switches the shell', async () => {
    const { fake, local, adapter } = harness();
    const a = await fakeArtifact(local, '/art/a', '1'.repeat(40));
    await adapter.deploy(a, policy);
    const b = await fakeArtifact(local, '/art/b', '2'.repeat(40));
    let atHealth: { pointer: string; shell: string[] } | undefined;
    const http = new FakeHttp(fake);
    const health = http.health.bind(http);
    http.health = (url) => {
      atHealth = {
        pointer: served(fake, 'api/index.php'),
        shell: shell.map((path) => served(fake, path)),
      };
      return health(url);
    };
    const before = fake.steps.length;
    await harness(fake, local, { http }).adapter.deploy(b, policy);

    const names = fake.steps.slice(before).map((s) => s.step);
    // The schema-floor check asks live health before the first write; the
    // check of the new release follows the API pointer switch.
    const [floor, call] = http.healthCalls;
    expect(http.healthCalls).toHaveLength(2);
    expect(
      names
        .slice(0, (floor?.afterStep ?? 0) - before)
        .filter((n) => !n.startsWith('observe')),
    ).toEqual([]);
    expect(call?.url).toBe('http://h.test/api/health');
    const afterStep = (call?.afterStep ?? 0) - before;
    expect(
      names.slice(0, afterStep).filter((n) => !n.startsWith('observe')),
    ).toEqual([
      'access-upload',
      'access-commit',
      'marker',
      'assets-upload',
      'assets-commit',
      'app-upload',
      'app-verified',
      'staging-upload',
      'staging-verified',
      'config-upload',
      'config-commit',
      'activation',
    ]);
    expect(names.slice(afterStep)).toContain('shell');
    expect(atHealth?.pointer).toContain('/app/0.1.0-2222222/');
    expect(atHealth?.shell.every((body) => body.includes('1111111'))).toBe(
      true,
    );
    const shellStep = fake.steps.find((s) => s.step === 'shell');
    expect(shellStep?.commands.map((c) => c.op === 'rename' && c.to)).toEqual(
      shell.map((path) => `/remote/site/${path}`),
    );
    for (const path of shell) expect(served(fake, path)).toContain('2222222');
  });

  it.each([
    [
      'reports another app version',
      { reportedVersion: '0.0.9+0000000' },
      'health check failed: http://h.test/api/health reports app version 0.0.9+0000000, expected 0.1.0+2222222',
    ],
    [
      'fails its migration',
      { schemaVersion: 2, failing: true },
      'health check failed: http://h.test/api/health reports migration failed at schema version 1',
    ],
  ])(
    'fails the deploy and leaves the shell unswitched when the new release %s',
    async (_case, app, message) => {
      const { fake, local, adapter } = harness();
      const a = await fakeArtifact(local, '/art/a', '1'.repeat(40));
      await adapter.deploy(a, policy);
      const b = await fakeArtifact(
        local,
        '/art/b',
        '2'.repeat(40),
        undefined,
        undefined,
        app,
      );
      const before = fake.steps.length;
      await expect(adapter.deploy(b, policy)).rejects.toThrow(message);
      expect(fake.steps.slice(before).map((s) => s.step)).not.toContain(
        'shell',
      );
      for (const path of shell) {
        expect(served(fake, path), path).toContain('1111111');
      }
      expect(served(fake, 'api/index.php')).toContain('/app/0.1.0-2222222/');
      expect(JSON.parse(served(fake, 'version.json'))).toMatchObject({
        release: a.manifest.releaseId,
      });
      expect(
        state(fake).releases.find((r) => r.id === b.manifest.releaseId),
      ).not.toHaveProperty('activatedAt');
    },
  );

  it('recovers from a failed migration with a corrected release', async () => {
    const { fake, local, adapter } = harness();
    const broken = await fakeArtifact(
      local,
      '/art/b',
      '2'.repeat(40),
      undefined,
      undefined,
      { schemaVersion: 2, failing: true },
    );
    await expect(adapter.deploy(broken, policy)).rejects.toThrow(
      /migration failed/,
    );
    const fixed = await fakeArtifact(
      local,
      '/art/c',
      '3'.repeat(40),
      undefined,
      undefined,
      { schemaVersion: 2 },
    );
    await adapter.deploy(fixed, policy);
    expect(served(fake, 'index.html')).toContain('3333333');
  });

  it('needs the runtime configuration before touching the remote', async () => {
    const local = new FakeLocalFiles();
    const fake = new FakeRemote(local);
    const adapter = createAdapter({
      transport: fake,
      http: new FakeHttp(fake),
      files: local,
      settings,
      now: () => now,
      log: () => undefined,
    });
    const a = await fakeArtifact(local, '/art/a', '1'.repeat(40));
    await expect(adapter.deploy(a, policy)).rejects.toThrow(
      'a deploy needs the runtime configuration',
    );
    expect(fake.steps).toEqual([]);
  });
});

describe('same-schema rollback', () => {
  async function schemaReleases() {
    const h = harness();
    const at = (commit: string, schemaVersion: number) =>
      fakeArtifact(
        h.local,
        `/art/${commit.slice(0, 1)}`,
        commit,
        undefined,
        undefined,
        { schemaVersion },
      );
    const a = await at('1'.repeat(40), 1);
    const b = await at('2'.repeat(40), 2);
    const c = await at('3'.repeat(40), 2);
    for (const release of [a, b, c]) await h.adapter.deploy(release, policy);
    return { ...h, a, b, c };
  }

  it('refuses a retained release whose schema differs from the live one, without writing', async () => {
    const { fake, adapter, a } = await schemaReleases();
    const before = fake.snapshot();
    await expect(
      adapter.rollback(a, a.manifest.releaseId, policy),
    ).rejects.toThrow(
      `release ${a.manifest.releaseId} expects schema version 1, but the live database is at schema version 2; rollback only returns to a release with the live schema, fix forward instead`,
    );
    expect(fake.snapshot()).toEqual(before);
  });

  it('reactivates a retained release with the live schema', async () => {
    const { fake, adapter, b } = await schemaReleases();
    await adapter.rollback(b, b.manifest.releaseId, policy);
    expect(served(fake, 'index.html')).toContain('2222222');
    expect(served(fake, 'api/index.php')).toContain('/app/0.1.0-2222222/');
  });
});

describe('PHP release folders', () => {
  it('are kept for the retained releases and pruned with the rest', async () => {
    const { fake, local } = harness();
    const deployAt = async (commit: string, at: Date) => {
      const artifact = await fakeArtifact(
        local,
        `/art/${commit.slice(0, 1)}`,
        commit,
      );
      await harness(fake, local, { clock: () => at }).adapter.deploy(
        artifact,
        policy,
      );
    };
    const minutes = (n: number) => new Date(now.getTime() + n * 60_000);
    await deployAt('1'.repeat(40), now);
    await deployAt('2'.repeat(40), minutes(1));
    await deployAt('3'.repeat(40), minutes(2));
    const later = new Date(minutes(2).getTime() + PRUNE_WINDOW_MS);
    await deployAt('4'.repeat(40), later);
    const folders = [...fake.dirs]
      .filter((dir) => /^\/remote\/app\/[^/]+$/.test(dir))
      .toSorted();
    expect(folders).toEqual([
      '/remote/app/0.1.0-2222222',
      '/remote/app/0.1.0-3333333',
      '/remote/app/0.1.0-4444444',
    ]);
    expect(
      fake.files
        .keys()
        .filter((p) => p.includes('0.1.0-1111111'))
        .toArray(),
    ).toEqual([]);
  });
});

describe('a newer release that switched the API but not the shell', () => {
  /** The review's case: A at schema 1 is live, B at schema 2 migrated the database and was cut off at `shell`. */
  async function interruptedNewer() {
    const h = harness();
    const at = (commit: string, schemaVersion: number) =>
      fakeArtifact(
        h.local,
        `/art/${commit.slice(0, 1)}`,
        commit,
        undefined,
        undefined,
        { schemaVersion },
      );
    const a = await at('1'.repeat(40), 1);
    const b = await at('2'.repeat(40), 2);
    await h.adapter.deploy(a, policy);
    const broken = interrupt(h.fake, { step: 'shell', count: 0 });
    await expect(
      harness(h.fake, h.local, {
        transport: broken,
        http: h.http,
      }).adapter.deploy(b, policy),
    ).rejects.toThrow(/simulated disconnect during shell/);
    expect(served(h.fake, 'api/index.php')).toContain('/app/0.1.0-2222222/');
    expect(h.http.completed).toContain('0002_step.php');
    return { ...h, a, b };
  }

  it('inspect reports it as in progress beside the active release', async () => {
    const { adapter, a, b } = await interruptedNewer();

    expect(await adapter.inspect(policy)).toMatchObject({
      active: { releaseId: a.manifest.releaseId, commit: a.manifest.commit },
      inProgress: {
        releaseId: b.manifest.releaseId,
        commit: b.manifest.commit,
      },
    });
  });

  it('a plain deploy of the older release is refused before anything is written', async () => {
    const { fake, adapter, a } = await interruptedNewer();
    const before = fake.snapshot();

    await expect(adapter.deploy(a, policy)).rejects.toThrow(
      `release ${a.manifest.releaseId} expects schema version 1, but the live database is at schema version 2; a deploy never moves below the live schema: deploy the newer release again or fix forward`,
    );
    expect(fake.snapshot()).toEqual(before);
    expect(served(fake, 'api/index.php')).toContain('/app/0.1.0-2222222/');
  });

  it('is refused also while health does not answer, from the in-progress release it records', async () => {
    const { fake, local, a, b } = await interruptedNewer();
    const down = new FakeHttp(fake);
    down.health = (url) =>
      Promise.reject(new Error(`health check failed: ${url} answered 500`));
    const before = fake.snapshot();

    await expect(
      harness(fake, local, { http: down }).adapter.deploy(a, policy),
    ).rejects.toThrow(
      `release ${a.manifest.releaseId} expects schema version 1, but release ${b.manifest.releaseId} (in progress) expects schema version 2; a deploy never moves below the live schema: deploy the newer release again or fix forward`,
    );
    expect(fake.snapshot()).toEqual(before);
  });

  it('the newer release itself completes when it is deployed again', async () => {
    const { fake, adapter, b } = await interruptedNewer();

    await adapter.deploy(b, policy);

    expect(served(fake, 'index.html')).toContain('2222222');
    expect((await adapter.inspect(policy)).inProgress).toBeUndefined();
  });

  it('a retained release below the live schema is refused too, though the ledger calls it previous', async () => {
    const { fake, adapter, a, b } = await interruptedNewer();
    await adapter.deploy(b, policy);
    const before = fake.snapshot();

    await expect(adapter.deploy(a, policy)).rejects.toThrow(
      /expects schema version 1, but the live database is at schema version 2/,
    );
    expect(fake.snapshot()).toEqual(before);
  });
});

describe('health of an older release on a newer schema', () => {
  it('reports the schema the database is at, not the release’s own newest migration', async () => {
    const { fake, local, http, adapter } = harness();
    const a = await fakeArtifact(local, '/art/a', '1'.repeat(40));
    const b = await fakeArtifact(
      local,
      '/art/b',
      '2'.repeat(40),
      undefined,
      undefined,
      { schemaVersion: 2 },
    );
    await adapter.deploy(a, policy);
    await adapter.deploy(b, policy);
    // The API pointer names A's PHP again, which knows migration 1 only.
    fake.files.set(
      '/remote/site/api/index.php',
      served(fake, 'api/index.php').replace(
        b.manifest.app.folder,
        a.manifest.app.folder,
      ),
    );

    const report = await http.health('http://h.test/api/health');

    expect(report.appVersion).toBe(a.manifest.app.appVersion);
    expect(report.schemaVersion).toBe(2);
  });
});
