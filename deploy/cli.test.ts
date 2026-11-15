import { spawnSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
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
    expect(manifest.digest).toBe(manifestDigest(manifest.files));
    expect(result.stdout).toContain(
      `manifest: ${manifest.releaseId} (2 files)`,
    );
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
};

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
      expect(result.stdout + result.stderr).not.toContain('prod-sftp-secret');
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
