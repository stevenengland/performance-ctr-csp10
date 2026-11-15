import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { request } from 'node:http';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { headers } from './contract/headers.ts';
import {
  MANIFEST_FILE,
  parseManifest,
  type Manifest,
} from './contract/artifact.ts';
import { parseHealth, type HealthReport } from './contract/health.ts';
import { targetPolicy } from './contract/policy.ts';
import { parseRuntimeConfig } from './contract/runtime-config.ts';
import { httpChecker } from './io/http-smoke.ts';
import { renderHtaccess } from './webspace/htaccess.ts';
import { renderRuntimeConfig } from './webspace/runtime-config.ts';
import type { FileCommand, FileTransport } from './webspace/ports.ts';
import {
  adapterFor,
  rawSftp,
  startContainers,
  stopContainers,
  targetEnv,
  type Containers,
} from '../tests/support/deploy-containers.ts';
import { describeTransportContract } from '../tests/support/transport-contract.ts';
import {
  writeFixtureArtifact,
  type FixtureApp,
} from '../tests/support/fixture-artifact.ts';
import { interrupt, type Interrupt } from '../tests/support/interrupt.ts';
import { runCaptured, type Captured } from '../tests/support/run-captured.ts';

const run = promisify(execFile);
const root = join(import.meta.dirname, '..');
const cli = join(root, 'deploy/cli.ts');
const baseEnv = { PATH: process.env.PATH ?? '', HOME: process.env.HOME ?? '' };
/** Extra activated files per release, one folder each, so cleanup has folders to remove. */
const extras = (...names: string[]) => names.map((name) => `${name}/icon.svg`);

let containers: Containers;
let env: Record<string, string>;
let work: string;
let one: { dir: string; manifest: Manifest };
/** Files in the target root that the deploy does not own. */
const FOREIGN = ['foreign.txt', 'notes.part', 'httpdocs'];

async function deployCli(
  args: string[],
  overrides: Record<string, string> = {},
): Promise<Captured> {
  const result = await runCaptured(process.execPath, [cli, ...args], {
    cwd: root,
    env: { ...baseEnv, ...env, ...overrides },
    maxBuffer: 16 * 1024 * 1024,
  });
  const output = result.stdout + result.stderr;
  expect(output).not.toContain(containers.sftpPassword);
  expect(output).not.toContain(containers.db.password);
  expect(output).not.toMatch(/\bdeploy@/);
  return result;
}
const get = (path: string) =>
  fetch(`${containers.origin}${path}`, { redirect: 'manual' });

async function statusOf(path: string): Promise<number> {
  const response = await get(path);
  return response.status;
}
async function textOf(path: string): Promise<string> {
  const response = await get(path);
  return response.text();
}
function assetNames(
  listings: ReadonlyMap<string, ReadonlyMap<string, unknown>>,
): string[] {
  return listings.get('/remote/site/assets')?.keys().toArray() ?? [];
}
async function servedVersion(): Promise<unknown> {
  const response = await get('/version.json');
  return response.json();
}
async function health(): Promise<HealthReport> {
  const response = await get('/api/health');
  expect(response.status).toBe(200);
  return parseHealth(await response.text());
}

beforeAll(async () => {
  containers = await startContainers();
  env = targetEnv(containers);
  const cache = join(root, 'node_modules', '.cache');
  await mkdir(cache, { recursive: true });
  work = await mkdtemp(join(cache, 'deploy-it-'));
  one = {
    dir: join(work, 'one'),
    manifest: await writeFixtureArtifact(
      join(work, 'one'),
      '1'.repeat(40),
      extras('img', 'alt'),
    ),
  };
  const foreign = join(work, 'foreign.txt');
  await writeFile(foreign, 'not ours');
  await rawSftp(containers).run('seed', [
    { op: 'put', local: foreign, remote: '/remote/foreign.txt' },
    { op: 'put', local: foreign, remote: '/remote/notes.part' },
    { op: 'mkdir', path: '/remote/httpdocs' },
    { op: 'put', local: foreign, remote: '/remote/httpdocs/index.html' },
  ]);
});
/** Every foreign root entry, also a foreign *.part file, survives whatever ran: deploys, rollbacks, recoveries. */
async function expectForeignRootKept(): Promise<void> {
  const listing = await rawSftp(containers).run('inspect', [
    { op: 'ls', path: '/remote' },
    { op: 'ls', path: '/remote/httpdocs' },
  ]);
  expect([...(listing.get('/remote')?.keys() ?? [])]).toEqual(
    expect.arrayContaining(FOREIGN),
  );
  expect([...(listing.get('/remote/httpdocs')?.keys() ?? [])]).toEqual([
    'index.html',
  ]);
}

