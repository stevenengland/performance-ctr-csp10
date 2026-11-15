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

export function targetPolicy(siteUrl: string): TargetPolicy {
  return { ...parseSiteUrl(siteUrl), caching: CACHING };
}

function required(env: Env, name: string): string {
  return requiredVariable(env, name, 'repository');
}

/** The production policy from the `SITE_URL` repository variable. */
export function parsePolicy(env: Env): TargetPolicy {
  const name = 'SITE_URL';
  try {
    return targetPolicy(required(env, name));
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

// Characters every transport passes unquoted; sftp batch lines split on whitespace and glob.
const FOLDER_NAME = /^[\w.-]+$/;
// `.` and `..` name no folder of their own; `.deploy` is what the deploy keeps beside the served folder.
const NOT_A_DOCROOT = new Set(['.', '..', '.deploy']);

function docroot(env: Env, name: string): string {
  const value = env[name];
  if (value === undefined || value === '') return 'site';
  if (!FOLDER_NAME.test(value) || NOT_A_DOCROOT.has(value)) {
    throw new Error(
      `Invalid repository variable ${name}: expected one folder name of letters, digits, ".", "_" and "-", not ${[...NOT_A_DOCROOT].join(', ')}`,
    );
  }
  return value;
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
    docroot: docroot(env, 'DOCROOT'),
    aliases: aliases(env, 'SITE_ALIASES'),
  };
}

export { type Env } from './parse.ts';
