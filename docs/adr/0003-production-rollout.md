# ADR 0003 — Production rollout: API-first activation, same-schema rollback, release archive

- Status: accepted
- Date: 2026-11-15
- Context: PRD #1, slice #5 (1/4), built while the host probe (#2) waits for DNS. Extends the
  deploy CLI of [ADR 0001](0001-deploy-cli-import.md) for the artifact of
  [ADR 0002](0002-walking-skeleton.md). Operations: [runbook](../runbook-deploy.md).

## Decisions

1. **The deploy manifest covers the PHP release.** `manifest.json` gains `app`: the release
   folder, the app version health must report, the schema version and the folder's files. The
   digest covers the web root, that identity and the files. `scripts/build-artifact.ts` now
   writes the manifest itself, so the tarball that CI tests is the one the deploy and the
   GitHub Release carry. The ledger keeps one manifest per release, which records its schema
   version.
2. **Release folders keep the build's name** (`app/<version>-<commit>`, ADR 0002), not the
   deploy's release id: the API pointer in the tested web root already names it. A rebuild of
   the same commit maps to the same folder with the same sources.
3. **Activation order.** `marker → assets → app-upload → app-verified → staging → config →
   activation (everything but the shell, so api/index.php switches) → health-check → shell
   (index.html, manifest.webmanifest, sw.js) → version.json → cleanup → http checks → record →
   finish → trash`. Health is a planner phase like the HTTP checks: it must report the
   manifest's app version, its schema version and migration `ok`, and it waits (24 × 5 s, the
   API's `Retry-After`) while another request migrates. Any other answer fails the run before
   the shell moves; the ledger keeps the release in progress.
4. **Observation stays shallow.** Walking every release's `vendor/` tree on every phase made a
   local deploy take over a minute. The planner walks only the folder being deployed, until it
   holds `.verified`; pruned folders are moved into `.deploy/trash/` by one rename each, and the
   next observation walks only the trash to delete it file by file.
5. **Runtime config** is rendered from the secrets on every deploy (and rollback) into
   `config/runtime.php` beside the web root, uploaded as `.part` and renamed, before the API
   pointer switches. Values are PHP single-quoted literals; the API reads `db` now and
   `bootstrapAdmin` from the accounts slice on. `DOCROOT` is now required, and `app`, `config`
   and `.deploy` are reserved names for it.
6. **Ordering rule.** Before a deploy, `order` compares the artifact's commit with the live
   one: a descendant (or the same commit) deploys, an ancestor (a run that was overtaken)
   **skips** with a notice, anything else fails. `_deploy.yml` serialises deploys and
   rollbacks in one concurrency group; `ci.yml` queues main runs.
7. **Same-schema rollback.** Before re-activating a retained release, rollback reads the live
   `schemaVersion` from health and refuses a release whose recorded schema version differs.
   A failed migration does not raise the reported version, so the previous release stays a
   valid rollback target.
8. **Archive after the deploy.** `ci.yml`'s `archive` job creates the GitHub Release
   (`release-YYYYMMDD-HHMM`, UTC minute, at the deployed commit, titled with the release id)
   only when `_deploy.yml` reports `deployed=true`; a re-run finds it by title and re-uploads.
   `rollback.yml` takes that tag.
9. **One PHP image.** `e2e/stack/Dockerfile` (php:8.3-apache by digest) serves the e2e stack
   and the deploy proof and runs PHPUnit; MySQL is pinned by digest in the three places that
   start it. Both are provisional (runbook, "Runtime pins").
10. **DNS only at Strato** (resolved on #2): no Cloudflare rules; the rendered `.htaccess`
    redirects plain HTTP and other host names to `SITE_URL` and sends HSTS, and the deploy's
    HTTP checks verify the redirect for an https origin.

## Rejected alternatives

- **Naming release folders by the deploy's release id:** the build would have to know the id
  the manifest step creates later, or the deploy would have to rewrite the tested API pointer.
- **Activating the API pointer and the shell in one rename batch** (projekt2406's single
  activation): a browser could load a shell whose API calls hit the old release.
- **Walking every release folder on every observation:** correct, but too slow (decision 4).
- **Archiving a draft Release before the deploy** (projekt2406's promote flow): the issue
  archives after a successful deploy, and production has no promote step to verify a draft.
- **Reading the live schema from `.deploy/` instead of health:** only the API knows which
  migrations completed; the ledger knows what was deployed, not what ran.

## Consequences

- The deploy proof needs a built artifact (`node scripts/build-artifact.ts`; CI downloads the
  build job's) and a database.
- Until #2 is closed, `host-probe.yml` also reads deploy secrets; `_deploy.yml` is the only
  other workflow that does.
- The open host verifications (reading above the web root, `GET_LOCK`, rewrites, atomic
  rename, `%{HTTPS}`) are assumed, not probed; the runbook lists them.
