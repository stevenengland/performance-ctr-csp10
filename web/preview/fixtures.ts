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
import beer from './photos/sample-beer.jpg';
import hills from './photos/sample-hills.jpg';
import sunset from './photos/sample-sunset.jpg';

/** An account of the sample data, with the password the preview accepts for it. */
export interface FixtureAccount {
  account: Account;
  password: string;
}

/** An entry with the account that logged it (`null` once that account is deleted), as the database keeps it. */
export interface FixtureEntry extends Entry {
  accountId: number | null;
  /** Whether it waits for verification by another account (PRD #61). */
  pending: boolean;
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
  /** Whether it waits for verification by another account (PRD #61). */
  pending: boolean;
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
  /** Whether it waits for verification by another account (PRD #61). */
  pending: boolean;
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
  entry: Entry & { pending: boolean },
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
    pending: entry.pending,
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

/**
The sample persons; three with an illustrated sample photo (no real people), bundled
as hashed assets in place of the API's versioned URL, the rest show their initials.
*/
const PERSONS: [string, string | null][] = [
  ['Anna', sunset],
  ['Ben', null],
  ['Daniel', beer],
  ['Jule', null],
  ['Mara', hills],
  ['Tom', null],
];
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
Games beside the drinks: name, kind, `drawsAllowed`, `lowerWins` and the days ago
each run started, oldest first (the last is the current run's start) — a chess
ladder over two months, restarted once before it, table tennis without draws over
three weeks, and Rommé, where the lowest sum wins, restarted twice before
tonight's run. A match or result belongs to the run that had started by its day.
*/
const GAMES: [string, Game['kind'], boolean, boolean, number[]][] = [
  ['Rommé', 'points', true, true, [20, 9, 0]],
  ['Schach', 'duel', true, false, [80, 62]],
  ['Tischtennis', 'duel', false, false, [21]],
];
/**
Schach and Tischtennis: game, first, second (`null`: a person deleted since),
outcome, days ago, the recording account (`null`: deleted since) and whether the
match still waits for verification. The last four, Schach's oldest, are of its
earlier run, which Tom led. Last night's Tischtennis match, which `mara`
recorded, waits: Jule and Tom each get `+1 offen` beside their verified matches,
and it is in Offen as a row of an earlier day.
*/
const MATCHES: [
  string,
  string | null,
  string | null,
  Outcome,
  number,
  string | null,
  boolean?,
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
  ['Tischtennis', 'Jule', 'Tom', 'second', 1, 'mara', true],
  ['Schach', 'Tom', 'Anna', 'first', 78, 'mara'],
  ['Schach', 'Tom', 'Ben', 'first', 74, 'ben'],
  ['Schach', 'Tom', 'Daniel', 'first', 70, 'daniel'],
  ['Schach', 'Daniel', 'Tom', 'second', 66, 'daniel'],
];
/**
Tonight's Rommé, two rounds so far and the third begun: person, penalty points
(going out first gives −20), account and whether the result still waits for
verification. Daniel's 14 (ben) waits beside his counted results, `+1 offen`, and
is in Offen; Jule's only result, a 0 (anna), waits, so she is listed without a
rank instead of leading the lowest-wins ladder.
*/
const RESULTS: [string, number, string, boolean?][] = [
  ['Anna', 35, 'anna'],
  ['Ben', 12, 'anna'],
  ['Daniel', -20, 'anna'],
  ['Mara', 48, 'anna'],
  ['Anna', -20, 'ben'],
  ['Ben', 27, 'ben'],
  ['Daniel', 9, 'ben'],
  ['Mara', 31, 'ben'],
  ['Daniel', 14, 'ben', true],
  ['Jule', 0, 'anna', true],
];

/**
Rommé's earlier evenings, every result verified: days ago, then person and points
in the order recorded (from 20:00, ten minutes apart). Tom, who is not at tonight's
table, has the lowest sum of all time with the fewest results.
*/
const EARLIER_RESULTS: [number, [string, number][]][] = [
  [
    20,
    [
      ['Anna', 25],
      ['Ben', 18],
      ['Daniel', 31],
      ['Mara', 40],
    ],
  ],
  [
    13,
    [
      ['Ben', 22],
      ['Daniel', 15],
      ['Mara', 35],
      ['Tom', 10],
    ],
  ],
  [
    9,
    [
      ['Anna', 12],
      ['Daniel', 28],
      ['Tom', 8],
      ['Mara', 30],
    ],
  ],
  [
    6,
    [
      ['Anna', 19],
      ['Ben', 24],
      ['Tom', 14],
    ],
  ],
  [
    2,
    [
      ['Ben', 9],
      ['Daniel', 21],
      ['Mara', 26],
      ['Tom', -20],
    ],
  ],
];

/**
The games with their matches (evenings at 21:00), Rommé's earlier evenings and
tonight's results, spread between midnight and now.
*/
function sampleGames(
  now: Date,
  persons: Person[],
  accounts: FixtureAccount[],
): Pick<Fixtures, 'games' | 'matches' | 'results'> {
  const midnight = startOfToday(now).getTime();
  const games = GAMES.map(
    ([name, kind, drawsAllowed, lowerWins, starts], index) => ({
      id: index + 1,
      name,
      kind,
      drawsAllowed,
      lowerWins,
      run: starts.length,
      startedAt: new Date(midnight - (starts.at(-1) ?? 0) * DAY).toISOString(),
    }),
  );
  const gameOf = (name: string) =>
    games.find((game) => game.name === name)?.id ?? 0;
  /** The run of the game that had started by the day `daysAgo`. */
  const runOf = (name: string, daysAgo: number) =>
    GAMES.find((game) => game[0] === name)?.[4].filter(
      (start) => start >= daysAgo,
    ).length ?? 1;
  const personOf = (name: string | null) =>
    persons.find((person) => person.name === name)?.id ?? null;
  const accountOf = (userName: string | null) =>
    accounts.find(({ account }) => account.userName === userName)?.account.id ??
    null;
  const matches = MATCHES.map(
    (
      [game, first, second, outcome, daysAgo, account, pending = false],
      index,
    ) => ({
      id: `00000000-0000-4000-a000-${String(index + 1).padStart(12, '0')}`,
      gameId: gameOf(game),
      run: runOf(game, daysAgo),
      firstPersonId: personOf(first),
      secondPersonId: personOf(second),
      outcome,
      accountId: accountOf(account),
      createdAt: new Date(midnight - daysAgo * DAY + 21 * HOUR).toISOString(),
      pending,
    }),
  );
  const earlier = EARLIER_RESULTS.flatMap(([daysAgo, played]) =>
    played.map(([person, points], round) => ({
      person,
      points,
      account: round % 2 === 0 ? 'anna' : 'ben',
      daysAgo,
      createdAt: new Date(
        midnight - daysAgo * DAY + 20 * HOUR + round * 10 * MINUTE,
      ).toISOString(),
    })),
  ).map(({ person, points, account, daysAgo, createdAt }, index) => ({
    id: `00000000-0000-4000-b100-${String(index + 1).padStart(12, '0')}`,
    gameId: gameOf('Rommé'),
    run: runOf('Rommé', daysAgo),
    personId: personOf(person) ?? 0,
    points,
    accountId: accountOf(account),
    createdAt,
    pending: false,
  }));
  const span = now.getTime() - midnight;
  const tonight = RESULTS.map(([person, points, account, pending], index) => ({
    id: `00000000-0000-4000-b000-${String(index + 1).padStart(12, '0')}`,
    gameId: gameOf('Rommé'),
    run: runOf('Rommé', 0),
    personId: personOf(person) ?? 0,
    points,
    accountId: accountOf(account),
    createdAt: new Date(
      midnight + Math.floor((span * (index + 1)) / (RESULTS.length + 1)),
    ).toISOString(),
    pending: pending ?? false,
  }));
  const results = [...tonight, ...earlier];
  return { games, matches, results };
}

/**
Tonight so far: person, drink, quantity, factor, the logging account and whether
the entry still waits for verification — in the order they were logged. One
account was deleted since (`jonas`). The last three wait: one of Mara's, and
Jule's only ones, so she is listed without a rank.
*/
const LOG: [string, string, number, string | null, string, boolean?][] = [
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
  ['Mara', 'Wein', 1, null, 'anna', true],
  ['Jule', 'Aperol', 1, null, 'mara', true],
  ['Jule', 'Bier', 2, null, 'ben', true],
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
  return LOG.map(
    ([person, drink, quantity, factor, account, pending], index) => ({
      id: `00000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`,
      personId: idOf(persons, person),
      drinkId: idOf(drinks, drink),
      quantity,
      factorId: factor === null ? null : idOf(factors, factor),
      accountId: accountOf(account),
      createdAt: new Date(
        midnight + Math.floor((span * (index + 1)) / (LOG.length + 1)),
      ).toISOString(),
      pending: pending ?? false,
    }),
  );
}

/**
Earlier evenings, from 19:00 every 25 minutes: days ago, then each entry like
tonight's log. Yesterday is ranked; two days ago nothing is left (the Sekt of that
evening went with the drink, see the audit log); three days ago every entry still
waits, so nobody leads; and older evenings fill the all-time ranking. Their pending
entries were logged by `anna`, so they are not in her `Offen`. The audit log does
not repeat them.
*/
const EVENINGS: [
  number,
  [string, string, number, string | null, string, boolean?][],
][] = [
  [
    1,
    [
      ['Ben', 'Bier', 3, null, 'ben'],
      ['Anna', 'Wein', 2, null, 'anna'],
      ['Tom', 'Bier', 2, null, 'mara'],
      ['Mara', 'Aperol', 1, null, 'mara'],
      ['Daniel', 'Bier', 1, null, 'daniel'],
      ['Tom', 'Radler', 2, null, 'ben'],
      ['Anna', 'Aperol', 1, null, 'anna', true],
    ],
  ],
  [
    3,
    [
      ['Jule', 'Bier', 2, null, 'anna', true],
      ['Ben', 'Wein', 1, null, 'anna', true],
    ],
  ],
  [
    4,
    [
      ['Daniel', 'Margarita', 2, null, 'daniel'],
      ['Tom', 'Wein', 3, null, 'mara'],
      ['Daniel', 'Schnaps', 2, 'Geburtstag', 'ben'],
      ['Tom', 'Bier', 1, null, 'mara'],
    ],
  ],
  [
    7,
    [
      ['Mara', 'Bier', 4, null, 'mara'],
      ['Anna', 'Bier', 2, null, 'anna'],
      ['Jule', 'Aperol', 2, null, 'ben'],
    ],
  ],
  [
    9,
    [
      ['Daniel', 'Bier', 3, null, 'anna'],
      ['Ben', 'Schnaps', 2, null, 'jonas'],
    ],
  ],
];

/** The earlier evenings' entries, each evening on its local calendar day before today. */
function earlierEntries(
  now: Date,
  persons: Person[],
  drinks: Drink[],
  factors: Factor[],
  accounts: FixtureAccount[],
): FixtureEntry[] {
  const idOf = (list: { id: number; name: string }[], name: string) =>
    list.find((item) => item.name === name)?.id ?? 0;
  const accountOf = (userName: string) =>
    accounts.find(({ account }) => account.userName === userName)?.account.id ??
    null;
  return EVENINGS.flatMap(([daysAgo, log]) =>
    log.map(([person, drink, quantity, factor, account, pending], index) => ({
      personId: idOf(persons, person),
      drinkId: idOf(drinks, drink),
      quantity,
      factorId: factor === null ? null : idOf(factors, factor),
      accountId: accountOf(account),
      createdAt: new Date(
        now.getFullYear(),
        now.getMonth(),
        now.getDate() - daysAgo,
        19,
        25 * index,
      ).toISOString(),
      pending: pending ?? false,
    })),
  ).map((entry, index) => ({
    id: `00000000-0000-4000-8001-${String(index + 1).padStart(12, '0')}`,
    ...entry,
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
    at: [19, 2],
    by: 'anna',
    operation: 'update',
    subject: ['person', '1'],
    before: { name: 'Anna', photo: null },
    after: { name: 'Anna', photo: sunset },
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
The sample log: the days before and every entry as it was counted, oldest first —
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
  /** An event before it has its place in the log. */
  type Draft = Omit<AuditEvent, 'id' | 'cause'>;
  const drafts: Draft[] = [];
  /** What each event of a cascade was caused by. */
  const causes = new Map<Draft, Draft>();
  let cause: Draft | undefined;
  for (const event of EARLIER) {
    const [subjectKind, subjectId] = event.subject;
    const [hours, minutes] = event.at;
    const draft: Draft = {
      occurredAt: new Date(
        midnight - event.daysAgo * DAY + hours * HOUR + minutes * MINUTE,
      ).toISOString(),
      operation: event.operation,
      subjectKind,
      subjectId,
      actor: actorOf(({ userName }) => userName === event.by),
      before: event.before,
      after: event.after,
    };
    if (!event.caused) cause = draft;
    else if (cause) causes.set(draft, cause);
    drafts.push(draft);
  }
  for (const entry of entries) {
    drafts.push({
      occurredAt: entry.createdAt,
      operation: 'create',
      subjectKind: 'entry',
      subjectId: entry.id,
      actor: actorOf(({ id }) => id === entry.accountId),
      before: null,
      after: entrySnapshot(fixtures, entry),
    });
  }
  // Oldest first; a cascade keeps its order, as it shares its instant.
  drafts.sort((a, b) => a.occurredAt.localeCompare(b.occurredAt));
  const events = drafts.map((draft, index): AuditEvent => ({
    ...draft,
    id: index + 1,
    cause: null,
  }));
  for (const [draft, deletion] of causes) {
    const event = events[drafts.indexOf(draft)];
    const caused = events[drafts.indexOf(deletion)];
    if (event && caused) event.cause = causeOf(caused);
  }
  return events;
}

/** The sample evening the preview shows (marked as sample data in the preview menu). */
export function sampleEvening(now: Date = new Date()): Fixtures {
  const persons = PERSONS.map(([name, photoUrl], index) => ({
    id: index + 1,
    name,
    photoUrl,
  }));
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
  const entries = [
    ...earlierEntries(now, persons, drinks, factors, accounts),
    ...sampleEntries(now, persons, drinks, factors, accounts),
  ];
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
