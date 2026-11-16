import type {
  AuditEvent,
  Entry,
  Game,
  Match,
  MatchItem,
  HistoryEntry,
  ResultItem,
  ScoreRow,
  Scoreboard,
  Standings,
} from '../src/core/api-client';
import type { components } from '../src/core/api-client/schema';
import {
  causeOf,
  entrySnapshot,
  type FixtureAccount,
  type FixtureEntry,
  type FixtureGame,
  type FixtureMatch,
  type FixtureResult,
  type Fixtures,
} from './fixtures';

type Problem = components['schemas']['Problem'];
type AuditSnapshot = components['schemas']['AuditSnapshot'];
type Body = Record<string, unknown>;

/** What a route gets of its request. */
interface Request {
  body: Body;
  /** The path's `{id}`, for routes that have one. */
  id: string;
  query: URLSearchParams;
  headers: Headers;
}
type Handler = (request: Request) => Response;

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function problem(value: Problem): Response {
  return new Response(JSON.stringify(value), {
    status: value.status,
    headers: { 'Content-Type': 'application/problem+json' },
  });
}

const PROBLEMS = {
  maintenance: {
    type: 'urn:performance:problem:maintenance',
    title: 'Wird aktualisiert – gleich wieder da',
    status: 503,
  },
  unauthenticated: {
    type: 'urn:performance:problem:unauthenticated',
    title: 'Nicht angemeldet',
    status: 401,
  },
  invalidCredentials: {
    type: 'urn:performance:problem:invalid-credentials',
    title: 'Benutzername oder Passwort falsch.',
    status: 401,
  },
  forbidden: {
    type: 'urn:performance:problem:forbidden',
    title: 'Nur für Admins',
    status: 403,
  },
  duplicateUserName: {
    type: 'urn:performance:problem:duplicate-user-name',
    title: 'Benutzername ist bereits vergeben.',
    status: 409,
  },
  duplicateName: {
    type: 'urn:performance:problem:duplicate-name',
    title: 'Name ist bereits vergeben.',
    status: 409,
  },
  entryConflict: {
    type: 'urn:performance:problem:entry-conflict',
    title: 'Eintrag wurde schon mit anderem Inhalt gespeichert.',
    status: 409,
  },
  requestConflict: {
    type: 'urn:performance:problem:request-conflict',
    title: 'Wurde schon mit anderem Inhalt gespeichert.',
    status: 409,
  },
  lastAdmin: {
    type: 'urn:performance:problem:last-admin',
    title: 'Der letzte Admin kann nicht entfernt werden.',
    status: 409,
  },
  notFound: {
    type: 'urn:performance:problem:not-found',
    title: 'Nicht gefunden',
    status: 404,
  },
} satisfies Record<string, Problem>;

const MIN_PASSWORD = 10;
const MAX_PASSWORD_BYTES = 72;
const MAX_USER_NAME = 40;
const MAX_NAME = 40;
const MAX_POINTS = 9999.99;
const MAX_MULTIPLIER = 99.99;
const MAX_QUANTITY = 99;
/** Pages of the audit log and of a game's Verlauf, as the API reads them. */
const PAGE_SIZE = 20;
const MAX_PAGE_SIZE = 100;
/** A positive integer id in a query, as the API's routes accept it. */
const QUERY_ID = /^[1-9]\d{0,9}$/;
const PERSON_NOT_FOUND = 'Person nicht gefunden.';
const ENTRY_ID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

function validation(errors: Record<string, string>): Response {
  return problem({
    type: 'urn:performance:problem:validation',
    title: 'Bitte Eingaben prüfen',
    status: 422,
    errors,
  });
}

function text(body: Body, field: string): string {
  const value = body[field];
  return typeof value === 'string' ? value : '';
}

function integer(body: Body, field: string): number | undefined {
  const value = body[field];
  return Number.isInteger(value) ? (value as number) : undefined;
}

const sameName = (a: string, b: string) =>
  a.localeCompare(b, 'de', { sensitivity: 'accent' }) === 0;
const byName = (a: { name: string }, b: { name: string }) =>
  a.name.localeCompare(b.name, 'de', { sensitivity: 'base' });

function nameError(name: string): string | undefined {
  const length = [...name].length;
  return length < 1 || length > MAX_NAME
    ? `1 bis ${String(MAX_NAME)} Zeichen.`
    : undefined;
}

/** A number up to `max` with at most two decimals. */
function isDecimal(value: unknown, max: number): value is number {
  return (
    typeof value === 'number' &&
    value >= 0 &&
    value <= max &&
    Math.abs(value * 100 - Math.round(value * 100)) < 1e-6
  );
}

function pointsError(points: unknown): string | undefined {
  return isDecimal(points, MAX_POINTS) ? undefined : 'Zahl von 0 bis 9.999,99.';
}

function multiplierError(multiplier: unknown): string | undefined {
  return isDecimal(multiplier, MAX_MULTIPLIER) && multiplier > 0
    ? undefined
    : 'Zahl über 0 bis 99,99.';
}

/** The day's standings, aggregated like the API's Scoreboard: factors at their current multiplier. */
function scoreboard(fixtures: Fixtures, from: Date): Scoreboard {
  const rows = new Map<number, ScoreRow>();
  for (const entry of fixtures.entries) {
    if (new Date(entry.createdAt) < from) continue;
    const person = fixtures.persons.find(({ id }) => id === entry.personId);
    const drink = fixtures.drinks.find(({ id }) => id === entry.drinkId);
    if (!person || !drink) continue;
    const multiplier =
      fixtures.factors.find(({ id }) => id === entry.factorId)?.multiplier ?? 1;
    const counted = entry.quantity * multiplier;
    const row = rows.get(person.id) ?? {
      personId: person.id,
      name: person.name,
      score: 0,
      count: 0,
      drinks: [],
    };
    row.score += counted * drink.points;
    row.count += counted;
    const counter = row.drinks.find(({ drinkId }) => drinkId === drink.id);
    if (counter) counter.count += counted;
    else
      row.drinks.push({
        drinkId: drink.id,
        name: drink.name,
        count: counted,
      });
    rows.set(person.id, row);
  }
  const round = (value: number) => Math.round(value * 100) / 100;
  return {
    rows: [...rows.values()]
      .map((row) => ({
        ...row,
        score: round(row.score),
        count: round(row.count),
        drinks: row.drinks
          .map((drink) => ({ ...drink, count: round(drink.count) }))
          .sort(byName),
      }))
      .sort((a, b) => b.score - a.score || byName(a, b)),
  };
}

