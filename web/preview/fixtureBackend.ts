import type { Entry, ScoreRow, Scoreboard } from '../src/core/api-client';
import type { components } from '../src/core/api-client/schema';
import type { FixtureAccount, Fixtures } from './fixtures';

type Problem = components['schemas']['Problem'];
type Body = Record<string, unknown>;

/** What a route gets of its request. */
interface Request {
  body: Body;
  /** The path's `{id}`, for routes that have one. */
  id: string;
  query: URLSearchParams;
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
const MAX_QUANTITY = 99;
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

function pointsError(points: unknown): string | undefined {
  const valid =
    typeof points === 'number' &&
    points >= 0 &&
    points <= MAX_POINTS &&
    Math.abs(points * 100 - Math.round(points * 100)) < 1e-6;
  return valid ? undefined : 'Zahl von 0 bis 9.999,99.';
}

/** The day's standings, aggregated like the API's Scoreboard. */
function scoreboard(fixtures: Fixtures, from: Date): Scoreboard {
  const rows = new Map<number, ScoreRow>();
  for (const entry of fixtures.entries) {
    if (new Date(entry.createdAt) < from) continue;
    const person = fixtures.persons.find(({ id }) => id === entry.personId);
    const drink = fixtures.drinks.find(({ id }) => id === entry.drinkId);
    if (!person || !drink) continue;
    const row = rows.get(person.id) ?? {
      personId: person.id,
      name: person.name,
      score: 0,
      count: 0,
      drinks: [],
    };
    row.score += entry.quantity * drink.points;
    row.count += entry.quantity;
    const counter = row.drinks.find(({ drinkId }) => drinkId === drink.id);
    if (counter) counter.count += entry.quantity;
    else
      row.drinks.push({
        drinkId: drink.id,
        name: drink.name,
        count: entry.quantity,
      });
    rows.set(person.id, row);
  }
  const round = (value: number) => Math.round(value * 100) / 100;
  return {
    rows: [...rows.values()]
      .map((row) => ({
        ...row,
        score: round(row.score),
        drinks: row.drinks.sort(byName),
      }))
      .sort((a, b) => b.score - a.score || byName(a, b)),
  };
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

/** `/api/entries/<uuid>` → the route `/api/entries/{id}` and its id. */
function routeOf(path: string): { route: string; id: string } {
  const match = /^\/api\/entries\/([^/]+)$/.exec(path);
  return match?.[1] && ENTRY_ID.test(match[1])
    ? { route: '/api/entries/{id}', id: match[1] }
    : { route: path, id: '' };
}

/**
The in-memory API: the same answers as the real one for the routes the app uses
so far, with the session kept in memory (signing out and in again works).
*/
function routesOf(fixtures: Fixtures) {
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
      'GET /api/persons',
      guarded(() => json({ persons: [...fixtures.persons].sort(byName) })),
    ],
    [
      'POST /api/persons',
      guarded((_me, body) => {
        const name = text(body, 'name').trim();
        const error = nameError(name);
        if (error) return validation({ name: error });
        if (fixtures.persons.some((person) => sameName(person.name, name))) {
          return problem(PROBLEMS.duplicateName);
        }
        const person = { id: nextId(fixtures.persons), name };
        fixtures.persons.push(person);
        return json(person, 201);
      }),
    ],
    [
      'GET /api/drinks',
      guarded(() => json({ drinks: [...fixtures.drinks].sort(byName) })),
    ],
    [
      'POST /api/drinks',
      guarded((_me, body) => {
        const name = text(body, 'name').trim();
        const errors: Record<string, string> = {};
        const invalidName = nameError(name);
        if (invalidName) errors.name = invalidName;
        const invalidPoints = pointsError(body.points);
        if (invalidPoints) errors.points = invalidPoints;
        if (Object.keys(errors).length > 0) return validation(errors);
        if (fixtures.drinks.some((drink) => sameName(drink.name, name))) {
          return problem(PROBLEMS.duplicateName);
        }
        const drink = {
          id: nextId(fixtures.drinks),
          name,
          points: body.points as number,
        };
        fixtures.drinks.push(drink);
        return json(drink, 201);
      }),
    ],
    [
      'PUT /api/entries/{id}',
      guarded((_me, body, { id }) => putEntry(fixtures, id, body)),
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
      guarded((_me, _body, { query }) => {
        const from = new Date(query.get('from') ?? '');
        if (Number.isNaN(from.getTime())) {
          return validation({ from: 'Zeitpunkt nach ISO 8601 mit Zeitzone.' });
        }
        return json(scoreboard(fixtures, from));
      }),
    ],
  ]);
}

/** Adds an entry idempotently on its id, like the API's EntryLedger. */
function putEntry(fixtures: Fixtures, id: string, body: Body): Response {
  const quantity = integer(body, 'quantity');
  if (quantity === undefined || quantity < 1 || quantity > MAX_QUANTITY) {
    return validation({ quantity: `1 bis ${String(MAX_QUANTITY)}.` });
  }
  const personId = integer(body, 'personId');
  const drinkId = integer(body, 'drinkId');
  const fingerprint = JSON.stringify([personId, drinkId, quantity]);
  const known = fixtures.entryRequests.get(id);
  if (known !== undefined) {
    if (known !== fingerprint) return problem(PROBLEMS.entryConflict);
    const entry = fixtures.entries.find((candidate) => candidate.id === id);
    return json(entry ?? { id, personId, drinkId, quantity, createdAt: '' });
  }
  const errors: Record<string, string> = {};
  if (!fixtures.persons.some((person) => person.id === personId)) {
    errors.personId = 'Person nicht gefunden.';
  }
  if (!fixtures.drinks.some((drink) => drink.id === drinkId)) {
    errors.drinkId = 'Getränk nicht gefunden.';
  }
  if (Object.keys(errors).length > 0) return validation(errors);
  const entry: Entry = {
    id,
    personId: personId ?? 0,
    drinkId: drinkId ?? 0,
    quantity,
    createdAt: new Date().toISOString(),
  };
  fixtures.entryRequests.set(id, fingerprint);
  fixtures.entries.push(entry);
  return json(entry, 201);
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
  const routes = routesOf(fixtures);
  globalThis.fetch = async (input, init) => {
    const method = (
      init?.method ??
      (input instanceof globalThis.Request ? input.method : 'GET')
    ).toUpperCase();
    const url = urlOf(input);
    const { route, id } = routeOf(apiPath(url));
    const handle = routes.get(`${method} ${route}`);
    if (!handle) return problem(PROBLEMS.maintenance);
    return handle({
      body: await bodyOf(input, init),
      id,
      query: url.searchParams,
    });
  };
}
