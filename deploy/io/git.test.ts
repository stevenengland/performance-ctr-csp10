import { execFile } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ancestry } from './git.ts';
import { spawnProcess } from './process.ts';

const run = promisify(execFile);

let repo: string;
let first: string;
let second: string;
let sibling: string;

async function git(...args: string[]): Promise<string> {
  const { stdout } = await run('git', ['-C', repo, ...args], {
    env: {
      PATH: process.env.PATH ?? '',
      GIT_AUTHOR_NAME: 't',
      GIT_AUTHOR_EMAIL: 't@example.test',
      GIT_COMMITTER_NAME: 't',
      GIT_COMMITTER_EMAIL: 't@example.test',
    },
  });
  return stdout.trim();
}

beforeAll(async () => {
  repo = await mkdtemp(join(tmpdir(), 'git-test-'));
  await git('init', '-q', '-b', 'main');
  await git('commit', '-q', '--allow-empty', '-m', 'first');
  first = await git('rev-parse', 'HEAD');
  await git('commit', '-q', '--allow-empty', '-m', 'second');
  second = await git('rev-parse', 'HEAD');
  await git('checkout', '-q', '-b', 'side', first);
  await git('commit', '-q', '--allow-empty', '-m', 'sibling');
  sibling = await git('rev-parse', 'HEAD');
});
afterAll(async () => {
  await rm(repo, { recursive: true, force: true });
});

const order = (active: string, candidate: string) =>
  ancestry(spawnProcess, repo, active, candidate);

describe('ancestry', () => {
  it('reads a descendant, the active commit itself, an older commit and an unrelated one', async () => {
    expect(await order(first, second)).toEqual({ kind: 'descendant' });
    expect(await order(second, second)).toEqual({ kind: 'descendant' });
    expect(await order(second, first)).toEqual({ kind: 'ancestor' });
    expect(await order(second, sibling)).toEqual({ kind: 'unrelated' });
  });

  it('reads a commit missing from the clone as unknown', async () => {
    expect(await ancestry(spawnProcess, repo, 'f'.repeat(40), second)).toEqual({
      kind: 'unknown',
      code: 128,
    });
  });

  it('refuses anything but a full sha before running git', async () => {
    await expect(
      ancestry(spawnProcess, repo, '--upload-pack=x', second),
    ).rejects.toThrow('not a commit sha: --upload-pack=x');
  });
});