/** The game's ranking in its current run, like the API's Standings: a cleared side counts for no one. */
function standingsOf(fixtures: Fixtures, game: FixtureGame): Standings {
  const nameOf = (personId: number) =>
    fixtures.persons.find(({ id }) => id === personId)?.name ?? '';
  const byNameThenId = (
    a: { name: string; personId: number },
    b: { name: string; personId: number },
  ) => byName(a, b) || a.personId - b.personId;
  const { kind, startedAt } = game;
  if (kind === 'duel') {
    const rows = new Map<number, DuelRow>();
    const count = (personId: number | null, result: DuelResult) => {
      if (personId === null) return;
      const row = rows.get(personId) ?? {
        personId,
        name: nameOf(personId),
        points: 0,
        wins: 0,
        draws: 0,
        losses: 0,
        played: 0,
      };
      row[result] += 1;
      row.played += 1;
      row.points = row.wins + row.draws / 2;
      rows.set(personId, row);
    };
    for (const match of inRun(fixtures.matches, game)) {
      const [first, second] = DUEL_RESULTS[match.outcome];
      count(match.firstPersonId, first);
      count(match.secondPersonId, second);
    }
    return {
      kind,
      startedAt,
      rows: [...rows.values()].sort(
        (a, b) => b.points - a.points || b.wins - a.wins || byNameThenId(a, b),
      ),
    };
  }
  const rows = new Map<number, PointsRow>();
  for (const result of inRun(fixtures.results, game)) {
    const row = rows.get(result.personId) ?? {
      personId: result.personId,
      name: nameOf(result.personId),
      sum: 0,
      results: 0,
    };
    row.sum += result.points;
    row.results += 1;
    rows.set(result.personId, row);
  }
  const direction = game.lowerWins ? 1 : -1;
  return {
    kind,
    startedAt,
    lowerWins: game.lowerWins,
    rows: [...rows.values()].sort(
      (a, b) => direction * (a.sum - b.sum) || byNameThenId(a, b),
    ),
  };
}

type DuelRow = Extract<Standings, { kind: 'duel' }>['rows'][number];
type PointsRow = Extract<Standings, { kind: 'points' }>['rows'][number];
type DuelResult = 'wins' | 'draws' | 'losses';

/** What an outcome is for the first and the second side. */
const DUEL_RESULTS: Record<FixtureMatch['outcome'], [DuelResult, DuelResult]> =
  {
    first: ['wins', 'losses'],
    second: ['losses', 'wins'],
    draw: ['draws', 'draws'],
  };

/** The game's rows of its current run. */
function inRun<T extends { gameId: number; run: number }>(
  rows: T[],
  game: FixtureGame,
): T[] {
  return rows.filter(
    ({ gameId, run }) => gameId === game.id && run === game.run,
  );
}

/** A person's entries since `from`, newest first, like the API's EntryLedger. */
function history(
  fixtures: Fixtures,
  personId: number,
  from: Date,
): HistoryEntry[] {
  return fixtures.entries
    .filter(
      (entry) =>
        entry.personId === personId && new Date(entry.createdAt) >= from,
    )
    .sort(
      (a, b) =>
        b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id),
    )
    .map((entry) => {
      const drink = fixtures.drinks.find(({ id }) => id === entry.drinkId);
      const factor = fixtures.factors.find(({ id }) => id === entry.factorId);
      const account = fixtures.accounts.find(
        ({ account }) => account.id === entry.accountId,
      );
      return {
        id: entry.id,
        drink: { id: entry.drinkId, name: drink?.name ?? '' },
        quantity: entry.quantity,
        factor: factor
          ? { id: factor.id, name: factor.name, multiplier: factor.multiplier }
          : null,
        createdAt: entry.createdAt,
        accountName: account?.account.userName ?? null,
      };
    });
}

/** An entry as the API answers it, without what only the database keeps. */
function entryOf(entry: FixtureEntry): Entry {
  const { id, personId, drinkId, quantity, factorId, createdAt } = entry;
  return { id, personId, drinkId, quantity, factorId, createdAt };
}

/** The API's password policy (`PasswordPolicy.php`); the maximum counts UTF-8 bytes, as bcrypt does. */
function passwordError(password: string): string | undefined {
  if ([...password].length < MIN_PASSWORD) {
    return `Mindestens ${String(MIN_PASSWORD)} Zeichen.`;
  }
  return new TextEncoder().encode(password).length > MAX_PASSWORD_BYTES
    ? `Höchstens ${String(MAX_PASSWORD_BYTES)} Byte (Umlaute zählen doppelt).`
    : undefined;
}

/** A whole number in a query, as the API reads one; anything else is 0, which no route accepts. */
function wholeNumber(value: string): number {
  return /^\d{1,18}$/.test(value) ? Number(value) : 0;
}

/** A page of the audit log, newest first, like the API's AuditLog; `next` only when an older event exists. */
function auditPage(audit: AuditEvent[], query: URLSearchParams): Response {
  const before = query.get('before');
  const limit = wholeNumber(query.get('limit') ?? String(PAGE_SIZE));
  const errors: Record<string, string> = {};
  if (before !== null && wholeNumber(before) < 1) {
    errors.before = 'Positive ganze Zahl.';
  }
  if (limit < 1 || limit > MAX_PAGE_SIZE) {
    errors.limit = `1 bis ${String(MAX_PAGE_SIZE)}.`;
  }
  if (Object.keys(errors).length > 0) return validation(errors);
  const older = audit
    .filter(({ id }) => before === null || id < Number(before))
    .sort((a, b) => b.id - a.id);
  const events = older.slice(0, limit);
  const next = older.length > limit ? (events.at(-1)?.id ?? null) : null;
  return json({ events, next });
}

/** A match or result as a game's Verlauf pages it: in its game's run, by time and id. */
interface Recorded {
  id: string;
  run: number;
  createdAt: string;
}

