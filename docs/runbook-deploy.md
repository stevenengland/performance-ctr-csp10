# Runbook: production deploy, rollback and live check

Production is one Strato webspace, `SITE_URL` (today `https://cybersecurityprofessionals.info`),
reached over SFTP. Every green push to `main` deploys there; there is no staging. Design and
rejected alternatives: [ADR 0003](adr/0003-production-rollout.md); the deploy CLI's origin:
[ADR 0001](adr/0001-deploy-cli-import.md).

## Runtime pins

The host probe of #2 reached PHP on the webspace (round 2, run 43773611400; PHP re-probed in
run 43774066616 after the owner switched the webspace's PHP version). CI and every local stand-in
pin these, by digest; [ADR 0004](adr/0004-host-runtime.md) records the decisions:

| What | Host (probed) | Pin | Where it lives |
|---|---|---|---|
| PHP | 8.5.12, `cgi-fcgi` (FastCGI), opcache on with `validate_timestamps 1`, `revalidate_freq 0`, `open_basedir` none, `date.timezone` UTC | `php:8.5-apache@sha256:08af36df…2d46` (PHP 8.5.12) | `e2e/stack/Dockerfile` (e2e stack, deploy proof, PHPUnit, PHPStan and PHP-CS-Fixer all run on this image) |
| Database | MariaDB 11.8.8 (InnoDB; server defaults utf8mb3, `sql_mode` empty, time zone `SYSTEM`) | `mariadb:11.8@sha256:d36f18d6…1707` (11.8.9: the image publishes no 11.8.8; same minor) | `e2e/stack/compose.yml`, `tests/support/compose.yml`, `.github/workflows/ci.yml` (`phpunit` job, `docker run`) |
| Composer platform | — | `config.platform.php` `8.5.12`, `require.php` `~8.5.0` | `api/composer.json` |
| Web server | Apache 2.4.71, `.htaccess` with `mod_rewrite`; rules use `[L]`, because the host's PHP handler answers 404 after `[END]` (probe run 43785718565) | Apache of the PHP image | — |

