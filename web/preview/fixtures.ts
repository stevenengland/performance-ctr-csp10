import type {
  Account,
  Drink,
  Entry,
  Health,
  Person,
} from '../src/core/api-client';
import { startOfToday } from '../src/core/day-window';

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
  persons: Person[];
  drinks: Drink[];
  entries: Entry[];
  /** Fingerprints of every entry id ever put, so a replay never recreates an undone entry. */
  entryRequests: Map<string, string>;
}

/** Every sample account signs in with this password in the preview. */
export const SAMPLE_PASSWORD = 'beispiel-passwort';

function sample(id: number, userName: string, isAdmin = false): FixtureAccount {
  return { account: { id, userName, isAdmin }, password: SAMPLE_PASSWORD };
}

const PERSONS = ['Anna', 'Ben', 'Daniel', 'Jule', 'Mara', 'Tom'];
const DRINKS: [string, number][] = [
  ['Aperol', 2],
  ['Bier', 1],
  ['Margarita', 3],
  ['Radler', 0.5],
  ['Schnaps', 1.5],
  ['Wein', 2],
];
/** Tonight so far: person, drink, quantity — in the order they were logged. */
const LOG: [string, string, number][] = [
  ['Anna', 'Wein', 1],
  ['Daniel', 'Bier', 2],
  ['Mara', 'Aperol', 2],
  ['Ben', 'Bier', 1],
  ['Anna', 'Bier', 3],
  ['Daniel', 'Margarita', 1],
  ['Tom', 'Radler', 1],
  ['Daniel', 'Schnaps', 2],
  ['Ben', 'Bier', 2],
  ['Mara', 'Bier', 2],
  ['Anna', 'Wein', 2],
  ['Daniel', 'Aperol', 1],
  ['Daniel', 'Bier', 2],
];

/**
The evening's entries, spread between local midnight and now, so the preview never
ages out of "today" whenever it is opened.
*/
function sampleEntries(now: Date, persons: Person[], drinks: Drink[]): Entry[] {
  const midnight = startOfToday(now).getTime();
  const span = now.getTime() - midnight;
  const idOf = (list: { id: number; name: string }[], name: string) =>
    list.find((item) => item.name === name)?.id ?? 0;
  return LOG.map(([person, drink, quantity], index) => ({
    id: `00000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`,
    personId: idOf(persons, person),
    drinkId: idOf(drinks, drink),
    quantity,
    createdAt: new Date(
      midnight + Math.floor((span * (index + 1)) / (LOG.length + 1)),
    ).toISOString(),
  }));
}

/** The sample evening the preview shows (marked as sample data in the preview menu). */
export function sampleEvening(now: Date = new Date()): Fixtures {
  const persons = PERSONS.map((name, index) => ({ id: index + 1, name }));
  const drinks = DRINKS.map(([name, points], index) => ({
    id: index + 1,
    name,
    points,
  }));
  const entries = sampleEntries(now, persons, drinks);
  return {
    health: {
      appVersion: `${__APP_VERSION__} (Vorschau)`,
      phpVersion: '8.3.0',
      database: { engine: 'MySQL', version: '8.4.0' },
      schemaVersion: 9,
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
    persons,
    drinks,
    entries,
    entryRequests: new Map(),
  };
}
