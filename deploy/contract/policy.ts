import { DEFAULT_ASSET_DIR } from './artifact.ts';
import { isHostName, requiredVariable, type Env } from './parse.ts';

export const CACHING = {
  /** The app shell, service worker and manifest: always revalidated. */
  revalidate: 'no-cache',
  /** Content-hashed build output. */
  assets: 'public, max-age=31536000, immutable',
} as const;
export type Caching = typeof CACHING;

/** What the rendered web-root configuration and the checks depend on: where the app is served. */
export interface TargetPolicy {
  origin: string;
  /** The URL path the web root is served at, with leading and trailing slash. */
  base: string;
  caching: Caching;
  /** The web-root folder of content-hashed files: cached forever, retained for rollback. */
  assetDir: string;
}

/** Where the deploy writes on the one production webspace; the SFTP endpoint belongs to the transport. */
export interface WebspaceSettings {
  remoteRoot: string;
  /** The name of the served folder inside the remote root. */
  docroot: string;
  /** Host names that must redirect to the origin; checked after every deploy. */
  aliases: readonly string[];
}

export function parseSiteUrl(value: string): { origin: string; base: string } {
  const invalid = new Error(
    'expected an http:// or https:// URL without query or fragment',
  );
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw invalid;
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') throw invalid;
  if (value.includes('?') || value.includes('#')) throw invalid;
  // The lookbehind starts the match at the first trailing slash: linear time.
  const path = url.pathname.replace(/(?<!\/)\/+$/, '');
  return { origin: url.origin, base: `${path}/` };
}

export function targetPolicy(
  siteUrl: string,
  assetDir = DEFAULT_ASSET_DIR,
): TargetPolicy {
  return { ...parseSiteUrl(siteUrl), caching: CACHING, assetDir };
}

function required(env: Env, name: string): string {
  return requiredVariable(env, name, 'repository');
}

// Characters every transport passes unquoted; sftp batch lines split on whitespace and glob.
const FOLDER_NAME = /^[\w.-]+$/;

/** One folder name, not `.`, `..` or one of `reserved`; `fallback` when unset or empty. */
function folderVariable(
  env: Env,
  name: string,
  fallback: string,
  reserved: readonly string[] = [],
): string {
  const value = env[name];
  if (value === undefined || value === '') return fallback;
  const excluded = ['.', '..', ...reserved];
  if (!FOLDER_NAME.test(value) || excluded.includes(value)) {
    throw new Error(
      `Invalid repository variable ${name}: expected one folder name of letters, digits, ".", "_" and "-", not ${excluded.join(', ')}`,
    );
  }
  return value;
}

/** The hashed-asset folder from `ASSET_DIR`; Vite's `assets` when unset. */
export function parseAssetDir(env: Env): string {
  return folderVariable(env, 'ASSET_DIR', DEFAULT_ASSET_DIR);
}

/** The production policy from `SITE_URL` and `ASSET_DIR`. */
export function parsePolicy(env: Env): TargetPolicy {
  const assetDir = parseAssetDir(env);
  const name = 'SITE_URL';
  try {
    return targetPolicy(required(env, name), assetDir);
  } catch (error) {
    const { message } = error as Error;
    if (message.startsWith('Missing')) throw error;
    throw new Error(`Invalid repository variable ${name}: ${message}`, {
      cause: error,
    });
  }
}

function aliases(env: Env, name: string): string[] {
  const value = env[name];
  if (value === undefined || value === '') return [];
  const names = value.split(',').map((alias) => alias.trim());
  if (names.some((alias) => !isHostName(alias))) {
    throw new Error(
      `Invalid repository variable ${name}: expected comma-separated lowercase host names`,
    );
  }
  return names;
}

function remoteRoot(env: Env, name: string): string {
  const value = env[name];
  if (value === undefined || value === '') return '/';
  if (!value.startsWith('/')) {
    throw new Error(
      `Invalid repository variable ${name}: expected an absolute path`,
    );
  }
  return value;
}

/** The production webspace from `REMOTE_ROOT` (default `/`, the SFTP root), `DOCROOT` and `SITE_ALIASES`. */
export function parseWebspaceSettings(env: Env): WebspaceSettings {
  return {
    remoteRoot: remoteRoot(env, 'REMOTE_ROOT'),
    // `.deploy` is what the deploy keeps beside the served folder.
    docroot: folderVariable(env, 'DOCROOT', 'site', ['.deploy']),
    aliases: aliases(env, 'SITE_ALIASES'),
  };
}

export { type Env } from './parse.ts';
