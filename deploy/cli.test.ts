import { execFileSync, spawnSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createServer, type Server } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
} from 'vitest';
import { runCaptured } from '../tests/support/run-captured.ts';
import { manifestDigest, parseManifest } from './contract/artifact.ts';
import { targetPolicy } from './contract/policy.ts';
import { renderHtaccess } from './webspace/htaccess.ts';

const root = join(import.meta.dirname, '..');
const cliPath = join(root, 'deploy/cli.ts');
const baseEnv = { PATH: process.env.PATH ?? '', HOME: process.env.HOME ?? '' };

function cli(...args: string[]) {
  return spawnSync(process.execPath, ['deploy/cli.ts', ...args], {
    cwd: root,
    encoding: 'utf8',
  });
}

function exec(args: string[], env: Record<string, string>) {
  return runCaptured(process.execPath, [cliPath, ...args], {
    cwd: root,
    env: { ...baseEnv, ...env },
  });
}

describe('deploy cli', () => {
  it('prints the rendered .htaccess for a site URL', () => {
    const result = cli('render-htaccess', 'http://localhost:8080');
    expect(result.status).toBe(0);
    expect(result.stdout).toBe(
      renderHtaccess(targetPolicy('http://localhost:8080')),
    );
  });

  it('renders the immutable caching rule for the ASSET_DIR folder', async () => {
    const result = await exec(['render-htaccess', 'http://localhost:8080'], {
      ASSET_DIR: '_build',
    });
    expect(result.code).toBe(0);
    expect(result.stdout).toBe(
      renderHtaccess(targetPolicy('http://localhost:8080', '_build')),
    );
    expect(result.stdout).toContain('m#^/_build/#');
    const invalid = await exec(['render-htaccess', 'http://localhost:8080'], {
      ASSET_DIR: '../x',
    });
    expect(invalid.code).toBe(1);
    expect(invalid.stderr).toMatch(/^Invalid repository variable ASSET_DIR/);
  });

  it('rejects an invalid site URL without a stack trace', () => {
    const result = cli('render-htaccess', 'ftp://example.test');
    expect(result.status).toBe(1);
    expect(result.stderr).toBe(
      'Invalid site URL: expected an http:// or https:// URL without query or fragment\n',
    );
  });

  it.each([
    ['an unknown command', ['deploy-everything']],
    ['deploy without --artifact', ['deploy']],
    ['rollback without --release', ['rollback', '--artifact', 'a']],
    ['order without --inspection', ['order', '--artifact', 'a']],
    ['live-check with an option', ['live-check', '--artifact', 'a']],
    ['an unknown option', ['inspect', '--target', 'staging']],
    ['a stray argument', ['render-htaccess', 'http://a.test', 'extra']],
  ])('prints the usage for %s', (_what, args) => {
    const result = cli(...args);
    expect(result.status).toBe(2);
    expect(result.stderr).toContain('Usage: node deploy/cli.ts');
  });
});

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'cli-test-'));
  await mkdir(join(dir, 'web/assets'), { recursive: true });
  await writeFile(join(dir, 'web/index.html'), '<html></html>');
  await writeFile(join(dir, 'web/assets/app.abc.css'), 'body{}');
  await mkdir(join(dir, 'app/0.1.0-aaaaaaa/public'), { recursive: true });
  await writeFile(join(dir, 'app/0.1.0-aaaaaaa/public/index.php'), '<?php');
  await writeFile(join(dir, 'app/0.1.0-aaaaaaa/release.php'), '<?php');
  await writeFile(
    join(dir, 'release.json'),
    JSON.stringify({
      appVersion: '0.1.0+aaaaaaa',
      release: '0.1.0-aaaaaaa',
      schemaVersion: 3,
    }),
  );
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

const manifestEnv = {
  GITHUB_SHA: 'a'.repeat(40),
  GITHUB_RUN_ID: '42',
  GITHUB_RUN_ATTEMPT: '2',
  BASE: '/',
};

