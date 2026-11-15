import { execFile } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { promisify } from 'node:util';
import {
  MANIFEST_FILE,
  parseManifest,
  WEB_DIR,
  type Manifest,
} from '../../deploy/contract/artifact.ts';
import { fixtureSite } from './fixture-site.ts';

const run = promisify(execFile);
const root = join(import.meta.dirname, '..', '..');

async function put(path: string, content: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, content);
}

/** Writes the fixture site to `<dir>/web` and builds its manifest with the real cli. */
export async function writeFixtureArtifact(
  dir: string,
  commit: string,
  extras?: string[],
): Promise<Manifest> {
  for (const [path, content] of fixtureSite(commit, extras)) {
    await put(join(dir, WEB_DIR, path), content);
  }
  await run(
    process.execPath,
    [join(root, 'deploy/cli.ts'), 'manifest', '--artifact', dir],
    {
      cwd: root,
      env: {
        PATH: process.env.PATH ?? '',
        HOME: process.env.HOME ?? '',
        GITHUB_SHA: commit,
        GITHUB_RUN_ID: '1',
        GITHUB_RUN_ATTEMPT: '1',
        BASE: '/',
      },
    },
  );
  return parseManifest(await readFile(join(dir, MANIFEST_FILE), 'utf8'));
}
