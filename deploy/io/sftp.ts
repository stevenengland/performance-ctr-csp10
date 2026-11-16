import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  hostNameOf,
  portVariable,
  requiredVariable,
  type Env,
} from '../contract/parse.ts';
import type {
  Listing,
  ListingEntry,
  FileCommand,
  FileTransport,
} from '../webspace/ports.ts';
import type { Spawn } from './process.ts';
import { redact } from './redact.ts';

export interface SftpEndpoint {
  host: string;
  port: number;
  user: string;
  password: string;
  /** The pinned `known_hosts` line(s) of the server. */
  knownHosts: string;
}

/** The production login from `SFTP_HOST`, `SFTP_PORT` (default 22), `SFTP_USER`, `SFTP_PASS` and `SFTP_KNOWN_HOSTS`. */
export function parseSftpEndpoint(env: Env): SftpEndpoint {
  const required = (name: string) => requiredVariable(env, name, 'repository');
  return {
    host: hostNameOf('SFTP_HOST', required('SFTP_HOST')),
    port: portVariable(env, 'SFTP_PORT', 22),
    user: required('SFTP_USER'),
    password: required('SFTP_PASS'),
    knownHosts: required('SFTP_KNOWN_HOSTS'),
  };
}

function paths(command: FileCommand): string[] {
  switch (command.op) {
    case 'put': {
      return [command.local, command.remote];
    }
    case 'get': {
      return [command.remote, command.local];
    }
    case 'rename': {
      return [command.from, command.to];
    }
    default: {
      return [command.path];
    }
  }
}

function batchLine(command: FileCommand): string {
  switch (command.op) {
    case 'ls': {
      return `ls -la ${command.path}`;
    }
    case 'put': {
      return `put ${command.local} ${command.remote}`;
    }
    case 'get': {
      return `get ${command.remote} ${command.local}`;
    }
    case 'rename': {
      return `rename ${command.from} ${command.to}`;
    }
    default: {
      return `${command.op} ${command.path}`;
    }
  }
}

const SECTION = /^sftp> ls -la (.+)$/;
// OpenSSH sftp prints `?` for the link count, one space before the name, and
// names entries by full path.
const ENTRY =
  /^([-dl])[rwxsStT-]{9}\s+(?:\d+|\?)\s+\S+\s+\S+\s+(\d+)\s+\S+\s+\d+\s+\S+\s(.+)$/;

function entryName(listed: string, dir: string): string {
  const prefix = dir.endsWith('/') ? dir : `${dir}/`;
  return listed.startsWith(prefix) ? listed.slice(prefix.length) : listed;
}

/** Parses OpenSSH sftp's `ls -la` output, one section per echoed `sftp> ls -la <dir>`. */
export function parseListings(output: string): Map<string, Listing> {
  const listings = new Map<string, Map<string, ListingEntry>>();
  let current: Map<string, ListingEntry> | undefined;
  let dir = '';
  for (const line of output.split('\n')) {
    const section = SECTION.exec(line);
    if (section?.[1] !== undefined) {
      dir = section[1];
      current = new Map();
      listings.set(dir, current);
      continue;
    }
    const entry = ENTRY.exec(line);
    if (current === undefined || entry?.[3] === undefined) continue;
    const [, type, size, listed] = entry;
    const name = entryName(listed, dir);
    if (name === '.' || name === '..') continue;
    current.set(name, { size: Number(size), dir: type === 'd' });
  }
  return listings;
}

function sshConfig(endpoint: SftpEndpoint, knownHosts: string): string {
  return [
    'Host target',
    `  HostName ${endpoint.host}`,
    `  Port ${String(endpoint.port)}`,
    `  User ${endpoint.user}`,
    '  StrictHostKeyChecking yes',
    `  UserKnownHostsFile ${knownHosts}`,
    '  GlobalKnownHostsFile /dev/null',
    '  ConnectTimeout 30',
    '  ServerAliveInterval 15',
    '  ServerAliveCountMax 4',
    '  PasswordAuthentication yes',
    '  PubkeyAuthentication no',
    '  PreferredAuthentications password',
    '  IdentitiesOnly yes',
    '  LogLevel ERROR',
    '',
  ].join('\n');
}

// sftp splits batch lines on whitespace and quotes, unescapes backslashes and globs ls/get/put/rm.
function assertBatchSafe(commands: readonly FileCommand[]): void {
  const unsafe = commands
    .flatMap((command) => paths(command))
    .find((path) => /[\s"'*?[\]\\]/.test(path));
  if (unsafe !== undefined) {
    throw new Error(
      `sftp path contains whitespace, quotes, glob or escape characters: ${unsafe}`,
    );
  }
}

/** Writes known_hosts, ssh_config and the batch into `dir`, each `0600`; returns the config and batch paths. */
async function writeSession(
  dir: string,
  endpoint: SftpEndpoint,
  commands: readonly FileCommand[],
): Promise<{ config: string; batch: string }> {
  const knownHosts = join(dir, 'known_hosts');
  const config = join(dir, 'ssh_config');
  const batch = join(dir, 'batch');
  const lines = commands.map((command) => batchLine(command));
  await writeFile(knownHosts, `${endpoint.knownHosts}\n`, { mode: 0o600 });
  await writeFile(config, sshConfig(endpoint, knownHosts), { mode: 0o600 });
  await writeFile(batch, `${lines.join('\n')}\n`, { mode: 0o600 });
  return { config, batch };
}

function assertListed(
  step: string,
  commands: readonly FileCommand[],
  listings: ReadonlyMap<string, Listing>,
): void {
  const unlisted = commands.flatMap((command) =>
    command.op === 'ls' && !listings.has(command.path) ? command.path : [],
  );
  if (unlisted.length > 0) {
    throw new Error(
      `transfer step "${step}" printed no listing for ${unlisted.join(', ')}`,
    );
  }
}

export function createSftpTransport(
  endpoint: SftpEndpoint,
  deps: { spawn: Spawn },
): FileTransport {
  return {
    async run(step, commands) {
      assertBatchSafe(commands);
      const dir = await mkdtemp(join(tmpdir(), 'deploy-sftp-'));
      try {
        const { config, batch } = await writeSession(dir, endpoint, commands);
        const result = await deps.spawn(
          'sshpass',
          ['-e', 'sftp', '-oBatchMode=no', '-F', config, '-b', batch, 'target'],
          {
            env: {
              PATH: process.env.PATH ?? '/usr/bin:/bin',
              HOME: process.env.HOME ?? '/',
              SSHPASS: endpoint.password,
            },
          },
        );
        if (result.code !== 0) {
          const detail = redact(result.stderr.trim(), [
            endpoint.password,
            endpoint.user,
          ]);
          throw new Error(`transfer step "${step}" failed: ${detail}`);
        }
        const listings = parseListings(result.stdout);
        assertListed(step, commands, listings);
        return listings;
      } finally {
        await rm(dir, { recursive: true, force: true });
      }
    },
  };
}
