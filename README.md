# Performance

Drink counter PWA with today's scoreboard for a group of friends: Vue 3 + Vuetify in
`web/`, a Slim 4 PHP API in `api/`, the deploy CLI in `deploy/`, Playwright in `e2e/`.
Product rules: PRD #1. UI target: [`docs/design/webapp-design-spec.md`](docs/design/webapp-design-spec.md)
and [`docs/design/mockup.html`](docs/design/mockup.html). Decisions: [`docs/adr/`](docs/adr/).

**Fixture preview** (the review surface for UI changes, design spec §12):
<https://claude.ai/artifact/5yJfcSYKRdp7hKZKq9tZ9S>

## Requirements

Node 24 (`.nvmrc`), PHP 8.3 with `pdo_mysql`, Composer, a MySQL 8.4 server for the API
tests, Docker for the e2e stack and the deploy proof (plus `sshpass` and OpenSSH `sftp`).
Enable the hooks once: `git config core.hooksPath .githooks`.

## Commands

| Command | What it does |
|---|---|
| `npm ci` | Install (exact pins, no install scripts) |
| `npm run check` | ESLint, Prettier, `tsc` + `vue-tsc`, OpenAPI type drift |
| `npm test` | Vitest: web (jsdom) and deploy/scripts (node) |
| `npm run build:preview` | Fixture preview into `web/dist-preview/` (hash routing, relative paths, no service worker) |
| `npm run api:types` | Regenerate `web/src/core/api-client/schema.d.ts` from `api/openapi.yaml` |
| `npm run build:artifact` | The one deployable artifact: `dist/artifact/` and `dist/performance-<release>.tar.gz` + `.sha256` |
| `cd api && composer test` | PHPUnit against MySQL (`DB_HOST`, `DB_PORT`, `DB_USER`, `DB_PASS`; it drops and recreates `DB_NAME`, default `performance_test`) |
| `cd api && composer analyse && composer cs` | PHPStan (max) and PHP-CS-Fixer (PER-CS) |
| `npm run test:e2e` | Playwright against the stack (`E2E_BASE_URL`, default `http://localhost:8080`) and the preview |
| `npm run test:deploy` | Deploy proof: the deploy CLI against SFTP + Apache containers (`tests/support/compose.yml`) |
| `npm run lint:workflows` | actionlint and zizmor from digest-pinned images |
| `npm run lint:secrets` | secretlint over every tracked file |

The e2e stack serves the built artifact with the rendered `.htaccess` on Apache + PHP +
MySQL:

```sh
npm run build:artifact
e2e/stack/stage.sh dist/artifact "$PWD/stack-root" http://localhost:8080
STACK_ROOT="$PWD/stack-root" docker compose -f e2e/stack/compose.yml up --build --wait
npm run build:preview && npm run test:e2e
```

## Deploy CLI

`deploy/` was imported selectively from projekt2406 ([ADR 0001](docs/adr/0001-deploy-cli-import.md))
and runs on Node 24 type stripping without npm packages: `node deploy/cli.ts` prints its
commands. `render-htaccess <site-url>` prints the web root's `.htaccess`; `manifest`,
`deploy`, `rollback` and `inspect` work on an artifact folder with `web/` and
`manifest.json` and read the production settings from the environment:

| Variable | Meaning |
|---|---|
| `SITE_URL` | Production origin (and base path) |
| `SFTP_HOST`, `SFTP_PORT` (22), `SFTP_KNOWN_HOSTS` | SFTP endpoint and its pinned host key |
| `SFTP_USER`, `SFTP_PASS` | SFTP login (secrets; never in arguments or output) |
| `DOCROOT` (`site`), `REMOTE_ROOT` (`/`) | Served folder inside the SFTP root |
| `ASSET_DIR` (`assets`) | Folder of content-hashed files: cached forever, retained for rollback |
| `SITE_ALIASES` | Host names that must redirect to `SITE_URL` |

Without Docker images, `DEPLOY_TEST_EXTERNAL=1 npm run test:deploy` uses an SFTP server on
`localhost:2222` and an Apache on `localhost:8089` that you run yourself, set up as in
`tests/support/compose.yml` (user `deploy`, chrooted so that `/remote` is writable and empty;
Apache serving `/remote/site` with `AllowOverride All`).
