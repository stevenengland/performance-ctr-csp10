# ADR 0004 — Host runtime: MariaDB 11.8, PHP 8.5 as FastCGI, per-connection session settings

- Status: accepted
- Date: 2026-11-15
- Context: PRD #1, slice #2 (host probe). Round 2 (run 43773611400) reached PHP on the Strato
  webspace; the owner then switched the webspace from PHP 8.2.35 to 8.5, and run 43774066616
  confirmed PHP 8.5.12. Replaces the provisional runtime of
  [ADR 0002](0002-walking-skeleton.md) decision 1 and [ADR 0003](0003-production-rollout.md)
  decision 9. Operations: [runbook](../runbook-deploy.md), "Runtime pins".

## Decisions

1. **MariaDB 11.8, not MySQL 8.4.** The host runs MariaDB 11.8.8. CI, the e2e stack and the
   deploy proof pin `mariadb:11.8` by digest (the image is 11.8.9; Docker Hub publishes no
   11.8.8 tag, and a patch release of the same minor changes no SQL behaviour the API uses).
   Each starts the server as the host's answers: empty `sql_mode`, utf8mb3 server defaults and a
   non-UTC time zone. The PHPUnit job starts it with `docker run`, as service containers take no
   server options.
2. **The API sets its session itself.** Every connection runs one statement:
   `SET NAMES utf8mb4 COLLATE utf8mb4_unicode_ci`, a strict `sql_mode` (MySQL 8's default set:
   `ONLY_FULL_GROUP_BY,STRICT_TRANS_TABLES,NO_ZERO_IN_DATE,NO_ZERO_DATE,ERROR_FOR_DIVISION_BY_ZERO,NO_ENGINE_SUBSTITUTION`)
   and time zone `+00:00` (`Database::open`). Strict mode refuses an overlong or invalid value
   instead of truncating it; the connection collation equals the tables', so comparisons never
   mix collations (MariaDB 11.8 would otherwise pick `utf8mb4_uca1400_ai_ci` or the
   handshake's `utf8mb4_general_ci`). The test race scripts open their sessions the same way.
3. **MariaDB's auto-increment lock deadlock counts as a deadlock.** Under MariaDB's default
   `innodb_autoinc_lock_mode = 1`, the bootstrap admin's `INSERT … SELECT … WHERE NOT EXISTS`
   takes InnoDB's table-level AUTO-INC lock; parallel first sign-ins can deadlock on it, and
   MariaDB reports that as error 1467 ("Failed to read auto-increment value from storage
   engine") after rolling the statement back, where MySQL 8 (lock mode 2) never takes the lock.
   `Accounts::ensureBootstrapAdmin` treats 1467 like 1213: another request inserts the admin.
   `BootstrapTest`'s race failed with 1467 on MariaDB before the change.
4. **Audited and unchanged for MariaDB:** `SELECT … FOR UPDATE`, `SELECT … LOCK IN SHARE MODE`
   (amended for the audit log, PRD #14, below), `START TRANSACTION WITH CONSISTENT SNAPSHOT, READ ONLY`, `INSERT … ON DUPLICATE KEY
   UPDATE` without the MySQL-only `AS new` alias, `GET_LOCK`/`IS_USED_LOCK`/`RELEASE_LOCK`
   (lock name ≤ 64 characters), `information_schema` guards, `DATETIME(3)` with
   `UTC_TIMESTAMP(3)`, named `CHECK` constraints, foreign keys, explicit `utf8mb4_unicode_ci`
   and `ascii_bin` per table and column (the host's utf8mb3 database default never applies),
   no JSON columns, error numbers 1062, 1213, 1452 and SQLSTATE `42S02`, which MariaDB shares,
   and health's engine detection (`11.8.8-MariaDB-log` → `MariaDB`, `11.8.8`). MariaDB 11.6+
   turns `innodb_snapshot_isolation` on, which fails a locking read of a row changed after the
   transaction's read view; every explicit write transaction opens with a locking statement and
   reads nothing without a lock before it, so no read view exists when it locks.

   *Amendment (PRD #14, audit log, PR #26).* Entry snapshots (`EntrySnapshots`) are read with
   `LOCK IN SHARE MODE` on the write path of every entry add, entry undo and catalog deletion.
   A plain read there would open the read view that snapshot isolation fails on (decision D2 of
   PR #26), and the referenced person, drink and factor are locked shared, not for update,
   because an entry insert holds them shared for its foreign key checks while it waits for the
   parent a deletion holds: an exclusive lock there deadlocks (D1). Two more constructs follow
   from it. Catalog deletions run one at a time under `GET_LOCK('performance.catalog-deletion.'
   + database name, 10)`, taken before the transaction locks any row: two deletions of rows that
   share an entry otherwise lock each other's rows in opposite order. And `DataRevision::write`
   runs a whole write transaction again when it loses a deadlock (1213), up to three times: an
   entry undo locks the entry before its person, drink and factor, a deletion of one of them
   the other way round, and neither order can change without breaking the guarantees above.
   `ConcurrentDeletionTest` forces both interleavings on CI's MariaDB 11.8 with the server's
   default settings (`innodb_snapshot_isolation` on).
5. **PHP 8.5.12.** `config.platform.php` is `8.5.12` and `require.php` `~8.5.0`; the image is
   `php:8.5-apache` (8.5.12) by digest. Every pinned package already allows 8.5, so no pin
   moved. PHPStan passes with `phpVersion: 80500`; the code uses none of 8.5's deprecations
   (non-canonical casts, backticks, `PDO::MYSQL_ATTR_*`, `setAccessible`, `__sleep`). As
   Composer's platform check then refuses the runner's PHP 8.3 for the vendor tools, CI runs
   PHPStan and PHP-CS-Fixer in the pinned image too, with the runner's Composer mounted, instead
   of adding a PHP setup action.
6. **Nothing depends on mod_php.** The host runs PHP as `cgi-fcgi`, where `php_value` and
   `php_flag` in `.htaccess` answer 500. The official image ships only mod_php
   (`--disable-cgi`), so the stand-ins keep it, and a renderer test guards that the rendered
   `.htaccess` carries no mod_php directive. The API sets `display_errors` at runtime, uses
   cookie sessions (no `Authorization` header to pass through) and reads `REMOTE_ADDR`,
   `REQUEST_URI` and `SCRIPT_NAME`; the probe now also reports the last two for a rewritten
   request, which the next run confirms.
7. **TLS ends in Apache.** PHP sees `HTTPS` and no `X-Forwarded-Proto`, and the host itself
   redirects plain HTTP to the apex, so the rendered `%{HTTPS} !=on` rule only redirects other
   host names and cannot loop. Opcache validates timestamps on every request
   (`revalidate_freq 0`), so the atomic `sftp` rename of the API pointer and of the runtime
   config takes effect on the next request without a cache reset.

## Rejected alternatives

- **Keeping MySQL 8.4 in CI** while production runs MariaDB: it hid the 1467 deadlock above.
- **Setting the session through `PDO::MYSQL_ATTR_INIT_COMMAND`:** deprecated in PHP 8.5 in favour
  of `Pdo\Mysql::ATTR_INIT_COMMAND`, which PHP 8.3 tooling lacks; an `exec` after connecting
  costs the same round trip.
- **Retrying the bootstrap insert after 1467:** a deadlock victim is rolled back because another
  statement holds the lock and inserts; the next sign-in runs the check again anyway.
- **An `httpd` + `php-fpm` stand-in to mimic FastCGI:** a different FastCGI wiring than Strato's
  CGI handler, more containers in three places, and still no proof of the host's own setup; the
  probe reports the facts that matter instead.
- **`shivammathur/setup-php` for the static job:** another third-party action that downloads at
  run time; the pinned image already holds the exact PHP.

## Consequences

- PHPUnit runs locally on whatever PHP and MariaDB the machine has; CI is the reference run on
  PHP 8.5.12 and MariaDB 11.8.
- `ci.yml` holds the MariaDB digest outside Dependabot's reach; it is copied by hand.
- Still open (runbook): the runtime config's file mode. `SCRIPT_NAME` under FastCGI and the
  `SFTP_KNOWN_HOSTS` lines were settled by probe run 43785718565; that run also showed that
  the host answers 404 after an `[END]` rewrite, so the rendered rules use `[L]`.
