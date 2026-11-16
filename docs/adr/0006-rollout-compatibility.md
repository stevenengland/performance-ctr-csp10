# ADR 0006 — Schema and API compatibility across a rollout: expand, then contract

- Status: accepted
- Date: 2026-11-16
- Context: issue #43 (rollout findings of the PR #13 review). Builds on the API-first activation
  and same-schema rollback of [ADR 0003](0003-production-rollout.md) and the request-triggered
  migrations of [ADR 0002](0002-walking-skeleton.md). Operations: [runbook](../runbook-deploy.md),
  "Breaking API changes".

## Why a policy is needed

During and after a deploy, three versions meet:

- **Old PHP, new schema.** Requests that started on the previous release finish after the API
  pointer switched. The first request on the new release migrates while they run.
- **Old client, new API.** Open tabs and installed apps keep running the previous web client.
  They switch only when the user accepts `Neu laden` or the reload floor forces it (design spec
  §6.7). That can take days.
- **New PHP, old schema** never serves a request. `MigrationGate` answers 503 with `Retry-After`
  until the release's migrations completed, and health must report the new schema before the
  shell switches.

Rollback only returns to a release with the live schema (ADR 0003, decision 7), and fix-forward
is the only way past a schema change.

## Decisions

1. **Schema changes expand first and contract later.** A release may only *add* to the schema
   the previous release uses:
   - new tables;
   - new columns that are nullable or have a default meaning what the previous release's rows
     already mean (for example `login_attempts.pending DEFAULT 0`: an old row is a finished
     failure);
   - new indexes;
   - new constraints that every existing row and every write of the previous release satisfy.

   Removing or renaming anything the previous release reads or writes is a *contract* step. It
   ships in a later release, once no supported release uses it any more.
2. **Unsafe migrations** are never shipped as a plain deploy:
   - dropping or renaming a table or column a live or retained release uses;
   - changing a column's type, length or charset;
   - adding `NOT NULL` without a default to a table that has rows;
   - a unique key or `CHECK` the data may violate;
   - deleting or rewriting data;
   - any DDL that copies or rebuilds a large table.

   Request-triggered DDL holds the migration lock, and every other request gets 503 until it
   finishes. So a migration states its algorithm where MariaDB can do it in place
   (`ALGORITHM=INSTANT`, else `INPLACE, LOCK=NONE`), which fails instead of silently copying.
   That bounds the work, not the wait: DDL first waits for its table's metadata lock until every
   open transaction that used the table ended. The `Migrator` therefore runs every migration with
   `lock_wait_timeout` at `Migrator::TABLE_LOCK_WAIT_SECONDS` (5 s). A migration that times out
   is not failed: it stays `started`, health reports `running` (the deploy keeps polling), other
   requests get 503 `maintenance` with `Retry-After`, and the next request tries again. A
   migration that cannot be cheap needs its own plan in its pull request: duration measured on a
   copy of production data, a quiet time, and announcement.
3. **The API only grows while an older client may still be running.** A release may add routes,
   optional request fields and response fields (clients ignore unknown keys). It may not remove or
   rename a field, change a field's type or meaning, make an optional field required, or change a
   status or header a client relies on.

   Raising `MIN_CLIENT_VERSION` alone does not make such a break safe. A client reads the floor
   only when it starts (`startApp` → `loadServerHealth`); a tab or installed app opened before the
   deploy never reads it again, and the update prompt waits for the user. Such a client keeps
   sending the old requests and reading the new answers without ever seeing `Bitte neu laden`.
   So a break, too, is expanded first and contracted later: the release that brings the new
   contract keeps serving the old one beside it and raises the floor (runbook, "Breaking API
   changes"), so every client that starts from then on is new. Removing the old contract is a
   contract step, and it may ship only once clients that are already running observe the floor
   before their next request. They do not yet (see Consequences), so until then no release
   removes or changes what a supported client relies on. Behaviour clients do not see stays free:
   the session cookie is browser-managed, so sending it less often (ADR 0005) needs no new floor.
4. **Every migration is guarded and idempotent** (`isApplied`), as before. Migration numbers only
   order them. Two branches that each add one take different numbers (0012 for the audit log in
   PR #26, 0013 here), so either can merge and deploy first.
5. **Each schema change ships with a compatibility test** that runs what the previous release does
   against the new schema and API (`RolloutCompatibilityTest`). Old-client behaviour that the
   change touches is tested through the API the same way.

## Rejected alternatives

- **Migrating outside requests:** the deploy reaches the host over SFTP and HTTP only (ADR 0001),
  so it has no shell to run DDL from. Request-triggered migrations with the gate stay, and the
  policy keeps them short.
- **Versioned API paths (`/api/v2`):** one deployed client and one API, with a reload floor for
  real breaks, are enough for one group. Versioned paths would double the routes for no current
  client.

## Consequences

- Not exercised here, and still open on #43: a deploy under live traffic with a deliberately
  slow migration (503 and `Retry-After` behaviour, lock contention, recovery), and old-client
  end-to-end tests that drive the previous release's built web client against the new API in the
  e2e stack. Both need the host or the Docker-based e2e stack, which are not available to the
  session that wrote this.
- **Running clients do not observe the floor** (review of PR #45). The floor is checked once,
  at start-up; later requests, polls, navigation and the update prompt do not check it. Until
  that changes, decision 3 rules out every contract step of the API. An acceptance test for the
  mechanism that closes the gap starts the previous built client *before* the floor is raised and
  then uses it without reloading; starting an old client after the deploy only proves the
  start-up check.
- **A new value in a response's enum** is growth when older clients only show it less well, and
  a break (decision 3) when they would act on it wrongly. PRD #27 adds `game`, `match` and
  `result` to the audit event's `subjectKind`. Until it reloads, the previous web client's
  Protokoll (admins only, read-only) shows those events as `undefined Schach`, with an empty
  title or with entry-shaped fragments; every open client is offered `Neu laden` after the
  deploy (design spec §6.7). That is accepted as a transient, cosmetic effect, and
  `MIN_CLIENT_VERSION` stays. Protokoll now names an event of a kind it does not know by its
  name only, so the next new kind degrades cleanly.
- **Pending contract step from PRD #27:** retry keys moved from `entry_requests` to
  `idempotency_keys` by expansion; `Idempotency` still reads and purges `entry_requests` for
  the previous release's keys. Not before seven days after that release is live, a later
  release drops `entry_requests`, removes `Idempotency::PREVIOUS_TABLE` with its fallback read
  and purge, and updates `RolloutCompatibilityTest`. Both go together: dropping the table while
  the fallback still reads it makes every entry, match and result write fail. Runbook,
  "Breaking API changes", lists it until it is done.
