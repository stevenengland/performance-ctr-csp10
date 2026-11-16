# ADR 0003 — Production rollout: API-first activation, same-schema rollback, release archive

- Status: accepted; decision 9's provisional pins replaced by [ADR 0004](0004-host-runtime.md)
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
   rollbacks in one concurrency group; `ci.yml` queues main runs. *Amended in review round 2:*
   `inspect` also reports the release that is **in progress** (`inProgress`), and `order`
   applies the same rule against its commit; the strictest answer wins (fail, then skip, then
   deploy). A deploy cut off after its health call (API switched, database migrated, shell and
   ledger not) therefore skips a re-run of the older active commit instead of switching the API
   back.
7. **Same-schema rollback.** Before re-activating a retained release, rollback reads the live
   `schemaVersion` from health and refuses a release whose recorded schema version differs.
   A failed migration does not raise the reported version, so the previous release stays a
   valid rollback target. *Amended in review round 2:* health reports the schema the
   **database** is at. An older release used to report the newest of its own migration files
   even when a newer release had completed later ones; now a completed migration the release
   does not know raises the reported version, so the deploy's health check and this rollback
   rule see the real schema.
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
11. **Schema floor for a plain deploy** (review round 2). Before its first write, `deploy`
    refuses a release whose schema version is below the live schema: below what live health
    reports, or below the recorded schema version of the active or in-progress release, which
    also holds while health does not answer (`deploy/contract/schema-floor.ts`). A release cut off
    after its health call has switched the API and migrated, but the ledger still names the
    older release active; without the floor a re-run of that older release switched the API
    back to old PHP on the newer schema and, with health reporting the release's own files,
    finished green. Rollback keeps its own equality rule (decision 7) and does not apply the
    ledger fallback, so an emergency rollback is never blocked by a release that only got its
    marker.

## Rejected alternatives

- **Naming release folders by the deploy's release id:** the build would have to know the id
  the manifest step creates later, or the deploy would have to rewrite the tested API pointer.
- **Activating the API pointer and the shell in one rename batch** (projekt2406's single
  activation): a browser could load a shell whose API calls hit the old release.
- **Walking every release folder on every observation:** correct, but too slow (decision 4).
- **Archiving a draft Release before the deploy** (projekt2406's promote flow): the issue
  archives after a successful deploy, and production has no promote step to verify a draft.
- **Reading the live schema from `.deploy/` instead of health:** only the API knows which
  migrations completed; the ledger knows what was deployed, not what ran. The schema floor
  (decision 11) uses the ledger only as an additional lower bound, also for a health that does
  not answer.
- **Letting a plain deploy below the live schema through and relying on the post-switch health
  check:** the API pointer has switched by then, so old PHP already serves the newer schema.

## Consequences

- The deploy proof needs a built artifact (`node scripts/build-artifact.ts`; CI downloads the
  build job's) and a database.
- `_deploy.yml` is the only workflow that reads deploy secrets. The throwaway `host-probe.yml`
  of #2 was deleted after the first production deploy (2026-11-16); its script stays under
  `scripts/host-probe/` for a re-run from a temporary workflow.
- The open host verifications (reading above the web root, `GET_LOCK`, rewrites, atomic
  rename, `%{HTTPS}`) were assumed when this was written; round 2 of #2 confirmed them
  ([ADR 0004](0004-host-runtime.md), runbook "Host verifications").
