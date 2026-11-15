import { execFile } from 'node:child_process';
import { join } from 'node:path';
import { promisify } from 'node:util';
import type { DeployOperations } from '../../deploy/contract/operations.ts';
import type { WebspaceSettings } from '../../deploy/contract/policy.ts';
import { localFiles } from '../../deploy/io/fs.ts';
import { httpChecker } from '../../deploy/io/http-smoke.ts';
import { spawnProcess, type Spawn } from '../../deploy/io/process.ts';
import {
  createSftpTransport,
  type SftpEndpoint,
} from '../../deploy/io/sftp.ts';
import {
  createAdapter,
  type AdapterPorts,
} from '../../deploy/webspace/adapter.ts';
import type { FileTransport } from '../../deploy/webspace/ports.ts';

const run = promisify(execFile);
const root = join(import.meta.dirname, '..', '..');
const COMPOSE = ['compose', '-f', 'tests/support/compose.yml'];
const KEYSCAN_ATTEMPTS = 30;

export interface Containers {
  host: string;
  sftpPort: number;
  httpPort: number;
  origin: string;
  knownHosts: string;
  remoteRoot: '/remote';
  sftpUser: 'deploy';
  sftpPassword: 'deploy-test-password';
}

/**
`DEPLOY_TEST_EXTERNAL=1` uses an SFTP server and an Apache that are already
running instead of the compose services, for machines that cannot pull the
images. They must match tests/support/compose.yml: the login above, chrooted
so that `/remote` is writable and empty, and Apache serving `/remote/site`
with `AllowOverride All`.
*/
const isExternal = process.env.DEPLOY_TEST_EXTERNAL === '1';

function composeEnv(): Record<string, string> {
  const env: Record<string, string> = {
    PATH: process.env.PATH ?? '/usr/bin:/bin',
    HOME: process.env.HOME ?? '/',
  };
  for (const name of [
    'DOCKER_HOST',
    'DEPLOY_TEST_SFTP_PORT',
    'DEPLOY_TEST_HTTP_PORT',
  ]) {
    const value = process.env[name];
    if (value !== undefined) env[name] = value;
  }
  return env;
}

async function keyscan(host: string, port: number): Promise<string> {
  for (let attempt = 0; attempt < KEYSCAN_ATTEMPTS; attempt += 1) {
    try {
      const { stdout } = await run('ssh-keyscan', [
        '-p',
        String(port),
        '-t',
        'ed25519',
        host,
      ]);
      const line = stdout
        .split('\n')
        .find((entry) => entry !== '' && !entry.startsWith('#'));
      if (line !== undefined) return line;
    } catch {
      // the server is not accepting connections yet
    }
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  throw new Error(`ssh-keyscan found no host key on ${host}:${String(port)}`);
}

export async function startContainers(): Promise<Containers> {
  if (!isExternal) {
    // A killed run never reaches stopContainers(), and its files would stay in
    // the shared volume: the next upload then finds them already on the server.
    await stopContainers();
    await run('docker', [...COMPOSE, 'up', '-d', '--wait'], {
      cwd: root,
      env: composeEnv(),
    });
  }
  const host = process.env.DEPLOY_TEST_HOST ?? 'localhost';
  const sftpPort = Number(process.env.DEPLOY_TEST_SFTP_PORT ?? 2222);
  const httpPort = Number(process.env.DEPLOY_TEST_HTTP_PORT ?? 8089);
  return {
    host,
    sftpPort,
    httpPort,
    origin: `http://${host}:${String(httpPort)}`,
    knownHosts: await keyscan(host, sftpPort),
    remoteRoot: '/remote',
    sftpUser: 'deploy',
    sftpPassword: 'deploy-test-password',
  };
}

export async function stopContainers(): Promise<void> {
  if (isExternal) return;
  await run('docker', [...COMPOSE, 'down', '-v', '--remove-orphans'], {
    cwd: root,
    env: composeEnv(),
  });
}

/** The production variables, pointed at the containers. */
export function targetEnv(c: Containers): Record<string, string> {
  return {
    SITE_URL: c.origin,
    REMOTE_ROOT: c.remoteRoot,
    SFTP_HOST: c.host,
    SFTP_PORT: String(c.sftpPort),
    SFTP_USER: c.sftpUser,
    SFTP_PASS: c.sftpPassword,
    SFTP_KNOWN_HOSTS: c.knownHosts,
  };
}

/** The SFTP login of the containers, pinned to the scanned host key. */
export function sftpEndpointFor(c: Containers): SftpEndpoint {
  return {
    host: c.host,
    port: c.sftpPort,
    user: c.sftpUser,
    password: c.sftpPassword,
    knownHosts: c.knownHosts,
  };
}

export function settingsFor(c: Containers): WebspaceSettings {
  return { remoteRoot: c.remoteRoot, docroot: 'site', aliases: [] };
}

export function rawSftp(
  c: Containers,
  spawn: Spawn = spawnProcess,
): FileTransport {
  return createSftpTransport(sftpEndpointFor(c), { spawn });
}

export function adapterFor(
  c: Containers,
  overrides: Partial<AdapterPorts> = {},
): DeployOperations {
  return createAdapter({
    transport: rawSftp(c),
    http: httpChecker,
    files: localFiles,
    settings: settingsFor(c),
    now: () => new Date(),
    log: () => {
      // The container proof asserts on state, not on progress lines.
    },
    ...overrides,
  });
}
