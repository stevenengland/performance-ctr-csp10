import { readFile, stat } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import type { Env } from '../contract/parse.ts';
import type { Spawn, SpawnResult } from './process.ts';
import {
  createSftpTransport,
  parseListings,
  parseSftpEndpoint,
  type SftpEndpoint,
} from './sftp.ts';

const endpoint: SftpEndpoint = {
  host: 'sftp.example.test',
  port: 2222,
  user: 'secret-user',
  password: 'secret-password',
  knownHosts:
    '[sftp.example.test]:2222 ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIFakeKeyForTests',
};

const knownHosts =
  'sftp.example.test ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIFakeKeyForTests';
const env: Env = {
  SFTP_HOST: 'sftp.example.test',
  SFTP_USER: 'prod-user',
  SFTP_PASS: 'prod-secret',
  SFTP_KNOWN_HOSTS: knownHosts,
};

describe('parseSftpEndpoint', () => {
  it('defaults the port to 22', () => {
    expect(parseSftpEndpoint(env)).toEqual({
      host: 'sftp.example.test',
      port: 22,
      user: 'prod-user',
      password: 'prod-secret',
      knownHosts,
    });
  });

  it('reads the port', () => {
    expect(parseSftpEndpoint({ ...env, SFTP_PORT: '2222' }).port).toBe(2222);
  });

  it.each(['SFTP_HOST', 'SFTP_USER', 'SFTP_PASS', 'SFTP_KNOWN_HOSTS'])(
    'rejects a missing %s, naming the variable',
    (name) => {
      expect(() => parseSftpEndpoint({ ...env, [name]: '' })).toThrow(
        `Missing repository variable ${name}`,
      );
    },
  );

  it.each([
    'Sftp.example.test',
    'sftp.example.test:22',
    'sftp.example.test\nHost *',
  ])('rejects host %j, naming the variable', (host) => {
    expect(() => parseSftpEndpoint({ ...env, SFTP_HOST: host })).toThrow(
      'Invalid repository variable SFTP_HOST: expected a lowercase host name',
    );
  });

  it.each(['0', '70000', 'twenty-two'])('rejects port %s', (port) => {
    expect(() => parseSftpEndpoint({ ...env, SFTP_PORT: port })).toThrow(
      'Invalid repository variable SFTP_PORT: expected an integer between 1 and 65535',
    );
  });

  it('never puts the password into an error message', () => {
    let message = '';
    try {
      parseSftpEndpoint({ ...env, SFTP_KNOWN_HOSTS: '' });
    } catch (error) {
      message = (error as Error).message;
    }
    expect(message).not.toContain('prod-secret');
  });
});

interface Call {
  command: string;
  args: string[];
  env: Record<string, string>;
  config: string;
  knownHosts: string;
  batch: string;
  modes: number[];
}

function fakeSpawn(result: Partial<SpawnResult> = {}): {
  spawn: Spawn;
  calls: Call[];
} {
  const calls: Call[] = [];
  const spawn: Spawn = async (command, args, options) => {
    const config = args[args.indexOf('-F') + 1] ?? '';
    const batch = args[args.indexOf('-b') + 1] ?? '';
    const dir = config.slice(0, config.lastIndexOf('/'));
    const modes = await Promise.all(
      [config, batch, `${dir}/known_hosts`].map(async (p) => {
        const info = await stat(p);
        return info.mode & 0o777;
      }),
    );
    calls.push({
      command,
      args: [...args],
      env: { ...options.env },
      config: await readFile(config, 'utf8'),
      knownHosts: await readFile(`${dir}/known_hosts`, 'utf8'),
      batch: await readFile(batch, 'utf8'),
      modes,
    });
    return { code: 0, stdout: 'sftp> ls -la /remote\n', stderr: '', ...result };
  };
  return { spawn, calls };
}

function first<T>(items: readonly T[]): T {
  const [item] = items;
  if (item === undefined) throw new Error('expected at least one call');
  return item;
}