/** The `before` of the page after `row`, like the API's cursor: `[run, createdAt, id]` in URL-safe base64. */
function cursorOf({ run, createdAt, id }: Recorded): string {
  return btoa(JSON.stringify([run, createdAt, id]))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

/** A cursor this backend wrote, or undefined for anything else. */
function cursorFrom(text: string): Recorded | undefined {
  let value: unknown;
  try {
    value = JSON.parse(atob(text.replace(/-/g, '+').replace(/_/g, '/')));
  } catch {
    return undefined;
  }
  if (!Array.isArray(value) || value.length !== 3) return undefined;
  const [run, createdAt, id] = value as unknown[];
  return typeof run === 'number' &&
    Number.isInteger(run) &&
    run > 0 &&
    typeof createdAt === 'string' &&
    !Number.isNaN(Date.parse(createdAt)) &&
    typeof id === 'string' &&
    ENTRY_ID.test(id)
    ? { run, createdAt, id }
    : undefined;
}

/**
A page of a game's matches or results, like the API's GameHistory: newest first
by time, then id; the first page in the game's current run, a later one in the
run its cursor names, so a restart between pages never mixes runs; `next` only
when an older row exists.
*/
function historyPage<T extends Recorded>(
  rows: T[],
  game: FixtureGame,
  query: URLSearchParams,
  item: (row: T) => MatchItem | ResultItem,
): Response {
  const before = query.get('before');
  const cursor = before === null ? undefined : cursorFrom(before);
  const limit = wholeNumber(query.get('limit') ?? String(PAGE_SIZE));
  const errors: Record<string, string> = {};
  if (before !== null && !cursor) errors.before = 'Unbekannte Seite.';
  if (limit < 1 || limit > MAX_PAGE_SIZE) {
    errors.limit = `1 bis ${String(MAX_PAGE_SIZE)}.`;
  }
  if (Object.keys(errors).length > 0) return validation(errors);
  const isOlder = ({ createdAt, id }: T) =>
    !cursor ||
    createdAt < cursor.createdAt ||
    (createdAt === cursor.createdAt && id < cursor.id);
  const older = rows
    .filter((row) => row.run === (cursor?.run ?? game.run) && isOlder(row))
    .sort(
      (a, b) =>
        b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id),
    );
  const page = older.slice(0, limit);
  const last = page.at(-1);
  return json({
    items: page.map(item),
    next: older.length > limit && last ? cursorOf(last) : null,
  });
}

/** The URL of a request, wherever the preview is published. */
function urlOf(input: RequestInfo | URL): URL {
  return new URL(
    input instanceof globalThis.Request ? input.url : String(input),
    window.location.href,
  );
}

/** The API path of a URL (`…/api/health` → `/api/health`). */
function apiPath(url: URL): string {
  const index = url.pathname.lastIndexOf('/api/');
  return index === -1 ? url.pathname : url.pathname.slice(index);
}

/** `/api/entries/<uuid>` → the route `/api/entries/{id}` and its id; likewise `/api/matches/<uuid>`, `/api/results/<uuid>`, `/api/persons/<n>`, `/api/games/<n>/standings`, `/api/games/<n>/matches`, … */
function routeOf(path: string): { route: string; id: string } {
  const record = /^\/api\/(entries|matches|results)\/([^/]+)$/.exec(path);
  if (record?.[1] && record[2] && ENTRY_ID.test(record[2])) {
    return { route: `/api/${record[1]}/{id}`, id: record[2] };
  }
  const item =
    /^\/api\/(persons|drinks|factors|accounts|games)\/([1-9]\d*)(\/restart|\/standings|\/matches|\/results)?$/.exec(
      path,
    );
  if (item?.[1] && item[2]) {
    return { route: `/api/${item[1]}/{id}${item[3] ?? ''}`, id: item[2] };
  }
  return { route: path, id: '' };
}