describe('cli manifest', () => {
  it('writes manifest.json beside web/ with identity, build facts and files', async () => {
    const result = await exec(['manifest', '--artifact', dir], manifestEnv);
    expect({ code: result.code, stderr: result.stderr }).toEqual({
      code: 0,
      stderr: '',
    });
    const manifest = parseManifest(
      await readFile(join(dir, 'manifest.json'), 'utf8'),
    );
    expect(manifest).toMatchObject({
      commit: 'a'.repeat(40),
      runId: '42',
      runAttempt: '2',
      base: '/',
    });
    expect(manifest.releaseId).toMatch(/^\d{8}T\d{6}Z-aaaaaaa$/);
    expect(manifest.files.map((f) => f.path)).toEqual([
      'assets/app.abc.css',
      'index.html',
    ]);
    expect(manifest.app).toEqual({
      folder: '0.1.0-aaaaaaa',
      appVersion: '0.1.0+aaaaaaa',
      schemaVersion: 3,
      files: [
        expect.objectContaining({ path: 'public/index.php', size: 5 }),
        expect.objectContaining({ path: 'release.php', size: 5 }),
      ],
    });
    expect(manifest.digest).toBe(manifestDigest(manifest.files, manifest.app));
    expect(result.stdout).toContain(
      `manifest: ${manifest.releaseId} (2 web files, 2 in app/0.1.0-aaaaaaa, schema version 3)`,
    );
  });

  it('fails without the release.json that names the PHP release', async () => {
    await rm(join(dir, 'release.json'));
    const result = await exec(['manifest', '--artifact', dir], manifestEnv);
    expect(result.code).toBe(1);
    expect(result.stderr).toBe('::error::deploy: release.json is missing\n');
  });

  it('fails naming a missing environment variable', async () => {
    const result = await exec(['manifest', '--artifact', dir], {
      ...manifestEnv,
      GITHUB_RUN_ID: '',
    });
    expect(result.code).toBe(1);
    expect(result.stderr).toBe(
      '::error::deploy: Missing environment variable GITHUB_RUN_ID\n',
    );
  });
});

const deployEnv = {
  SITE_URL: 'https://www.example.test',
  SFTP_HOST: 'sftp.example.test',
  SFTP_USER: 'prod-user',
  SFTP_PASS: 'prod-sftp-secret',
  SFTP_KNOWN_HOSTS:
    'sftp.example.test ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIFakeKeyForTests',
  DOCROOT: 'performance',
  DB_HOST: 'db.example.test',
  DB_NAME: 'prod-db-name',
  DB_USER: 'prod-db-user',
  DB_PASS: 'prod-db-secret',
  BOOTSTRAP_ADMIN_USER: 'prod-admin',
  BOOTSTRAP_ADMIN_PASSWORD_HASH:
    '$2y$12$prodprodprodprodprodpuJ0123456789abcdefghijklmnopqrs',
};
const secretValues = [
  'prod-sftp-secret',
  'prod-db-name',
  'prod-db-user',
  'prod-db-secret',
  'prod-admin',
  deployEnv.BOOTSTRAP_ADMIN_PASSWORD_HASH,
];