describe('createSftpTransport', () => {
  it('spawns sshpass + sftp with the password in the environment only', async () => {
    const { spawn, calls } = fakeSpawn();
    const out = await createSftpTransport(endpoint, { spawn }).run('observe', [
      { op: 'ls', path: '/remote' },
    ]);
    expect(out).toEqual(new Map([['/remote', new Map()]]));
    const call = first(calls);
    expect(call.command).toBe('sshpass');
    expect(call.args.slice(0, 3)).toEqual(['-e', 'sftp', '-oBatchMode=no']);
    expect(call.args.indexOf('-oBatchMode=no')).toBeLessThan(
      call.args.indexOf('-b'),
    );
    expect(call.args.at(-1)).toBe('target');
    expect(call.env.SSHPASS).toBe('secret-password');
    const argv = [call.command, ...call.args].join(' ');
    expect(argv).not.toContain('secret-password');
    expect(argv).not.toContain('secret-user');
  });

  it('writes a 0600 ssh_config with the user, port and pinned known_hosts', async () => {
    const { spawn, calls } = fakeSpawn();
    await createSftpTransport(endpoint, { spawn }).run('observe', [
      { op: 'ls', path: '/remote' },
    ]);
    const { config, knownHosts, modes } = first(calls);
    expect(config).toContain('Host target\n');
    expect(config).toContain('  HostName sftp.example.test\n');
    expect(config).toContain('  Port 2222\n');
    expect(config).toContain('  User secret-user\n');
    expect(config).toContain('  StrictHostKeyChecking yes\n');
    expect(config).toMatch(/ {2}UserKnownHostsFile \S+\/known_hosts\n/);
    expect(config).toContain('  GlobalKnownHostsFile /dev/null\n');
    expect(config).toContain('  ConnectTimeout 30\n');
    expect(config).toContain('  ServerAliveInterval 15\n');
    expect(config).toContain('  ServerAliveCountMax 4\n');
    expect(config).toContain('  PreferredAuthentications password\n');
    expect(knownHosts).toBe(`${endpoint.knownHosts}\n`);
    expect(modes).toEqual([0o600, 0o600, 0o600]);
  });

  it('renders every command strictly, without the tolerant prefix', async () => {
    const { spawn, calls } = fakeSpawn({
      stdout: 'sftp> ls -la /remote/site\n',
    });
    await createSftpTransport(endpoint, { spawn }).run('marker', [
      { op: 'mkdir', path: '/remote/.deploy' },
      { op: 'put', local: '/work/a', remote: '/remote/.deploy/a.part' },
      { op: 'rename', from: '/remote/.deploy/a.part', to: '/remote/.deploy/a' },
      { op: 'rm', path: '/remote/x' },
      { op: 'rmdir', path: '/remote/d' },
      { op: 'ls', path: '/remote/site' },
      {
        op: 'get',
        remote: '/remote/.deploy/state.json',
        local: '/work/state.json',
      },
    ]);
    expect(first(calls).batch).toBe(
      [
        'mkdir /remote/.deploy',
        'put /work/a /remote/.deploy/a.part',
        'rename /remote/.deploy/a.part /remote/.deploy/a',
        'rm /remote/x',
        'rmdir /remote/d',
        'ls -la /remote/site',
        'get /remote/.deploy/state.json /work/state.json',
        '',
      ].join('\n'),
    );
    expect(first(calls).batch).not.toMatch(/^-/m);
  });

  it('rejects paths with whitespace before spawning', async () => {
    const { spawn, calls } = fakeSpawn();
    await expect(
      createSftpTransport(endpoint, { spawn }).run('x', [
        { op: 'rm', path: '/remote/a b' },
      ]),
    ).rejects.toThrow(/whitespace/);
    expect(calls).toHaveLength(0);
  });

  it.each([
    '/remote/a*.html',
    '/remote/x[1].html',
    '/remote/q?',
    String.raw`/remote/a\b`,
  ])(
    'rejects the sftp glob or escape character in %s before spawning',
    async (path) => {
      const { spawn, calls } = fakeSpawn();
      await expect(
        createSftpTransport(endpoint, { spawn }).run('x', [{ op: 'rm', path }]),
      ).rejects.toThrow(path);
      expect(calls).toHaveLength(0);
    },
  );

  it('fails the step when an ls printed no listing', async () => {
    const { spawn } = fakeSpawn({ stdout: '' });
    await expect(
      createSftpTransport(endpoint, { spawn }).run('observe-1', [
        { op: 'ls', path: '/remote' },
      ]),
    ).rejects.toThrow(
      'transfer step "observe-1" printed no listing for /remote',
    );
  });

  it('names the step and redacts secrets on failure, removing the temp dir either way', async () => {
    const { spawn, calls } = fakeSpawn({
      code: 255,
      stderr:
        'secret-user@sftp.example.test: Permission denied (password secret-password).',
    });
    await expect(
      createSftpTransport(endpoint, { spawn }).run('observe-state', [
        { op: 'ls', path: '/remote' },
      ]),
    ).rejects.toThrow(
      'transfer step "observe-state" failed: ***@sftp.example.test: Permission denied (password ***).',
    );
    const config = first(calls).args[first(calls).args.indexOf('-F') + 1] ?? '';
    await expect(stat(config)).rejects.toThrow();
  });
});