/**
The in-memory API: the same answers as the real one for the routes the app uses
so far, with the session kept in memory (signing out and in again works).
*/
function routesOf(fixtures: Fixtures, revision: () => number) {
  const find = (name: string) =>
    fixtures.accounts.find(
      ({ account }) =>
        account.userName.toLowerCase() === name.trim().toLowerCase(),
    );
  const signedIn = (): FixtureAccount | undefined =>
    fixtures.accounts.find(({ account }) => account.id === fixtures.signedIn);

  const accountOf = (id: string) =>
    fixtures.accounts.find(({ account }) => account.id === Number(id));
  /** Whether removing the account's admin rights would leave no admin. */
  const isLastAdmin = ({ account }: FixtureAccount) =>
    account.isAdmin &&
    fixtures.accounts.filter((other) => other.account.isAdmin).length === 1;
  /** The preview has one session: it ends when its account is reset or deleted. */
  const signOutEverywhere = ({ account }: FixtureAccount) => {
    if (fixtures.signedIn === account.id) fixtures.signedIn = null;
  };

  /** Wraps a route that needs a session (and maybe an admin). */
  const guarded =
    (
      handle: (me: FixtureAccount, body: Body, request: Request) => Response,
      admin = false,
    ): Handler =>
    (request) => {
      const me = signedIn();
      if (!me) return problem(PROBLEMS.unauthenticated);
      if (admin && !me.account.isAdmin) return problem(PROBLEMS.forbidden);
      return handle(me, request.body, request);
    };

  const nextId = (items: { id: number }[]) =>
    Math.max(0, ...items.map(({ id }) => id)) + 1;

  /**
  Appends the event of a write that took effect, by the signed-in account, like
  the API's AuditLog: an update that changed no value records nothing. A deletion's
  event is the `cause` of what the deletion does to entries.
  */
  const record = (
    { account }: FixtureAccount,
    operation: AuditEvent['operation'],
    [subjectKind, subjectId]: [AuditEvent['subjectKind'], string],
    before: AuditEvent['before'],
    after: AuditEvent['after'],
    cause?: AuditEvent,
  ): AuditEvent | undefined => {
    if (
      operation === 'update' &&
      JSON.stringify(before) === JSON.stringify(after)
    ) {
      return undefined;
    }
    const event: AuditEvent = {
      id: nextId(fixtures.audit),
      occurredAt: new Date().toISOString(),
      operation,
      subjectKind,
      subjectId,
      actor: { accountId: account.id, userName: account.userName },
      before,
      after,
      cause: cause ? causeOf(cause) : null,
    };
    fixtures.audit.push(event);
    return event;
  };

  /**
  List, create, read (with the entry count of every day), edit and delete of one
  catalog collection; `remove` does what the API's foreign key does to entries.
  */
  function catalogRoutes<T extends Named>(
    [collection, kind]:
      ['persons', 'person'] | ['drinks', 'drink'] | ['factors', 'factor'],
    list: () => T[],
    create: (id: number) => T,
    rules: {
      field?: Field<T>;
      /** The values the audit log records of an item: the fields its writes set, not its id. */
      values: (item: T) => AuditSnapshot;
      uses: (entry: Entry, item: T) => boolean;
      remove: (item: T) => void;
      /** Counts of other dependents besides entries, for the delete dialog. */
      counts?: (item: T) => Record<string, number>;
      /** What the deletion does to other dependents, recorded as caused by it. */
      cascade?: (me: FixtureAccount, item: T, cause?: AuditEvent) => void;
    },
  ): [string, Handler][] {
    const path = `/api/${collection}`;
    const find = (id: string) => list().find((item) => item.id === Number(id));
    return [
      [
        `GET ${path}`,
        guarded(() => json({ [collection]: [...list()].sort(byName) })),
      ],
      [
        `POST ${path}`,
        guarded((me, body) => {
          const item = create(nextId(list()));
          const response = saveNamed(list(), item, body, 201, rules.field);
          if (response.ok) {
            record(
              me,
              'create',
              [kind, String(item.id)],
              null,
              rules.values(item),
            );
          }
          return response;
        }),
      ],
      [
        `GET ${path}/{id}`,
        guarded((_me, _body, { id }) => {
          const item = find(id);
          if (!item) return problem(PROBLEMS.notFound);
          const entryCount = fixtures.entries.filter((entry) =>
            rules.uses(entry, item),
          ).length;
          return json({ ...item, entryCount, ...rules.counts?.(item) });
        }),
      ],
      [
        `PATCH ${path}/{id}`,
        guarded((me, body, { id }) => {
          const item = find(id);
          if (!item) return problem(PROBLEMS.notFound);
          const before = rules.values(item);
          const response = saveNamed(list(), item, body, 200, rules.field);
          if (response.ok) {
            record(me, 'update', [kind, id], before, rules.values(item));
          }
          return response;
        }),
      ],
      [
        `DELETE ${path}/{id}`,
        guarded((me, _body, { id }) => {
          const item = find(id);
          if (!item) return problem(PROBLEMS.notFound);
          const affected = fixtures.entries
            .filter((entry) => rules.uses(entry, item))
            .sort((a, b) => a.id.localeCompare(b.id))
            .map((entry) => [entry, entrySnapshot(fixtures, entry)] as const);
          list().splice(list().indexOf(item), 1);
          rules.remove(item);
          const cause = record(
            me,
            'delete',
            [kind, id],
            rules.values(item),
            null,
          );
          // One event per entry, in id order: changed if it stayed (a factor's), else deleted.
          for (const [entry, before] of affected) {
            const stayed = fixtures.entries.includes(entry);
            record(
              me,
              stayed ? 'update' : 'delete',
              ['entry', entry.id],
              before,
              stayed ? entrySnapshot(fixtures, entry) : null,
              cause,
            );
          }
          rules.cascade?.(me, item, cause);
          return new Response(null, { status: 204 });
        }),
      ],
    ];
  }

  /** A match as the audit log records it; `deleted` names a person whose deletion is being recorded. */
  const matchSnapshot = (
    match: FixtureMatch,
    deleted?: { id: number; name: string },
  ): AuditSnapshot => {
    const nameOf = (personId: number | null) =>
      [...fixtures.persons, ...(deleted ? [deleted] : [])].find(
        ({ id }) => id === personId,
      )?.name ?? null;
    return {
      game: fixtures.games.find(({ id }) => id === match.gameId)?.name ?? '',
      first: nameOf(match.firstPersonId),
      second: nameOf(match.secondPersonId),
      outcome: match.outcome,
    };
  };
  /** A result as the audit log records it; `deleted` names a game or person whose deletion is being recorded. */
  const resultSnapshot = (
    result: FixtureResult,
    deleted: { game?: string; person?: string } = {},
  ): AuditSnapshot => {
    const nameOf = (rows: { id: number; name: string }[], id: number) =>
      rows.find((row) => row.id === id)?.name ?? '';
    return {
      game: deleted.game ?? nameOf(fixtures.games, result.gameId),
      person: deleted.person ?? nameOf(fixtures.persons, result.personId),
      points: result.points,
    };
  };
  const byId = (a: { id: string }, b: { id: string }) =>
    a.id.localeCompare(b.id);
  /**
  Like the foreign keys, the results that `goes` picks are deleted; like the
  API, each one's deletion is recorded first, in id order, caused by `cause`,
  with its game's and its person's names. `deleted` names the game or the
  person whose deletion is being recorded.
  */
  const removeResults = (
    me: FixtureAccount,
    goes: (result: FixtureResult) => boolean,
    cause: AuditEvent | undefined,
    deleted: { game?: string; person?: string },
  ) => {
    for (const result of fixtures.results.filter(goes).sort(byId)) {
      record(
        me,
        'delete',
        ['result', result.id],
        resultSnapshot(result, deleted),
        null,
        cause,
      );
    }
    fixtures.results = fixtures.results.filter((result) => !goes(result));
  };

  /**
  Like the API's person deletion: the person's matches stay with that side
  cleared, one caused update each; their results go with them, one caused
  deletion each.
  */
  const clearPerson = (
    me: FixtureAccount,
    person: { id: number; name: string },
    cause?: AuditEvent,
  ) => {
    const named = fixtures.matches
      .filter(
        ({ firstPersonId, secondPersonId }) =>
          firstPersonId === person.id || secondPersonId === person.id,
      )
      .sort(byId);
    for (const match of named) {
      const before = matchSnapshot(match, person);
      if (match.firstPersonId === person.id) match.firstPersonId = null;
      if (match.secondPersonId === person.id) match.secondPersonId = null;
      record(
        me,
        'update',
        ['match', match.id],
        before,
        matchSnapshot(match),
        cause,
      );
    }
    removeResults(me, ({ personId }) => personId === person.id, cause, {
      person: person.name,
    });
  };
  /** A person as a Verlauf names them, or null once deleted. */
  const personRef = (personId: number | null) => {
    const person = fixtures.persons.find(({ id }) => id === personId);
    return person ? { id: person.id, name: person.name } : null;
  };
  /** The recording account's name, or null once deleted. */
  const accountNameOf = (accountId: number | null) =>
    fixtures.accounts.find(({ account }) => account.id === accountId)?.account
      .userName ?? null;
  const matchCountOf = (personId: number) =>
    fixtures.matches.filter(
      ({ firstPersonId, secondPersonId }) =>
        firstPersonId === personId || secondPersonId === personId,
    ).length;

  /**
  The games, like the API's Games: list, create, read (with its match and result
  counts of every run), edit, restart, delete (its matches and results with it),
  its ranking and its Verlauf, each write recorded in the audit log.
  */
  function gameRoutes(): [string, Handler][] {
    const find = (id: string) =>
      fixtures.games.find((game) => game.id === Number(id));
    return [
      [
        'GET /api/games',
        guarded(() =>
          json({ games: [...fixtures.games].sort(byName).map(gameOf) }),
        ),
      ],
      [
        'POST /api/games',
        guarded((me, body) => {
          const invalid = settingErrors(body);
          if (invalid) return validation(invalid);
          const name = text(body, 'name').trim();
          const errors: Record<string, string> = {};
          const invalidName = nameError(name);
          if (invalidName) errors.name = invalidName;
          const { kind } = body;
          if (kind !== 'duel' && kind !== 'points') {
            errors.kind = 'Duell oder Punktespiel.';
          }
          if (Object.keys(errors).length > 0) return validation(errors);
          if (taken(name)) return problem(PROBLEMS.duplicateName);
          const game: FixtureGame = {
            id: nextId(fixtures.games),
            name,
            kind: kind as Game['kind'],
            drawsAllowed: true,
            lowerWins: false,
            run: 1,
            startedAt: new Date().toISOString(),
          };
          applySetting(game, body);
          fixtures.games.push(game);
          record(
            me,
            'create',
            ['game', String(game.id)],
            null,
            gameValues(game),
          );
          return json(gameOf(game), 201);
        }),
      ],
      [
        'GET /api/games/{id}',
        guarded((_me, _body, { id }) => {
          const game = find(id);
          if (!game) return problem(PROBLEMS.notFound);
          const ofGame = ({ gameId }: { gameId: number }) => gameId === game.id;
          return json({
            ...gameOf(game),
            matchCount: fixtures.matches.filter(ofGame).length,
            resultCount: fixtures.results.filter(ofGame).length,
          });
        }),
      ],
      [
        'PATCH /api/games/{id}',
        guarded((me, body, { id }) => {
          const invalid = settingErrors(body);
          if (invalid) return validation(invalid);
          const name = text(body, 'name').trim();
          const invalidName = nameError(name);
          if (invalidName) return validation({ name: invalidName });
          const game = find(id);
          if (!game) return problem(PROBLEMS.notFound);
          if (body.kind != null && body.kind !== game.kind) {
            return validation({ kind: 'Die Art eines Spiels ist fest.' });
          }
          if (taken(name, game)) return problem(PROBLEMS.duplicateName);
          const before = gameValues(game);
          game.name = name;
          applySetting(game, body);
          record(me, 'update', ['game', id], before, gameValues(game));
          return json(gameOf(game));
        }),
      ],
      [
        'POST /api/games/{id}/restart',
        guarded((me, _body, { id }) => {
          const game = find(id);
          if (!game) return problem(PROBLEMS.notFound);
          const before = gameValues(game);
          game.run += 1;
          game.startedAt = new Date().toISOString();
          record(me, 'update', ['game', id], before, gameValues(game));
          return json(gameOf(game));
        }),
      ],
      [
        'DELETE /api/games/{id}',
        guarded((me, _body, { id }) => {
          const game = find(id);
          if (!game) return problem(PROBLEMS.notFound);
          const matches = fixtures.matches
            .filter(({ gameId }) => gameId === game.id)
            .sort(byId)
            .map((match) => [match, matchSnapshot(match)] as const);
          fixtures.games.splice(fixtures.games.indexOf(game), 1);
          const cause = record(
            me,
            'delete',
            ['game', id],
            gameValues(game),
            null,
          );
          for (const [match, before] of matches) {
            record(me, 'delete', ['match', match.id], before, null, cause);
          }
          // Like the foreign keys: the game's matches and results go with it.
          fixtures.matches = fixtures.matches.filter(
            ({ gameId }) => gameId !== game.id,
          );
          removeResults(me, ({ gameId }) => gameId === game.id, cause, {
            game: game.name,
          });
          return new Response(null, { status: 204 });
        }),
      ],
      [
        'GET /api/games/{id}/matches',
        guarded((_me, _body, { id, query }) => {
          const game = find(id);
          if (game?.kind !== 'duel') return problem(PROBLEMS.notFound);
          return historyPage(
            fixtures.matches.filter(({ gameId }) => gameId === game.id),
            game,
            query,
            (match) => ({
              id: match.id,
              first: personRef(match.firstPersonId),
              second: personRef(match.secondPersonId),
              outcome: match.outcome,
              createdAt: match.createdAt,
              accountName: accountNameOf(match.accountId),
            }),
          );
        }),
      ],
      [
        'GET /api/games/{id}/results',
        guarded((_me, _body, { id, query }) => {
          const game = find(id);
          if (game?.kind !== 'points') return problem(PROBLEMS.notFound);
          return historyPage(
            fixtures.results.filter(({ gameId }) => gameId === game.id),
            game,
            query,
            (result) => ({
              id: result.id,
              // A deleted person's results went with them, so the person exists.
              person: personRef(result.personId) ?? {
                id: result.personId,
                name: '',
              },
              points: result.points,
              createdAt: result.createdAt,
              accountName: accountNameOf(result.accountId),
            }),
          );
        }),
      ],
      [
        'GET /api/games/{id}/standings',
        guarded((_me, _body, { id, headers }) => {
          const game = find(id);
          if (!game) return problem(PROBLEMS.notFound);
          // Like the API: the data revision names the ranking.
          const etag = `"${String(revision())}"`;
          if (headers.get('If-None-Match') === etag) {
            return new Response(null, { status: 304, headers: { ETag: etag } });
          }
          const response = json(standingsOf(fixtures, game));
          response.headers.set('ETag', etag);
          return response;
        }),
      ],
    ];
  }

  /** Whether another game than `game` has the name, ignoring case. */
  const taken = (name: string, game?: FixtureGame) =>
    fixtures.games.some(
      (other) => other !== game && sameName(other.name, name),
    );

  return new Map<string, Handler>([
    ['GET /api/health', () => json(fixtures.health)],
    [
      'POST /api/session',
      ({ body }) => {
        const match = find(text(body, 'userName'));
        if (!match || match.password !== text(body, 'password')) {
          return problem(PROBLEMS.invalidCredentials);
        }
        fixtures.signedIn = match.account.id;
        return json(match.account);
      },
    ],
    ['GET /api/session', guarded((me) => json(me.account))],
    [
      'DELETE /api/session',
      guarded(() => {
        fixtures.signedIn = null;
        return new Response(null, { status: 204 });
      }),
    ],
    [
      'PUT /api/session/password',
      guarded((me, body) => {
        const errors: Record<string, string> = {};
        if (text(body, 'currentPassword') !== me.password) {
          errors.currentPassword = 'Passwort falsch.';
        }
        const next = passwordError(text(body, 'newPassword'));
        if (next) errors.newPassword = next;
        if (Object.keys(errors).length > 0) return validation(errors);
        me.password = text(body, 'newPassword');
        return new Response(null, { status: 204 });
      }),
    ],
    [
      'GET /api/accounts',
      guarded(
        () =>
          json({
            accounts: fixtures.accounts
              .map(({ account }) => account)
              .sort((a, b) => a.userName.localeCompare(b.userName, 'de')),
          }),
        true,
      ),
    ],
    [
      'POST /api/accounts',
      guarded((_me, body) => {
        const userName = text(body, 'userName').trim();
        const password = text(body, 'password');
        const errors: Record<string, string> = {};
        const length = [...userName].length;
        if (length < 1 || length > MAX_USER_NAME) {
          errors.userName = `1 bis ${String(MAX_USER_NAME)} Zeichen.`;
        }
        const weak = passwordError(password);
        if (weak) errors.password = weak;
        if (Object.keys(errors).length > 0) return validation(errors);
        if (find(userName)) return problem(PROBLEMS.duplicateUserName);
        const account = {
          id: Math.max(0, ...fixtures.accounts.map((a) => a.account.id)) + 1,
          userName,
          isAdmin: false,
        };
        fixtures.accounts.push({ account, password });
        return json(account, 201);
      }, true),
    ],
    [
      'PATCH /api/accounts/{id}',
      guarded((_me, body, { id }) => {
        const target = accountOf(id);
        if (!target) return problem(PROBLEMS.notFound);
        const { isAdmin } = body;
        if (isAdmin != null && typeof isAdmin !== 'boolean') {
          return validation({ isAdmin: 'Ja oder nein.' });
        }
        const password =
          body.password == null ? undefined : text(body, 'password');
        const weak =
          password === undefined ? undefined : passwordError(password);
        if (weak) return validation({ password: weak });
        if (isAdmin === false && isLastAdmin(target)) {
          return problem(PROBLEMS.lastAdmin);
        }
        if (typeof isAdmin === 'boolean') target.account.isAdmin = isAdmin;
        if (password !== undefined) {
          target.password = password;
          signOutEverywhere(target);
        }
        return json(target.account);
      }, true),
    ],
    [
      'DELETE /api/accounts/{id}',
      guarded((_me, _body, { id }) => {
        const target = accountOf(id);
        if (!target) return problem(PROBLEMS.notFound);
        if (isLastAdmin(target)) return problem(PROBLEMS.lastAdmin);
        fixtures.accounts.splice(fixtures.accounts.indexOf(target), 1);
        signOutEverywhere(target);
        // Like the foreign key: the account's entries stay, without it.
        for (const entry of fixtures.entries) {
          if (entry.accountId === target.account.id) entry.accountId = null;
        }
        return new Response(null, { status: 204 });
      }, true),
    ],
    ...catalogRoutes(
      ['persons', 'person'],
      () => fixtures.persons,
      (id) => ({ id, name: '' }),
      {
        values: ({ name }) => ({ name }),
        uses: (entry, person) => entry.personId === person.id,
        // Like the foreign key: the person's entries go with them.
        remove: (person) =>
          (fixtures.entries = fixtures.entries.filter(
            (entry) => entry.personId !== person.id,
          )),
        counts: (person) => ({
          matchCount: matchCountOf(person.id),
          resultCount: fixtures.results.filter(
            ({ personId }) => personId === person.id,
          ).length,
        }),
        cascade: clearPerson,
      },
    ),
    ...catalogRoutes(
      ['drinks', 'drink'],
      () => fixtures.drinks,
      (id) => ({ id, name: '', points: 0 }),
      {
        field: { name: 'points', error: pointsError },
        values: ({ name, points }) => ({ name, points }),
        uses: (entry, drink) => entry.drinkId === drink.id,
        // Like the foreign key: the drink's entries go with it.
        remove: (drink) =>
          (fixtures.entries = fixtures.entries.filter(
            (entry) => entry.drinkId !== drink.id,
          )),
      },
    ),
    ...catalogRoutes(
      ['factors', 'factor'],
      () => fixtures.factors,
      (id) => ({ id, name: '', multiplier: 0 }),
      {
        field: { name: 'multiplier', error: multiplierError },
        values: ({ name, multiplier }) => ({ name, multiplier }),
        uses: (entry, factor) => entry.factorId === factor.id,
        // Like the foreign key: the factor's entries stay and count ×1.
        remove: (factor) => {
          for (const entry of fixtures.entries) {
            if (entry.factorId === factor.id) entry.factorId = null;
          }
        },
      },
    ),
    ...gameRoutes(),
    [
      'GET /api/entries',
      guarded((_me, _body, { query }) => {
        const personId = query.get('personId') ?? '';
        if (!QUERY_ID.test(personId)) {
          return validation({ personId: 'Person nicht gefunden.' });
        }
        const from = new Date(query.get('from') ?? '');
        if (Number.isNaN(from.getTime())) {
          return validation({ from: 'Zeitpunkt nach ISO 8601 mit Zeitzone.' });
        }
        const id = Number(personId);
        if (!fixtures.persons.some((person) => person.id === id)) {
          return problem(PROBLEMS.notFound);
        }
        return json({ entries: history(fixtures, id, from) });
      }),
    ],
    [
      'PUT /api/entries/{id}',
      guarded((me, body, { id }) => {
        const response = putEntry(fixtures, id, body, me.account.id);
        const entry = fixtures.entries.find((candidate) => candidate.id === id);
        // Only a new entry is a change: a replay answers 200 and records nothing.
        if (response.status === 201 && entry) {
          record(
            me,
            'create',
            ['entry', id],
            null,
            entrySnapshot(fixtures, entry),
          );
        }
        return response;
      }),
    ],
    [
      'DELETE /api/entries/{id}',
      guarded((me, _body, { id }) => {
        const index = fixtures.entries.findIndex((entry) => entry.id === id);
        const entry = fixtures.entries[index];
        if (!entry) return problem(PROBLEMS.notFound);
        record(
          me,
          'delete',
          ['entry', id],
          entrySnapshot(fixtures, entry),
          null,
        );
        fixtures.entries.splice(index, 1);
        return new Response(null, { status: 204 });
      }),
    ],
    [
      'PUT /api/matches/{id}',
      guarded((me, body, { id }) => {
        const response = putMatch(fixtures, id, body, me.account.id);
        const match = fixtures.matches.find((candidate) => candidate.id === id);
        // Only a new match is a change: a replay answers 200 and records nothing.
        if (response.status === 201 && match) {
          record(me, 'create', ['match', id], null, matchSnapshot(match));
        }
        return response;
      }),
    ],
    [
      'DELETE /api/matches/{id}',
      guarded((me, _body, { id }) => {
        const match = fixtures.matches.find((candidate) => candidate.id === id);
        if (!match) return problem(PROBLEMS.notFound);
        record(me, 'delete', ['match', id], matchSnapshot(match), null);
        fixtures.matches.splice(fixtures.matches.indexOf(match), 1);
        return new Response(null, { status: 204 });
      }),
    ],
    [
      'PUT /api/results/{id}',
      guarded((me, body, { id }) => {
        const response = putResult(fixtures, id, body, me.account.id);
        const result = fixtures.results.find(
          (candidate) => candidate.id === id,
        );
        // Only a new result is a change: a replay answers 200 and records nothing.
        if (response.status === 201 && result) {
          record(me, 'create', ['result', id], null, resultSnapshot(result));
        }
        return response;
      }),
    ],
    [
      'DELETE /api/results/{id}',
      guarded((me, _body, { id }) => {
        const result = fixtures.results.find(
          (candidate) => candidate.id === id,
        );
        if (!result) return problem(PROBLEMS.notFound);
        record(me, 'delete', ['result', id], resultSnapshot(result), null);
        fixtures.results.splice(fixtures.results.indexOf(result), 1);
        return new Response(null, { status: 204 });
      }),
    ],
    [
      'GET /api/audit',
      guarded(
        (_me, _body, { query }) => auditPage(fixtures.audit, query),
        true,
      ),
    ],
    [
      'GET /api/scoreboard',
      guarded((_me, _body, { query, headers }) => {
        const from = new Date(query.get('from') ?? '');
        if (Number.isNaN(from.getTime())) {
          return validation({ from: 'Zeitpunkt nach ISO 8601 mit Zeitzone.' });
        }
        // Like the API: the revision and the window, so another day never answers 304.
        const etag = `"${String(revision())}-${String(from.getTime())}"`;
        if (headers.get('If-None-Match') === etag) {
          return new Response(null, { status: 304, headers: { ETag: etag } });
        }
        const response = json(scoreboard(fixtures, from));
        response.headers.set('ETag', etag);
        return response;
      }),
    ],
  ]);
}

