import { createHash } from 'node:crypto';
import { isNonEmptyString, parseJson } from './parse.ts';
import type { TargetPolicy } from './policy.ts';

/** Vite's folder for content-hashed build output (`build.assetsDir`); `ASSET_DIR` overrides it. */
export const DEFAULT_ASSET_DIR = 'assets';

/** Web-root files that name the current build and must never be served stale. */
export const REVALIDATED_FILES = [
  'index.html',
  'sw.js',
  'manifest.webmanifest',
] as const;

/** The web root's PHP entry pointer; it names the PHP release that answers `/api/*`. */
export const API_ENTRY = 'api/index.php';

/** An artifact directory holds the web root in `web/` and the deploy manifest beside it. */
export const WEB_DIR = 'web';
export const MANIFEST_FILE = 'manifest.json';

export interface ManifestEntry {
  path: string;
  size: number;
  sha256: string;
}

/** `files` is path-sorted by construction: `buildManifest` and `parseManifest` both sort. */
export interface Manifest {
  releaseId: string;
  commit: string;
  runId: string;
  runAttempt: string;
  buildTime: string;
  base: string;
  files: ManifestEntry[];
  digest: string;
}

const SCALAR_FIELDS = [
  'releaseId',
  'commit',
  'runId',
  'runAttempt',
  'buildTime',
  'base',
  'digest',
] as const;

export function releaseId(buildTime: Date, commit: string): string {
  const stamp = buildTime
    .toISOString()
    .replace(/\.\d{3}Z$/, 'Z')
    .replaceAll(/[-:]/g, '');
  return `${stamp}-${commit.slice(0, 7)}`;
}

/** Code-unit order, so every module sorts paths the same way regardless of locale. */
export function comparePaths(a: string, b: string): number {
  if (a === b) return 0;
  return a < b ? -1 : 1;
}

export function sortedByPath<T extends { path: string }>(
  files: readonly T[],
): T[] {
  return files.toSorted((a, b) => comparePaths(a.path, b.path));
}

export function manifestDigest(files: readonly ManifestEntry[]): string {
  const lines = sortedByPath(files).map(
    (file) => `${file.path}\t${String(file.size)}\t${file.sha256}\n`,
  );
  return createHash('sha256').update(lines.join('')).digest('hex');
}

export function buildManifest(input: {
  commit: string;
  runId: string;
  runAttempt: string;
  buildTime: Date;
  base: string;
  files: readonly ManifestEntry[];
}): Manifest {
  return {
    releaseId: releaseId(input.buildTime, input.commit),
    commit: input.commit,
    runId: input.runId,
    runAttempt: input.runAttempt,
    buildTime: input.buildTime.toISOString(),
    base: input.base,
    files: sortedByPath(input.files),
    digest: manifestDigest(input.files),
  };
}

const malformed = (fault: string) =>
  new Error(`${MANIFEST_FILE} is malformed: ${fault}`);

function toEntry(value: unknown): ManifestEntry {
  if (typeof value !== 'object' || value === null) throw malformed('files');
  const { path, size, sha256 } = value as Record<string, unknown>;
  if (!isNonEmptyString(path)) throw malformed('path');
  if (typeof size !== 'number' || !Number.isSafeInteger(size)) {
    throw malformed('size');
  }
  if (typeof sha256 !== 'string' || !/^[0-9a-f]{64}$/.test(sha256)) {
    throw malformed('sha256');
  }
  return { path, size, sha256 };
}

function toManifest(value: unknown): Manifest {
  if (typeof value !== 'object' || value === null) {
    throw malformed('not an object');
  }
  const record = value as Record<string, unknown>;
  const scalar = (name: (typeof SCALAR_FIELDS)[number]): string => {
    const field = record[name];
    if (!isNonEmptyString(field)) throw malformed(name);
    return field;
  };
  const releaseId = scalar('releaseId');
  const commit = scalar('commit');
  const runId = scalar('runId');
  const runAttempt = scalar('runAttempt');
  const buildTime = scalar('buildTime');
  const base = scalar('base');
  const digest = scalar('digest');
  const files = record.files;
  if (!Array.isArray(files)) throw malformed('files');
  return {
    releaseId,
    commit,
    runId,
    runAttempt,
    buildTime,
    base,
    files: sortedByPath(files.map((file) => toEntry(file))),
    digest,
  };
}

export function parseManifest(json: string | undefined): Manifest {
  if (json === undefined) throw new Error(`${MANIFEST_FILE} is missing`);
  return toManifest(parseJson(json, MANIFEST_FILE));
}

function isSameEntry(a: ManifestEntry, b: ManifestEntry | undefined): boolean {
  return a.size === b?.size && a.sha256 === b.sha256;
}

export function verifyManifest(
  manifest: Manifest,
  actual: readonly ManifestEntry[],
): void {
  if (manifestDigest(manifest.files) !== manifest.digest) {
    throw new Error(`${MANIFEST_FILE} digest mismatch`);
  }
  const byPath = new Map(actual.map((entry) => [entry.path, entry]));
  const listed = new Set(manifest.files.map((entry) => entry.path));
  const missing = manifest.files
    .filter((entry) => !isSameEntry(entry, byPath.get(entry.path)))
    .map((entry) => entry.path);
  const unexpected = sortedByPath(actual)
    .filter((entry) => !listed.has(entry.path))
    .map((entry) => entry.path);
  const problems = [
    ...(missing.length > 0 ? [`missing ${missing.join(', ')}`] : []),
    ...(unexpected.length > 0 ? [`unexpected ${unexpected.join(', ')}`] : []),
  ];
  if (problems.length > 0) {
    throw new Error(
      `artifact does not match ${MANIFEST_FILE}: ${problems.join('; ')}`,
    );
  }
}

/** The build's base path is baked into the SPA's asset URLs; the origin is not. */
export function checkCompatibility(
  manifest: Pick<Manifest, 'base'>,
  policy: Pick<TargetPolicy, 'base'>,
): void {
  if (manifest.base !== policy.base) {
    throw new Error(
      `artifact built for base ${manifest.base} is not compatible with target base ${policy.base}`,
    );
  }
}

export function isSameManifest(a: Manifest, b: Manifest): boolean {
  return (
    SCALAR_FIELDS.every((field) => a[field] === b[field]) &&
    a.files.length === b.files.length &&
    a.files.every(
      (entry, index) =>
        entry.path === b.files[index]?.path &&
        isSameEntry(entry, b.files[index]),
    )
  );
}

/** A file under the hashed-asset folder: immutable, uploaded beside the live ones and retained for rollback. */
export function isHashedAsset(path: string, assetDir: string): boolean {
  return path.startsWith(`${assetDir}/`);
}

export function hashedAssets(
  manifest: Manifest,
  assetDir: string,
): ManifestEntry[] {
  return manifest.files.filter((file) => isHashedAsset(file.path, assetDir));
}

/** Every file outside the hashed-asset folder: staged, then activated by rename. */
export function activatedFiles(
  manifest: Manifest,
  assetDir: string,
): ManifestEntry[] {
  return manifest.files.filter((file) => !isHashedAsset(file.path, assetDir));
}

export function isHtml(path: string): boolean {
  return path.endsWith('.html');
}
