import type {
  Entry,
  HistoryEntry,
  ScoreRow,
  Scoreboard,
} from '../src/core/api-client';
import type { components } from '../src/core/api-client/schema';
import type { FixtureAccount, FixtureEntry, Fixtures } from './fixtures';

type Problem = components['schemas']['Problem'];
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
  notFound: {
    type: 'urn:performance:problem:not-found',
    title: 'Nicht gefunden',
    status: 404,
  },
} satisfies Record<string, Problem>;

const MIN_PASSWORD = 10;
const MAX_USER_NAME = 40;
const MAX_NAME = 40;
const MAX_POINTS = 9999.99;
const MAX_MULTIPLIER = 99.99;
const MAX_QUANTITY = 99;
/** A positive integer id in a query, as the API's routes accept it. */
const QUERY_ID = /^[1-9]\d{0,9}$/;
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

function passwordError(password: string): string | undefined {
  return [...password].length < MIN_PASSWORD
    ? `Mindestens ${String(MIN_PASSWORD)} Zeichen.`
    : undefined;
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

/** `/api/entries/<uuid>` → the route `/api/entries/{id}` and its id; likewise `/api/persons/<n>`, … */
function routeOf(path: string): { route: string; id: string } {
  const entry = /^\/api\/entries\/([^/]+)$/.exec(path)?.[1];
  if (entry && ENTRY_ID.test(entry)) {
    return { route: '/api/entries/{id}', id: entry };
  }
  const item = /^\/api\/(persons|drinks|factors)\/([1-9]\d*)$/.exec(path);
  if (item?.[1] && item[2]) {
    return { route: `/api/${item[1]}/{id}`, id: item[2] };
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
  List, create, read (with the entry count of every day), edit and delete of one
  catalog collection; `remove` does what the API's foreign key does to entries.
  */
  function catalogRoutes<T extends Named>(
    collection: 'persons' | 'drinks' | 'factors',
    list: () => T[],
    create: (id: number) => T,
    rules: {
      field?: Field<T>;
      uses: (entry: Entry, item: T) => boolean;
      remove: (item: T) => void;
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
        guarded((_me, body) =>
          saveNamed(list(), create(nextId(list())), body, 201, rules.field),
        ),
      ],
      [
        `GET ${path}/{id}`,
        guarded((_me, _body, { id }) => {
          const item = find(id);
          if (!item) return problem(PROBLEMS.notFound);
          const entryCount = fixtures.entries.filter((entry) =>
            rules.uses(entry, item),
          ).length;
          return json({ ...item, entryCount });
        }),
      ],
      [
        `PATCH ${path}/{id}`,
        guarded((_me, body, { id }) => {
          const item = find(id);
          if (!item) return problem(PROBLEMS.notFound);
          return saveNamed(list(), item, body, 200, rules.field);
        }),
      ],
      [
        `DELETE ${path}/{id}`,
        guarded((_me, _body, { id }) => {
          const item = find(id);
          if (!item) return problem(PROBLEMS.notFound);
          list().splice(list().indexOf(item), 1);
          rules.remove(item);
          return new Response(null, { status: 204 });
        }),
      ],
    ];
  }

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
    ...catalogRoutes(
      'persons',
      () => fixtures.persons,
      (id) => ({ id, name: '' }),
      {
        uses: (entry, person) => entry.personId === person.id,
        // Like the foreign key: the person's entries go with them.
        remove: (person) =>
          (fixtures.entries = fixtures.entries.filter(
            (entry) => entry.personId !== person.id,
          )),
      },
    ),
    ...catalogRoutes(
      'drinks',
      () => fixtures.drinks,
      (id) => ({ id, name: '', points: 0 }),
      {
        field: { name: 'points', error: pointsError },
        uses: (entry, drink) => entry.drinkId === drink.id,
        // Like the foreign key: the drink's entries go with it.
        remove: (drink) =>
          (fixtures.entries = fixtures.entries.filter(
            (entry) => entry.drinkId !== drink.id,
          )),
      },
    ),
    ...catalogRoutes(
      'factors',
      () => fixtures.factors,
      (id) => ({ id, name: '', multiplier: 0 }),
      {
        field: { name: 'multiplier', error: multiplierError },
        uses: (entry, factor) => entry.factorId === factor.id,
        // Like the foreign key: the factor's entries stay and count ×1.
        remove: (factor) => {
          for (const entry of fixtures.entries) {
            if (entry.factorId === factor.id) entry.factorId = null;
          }
        },
      },
    ),
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
      guarded((me, body, { id }) =>
        putEntry(fixtures, id, body, me.account.id),
      ),
    ],
    [
      'DELETE /api/entries/{id}',
      guarded((_me, _body, { id }) => {
        const index = fixtures.entries.findIndex((entry) => entry.id === id);
        if (index === -1) return problem(PROBLEMS.notFound);
        fixtures.entries.splice(index, 1);
        return new Response(null, { status: 204 });
      }),
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