// After the whole file, so a filtered run still proves it for the phases it ran.
afterAll(async () => {
  try {
    await expectForeignRootKept();
  } finally {
    await stopContainers();
  }
});

describe('cli deploy against the containers', () => {
  it('activates the artifact: version.json, shell, app routes, headers, assets, hidden files', async () => {
    const result = await deployCli(['deploy', '--artifact', one.dir]);
    expect({ code: result.code, stderr: result.stderr }).toEqual({
      code: 0,
      stderr: '',
    });
    expect(result.stdout).toContain(`release ${one.manifest.releaseId}`);

    const version = await get('/version.json');
    expect(version.status).toBe(200);
    expect(await version.json()).toEqual({
      release: one.manifest.releaseId,
      commit: one.manifest.commit,
    });

    const policy = targetPolicy(containers.origin);
    for (const route of ['/', '/rangliste', '/verlauf/3']) {
      const ok = await get(route);
      expect({ route, status: ok.status }).toEqual({ route, status: 200 });
      expect(await ok.text()).toContain('Release 1111111');
      expect(ok.headers.get('Cache-Control')).toBe('no-cache');
      for (const header of headers(policy)) {
        expect(ok.headers.get(header.name), `${route} ${header.name}`).toBe(
          header.value,
        );
      }
    }
    const asset = await get('/assets/app.1111111.css');
    expect(asset.status).toBe(200);
    expect(await asset.text()).toBe('body{content:"1111111"}');
    expect(asset.headers.get('Cache-Control')).toBe(
      'public, max-age=31536000, immutable',
    );
    expect(await statusOf('/assets/app.0000000.js')).toBe(404);
    expect(await health()).toMatchObject({
      appVersion: one.manifest.app.appVersion,
      schemaVersion: 1,
      migration: 'ok',
    });
  });

  it('keeps the runtime config, the PHP releases and the ledger out of HTTP reach', async () => {
    const folder = one.manifest.app.folder;
    const local = join(work, 'runtime.php');
    const listings = await rawSftp(containers).run('inspect', [
      { op: 'ls', path: '/remote' },
      { op: 'ls', path: `/remote/app/${folder}` },
      { op: 'get', remote: '/remote/config/runtime.php', local },
    ]);
    expect([...(listings.get('/remote')?.keys() ?? [])]).toEqual(
      expect.arrayContaining(['.deploy', 'app', 'config', 'site']),
    );
    expect(listings.get(`/remote/app/${folder}`)?.has('release.php')).toBe(
      true,
    );
    expect(await readFile(local, 'utf8')).toBe(
      renderRuntimeConfig(parseRuntimeConfig(env)),
    );
    for (const hidden of [
      '/.deploy/state.json',
      '/.htaccess',
      '/config/runtime.php',
      `/app/${folder}/release.php`,
      `/app/${folder}/public/index.php`,
      `/app/${folder}/composer.json`,
    ]) {
      const response = await get(hidden);
      expect({ hidden, status: response.status }).toEqual({
        hidden,
        status: expect.toBeOneOf([403, 404]) as unknown,
      });
      expect(await response.text()).not.toContain(containers.db.password);
    }
  });

  it('refuses a server whose host key is not pinned, without touching the remote', async () => {
    const keyDir = await mkdtemp(join(work, 'key-'));
    await run('ssh-keygen', [
      '-t',
      'ed25519',
      '-N',
      '',
      '-q',
      '-f',
      join(keyDir, 'key'),
    ]);
    const publicKey = await readFile(join(keyDir, 'key.pub'), 'utf8');
    const foreign = `[${containers.host}]:${String(containers.sftpPort)} ${publicKey.trim()}`;
    const before = await textOf('/version.json');
    const result = await deployCli(['deploy', '--artifact', one.dir], {
      SFTP_KNOWN_HOSTS: foreign,
    });
    expect(result.code).toBe(1);
    expect(result.stderr).toContain(
      '::error::deploy: transfer step "observe-1" failed',
    );
    expect(result.stderr).toMatch(/host key/i);
    expect(await textOf('/version.json')).toBe(before);
  });

  it('fails without leaking secrets when the password is wrong', async () => {
    const result = await deployCli(['deploy', '--artifact', one.dir], {
      SFTP_PASS: 'wrong-test-password',
    });
    expect(result.code).toBe(1);
    expect(result.stderr).toContain(
      '::error::deploy: transfer step "observe-1" failed',
    );
    expect(result.stdout + result.stderr).not.toContain('wrong-test-password');
  });
});

