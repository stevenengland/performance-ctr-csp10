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
3. **The API only grows while an older client may still be served.** A release may add routes,
   optional request fields and response fields (clients ignore unknown keys). It may not remove or
   rename a field, change a field's type or meaning, make an optional field required, or change a
   status or header a client relies on — unless the same release raises `MIN_CLIENT_VERSION`
   above every client that relies on the old contract.

   Raising the floor makes such a break safe because every client observes it before it uses the
   new API. A client reads the floor from health when it starts (`startApp` →
   `loadServerHealth`). From 0.2.0 on, it also names its app version in `X-Client-Version` on
   every request, and `ClientVersionGate` refuses a client below the floor before the route runs,
   on every route but health, with 400 `client-outdated`; the client then shows `Bitte neu laden`.
   So a tab or installed app that was open across the deploy learns the floor on its next
   request, and that request changed nothing: it never sends the old requests to the new API or
   reads its new answers. (Not 426 Upgrade Required: that status must name a protocol in
   `Upgrade`, and an app version is none; the problem type tells the client what to do.)

   A request without the header comes from a client built before the header existed. It counts
   as `Compatibility::LAST_VERSION_WITHOUT_HEADER` (0.1.0): it is served while the floor is at
   or below that version and refused as outdated once the floor passes it, so the first break
   also retires those clients. Scripts that call the API must send the header too once the floor
   passes 0.1.0; health stays open, so the deploy probe needs none.

   A break still makes every open client reload, and a write it refuses is not booked (the user
   enters it again after reloading), so prefer growth. The release that raises the floor bumps the
   `version` in `web/package.json` to at least the new floor, or its own client would be refused
   (runbook, "Breaking API changes"). Behaviour clients do not see stays free: the session cookie
   is browser-managed, so sending it less often (ADR 0005) needs no new floor.
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
- **Running clients observe the floor** since 0.2.0 (review of PR #45): every request carries
  the app version and an outdated one is refused unprocessed (decision 3). Clients before 0.2.0
  send no header and are served only while the floor stays at 0.1.0, so the first release that
  raises the floor refuses them too. The acceptance test (`e2e/pwa-update.spec.ts`, "a tab opened
  before the floor was raised …") opens the built client, raises the floor under it and lets it
  sign in without reloading: it must show `Bitte neu laden`. Its canned API applies the floor as
  `ClientVersionGate` does; the gate itself is covered by `ClientVersionGateTest` and, through
  the application, `ClientVersionTest`. Running the previous release's built client against the
  real new PHP needs two releases in the e2e stack and stays open with the item above.
- **A new value in a response's enum** is growth when older clients only show it less well, and
  a break (decision 3) when they would act on it wrongly. PRD #27 adds `game`, `match` and
  `result` to the audit event's `subjectKind`. Until it reloads, the previous web client's
  Protokoll (admins only, read-only) shows those events as `undefined Schach`, with an empty
  title or with entry-shaped fragments; every open client is offered `Neu laden` after the
  deploy (design spec §6.7). That is accepted as a transient, cosmetic effect, and
  `MIN_CLIENT_VERSION` stays at 0.1.0: raising it would refuse every open client at once for a
  display flaw in one admin page. Protokoll now names an event of a kind it does not know by its
  name only, so the next new kind degrades cleanly.
- **Contract step from PRD #27, in two releases:** retry keys moved from `entry_requests` to
  `idempotency_keys` by expansion, and the PRD #27 release still reads and purges
  `entry_requests` for the keys the release before it recorded. That fallback and the table
  cannot go in one release: while it rolls out, the PRD #27 release is the previous release,
  and its requests still read and purge the table (decision 1; dropping it would be an unsafe
  migration under decision 2). So:
  1. *Done (retire):* once the PRD #27 release has been live for seven days, every key in
     `entry_requests` has expired, and a release removes `Idempotency::PREVIOUS_TABLE` with its
     fallback read and purge. It changes code only, keeps the table, and needs no migration;
     `RolloutCompatibilityTest` runs the PRD #27 release's lookup and purge against it.
  2. *Pending (drop):* a later release, deployed only after the retiring release is live (it is
     then the previous release and no longer touches the table), drops `entry_requests` with a
     guarded migration and a `RolloutCompatibilityTest` case for the retiring release. The
     runbook, "Breaking API changes", lists it until it is done.
