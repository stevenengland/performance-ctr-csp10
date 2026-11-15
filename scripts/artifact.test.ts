import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  apiPointer,
  appFolder,
  meetsFloor,
  minClientVersion,
  releaseFolder,
  schemaVersion,
} from './artifact.ts';

const repo = (path: string) =>
  readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

describe('the artifact', () => {
  it('names the release folder after the version, build metadata joined by a dash', () => {
    expect(releaseFolder('0.1.0+3f2a1bc')).toBe('0.1.0-3f2a1bc');
    expect(() => releaseFolder('0.1.0+a b')).toThrow(/Unusable/);
    expect(() => releaseFolder('../0.1.0')).toThrow(/Unusable/);
  });

  it('points the web root’s API entry at exactly one release beside the web root', () => {
    expect(apiPointer('0.1.0-3f2a1bc')).toContain(
      "require dirname(__DIR__, 2) . '/app/0.1.0-3f2a1bc/public/index.php';",
    );
  });

  it('takes the schema version from the newest migration file', () => {
    expect(
      schemaVersion([
        '0001_create_schema_migrations.php',
        '0012_create_entries.php',
        'README.md',
      ]),
    ).toBe(12);
    expect(schemaVersion([])).toBe(0);
  });

  it('reads the API’s client floor from Compatibility.php', () => {
    expect(minClientVersion("public const MIN_CLIENT_VERSION = '0.2.0';")).toBe(
      '0.2.0',
    );
    expect(() => minClientVersion('<?php')).toThrow(/MIN_CLIENT_VERSION/);
  });

  it('compares MAJOR.MINOR.PATCH only against the floor', () => {
    expect(meetsFloor('0.2.0+3f2a1bc', '0.2.0')).toBe(true);
    expect(meetsFloor('0.10.0', '0.9.1')).toBe(true);
    expect(meetsFloor('0.1.9+3f2a1bc', '0.2.0')).toBe(false);
  });

  it('ships a web version that the API still serves, or every client would be told to reload forever', () => {
    const { version } = JSON.parse(repo('web/package.json')) as {
      version: string;
    };
    const floor = minClientVersion(repo('api/src/Http/Compatibility.php'));

    expect(meetsFloor(version, floor), `${version} < ${floor}`).toBe(true);
  });

  it('names the PHP release folder after its content, so a rebuild with other bytes never reuses an uploaded folder', () => {
    const autoload = { path: 'vendor/autoload.php', bytes: Buffer.from('a') };
    const files = [
      autoload,
      { path: 'public/index.php', bytes: Buffer.from('b') },
    ];
    const folder = appFolder('0.1.0-3f2a1bc', files);

    expect(folder).toMatch(/^0\.1\.0-3f2a1bc-[0-9a-f]{12}$/);
    expect(appFolder('0.1.0-3f2a1bc', [...files].reverse())).toBe(folder);
    expect(
      appFolder('0.1.0-3f2a1bc', [
        autoload,
        { path: 'public/index.php', bytes: Buffer.from('c') },
      ]),
    ).not.toBe(folder);
    expect(
      appFolder('0.1.0-3f2a1bc', [
        {
          path: 'vendor/autoload.phppublic/index.php',
          bytes: Buffer.from('ab'),
        },
      ]),
    ).not.toBe(folder);
  });
});
