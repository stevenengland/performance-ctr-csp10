import { execFileSync } from 'node:child_process';
import { cpSync, mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { extname, join, normalize, resolve } from 'node:path';
import { meetsFloor } from '../scripts/artifact.ts';
import { expect, test } from './support/playwright.ts';

/*
The reload floor across a real two-version update: the shipped web root
(release 1) is installed with its service worker, then a second build of the
same tree with a newer app version (release 2) replaces it and raises
`minClientVersion` above release 1, as a deploy with a breaking API change does.
Both are served from a throwaway origin, so the shared stack keeps serving
release 1 to the other tests; health and every other API call are canned. The
canned API refuses a client below the floor as `ClientVersionGate` does (its own
behaviour is covered by PHPUnit), so a test can raise the floor under a release 1
tab that stays open.
*/

const webRoot = process.env.E2E_WEB_ROOT ?? 'dist/artifact/web';
const NEXT_VERSION = '999.0.0+e2e';
const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.woff2': 'font/woff2',
  '.webmanifest': 'application/manifest+json',
};

interface Release {
  root: string;
  minClientVersion: string;
}

/** A webspace whose served release the test switches, with the app routes falling back to index.html. */
function webspace(initial: Release) {
  let current = initial;
  const server: Server = createServer((request, response) => {
    const path = new URL(request.url ?? '/', 'http://x').pathname;
    if (path === '/api/health') {
      response.writeHead(200, { 'Content-Type': 'application/json' });
      response.end(
        JSON.stringify({
          appVersion: '0.0.0',
          phpVersion: '8.3.0',
          database: { engine: 'MySQL', version: '8.4.0' },
          schemaVersion: 1,
          migration: 'ok',
          minClientVersion: current.minClientVersion,
        }),
      );
      return;
    }
    const clientVersion = request.headers['x-client-version'];
    if (
      path.startsWith('/api/') &&
      !meetsFloor(
        typeof clientVersion === 'string' ? clientVersion : '0.1.0',
        current.minClientVersion,
      )
    ) {
      response.writeHead(400, { 'Content-Type': 'application/problem+json' });
      response.end(
        JSON.stringify({
          type: 'urn:performance:problem:client-outdated',
          title: 'Diese Version ist veraltet. Bitte neu laden.',
          status: 400,
        }),
      );
      return;
    }
    if (path.startsWith('/api/')) {
      response.writeHead(401, { 'Content-Type': 'application/problem+json' });
      response.end(JSON.stringify({ status: 401, title: 'Nicht angemeldet' }));
      return;
    }
    const asked = join(current.root, normalize(decodeURIComponent(path)));
    const file =
      asked.startsWith(current.root) &&
      statSync(asked, { throwIfNoEntry: false })?.isFile()
        ? asked
        : join(current.root, 'index.html');
    response.writeHead(200, {
      'Content-Type': TYPES[extname(file)] ?? 'application/octet-stream',
      'Cache-Control': 'no-cache',
    });
    response.end(readFileSync(file));
  });
  return {
    server,
    switchTo(release: Release) {
      current = release;
    },
  };
}

/** The module script index.html starts, which differs between the two builds. */
function entryScript(root: string): string {
  const match = /<script type="module"[^>]*src="([^"]+)"/.exec(
    readFileSync(join(root, 'index.html'), 'utf8'),
  );
  if (!match?.[1]) throw new Error(`no entry script in ${root}`);
  return match[1];
}