interface Named {
  id: number;
  name: string;
}

/** A catalog field besides the name: drinks' `points`, factors' `multiplier`. */
interface Field<T> {
  name: keyof T & string;
  error: (value: unknown) => string | undefined;
}

/** Creates or changes a catalog item with the API's validation; a new one is not in `list` yet. */
function saveNamed<T extends Named>(
  list: T[],
  item: T,
  body: Body,
  status: 200 | 201,
  field?: Field<T>,
): Response {
  const name = text(body, 'name').trim();
  const errors: Record<string, string> = {};
  const invalidName = nameError(name);
  if (invalidName) errors.name = invalidName;
  const invalidField = field?.error(body[field.name]);
  if (field && invalidField) errors[field.name] = invalidField;
  if (Object.keys(errors).length > 0) return validation(errors);
  const taken = list.some(
    (other) => other.id !== item.id && sameName(other.name, name),
  );
  if (taken) return problem(PROBLEMS.duplicateName);
  Object.assign(
    item,
    field ? { name, [field.name]: body[field.name] } : { name },
  );
  if (!list.includes(item)) list.push(item);
  return json(item, status);
}

/** A game as the API answers it, without its run. */
function gameOf(game: FixtureGame): Game {
  const { id, name, kind, drawsAllowed, lowerWins, startedAt } = game;
  return { id, name, kind, drawsAllowed, lowerWins, startedAt };
}

