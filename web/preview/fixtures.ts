import type {
  Account,
  Drink,
  Entry,
  Factor,
  Game,
  Health,
  Match,
  Outcome,
  Person,
  Result,
} from '../src/core/api-client';
import { startOfToday } from '../src/core/day-window';

/** An account of the sample data, with the password the preview accepts for it. */
export interface FixtureAccount {
  account: Account;
  password: string;
}

/** An entry with the account that logged it (`null` once that account is deleted), as the database keeps it. */
export interface FixtureEntry extends Entry {
  accountId: number | null;
}

/** A match with the account that recorded it, as the database keeps it. */
export interface FixtureMatch extends Match {
  accountId: number | null;
}

/** A points-game result with the account that recorded it, as the database keeps it. */
export interface FixtureResult extends Result {
  accountId: number | null;
}

/** Canned answers of the fixture preview; typed against the generated API types. */
export interface Fixtures {
  health: Health;
  accounts: FixtureAccount[];
  /** The id of the signed-in account; the preview starts signed in as an admin (§12). */
  signedIn: number | null;
  persons: Person[];
  drinks: Drink[];
  factors: Factor[];
  entries: FixtureEntry[];
  games: Game[];
  matches: FixtureMatch[];
  results: FixtureResult[];
  /**
  Fingerprints of every client id ever put (entries, matches, results: the API's one
  idempotency store), so a replay never recreates an undone row.
  */
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
const FACTORS: [string, number][] = [
  ['Geburtstag', 1.5],
  ['Happy Hour', 2],
];
/**
Tonight so far: person, drink, quantity, factor and the logging account — in the
order they were logged. One account was deleted since (`null`).
*/
const LOG: [string, string, number, string | null, string | null][] = [
  ['Anna', 'Wein', 1, null, 'anna'],
  ['Daniel', 'Bier', 2, null, 'ben'],
  ['Mara', 'Aperol', 2, null, 'mara'],
  ['Ben', 'Bier', 1, null, 'ben'],
  ['Anna', 'Bier', 3, null, 'anna'],
  ['Daniel', 'Margarita', 1, null, 'daniel'],
  ['Tom', 'Radler', 1, null, 'mara'],
  ['Daniel', 'Schnaps', 2, 'Geburtstag', null],
  ['Ben', 'Bier', 2, 'Happy Hour', 'anna'],
  ['Mara', 'Bier', 2, null, 'mara'],
  ['Anna', 'Wein', 2, null, 'ben'],
  ['Daniel', 'Aperol', 1, null, 'anna'],
  ['Daniel', 'Bier', 2, null, 'anna'],
];

/**
The evening's entries, spread between local midnight and now, so the preview never
ages out of "today" whenever it is opened.
*/
function sampleEntries(
  now: Date,
  persons: Person[],
  drinks: Drink[],
  factors: Factor[],
  accounts: FixtureAccount[],
): FixtureEntry[] {
  const midnight = startOfToday(now).getTime();
  const span = now.getTime() - midnight;
  const idOf = (list: { id: number; name: string }[], name: string) =>
    list.find((item) => item.name === name)?.id ?? 0;
  const accountOf = (userName: string | null) =>
    accounts.find(({ account }) => account.userName === userName)?.account.id ??
    null;
  return LOG.map(([person, drink, quantity, factor, account], index) => ({
    id: `00000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`,
    personId: idOf(persons, person),
    drinkId: idOf(drinks, drink),
    quantity,
    factorId: factor === null ? null : idOf(factors, factor),
    accountId: accountOf(account),
    createdAt: new Date(
      midnight + Math.floor((span * (index + 1)) / (LOG.length + 1)),
    ).toISOString(),
  }));
}

const DAY_MS = 86_400_000;

/**
Games beside the drinks: a chess ladder since about two months, table tennis since
three weeks (no draws), and tonight's Rommé, counted with penalty points (lowest
wins) and restarted at the start of the evening.
*/
const GAMES: [string, Game['kind'], boolean, boolean, number][] = [
  ['Rommé', 'points', false, true, 0],
  ['Schach', 'duel', true, false, 62],
  ['Tischtennis', 'duel', false, false, 21],
];
/** Schach and Tischtennis: first, second (null: a person deleted since), outcome, days ago, account. */
const MATCHES: [
  string,
  string | null,
  string | null,
  Outcome,
  number,
  string | null,
][] = [
  ['Schach', 'Anna', 'Ben', 'first', 58, 'anna'],
  ['Schach', null, 'Ben', 'second', 51, 'ben'],
  ['Schach', 'Daniel', 'Tom', 'draw', 44, 'daniel'],
  ['Schach', 'Anna', 'Daniel', 'first', 37, 'anna'],
  ['Schach', 'Ben', 'Tom', 'first', 30, null],
  ['Schach', 'Tom', 'Anna', 'draw', 23, 'mara'],
  ['Schach', 'Daniel', 'Ben', 'second', 16, 'daniel'],
  ['Schach', 'Anna', 'Tom', 'first', 9, 'anna'],
  ['Schach', 'Ben', 'Anna', 'draw', 2, 'ben'],
  ['Tischtennis', 'Mara', 'Jule', 'first', 19, 'mara'],
  ['Tischtennis', 'Jule', 'Tom', 'first', 12, 'mara'],
  ['Tischtennis', 'Mara', 'Tom', 'second', 5, 'daniel'],
];
/** Tonight's Rommé, two rounds so far: person, points (penalty points; going out first gives −20). */
const RESULTS: [string, number, string | null][] = [
  ['Anna', 35, 'anna'],
  ['Ben', 12, 'anna'],
  ['Daniel', -20, 'anna'],
  ['Mara', 48, 'anna'],
  ['Anna', -20, 'ben'],
  ['Ben', 27, 'ben'],
  ['Daniel', 9, 'ben'],
  ['Mara', 31, 'ben'],
];

function sampleGames(
  now: Date,
  persons: Person[],
  accounts: FixtureAccount[],
): Pick<Fixtures, 'games' | 'matches' | 'results'> {
  const midnight = startOfToday(now).getTime();
  const games = GAMES.map(
    ([name, kind, drawsAllowed, lowerWins, daysAgo], index) => ({
      id: index + 1,
      name,
      kind,
      drawsAllowed,
      lowerWins,
      startedAt: new Date(midnight - daysAgo * DAY_MS).toISOString(),
    }),
  );
  const gameOf = (name: string) =>
    games.find((game) => game.name === name)?.id ?? 0;
  const personOf = (name: string | null) =>
    name === null
      ? null
      : (persons.find((person) => person.name === name)?.id ?? null);
  const accountOf = (userName: string | null) =>
    accounts.find(({ account }) => account.userName === userName)?.account.id ??
    null;
  const matches = MATCHES.map(
    ([game, first, second, outcome, daysAgo, account], index) => ({
      id: `00000000-0000-4000-9000-${String(index + 1).padStart(12, '0')}`,
      gameId: gameOf(game),
      firstPersonId: personOf(first),
      secondPersonId: personOf(second),
      outcome,
      accountId: accountOf(account),
      // Evenings at 21:00 local time.
      createdAt: new Date(
        midnight - daysAgo * DAY_MS + 21 * 3_600_000,
      ).toISOString(),
    }),
  );
  const span = now.getTime() - midnight;
  const results = RESULTS.map(([person, points, account], index) => ({
    id: `00000000-0000-4000-a000-${String(index + 1).padStart(12, '0')}`,
    gameId: gameOf('Rommé'),
    personId: personOf(person) ?? 0,
    points,
    accountId: accountOf(account),
    createdAt: new Date(
      midnight + Math.floor((span * (index + 1)) / (RESULTS.length + 1)),
    ).toISOString(),
  }));
  // Tonight's Rommé was restarted shortly before its first round.
  const romme = games.find((game) => game.name === 'Rommé');
  const firstRound = results[0]?.createdAt;
  if (romme && firstRound) {
    romme.startedAt = new Date(
      Math.max(midnight, Date.parse(firstRound) - 10 * 60_000),
    ).toISOString();
  }
  return { games, matches, results };
}

/** The sample evening the preview shows (marked as sample data in the preview menu). */
export function sampleEvening(now: Date = new Date()): Fixtures {
  const persons = PERSONS.map((name, index) => ({ id: index + 1, name }));
  const drinks = DRINKS.map(([name, points], index) => ({
    id: index + 1,
    name,
    points,
  }));
  const factors = FACTORS.map(([name, multiplier], index) => ({
    id: index + 1,
    name,
    multiplier,
  }));
  const accounts = [
    sample(1, 'anna', true),
    sample(2, 'ben'),
    sample(3, 'daniel'),
    sample(4, 'mara'),
  ];
  const entries = sampleEntries(now, persons, drinks, factors, accounts);
  return {
    health: {
      appVersion: `${__APP_VERSION__} (Vorschau)`,
      phpVersion: '8.5.12',
      database: { engine: 'MariaDB', version: '11.8.8' },
      schemaVersion: __SCHEMA_VERSION__,
      migration: 'ok',
      minClientVersion: __MIN_CLIENT_VERSION__,
    },
    accounts,
    signedIn: 1,
    persons,
    drinks,
    factors,
    entries,
    ...sampleGames(now, persons, accounts),
    entryRequests: new Map(),
  };
}