describe('cli deploy', () => {
  it('rejects an artifact without manifest.json before any network use', async () => {
    const result = await exec(['deploy', '--artifact', dir], deployEnv);
    expect(result.code).toBe(1);
    expect(result.stderr).toContain(
      '::error::deploy: manifest.json is missing',
    );
    expect(result.stdout).not.toContain('step ');
  });

  it.each([
    [{ SFTP_HOST: '' }, 'Missing repository variable SFTP_HOST'],
    [{ SFTP_KNOWN_HOSTS: '' }, 'Missing repository variable SFTP_KNOWN_HOSTS'],
    [{ SITE_URL: '' }, 'Missing repository variable SITE_URL'],
    [{ DOCROOT: '../httpdocs' }, 'Invalid repository variable DOCROOT'],
    [{ DOCROOT: '' }, 'Missing repository variable DOCROOT'],
    [{ DB_HOST: '' }, 'Missing repository variable DB_HOST'],
    [{ DB_PASS: '' }, 'Missing repository secret DB_PASS'],
    [
      { BOOTSTRAP_ADMIN_PASSWORD_HASH: 'prod-db-secret' },
      'Invalid repository secret BOOTSTRAP_ADMIN_PASSWORD_HASH',
    ],
  ])(
    'fails on %j before any network use, naming the variable and printing no secret',
    async (override, message) => {
      const result = await exec(['deploy', '--artifact', dir], {
        ...deployEnv,
        ...override,
      });
      expect(result.code).toBe(1);
      expect(result.stderr).toContain(`::error::deploy: ${message}`);
      expect(result.stdout).not.toContain('step ');
      for (const secret of secretValues) {
        expect(result.stdout + result.stderr).not.toContain(secret);
      }
    },
  );
});

describe('cli inspect', () => {
  it('rejects a missing repository variable without printing secrets', async () => {
    const result = await exec(['inspect'], { ...deployEnv, SFTP_USER: '' });
    expect(result.code).toBe(1);
    expect(result.stderr).toContain(
      '::error::deploy: Missing repository variable SFTP_USER',
    );
    expect(result.stdout + result.stderr).not.toContain('prod-sftp-secret');
  });
});

describe('cli order', () => {
  let repo: string;
  const commits: string[] = [];
  const git = (...args: string[]) =>
    execFileSync('git', ['-C', repo, ...args], {
      encoding: 'utf8',
      env: {
        PATH: process.env.PATH ?? '',
        GIT_AUTHOR_NAME: 't',
        GIT_AUTHOR_EMAIL: 't@example.test',
        GIT_COMMITTER_NAME: 't',
        GIT_COMMITTER_EMAIL: 't@example.test',
      },
    }).trim();

  beforeAll(async () => {
    repo = await mkdtemp(join(tmpdir(), 'cli-order-'));
    git('init', '-q', '-b', 'main');
    for (const message of ['older', 'newer']) {
      git('commit', '-q', '--allow-empty', '-m', message);
      commits.push(git('rev-parse', 'HEAD'));
    }
  });
  afterAll(async () => {
    await rm(repo, { recursive: true, force: true });
  });

  /** Builds the artifact at `candidate` and orders it against `active` from inside the repository. */
  async function orderAgainst(
    candidate: string,
    active?: string,
    inProgress?: string,
  ) {
    await exec(['manifest', '--artifact', dir], {
      ...manifestEnv,
      GITHUB_SHA: candidate,
    });
    const inspection = join(dir, 'remote.json');
    await writeFile(
      inspection,
      JSON.stringify({
        ...(active && { active: { releaseId: 'r-active', commit: active } }),
        ...(inProgress && {
          inProgress: { releaseId: 'r-in-progress', commit: inProgress },
        }),
        retained: [],
      }),
    );
    return runCaptured(
      process.execPath,
      [cliPath, 'order', '--artifact', dir, '--inspection', inspection],
      { cwd: repo, env: baseEnv },
    );
  }

  it('deploys a newer commit and onto an empty host', async () => {
    const [older = '', newer = ''] = commits;
    for (const result of [
      await orderAgainst(newer, older),
      await orderAgainst(newer, newer),
      await orderAgainst(older),
    ]) {
      expect(result).toEqual({ code: 0, stdout: 'skip=false\n', stderr: '' });
    }
  });

  it('skips a run that a newer deploy overtook, so production never regresses', async () => {
    const [older = '', newer = ''] = commits;
    const result = await orderAgainst(older, newer);
    expect(result.code).toBe(0);
    expect(result.stdout).toBe('skip=true\n');
    expect(result.stderr).toBe(
      `::notice::deploy: production is at ${newer}, which is newer than ${older}; skipped so production never regresses\n`,
    );
  });

  it('skips a rerun of the active commit while a newer release is in progress', async () => {
    const [older = '', newer = ''] = commits;
    const result = await orderAgainst(older, older, newer);
    expect(result.code).toBe(0);
    expect(result.stdout).toBe('skip=true\n');
    expect(result.stderr).toBe(
      `::notice::deploy: release ${newer} is in progress on production and is newer than ${older}; skipped so production never regresses\n`,
    );
  });

  it('deploys the in-progress commit again, and past an older one in progress', async () => {
    const [older = '', newer = ''] = commits;
    for (const result of [
      await orderAgainst(newer, older, newer),
      await orderAgainst(newer, newer, older),
    ]) {
      expect(result).toEqual({ code: 0, stdout: 'skip=false\n', stderr: '' });
    }
  });

  it('fails a commit outside the history of the active one', async () => {
    const [, newer = ''] = commits;
    const result = await orderAgainst(newer, 'f'.repeat(40));
    expect(result.code).toBe(1);
    expect(result.stderr).toContain('::error::deploy: cannot order');
  });
});