const policy = () => targetPolicy(containers.origin);
const API_POINTER = 'api/index.php';
const sha7 = (manifest: Manifest) => manifest.commit.slice(0, 7);

async function expectFullyActive(manifest: Manifest) {
  expect(await servedVersion()).toEqual({
    release: manifest.releaseId,
    commit: manifest.commit,
  });
  expect(await health()).toMatchObject({
    appVersion: manifest.app.appVersion,
    schemaVersion: manifest.app.schemaVersion,
    migration: 'ok',
  });
  // The API pointer is run by PHP, not served; health above proves it.
  for (const file of manifest.files.filter((f) => f.path !== API_POINTER)) {
    const path = '/' + file.path.replace(/index\.html$/, '');
    const response = await get(path);
    expect({ path, status: response.status }).toEqual({ path, status: 200 });
    const body = await response.text();
    expect({ path, body }).toEqual({
      path,
      body: expect.stringContaining(sha7(manifest)) as unknown,
    });
    expect({ path, size: Buffer.byteLength(body) }).toEqual({
      path,
      size: file.size,
    });
  }
  const listing = await rawSftp(containers).run('inspect', [
    { op: 'ls', path: '/remote/site/assets' },
    { op: 'ls', path: '/remote/.deploy/staged' },
    { op: 'ls', path: '/remote/site' },
  ]);
  const names = listing
    .values()
    .flatMap((dir) => dir.keys())
    .toArray();
  expect(names.filter((name) => /\.part$|^\.verified$/.test(name))).toEqual([]);
  expect(listing.get('/remote/.deploy/staged')?.has(manifest.releaseId)).toBe(
    false,
  );
}

describe('asset continuity', () => {
  it("keeps the first release's assets reachable after a second deploy and after a rollback", async () => {
    const two = {
      dir: join(work, 'two'),
      manifest: await writeFixtureArtifact(
        join(work, 'two'),
        '2'.repeat(40),
        extras('img', 'kontakt'),
      ),
    };
    const savedHtml = await textOf('/');
    const assetPaths = savedHtml
      .matchAll(/(?:href|src)="(\/assets\/[^"]+)"/g)
      .map((m) => m[1] ?? '')
      .toArray();
    expect(assetPaths).toEqual([
      '/assets/app.1111111.css',
      '/assets/app.1111111.js',
    ]);

    await adapterFor(containers).deploy(two, policy());
    await expectFullyActive(two.manifest);
    expect(await statusOf('/kontakt/icon.svg')).toBe(200);
    expect(await statusOf('/alt/icon.svg')).toBe(404);
    for (const asset of assetPaths)
      expect({ asset, status: await statusOf(asset) }).toEqual({
        asset,
        status: 200,
      });

    await adapterFor(containers).rollback(
      one,
      one.manifest.releaseId,
      policy(),
    );
    await expectFullyActive(one.manifest);
    expect(await statusOf('/alt/icon.svg')).toBe(200);
    expect(await statusOf('/kontakt/icon.svg')).toBe(404);
    for (const asset of assetPaths)
      expect({ asset, status: await statusOf(asset) }).toEqual({
        asset,
        status: 200,
      });
    expect(await statusOf('/assets/app.2222222.css')).toBe(200);
  });
});

