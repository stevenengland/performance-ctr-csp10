# Runbook: production deploy, rollback and live check

Production is one Strato webspace, `SITE_URL` (today `https://cybersecurityprofessionals.info`),
reached over SFTP. Every green push to `main` deploys there; there is no staging. Design and
rejected alternatives: [ADR 0003](adr/0003-production-rollout.md); the deploy CLI's origin:
[ADR 0001](adr/0001-deploy-cli-import.md).

## Runtime pins (PROVISIONAL)

The host probe (#2) has not reached PHP on the webspace yet (the domain's DNS did not point at
Strato when this was written). Until it reports, these are **assumptions**, not findings:

| What | Pin | Where it lives |
|---|---|---|
| PHP | 8.3 — `php:8.3-apache@sha256:a800bbd2…5472` (PHP 8.3.36) | `e2e/stack/Dockerfile` (e2e stack, deploy proof and PHPUnit all build this image) |
| Database | MySQL 8.4 — `mysql:8.4@sha256:a81d0439…0902` (8.4.13) | `e2e/stack/compose.yml`, `tests/support/compose.yml`, `.github/workflows/ci.yml` (`phpunit` service) |
| Composer platform | `config.platform.php` `8.3.6`, `require.php` `~8.3.0` | `api/composer.json` |

When #2 reports, swap all of them in one pull request: take the image digests for the host's
PHP minor version and database engine/version from Docker Hub (or
`docker-library/repo-info`), set `config.platform.php` to the host's exact PHP version, run
`composer update` in `api/` and commit the resulting `composer.lock` (none is committed yet:
Packagist was unreachable where the API was written, so `composer.json` pins every package,
transitive ones included, and `scripts/composer-pins.ts` checks that; ADR 0002), and record
the findings in an ADR. If the host runs MariaDB, replace
the `mysql` images with `mariadb` ones; the SQL avoids MySQL-only syntax (ADR 0002).

## Open verifications (assumed to hold, not yet probed)

The deploy layout depends on these host facts. The probe of #2 checks them; until then the
deploy assumes all of them, and none of the fallbacks of #2 is built:

- **PHP can read a folder above the web root.** `app/<release>/` and `config/runtime.php` sit
  beside `DOCROOT`, not inside it (`open_basedir` must allow the SFTP root).
- **`GET_LOCK` works** for the migration lock.
- **An `.htaccess` front-controller rewrite reaches PHP** (`/api/*` → `api/index.php`).
- **An OpenSSH `sftp` rename replaces an existing file atomically** (activation and the config
  rely on it).
- **`%{HTTPS}` is `on` behind Strato's TLS**, so the rendered HTTP → HTTPS redirect does not loop.
- **PHP runs as the SFTP user or can read its files** (uploads keep the local mode, `0644`).

If one fails, stop deploying and pick the fallback named on #2.

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
| secret | `BOOTSTRAP_ADMIN_PASSWORD_HASH` | `password_hash()` output for that admin's password |

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
   commit's history fails, so production never regresses.
3. `node deploy/cli.ts deploy` activates the release API-first:

   ```text
   hashed assets → app/<release>/ → staged web files → config/runtime.php (put + rename)
   → api/index.php and other web files (API pointer switched)
   → GET /api/health: runs pending migrations, must report the new appVersion,
     the release's schemaVersion and migration "ok"
   → index.html, manifest.webmanifest, sw.js (shell switched last)
   → version.json → HTTP checks → ledger records the release → prune
   ```

4. `archive` makes the tested tarball a GitHub Release tagged `release-YYYYMMDD-HHMM` (UTC
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

There are no database backups; a schema change is never rolled back.

## Live check

`live-check.yml` runs every Monday 05:17 UTC (and on demand). It fails, and GitHub emails the
owner, when `GET <SITE_URL>/api/health` does not answer 200 with every health field or reports a
migration that is not `ok`. It reads no secrets.

## Local deploy proof

`npm run test:deploy` runs the deploy CLI against `tests/support/compose.yml` (SFTP, Apache +
PHP from `e2e/stack/Dockerfile`, MySQL), using the PHP release of the built artifact
(`node scripts/build-artifact.ts` first, or `DEPLOY_TEST_ARTIFACT=<dir>`). Where the images
cannot be pulled, `DEPLOY_TEST_EXTERNAL=1` uses servers set up by hand: a chrooted SFTP user
`deploy` (password `deploy-test-password`) whose `/remote` is empty, Apache with mod_php serving
`/remote/site` with `AllowOverride All` on port 8089, and an empty MySQL database
(`DEPLOY_TEST_DB_HOST`, `DEPLOY_TEST_DB_NAME`, `DEPLOY_TEST_DB_USER`, `DEPLOY_TEST_DB_PASS`).