describe('parseListings', () => {
  const output = [
    'sftp> ls -la /remote/site/assets',
    'drwxr-xr-x    2 1001     1001         4096 Oct 22 19:00 .',
    'drwxr-xr-x    3 1001     1001         4096 Oct 22 19:00 ..',
    '-rw-r--r--    1 1001     1001            5 Oct 22 19:00 a.css',
    '-rw-r--r--    1 1001     1001            2 Oct 22 19:01 b.css.part',
    'sftp> ls -la /remote/site',
    'drwxr-xr-x    3 1001     1001         4096 Oct 22 19:00 .',
    'drwxr-xr-x    3 1001     1001         4096 Oct 22 19:00 ..',
    '-rw-r--r--    1 1001     1001          612 Oct 22 19:00 .htaccess',
    'drwxr-xr-x    2 1001     1001         4096 Oct 22 19:00 assets',
    '-rw-r--r--    1 1001     1001           10 Oct 22 19:00 index.html',
    'sftp> ls -la /remote/.deploy/staged',
    'drwxr-xr-x    2 1001     1001         4096 Oct 22 19:00 .',
    'drwxr-xr-x    3 1001     1001         4096 Oct 22 19:00 ..',
    '',
  ].join('\n');

  it('reads the OpenSSH form: unknown link count and entries named by full path', () => {
    const real = [
      'sftp> ls -la /remote',
      'drwxr-xr-x    ? 0        0            4096 Oct 22 21:37 /remote/.',
      'drwxr-xr-x    ? 0        0            4096 Oct 22 21:37 /remote/..',
      'drwxr-xr-x    ? 1001     100          4096 Oct 22 21:37 /remote/site',
      '-rw-r--r--    ? 1001     100            61 Oct 22 21:38 /remote/.htpasswd',
      'sftp> ls -la /',
      'drwxr-xr-x    ? 1001     100          4096 Oct 22 21:37 /site',
      '',
    ].join('\n');
    const listings = parseListings(real);
    expect(listings.get('/remote')).toEqual(
      new Map([
        ['site', { size: 4096, dir: true }],
        ['.htpasswd', { size: 61, dir: false }],
      ]),
    );
    expect(listings.get('/')).toEqual(
      new Map([['site', { size: 4096, dir: true }]]),
    );
  });

  it('lists a symlink as a file (see Listing)', () => {
    const listings = parseListings(
      [
        'sftp> ls -la /remote',
        'lrwxrwxrwx    ? 1001     100            11 Oct 22 21:38 /remote/link',
        '',
      ].join('\n'),
    );
    expect(listings.get('/remote')).toEqual(
      new Map([['link', { size: 11, dir: false }]]),
    );
  });

  it('splits sections by the echoed ls command and parses sizes', () => {
    const listings = parseListings(output);
    expect(listings.keys().toArray()).toEqual([
      '/remote/site/assets',
      '/remote/site',
      '/remote/.deploy/staged',
    ]);
    expect(listings.get('/remote/site/assets')).toEqual(
      new Map([
        ['a.css', { size: 5, dir: false }],
        ['b.css.part', { size: 2, dir: false }],
      ]),
    );
    expect(listings.get('/remote/site')?.get('assets')).toEqual({
      size: 4096,
      dir: true,
    });
    expect(listings.get('/remote/site')?.get('.htaccess')).toEqual({
      size: 612,
      dir: false,
    });
    expect(listings.get('/remote/.deploy/staged')?.size).toBe(0);
  });
});
