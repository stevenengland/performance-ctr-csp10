# ADR 0001 — Walking skeleton: provisional runtime, imported renderer, API edges

- Status: accepted
- Date: 2026-11-15
- Context: PRD #1, slice #4 (walking skeleton), built before the host probe (#2) finished

## Decisions

1. **Provisional runtime versions.** The host probe has not reported yet, so CI and the
   e2e stack use PHP 8.3 (the runner's PHP, `php:8.3-apache`) and MySQL 8.4 (`mysql:8.4`),
   and Composer's `config.platform.php` is `8.3.6`. Slice 1/4 replaces them with the
   findings of #2 and pins the images by digest. The SQL avoids MySQL-only syntax
   (`utf8mb4_unicode_ci`, no `AS new` upsert alias) so MariaDB stays possible.
2. **`.htaccess` renderer imported from projekt2406** (commit `506dfdf`,
   `deploy/webspace/htaccess.ts`). Kept: preamble, Passenger off, `X-Accel-Internal`
   unset, HTTPS redirect + HSTS for an https origin, security headers in both header
   tables, base-aware caching. Changed: no basic auth, no 404 page and no `noindex`
   (one public-by-sign-in environment); the hashed-asset folder is Vite's `assets/`;
   new `/api/*` front-controller rewrite, an SPA fallback for extension-less paths only
   (a missing hashed asset stays a 404, so a stale chunk fails loudly and reloads), and
   `no-cache` for `index.html`, `sw.js` and `manifest.webmanifest`. The CSP adds
   `style-src 'self' 'unsafe-inline'` for Vuetify's runtime theme; scripts stay `'self'`.
   Slice #3 imports the rest of the deploy CLI around it (`deploy/cli.ts` already
   carries `render-htaccess`).
3. **Artifact layout.** `web/` is the web root, with `api/index.php` naming one PHP
   release; `app/<release>/` holds the release (`src`, `migrations`, `public`, `vendor`
   built `--no-dev`, `release.php` with the app version); `release.json` records version,
   release folder and schema version. The runtime `config.php` sits beside the web root
   and `app/`. The tarball is reproducible and carries a SHA-256 digest.
4. **Health is never gated.** Every request first brings the schema up to date under
   `GET_LOCK`; while another session migrates, or after a migration failed, every route
   answers 503 problem+json (`Retry-After: 5` while running), but health always answers
   200 with `migration: running|failed`, so the deploy check and the weekly live check
   can read the state. A failed migration is retried on the next request (the guard
   makes that safe), which is how a corrected release recovers.
5. **Problem types are URNs** (`urn:performance:problem:<slug>`): stable regardless of
   the host name, which may change to `performance.csp10.de`.
6. **Versions.** The app version is `<web package version>+<commit>`; the release folder
   replaces `+` with `-`. `minClientVersion` lives in `api/src/Http/Compatibility.php`;
   clients compare `MAJOR.MINOR.PATCH` only.

## Consequences

- `api/composer.lock` is not committed yet: Packagist was unreachable from the session
  that built this slice. CI resolves the exact pins of `composer.json`; the first session
  with Packagist access commits the lock.
