import type {
  Account,
  AuditEvent,
  Drink,
  Entry,
  Factor,
  Game,
  Health,
  Outcome,
  Person,
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

/** A game with the run its ranking is in, which the API keeps to itself. */
export interface FixtureGame extends Game {
  run: number;
}

/** A match as the database keeps it: in its game's run, a side `null` once its person is deleted. */
export interface FixtureMatch {
  id: string;
  gameId: number;
  run: number;
  firstPersonId: number | null;
  secondPersonId: number | null;
  outcome: Outcome;
  accountId: number | null;
  createdAt: string;
}

/** A points-game result as the database keeps it, in its game's run. */
export interface FixtureResult {
  id: string;
  gameId: number;
  run: number;
  personId: number;
  points: number;
  accountId: number | null;
  createdAt: string;
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
  games: FixtureGame[];
  matches: FixtureMatch[];
  results: FixtureResult[];
  /**
  The fingerprint and instant of every entry, match and result id ever put, so
  a replay never recreates an undone one and answers its original instant; like
  the API's retry keys, an id is unique across all three.
  */
  idempotencyKeys: Map<string, { fingerprint: string; createdAt: string }>;
  /** The audit log, oldest first, as the API answers its events. */
  audit: AuditEvent[];
}

type AuditSnapshot = NonNullable<AuditEvent['after']>;

/** An entry as the audit log records it, its person, drink and factor resolved as they are now. */
export function entrySnapshot(
  {
    persons,
    drinks,
    factors,
  }: Pick<Fixtures, 'persons' | 'drinks' | 'factors'>,
  entry: Entry,
): AuditSnapshot {
  const drink = drinks.find(({ id }) => id === entry.drinkId);
  const factor = factors.find(({ id }) => id === entry.factorId);
  return {
    person: persons.find(({ id }) => id === entry.personId)?.name ?? '',
    drink: drink?.name ?? '',
    points: drink?.points ?? 0,
    quantity: entry.quantity,
    factor: factor
      ? { name: factor.name, multiplier: factor.multiplier }
      : null,
  };
}

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

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
/** An account that was deleted since: its entries stay without it, its events still name it. */
const FORMER_ACCOUNT = { accountId: 5, userName: 'jonas' };

/**
Games beside the drinks: name, kind, `drawsAllowed`, `lowerWins` and the days
since their run started — a chess ladder over two months, table tennis without
draws over three weeks, and tonight's Rommé, where the lowest sum wins.
*/
const GAMES: [string, Game['kind'], boolean, boolean, number][] = [
  ['Rommé', 'points', true, true, 0],
  ['Schach', 'duel', true, false, 62],
  ['Tischtennis', 'duel', false, false, 21],
];
/**
Schach and Tischtennis: game, first, second (`null`: a person deleted since),
outcome, days ago and the recording account (`null`: deleted since).
*/
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
/** Tonight's Rommé, two rounds so far: person, penalty points (going out first gives −20) and account. */
const RESULTS: [string, number, string][] = [
  ['Anna', 35, 'anna'],
  ['Ben', 12, 'anna'],
  ['Daniel', -20, 'anna'],
  ['Mara', 48, 'anna'],
  ['Anna', -20, 'ben'],
  ['Ben', 27, 'ben'],
  ['Daniel', 9, 'ben'],
  ['Mara', 31, 'ben'],
];

/** The games with their matches (evenings at 21:00) and tonight's results, spread between midnight and now. */
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
      run: 1,
      startedAt: new Date(midnight - daysAgo * DAY).toISOString(),
    }),
  );
  const gameOf = (name: string) =>
    games.find((game) => game.name === name)?.id ?? 0;
  const personOf = (name: string | null) =>
    persons.find((person) => person.name === name)?.id ?? null;
  const accountOf = (userName: string | null) =>
    accounts.find(({ account }) => account.userName === userName)?.account.id ??
    null;
  const matches = MATCHES.map(
    ([game, first, second, outcome, daysAgo, account], index) => ({
      id: `00000000-0000-4000-a000-${String(index + 1).padStart(12, '0')}`,
      gameId: gameOf(game),
      run: 1,
      firstPersonId: personOf(first),
      secondPersonId: personOf(second),
      outcome,
      accountId: accountOf(account),
      createdAt: new Date(midnight - daysAgo * DAY + 21 * HOUR).toISOString(),
    }),
  );
  const span = now.getTime() - midnight;
  const results = RESULTS.map(([person, points, account], index) => ({
    id: `00000000-0000-4000-b000-${String(index + 1).padStart(12, '0')}`,
    gameId: gameOf('Rommé'),
    run: 1,
    personId: personOf(person) ?? 0,
    points,
    accountId: accountOf(account),
    createdAt: new Date(
      midnight + Math.floor((span * (index + 1)) / (RESULTS.length + 1)),
    ).toISOString(),
  }));
  return { games, matches, results };
}

