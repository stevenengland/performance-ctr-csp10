import type {
  AuditEvent,
  Entry,
  HistoryEntry,
  Person,
  ScoreRow,
  Scoreboard,
} from '../src/core/api-client';
import { gameBackend } from './fixtureGames';
import {
  type AuditSnapshot,
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
  problem,
  PROBLEMS,
  type RouteRequest,
  sameName,
  text,
  validation,
  wholeNumber,
} from './fixtureHttp';
import {
  causeOf,
  entrySnapshot,
  type FixtureAccount,
  type FixtureEntry,
  type Fixtures,
} from './fixtures';

const MIN_PASSWORD = 10;
const MAX_PASSWORD_BYTES = 72;
const MAX_USER_NAME = 40;
const MAX_POINTS = 9999.99;
const MAX_MULTIPLIER = 99.99;
const MAX_QUANTITY = 99;
/** A positive integer id in a query, as the API's routes accept it. */
const QUERY_ID = /^[1-9]\d{0,9}$/;
/**
A photo upload the preview takes: base64 that starts like a JPEG (`FF D8 FF`),
at most the API's 87 384 characters. Unlike the API it does not walk the JPEG.
*/
const BASE64_JPEG =
  /^\/9j\/(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;
const MAX_PHOTO_CHARACTERS = 87_384;
const INVALID_PHOTO = 'Kein gültiges Foto (JPEG, 256 × 256, höchstens 64 KB).';

/**
A person as the audit log records them, like the API's `{name, photo}`. The
preview has no photo versions, so its photo URL stands in for the version;
Protokoll never shows it.
*/
const personValues = ({ name, photoUrl }: Person): AuditSnapshot => ({
  name,
  photo: photoUrl,
});

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
      photoUrl: person.photoUrl,
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

/** The API's password policy (`PasswordPolicy.php`); the maximum counts UTF-8 bytes, as bcrypt does. */
function passwordError(password: string): string | undefined {
  if ([...password].length < MIN_PASSWORD) {
    return `Mindestens ${String(MIN_PASSWORD)} Zeichen.`;
  }
  return new TextEncoder().encode(password).length > MAX_PASSWORD_BYTES
    ? `Höchstens ${String(MAX_PASSWORD_BYTES)} Byte (Umlaute zählen doppelt).`
    : undefined;
}

/** A page of the audit log, newest first, like the API's AuditLog; `next` only when an older event exists. */
function auditPage(audit: AuditEvent[], query: URLSearchParams): Response {
  const before = query.get('before');
  const limit = wholeNumber(query.get('limit') ?? String(PAGE_SIZE));
  const errors: Record<string, string> = {};
  if (before !== null && wholeNumber(before) < 1) {
    errors.before = 'Positive ganze Zahl.';
  }
  if (limit < 1 || limit > MAX_PAGE_SIZE) {
    errors.limit = `1 bis ${String(MAX_PAGE_SIZE)}.`;
  }
  if (Object.keys(errors).length > 0) return validation(errors);
  const older = audit
    .filter(({ id }) => before === null || id < Number(before))
    .sort((a, b) => b.id - a.id);
  const events = older.slice(0, limit);
  const next = older.length > limit ? (events.at(-1)?.id ?? null) : null;
  return json({ events, next });
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

/** `/api/entries/<uuid>` → the route `/api/entries/{id}` and its id; likewise `/api/matches/<uuid>`, `/api/results/<uuid>`, `/api/persons/<n>`, `/api/persons/<n>/photo`, `/api/games/<n>/standings`, `/api/games/<n>/matches`, … */
function routeOf(path: string): { route: string; id: string } {
  const record = /^\/api\/(entries|matches|results)\/([^/]+)$/.exec(path);
  if (record?.[1] && record[2] && ENTRY_ID.test(record[2])) {
    return { route: `/api/${record[1]}/{id}`, id: record[2] };
  }
  const item =
    /^\/api\/(persons|drinks|factors|accounts|games)\/([1-9]\d*)(\/restart|\/standings|\/matches|\/results|\/photo)?$/.exec(
      path,
    );
  if (item?.[1] && item[2]) {
    return { route: `/api/${item[1]}/{id}${item[3] ?? ''}`, id: item[2] };
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

  const accountOf = (id: string) =>
    fixtures.accounts.find(({ account }) => account.id === Number(id));
  /** Whether removing the account's admin rights would leave no admin. */
  const isLastAdmin = ({ account }: FixtureAccount) =>
    account.isAdmin &&
    fixtures.accounts.filter((other) => other.account.isAdmin).length === 1;
  /** The preview has one session: it ends when its account is reset or deleted. */
  const signOutEverywhere = ({ account }: FixtureAccount) => {
    if (fixtures.signedIn === account.id) fixtures.signedIn = null;
  };

  /** Wraps a route that needs a session (and maybe an admin). */
  const guarded =
    (
      handle: (
        me: FixtureAccount,
        body: Body,
        request: RouteRequest,
      ) => Response,
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
  Appends the event of a write that took effect, by the signed-in account, like
  the API's AuditLog: an update that changed no value records nothing. A deletion's
  event is the `cause` of what the deletion does to entries.
  */
  const record = (
    { account }: FixtureAccount,
    operation: AuditEvent['operation'],
    [subjectKind, subjectId]: [AuditEvent['subjectKind'], string],
    before: AuditEvent['before'],
    after: AuditEvent['after'],
    cause?: AuditEvent,
  ): AuditEvent | undefined => {
    if (
      operation === 'update' &&
      JSON.stringify(before) === JSON.stringify(after)
    ) {
      return undefined;
    }
    const event: AuditEvent = {
      id: nextId(fixtures.audit),
      occurredAt: new Date().toISOString(),
      operation,
      subjectKind,
      subjectId,
      actor: { accountId: account.id, userName: account.userName },
      before,
      after,
      cause: cause ? causeOf(cause) : null,
    };
    fixtures.audit.push(event);
    return event;
  };

  const games = gameBackend({ fixtures, guarded, record, nextId, revision });

  /**
  List, create, read (with the entry count of every day), edit and delete of one
  catalog collection; `remove` does what the API's foreign key does to entries.
  */
  function catalogRoutes<T extends Named>(
    [collection, kind]:
      ['persons', 'person'] | ['drinks', 'drink'] | ['factors', 'factor'],
    list: () => T[],
    create: (id: number) => T,
    rules: {
      field?: Field<T>;
      /** The values the audit log records of an item: the fields its writes set, not its id. */
      values: (item: T) => AuditSnapshot;
      uses: (entry: Entry, item: T) => boolean;
      remove: (item: T) => void;
      /** Counts of other dependents besides entries, for the delete dialog. */
      counts?: (item: T) => Record<string, number>;
      /** What the deletion does to other dependents, recorded as caused by it. */
      cascade?: (me: FixtureAccount, item: T, cause?: AuditEvent) => void;
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
        guarded((me, body) => {
          const item = create(nextId(list()));
          const response = saveNamed(list(), item, body, 201, rules.field);
          if (response.ok) {
            record(
              me,
              'create',
              [kind, String(item.id)],
              null,
              rules.values(item),
            );
          }
          return response;
        }),
      ],
      [
        `GET ${path}/{id}`,
        guarded((_me, _body, { id }) => {
          const item = find(id);
          if (!item) return problem(PROBLEMS.notFound);
          const entryCount = fixtures.entries.filter((entry) =>
            rules.uses(entry, item),
          ).length;
          return json({ ...item, entryCount, ...rules.counts?.(item) });
        }),
      ],
      [
        `PATCH ${path}/{id}`,
        guarded((me, body, { id }) => {
          const item = find(id);
          if (!item) return problem(PROBLEMS.notFound);
          const before = rules.values(item);
          const response = saveNamed(list(), item, body, 200, rules.field);
          if (response.ok) {
            record(me, 'update', [kind, id], before, rules.values(item));
          }
          return response;
        }),
      ],
      [
        `DELETE ${path}/{id}`,
        guarded((me, _body, { id }) => {
          const item = find(id);
          if (!item) return problem(PROBLEMS.notFound);
          const affected = fixtures.entries
            .filter((entry) => rules.uses(entry, item))
            .sort((a, b) => a.id.localeCompare(b.id))
            .map((entry) => [entry, entrySnapshot(fixtures, entry)] as const);
          list().splice(list().indexOf(item), 1);
          rules.remove(item);
          const cause = record(
            me,
            'delete',
            [kind, id],
            rules.values(item),
            null,
          );
          // One event per entry, in id order: changed if it stayed (a factor's), else deleted.
          for (const [entry, before] of affected) {
            const stayed = fixtures.entries.includes(entry);
            record(
              me,
              stayed ? 'update' : 'delete',
              ['entry', entry.id],
              before,
              stayed ? entrySnapshot(fixtures, entry) : null,
              cause,
            );
          }
          rules.cascade?.(me, item, cause);
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
    [
      'PATCH /api/accounts/{id}',
      guarded((_me, body, { id }) => {
        const target = accountOf(id);
        if (!target) return problem(PROBLEMS.notFound);
        const { isAdmin } = body;
        if (isAdmin != null && typeof isAdmin !== 'boolean') {
          return validation({ isAdmin: 'Ja oder nein.' });
        }
        const password =
          body.password == null ? undefined : text(body, 'password');
        const weak =
          password === undefined ? undefined : passwordError(password);
        if (weak) return validation({ password: weak });
        if (isAdmin === false && isLastAdmin(target)) {
          return problem(PROBLEMS.lastAdmin);
        }
        if (typeof isAdmin === 'boolean') target.account.isAdmin = isAdmin;
        if (password !== undefined) {
          target.password = password;
          signOutEverywhere(target);
        }
        return json(target.account);
      }, true),
    ],
    [
      'DELETE /api/accounts/{id}',
      guarded((_me, _body, { id }) => {
        const target = accountOf(id);
        if (!target) return problem(PROBLEMS.notFound);
        if (isLastAdmin(target)) return problem(PROBLEMS.lastAdmin);
        fixtures.accounts.splice(fixtures.accounts.indexOf(target), 1);
        signOutEverywhere(target);
        // Like the foreign key: the account's entries stay, without it.
        for (const entry of fixtures.entries) {
          if (entry.accountId === target.account.id) entry.accountId = null;
        }
        return new Response(null, { status: 204 });
      }, true),
    ],
    ...catalogRoutes(
      ['persons', 'person'],
      () => fixtures.persons,
      (id) => ({ id, name: '', photoUrl: null }),
      {
        values: personValues,
        uses: (entry, person) => entry.personId === person.id,
        // Like the foreign key: the person's entries go with them.
        remove: (person) =>
          (fixtures.entries = fixtures.entries.filter(
            (entry) => entry.personId !== person.id,
          )),
        counts: (person) => games.personCounts(person.id),
        cascade: games.clearPerson,
      },
    ),
    [
      // Any member, any person. The preview keeps the upload as a data: URL in
      // place of the API's versioned URL (the artifact host allows data: images).
      'PUT /api/persons/{id}/photo',
      guarded((me, body, { id }) => {
        const person = fixtures.persons.find((item) => item.id === Number(id));
        if (!person) return problem(PROBLEMS.notFound);
        const { image } = body;
        if (
          typeof image !== 'string' ||
          image.length > MAX_PHOTO_CHARACTERS ||
          !BASE64_JPEG.test(image)
        ) {
          return validation({ image: INVALID_PHOTO });
        }
        const before = personValues(person);
        person.photoUrl = `data:image/jpeg;base64,${image}`;
        record(me, 'update', ['person', id], before, personValues(person));
        return json(person);
      }),
    ],
    [
      // Any member, any person; without a photo nothing changes, like the API.
      'DELETE /api/persons/{id}/photo',
      guarded((me, _body, { id }) => {
        const person = fixtures.persons.find((item) => item.id === Number(id));
        if (!person) return problem(PROBLEMS.notFound);
        const before = personValues(person);
        person.photoUrl = null;
        record(me, 'update', ['person', id], before, personValues(person));
        return new Response(null, { status: 204 });
      }),
    ],
    ...catalogRoutes(
      ['drinks', 'drink'],
      () => fixtures.drinks,
      (id) => ({ id, name: '', points: 0 }),
      {
        field: { name: 'points', error: pointsError },
        values: ({ name, points }) => ({ name, points }),
        uses: (entry, drink) => entry.drinkId === drink.id,
        // Like the foreign key: the drink's entries go with it.
        remove: (drink) =>
          (fixtures.entries = fixtures.entries.filter(
            (entry) => entry.drinkId !== drink.id,
          )),
      },
    ),
    ...catalogRoutes(
      ['factors', 'factor'],
      () => fixtures.factors,
      (id) => ({ id, name: '', multiplier: 0 }),
      {
        field: { name: 'multiplier', error: multiplierError },
        values: ({ name, multiplier }) => ({ name, multiplier }),
        uses: (entry, factor) => entry.factorId === factor.id,
        // Like the foreign key: the factor's entries stay and count ×1.
        remove: (factor) => {
          for (const entry of fixtures.entries) {
            if (entry.factorId === factor.id) entry.factorId = null;
          }
        },
      },
    ),
    ...games.routes,
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
      guarded((me, body, { id }) => {
        const response = putEntry(fixtures, id, body, me.account.id);
        const entry = fixtures.entries.find((candidate) => candidate.id === id);
        // Only a new entry is a change: a replay answers 200 and records nothing.
        if (response.status === 201 && entry) {
          record(
            me,
            'create',
            ['entry', id],
            null,
            entrySnapshot(fixtures, entry),
          );
        }
        return response;
      }),
    ],
    [
      'DELETE /api/entries/{id}',
      guarded((me, _body, { id }) => {
        const index = fixtures.entries.findIndex((entry) => entry.id === id);
        const entry = fixtures.entries[index];
        if (!entry) return problem(PROBLEMS.notFound);
        record(
          me,
          'delete',
          ['entry', id],
          entrySnapshot(fixtures, entry),
          null,
        );
        fixtures.entries.splice(index, 1);
        return new Response(null, { status: 204 });
      }),
    ],
    [
      'GET /api/audit',
      guarded(
        (_me, _body, { query }) => auditPage(fixtures.audit, query),
        true,
      ),
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
  return idempotent(
    fixtures,
    id,
    fingerprint,
    PROBLEMS.entryConflict,
    (createdAt) =>
      addEntry(
        fixtures,
        { id, quantity, factorId, accountId, createdAt },
        personId,
        drinkId,
      ),
    (createdAt) =>
      json({ id, personId, drinkId, quantity, factorId, createdAt }),
  );
}

/** Adds a new entry once its person, drink and factor exist. */
function addEntry(
  fixtures: Fixtures,
  entry: Omit<FixtureEntry, 'personId' | 'drinkId'>,
  personId: number | undefined,
  drinkId: number | undefined,
): Response {
  const { factorId } = entry;
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
  const added: FixtureEntry = {
    ...entry,
    personId: personId ?? 0,
    drinkId: drinkId ?? 0,
  };
  fixtures.entries.push(added);
  return json(entryOf(added), 201);
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
