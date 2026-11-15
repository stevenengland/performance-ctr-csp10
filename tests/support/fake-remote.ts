import { createHash } from 'node:crypto';
import { posix } from 'node:path';
import {
  buildManifest,
  comparePaths,
  sortedByPath,
  WEB_DIR,
  type ManifestEntry,
} from '../../deploy/contract/artifact.ts';
import type { Artifact } from '../../deploy/contract/operations.ts';
import { fixtureSite } from './fixture-site.ts';
import type {
  HttpCheck,
  HttpChecker,
  Listing,
  ListingEntry,
  LocalFiles,
  FileCommand,
  FileTransport,
} from '../../deploy/webspace/ports.ts';

const BUILD_TIME = new Date('2026-10-22T11:00:00Z');

function isUnder(path: string, dir: string): boolean {
  return path.startsWith(`${dir}/`);
}

export class FakeLocalFiles implements LocalFiles {
  private temps = 0;
  readonly files = new Map<string, string>();

  artifactFiles(webDir: string): Promise<ManifestEntry[]> {
    const entries = sortedByPath(
      [...this.files]
        .filter(([path]) => isUnder(path, webDir))
        .map(([path, content]) => ({
          path: path.slice(webDir.length + 1),
          size: Buffer.byteLength(content),
          sha256: createHash('sha256').update(content).digest('hex'),
        })),
    );
    return Promise.resolve(entries);
  }

  readFile(path: string): Promise<string | undefined> {
    return Promise.resolve(this.files.get(path));
  }

  writeFile(path: string, content: string): Promise<void> {
    this.files.set(path, content);
    return Promise.resolve();
  }

  mkdtemp(): Promise<string> {
    this.temps += 1;
    return Promise.resolve(`/tmp/fake-${String(this.temps)}`);
  }

  remove(dir: string): Promise<void> {
    for (const path of this.files.keys()) {
      if (isUnder(path, dir)) this.files.delete(path);
    }
    return Promise.resolve();
  }
}

export interface Snapshot {
  files: [string, string][];
  dirs: string[];
}

/** An in-memory remote that applies sftp batches strictly, like OpenSSH sftp -b. */
export class FakeRemote implements FileTransport {
  static from(snapshot: Snapshot, local: FakeLocalFiles): FakeRemote {
    const remote = new FakeRemote(local);
    for (const dir of snapshot.dirs) remote.dirs.add(dir);
    for (const [path, content] of snapshot.files) {
      remote.files.set(path, content);
    }
    return remote;
  }

  private readonly local: FakeLocalFiles;
  readonly files = new Map<string, string>();
  readonly dirs: Set<string>;
  readonly steps: { step: string; commands: FileCommand[] }[] = [];

  constructor(local: FakeLocalFiles, root = '/remote') {
    this.local = local;
    this.dirs = new Set([root]);
  }

  private exists(path: string): boolean {
    return this.files.has(path) || this.dirs.has(path);
  }

  private parentIsDir(path: string): boolean {
    return this.dirs.has(posix.dirname(path));
  }

  /** A fault message, or undefined when the command applied. */
  private apply(command: FileCommand): string | undefined {
    switch (command.op) {
      case 'mkdir': {
        return this.mkdir(command.path);
      }
      case 'put': {
        return this.put(command.local, command.remote);
      }
      case 'rename': {
        return this.rename(command.from, command.to);
      }
      case 'rm': {
        return this.files.delete(command.path)
          ? undefined
          : `no file: ${command.path}`;
      }
      case 'rmdir': {
        return this.rmdir(command.path);
      }
      case 'ls': {
        return this.dirs.has(command.path)
          ? undefined
          : `no dir: ${command.path}`;
      }
      case 'get': {
        return this.get(command.remote, command.local);
      }
    }
  }

  private mkdir(path: string): string | undefined {
    if (!this.parentIsDir(path)) return `no parent: ${path}`;
    if (this.exists(path)) return `exists: ${path}`;
    this.dirs.add(path);
    return undefined;
  }

  private put(local: string, remote: string): string | undefined {
    const content = this.local.files.get(local);
    if (content === undefined) return `no local file: ${local}`;
    if (!this.parentIsDir(remote)) return `no parent: ${remote}`;
    if (this.dirs.has(remote)) return `is a dir: ${remote}`;
    this.files.set(remote, content);
    return undefined;
  }

  private rename(from: string, to: string): string | undefined {
    const content = this.files.get(from);
    if (content === undefined) return `no file: ${from}`;
    if (!this.parentIsDir(to)) return `no parent: ${to}`;
    this.files.delete(from);
    this.files.set(to, content);
    return undefined;
  }

  private rmdir(path: string): string | undefined {
    if (!this.dirs.has(path)) return `no dir: ${path}`;
    if (this.children(path).length > 0) return `not empty: ${path}`;
    this.dirs.delete(path);
    return undefined;
  }

  private get(remote: string, local: string): string | undefined {
    const content = this.files.get(remote);
    if (content === undefined) return `no file: ${remote}`;
    this.local.files.set(local, content);
    return undefined;
  }

  private children(dir: string): string[] {
    return [...this.dirs, ...this.files.keys()].filter(
      (path) => path !== dir && posix.dirname(path) === dir,
    );
  }

  private listing(dir: string): Listing {
    return new Map(
      this.children(dir)
        .toSorted(comparePaths)
        .map((path): [string, ListingEntry] => {
          const content = this.files.get(path);
          const entry =
            content === undefined
              ? { size: 4096, dir: true }
              : { size: Buffer.byteLength(content), dir: false };
          return [posix.basename(path), entry];
        }),
    );
  }

  snapshot(): Snapshot {
    return {
      files: [...this.files].toSorted(([a], [b]) => comparePaths(a, b)),
      dirs: [...this.dirs].toSorted(comparePaths),
    };
  }

  run(
    step: string,
    commands: readonly FileCommand[],
  ): Promise<Map<string, Listing>> {
    this.steps.push({ step, commands: [...commands] });
    const listings = new Map<string, Listing>();
    for (const [index, command] of commands.entries()) {
      const fault = this.apply(command);
      if (typeof fault === 'string') {
        return Promise.reject(
          new Error(
            `fake transfer step "${step}" failed at command ${String(index)}: ${fault}`,
          ),
        );
      }
      if (command.op === 'ls')
        listings.set(command.path, this.listing(command.path));
    }
    return Promise.resolve(listings);
  }
}

export class FakeHttp implements HttpChecker {
  readonly calls: HttpCheck[][] = [];
  failWith: string | undefined;

  run(checks: readonly HttpCheck[]): Promise<void> {
    this.calls.push([...checks]);
    return this.failWith === undefined
      ? Promise.resolve()
      : Promise.reject(new Error(this.failWith));
  }
}

export async function fakeArtifact(
  local: FakeLocalFiles,
  dir: string,
  commit: string,
  extras?: string[],
): Promise<Artifact> {
  const web = `${dir}/${WEB_DIR}`;
  for (const [path, content] of fixtureSite(commit, extras)) {
    await local.writeFile(`${web}/${path}`, content);
  }
  return {
    dir,
    manifest: buildManifest({
      commit,
      runId: '1',
      runAttempt: '1',
      buildTime: BUILD_TIME,
      base: '/',
      files: await local.artifactFiles(web),
    }),
  };
}
