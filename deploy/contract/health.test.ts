import { describe, expect, it } from 'vitest';
import { healthProblem, healthUrl, parseHealth } from './health.ts';

const report = {
  appVersion: '0.1.0+3736c2a',
  phpVersion: '8.5.12',
  database: { engine: 'MariaDB', version: '11.8.8' },
  schemaVersion: 4,
  migration: 'ok',
  minClientVersion: '0.1.0',
};

describe('parseHealth', () => {
  it('reads every field health reports', () => {
    expect(parseHealth(JSON.stringify(report))).toEqual(report);
  });

  it.each([
    ['appVersion', { ...report, appVersion: '' }],
    ['phpVersion', { ...report, phpVersion: 8 }],
    ['database', { ...report, database: 'MariaDB' }],
    ['database', { ...report, database: { engine: 'MariaDB' } }],
    ['schemaVersion', { ...report, schemaVersion: '4' }],
    ['migration', { ...report, migration: 'done' }],
    ['minClientVersion', { ...report, minClientVersion: undefined }],
  ])('rejects a report without a valid %s', (field, value) => {
    expect(() => parseHealth(JSON.stringify(value))).toThrow(
      `health response is malformed: ${field}`,
    );
  });

  it('rejects a body that is not JSON', () => {
    expect(() => parseHealth('<html>')).toThrow(
      'health response is malformed: not JSON',
    );
  });
});

describe('healthProblem', () => {
  const expected = { appVersion: '0.1.0+3736c2a', schemaVersion: 4 };
  const parsed = parseHealth(JSON.stringify(report));

  it('accepts the expected versions with migration ok', () => {
    expect(healthProblem(parsed, expected)).toBeUndefined();
  });

  it.each([
    [{ migration: 'failed' as const }, 'migration failed at schema version 4'],
    [
      { migration: 'running' as const },
      'migration running at schema version 4',
    ],
    [
      { appVersion: '0.0.9+aaaaaaa' },
      'app version 0.0.9+aaaaaaa, expected 0.1.0+3736c2a',
    ],
    [{ schemaVersion: 3 }, 'schema version 3, expected 4'],
  ])('names what differs in %j', (change, message) => {
    expect(healthProblem({ ...parsed, ...change }, expected)).toBe(message);
  });
});

describe('healthUrl', () => {
  it('is api/health below the site base', () => {
    expect(healthUrl({ origin: 'https://example.test', base: '/' })).toBe(
      'https://example.test/api/health',
    );
  });
});
