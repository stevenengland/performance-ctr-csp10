import type { PendingItem, PendingPage } from '../src/core/api-client';
import {
  type Backend,
  type Handler,
  json,
  PAGE_SIZE,
  problem,
  PROBLEMS,
  validation,
} from './fixtureHttp';
import { matchSnapshot } from './fixtureGames';
import {
  entrySnapshot,
  type FixtureEntry,
  type FixtureMatch,
  type Fixtures,
} from './fixtures';

/*
The four-eyes rule of the fixture backend (PRD #61), like the API's
Verification: verifying or rejecting another account's pending entry or match,
and the pending queue of the signed-in account.
*/

/** Where the queue goes on after a page, as the API's cursor names it: the last row's instant, kind and id. */
type Position = [createdAt: string, kind: string, id: string];

function positionOf(cursor: string): Position | undefined {
  try {
    const position: unknown = JSON.parse(atob(cursor));
    return Array.isArray(position) &&
      position.length === 3 &&
      position.every((part) => typeof part === 'string')
      ? (position as Position)
      : undefined;
  } catch {
    return undefined;
  }
}

/** Compares by code unit, like the database's binary ids. */
const compare = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

/** The queue's order of two positions: newest first, then by kind, then by id. */
const order = (
  [at, kind, id]: Position,
  [otherAt, otherKind, otherId]: Position,
) => compare(otherAt, at) || compare(kind, otherKind) || compare(id, otherId);

const positionOfItem = ({ createdAt, kind, id }: PendingItem): Position => [
  createdAt,
  kind,
  id,
];

const cursorOf = (item: PendingItem): string =>
  btoa(JSON.stringify(positionOfItem(item)));

const accountNameOf = (fixtures: Fixtures, accountId: number | null) =>
  fixtures.accounts.find(({ account }) => account.id === accountId)?.account
    .userName ?? null;

function entryItem(fixtures: Fixtures, entry: FixtureEntry): PendingItem {
  const nameOf = (list: { id: number; name: string }[], id: number) =>
    list.find((item) => item.id === id)?.name ?? '';
  const factor = fixtures.factors.find(({ id }) => id === entry.factorId);
  return {
    kind: 'entry',
    id: entry.id,
    createdAt: entry.createdAt,
    accountName: accountNameOf(fixtures, entry.accountId),
    person: {
      id: entry.personId,
      name: nameOf(fixtures.persons, entry.personId),
    },
    drink: { id: entry.drinkId, name: nameOf(fixtures.drinks, entry.drinkId) },
    quantity: entry.quantity,
    factor: factor ?? null,
  };
}

function matchItem(fixtures: Fixtures, match: FixtureMatch): PendingItem {
  const game = fixtures.games.find(({ id }) => id === match.gameId);
  const personRef = (personId: number | null) => {
    const person = fixtures.persons.find(({ id }) => id === personId);
    return person ? { id: person.id, name: person.name } : null;
  };
  return {
    kind: 'match',
    id: match.id,
    createdAt: match.createdAt,
    accountName: accountNameOf(fixtures, match.accountId),
    game: { id: match.gameId, name: game?.name ?? '' },
    earlierRun: game !== undefined && match.run < game.run,
    first: personRef(match.firstPersonId),
    second: personRef(match.secondPersonId),
    outcome: match.outcome,
  };
}

/** A kind of row the rule applies to, like the API's VerifiableRows: its rows, its snapshot and its queue item. */
interface Verifiable<
  T extends { id: string; accountId: number | null; pending: boolean },
> {
  kind: PendingItem['kind'];
  path: string;
  rows: (fixtures: Fixtures) => T[];
  snapshot: (fixtures: Fixtures, row: T) => AuditSnapshot;
  item: (fixtures: Fixtures, row: T) => PendingItem;
}

type AuditSnapshot = ReturnType<typeof entrySnapshot>;

const ENTRIES: Verifiable<FixtureEntry> = {
  kind: 'entry',
  path: '/api/entries/{id}/verification',
  rows: (fixtures) => fixtures.entries,
  snapshot: entrySnapshot,
  item: entryItem,
};