describe('recovery after a forced disconnect', () => {
  const transitions: [string, Interrupt, boolean][] = [
    ['after the in-progress marker', { step: 'marker', count: 'all' }, false],
    ['mid asset upload', { step: 'assets-upload', op: 'put', count: 1 }, true],
    ['after asset verification', { step: 'assets-commit', count: 0 }, false],
    ['mid staging', { step: 'staging-upload', op: 'put', count: 1 }, false],
    ['mid activation', { step: 'activation', op: 'rename', count: 1 }, false],
    ['before the state is recorded', { step: 'record', count: 0 }, false],
  ];

  it.each(transitions)(
    '%s, then a re-run, ends fully active',
    async (name, at, plantTruncated) => {
      const n = transitions.findIndex(([label]) => label === name) + 3;
      const dir = join(work, `t${String(n)}`);
      const manifest = await writeFixtureArtifact(
        dir,
        String(n).repeat(40),
        extras('img', `route${String(n)}`),
      );
      const before = (await servedVersion()) as {
        release: string;
      };

      const broken = interrupt(rawSftp(containers), at);
      await expect(
        adapterFor(containers, { transport: broken }).deploy(
          { dir, manifest },
          policy(),
        ),
      ).rejects.toThrow(/simulated disconnect/);
      expect(
        broken.fired,
        `the ${at.step ?? 'first'} phase must have been reached`,
      ).toBe(true);

      // The web root is still served by one of the two releases.
      expect(await statusOf('/')).toBe(200);
      expect(await statusOf('/version.json')).toBe(200);

      if (plantTruncated) {
        const stub = join(work, 'stub.css');
        await writeFile(stub, 'x');
        await rawSftp(containers).run('plant', [
          {
            op: 'put',
            local: stub,
            remote: `/remote/site/assets/app.${sha7(manifest)}.css.part`,
          },
        ]);
      }

      await adapterFor(containers).deploy({ dir, manifest }, policy());
      await expectFullyActive(manifest);
      expect(before.release).not.toBe(manifest.releaseId);
    },
  );
});

describe('prune ordering', () => {
  it('records nothing and prunes nothing when the http checks fail; a re-run completes', async () => {
    const dir = join(work, 'checks');
    const manifest = await writeFixtureArtifact(dir, '9'.repeat(40));
    const assetsBefore = await rawSftp(containers).run('inspect', [
      { op: 'ls', path: '/remote/site/assets' },
    ]);
    const failing = adapterFor(containers, {
      http: {
        run: () => Promise.reject(new Error('http check failed: simulated')),
        health: (url) => httpChecker.health(url),
      },
    });
    await expect(failing.deploy({ dir, manifest }, policy())).rejects.toThrow(
      /http check failed: simulated/,
    );
    expect(await servedVersion()).toMatchObject({
      release: manifest.releaseId,
    });
    await rawSftp(containers).run('inspect', [
      {
        op: 'get',
        remote: '/remote/.deploy/state.json',
        local: join(work, 'state.json'),
      },
    ]);
    const ledger = JSON.parse(
      await readFile(join(work, 'state.json'), 'utf8'),
    ) as { releases: { id: string; activatedAt?: string }[] };
    expect(
      ledger.releases.find((r) => r.id === manifest.releaseId)?.activatedAt,
    ).toBeUndefined();
    const assetsAfter = await rawSftp(containers).run('inspect', [
      { op: 'ls', path: '/remote/site/assets' },
    ]);
    expect(assetNames(assetsAfter)).toEqual(
      expect.arrayContaining(
        assetNames(assetsBefore).filter((name) => name.endsWith('.css')),
      ),
    );
    await adapterFor(containers).deploy({ dir, manifest }, policy());
    await expectFullyActive(manifest);
  });
});

describe('rollback', () => {
  it('rejects a mismatching artifact, another base and an unknown release without touching the remote', async () => {
    const current = (await servedVersion()) as {
      release: string;
    };
    const dir = join(work, 'tampered');
    const manifest = await writeFixtureArtifact(dir, '9'.repeat(40));
    const inspect = () =>
      rawSftp(containers).run('inspect', [
        { op: 'ls', path: '/remote/site' },
        { op: 'ls', path: '/remote/site/assets' },
        { op: 'ls', path: '/remote/.deploy' },
        { op: 'ls', path: '/remote/.deploy/manifests' },
      ]);
    const before = await inspect();
    await expect(
      adapterFor(containers).rollback(
        { dir, manifest: { ...manifest, commit: '8'.repeat(40) } },
        current.release,
        policy(),
      ),
    ).rejects.toThrow(/does not match retained release/);
    await expect(
      adapterFor(containers).rollback({ dir, manifest }, current.release, {
        ...policy(),
        base: '/preview/',
      }),
    ).rejects.toThrow(/not compatible with target base/);
    await expect(
      adapterFor(containers).rollback(
        { dir, manifest },
        'no-such-release',
        policy(),
      ),
    ).rejects.toThrow(/not retained; retained releases: /);
    expect(await inspect()).toEqual(before);
    expect(await servedVersion()).toMatchObject({
      release: current.release,
    });
  });

  it('re-deploys the active release and rolls back to a retained one through the cli', async () => {
    const current = (await servedVersion()) as {
      release: string;
      commit: string;
    };
    // Re-deploy the already active artifact as built, not a rebuild with a new release id.
    const dir = join(work, 'checks');
    const manifest = parseManifest(
      await readFile(join(dir, MANIFEST_FILE), 'utf8'),
    );
    expect(current.release).toBe(manifest.releaseId);
    const again = await deployCli(['deploy', '--artifact', dir]);
    expect({ code: again.code, stderr: again.stderr }).toEqual({
      code: 0,
      stderr: '',
    });

    const inspection = await deployCli(['inspect']);
    expect(inspection.code).toBe(0);
    const { active, retained } = JSON.parse(inspection.stdout) as {
      active: { releaseId: string };
      retained: string[];
    };
    expect(active.releaseId).toBe(manifest.releaseId);

    // Only the active release and the two most recently deactivated ones are
    // retained, so roll back to the release the checks deploy superseded.
    const previousDir = join(work, 't8');
    const previous = parseManifest(
      await readFile(join(previousDir, MANIFEST_FILE), 'utf8'),
    );
    expect(retained).toContain(previous.releaseId);
    const back = await deployCli([
      'rollback',
      '--artifact',
      previousDir,
      '--release',
      previous.releaseId,
    ]);
    expect({ code: back.code, stderr: back.stderr }).toEqual({
      code: 0,
      stderr: '',
    });
    await expectFullyActive(previous);
  });
});

