import { describe, expect, it } from 'vitest';
import { buildManifest } from '../contract/artifact.ts';
import { headers, POWERED_BY } from '../contract/headers.ts';
import { targetPolicy } from '../contract/policy.ts';
import { httpChecks, routeUrl } from './checks.ts';
import type { HttpCheck } from './ports.ts';

const sha = 'c'.repeat(64);
const manifest = buildManifest({
  commit: '3'.repeat(40),
  runId: '1',
  runAttempt: '1',
  buildTime: new Date('2026-10-22T12:00:00Z'),
  base: '/',
  files: [
    { path: 'index.html', size: 1, sha256: sha },
    { path: 'manifest.webmanifest', size: 1, sha256: sha },
    { path: 'sw.js', size: 1, sha256: sha },
    { path: 'assets/a.css', size: 1, sha256: sha },
  ],
});
const assetCaching = {
  name: 'Cache-Control',
  value: 'public, max-age=31536000, immutable',
};
const redirects = (checks: HttpCheck[]) =>
  checks.filter((check) => check.expectStatus.includes(301));

describe('routeUrl', () => {
  it.each([
    ['index.html', 'http://h.test', 'http://h.test/'],
    ['verlauf/index.html', 'http://h.test', 'http://h.test/verlauf/'],
    ['index.html', 'http://h.test/app', 'http://h.test/app/'],
    ['assets/a.css', 'http://h.test/app', 'http://h.test/app/assets/a.css'],
  ])('%s under %s → %s', (path, siteUrl, url) => {
    expect(routeUrl(targetPolicy(siteUrl), path)).toBe(url);
  });
});

describe('httpChecks', () => {
  it('checks the shell, the hashed assets, version.json, a missing asset and the hidden files', () => {
    const policy = targetPolicy('http://h.test');
    expect(httpChecks(manifest, policy, [])).toEqual([
      {
        url: 'http://h.test/',
        expectStatus: [200],
        headers: headers(policy),
        absentHeaders: [POWERED_BY],
      },
      {
        url: 'http://h.test/assets/a.css',
        expectStatus: [200],
        headers: [...headers(policy), assetCaching],
        absentHeaders: [POWERED_BY],
      },
      {
        url: 'http://h.test/version.json',
        expectStatus: [200],
        body: JSON.stringify({
          release: manifest.releaseId,
          commit: manifest.commit,
        }),
      },
      {
        url: 'http://h.test/assets/this-asset-does-not-exist.js',
        expectStatus: [404],
      },
      { url: 'http://h.test/.deploy/state.json', expectStatus: [403, 404] },
      { url: 'http://h.test/.htaccess', expectStatus: [403, 404] },
    ]);
  });

  it('checks the immutable caching and the missing asset in the configured hashed-asset folder', () => {
    const policy = { ...targetPolicy('http://h.test'), assetDir: '_build' };
    const custom = { ...manifest, files: [...manifest.files] };
    custom.files.push({ path: '_build/b.js', size: 1, sha256: sha });
    const urls = httpChecks(custom, policy, [])
      .filter((check) =>
        check.headers?.some((header) => header.name === 'Cache-Control'),
      )
      .map((check) => check.url);
    expect(urls).toEqual(['http://h.test/_build/b.js']);
    expect(httpChecks(custom, policy, [])).toContainEqual({
      url: 'http://h.test/_build/this-asset-does-not-exist.js',
      expectStatus: [404],
    });
  });

  it('expects a redirect to the origin from each declared alias', () => {
    const policy = targetPolicy('https://h.test');
    const toOrigin = [{ name: 'Location', value: 'https://h.test/' }];
    expect(
      redirects(httpChecks(manifest, policy, ['www.h.test', 'alt.test'])),
    ).toEqual([
      { url: 'https://www.h.test/', expectStatus: [301], headers: toOrigin },
      { url: 'https://alt.test/', expectStatus: [301], headers: toOrigin },
    ]);
    expect(redirects(httpChecks(manifest, policy, []))).toEqual([]);
  });
});