const MATCHES: Verifiable<FixtureMatch> = {
  kind: 'match',
  path: '/api/matches/{id}/verification',
  rows: (fixtures) => fixtures.matches,
  snapshot: matchSnapshot,
  item: matchItem,
};

/**
The routes of the four-eyes rule. `unchanged` marks a successful write that
changed nothing, so the revision stays.
*/
export function verificationBackend(
  { fixtures, guarded, record, revision }: Backend,
  unchanged: (response: Response) => Response,
): [string, Handler][] {
  /** The rows of a kind the account may verify: pending, recorded by another account or one deleted since. */
  const eligibleOf = <
    T extends { id: string; accountId: number | null; pending: boolean },
  >(
    { rows, item }: Verifiable<T>,
    accountId: number,
  ) =>
    rows(fixtures)
      .filter((row) => row.pending && row.accountId !== accountId)
      .map((row) => item(fixtures, row));
  /** Every row the account may verify, in the queue's order. */
  const eligible = (accountId: number) =>
    [...eligibleOf(ENTRIES, accountId), ...eligibleOf(MATCHES, accountId)].sort(
      (a, b) => order(positionOfItem(a), positionOfItem(b)),
    );

  /** Verifying and rejecting a row of the kind, like the API's Verification. */
  function decisionRoutes<
    T extends { id: string; accountId: number | null; pending: boolean },
  >({ kind, path, rows, snapshot }: Verifiable<T>): [string, Handler][] {
    return [
      [
        `PUT ${path}`,
        guarded((me, _body, { id }) => {
          const row = rows(fixtures).find((candidate) => candidate.id === id);
          if (!row) return problem(PROBLEMS.notFound);
          if (row.accountId === me.account.id) {
            return problem(PROBLEMS.ownRow);
          }
          const done = new Response(null, { status: 204 });
          if (!row.pending) return unchanged(done);
          const before = snapshot(fixtures, row);
          row.pending = false;
          record(me, 'verify', [kind, id], before, snapshot(fixtures, row));
          return done;
        }),
      ],
      [
        `DELETE ${path}`,
        guarded((me, _body, { id }) => {
          const list = rows(fixtures);
          const index = list.findIndex((candidate) => candidate.id === id);
          const row = list[index];
          if (!row) return problem(PROBLEMS.notFound);
          if (row.accountId === me.account.id) {
            return problem(PROBLEMS.ownRow);
          }
          if (!row.pending) return problem(PROBLEMS.alreadyVerified);
          record(me, 'reject', [kind, id], snapshot(fixtures, row), null);
          list.splice(index, 1);
          return new Response(null, { status: 204 });
        }),
      ],
    ];
  }

  function page(accountId: number, position?: Position): PendingPage {
    const rows = eligible(accountId);
    const rest = position
      ? rows.filter((row) => order(position, positionOfItem(row)) < 0)
      : rows;
    const items = rest.slice(0, PAGE_SIZE);
    const last = items.at(-1);
    return {
      items,
      next: rest.length > PAGE_SIZE && last ? cursorOf(last) : null,
      count: rows.length,
    };
  }

  return [
    [
      'GET /api/pending',
      guarded((me, _body, { query, headers }) => {
        const cursor = query.get('cursor');
        if (cursor !== null) {
          const position = positionOf(cursor);
          if (!position) return validation({ cursor: 'Unbekannte Seite.' });
          return json(page(me.account.id, position));
        }
        // Like the API: the revision and the account, as every account has its own queue.
        const etag = `"${String(revision())}-${String(me.account.id)}"`;
        if (headers.get('If-None-Match') === etag) {
          return new Response(null, { status: 304, headers: { ETag: etag } });
        }
        const response = json(page(me.account.id));
        response.headers.set('ETag', etag);
        return response;
      }),
    ],
    ...decisionRoutes(ENTRIES),
    ...decisionRoutes(MATCHES),
  ];
}
