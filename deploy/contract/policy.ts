export const CACHING = {
  /** The app shell, service worker and manifest: always revalidated. */
  revalidate: 'no-cache',
  /** Content-hashed build output. */
  assets: 'public, max-age=31536000, immutable',
} as const;
export type Caching = typeof CACHING;

/** What the rendered web-root configuration depends on: where the app is served. */
export interface TargetPolicy {
  origin: string;
  /** The URL path the web root is served at, with leading and trailing slash. */
  base: string;
  caching: Caching;
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