/** A transport and an http checker that log, in order, every transfer step and each health request. */
function recorded(
  events: string[],
  onHealth?: (report: HealthReport) => Promise<void>,
) {
  const raw = rawSftp(containers);
  const transport: FileTransport = {
    run: (step: string, commands: readonly FileCommand[]) => {
      events.push(step);
      return raw.run(step, commands);
    },
  };
  return {
    transport,
    http: {
      run: httpChecker.run,
      health: async (url: string) => {
        events.push('health');
        const report = await httpChecker.health(url);
        await onHealth?.(report);
        return report;
      },
    },
  };
}

describe('API-first activation on Apache + PHP + MySQL', () => {
  it('uploads assets and the PHP release and renders the config, switches the API pointer, migrates through health, and switches the shell last', async () => {
    const live = (await servedVersion()) as { release: string };
    const liveShell = await textOf('/');
    const dir = join(work, 'p1');
    const manifest = await writeFixtureArtifact(dir, 'a'.repeat(40));
    const events: string[] = [];
    let atHealth: { shell: string; report: HealthReport } | undefined;
    const ports = recorded(events, async (report) => {
      atHealth = { shell: await textOf('/'), report };
    });
    await adapterFor(containers, ports).deploy({ dir, manifest }, policy());

    const phases = events.filter((event) => !event.startsWith('observe'));
    const at = (name: string) => {
      expect(phases, name).toContain(name);
      return phases.indexOf(name);
    };
    for (const before of ['assets-commit', 'app-upload', 'config-commit']) {
      expect(at(before), before).toBeLessThan(at('activation'));
    }
    expect(at('activation')).toBeLessThan(at('health'));
    expect(at('health')).toBeLessThan(at('shell'));
    expect(phases.filter((event) => event === 'health')).toHaveLength(1);
    // Health answered for the new release while browsers still got the old shell.
    expect(atHealth?.report).toMatchObject({
      appVersion: manifest.app.appVersion,
      schemaVersion: 1,
      migration: 'ok',
    });
    expect(atHealth?.shell).toBe(liveShell);
    expect(live.release).not.toBe(manifest.releaseId);
    await expectFullyActive(manifest);
  });

  it.each([
    [
      'reports another app version',
      'b',
      { reportedVersion: '0.0.9+0000000' } as FixtureApp,
      'reports app version 0.0.9+0000000, expected 0.1.0+bbbbbbb',
    ],
    [
      'fails its migration',
      'c',
      { schemaVersion: 2, failing: true } as FixtureApp,
      'reports migration failed at schema version 1',
    ],
  ])(
    'fails the deploy and leaves index.html, manifest and service worker unswitched when the new release %s',
    async (_case, char, app, message) => {
      const shell = ['/', '/manifest.webmanifest', '/sw.js'];
      const before = await Promise.all(shell.map((path) => textOf(path)));
      const version = await servedVersion();
      const dir = join(work, `bad-${char}`);
      const manifest = await writeFixtureArtifact(
        dir,
        char.repeat(40),
        undefined,
        app,
      );
      await expect(
        adapterFor(containers).deploy({ dir, manifest }, policy()),
      ).rejects.toThrow(
        `health check failed: ${containers.origin}/api/health ${message}`,
      );
      expect(await Promise.all(shell.map((path) => textOf(path)))).toEqual(
        before,
      );
      expect(await servedVersion()).toEqual(version);
      // The API pointer did switch: health answers for the failed release.
      expect((await health()).appVersion).toBe(
        app.reportedVersion ?? manifest.app.appVersion,
      );
    },
  );

  it('recovers from the failed migration with a corrected release of it', async () => {
    const dir = join(work, 'fixed');
    const manifest = await writeFixtureArtifact(
      dir,
      'd'.repeat(40),
      undefined,
      {
        schemaVersion: 2,
      },
    );
    await adapterFor(containers).deploy({ dir, manifest }, policy());
    await expectFullyActive(manifest);
  });
});

