import type { components, paths } from './schema';

export type Health = components['schemas']['Health'];
export type Account = components['schemas']['Account'];
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

/**
The single fetch wrapper: every HTTP call of the app goes through here. It looks
up the global `fetch` on every call, so whatever is installed at that time answers.
A body is sent as JSON; 204 resolves to `undefined`.
*/
async function request<T>(
  path: ApiPath,
  init: { method?: string; body?: unknown } = {},
): Promise<T> {
  const url = `${import.meta.env.BASE_URL}${path.slice(1)}`;
  const headers: Record<string, string> = { Accept: 'application/json' };
  if (init.body !== undefined) headers['Content-Type'] = 'application/json';
  const response = await fetch(url, {
    method: init.method ?? 'GET',
    credentials: 'same-origin',
    headers,
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  });
  if (!response.ok) {
    if (response.status === 401 && path !== '/api/session') unauthorized?.();
    throw await ApiProblem.from(response);
  }
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
