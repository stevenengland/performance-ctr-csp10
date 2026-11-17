import type { AuditEvent } from '../src/core/api-client';
import type { components } from '../src/core/api-client/schema';
import type { FixtureAccount, Fixtures } from './fixtures';

/*
What every part of the fixture backend shares: answers and problems as the API
sends them, the API's input rules that more than one resource uses, and the
backend's own services a resource's routes are built on.
*/

export type Problem = components['schemas']['Problem'];
export type AuditSnapshot = components['schemas']['AuditSnapshot'];
export type Body = Record<string, unknown>;

/** What a route gets of its request. */
export interface RouteRequest {
  body: Body;
  /** The path's `{id}`, for routes that have one. */
  id: string;
  query: URLSearchParams;
  headers: Headers;
}
export type Handler = (request: RouteRequest) => Response;

export function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

export function problem(value: Problem): Response {
  return new Response(JSON.stringify(value), {
    status: value.status,
    headers: { 'Content-Type': 'application/problem+json' },
  });
}

export const PROBLEMS = {
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
  ownRow: {
    type: 'urn:performance:problem:own-row',
    title: 'Das muss ein anderes Konto bestätigen.',
    status: 403,
  },
  alreadyVerified: {
    type: 'urn:performance:problem:already-verified',
    title: 'Wurde schon bestätigt.',
    status: 409,
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

const MAX_NAME = 40;
/** Pages of the audit log and of a game's Verlauf, as the API reads them. */
export const PAGE_SIZE = 20;
export const MAX_PAGE_SIZE = 100;
export const PERSON_NOT_FOUND = 'Person nicht gefunden.';
/** A client-chosen id of an entry, match or result: a version-4 UUID. */
export const ENTRY_ID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

export function validation(errors: Record<string, string>): Response {
  return problem({
    type: 'urn:performance:problem:validation',
    title: 'Bitte Eingaben prüfen',
    status: 422,
    errors,
  });
}

export function text(body: Body, field: string): string {
  const value = body[field];
  return typeof value === 'string' ? value : '';
}

export function integer(body: Body, field: string): number | undefined {
  const value = body[field];
  return Number.isInteger(value) ? (value as number) : undefined;
}

export const sameName = (a: string, b: string) =>
  a.localeCompare(b, 'de', { sensitivity: 'accent' }) === 0;
export const byName = (a: { name: string }, b: { name: string }) =>
  a.name.localeCompare(b.name, 'de', { sensitivity: 'base' });

export function nameError(name: string): string | undefined {
  const length = [...name].length;
  return length < 1 || length > MAX_NAME
    ? `1 bis ${String(MAX_NAME)} Zeichen.`
    : undefined;
}

/** A whole number in a query, as the API reads one; anything else is 0, which no route accepts. */
export function wholeNumber(value: string): number {
  return /^\d{1,18}$/.test(value) ? Number(value) : 0;
}

/**
Runs a write on a client-chosen id once, like the API's Idempotency: a known id
with the same content is a replay that answers the original instant, even after
the written row was removed; with other content it is a conflict. Only a write
that succeeds keeps its id.
*/
export function idempotent(
  fixtures: Fixtures,
  id: string,
  fingerprint: string,
  conflict: Problem,
  write: (createdAt: string) => Response,
  replay: (createdAt: string) => Response,
): Response {
  const known = fixtures.idempotencyKeys.get(id);
  if (known) {
    return known.fingerprint === fingerprint
      ? replay(known.createdAt)
      : problem(conflict);
  }
  const createdAt = new Date().toISOString();
  const response = write(createdAt);
  if (response.ok) fixtures.idempotencyKeys.set(id, { fingerprint, createdAt });
  return response;
}

/** What the backend gives a resource's routes: its data and its shared services. */
export interface Backend {
  fixtures: Fixtures;
  /** Wraps a route that needs a session (and maybe an admin). */
  guarded: (
    handle: (me: FixtureAccount, body: Body, request: RouteRequest) => Response,
    admin?: boolean,
  ) => Handler;
  /** Appends the event of a write that took effect; see `routesOf`. */
  record: (
    me: FixtureAccount,
    operation: AuditEvent['operation'],
    subject: [AuditEvent['subjectKind'], string],
    before: AuditEvent['before'],
    after: AuditEvent['after'],
    cause?: AuditEvent,
  ) => AuditEvent | undefined;
  /** The next free integer id of a collection. */
  nextId: (items: { id: number }[]) => number;
  /** The data revision, which names the rankings' ETags. */
  revision: () => number;
}
