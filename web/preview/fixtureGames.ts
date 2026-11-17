import type {
  AuditEvent,
  Game,
  Match,
  MatchItem,
  ResultItem,
  Standings,
} from '../src/core/api-client';
import {
  type AuditSnapshot,
  type Backend,
  type Body,
  byName,
  ENTRY_ID,
  type Handler,
  idempotent,
  integer,
  json,
  MAX_PAGE_SIZE,
  nameError,
  PAGE_SIZE,
  PERSON_NOT_FOUND,
  problem,
  PROBLEMS,
  sameName,
  text,
  validation,
  wholeNumber,
} from './fixtureHttp';
import type {
  FixtureAccount,
  FixtureGame,
  FixtureMatch,
  FixtureResult,
  Fixtures,
} from './fixtures';
import { daysAnswer } from './fixtureDays';
import {
  contains,
  type Interval,
  tagOf,
  windowAllTimeOrCurrentRun,
} from './fixtureInterval';

/*
The games side of the fixture backend, like the API's Games, Matches and
Results: games and their rankings, recording and undoing matches and results,
each game's Verlauf, and what a game's or a person's deletion does to them.
*/

/**
The game's ranking, like the API's Standings: in its current run, or over a window
or all time across every run (`selection`). A cleared side counts for no one; only
verified matches and results count, each person names their pending ones, and a
person whose rows all wait is listed apart, unranked (PRD #61). The rows of a
window or all time carry the average per result beside the sum.
*/
function standingsOf(
  fixtures: Fixtures,
  game: FixtureGame,
  selection: Interval | 'run' = 'run',
): Standings {
  const nameOf = (personId: number) =>
    fixtures.persons.find(({ id }) => id === personId)?.name ?? '';
  const byNameThenId = (
    a: { name: string; personId: number },
    b: { name: string; personId: number },
  ) => byName(a, b) || a.personId - b.personId;
  const { kind, startedAt } = game;
  if (kind === 'duel') {
    const rows = new Map<number, DuelRow>();
    const count = (
      personId: number | null,
      result: DuelResult,
      pending: boolean,
    ) => {
      if (personId === null) return;
      const row = rows.get(personId) ?? {
        personId,
        name: nameOf(personId),
        points: 0,
        wins: 0,
        draws: 0,
        losses: 0,
        played: 0,
        pendingCount: 0,
      };
      if (pending) {
        row.pendingCount += 1;
      } else {
        row[result] += 1;
        row.played += 1;
        row.points = row.wins + row.draws / 2;
      }
      rows.set(personId, row);
    };
    for (const match of selected(fixtures.matches, game, selection)) {
      const [first, second] = DUEL_RESULTS[match.outcome];
      count(match.firstPersonId, first, match.pending);
      count(match.secondPersonId, second, match.pending);
    }
    const all = [...rows.values()];
    return {
      kind,
      startedAt,
      rows: all
        .filter(({ played }) => played > 0)
        .sort(
          (a, b) =>
            b.points - a.points || b.wins - a.wins || byNameThenId(a, b),
        ),
      unranked: all
        .filter(({ played }) => played === 0)
        .sort(byNameThenId)
        .map(({ personId, name, pendingCount }) => ({
          personId,
          name,
          pendingCount,
        })),
    };
  }
  const rows = new Map<number, PointsRow>();
  for (const result of selected(fixtures.results, game, selection)) {
    const row = rows.get(result.personId) ?? {
      personId: result.personId,
      name: nameOf(result.personId),
      sum: 0,
      results: 0,
      pendingCount: 0,
    };
    if (result.pending) {
      row.pendingCount += 1;
    } else {
      row.sum += result.points;
      row.results += 1;
    }
    rows.set(result.personId, row);
  }
  const all = [...rows.values()];
  const direction = game.lowerWins ? 1 : -1;
  return {
    kind,
    startedAt,
    lowerWins: game.lowerWins,
    rows: all
      .filter(({ results }) => results > 0)
      .sort((a, b) => direction * (a.sum - b.sum) || byNameThenId(a, b))
      .map((row) =>
        selection === 'run'
          ? row
          : {
              personId: row.personId,
              name: row.name,
              sum: row.sum,
              average: averageOf(row),
              results: row.results,
              pendingCount: row.pendingCount,
            },
      ),
    unranked: all
      .filter(({ results }) => results === 0)
      .sort(byNameThenId)
      .map(({ personId, name, pendingCount }) => ({
        personId,
        name,
        pendingCount,
      })),
  };
}

