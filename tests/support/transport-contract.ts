import { spawn as spawnChild } from 'node:child_process';
import { readFile, truncate, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Spawn } from '../../deploy/io/process.ts';
import type {
  FileCommand,
  FileTransport,
  Listing,
} from '../../deploy/webspace/ports.ts';

/** Large enough that an upload is still running when the poll first sees it. */
const UPLOAD_BYTES = 1024 * 1024 * 1024;
const POLL_ATTEMPTS = 300;

/** A spawn whose running process group can be killed, as a dropped connection would end it. */
function killableSpawn(): { spawn: Spawn; kill(): void } {
  let pid: number | undefined;
  const spawn: Spawn = (command, args, { env, input = '' }) =>
    new Promise((resolve) => {
      const child = spawnChild(command, args, { env, detached: true });
      pid = child.pid;
      let stdout = '';
      let stderr = '';
      child.stdout.on('data', (chunk: Buffer) => (stdout += chunk.toString()));
      child.stderr.on('data', (chunk: Buffer) => (stderr += chunk.toString()));
      child.on('close', () => {
        // exitCode is null when a signal ended the process.
        resolve({ code: child.exitCode ?? 1, stdout, stderr });
      });
      child.stdin.end(input);
    });
  return {
    spawn,
    kill() {
      if (pid !== undefined) process.kill(-pid, 'SIGKILL');
    },
  };
}

/** One transport under test: `work` is a local folder, `dir` a remote folder the suite owns. */
interface Subject {
  name: string;
  make: (spawn?: Spawn) => FileTransport;
  work: string;
  dir: string;
}

const run = (subject: Subject, commands: readonly FileCommand[]) =>
  subject.make().run('contract', commands);

async function list(subject: Subject, path: string): Promise<Listing> {
  const listings = await run(subject, [{ op: 'ls', path }]);
  return listings.get(path) ?? new Map();
}

async function names(subject: Subject, path: string): Promise<string[]> {
  const listing = await list(subject, path);
  return listing.keys().toArray();
}

async function local(
  subject: Subject,
  file: string,
  content: string,
): Promise<string> {
  const path = join(subject.work, `${subject.name}-${file}`);
  await writeFile(path, content);
  return path;
}

async function stopsAtTheFailingCommand(subject: Subject): Promise<void> {
  const { dir } = subject;
  await expect(
    run(subject, [
      { op: 'mkdir', path: `${dir}/first` },
      { op: 'rm', path: `${dir}/missing` },
      { op: 'mkdir', path: `${dir}/third` },
    ]),
  ).rejects.toThrow('transfer step "contract" failed');
  expect(await names(subject, dir)).toEqual(['first']);
  await run(subject, [{ op: 'rmdir', path: `${dir}/first` }]);
}

async function renameReplaces(subject: Subject): Promise<void> {
  const { dir } = subject;
  const back = join(subject.work, `${subject.name}-back`);
  await run(subject, [
    {
      op: 'put',
      local: await local(subject, 'old', 'old'),
      remote: `${dir}/f`,
    },
    {
      op: 'put',
      local: await local(subject, 'new', 'new content'),
      remote: `${dir}/f.part`,
    },
    { op: 'rename', from: `${dir}/f.part`, to: `${dir}/f` },
    { op: 'get', remote: `${dir}/f`, local: back },
  ]);
  expect(await readFile(back, 'utf8')).toBe('new content');
  expect(await list(subject, dir)).toEqual(
    new Map([['f', { size: 11, dir: false }]]),
  );
  await run(subject, [{ op: 'rm', path: `${dir}/f` }]);
}

async function rmdirRefusesNonEmpty(subject: Subject): Promise<void> {
  const full = `${subject.dir}/full`;
  await run(subject, [
    { op: 'mkdir', path: full },
    { op: 'put', local: await local(subject, 'x', 'x'), remote: `${full}/x` },
  ]);
  await expect(run(subject, [{ op: 'rmdir', path: full }])).rejects.toThrow(
    'transfer step "contract" failed',
  );
  expect(await names(subject, full)).toEqual(['x']);
  await run(subject, [
    { op: 'rm', path: `${full}/x` },
    { op: 'rmdir', path: full },
  ]);
}

async function partialSize(subject: Subject): Promise<number> {
  const listing = await list(subject, subject.dir);
  return listing.get('big.part')?.size ?? 0;
}

async function interruptedUploadLeavesPart(subject: Subject): Promise<void> {
  const big = join(subject.work, `${subject.name}-big`);
  await writeFile(big, '');
  await truncate(big, UPLOAD_BYTES);
  const killable = killableSpawn();
  const upload = subject
    .make(killable.spawn)
    .run('upload', [
      { op: 'put', local: big, remote: `${subject.dir}/big.part` },
    ]);
  for (let attempt = 0; attempt < POLL_ATTEMPTS; attempt++) {
    if ((await partialSize(subject)) > 0) break;
  }
  killable.kill();
  await expect(upload).rejects.toThrow('transfer step "upload" failed');

  expect(await names(subject, subject.dir)).toEqual(['big.part']);
  expect(await partialSize(subject)).toBeLessThan(UPLOAD_BYTES);
  await run(subject, [{ op: 'rm', path: `${subject.dir}/big.part` }]);
  expect(await names(subject, subject.dir)).toEqual([]);
}

/**
The behaviour the planner relies on from every FileTransport, checked against
a real server. `make` builds the transport under test; `paths` names a local
work folder and an absent remote folder, which the suite creates and removes.
*/
export function describeTransportContract(
  name: string,
  make: (spawn?: Spawn) => FileTransport,
  paths: () => { work: string; dir: string },
): void {
  describe(`${name} transport contract`, () => {
    let subject: Subject;
    beforeAll(async () => {
      subject = { name, make, ...paths() };
      await run(subject, [{ op: 'mkdir', path: subject.dir }]);
    });
    afterAll(async () => {
      await run(subject, [{ op: 'rmdir', path: subject.dir }]);
    });

    it('stops a batch at the failing command: command 3 never runs when command 2 fails', () =>
      stopsAtTheFailingCommand(subject));
    it('replaces an existing file when a rename lands on it', () =>
      renameReplaces(subject));
    it('refuses rmdir on a folder that is not empty', () =>
      rmdirRefusesNonEmpty(subject));
    it('leaves only the .part name after an interrupted upload, and cleanup removes it', () =>
      interruptedUploadLeavesPart(subject));
  });
}
