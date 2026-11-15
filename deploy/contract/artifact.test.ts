import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  buildManifest,
  checkCompatibility,
  isHashedAsset,
  isHtml,
  manifestDigest,
  parseManifest,
  releaseId,
  isSameManifest,
  verifyManifest,
  type ManifestEntry,
} from './artifact.ts';

const sha = (text: string) => createHash('sha256').update(text).digest('hex');
const files: ManifestEntry[] = [
  { path: 'index.html', size: 12, sha256: sha('index') },
  { path: 'assets/app.abc123.css', size: 7, sha256: sha('css') },
  { path: 'impressum/index.html', size: 9, sha256: sha('impressum') },
];
const input = {
  commit: '3736c2a9f1e2d3c4b5a6978877665544332211aa',
  runId: '123456',
  runAttempt: '1',
  buildTime: new Date('2026-10-22T19:30:00Z'),
  base: '/',
  files,
};

describe('releaseId', () => {
  it('is the UTC build time plus the short commit', () => {
    expect(releaseId(input.buildTime, input.commit)).toBe(
      '20261022T193000Z-3736c2a',
    );
  });
});

describe('manifestDigest', () => {
  it('hashes the sorted path/size/sha lines', () => {
    const expected = sha(
      [
        `assets/app.abc123.css\t7\t${sha('css')}`,
        `impressum/index.html\t9\t${sha('impressum')}`,
        `index.html\t12\t${sha('index')}`,
      ].join('\n') + '\n',
    );
    expect(manifestDigest(files)).toBe(expected);
    expect(manifestDigest(files.toReversed())).toBe(expected);
  });
});

describe('buildManifest', () => {
  it('records identity, build facts and sorted files', () => {
    const manifest = buildManifest(input);
    expect(manifest).toMatchObject({
      releaseId: '20261022T193000Z-3736c2a',
      commit: input.commit,
      runId: '123456',
      runAttempt: '1',
      buildTime: '2026-10-22T19:30:00.000Z',
      base: '/',
      digest: manifestDigest(files),
    });
    expect(manifest.files.map((file) => file.path)).toEqual([
      'assets/app.abc123.css',
      'impressum/index.html',
      'index.html',
    ]);
  });
});

describe('parseManifest', () => {
  it('round-trips a built manifest', () => {
    const manifest = buildManifest(input);
    expect(parseManifest(JSON.stringify(manifest))).toEqual(manifest);
  });

  it('returns the files path-sorted even when the json lists them out of order', () => {
    const manifest = buildManifest(input);
    const shuffled = { ...manifest, files: manifest.files.toReversed() };
    expect(parseManifest(JSON.stringify(shuffled)).files).toEqual(
      manifest.files,
    );
  });

  it('rejects a missing manifest', () => {
    expect(() => parseManifest(undefined)).toThrow(/manifest\.json is missing/);
  });

  it.each([
    ['not JSON', '{'],
    ['files', JSON.stringify({ ...buildManifest(input), files: 'nope' })],
    [
      'size',
      JSON.stringify({
        ...buildManifest(input),
        files: [{ path: 'a', size: '1', sha256: sha('a') }],
      }),
    ],
    ['commit', JSON.stringify({ ...buildManifest(input), commit: '' })],
    ['base', JSON.stringify({ ...buildManifest(input), base: 7 })],
  ])('rejects a malformed manifest (%s)', (field, json) => {
    expect(() => parseManifest(json)).toThrow(
      new RegExp(String.raw`manifest\.json is malformed: ${field}`),
    );
  });
});

describe('verifyManifest', () => {
  const manifest = buildManifest(input);

  it('accepts an artifact that matches', () => {
    expect(() => {
      verifyManifest(manifest, files);
    }).not.toThrow();
  });

  it('rejects a digest mismatch', () => {
    expect(() => {
      verifyManifest({ ...manifest, digest: 'f'.repeat(64) }, files);
    }).toThrow(/manifest\.json digest mismatch/);
  });

  it('rejects missing and changed files', () => {
    const actual = [
      { path: 'index.html', size: 12, sha256: sha('tampered') },
      { path: 'assets/app.abc123.css', size: 7, sha256: sha('css') },
    ];
    expect(() => {
      verifyManifest(manifest, actual);
    }).toThrow(/missing impressum\/index\.html, index\.html/);
  });

  it('rejects unexpected files', () => {
    expect(() => {
      verifyManifest(manifest, [
        ...files,
        { path: 'extra.txt', size: 1, sha256: sha('x') },
      ]);
    }).toThrow(/unexpected extra\.txt/);
  });
});

describe('checkCompatibility', () => {
  const manifest = buildManifest(input);

  it('accepts the base the artifact was built for, whatever the origin', () => {
    expect(() => {
      checkCompatibility(manifest, { base: '/' });
    }).not.toThrow();
  });

  it('rejects another base', () => {
    expect(() => {
      checkCompatibility(manifest, { base: '/preview/' });
    }).toThrow(
      'artifact built for base / is not compatible with target base /preview/',
    );
  });
});

describe('isSameManifest', () => {
  const manifest = buildManifest(input);

  it('is true for equal manifests and false for any differing field', () => {
    const roundTripped = parseManifest(JSON.stringify(manifest));
    expect(isSameManifest(manifest, roundTripped)).toBe(true);
    expect(
      isSameManifest(manifest, { ...manifest, commit: 'b'.repeat(40) }),
    ).toBe(false);
    expect(isSameManifest(manifest, { ...manifest, base: '/other/' })).toBe(
      false,
    );
    expect(
      isSameManifest(manifest, { ...manifest, files: manifest.files.slice(1) }),
    ).toBe(false);
  });
});

describe('path classes', () => {
  it('classifies hashed assets and html', () => {
    expect(isHashedAsset('assets/app.abc123.css', 'assets')).toBe(true);
    expect(isHashedAsset('index.html', 'assets')).toBe(false);
    expect(isHashedAsset('assets/app.abc123.css', '_build')).toBe(false);
    expect(isHashedAsset('_build/app.abc123.css', '_build')).toBe(true);
    expect(isHashedAsset('assets-old/app.css', 'assets')).toBe(false);
    expect(isHtml('impressum/index.html')).toBe(true);
    expect(isHtml('assets/app.abc123.css')).toBe(false);
  });
});