describe('cli live-check', () => {
  let server: Server;
  let origin: string;
  const health: Record<string, unknown> = {
    appVersion: '0.1.0+aaaaaaa',
    phpVersion: '8.3.36',
    database: { engine: 'MySQL', version: '8.4.13' },
    schemaVersion: 1,
    migration: 'ok',
    minClientVersion: '0.1.0',
  };
  let answer: Record<string, unknown> = health;

  beforeAll(async () => {
    server = createServer((req, res) => {
      if (req.url === '/api/health') {
        res.writeHead(200).end(JSON.stringify(answer));
        return;
      }
      res.writeHead(404).end();
    });
    await new Promise<void>((resolve) =>
      server.listen(0, '127.0.0.1', resolve),
    );
    const address = server.address();
    origin = `http://127.0.0.1:${String(typeof address === 'object' && address ? address.port : 0)}`;
  });
  afterAll(
    () =>
      new Promise<void>((resolve) => {
        server.close(() => {
          resolve();
        });
      }),
  );

  it('passes when production health answers with every field and migration ok', async () => {
    answer = health;
    const result = await exec(['live-check'], { SITE_URL: origin });
    expect(result.code).toBe(0);
    expect(result.stdout).toBe(
      `live-check: ${origin}/api/health: app 0.1.0+aaaaaaa, PHP 8.3.36, MySQL 8.4.13, schema version 1, migration ok\n`,
    );
  });

  it('fails when health lacks a field', async () => {
    answer = { ...health, minClientVersion: undefined };
    const result = await exec(['live-check'], { SITE_URL: origin });
    expect(result.code).toBe(1);
    expect(result.stderr).toBe(
      `::error::deploy: health check failed: ${origin}/api/health health response is malformed: minClientVersion\n`,
    );
  });

  it('fails when the last migration failed', async () => {
    answer = { ...health, migration: 'failed' };
    const result = await exec(['live-check'], { SITE_URL: origin });
    expect(result.code).toBe(1);
    expect(result.stderr).toBe(
      `::error::deploy: live check failed: ${origin}/api/health reports migration failed\n`,
    );
  });

  it('fails when production does not answer', async () => {
    const result = await exec(['live-check'], {
      SITE_URL: `${origin}/missing`,
    });
    expect(result.code).toBe(1);
    expect(result.stderr).toContain('answered 404');
  });
});

describe('cli release-tag', () => {
  it('prints the archive tag for a deploy now', () => {
    const result = cli('release-tag');
    expect(result.status).toBe(0);
    expect(result.stdout).toMatch(/^release-\d{8}-\d{4}\n$/);
  });
});
