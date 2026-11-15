// The phase vocabulary the planner speaks: phases, their input and the transfer commands they carry.

import { posix } from 'node:path';
import {
  APP_DIR,
  comparePaths as compare,
  WEB_DIR,
  type Manifest,
} from '../contract/artifact.ts';
import type { ExpectedHealth } from '../contract/health.ts';
import type { TargetPolicy } from '../contract/policy.ts';
import type { RuntimeConfig } from '../contract/runtime-config.ts';
import {
  isPartName,
  parentDirs,
  partName,
  type RemotePaths,
} from './layout.ts';
import type { HttpCheck, FileCommand } from './ports.ts';
import type { Listing, RemoteState, Tree } from './remote-state.ts';

export type PhaseName =
  | 'access-upload'
  | 'access-commit'
  | 'marker'
  | 'assets-upload'
  | 'assets-commit'
  | 'app-upload'
  | 'app-verified'
  | 'staging-upload'
  | 'staging-verified'
  | 'config-upload'
  | 'config-commit'
  | 'activation'
  | 'health-check'
  | 'shell'
  | 'version-upload'
  | 'version-commit'
  | 'cleanup'
  | 'http-checks'
  | 'record'
  | 'finish'
  | 'trash';

export interface TempFile {
  name: string;
  content: string;
}

export type Phase =
  | {
      kind: 'transfer';
      name: PhaseName;
      files: TempFile[];
      commands: FileCommand[];
    }
  | { kind: 'http'; name: 'http-checks'; checks: HttpCheck[] }
  | {
      kind: 'health';
      name: 'health-check';
      url: string;
      expected: ExpectedHealth;
    }
  | { kind: 'done' };

export interface PlanInput {
  remote: RemoteState;
  manifest: Manifest;
  policy: TargetPolicy;
  runtimeConfig: RuntimeConfig;
  /** Declared host names that must redirect to the origin. */
  aliases: readonly string[];
  paths: RemotePaths;
  artifactDir: string;
  tempDir: string;
  now: Date;
  completed: ReadonlySet<PhaseName>;
}

export type Rule = (input: PlanInput) => Phase | undefined;

export function transferPhase(
  name: PhaseName,
  commands: FileCommand[],
  files: TempFile[] = [],
): Phase {
  return { kind: 'transfer', name, files, commands };
}

function byteLength(content: string): number {
  return Buffer.byteLength(content, 'utf8');
}

export function tempPath(input: PlanInput, name: string): string {
  return posix.join(input.tempDir, name);
}

export function webPath(input: PlanInput, path: string): string {
  return posix.join(input.artifactDir, WEB_DIR, path);
}

/** A file of the manifest's PHP release in the local artifact. */
export function appPath(input: PlanInput, path: string): string {
  return posix.join(
    input.artifactDir,
    APP_DIR,
    input.manifest.app.folder,
    path,
  );
}

export function hasDir(listing: Listing, name: string): boolean {
  return listing.get(name)?.dir === true;
}

export function missingDirs(
  paths: readonly string[],
  isPresent: (dir: string) => boolean,
): string[] {
  const dirs = [...new Set(paths.flatMap((path) => parentDirs(path)))];
  return dirs
    .filter((dir) => !isPresent(dir))
    .toSorted((a, b) => depth(a) - depth(b) || compare(a, b));
}

function depth(path: string): number {
  return path.split('/').length;
}

/** Children sort after their parent, so reverse lexical order is deepest-first. */
export function deepestFirst(paths: readonly string[]): string[] {
  return paths.toSorted((a, b) => compare(b, a));
}

export const mkdir = (path: string): FileCommand => ({ op: 'mkdir', path });

export const put = (local: string, remote: string): FileCommand => ({
  op: 'put',
  local,
  remote,
});

export const rename = (from: string, to: string): FileCommand => ({
  op: 'rename',
  from,
  to,
});

export const rm = (path: string): FileCommand => ({ op: 'rm', path });

export const rmdir = (path: string): FileCommand => ({ op: 'rmdir', path });

export function putThenRename(local: string, remote: string): FileCommand[] {
  return [put(local, partName(remote)), rename(partName(remote), remote)];
}

/** A control file written as `.part`, size-checked against its parent listing, then renamed into place. */
export interface Upload {
  file: TempFile;
  target: string;
  listing: Listing;
}

export function uploadThenRename(
  input: PlanInput,
  label: string,
  [upload, commit]: readonly [PhaseName, PhaseName],
  uploads: readonly Upload[],
  before: readonly FileCommand[] = [],
): Phase | undefined {
  if (!input.completed.has(upload)) {
    return transferPhase(
      upload,
      [
        ...before,
        ...uploads.map(({ file, target }) =>
          put(tempPath(input, file.name), partName(target)),
        ),
      ],
      uploads.map(({ file }) => file),
    );
  }
  if (input.completed.has(commit)) return undefined;
  for (const { file, target, listing } of uploads) {
    const listed = listing.get(partName(posix.basename(target)))?.size;
    if (listed !== byteLength(file.content)) {
      throw new Error(`${label} upload incomplete: ${file.name}`);
    }
  }
  return transferPhase(
    commit,
    uploads.map(({ target }) => rename(partName(target), target)),
  );
}

/** Removes every file, then every folder deepest first; the tree's own folder stays. */
export function removeTree(
  tree: Tree,
  file: (path: string) => string,
): FileCommand[] {
  const entries = [...tree];
  const files = entries
    .filter(([, entry]) => !entry.dir)
    .map(([path]) => rm(file(path)));
  const dirs = deepestFirst(
    entries.filter(([, entry]) => entry.dir).map(([path]) => path),
  ).map((path) => rmdir(file(path)));
  return [...files, ...dirs];
}

export function removeStagedRelease(
  input: PlanInput,
  id: string,
  tree: Tree,
): FileCommand[] {
  const { paths } = input;
  return [
    ...removeTree(tree, (path) => paths.stagedFile(id, path)),
    rmdir(paths.stagedDir(id)),
  ];
}

export function partFiles(listing: Listing): string[] {
  return [...listing]
    .filter(([name, entry]) => !entry.dir && isPartName(name))
    .map(([name]) => name);
}