/** A game as the audit log records it: its kind's own setting, its run and its start. */
function gameValues(game: FixtureGame): AuditSnapshot {
  const { name, kind, drawsAllowed, lowerWins, run, startedAt } = game;
  const setting = kind === 'duel' ? { drawsAllowed } : { lowerWins };
  return { name, kind, ...setting, run, startedAt };
}

/** A setting that is sent must be a boolean, as the API reads it before anything else. */
function settingErrors(body: Body): Record<string, string> | undefined {
  for (const field of ['drawsAllowed', 'lowerWins']) {
    const value = body[field];
    if (value != null && typeof value !== 'boolean') {
      return { [field]: 'Ja oder nein.' };
    }
  }
  return undefined;
}

/** Takes the game's own kind's setting from the body where sent; the other kind's is ignored. */
function applySetting(game: FixtureGame, body: Body): void {
  if (game.kind === 'duel' && typeof body.drawsAllowed === 'boolean') {
    game.drawsAllowed = body.drawsAllowed;
  }
  if (game.kind === 'points' && typeof body.lowerWins === 'boolean') {
    game.lowerWins = body.lowerWins;
  }
}

/** Adds an entry idempotently on its id, like the API's EntryLedger, recording the account. */
function putEntry(
  fixtures: Fixtures,
  id: string,
  body: Body,
  accountId: number,
): Response {
  const quantity = integer(body, 'quantity');
  if (quantity === undefined || quantity < 1 || quantity > MAX_QUANTITY) {
    return validation({ quantity: `1 bis ${String(MAX_QUANTITY)}.` });
  }
  const personId = integer(body, 'personId');
  const drinkId = integer(body, 'drinkId');
  // Missing or null is no factor; anything else that is no integer is no factor that exists.
  const factorId =
    body.factorId === undefined || body.factorId === null
      ? null
      : (integer(body, 'factorId') ?? 0);
  const fingerprint = JSON.stringify([personId, drinkId, quantity, factorId]);
  const known = fixtures.entryRequests.get(id);
  if (known !== undefined) {
    if (known !== fingerprint) return problem(PROBLEMS.entryConflict);
    const entry = fixtures.entries.find((candidate) => candidate.id === id);
    return json(
      entry
        ? entryOf(entry)
        : { id, personId, drinkId, quantity, factorId, createdAt: '' },
    );
  }
  const errors: Record<string, string> = {};
  if (!fixtures.persons.some((person) => person.id === personId)) {
    errors.personId = 'Person nicht gefunden.';
  }
  if (!fixtures.drinks.some((drink) => drink.id === drinkId)) {
    errors.drinkId = 'Getränk nicht gefunden.';
  }
  if (
    factorId !== null &&
    !fixtures.factors.some((factor) => factor.id === factorId)
  ) {
    errors.factorId = 'Faktor nicht gefunden.';
  }
  if (Object.keys(errors).length > 0) return validation(errors);
  const entry: FixtureEntry = {
    id,
    personId: personId ?? 0,
    drinkId: drinkId ?? 0,
    quantity,
    factorId,
    createdAt: new Date().toISOString(),
    accountId,
  };
  fixtures.entryRequests.set(id, fingerprint);
  fixtures.entries.push(entry);
  return json(entryOf(entry), 201);
}

