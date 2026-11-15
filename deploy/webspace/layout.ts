import { posix } from 'node:path';
import type { Manifest } from '../contract/artifact.ts';

export const VERIFIED_MARKER = '.verified';

export interface RemotePaths {
  root: string;
  /** The served folder. */
  site: string;
  deploy: string;
  state: string;
  manifests: string;
  staged: string;
  manifest(id: string): string;
  stagedDir(id: string): string;
  stagedFile(id: string, path: string): string;
  siteFile(path: string): string;
}

const MANIFEST_SUFFIX = '.json';

/** The file name of a release's manifest inside `.deploy/manifests`. */
export function manifestFile(id: string): string {
  return `${id}${MANIFEST_SUFFIX}`;
}

/** The release id a `.deploy/manifests` entry names, or undefined for any other file. */
export function manifestId(name: string): string | undefined {
  return name.endsWith(MANIFEST_SUFFIX)
    ? name.slice(0, -MANIFEST_SUFFIX.length)
    : undefined;
}

/** The body of `site/version.json`; the http checks expect exactly these bytes. */
export function versionJson(manifest: Manifest): string {
  return JSON.stringify({
    release: manifest.releaseId,
    commit: manifest.commit,
  });
}

/** The release a `site/version.json` body names, or undefined when it names none. */
export function parseVersion(json: string | undefined): string | undefined {
  if (json === undefined) return undefined;
  try {
    const value: unknown = JSON.parse(json);
    const release =
      typeof value === 'object' && value !== null
        ? (value as Record<string, unknown>).release
        : undefined;
    return typeof release === 'string' ? release : undefined;
  } catch {
    return undefined;
  }
}

/** The deploy's paths under `root`; `docroot` names the served folder there. */
export function remotePaths(root: string, docroot: string): RemotePaths {
  const deploy = posix.join(root, '.deploy');
  const site = posix.join(root, docroot);
  const manifests = posix.join(deploy, 'manifests');
  const staged = posix.join(deploy, 'staged');
  return {
    root,
    site,
    deploy,
    state: posix.join(deploy, 'state.json'),
    manifests,
    staged,
    manifest: (id) => posix.join(manifests, manifestFile(id)),
    stagedDir: (id) => posix.join(staged, id),
    stagedFile: (id, path) => posix.join(staged, id, path),
    siteFile: (path) => posix.join(site, path),
  };
}

/** The name of a hashed asset inside the asset folder, e.g. `assets/a.css` → `a.css`. */
export function assetName(assetDir: string, path: string): string {
  return path.slice(assetDir.length + 1);
}

/** The site path of an asset named in the asset folder, e.g. `a.css` → `assets/a.css`. */
export function assetPath(assetDir: string, name: string): string {
  return `${assetDir}/${name}`;
}

export function partName(path: string): string {
  return `${path}.part`;
}

export function isPartName(name: string): boolean {
  return name.endsWith('.part');
}

export function parentDirs(path: string): string[] {
  const segments = path.split('/').slice(0, -1);
  return segments.map((_, index) => segments.slice(0, index + 1).join('/'));
}
