import {
  ASSET_DIR,
  comparePaths,
  hashedAssets,
  isHtml,
  type Manifest,
} from '../contract/artifact.ts';
import { headers, POWERED_BY } from '../contract/headers.ts';
import type { TargetPolicy } from '../contract/policy.ts';
import { versionJson } from './layout.ts';
import type { HttpCheck } from './ports.ts';

const HIDDEN_FILES = ['.deploy/state.json', '.htaccess'];
/** App routes fall back to the shell; a missing hashed asset must stay a 404, so a stale chunk fails loudly. */
const MISSING_ASSET = 'this-asset-does-not-exist.js';

export function routeUrl(
  policy: Pick<TargetPolicy, 'origin' | 'base'>,
  path: string,
): string {
  const route = path.endsWith('index.html')
    ? path.slice(0, -'index.html'.length)
    : path;
  return `${policy.origin}${policy.base}${route}`;
}

/** Pages and hashed assets carry the policy headers and never the server software header. */
function contentChecks(manifest: Manifest, policy: TargetPolicy): HttpCheck[] {
  const absentHeaders = [POWERED_BY];
  const pages = manifest.files
    .filter((file) => isHtml(file.path))
    .map((file) => routeUrl(policy, file.path))
    .toSorted(comparePaths)
    .map((url) => ({
      url,
      expectStatus: [200],
      headers: headers(policy),
      absentHeaders,
    }));
  const assetHeaders = [
    ...headers(policy),
    { name: 'Cache-Control', value: policy.caching.assets },
  ];
  const assets = hashedAssets(manifest).map((file) => ({
    url: routeUrl(policy, file.path),
    expectStatus: [200],
    headers: assetHeaders,
    absentHeaders,
  }));
  return [...pages, ...assets];
}

/** Each declared alias redirects to the origin. */
function aliasChecks(
  aliases: readonly string[],
  policy: TargetPolicy,
): HttpCheck[] {
  const { protocol } = new URL(policy.origin);
  return aliases.map((alias) => ({
    url: `${protocol}//${alias}${policy.base}`,
    expectStatus: [301],
    headers: [{ name: 'Location', value: `${policy.origin}${policy.base}` }],
  }));
}

export function httpChecks(
  manifest: Manifest,
  policy: TargetPolicy,
  aliases: readonly string[],
): HttpCheck[] {
  const url = (path: string) => routeUrl(policy, path);
  return [
    ...contentChecks(manifest, policy),
    {
      url: url('version.json'),
      expectStatus: [200],
      body: versionJson(manifest),
    },
    { url: url(`${ASSET_DIR}/${MISSING_ASSET}`), expectStatus: [404] },
    ...HIDDEN_FILES.map((path) => ({
      url: url(path),
      expectStatus: [403, 404],
    })),
    ...aliasChecks(aliases, policy),
  ];
}