/** The checks that need no data: two different persons and an outcome the API knows. */
function matchShapeErrors(body: Body): Record<string, string> | undefined {
  const firstPersonId = integer(body, 'firstPersonId');
  const secondPersonId = integer(body, 'secondPersonId');
  const errors: Record<string, string> = {};
  if (firstPersonId === undefined) errors.firstPersonId = PERSON_NOT_FOUND;
  if (secondPersonId === undefined) errors.secondPersonId = PERSON_NOT_FOUND;
  else if (secondPersonId === firstPersonId) {
    errors.secondPersonId = 'Zwei verschiedene Personen.';
  }
  if (!['first', 'second', 'draw'].includes(text(body, 'outcome'))) {
    errors.outcome = 'Sieg des Ersten, des Zweiten oder Remis.';
  }
  return Object.keys(errors).length > 0 ? errors : undefined;
}

/**
Records a match idempotently on its id, like the API's Matches: a replay answers
200 even after the match or its game was deleted; then the game must be a duel
that allows the outcome, and both persons must exist.
*/
function putMatch(
  fixtures: Fixtures,
  id: string,
  body: Body,
  accountId: number,
): Response {
  const invalid = matchShapeErrors(body);
  if (invalid) return validation(invalid);
  const values = {
    gameId: integer(body, 'gameId') ?? 0,
    firstPersonId: integer(body, 'firstPersonId') ?? 0,
    secondPersonId: integer(body, 'secondPersonId') ?? 0,
    outcome: text(body, 'outcome') as Match['outcome'],
  };
  const fingerprint = JSON.stringify(['match', ...Object.values(values)]);
  const known = fixtures.entryRequests.get(id);
  if (known !== undefined) {
    if (known !== fingerprint) return problem(PROBLEMS.requestConflict);
    // The original match, as sent; its time only while it still exists.
    const match = fixtures.matches.find((candidate) => candidate.id === id);
    return json({ id, ...values, createdAt: match?.createdAt ?? '' });
  }
  const game = fixtures.games.find(
    ({ id: gameId }) => gameId === values.gameId,
  );
  if (!game) return problem(PROBLEMS.notFound);
  if (game.kind !== 'duel') return validation({ gameId: 'Kein Duell.' });
  if (values.outcome === 'draw' && !game.drawsAllowed) {
    return validation({ outcome: 'Remis ist in diesem Spiel nicht möglich.' });
  }
  const errors: Record<string, string> = {};
  for (const field of ['firstPersonId', 'secondPersonId'] as const) {
    if (!fixtures.persons.some((person) => person.id === values[field])) {
      errors[field] = PERSON_NOT_FOUND;
    }
  }
  if (Object.keys(errors).length > 0) return validation(errors);
  const match: FixtureMatch = {
    id,
    ...values,
    run: game.run,
    accountId,
    createdAt: new Date().toISOString(),
  };
  fixtures.entryRequests.set(id, fingerprint);
  fixtures.matches.push(match);
  return json({ id, ...values, createdAt: match.createdAt }, 201);
}