test.describe('the reload floor across a real update', () => {
  test.describe.configure({ timeout: 180_000 });

  let scratch: string;
  let first: Release;
  let second: Release;
  let site: ReturnType<typeof webspace>;
  let origin: string;

  test.beforeAll(() => {
    // Building release 2 takes longer than a hook's default timeout on a slow runner.
    test.setTimeout(180_000);
    scratch = mkdtempSync(join(tmpdir(), 'performance-update-'));
    first = { root: join(scratch, 'release-1'), minClientVersion: '0.1.0' };
    second = {
      root: join(scratch, 'release-2'),
      minClientVersion: NEXT_VERSION.split('+')[0] ?? NEXT_VERSION,
    };
    cpSync(resolve(webRoot), first.root, { recursive: true });
    execFileSync(
      'npx',
      [
        'vite',
        'build',
        '--outDir',
        second.root,
        '--emptyOutDir',
        '--logLevel',
        'warn',
      ],
      {
        cwd: 'web',
        env: { ...process.env, APP_VERSION: NEXT_VERSION },
        stdio: 'inherit',
      },
    );
  });

  test.beforeEach(async () => {
    site = webspace(first);
    await new Promise<void>((done) => site.server.listen(0, '127.0.0.1', done));
    origin = `http://127.0.0.1:${String((site.server.address() as AddressInfo).port)}`;
  });

  test.afterEach(async () => {
    await new Promise((done) => site.server.close(done));
  });

  test.afterAll(() => {
    rmSync(scratch, { recursive: true, force: true });
  });

  test('"Neu laden" activates the new service worker and reloads into the new release', async ({
    page,
  }) => {
    expect(entryScript(second.root)).not.toBe(entryScript(first.root));

    // Release 1 installed: its service worker controls the page.
    await page.goto(`${origin}/anmelden`);
    await page.evaluate(async () => {
      await navigator.serviceWorker.ready;
    });
    await page.reload();
    await expect
      .poll(() =>
        page.evaluate(() => navigator.serviceWorker.controller !== null),
      )
      .toBe(true);
    await expect(page.getByRole('dialog')).toHaveCount(0);

    // Release 2 deployed: it raises the floor above release 1.
    site.switchTo(second);
    await page.reload();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toContainText('Bitte neu laden');
    // The old worker still serves release 1, and release 2's worker waits.
    await expect(
      page.locator(`script[src="${entryScript(first.root)}"]`),
    ).toHaveCount(1);
    await expect
      .poll(
        () =>
          page.evaluate(
            async () =>
              (await navigator.serviceWorker.getRegistration())?.waiting !==
              null,
          ),
        { timeout: 30_000 },
      )
      .toBe(true);

    const reloaded = page.waitForEvent('load', { timeout: 60_000 });
    await dialog.getByRole('button', { name: 'Neu laden' }).click();
    await reloaded;

    await expect(
      page.locator(`script[src="${entryScript(second.root)}"]`),
    ).toHaveCount(1);
    await expect(
      page.getByRole('heading', { name: 'Performance' }),
    ).toBeVisible();
    await expect
      .poll(() =>
        page.evaluate(
          async () =>
            (await navigator.serviceWorker.getRegistration())?.waiting === null,
        ),
      )
      .toBe(true);
    await expect(page.getByRole('dialog')).toHaveCount(0);
  });

  test('a tab opened before the floor was raised must reload on its next request, without reloading first', async ({
    page,
  }) => {
    // Release 1 is open and read the floor when it started. The marker survives only without a reload.
    await page.goto(`${origin}/anmelden`);
    await expect(page.getByLabel('Benutzername')).toBeVisible();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await page.evaluate(() => {
      Object.assign(window, { e2eOpenSinceRelease1: true });
    });

    // Release 2 deployed while the tab stays open: the API raises the floor.
    site.switchTo(second);
    await page.getByLabel('Benutzername').fill('anna');
    await page.getByLabel('Passwort', { exact: true }).fill('annas-passwort');
    await page.getByRole('button', { name: 'Anmelden' }).click();

    const dialog = page.getByRole('dialog');
    await expect(dialog).toContainText('Bitte neu laden');
    await expect(
      dialog.getByRole('button', { name: 'Neu laden' }),
    ).toBeVisible();
    // The same page: the floor reached it through the refused sign-in, not through a reload.
    expect(await page.evaluate(() => 'e2eOpenSinceRelease1' in window)).toBe(
      true,
    );
  });
});
