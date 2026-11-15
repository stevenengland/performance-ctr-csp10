import { describe, expect, it } from 'vitest';
import { apiPointer, releaseFolder, schemaVersion } from './artifact.ts';

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
});
