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
import { entrySnapshot, type FixtureEntry, type Fixtures } from './fixtures';

/*
The four-eyes rule of the fixture backend (PRD #61), like the API's
Verification: verifying or rejecting another account's pending entry, and the
pending queue of the signed-in account.
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

function pendingItem(fixtures: Fixtures, entry: FixtureEntry): PendingItem {
  const nameOf = (list: { id: number; name: string }[], id: number) =>
    list.find((item) => item.id === id)?.name ?? '';
  const factor = fixtures.factors.find(({ id }) => id === entry.factorId);
  return {
    kind: 'entry',
    id: entry.id,
    createdAt: entry.createdAt,
    accountName:
      fixtures.accounts.find(({ account }) => account.id === entry.accountId)
        ?.account.userName ?? null,
    person: {
      id: entry.personId,
      name: nameOf(fixtures.persons, entry.personId),
    },
    drink: { id: entry.drinkId, name: nameOf(fixtures.drinks, entry.drinkId) },
    quantity: entry.quantity,
    factor: factor ?? null,
  };
}

/**
The routes of the four-eyes rule. `unchanged` marks a successful write that
changed nothing, so the revision stays.
*/
export function verificationBackend(
  { fixtures, guarded, record, revision }: Backend,
  unchanged: (response: Response) => Response,
): [string, Handler][] {
  /** The rows the account may verify: pending, recorded by another account or one deleted since. */
  const eligible = (accountId: number) =>
    fixtures.entries
      .filter((entry) => entry.pending && entry.accountId !== accountId)
      .map((entry) => pendingItem(fixtures, entry))
      .sort((a, b) => order(positionOfItem(a), positionOfItem(b)));

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
    [
      'PUT /api/entries/{id}/verification',
      guarded((me, _body, { id }) => {
        const entry = fixtures.entries.find((candidate) => candidate.id === id);
        if (!entry) return problem(PROBLEMS.notFound);
        if (entry.accountId === me.account.id) {
          return problem(PROBLEMS.ownRow);
        }
        const done = new Response(null, { status: 204 });
        if (!entry.pending) return unchanged(done);
        const before = entrySnapshot(fixtures, entry);
        entry.pending = false;
        record(
          me,
          'verify',
          ['entry', id],
          before,
          entrySnapshot(fixtures, entry),
        );
        return done;
      }),
    ],
    [
      'DELETE /api/entries/{id}/verification',
      guarded((me, _body, { id }) => {
        const index = fixtures.entries.findIndex(
          (candidate) => candidate.id === id,
        );
        const entry = fixtures.entries[index];
        if (!entry) return problem(PROBLEMS.notFound);
        if (entry.accountId === me.account.id) {
          return problem(PROBLEMS.ownRow);
        }
        if (!entry.pending) return problem(PROBLEMS.alreadyVerified);
        record(
          me,
          'reject',
          ['entry', id],
          entrySnapshot(fixtures, entry),
          null,
        );
        fixtures.entries.splice(index, 1);
        return new Response(null, { status: 204 });
      }),
    ],
  ];
}
