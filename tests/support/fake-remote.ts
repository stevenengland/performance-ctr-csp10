import { createHash } from 'node:crypto';
import { posix } from 'node:path';
import {
  APP_DIR,
  buildManifest,
  comparePaths,
  sortedByPath,
  WEB_DIR,
  type ManifestEntry,
} from '../../deploy/contract/artifact.ts';
import type { HealthReport } from '../../deploy/contract/health.ts';
import type { Artifact } from '../../deploy/contract/operations.ts';
import type { RuntimeConfig } from '../../deploy/contract/runtime-config.ts';
import { fixtureAppFolder, fixtureSite } from './fixture-site.ts';
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
    if (this.dirs.has(from)) return this.renameDir(from, to);
    const content = this.files.get(from);
    if (content === undefined) return `no file: ${from}`;
    if (!this.parentIsDir(to)) return `no parent: ${to}`;
    this.files.delete(from);
    this.files.set(to, content);
    return undefined;
  }

  /** Moves a folder with everything below it, as a POSIX rename does. */
  private renameDir(from: string, to: string): string | undefined {
    if (!this.parentIsDir(to)) return `no parent: ${to}`;
    if (this.exists(to)) return `exists: ${to}`;
    const moved = (path: string) =>
      path === from || isUnder(path, from)
        ? `${to}${path.slice(from.length)}`
        : path;
    for (const dir of [...this.dirs]) {
      this.dirs.delete(dir);
      this.dirs.add(moved(dir));
    }
    for (const [path, content] of [...this.files]) {
      this.files.delete(path);
      this.files.set(moved(path), content);
    }
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

/** A fake migration fails when its file says so. */
const FAILING_MIGRATION = 'fails';

/**
The checks against the fake remote, and its API: health answers for the PHP
release the served folder's `api/index.php` names, applying that release's
pending migrations first, as `api/` does.
*/
export class FakeHttp implements HttpChecker {
  readonly calls: HttpCheck[][] = [];
  /** Each health request with the number of transfer steps the remote had seen by then. */
  readonly healthCalls: { url: string; afterStep: number }[] = [];
  /** Migrations the fake database completed, by file name. */
  readonly completed = new Set<string>();
  failWith: string | undefined;
  /** Replaces fields of every health report. */
  healthOverride: Partial<HealthReport> = {};
  private readonly remote: FakeRemote | undefined;
  private readonly site: string;

  constructor(remote?: FakeRemote, site = '/remote/site') {
    this.remote = remote;
    this.site = site;
  }

  run(checks: readonly HttpCheck[]): Promise<void> {
    this.calls.push([...checks]);
    return this.failWith === undefined
      ? Promise.resolve()
      : Promise.reject(new Error(this.failWith));
  }

  health(url: string): Promise<HealthReport> {
    const { remote } = this;
    this.healthCalls.push({ url, afterStep: remote?.steps.length ?? 0 });
    const pointer = remote?.files.get(`${this.site}/api/index.php`) ?? '';
    const folder = /\/app\/([^/]+)\//.exec(pointer)?.[1];
    if (remote === undefined || folder === undefined) {
      return Promise.reject(
        new Error(`health check failed: ${url} answered 404`),
      );
    }
    const release = `/remote/${APP_DIR}/${folder}`;
    const appVersion =
      /'appVersion' => '([^']+)'/.exec(
        remote.files.get(`${release}/release.php`) ?? '',
      )?.[1] ?? '0.0.0-dev';
    return Promise.resolve({
      appVersion,
      phpVersion: '8.3.36',
      database: { engine: 'MySQL', version: '8.4.13' },
      ...this.migrate(remote, `${release}/migrations`),
      minClientVersion: '0.1.0',
      ...this.healthOverride,
    });
  }

  /**
  Applies the release's pending migrations, then reports the schema as `api/`
  does: the release's own completed prefix, or a newer migration the database
  completed that this release does not know.
  */
  private migrate(
    remote: FakeRemote,
    dir: string,
  ): Pick<HealthReport, 'schemaVersion' | 'migration'> {
    const migrations = [...remote.files]
      .filter(([path]) => posix.dirname(path) === dir)
      .toSorted(([a], [b]) => comparePaths(a, b));
    const known = new Set(migrations.map(([path]) => posix.basename(path)));
    const newest = (version: number) =>
      Math.max(
        version,
        ...[...this.completed]
          .filter((name) => !known.has(name))
          .map((name) => Number(name.slice(0, 4))),
      );
    let schemaVersion = 0;
    for (const [path, content] of migrations) {
      const name = posix.basename(path);
      if (!this.completed.has(name)) {
        if (content.includes(FAILING_MIGRATION)) {
          return { schemaVersion: newest(schemaVersion), migration: 'failed' };
        }
        this.completed.add(name);
      }
      schemaVersion = Number(name.slice(0, 4));
    }
    return { schemaVersion: newest(schemaVersion), migration: 'ok' };
  }
}

export const fakeRuntimeConfig: RuntimeConfig = {
  db: {
    host: 'db.example.test',
    name: 'performance',
    user: 'performance',
    password: 'fake-db-password',
  },
  bootstrapAdmin: {
    user: 'owner',
    passwordHash: '$2y$12$fakefakefakefakefakefuJ0123456789abcdefghijklmnopqrs',
  },
};

export interface FakeApp {
  /** Migrations 0001 … schemaVersion; default 1. */
  schemaVersion?: number;
  /** The newest migration fails when it runs. */
  failing?: boolean;
  /** What the release's health reports, when it differs from the manifest's app version. */
  reportedVersion?: string;
}

/** A PHP release folder for `commit`, by path inside it; equal lengths across commits. */
function fakeAppFiles(
  commit: string,
  appVersion: string,
  { schemaVersion = 1, failing = false, reportedVersion }: FakeApp,
): Map<string, string> {
  const sha7 = commit.slice(0, 7);
  const migrations = Array.from({ length: schemaVersion }, (_, index) => {
    const number = String(index + 1).padStart(4, '0');
    const fails = failing && index + 1 === schemaVersion;
    return [
      `migrations/${number}_step.php`,
      `<?php // migration ${number} ${fails ? FAILING_MIGRATION : 'applies'}\n`,
    ] as [string, string];
  });
  return new Map([
    ['public/index.php', `<?php // api ${sha7}\n`],
    [
      'release.php',
      `<?php return ['appVersion' => '${reportedVersion ?? appVersion}'];\n`,
    ],
    ...migrations,
  ]);
}

export async function fakeArtifact(
  local: FakeLocalFiles,
  dir: string,
  commit: string,
  extras?: string[],
  assetDir?: string,
  app: FakeApp = {},
): Promise<Artifact> {
  const web = `${dir}/${WEB_DIR}`;
  for (const [path, content] of fixtureSite(commit, extras, assetDir)) {
    await local.writeFile(`${web}/${path}`, content);
  }
  const folder = fixtureAppFolder(commit);
  const appVersion = folder.replace('-', '+');
  const appDir = `${dir}/${APP_DIR}/${folder}`;
  for (const [path, content] of fakeAppFiles(commit, appVersion, app)) {
    await local.writeFile(`${appDir}/${path}`, content);
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
      app: {
        folder,
        appVersion,
        schemaVersion: app.schemaVersion ?? 1,
        files: await local.artifactFiles(appDir),
      },
    }),
  };
}