/** A result's points: whole numbers from −9 999 to 9 999. */
const MAX_RESULT_POINTS = 9999;
const POINTS_ERROR = 'Ganze Zahl von −9.999 bis 9.999.';

/**
Records a result idempotently on its id, like the API's Results: the person and
the points are checked first; a replay answers 200 even after the result or its
game was deleted; then the game must be a points game and the person must exist.
*/
function putResult(
  fixtures: Fixtures,
  id: string,
  body: Body,
  accountId: number,
): Response {
  const personId = integer(body, 'personId');
  const points = integer(body, 'points');
  const errors: Record<string, string> = {};
  if (personId === undefined) errors.personId = PERSON_NOT_FOUND;
  if (points === undefined || Math.abs(points) > MAX_RESULT_POINTS) {
    errors.points = POINTS_ERROR;
  }
  if (personId === undefined || points === undefined || errors.points) {
    return validation(errors);
  }
  const values = { gameId: integer(body, 'gameId') ?? 0, personId, points };
  const fingerprint = JSON.stringify(['result', ...Object.values(values)]);
  const known = fixtures.entryRequests.get(id);
  if (known !== undefined) {
    if (known !== fingerprint) return problem(PROBLEMS.requestConflict);
    // The original result, as sent; its time only while it still exists.
    const result = fixtures.results.find((candidate) => candidate.id === id);
    return json({ id, ...values, createdAt: result?.createdAt ?? '' });
  }
  const game = fixtures.games.find(
    ({ id: gameId }) => gameId === values.gameId,
  );
  if (!game) return problem(PROBLEMS.notFound);
  if (game.kind !== 'points') {
    return validation({ gameId: 'Kein Punktespiel.' });
  }
  if (!fixtures.persons.some((person) => person.id === personId)) {
    return validation({ personId: PERSON_NOT_FOUND });
  }
  const result: FixtureResult = {
    id,
    ...values,
    run: game.run,
    accountId,
    createdAt: new Date().toISOString(),
  };
  fixtures.entryRequests.set(id, fingerprint);
  fixtures.results.push(result);
  return json({ id, ...values, createdAt: result.createdAt }, 201);
}

async function bodyOf(
  input: RequestInfo | URL,
  init: RequestInit | undefined,
): Promise<Body> {
  const raw =
    init?.body ??
    (input instanceof globalThis.Request ? await input.text() : undefined);
  if (typeof raw !== 'string' || raw === '') return {};
  const parsed: unknown = JSON.parse(raw);
  return typeof parsed === 'object' && parsed !== null ? (parsed as Body) : {};
}

/**
Replaces the global `fetch` with an in-memory backend before the app starts, so
the real app runs on canned answers without network access. What it does not
know answers 503, like a server in maintenance.
*/
export function installFixtureBackend(fixtures: Fixtures): void {
  let revision = 0;
  const routes = routesOf(fixtures, () => revision);
  globalThis.fetch = async (input, init) => {
    const method = (
      init?.method ??
      (input instanceof globalThis.Request ? input.method : 'GET')
    ).toUpperCase();
    const url = urlOf(input);
    const { route, id } = routeOf(apiPath(url));
    const handle = routes.get(`${method} ${route}`);
    if (!handle) return problem(PROBLEMS.maintenance);
    const response = handle({
      body: await bodyOf(input, init),
      id,
      query: url.searchParams,
      headers: new Headers(
        init?.headers ??
          (input instanceof globalThis.Request ? input.headers : undefined),
      ),
    });
    // Every successful write counts as a change of the standings, like the API's data revision.
    if (method !== 'GET' && response.ok) revision += 1;
    return response;
  };
}
