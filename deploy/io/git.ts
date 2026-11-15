import { COMMIT_SHA, type Ancestry } from '../contract/ordering.ts';
import type { Spawn } from './process.ts';

const EXIT_ANCESTOR = 0;
const EXIT_NOT_ANCESTOR = 1;

type IsAncestor = boolean | { code: number };

async function isAncestor(
  spawn: Spawn,
  repo: string,
  older: string,
  newer: string,
): Promise<IsAncestor> {
  const { code } = await spawn(
    'git',
    ['-C', repo, 'merge-base', '--is-ancestor', older, newer],
    {
      env: {
        PATH: process.env.PATH ?? '/usr/bin:/bin',
        HOME: process.env.HOME ?? '',
      },
    },
  );
  if (code === EXIT_ANCESTOR) return true;
  return code === EXIT_NOT_ANCESTOR ? false : { code };
}

/** Asks `git merge-base --is-ancestor` in `repo` how `candidate` relates to `active`. */
export async function ancestry(
  spawn: Spawn,
  repo: string,
  active: string,
  candidate: string,
): Promise<Ancestry> {
  for (const sha of [active, candidate]) {
    if (!COMMIT_SHA.test(sha)) throw new Error(`not a commit sha: ${sha}`);
  }
  const forward = await isAncestor(spawn, repo, active, candidate);
  if (forward === true) return { kind: 'descendant' };
  if (forward !== false) return { kind: 'unknown', code: forward.code };
  const backward = await isAncestor(spawn, repo, candidate, active);
  if (backward === true) return { kind: 'ancestor' };
  return backward === false
    ? { kind: 'unrelated' }
    : { kind: 'unknown', code: backward.code };
}
