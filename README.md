# Performance

Drink counter PWA for a group of friends, with a scoreboard of today, any earlier day, a
calendar week or all time (PRD #70), and game rankings by run, day, week or all time: Vue 3 + Vuetify in
`web/`, a Slim 4 PHP API in `api/`, the deploy CLI in `deploy/`, Playwright in `e2e/`.
Product rules: PRD #1. UI target: [`docs/design/webapp-design-spec.md`](docs/design/webapp-design-spec.md)
and [`docs/design/mockup.html`](docs/design/mockup.html). Decisions: [`docs/adr/`](docs/adr/).

**Fixture preview** (the review surface for UI changes, design spec §12):
<https://claude.ai/artifact/5yJfcSYKRdp7hKZKq9tZ9S>
It starts signed in as the sample admin `anna`; after `Abmelden`, the sample accounts sign in
with `beispiel-passwort`.

## Requirements

Node 24 (`.nvmrc`), PHP 8.5 with `pdo_mysql`, Composer, a MariaDB 11.8 server for the API
tests, Docker for the e2e stack and the deploy proof (plus `sshpass` and OpenSSH `sftp`).
These are the host's versions as probed on #2 (PHP 8.5.12 as FastCGI, MariaDB 11.8.8); CI
pins them by digest, see [`docs/runbook-deploy.md`](docs/runbook-deploy.md#runtime-pins).
`api/composer.json` requires PHP `~8.5.0`, so Composer's platform check refuses older PHP for
the vendor tools; CI runs every PHP tool in the pinned image.
Enable the hooks once: `git config core.hooksPath .githooks` (pre-commit: secretlint on the staged files, `npm run check`; pre-push: `npm run check`, `npm test`, PHPStan and PHP-CS-Fixer).

## Commands

| Command | What it does |
|---|---|
| `npm ci` | Install (exact pins, no install scripts) |
| `npm run check` | ESLint, Prettier, `tsc` + `vue-tsc`, OpenAPI type drift |
| `npm test` | Vitest: web (jsdom) and deploy/scripts (node) |
| `npm run build:preview` | Fixture preview into `web/dist-preview/` (hash routing, relative paths, no service worker) |
| `npm run api:types` | Regenerate `web/src/core/api-client/schema.d.ts` from `api/openapi.yaml` |
| `npm run build:artifact` | The one deployable artifact: `dist/artifact/` (with its deploy `manifest.json`) and `dist/performance-<release>.tar.gz` + `.sha256` |
| `cd api && composer test` | PHPUnit against MariaDB (`DB_HOST`, `DB_PORT`, `DB_USER`, `DB_PASS`; it drops and recreates `DB_NAME`, default `performance_test`) |
| `cd api && composer analyse && composer cs` | PHPStan (max) and PHP-CS-Fixer (PER-CS) |
| `npm run test:e2e` | Playwright against the stack (`E2E_BASE_URL`, default `http://localhost:8080`); with `E2E_PREVIEW=1` it also serves `web/dist-preview/` for the preview projects. `e2e/periods.spec.ts` moves its rows to earlier days in the stack's database through `docker compose -f e2e/stack/compose.yml exec db mariadb`; for a stack on another database set `E2E_STACK_SQL` to its client command (SQL on stdin) |
| `npx lhci autorun` | Lighthouse on the stack: Zählen, Rangliste and Verwalten signed in, Anmelden signed out (`e2e/support/lighthouse-sign-in.cjs` seeds a sample evening into an empty stack; run it before the e2e suite). Uses `/usr/bin/google-chrome`; override with `LHCI_COLLECT__CHROME_PATH` |
| `npm run test:deploy` | Deploy proof: the deploy CLI with the built artifact's PHP release against SFTP + Apache/PHP + MariaDB containers (`tests/support/compose.yml`); build the artifact first |
| `npm run lint:workflows` | actionlint and zizmor from digest-pinned images |
| `npm run lint:secrets` | secretlint over every tracked file |

The e2e stack serves the built artifact with the rendered `.htaccess` on Apache + PHP +
MariaDB. Its runtime configuration (`e2e/stack/config.php`) names the bootstrap admin the tests
sign in with (`e2e-admin`, see `e2e/support/session.ts`); every route but health and sign-in
needs a session:

```sh
npm run build:artifact
e2e/stack/stage.sh dist/artifact "$PWD/stack-root" http://localhost:8080
STACK_ROOT="$PWD/stack-root" docker compose -f e2e/stack/compose.yml up --build --wait
npm run build:preview && E2E_PREVIEW=1 npm run test:e2e
```

## Deploy

Every green push to `main` deploys to production and archives the artifact as a GitHub
Release; `Rollback` (owner-only dispatch) re-activates a retained release with the live
schema version; `Live check` checks production health weekly. Settings, activation order,
failure handling and the runtime pins: [`docs/runbook-deploy.md`](docs/runbook-deploy.md).

`deploy/` was imported selectively from projekt2406 ([ADR 0001](docs/adr/0001-deploy-cli-import.md))
and extended for the PHP release ([ADR 0003](docs/adr/0003-production-rollout.md)). It runs on
Node 24 type stripping without npm packages: `node deploy/cli.ts` prints its commands
(`render-htaccess`, `manifest`, `deploy`, `rollback`, `inspect`, `order`, `live-check`,
`release-tag`). Besides the settings in the runbook it reads the optional `SFTP_PORT` (22),
`REMOTE_ROOT` (`/`) and `ASSET_DIR` (`assets`).

Without Docker images, `DEPLOY_TEST_EXTERNAL=1 npm run test:deploy` uses servers you run
yourself, as described at the end of the runbook.
