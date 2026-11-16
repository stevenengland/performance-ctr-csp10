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

/**
An artifact directory holds the web root in `web/`, the PHP releases in
`app/<folder>/`, the build's `release.json` and the deploy manifest beside them.
*/
export const WEB_DIR = 'web';
export const APP_DIR = 'app';
export const RELEASE_FILE = 'release.json';
export const MANIFEST_FILE = 'manifest.json';

export interface ManifestEntry {
  path: string;
  size: number;
  sha256: string;
}

/**
The PHP release the web root's `api/index.php` names: its folder below `app/`,
the app version its health reports and the schema version it migrates to.
`files` are relative to the folder.
*/
export interface AppRelease {
  folder: string;
  appVersion: string;
  schemaVersion: number;
  files: ManifestEntry[];
}

/** `files` (the web root) and `app.files` are path-sorted by construction: `buildManifest` and `parseManifest` both sort. */
export interface Manifest {
  releaseId: string;
  commit: string;
  runId: string;
  runAttempt: string;
  buildTime: string;
  base: string;
  files: ManifestEntry[];
  app: AppRelease;
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

/** The GitHub Release tag a production deploy is archived under: `release-YYYYMMDD-HHMM` in UTC. */
export function releaseTag(deployedAt: Date): string {
  const [date = '', time = ''] = deployedAt.toISOString().split('T');
  return `release-${date.replaceAll('-', '')}-${time.slice(0, 5).replace(':', '')}`;
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

function fileLines(files: readonly ManifestEntry[], prefix = ''): string[] {
  return sortedByPath(files).map(
    (file) => `${prefix}${file.path}\t${String(file.size)}\t${file.sha256}\n`,
  );
}

/** One hash over the web root's lines, the PHP release's identity and its files under `app/`. */
export function manifestDigest(
  files: readonly ManifestEntry[],
  app: AppRelease,
): string {
  const lines = [
    ...fileLines(files),
    `${APP_DIR}\t${app.folder}\t${app.appVersion}\t${String(app.schemaVersion)}\n`,
    ...fileLines(app.files, `${APP_DIR}/`),
  ];
  return createHash('sha256').update(lines.join('')).digest('hex');
}

export function buildManifest(input: {
  commit: string;
  runId: string;
  runAttempt: string;
  buildTime: Date;
  base: string;
  files: readonly ManifestEntry[];
  app: AppRelease;
}): Manifest {
  const app = { ...input.app, files: sortedByPath(input.app.files) };
  return {
    releaseId: releaseId(input.buildTime, input.commit),
    commit: input.commit,
    runId: input.runId,
    runAttempt: input.runAttempt,
    buildTime: input.buildTime.toISOString(),
    base: input.base,
    files: sortedByPath(input.files),
    app,
    digest: manifestDigest(input.files, app),
  };
}

const RELEASE_FOLDER = /^[0-9A-Za-z][0-9A-Za-z.-]*$/;

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
  return {
    releaseId,
    commit,
    runId,
    runAttempt,
    buildTime,
    base,
    files: toEntries(record.files, 'files'),
    app: toApp(record.app),
    digest,
  };
}

function toEntries(value: unknown, field: string): ManifestEntry[] {
  if (!Array.isArray(value)) throw malformed(field);
  return sortedByPath(value.map((file) => toEntry(file)));
}

function toApp(value: unknown): AppRelease {
  if (typeof value !== 'object' || value === null) throw malformed('app');
  const { folder, appVersion, schemaVersion, files } = value as Record<
    string,
    unknown
  >;
  if (typeof folder !== 'string' || !RELEASE_FOLDER.test(folder)) {
    throw malformed('app.folder');
  }
  if (!isNonEmptyString(appVersion)) throw malformed('app.appVersion');
  if (!isSchemaVersion(schemaVersion)) throw malformed('app.schemaVersion');
  return {
    folder,
    appVersion,
    schemaVersion,
    files: toEntries(files, 'app.files'),
  };
}

function isSchemaVersion(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

/**
The build's `release.json` (scripts/build-artifact.ts): the PHP release's
folder, app version and schema version, without its files.
*/
export function parseRelease(
  json: string | undefined,
): Omit<AppRelease, 'files'> {
  if (json === undefined) throw new Error(`${RELEASE_FILE} is missing`);
  const value = parseJson(json, RELEASE_FILE);
  const invalid = (field: string) =>
    new Error(`${RELEASE_FILE} is malformed: ${field}`);
  if (typeof value !== 'object' || value === null) {
    throw invalid('not an object');
  }
  const { release, appVersion, schemaVersion } = value as Record<
    string,
    unknown
  >;
  if (typeof release !== 'string' || !RELEASE_FOLDER.test(release)) {
    throw invalid('release');
  }
  if (!isNonEmptyString(appVersion)) throw invalid('appVersion');
  if (!isSchemaVersion(schemaVersion)) throw invalid('schemaVersion');
  return { folder: release, appVersion, schemaVersion };
}

export function parseManifest(json: string | undefined): Manifest {
  if (json === undefined) throw new Error(`${MANIFEST_FILE} is missing`);
  return toManifest(parseJson(json, MANIFEST_FILE));
}

function isSameEntry(a: ManifestEntry, b: ManifestEntry | undefined): boolean {
  return a.size === b?.size && a.sha256 === b.sha256;
}

function differences(
  listed: readonly ManifestEntry[],
  actual: readonly ManifestEntry[],
  prefix: string,
): { missing: string[]; unexpected: string[] } {
  const byPath = new Map(actual.map((entry) => [entry.path, entry]));
  const paths = new Set(listed.map((entry) => entry.path));
  return {
    missing: listed
      .filter((entry) => !isSameEntry(entry, byPath.get(entry.path)))
      .map((entry) => `${prefix}${entry.path}`),
    unexpected: sortedByPath(actual)
      .filter((entry) => !paths.has(entry.path))
      .map((entry) => `${prefix}${entry.path}`),
  };
}

/** The artifact's web root (`actual.web`) and PHP release folder (`actual.app`) hold exactly the listed bytes. */
export function verifyManifest(
  manifest: Manifest,
  actual: { web: readonly ManifestEntry[]; app: readonly ManifestEntry[] },
): void {
  if (manifestDigest(manifest.files, manifest.app) !== manifest.digest) {
    throw new Error(`${MANIFEST_FILE} digest mismatch`);
  }
  const web = differences(manifest.files, actual.web, '');
  const app = differences(
    manifest.app.files,
    actual.app,
    `${APP_DIR}/${manifest.app.folder}/`,
  );
  const missing = [...web.missing, ...app.missing];
  const unexpected = [...web.unexpected, ...app.unexpected];
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

function isSameFiles(
  a: readonly ManifestEntry[],
  b: readonly ManifestEntry[],
): boolean {
  return (
    a.length === b.length &&
    a.every(
      (entry, index) =>
        entry.path === b[index]?.path && isSameEntry(entry, b[index]),
    )
  );
}

export function isSameManifest(a: Manifest, b: Manifest): boolean {
  return (
    SCALAR_FIELDS.every((field) => a[field] === b[field]) &&
    isSameFiles(a.files, b.files) &&
    a.app.folder === b.app.folder &&
    a.app.appVersion === b.app.appVersion &&
    a.app.schemaVersion === b.app.schemaVersion &&
    isSameFiles(a.app.files, b.app.files)
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

/** The app shell, service worker and web manifest: activated last, once the API answers for the release. */
export function isShellFile(path: string): boolean {
  return (REVALIDATED_FILES as readonly string[]).includes(path);
}

export function isHtml(path: string): boolean {
  return path.endsWith('.html');
}