describe('same-schema rollback', () => {
  const manifestOf = async (name: string) =>
    parseManifest(await readFile(join(work, name, MANIFEST_FILE), 'utf8'));
  const remoteTree = () =>
    rawSftp(containers).run('inspect', [
      { op: 'ls', path: '/remote/site' },
      { op: 'ls', path: '/remote/site/api' },
      { op: 'ls', path: '/remote/.deploy' },
      { op: 'ls', path: '/remote/app' },
    ]);

  it('refuses a retained release whose schema version differs from the live database, without touching the remote', async () => {
    const older = await manifestOf('p1');
    const { retained } = await adapterFor(containers).inspect(policy());
    expect(retained).toContain(older.releaseId);
    const before = await remoteTree();
    const result = await deployCli([
      'rollback',
      '--artifact',
      join(work, 'p1'),
      '--release',
      older.releaseId,
    ]);
    expect(result.code).toBe(1);
    expect(result.stderr).toBe(
      `::error::deploy: release ${older.releaseId} expects schema version 1, but the live database is at schema version 2; rollback only returns to a release with the live schema, fix forward instead\n`,
    );
    expect(await remoteTree()).toEqual(before);
    expect((await health()).schemaVersion).toBe(2);
  });

  it('reactivates a retained release with the live schema version', async () => {
    const dir = join(work, 'e');
    const newer = await writeFixtureArtifact(dir, 'e'.repeat(40), undefined, {
      schemaVersion: 2,
    });
    await adapterFor(containers).deploy({ dir, manifest: newer }, policy());
    await expectFullyActive(newer);
    const fixed = await manifestOf('fixed');
    const back = await deployCli([
      'rollback',
      '--artifact',
      join(work, 'fixed'),
      '--release',
      fixed.releaseId,
    ]);
    expect({ code: back.code, stderr: back.stderr }).toEqual({
      code: 0,
      stderr: '',
    });
    await expectFullyActive(fixed);
  });
});

/** A plain-http request with its own Host header, as a browser sends it to an alias. */
function requestAs(
  host: string,
  path: string,
): Promise<{ status: number; headers: Record<string, unknown> }> {
  return new Promise((resolve, reject) => {
    const outgoing = request(
      {
        host: containers.host,
        port: containers.httpPort,
        path,
        headers: { Host: host },
      },
      (response) => {
        response.resume();
        resolve({
          status: response.statusCode ?? 0,
          headers: response.headers,
        });
      },
    );
    outgoing.on('error', reject);
    outgoing.end();
  });
}

describe('the rendered .htaccess of an https site on Apache', () => {
  it('answers plain http and any other host name with a 301 to SITE_URL and sends HSTS', async () => {
    const https = join(work, 'https.htaccess');
    await writeFile(
      https,
      renderHtaccess(targetPolicy('https://performance.example.test')),
    );
    const current = join(work, 'current.htaccess');
    await writeFile(current, renderHtaccess(policy()));
    const putHtaccess = (local: string) =>
      rawSftp(containers).run('htaccess', [
        { op: 'put', local, remote: '/remote/site/.htaccess' },
      ]);
    await putHtaccess(https);
    try {
      for (const host of [
        'performance.example.test',
        'www.performance.example.test',
        'performance.csp10.de',
      ]) {
        const response = await requestAs(host, '/rangliste?tab=heute');
        expect({ host, status: response.status }).toEqual({
          host,
          status: 301,
        });
        expect(response.headers.location).toBe(
          'https://performance.example.test/rangliste?tab=heute',
        );
        expect(response.headers['strict-transport-security']).toBe(
          'max-age=31536000',
        );
      }
    } finally {
      await putHtaccess(current);
    }
  });
});

describeTransportContract(
  'sftp',
  (spawn) => rawSftp(containers, spawn),
  () => ({ work, dir: '/remote/contract-sftp' }),
);