Every stand-in starts MariaDB the way the host's answers: `--sql-mode=` (empty),
`--character-set-server=utf8mb3` and a non-UTC `--default-time-zone`. The API never relies on
server defaults: every connection sets `utf8mb4` with the tables' `utf8mb4_unicode_ci`, a strict
`sql_mode` (MySQL 8's default set) and time zone `+00:00` in one statement
(`api/src/Http/Database.php`, tested by `api/tests/Integration/ConnectionTest.php`).

The PHP image is built with `--disable-cgi`, so the stand-ins run mod_php while the host runs
FastCGI: nothing may depend on mod_php. The rendered `.htaccess` carries no `php_value`/`php_flag`
(which answer 500 under FastCGI; `deploy/webspace/htaccess.test.ts` guards it), the API sets
`display_errors` with `ini_set` at runtime, uses cookie sessions (no `Authorization` header to
pass through) and reads only `REMOTE_ADDR`, `REQUEST_URI` and `SCRIPT_NAME` from the server.

To move a pin: take the digest of the host's PHP minor or MariaDB minor from
`docker-library/repo-info` (`repos/php/remote/8.5-apache.md`, `repos/mariadb/remote/11.8.md`),
change every place in the table (Dependabot refreshes the Dockerfile and the compose files, not
`ci.yml`), and set `config.platform.php` to the host's exact PHP version. `api/composer.lock` is
still not committed (Packagist was unreachable where the API was written; `composer.json` pins
every package exactly and `scripts/composer-pins.ts` checks that, ADR 0002): generate it with
`composer update` in `api/` on a machine with Packagist access and commit it.

## Host verifications

Probed on #2 (round 2) and holding:

- **PHP can read a folder above the web root**, and the folder above it is writable
  (`open_basedir` none): `app/<release>/` and `config/runtime.php` sit beside `DOCROOT`.
- **`GET_LOCK` works** (acquired, visible to `IS_USED_LOCK`, released) for the migration lock;
  DDL, foreign keys and `information_schema` reads work, `utf8mb4_unicode_ci` exists.
- **An `.htaccess` front-controller rewrite reaches PHP.**
- **An OpenSSH `sftp` rename replaces an existing file atomically** (served afterwards: the new
  content). With opcache's `revalidate_freq 0` and timestamp validation, PHP sees a renamed
  `api/index.php` or `config/runtime.php` on the next request; release folders are new paths.
  The API pointer switch needs nothing extra.
- **`%{HTTPS}` is `on`**: Apache terminates TLS itself (PHP sees `HTTPS`, no
  `X-Forwarded-Proto`), and the host already answers plain HTTP with a 301 to
  `https://<apex>/`. The rendered rule therefore only acts on other host names (`www` → apex,
  which the certificate also covers) and never loops.
- **TLS:** Sectigo DV certificate for the apex and `www`, valid until 2027-05-14; Strato renews it.

Still open:

- **`SCRIPT_NAME` under the host's FastCGI.** `api/public/index.php` takes Slim's base path from
  it (`/api/index.php` → base `/`). The probe's rewrite passed the route as a query parameter, so
  it did not show what PHP sees after a path rewrite; the probe now reports `SCRIPT_NAME` and
  the `REQUEST_URI` path of the rewritten request. The next probe run (it is needed for the
  host-key lines anyway) settles it. If they differ from the expectation, health answers 404 and
  the first deploy fails at its health check.
- **Config file mode.** `config/runtime.php` holds the database password and is uploaded `0644`
  (uploads keep the local mode). Whether PHP runs as the SFTP user is not probed yet: if it
  does, tighten the file to `0600` (an sftp `chmod` on the `.part` before the rename); if not,
  ask Strato whether other tenants can read `0644` files. Not changed yet: `0600` would break the
  deploy proof, whose Apache runs as a different user than the SFTP account. **Owner decision.**

If a verification fails, stop deploying and pick the fallback named on #2.

### Decided: accent-insensitive names

Every table uses `utf8mb4_unicode_ci`, which ignores accents and folds `ß` as well as case:
`Jürgen` = `Jurgen`, `Strauß` = `Strauss`, `Bär` = `Bar`. The PRD only asks for uniqueness that
ignores case, so two such persons, drinks, factors or user names collide with `409 Name ist
bereits vergeben.`, and sign-in matches accent-folded user names. **The owner decided to keep
the folding** (MariaDB would offer `utf8mb4_uca1400_as_ci` for an accent-sensitive change).

## DNS and TLS

Resolved on #2: **DNS only, at Strato, with Strato's certificate; no Cloudflare proxy.** There
are no Cloudflare cache or security rules to maintain. The rendered `.htaccess` redirects plain
HTTP and every other host name to `SITE_URL` with a 301 and sends HSTS (`max-age=31536000`).
Another domain (for example `performance.csp10.de`) needs its own certificate on the host and
goes into `SITE_ALIASES`, or becomes the new `SITE_URL`.

## Settings

All under *Settings → Secrets and variables → Actions*, read only by `_deploy.yml`:

| Kind | Name | Meaning |
|---|---|---|
| variable | `SITE_URL` | Production origin, e.g. `https://cybersecurityprofessionals.info` |
| variable | `SFTP_HOST` | SFTP host name |
| variable | `SFTP_KNOWN_HOSTS` | `ssh-keyscan` line(s) of the host, checked against the fingerprints on #2 |
| variable | `DOCROOT` | The served folder below the SFTP root (suggested `performance`); required, never guessed. Not `app`, `config` or `.deploy` |
| variable | `DB_HOST` | Database host name |
| variable | `SITE_ALIASES` | Optional: comma-separated host names answered with a 301 to `SITE_URL` |
| secret | `SFTP_USER`, `SFTP_PASS` | SFTP login |
| secret | `DB_NAME`, `DB_USER`, `DB_PASS` | Database login, rendered into `config/runtime.php` |
| secret | `BOOTSTRAP_ADMIN_USER` | User name of the first admin, created when no admin exists |
| secret | `BOOTSTRAP_ADMIN_PASSWORD_HASH` | `password_hash()` output for that admin's password (10 characters to 72 bytes in UTF-8: the API refuses longer passwords at sign-in, as bcrypt ignores what follows) |

Make the hash on a trusted machine and paste it as the secret value:

```sh
php -r 'echo password_hash(readline("Password: "), PASSWORD_DEFAULT), PHP_EOL;'
```

The API creates that account on the first sign-in while no admin exists; the password
must have at least 10 characters to be changeable later. It never overwrites an existing
account (a taken user name leaves everything as it is), and once any admin exists,
changing these secrets has no effect: manage accounts in the app (Verwalten → Konten).

A missing or invalid name fails the deploy before it touches the host, naming the variable and
never printing a value. **Exception until #2 closes:** the throwaway `host-probe.yml` also reads
the SFTP and database secrets; #2 deletes it once its findings are recorded.

## What a push to `main` does

1. `ci.yml` builds one artifact (`web/`, `app/<release>/`, `release.json`, `manifest.json`) with
   a SHA-256 digest and runs every check on it, including the deploy proof.
2. When all checks are green, `deploy` calls `_deploy.yml`, which downloads that artifact,
   verifies the digest, reads the host ledger and applies the **ordering rule**: a run whose
   commit is older than the live one (it was overtaken) is skipped, a commit outside the live
   commit's history fails, so production never regresses. The rule also compares the commit
   with a release that is still **in progress** (`inspect` reports it as `inProgress`): a deploy
   cut off after it switched the API may already have migrated the database, so a re-run of an
   older commit is skipped too.
3. Before its first write, `node deploy/cli.ts deploy` checks the **schema floor**: it refuses a
   release whose schema version is below what live health reports, or below the active or
   in-progress release in the ledger (which also holds while health does not answer). Nothing is
   written then:

   ```text
   release <id> expects schema version 1, but the live database is at schema version 2;
   a deploy never moves below the live schema: deploy the newer release again or fix forward
   ```

4. The deploy then activates the release API-first:

   ```text
   hashed assets → app/<release>/ → staged web files → config/runtime.php (put + rename)
   → api/index.php and other web files (API pointer switched)
   → GET /api/health: runs pending migrations, must report the new appVersion,
     the release's schemaVersion and migration "ok"
   → index.html, manifest.webmanifest, sw.js (shell switched last)
   → version.json → HTTP checks → ledger records the release → prune
   ```

5. `archive` makes the tested tarball a GitHub Release tagged `release-YYYYMMDD-HHMM` (UTC
   minute of the archive), titled with the release id, at the deployed commit.

Remote layout below the SFTP root:

```text
<DOCROOT>/            SPA, rendered .htaccess, api/index.php → app/<release>/public/index.php
app/<release>/        src/, vendor/, migrations/, public/, release.php
config/runtime.php    database login + bootstrap admin, rendered on every deploy
.deploy/              ledger (state.json), manifests (one per release, with its schema version), staging
```

The ledger keeps the active release and the two before it, plus anything deactivated less than
24 h ago; their hashed assets, manifests and `app/` folders stay, everything older is pruned.

## Breaking API changes

A change that older installed apps cannot use raises `MIN_CLIENT_VERSION` in
`api/src/Http/Compatibility.php`; those apps then show `Bitte neu laden`. Bump the `version` in
`web/package.json` to at least the new floor in the same pull request: the artifact build and
`scripts/artifact.test.ts` fail otherwise, because the freshly deployed client would be below
its own API's floor and ask to reload forever.

## When a deploy fails

- **Before the API pointer switched** (upload, config, settings): nothing changed for users.
  Fix the cause and re-run the failed job; the deploy resumes where it stopped.
- **Health failed** (failed migration, wrong app or schema version): the run is red,
  `index.html`, the manifest and the service worker still belong to the previous release, but
  `/api/*` is served by the new PHP release. After a failed migration every API route answers
  503 `migration-failed` until it is fixed. Either
  - **fix forward:** correct the migration (keep its name, keep it guarded) and push; the next
    deploy's health call re-runs it; or
  - **roll back** to the previous release (below). A failed migration does not raise the schema
    version, so the previous release usually still matches it.
- **Cut off after health, before the shell switched** (runner lost, SFTP dropped): the API
  already runs the new release on its schema, the ledger still names the previous release
  active and the new one in progress. **Re-run the new release's job** (or push a newer
  commit). A re-run of an older commit is skipped by the ordering rule, and a plain deploy of a
  release below the live schema is refused before it writes anything (schema floor); roll back
  only to a release with the live schema.
