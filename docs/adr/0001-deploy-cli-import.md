# ADR 0001 — Deploy CLI imported selectively from projekt2406

- Status: accepted
- Date: 2026-11-15
- Context: PRD #1, slice #3 (1/2). The owner runs a proven deploy pipeline in projekt2406
  and wants this app rolled out the same way, without a shared package and without
  inheriting obligations this host does not have.

## Source

- Repository: projekt2406 (the owner's static-site project, deployed to Strato over SFTP)
- Commit: `506dfdfcba48c173806c50b4d3ed66e5e2255e40`
- Paths: `deploy/`, `tests/support/`, `scripts/lint-workflows.sh`,
  `vitest.deploy.config.ts`

## Decision

Copy the modules the Strato SFTP target needs into `deploy/`, keep their design and
tests, and adapt them in place. From here on the code is ours; there is no sync back.

### Imported

| Part | Files here | Changes on import |
|---|---|---|
| Contract | `deploy/contract/{artifact,parse,policy,headers,operations}.ts` | One production target: no `staging`/`prod` targets, access or indexing; the manifest drops `origin` and `sampleData` and is checked against the base only (the SPA build is origin-independent) |
| SFTP transport | `deploy/io/{sftp,process,redact,fs}.ts` | Reads `SFTP_HOST`, `SFTP_PORT`, `SFTP_USER`, `SFTP_PASS`, `SFTP_KNOWN_HOSTS` |
| Planner | `deploy/webspace/{plan,phase,cleanup,prune,observe,layout,remote-state,ports,adapter}.ts` | No `.htpasswd`; the hashed-asset folder is the policy's `assetDir` |
| Release ledger | `deploy/webspace/ledger.ts` | Unchanged: active + two previous releases, 24 h prune window |
| `.htaccess` renderer | `deploy/webspace/htaccess.ts` | Imported by slice #4 and extended there (ADR 0002); the version here wins over projekt2406's |
| HTTP checks | `deploy/webspace/checks.ts`, `deploy/io/http-smoke.ts` | Anonymous only; a missing hashed asset must be a 404 (app routes fall back to the shell, so projekt2406's 404 route check no longer applies) |
| CLI | `deploy/cli.ts`, `deploy/cli-args.ts` | `manifest`, `deploy`, `rollback`, `inspect` beside slice #4's `render-htaccess` |
| Test support | `tests/support/{fake-remote,transport-contract,interrupt,run-captured,deploy-containers,fixture-artifact,fixture-site}.ts`, `tests/support/compose.yml`, `deploy/adapter.integration.test.ts` | SFTP + Apache only; an SPA fixture; `DEPLOY_TEST_EXTERNAL=1` for self-run servers |
| Tooling | `scripts/lint-workflows.sh`, `tests/support/workflows/*-violation.yml` | No devcontainer path translation |

The unit tests of every imported module came along and were adapted with it.

### Generalised: the hashed-asset folder

projekt2406 hard-coded Astro's `_astro/`. Here the folder is the target policy's
`assetDir`, from the optional `ASSET_DIR` variable, default Vite's `assets`. Files under
it are immutable: uploaded beside the live ones under `.part` names, never overwritten,
cached for a year by the rendered `.htaccess` and kept while a retained release or the
24 h window needs them. Every other file of the web root is staged and activated by
rename.

### Deliberately left out

- **FTPS transport** (`io/ftps.ts`, `io/mlsd.ts`, `io/transport.ts` dispatch): the host is
  reached over SFTP only.
- **Staging and promote policy**: targets, basic auth and `.htpasswd`
  (`webspace/protection.ts`, `io/htpasswd.ts`), promotion evidence
  (`contract/evidence.ts`, `io/github.ts`), the descendant ordering of deploys
  (`contract/ordering.ts`, `io/git.ts`) and the `promote` workflow. PRD #1 has one
  production environment; slice 1/4 decides how production follows the newest commit.
- **Astro-specific code**: the canonical origin, sample-data flags, the `404.html` page,
  the sitemap-driven live check (`contract/live-check.ts`, `io/live-site.ts`), design
  tokens, Playwright and Lighthouse wrappers. The weekly live check of slice 1/4 checks
  the health endpoint instead.
- **`verify`, `evidence`, `archive`, `rollback-source`, `order`, `check-live` commands.**

### Kept as projekt2406 decided

Node 24 type stripping with no npm packages at runtime; `deploy/contract/` imports no
adapter and `deploy/webspace/` only the contract (ESLint enforces both); pure modules take
`now`; secrets only in the environment, redacted from every line the CLI prints; staged
upload and atomic activation by rename; the ledger and its retention; post-deploy HTTP
checks before the release is recorded; rollback only to a retained release whose
manifest matches the artifact; workflows linted by actionlint and zizmor from
digest-pinned images; images and actions pinned by digest or commit SHA.

## Planned extensions (slice 1/4)

1. **PHP release folder:** PHP code, Composer dependencies and migrations go into
   `app/<releaseId>/` outside the web root and are retained and pruned with the ledger;
   the web root's `api/index.php` pointer names the release, so one request never mixes
   two releases.
2. **Activation order:** hashed assets and the PHP release folder → API pointer →
   migration via `GET /api/health` → `index.html`, manifest and service worker last.
3. **Rendered config:** the runtime configuration (database credentials, bootstrap admin)
   is rendered from GitHub secrets on every deploy into a file outside the web root by
   put-then-rename, as projekt2406 does with `.htpasswd`.
4. **Single production target:** the repository's own variables and secrets, read only
   by `_deploy.yml`, whose deploy jobs run `node deploy/cli.ts` only.
5. **Same-schema rollback:** each release records its schema version; rollback is
   refused when it differs from the live database's.

## Consequences

- The deploy artifact folder holds `web/` and `manifest.json`; the build's own
  `release.json` (ADR 0002) sits beside them without a name clash. Slice 1/4 joins the
  two when it ships `app/<release>/`.
- `deploy/` uses this repository's exact dev-dependency pins (Vitest 5.1.0, TypeScript
  5.9.3, `@types/node` 24.19.2) rather than projekt2406's (5.0.5, 6.0.3, 24.19.2): slice
  #4 pinned them first for the whole workspace, and `deploy/` needs none at runtime.
- The deploy proof needs Docker Hub images (`atmoz/sftp`, `httpd`); where they cannot be
  pulled, `DEPLOY_TEST_EXTERNAL=1` runs the same tests against servers set up by hand.
