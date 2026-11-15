import type { components } from '../src/core/api-client/schema';
import type { FixtureAccount, Fixtures } from './fixtures';

type Problem = components['schemas']['Problem'];
type Body = Record<string, unknown>;

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
} satisfies Record<string, Problem>;

const MIN_PASSWORD = 10;
const MAX_USER_NAME = 40;

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

function passwordError(password: string): string | undefined {
  return [...password].length < MIN_PASSWORD
    ? `Mindestens ${String(MIN_PASSWORD)} Zeichen.`
    : undefined;
}

/** The API path of a request, wherever the preview is published (`…/api/health` → `/api/health`). */
function apiPath(input: RequestInfo | URL): string {
  const url = new URL(
    input instanceof Request ? input.url : String(input),
    window.location.href,
  );
  const index = url.pathname.lastIndexOf('/api/');
  return index === -1 ? url.pathname : url.pathname.slice(index);
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
    (handle: (me: FixtureAccount, body: Body) => Response, admin = false) =>
    (body: Body): Response => {
      const me = signedIn();
      if (!me) return problem(PROBLEMS.unauthenticated);
      if (admin && !me.account.isAdmin) return problem(PROBLEMS.forbidden);
      return handle(me, body);
    };

  return new Map<string, (body: Body) => Response>([
    ['GET /api/health', () => json(fixtures.health)],
    [
      'POST /api/session',
      (body) => {
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
  ]);
}

async function bodyOf(
  input: RequestInfo | URL,
  init: RequestInit | undefined,
): Promise<Body> {
  const raw =
    init?.body ?? (input instanceof Request ? await input.text() : undefined);
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
      init?.method ?? (input instanceof Request ? input.method : 'GET')
    ).toUpperCase();
    const route = routes.get(`${method} ${apiPath(input)}`);
    if (!route) return problem(PROBLEMS.maintenance);
    return route(await bodyOf(input, init));
  };
}
