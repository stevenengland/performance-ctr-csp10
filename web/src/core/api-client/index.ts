import type { components, paths } from './schema';

export type Health = components['schemas']['Health'];
export type Account = components['schemas']['Account'];
export type Person = components['schemas']['Person'];
export type Drink = components['schemas']['Drink'];
export type Entry = components['schemas']['Entry'];
export type NewEntry = components['schemas']['NewEntry'];
export type Scoreboard = components['schemas']['Scoreboard'];
export type ScoreRow = components['schemas']['ScoreRow'];
export type ApiPath = keyof paths;
/** Field errors of a 422 problem, keyed by the API field name. */
export type FieldErrors = Readonly<Record<string, string>>;

/** An error answer of the API: its RFC 9457 problem, or the bare status when the body was none. */
export class ApiProblem extends Error {
  readonly status: number;
  readonly type: string;
  readonly title: string;
  readonly retryAfterSeconds: number | undefined;
  readonly errors: FieldErrors;

  constructor(
    status: number,
    type: string,
    title: string,
    retryAfterSeconds?: number,
    errors: FieldErrors = {},
  ) {
    super(title);
    this.name = 'ApiProblem';
    this.status = status;
    this.type = type;
    this.title = title;
    this.retryAfterSeconds = retryAfterSeconds;
    this.errors = errors;
  }

  static async from(response: Response): Promise<ApiProblem> {
    const retryAfter = Number.parseInt(
      response.headers.get('Retry-After') ?? '',
      10,
    );
    const body = await problemBody(response);
    return new ApiProblem(
      response.status,
      body?.type ?? 'about:blank',
      body?.title ?? response.statusText,
      Number.isNaN(retryAfter) ? undefined : retryAfter,
      body?.errors,
    );
  }
}

async function problemBody(
  response: Response,
): Promise<components['schemas']['Problem'] | undefined> {
  if (
    !response.headers.get('Content-Type')?.includes('application/problem+json')
  ) {
    return undefined;
  }
  return (await response.json()) as components['schemas']['Problem'];
}

type Unauthorized = () => void;
let unauthorized: Unauthorized | undefined;

/**
Called when a request outside `/api/session` answers 401: the session ended on the
server (signed out elsewhere, password changed, expired). The session module
answers `/api/session` itself.
*/
export function onUnauthorized(listener: Unauthorized | undefined): void {
  unauthorized = listener;
}

const NOT_MODIFIED = 304;

interface RequestInit {
  method?: string;
  body?: unknown;
  /** Values of the path's `{placeholders}`. */
  params?: Record<string, string>;
  query?: Record<string, string>;
  /** Asks for an answer only when it differs from the one with this ETag (304 otherwise). */
  ifNoneMatch?: string;
}

/**
The single fetch wrapper: every HTTP call of the app goes through here. It looks
up the global `fetch` on every call, so whatever is installed at that time answers.
A body is sent as JSON. An error answer throws its ApiProblem; 304 passes.
*/
async function send(path: ApiPath, init: RequestInit = {}): Promise<Response> {
  const resolved = path.replace(/\{(\w+)\}/g, (_, name: string) =>
    encodeURIComponent(init.params?.[name] ?? ''),
  );
  const query = init.query
    ? `?${new URLSearchParams(init.query).toString()}`
    : '';
  const url = `${import.meta.env.BASE_URL}${resolved.slice(1)}${query}`;
  const headers: Record<string, string> = { Accept: 'application/json' };
  if (init.body !== undefined) headers['Content-Type'] = 'application/json';
  if (init.ifNoneMatch !== undefined)
    headers['If-None-Match'] = init.ifNoneMatch;
  const response = await fetch(url, {
    method: init.method ?? 'GET',
    credentials: 'same-origin',
    headers,
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  });
  if (!response.ok && response.status !== NOT_MODIFIED) {
    if (response.status === 401 && path !== '/api/session') unauthorized?.();
    throw await ApiProblem.from(response);
  }
  return response;
}

/** A request whose answer is JSON; 204 resolves to `undefined`. */
async function request<T>(path: ApiPath, init: RequestInit = {}): Promise<T> {
  const response = await send(path, init);
  if (response.status === 204) return undefined as T;
  return (await response.json()) as T;
}

export function getHealth(): Promise<Health> {
  return request<Health>('/api/health');
}

export function getSession(): Promise<Account> {
  return request<Account>('/api/session');
}

export function signIn(userName: string, password: string): Promise<Account> {
  return request<Account>('/api/session', {
    method: 'POST',
    body: { userName, password },
  });
}

export function signOut(): Promise<void> {
  return request<undefined>('/api/session', { method: 'DELETE' });
}

export function changePassword(
  currentPassword: string,
  newPassword: string,
): Promise<void> {
  return request<undefined>('/api/session/password', {
    method: 'PUT',
    body: { currentPassword, newPassword },
  });
}

export async function listAccounts(): Promise<Account[]> {
  return (await request<{ accounts: Account[] }>('/api/accounts')).accounts;
}

export function createAccount(
  userName: string,
  password: string,
): Promise<Account> {
  return request<Account>('/api/accounts', {
    method: 'POST',
    body: { userName, password },
  });
}

export async function listPersons(): Promise<Person[]> {
  return (await request<{ persons: Person[] }>('/api/persons')).persons;
}

export function createPerson(name: string): Promise<Person> {
  return request<Person>('/api/persons', { method: 'POST', body: { name } });
}

export async function listDrinks(): Promise<Drink[]> {
  return (await request<{ drinks: Drink[] }>('/api/drinks')).drinks;
}

/** `points` is `null` when the input was no number; the API then answers with its field error. */
export function createDrink(
  name: string,
  points: number | null,
): Promise<Drink> {
  return request<Drink>('/api/drinks', {
    method: 'POST',
    body: { name, points },
  });
}

/** Adds an entry under its client id: repeating it with the same id never adds a second one. */
export function putEntry(id: string, entry: NewEntry): Promise<Entry> {
  return request<Entry>('/api/entries/{id}', {
    method: 'PUT',
    params: { id },
    body: entry,
  });
}

export function deleteEntry(id: string): Promise<void> {
  return request<undefined>('/api/entries/{id}', {
    method: 'DELETE',
    params: { id },
  });
}

/** Standings with the ETag that names them, to ask on condition of next time. */
export interface ScoreboardAnswer {
  board: Scoreboard;
  etag: string | undefined;
}

/**
Standings since `from`, the start of the viewer's day as a UTC instant. With the
ETag of the standings already shown, `unchanged` means they still hold.
*/
export async function getScoreboard(
  from: string,
  etag?: string,
): Promise<ScoreboardAnswer | 'unchanged'> {
  const response = await send('/api/scoreboard', {
    query: { from },
    ifNoneMatch: etag,
  });
  if (response.status === NOT_MODIFIED) return 'unchanged';
  return {
    board: (await response.json()) as Scoreboard,
    etag: response.headers.get('ETag') ?? undefined,
  };
}
