import type { Account, Health } from '../src/core/api-client';

/** An account of the sample data, with the password the preview accepts for it. */
export interface FixtureAccount {
  account: Account;
  password: string;
}

/** Canned answers of the fixture preview; typed against the generated API types. */
export interface Fixtures {
  health: Health;
  accounts: FixtureAccount[];
  /** The id of the signed-in account; the preview starts signed in as an admin (§12). */
  signedIn: number | null;
}

/** Every sample account signs in with this password in the preview. */
export const SAMPLE_PASSWORD = 'beispiel-passwort';

function sample(id: number, userName: string, isAdmin = false): FixtureAccount {
  return { account: { id, userName, isAdmin }, password: SAMPLE_PASSWORD };
}

/** The sample evening the preview shows (marked as sample data in the preview menu). */
export function sampleEvening(): Fixtures {
  return {
    health: {
      appVersion: `${__APP_VERSION__} (Vorschau)`,
      phpVersion: '8.3.0',
      database: { engine: 'MySQL', version: '8.4.0' },
      schemaVersion: 8,
      migration: 'ok',
      minClientVersion: '0.1.0',
    },
    accounts: [
      sample(1, 'anna', true),
      sample(2, 'ben'),
      sample(3, 'daniel'),
      sample(4, 'mara'),
    ],
    signedIn: 1,
  };
}
