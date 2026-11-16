# ADR 0005 — Session validation under revocation, daily renewal, pending sign-in attempts

- Status: accepted
- Date: 2026-11-16
- Context: issue #43, which follows up the review of PR #13. Code: `Sessions`,
  `SessionAuth`, migration `0013_add_login_attempts_pending`.

## Decisions

1. **A request is validated against the session row after any revocation that is under way.**
   `Sessions::verify` reads the session with `LOCK IN SHARE MODE` in its own statement. Sign-out,
   admin password reset, account deletion (cascade) and the purge of expired sessions all hold the
   session row exclusively until they commit, so the read waits and then sees the row gone. The
   renewal is a compare-and-set (`last_seen_at` as read, `expires_at` still in the future), and an
   update of no row never counts as success: the session and its account are read again and must
   still be valid. Before this change, a plain read saw the pre-revocation row, the unconditional
   update changed no row, and the request was authorized and sent a new cookie.
   *Boundary:* a request whose validation finished before the revocation committed may still
   complete. That request was ordered before the revocation. Every request validated after the
   commit is refused, and none of them gets a cookie.
2. **No lock cycles.** Each statement of `verify` locks at most one row and holds nothing else
   (autocommit). Account changes lock the account and every admin, then the sessions
   (`Accounts::changeLocked`). A wait in `verify` therefore never closes a cycle. A locking join of
   sessions and accounts would lock in the opposite order to account changes, so it is not used.
3. **Renewal at most once a day.** A request renews the session only when its last renewal is
   `RENEWAL_INTERVAL_HOURS` (24) old or older. `SessionAuth` sets the cookie only then, with the
   same lifetime as the row's new `expires_at`, so the browser and the database still expire the
   session together. `last_seen_at` now means "last renewal". A session ends 179 to 180 days after
   its last use. Measured locally (MariaDB 10.11, PHP 8.3, 10 clients × 500 polls): session row
   updates fell from 5 000 to 10, and mean validation time from 2.0 ms to 1.5–1.7 ms.
4. **Sign-in attempts are pending while their password is checked.** `login_attempts.pending` is
   set when the attempt is reserved, before bcrypt. It is cleared when the check fails, including
   when a concurrent reset refuses the credential, and the row is then a recorded failure. A
   success deletes its own row and the finished failures, by primary key. Rows still pending
   belong to parallel requests: they stay and count, and are purged with the 15-minute window like
   any other row, which also covers a request that died mid-check. The count before bcrypt still
   includes pending rows, so parallel attempts cannot pass it together.

## Rejected alternatives

- **Holding the session row locked for the whole request:** it would order every handler
  before any revocation. But it needs its own connection or transaction around the handler's
  transactions, and it would block a sign-out for as long as a request runs.
- **`PDO::MYSQL_ATTR_FOUND_ROWS`, to read "matched" instead of "changed" rows:** it is a
  connection-wide setting, deprecated as `PDO::MYSQL_ATTR_*` in PHP 8.5. The compare-and-set
  always changes the row it matches, so changed rows are enough.
- **Forgetting only failures older than a cutoff:** no cutoff is safe on a slow host, because a
  bcrypt check has no upper bound on a shared webspace.
- **Renewing on every request** (before): one write and one `Set-Cookie` per poll, every 10 s,
  for every open app.

## Consequences

- `SessionRevocationRaceTest` holds each revocation open on another connection with the API's own
  statements and starts the request in its own process. The order is the same on every run.
  `SignInThrottleRaceTest` orders a wrong password in flight against a right one by hash cost and
  fails if that order did not hold.
- Migration 0013 is additive; [ADR 0006](0006-rollout-compatibility.md) explains why the previous
  release keeps working on it.