/** The average per result, like the API's: rounded half away from zero to one decimal, in whole numbers. */
function averageOf({ sum, results }: { sum: number; results: number }): number {
  const tenths = Math.floor((20 * Math.abs(sum) + results) / (2 * results));
  return (Math.sign(sum) * tenths) / 10;
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

/** The game's rows of its current run, or of every run recorded in the interval. */
function selected<T extends { gameId: number; run: number; createdAt: string }>(
  rows: T[],
  game: FixtureGame,
  selection: Interval | 'run',
): T[] {
  return rows.filter(
    (row) =>
      row.gameId === game.id &&
      (selection === 'run'
        ? row.run === game.run
        : contains(selection, row.createdAt)),
  );
}

/** A match as the audit log records it; `deleted` names a person whose deletion is being recorded. */
export function matchSnapshot(
  fixtures: Pick<Fixtures, 'games' | 'persons'>,
  match: FixtureMatch,
  deleted?: { id: number; name: string },
): AuditSnapshot {
  const nameOf = (personId: number | null) =>
    [...fixtures.persons, ...(deleted ? [deleted] : [])].find(
      ({ id }) => id === personId,
    )?.name ?? null;
  return {
    game: fixtures.games.find(({ id }) => id === match.gameId)?.name ?? '',
    first: nameOf(match.firstPersonId),
    second: nameOf(match.secondPersonId),
    outcome: match.outcome,
    pending: match.pending,
  };
}

/** A result as the audit log records it; `deleted` names a game or person whose deletion is being recorded. */
export function resultSnapshot(
  fixtures: Pick<Fixtures, 'games' | 'persons'>,
  result: FixtureResult,
  deleted: { game?: string; person?: string } = {},
): AuditSnapshot {
  const nameOf = (rows: { id: number; name: string }[], id: number) =>
    rows.find((row) => row.id === id)?.name ?? '';
  return {
    game: deleted.game ?? nameOf(fixtures.games, result.gameId),
    person: deleted.person ?? nameOf(fixtures.persons, result.personId),
    points: result.points,
    pending: result.pending,
  };
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
200 with the original instant even after the match or its game was deleted;
then the game must be a duel that allows the outcome, and both persons must exist.
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
  const answer = (createdAt: string, status = 200) =>
    json({ id, ...values, createdAt }, status);
  const write = (createdAt: string) => {
    const game = fixtures.games.find(
      ({ id: gameId }) => gameId === values.gameId,
    );
    if (!game) return problem(PROBLEMS.notFound);
    if (game.kind !== 'duel') return validation({ gameId: 'Kein Duell.' });
    if (values.outcome === 'draw' && !game.drawsAllowed) {
      return validation({
        outcome: 'Remis ist in diesem Spiel nicht möglich.',
      });
    }
    const errors: Record<string, string> = {};
    for (const field of ['firstPersonId', 'secondPersonId'] as const) {
      if (!fixtures.persons.some((person) => person.id === values[field])) {
        errors[field] = PERSON_NOT_FOUND;
      }
    }
    if (Object.keys(errors).length > 0) return validation(errors);
    fixtures.matches.push({
      id,
      ...values,
      run: game.run,
      accountId,
      createdAt,
      pending: true,
    });
    return answer(createdAt, 201);
  };
  const fingerprint = JSON.stringify(['match', ...Object.values(values)]);
  return idempotent(
    fixtures,
    id,
    fingerprint,
    PROBLEMS.requestConflict,
    write,
    answer,
  );
}

/** A result's points: whole numbers from −9 999 to 9 999. */
const MAX_RESULT_POINTS = 9999;
const POINTS_ERROR = 'Ganze Zahl von −9.999 bis 9.999.';

/**
Records a result idempotently on its id, like the API's Results: the person and
the points are checked first; a replay answers 200 with the original instant
even after the result or its game was deleted; then the game must be a points
game and the person must exist.
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
  const answer = (createdAt: string, status = 200) =>
    json({ id, ...values, createdAt }, status);
  const write = (createdAt: string) => {
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
    fixtures.results.push({
      id,
      ...values,
      run: game.run,
      accountId,
      createdAt,
      pending: true,
    });
    return answer(createdAt, 201);
  };
  const fingerprint = JSON.stringify(['result', ...Object.values(values)]);
  return idempotent(
    fixtures,
    id,
    fingerprint,
    PROBLEMS.requestConflict,
    write,
    answer,
  );
}

/**
The games' routes and what the catalog's person deletion needs of them. Every
write is recorded in the audit log like the API's.
*/
export function gameBackend({
  fixtures,
  guarded,
  record,
  nextId,
  revision,
}: Backend) {
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
        resultSnapshot(fixtures, result, deleted),
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
      const before = matchSnapshot(fixtures, match, person);
      if (match.firstPersonId === person.id) match.firstPersonId = null;
      if (match.secondPersonId === person.id) match.secondPersonId = null;
      record(
        me,
        'update',
        ['match', match.id],
        before,
        matchSnapshot(fixtures, match),
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
            .map((match) => [match, matchSnapshot(fixtures, match)] as const);
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
              pending: match.pending,
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
              pending: result.pending,
            }),
          );
        }),
      ],
      [
        'GET /api/games/{id}/standings',
        guarded((_me, _body, { id, headers, query }) => {
          // Like the API: the selection is checked before the game is looked for.
          const selection = windowAllTimeOrCurrentRun(query);
          if (selection instanceof Response) return selection;
          const game = find(id);
          if (!game) return problem(PROBLEMS.notFound);
          // Like the API: the data revision and, for a window or all time, the selection.
          const etag =
            selection === 'run'
              ? `"${String(revision())}"`
              : `"${String(revision())}-${tagOf(selection)}"`;
          if (headers.get('If-None-Match') === etag) {
            return new Response(null, { status: 304, headers: { ETag: etag } });
          }
          const response = json(standingsOf(fixtures, game, selection));
          response.headers.set('ETag', etag);
          return response;
        }),
      ],
      [
        'GET /api/games/{id}/standings/days',
        guarded((_me, _body, request) => {
          const game = find(request.id);
          if (!game) return problem(PROBLEMS.notFound);
          // Like the API: one instant per verified match while a side names a person.
          const counted = [
            ...fixtures.matches.filter(
              (match) =>
                match.gameId === game.id &&
                !match.pending &&
                (match.firstPersonId !== null || match.secondPersonId !== null),
            ),
            ...fixtures.results.filter(
              (result) => result.gameId === game.id && !result.pending,
            ),
          ];
          return daysAnswer(
            request,
            revision(),
            counted.map(({ createdAt }) => createdAt),
          );
        }),
      ],
    ];
  }

  /** Whether another game than `game` has the name, ignoring case. */
  const taken = (name: string, game?: FixtureGame) =>
    fixtures.games.some(
      (other) => other !== game && sameName(other.name, name),
    );

  /** Recording and undoing a match or a result; only a new one is a change. */
  function recordRoutes(): [string, Handler][] {
    return [
      [
        'PUT /api/matches/{id}',
        guarded((me, body, { id }) => {
          const response = putMatch(fixtures, id, body, me.account.id);
          const match = fixtures.matches.find(
            (candidate) => candidate.id === id,
          );
          // Only a new match is a change: a replay answers 200 and records nothing.
          if (response.status === 201 && match) {
            record(
              me,
              'create',
              ['match', id],
              null,
              matchSnapshot(fixtures, match),
            );
          }
          return response;
        }),
      ],
      [
        'DELETE /api/matches/{id}',
        guarded((me, _body, { id }) => {
          const match = fixtures.matches.find(
            (candidate) => candidate.id === id,
          );
          if (!match) return problem(PROBLEMS.notFound);
          record(
            me,
            'delete',
            ['match', id],
            matchSnapshot(fixtures, match),
            null,
          );
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
            record(
              me,
              'create',
              ['result', id],
              null,
              resultSnapshot(fixtures, result),
            );
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
          record(
            me,
            'delete',
            ['result', id],
            resultSnapshot(fixtures, result),
            null,
          );
          fixtures.results.splice(fixtures.results.indexOf(result), 1);
          return new Response(null, { status: 204 });
        }),
      ],
    ];
  }

  return {
    routes: [...gameRoutes(), ...recordRoutes()],
    /** A person's matches and results, for the delete dialog. */
    personCounts: (personId: number) => ({
      matchCount: matchCountOf(personId),
      resultCount: fixtures.results.filter(
        (result) => result.personId === personId,
      ).length,
    }),
    clearPerson,
  };
}