- **HTTP checks failed after the shell switched:** the release stays "in progress" in the ledger
  and nothing is pruned. Re-run the job, or roll back.

## Rollback

*Actions → Rollback → Run workflow* on `main`, as the repository owner, with the tag of a
retained release (`release-YYYYMMDD-HHMM`, see *Releases*). The workflow downloads that GitHub
Release, verifies it and re-activates it with the same API-first order. It **refuses** a release
that is not retained, and one whose schema version differs from the live database's:

```text
release <id> expects schema version 1, but the live database is at schema version 2;
rollback only returns to a release with the live schema, fix forward instead
```

There are no database backups; a schema change is never rolled back. Health reports the schema
the database is really at: an older release whose PHP answers on a newer database reports the
newer number, not its own newest migration.

## Live check

`live-check.yml` runs every Monday 05:17 UTC (and on demand). It fails, and GitHub emails the
owner, when `GET <SITE_URL>/api/health` does not answer 200 with every health field or reports a
migration that is not `ok`. It reads no secrets.

## Local deploy proof

`npm run test:deploy` runs the deploy CLI against `tests/support/compose.yml` (SFTP, Apache +
PHP from `e2e/stack/Dockerfile`, MariaDB), using the PHP release of the built artifact
(`node scripts/build-artifact.ts` first, or `DEPLOY_TEST_ARTIFACT=<dir>`). Where the images
cannot be pulled, `DEPLOY_TEST_EXTERNAL=1` uses servers set up by hand: a chrooted SFTP user
`deploy` (password `deploy-test-password`) whose `/remote` is empty, Apache with PHP serving
`/remote/site` with `AllowOverride All` on port 8089, and an empty MariaDB database on port 3306
(`DEPLOY_TEST_DB_HOST`, `DEPLOY_TEST_DB_NAME`, `DEPLOY_TEST_DB_USER`, `DEPLOY_TEST_DB_PASS`).
