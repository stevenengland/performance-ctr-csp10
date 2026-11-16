import { requireReload } from '../../pwa/reload-floor';
import type { components, paths } from './schema';

export type Health = components['schemas']['Health'];
export type Account = components['schemas']['Account'];
export type AccountChange = components['schemas']['AccountChange'];
export type Person = components['schemas']['Person'];
export type PersonDetail = components['schemas']['PersonDetail'];
export type Drink = components['schemas']['Drink'];
export type DrinkDetail = components['schemas']['DrinkDetail'];
export type Factor = components['schemas']['Factor'];
export type FactorDetail = components['schemas']['FactorDetail'];
export type Entry = components['schemas']['Entry'];
export type NewEntry = components['schemas']['NewEntry'];
export type HistoryEntry = components['schemas']['HistoryEntry'];
export type Scoreboard = components['schemas']['Scoreboard'];
export type ScoreRow = components['schemas']['ScoreRow'];
export type AuditPage = components['schemas']['AuditPage'];
export type AuditEvent = components['schemas']['AuditEvent'];
export type GameKind = components['schemas']['GameKind'];
export type Game = components['schemas']['Game'];
export type GameDetail = components['schemas']['GameDetail'];
export type NewGame = components['schemas']['NewGame'];
export type GameChange = components['schemas']['GameChange'];
export type Outcome = components['schemas']['Outcome'];
export type NewMatch = components['schemas']['NewMatch'];
export type Match = components['schemas']['Match'];
export type NewResult = components['schemas']['NewResult'];
export type Result = components['schemas']['Result'];
export type Standings = components['schemas']['Standings'];
export type DuelRow = components['schemas']['DuelRow'];
export type PointsRow = components['schemas']['PointsRow'];
export type MatchItem = components['schemas']['MatchItem'];
export type MatchPage = components['schemas']['MatchPage'];
export type ResultItem = components['schemas']['ResultItem'];
export type ResultPage = components['schemas']['ResultPage'];
export type PendingPage = components['schemas']['PendingPage'];
export type PendingItem = components['schemas']['PendingItem'];
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
/**
The server refuses a request from an app below its `minClientVersion` with this
problem, before it processes anything (ADR 0006, decision 3).
*/
const CLIENT_OUTDATED = 'urn:performance:problem:client-outdated';

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
Every request names the app version in `X-Client-Version`, so the server can refuse
an app below its floor; that refusal shows the reload floor. A body is sent as
JSON. An error answer throws its ApiProblem; 304 passes.
*/
async function send(path: ApiPath, init: RequestInit = {}): Promise<Response> {
  const resolved = path.replace(/\{(\w+)\}/g, (_, name: string) =>
    encodeURIComponent(init.params?.[name] ?? ''),
  );
  const query = init.query
    ? `?${new URLSearchParams(init.query).toString()}`
    : '';
  const url = `${import.meta.env.BASE_URL}${resolved.slice(1)}${query}`;
  const headers: Record<string, string> = {
    Accept: 'application/json',
    'X-Client-Version': __APP_VERSION__,
  };
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
    const problem = await ApiProblem.from(response);
    if (problem.type === CLIENT_OUTDATED) requireReload();
    throw problem;
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

/** Grants or revokes admin rights, or resets the password (which signs the account out everywhere). */
export function updateAccount(
  id: number,
  change: AccountChange,
): Promise<Account> {
  return request<Account>('/api/accounts/{id}', {
    method: 'PATCH',
    params: { id: String(id) },
    body: change,
  });
}

/** Deletes the account; the entries it logged stay. */
export function deleteAccount(id: number): Promise<void> {
  return request<undefined>('/api/accounts/{id}', {
    method: 'DELETE',
    params: { id: String(id) },
  });
}

export async function listPersons(): Promise<Person[]> {
  return (await request<{ persons: Person[] }>('/api/persons')).persons;
}

export function createPerson(name: string): Promise<Person> {
  return request<Person>('/api/persons', { method: 'POST', body: { name } });
}

/** A person with the number of their entries, for the delete dialog. */
export function getPerson(id: number): Promise<PersonDetail> {
  return request<PersonDetail>('/api/persons/{id}', {
    params: { id: String(id) },
  });
}

export function updatePerson(id: number, name: string): Promise<Person> {
  return request<Person>('/api/persons/{id}', {
    method: 'PATCH',
    params: { id: String(id) },
    body: { name },
  });
}

/** Sets or replaces the person's photo (any member, any person): a 256 × 256 JPEG in base64. */
export function putPersonPhoto(id: number, image: string): Promise<Person> {
  return request<Person>('/api/persons/{id}/photo', {
    method: 'PUT',
    params: { id: String(id) },
    body: { image },
  });
}

/** Removes the person's photo (any member, any person); without one nothing changes. */
export function deletePersonPhoto(id: number): Promise<void> {
  return request<undefined>('/api/persons/{id}/photo', {
    method: 'DELETE',
    params: { id: String(id) },
  });
}

/** Deletes the person and all of their entries. */
export function deletePerson(id: number): Promise<void> {
  return request<undefined>('/api/persons/{id}', {
    method: 'DELETE',
    params: { id: String(id) },
  });
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

/** A drink with the number of its entries, for the delete dialog. */
export function getDrink(id: number): Promise<DrinkDetail> {
  return request<DrinkDetail>('/api/drinks/{id}', {
    params: { id: String(id) },
  });
}

/** `points` is `null` when the input was no number; the API then answers with its field error. */
export function updateDrink(
  id: number,
  name: string,
  points: number | null,
): Promise<Drink> {
  return request<Drink>('/api/drinks/{id}', {
    method: 'PATCH',
    params: { id: String(id) },
    body: { name, points },
  });
}

/** Deletes the drink and all of its entries. */
export function deleteDrink(id: number): Promise<void> {
  return request<undefined>('/api/drinks/{id}', {
    method: 'DELETE',
    params: { id: String(id) },
  });
}

export async function listFactors(): Promise<Factor[]> {
  return (await request<{ factors: Factor[] }>('/api/factors')).factors;
}

/** A factor with the number of entries that use it, for the delete dialog. */
export function getFactor(id: number): Promise<FactorDetail> {
  return request<FactorDetail>('/api/factors/{id}', {
    params: { id: String(id) },
  });
}

/** `multiplier` is `null` when the input was no number; the API then answers with its field error. */
export function createFactor(
  name: string,
  multiplier: number | null,
): Promise<Factor> {
  return request<Factor>('/api/factors', {
    method: 'POST',
    body: { name, multiplier },
  });
}

export function updateFactor(
  id: number,
  name: string,
  multiplier: number | null,
): Promise<Factor> {
  return request<Factor>('/api/factors/{id}', {
    method: 'PATCH',
    params: { id: String(id) },
    body: { name, multiplier },
  });
}

export function deleteFactor(id: number): Promise<void> {
  return request<undefined>('/api/factors/{id}', {
    method: 'DELETE',
    params: { id: String(id) },
  });
}

export async function listGames(): Promise<Game[]> {
  return (await request<{ games: Game[] }>('/api/games')).games;
}

export function createGame(game: NewGame): Promise<Game> {
  return request<Game>('/api/games', { method: 'POST', body: game });
}

/** A game with the number of its stored matches or results, for the delete dialog. */
export function getGame(id: number): Promise<GameDetail> {
  return request<GameDetail>('/api/games/{id}', {
    params: { id: String(id) },
  });
}

/** Renames the game or changes its kind's setting; the kind itself is fixed. */
export function updateGame(id: number, change: GameChange): Promise<Game> {
  return request<Game>('/api/games/{id}', {
    method: 'PATCH',
    params: { id: String(id) },
    body: change,
  });
}

/** Deletes the game and all of its matches or results. */
export function deleteGame(id: number): Promise<void> {
  return request<undefined>('/api/games/{id}', {
    method: 'DELETE',
    params: { id: String(id) },
  });
}

/** Starts the game's next run from now; the API takes an empty JSON object as its body. */
export function restartGame(id: number): Promise<Game> {
  return request<Game>('/api/games/{id}/restart', {
    method: 'POST',
    params: { id: String(id) },
    body: {},
  });
}

/** A game's ranking with the ETag that names it, to ask on condition of next time. */
export interface StandingsAnswer {
  standings: Standings;
  etag: string | undefined;
}

/**
A game's ranking in its current run, tagged with the game's kind. With the ETag
of the ranking already shown, `unchanged` means it still holds.
*/
export async function getStandings(
  gameId: number,
  etag?: string,
): Promise<StandingsAnswer | 'unchanged'> {
  const response = await send('/api/games/{id}/standings', {
    params: { id: String(gameId) },
    ifNoneMatch: etag,
  });
  if (response.status === NOT_MODIFIED) return 'unchanged';
  return {
    standings: (await response.json()) as Standings,
    etag: response.headers.get('ETag') ?? undefined,
  };
}

/** A page of a duel's matches since its last restart, newest first; `before` (the previous page's `next`) reads older ones. */
export function listMatches(
  gameId: number,
  before?: string,
): Promise<MatchPage> {
  return request<MatchPage>('/api/games/{id}/matches', {
    params: { id: String(gameId) },
    query: before === undefined ? undefined : { before },
  });
}

/** A page of a points game's results since its last restart, newest first; `before` (the previous page's `next`) reads older ones. */
export function listResults(
  gameId: number,
  before?: string,
): Promise<ResultPage> {
  return request<ResultPage>('/api/games/{id}/results', {
    params: { id: String(gameId) },
    query: before === undefined ? undefined : { before },
  });
}

/** Records a match under its client id: repeating it with the same id never records a second one. */
export function putMatch(id: string, match: NewMatch): Promise<Match> {
  return request<Match>('/api/matches/{id}', {
    method: 'PUT',
    params: { id },
    body: match,
  });
}

/** Deletes a match (undo); its id stays known, so a late retry cannot bring it back. */
export function deleteMatch(id: string): Promise<void> {
  return request<undefined>('/api/matches/{id}', {
    method: 'DELETE',
    params: { id },
  });
}

/** Records a result under its client id: repeating it with the same id never records a second one. */
export function putResult(id: string, result: NewResult): Promise<Result> {
  return request<Result>('/api/results/{id}', {
    method: 'PUT',
    params: { id },
    body: result,
  });
}

/** Deletes a result (undo); its id stays known, so a late retry cannot bring it back. */
export function deleteResult(id: string): Promise<void> {
  return request<undefined>('/api/results/{id}', {
    method: 'DELETE',
    params: { id },
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

/** A person's entries since `from`, the start of the viewer's day as a UTC instant, newest first. */
export async function listEntries(
  personId: number,
  from: string,
): Promise<HistoryEntry[]> {
  return (
    await request<{ entries: HistoryEntry[] }>('/api/entries', {
      query: { personId: String(personId), from },
    })
  ).entries;
}

export function deleteEntry(id: string): Promise<void> {
  return request<undefined>('/api/entries/{id}', {
    method: 'DELETE',
    params: { id },
  });
}

/** Lets another account's pending entry count; the API takes an empty JSON object as its body. */
export function verifyEntry(id: string): Promise<void> {
  return request<undefined>('/api/entries/{id}/verification', {
    method: 'PUT',
    params: { id },
    body: {},
  });
}

/** Removes another account's pending entry, so that it never counts. */
export function rejectEntry(id: string): Promise<void> {
  return request<undefined>('/api/entries/{id}/verification', {
    method: 'DELETE',
    params: { id },
  });
}

/** Lets another account's pending match count on both sides; the API takes an empty JSON object as its body. */
export function verifyMatch(id: string): Promise<void> {
  return request<undefined>('/api/matches/{id}/verification', {
    method: 'PUT',
    params: { id },
    body: {},
  });
}

/** Removes another account's pending match, so that it never counts. */
export function rejectMatch(id: string): Promise<void> {
  return request<undefined>('/api/matches/{id}/verification', {
    method: 'DELETE',
    params: { id },
  });
}

/** Lets another account's pending result count. */
export function verifyResult(id: string): Promise<void> {
  return request<undefined>('/api/results/{id}/verification', {
    method: 'PUT',
    params: { id },
    body: {},
  });
}

/** Removes another account's pending result, so that it never counts. */
export function rejectResult(id: string): Promise<void> {
  return request<undefined>('/api/results/{id}/verification', {
    method: 'DELETE',
    params: { id },
  });
}

/** The first page of the pending queue with the ETag that names it, to ask on condition of next time. */
export interface PendingAnswer {
  page: PendingPage;
  etag: string | undefined;
}

/**
The first page of the rows the signed-in account may verify, with the count of
all of them. With the ETag of the page already shown, `unchanged` means it still holds.
*/
export async function getPending(
  etag?: string,
): Promise<PendingAnswer | 'unchanged'> {
  const response = await send('/api/pending', { ifNoneMatch: etag });
  if (response.status === NOT_MODIFIED) return 'unchanged';
  return {
    page: (await response.json()) as PendingPage,
    etag: response.headers.get('ETag') ?? undefined,
  };
}

/** A later page of the pending queue, at the previous page's `next`. */
export function listPending(cursor: string): Promise<PendingPage> {
  return request<PendingPage>('/api/pending', { query: { cursor } });
}

/** A page of the audit log, newest first (admins only); `before` (an event id, the previous page's `next`) reads older events. */
export function listAuditEvents(before?: number): Promise<AuditPage> {
  return request<AuditPage>('/api/audit', {
    query: before === undefined ? undefined : { before: String(before) },
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
