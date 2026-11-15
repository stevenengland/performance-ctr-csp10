import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  buildManifest,
  checkCompatibility,
  isHashedAsset,
  isHtml,
  isShellFile,
  manifestDigest,
  parseManifest,
  parseRelease,
  releaseId,
  releaseTag,
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
const app = {
  folder: '0.1.0-3736c2a',
  appVersion: '0.1.0+3736c2a',
  schemaVersion: 4,
  files: [
    { path: 'public/index.php', size: 30, sha256: sha('entry') },
    { path: 'migrations/0001_a.php', size: 20, sha256: sha('m1') },
  ],
};
const input = {
  commit: '3736c2a9f1e2d3c4b5a6978877665544332211aa',
  runId: '123456',
  runAttempt: '1',
  buildTime: new Date('2026-10-22T19:30:00Z'),
  base: '/',
  files,
  app,
};
const actual = { web: files, app: app.files };

describe('releaseId', () => {
  it('is the UTC build time plus the short commit', () => {
    expect(releaseId(input.buildTime, input.commit)).toBe(
      '20261022T193000Z-3736c2a',
    );
  });
});

describe('releaseTag', () => {
  it('names the archive by the UTC minute of the deploy', () => {
    expect(releaseTag(new Date('2026-11-15T09:07:59.999Z'))).toBe(
      'release-20261115-0907',
    );
    expect(releaseTag(new Date('2026-01-02T23:59:00+02:00'))).toBe(
      'release-20260102-2159',
    );
  });
});

describe('manifestDigest', () => {
  it('hashes the sorted web lines, the PHP release identity and its sorted files', () => {
    const expected = sha(
      [
        `assets/app.abc123.css\t7\t${sha('css')}`,
        `impressum/index.html\t9\t${sha('impressum')}`,
        `index.html\t12\t${sha('index')}`,
        'app\t0.1.0-3736c2a\t0.1.0+3736c2a\t4',
        `app/migrations/0001_a.php\t20\t${sha('m1')}`,
        `app/public/index.php\t30\t${sha('entry')}`,
      ].join('\n') + '\n',
    );
    expect(manifestDigest(files, app)).toBe(expected);
    expect(
      manifestDigest(files.toReversed(), {
        ...app,
        files: app.files.toReversed(),
      }),
    ).toBe(expected);
  });

  it('changes with the schema version', () => {
    expect(manifestDigest(files, { ...app, schemaVersion: 5 })).not.toBe(
      manifestDigest(files, app),
    );
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
      digest: manifestDigest(files, app),
    });
    expect(manifest.files.map((file) => file.path)).toEqual([
      'assets/app.abc123.css',
      'impressum/index.html',
      'index.html',
    ]);
  });

  it('records the PHP release with its schema version and sorted files', () => {
    const manifest = buildManifest(input);
    expect(manifest.app).toEqual({
      folder: '0.1.0-3736c2a',
      appVersion: '0.1.0+3736c2a',
      schemaVersion: 4,
      files: [app.files[1], app.files[0]],
    });
  });
});

describe('parseRelease', () => {
  it("reads the build's release folder, app version and schema version", () => {
    expect(
      parseRelease(
        JSON.stringify({
          appVersion: '0.1.0+3736c2a',
          release: '0.1.0-3736c2a',
          schemaVersion: 4,
        }),
      ),
    ).toEqual({
      folder: '0.1.0-3736c2a',
      appVersion: '0.1.0+3736c2a',
      schemaVersion: 4,
    });
  });

  it.each([
    ['release', { appVersion: 'v', release: '../x', schemaVersion: 1 }],
    ['appVersion', { appVersion: '', release: 'r', schemaVersion: 1 }],
    ['schemaVersion', { appVersion: 'v', release: 'r', schemaVersion: '1' }],
    ['schemaVersion', { appVersion: 'v', release: 'r', schemaVersion: -1 }],
  ])('rejects a malformed release.json (%s)', (field, value) => {
    expect(() => parseRelease(JSON.stringify(value))).toThrow(
      `release.json is malformed: ${field}`,
    );
  });

  it('rejects a missing release.json', () => {
    expect(() => parseRelease(undefined)).toThrow('release.json is missing');
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
    ['app', JSON.stringify({ ...buildManifest(input), app: undefined })],
    [
      'app.folder',
      JSON.stringify({
        ...buildManifest(input),
        app: { ...app, folder: '..' },
      }),
    ],
    [
      'app.schemaVersion',
      JSON.stringify({
        ...buildManifest(input),
        app: { ...app, schemaVersion: 1.5 },
      }),
    ],
    [
      'app.files',
      JSON.stringify({ ...buildManifest(input), app: { ...app, files: {} } }),
    ],
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
      verifyManifest(manifest, actual);
    }).not.toThrow();
  });

  it('rejects a digest mismatch', () => {
    expect(() => {
      verifyManifest({ ...manifest, digest: 'f'.repeat(64) }, actual);
    }).toThrow(/manifest\.json digest mismatch/);
  });

  it('rejects missing and changed files', () => {
    const changed = [
      { path: 'index.html', size: 12, sha256: sha('tampered') },
      { path: 'assets/app.abc123.css', size: 7, sha256: sha('css') },
    ];
    expect(() => {
      verifyManifest(manifest, { web: changed, app: app.files });
    }).toThrow(/missing impressum\/index\.html, index\.html/);
  });

  it('rejects missing and unexpected files of the PHP release, named under app/', () => {
    expect(() => {
      verifyManifest(manifest, {
        web: files,
        app: [
          app.files[0] ?? files[0],
          { path: 'extra.php', size: 1, sha256: sha('x') },
        ] as ManifestEntry[],
      });
    }).toThrow(
      'artifact does not match manifest.json: missing app/0.1.0-3736c2a/migrations/0001_a.php; unexpected app/0.1.0-3736c2a/extra.php',
    );
  });

  it('rejects unexpected files', () => {
    expect(() => {
      verifyManifest(manifest, {
        web: [...files, { path: 'extra.txt', size: 1, sha256: sha('x') }],
        app: app.files,
      });
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
    expect(
      isSameManifest(manifest, {
        ...manifest,
        app: { ...manifest.app, schemaVersion: 5 },
      }),
    ).toBe(false);
    expect(
      isSameManifest(manifest, {
        ...manifest,
        app: { ...manifest.app, files: manifest.app.files.slice(1) },
      }),
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

  it('names the shell files that are activated last', () => {
    for (const path of ['index.html', 'sw.js', 'manifest.webmanifest']) {
      expect(isShellFile(path), path).toBe(true);
    }
    for (const path of ['api/index.php', 'favicon.svg', 'x/index.html']) {
      expect(isShellFile(path), path).toBe(false);
    }
  });
});