/**
Tonight so far: person, drink, quantity, factor and the logging account — in the
order they were logged. One account was deleted since (`jonas`).
*/
const LOG: [string, string, number, string | null, string][] = [
  ['Anna', 'Wein', 1, null, 'anna'],
  ['Daniel', 'Bier', 2, null, 'ben'],
  ['Mara', 'Aperol', 2, null, 'mara'],
  ['Ben', 'Bier', 1, null, 'ben'],
  ['Anna', 'Bier', 3, null, 'anna'],
  ['Daniel', 'Margarita', 1, null, 'daniel'],
  ['Tom', 'Radler', 1, null, 'mara'],
  ['Daniel', 'Schnaps', 2, 'Geburtstag', 'jonas'],
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
  const accountOf = (userName: string) =>
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

/** A deletion as the events it brings about name it, like the API: by its id, kind and the name it recorded. */
export function causeOf(deletion: AuditEvent): AuditEvent['cause'] {
  return {
    id: deletion.id,
    subjectKind: deletion.subjectKind,
    name: deletion.before?.name ?? '',
  };
}

const sekt = (person: string, quantity: number): AuditSnapshot => ({
  person,
  drink: 'Sekt',
  points: 2,
  quantity,
  factor: null,
});
const schnaps: AuditSnapshot = {
  person: 'Tom',
  drink: 'Schnaps',
  points: 1.5,
  quantity: 3,
  factor: null,
};

/**
The log before tonight: days ago, time, account, operation, subject and its values
before and after. `caused` marks what the deletion before it did to an entry: the
deleted account `jonas` deleted the drink Sekt, and with it two entries.
*/
const EARLIER: {
  daysAgo: number;
  at: [hours: number, minutes: number];
  by: string;
  operation: AuditEvent['operation'];
  subject: [AuditEvent['subjectKind'], string];
  before: AuditSnapshot | null;
  after: AuditSnapshot | null;
  caused?: true;
}[] = [
  {
    daysAgo: 9,
    at: [18, 52],
    by: 'anna',
    operation: 'create',
    subject: ['person', '1'],
    before: null,
    after: { name: 'Anna' },
  },
  {
    daysAgo: 9,
    at: [18, 52],
    by: 'anna',
    operation: 'create',
    subject: ['person', '3'],
    before: null,
    after: { name: 'Daniel' },
  },
  {
    daysAgo: 9,
    at: [18, 54],
    by: 'anna',
    operation: 'create',
    subject: ['drink', '2'],
    before: null,
    after: { name: 'Bier', points: 1 },
  },
  {
    daysAgo: 9,
    at: [18, 55],
    by: 'anna',
    operation: 'create',
    subject: ['drink', '6'],
    before: null,
    after: { name: 'Wein', points: 2 },
  },
  {
    daysAgo: 9,
    at: [18, 57],
    by: 'anna',
    operation: 'create',
    subject: ['drink', '7'],
    before: null,
    after: { name: 'Sekt', points: 2 },
  },
  {
    daysAgo: 9,
    at: [19, 10],
    by: 'anna',
    operation: 'create',
    subject: ['factor', '2'],
    before: null,
    after: { name: 'Happy Hour', multiplier: 2 },
  },
  {
    daysAgo: 2,
    at: [20, 14],
    by: 'ben',
    operation: 'create',
    subject: ['drink', '4'],
    before: null,
    after: { name: 'Radler', points: 1 },
  },
  {
    daysAgo: 2,
    at: [21, 30],
    by: 'mara',
    operation: 'update',
    subject: ['drink', '4'],
    before: { name: 'Radler', points: 1 },
    after: { name: 'Radler', points: 0.5 },
  },
  {
    daysAgo: 2,
    at: [21, 41],
    by: 'jonas',
    operation: 'create',
    subject: ['entry', earlierEntry(1)],
    before: null,
    after: sekt('Jule', 4),
  },
  {
    daysAgo: 2,
    at: [22, 3],
    by: 'mara',
    operation: 'create',
    subject: ['entry', earlierEntry(2)],
    before: null,
    after: sekt('Mara', 1),
  },
  {
    daysAgo: 1,
    at: [22, 5],
    by: 'daniel',
    operation: 'create',
    subject: ['entry', earlierEntry(3)],
    before: null,
    after: schnaps,
  },
  {
    daysAgo: 1,
    at: [22, 6],
    by: 'daniel',
    operation: 'delete',
    subject: ['entry', earlierEntry(3)],
    before: schnaps,
    after: null,
  },
  {
    daysAgo: 1,
    at: [23, 40],
    by: 'jonas',
    operation: 'delete',
    subject: ['drink', '7'],
    before: { name: 'Sekt', points: 2 },
    after: null,
  },
  {
    daysAgo: 1,
    at: [23, 40],
    by: 'jonas',
    operation: 'delete',
    subject: ['entry', earlierEntry(1)],
    before: sekt('Jule', 4),
    after: null,
    caused: true,
  },
  {
    daysAgo: 1,
    at: [23, 40],
    by: 'jonas',
    operation: 'delete',
    subject: ['entry', earlierEntry(2)],
    before: sekt('Mara', 1),
    after: null,
    caused: true,
  },
  {
    daysAgo: 1,
    at: [23, 55],
    by: 'anna',
    operation: 'update',
    subject: ['factor', '1'],
    before: { name: 'Geburtstag', multiplier: 2 },
    after: { name: 'Geburtstag', multiplier: 1.5 },
  },
];

function earlierEntry(index: number): string {
  return `00000000-0000-4000-9000-${String(index).padStart(12, '0')}`;
}

/**
The sample log: the days before, then tonight's entries as they were counted —
so it reaches back over several days, holds a cascade, and names an account that
no longer exists.
*/
function sampleAudit(
  now: Date,
  fixtures: Pick<Fixtures, 'persons' | 'drinks' | 'factors' | 'accounts'>,
  entries: FixtureEntry[],
): AuditEvent[] {
  const midnight = startOfToday(now).getTime();
  /** An account as the events name it; one that is gone is the former account. */
  const actorOf = (match: (account: Account) => boolean) => {
    const account = fixtures.accounts.find(({ account }) => match(account));
    return account
      ? { accountId: account.account.id, userName: account.account.userName }
      : FORMER_ACCOUNT;
  };
  const events: AuditEvent[] = [];
  let cause: AuditEvent | undefined;
  for (const event of EARLIER) {
    const [subjectKind, subjectId] = event.subject;
    const [hours, minutes] = event.at;
    const recorded: AuditEvent = {
      id: events.length + 1,
      occurredAt: new Date(
        midnight - event.daysAgo * DAY + hours * HOUR + minutes * MINUTE,
      ).toISOString(),
      operation: event.operation,
      subjectKind,
      subjectId,
      actor: actorOf(({ userName }) => userName === event.by),
      before: event.before,
      after: event.after,
      cause: event.caused && cause ? causeOf(cause) : null,
    };
    if (!event.caused) cause = recorded;
    events.push(recorded);
  }
  for (const entry of entries) {
    events.push({
      id: events.length + 1,
      occurredAt: entry.createdAt,
      operation: 'create',
      subjectKind: 'entry',
      subjectId: entry.id,
      actor: actorOf(({ id }) => id === entry.accountId),
      before: null,
      after: entrySnapshot(fixtures, entry),
      cause: null,
    });
  }
  return events;
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
  const audit = sampleAudit(
    now,
    { persons, drinks, factors, accounts },
    entries,
  );
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
    idempotencyKeys: new Map(),
    audit,
  };
}
