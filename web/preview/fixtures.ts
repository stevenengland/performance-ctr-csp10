import type { Health } from '../src/core/api-client';

/** Canned answers of the fixture preview; typed against the generated API types. */
export interface Fixtures {
  health: Health;
}

/** The sample evening the preview shows (marked as sample data in the preview menu). */
export function sampleEvening(): Fixtures {
  return {
    health: {
      appVersion: `${__APP_VERSION__} (Vorschau)`,
      phpVersion: '8.3.0',
      database: { engine: 'MySQL', version: '8.4.0' },
      schemaVersion: 1,
      migration: 'ok',
      minClientVersion: '0.1.0',
    },
  };
}
