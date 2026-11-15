import { readdirSync } from 'node:fs';
import { join, relative } from 'node:path';
import { expect, test, type Page } from './support/playwright.ts';
import { signIn } from './support/session.ts';

/** The built web root the stack serves, to check the precache against. */
const webRoot = process.env.E2E_WEB_ROOT ?? 'dist/artifact/web';
const PRECACHED = /\.(js|css|html|woff2|svg|png|webmanifest)$/;

function builtFiles(): string[] {
  return readdirSync(webRoot, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => relative(webRoot, join(entry.parentPath, entry.name)))
    .filter(
      (file) =>
        PRECACHED.test(file) && file !== 'sw.js' && !file.startsWith('api/'),
    );
}

async function openControlledByServiceWorker(page: Page) {
  await signIn(page);
  await page.goto('/zaehlen');
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
  });
  // The first load is not controlled yet; the reload is.
  await page.reload();
  await expect
    .poll(() =>
      page.evaluate(() => navigator.serviceWorker.controller !== null),
    )
    .toBe(true);
}

test('the manifest makes the app installable as "Performance"', async ({
  request,
}) => {
  const manifest = (await (
    await request.get('/manifest.webmanifest')
  ).json()) as {
    name: string;
    lang: string;
    display: string;
    start_url: string;
    theme_color: string;
    background_color: string;
    icons: { src: string; sizes: string; purpose?: string }[];
  };

  expect(manifest).toMatchObject({
    name: 'Performance',
    lang: 'de',
    display: 'standalone',
    theme_color: '#fbfaf4',
    background_color: '#fbfaf4',
  });
  expect(manifest.icons.map((icon) => icon.sizes)).toEqual(
    expect.arrayContaining(['192x192', '512x512']),
  );
  expect(manifest.icons.some((icon) => icon.purpose === 'maskable')).toBe(true);
  for (const icon of manifest.icons) {
    const response = await request.get(`/${icon.src}`);
    expect(response.status(), icon.src).toBe(200);
    expect(response.headers()['content-type'], icon.src).toBe('image/png');
  }
});

test('a registered service worker precaches the complete build', async ({
  page,
}) => {
  await openControlledByServiceWorker(page);

  const cached = await page.evaluate(async () => {
    const urls: string[] = [];
    for (const name of await caches.keys()) {
      const cache = await caches.open(name);
      for (const request of await cache.keys()) {
        urls.push(new URL(request.url).pathname.slice(1));
      }
    }
    return urls;
  });

  expect(cached.sort()).toEqual(expect.arrayContaining(builtFiles().sort()));
  expect(cached.some((path) => path.startsWith('api/'))).toBe(false);
});

test('offline, the installed app shell opens and shows the offline banner', async ({
  page,
  context,
}) => {
  await openControlledByServiceWorker(page);

  await context.setOffline(true);
  await page.goto('/rangliste');

  await expect(page.getByRole('heading', { name: 'Rangliste' })).toBeVisible();
  await expect(
    page.getByRole('status').filter({ hasText: 'Offline' }),
  ).toHaveText('Offline – Getränke können gerade nicht gespeichert werden.');
  await context.setOffline(false);
});

test('a client older than health’s minClientVersion must reload', async ({
  page,
}) => {
  await page.route('**/api/health', async (route) => {
    const response = await route.fetch();
    const health = (await response.json()) as Record<string, unknown>;
    await route.fulfill({
      response,
      json: { ...health, minClientVersion: '999.0.0' },
    });
  });

  await signIn(page);
  await page.goto('/zaehlen');

  const dialog = page.getByRole('dialog');
  await expect(dialog).toContainText('Bitte neu laden');
  await expect(dialog).toContainText('Diese Version ist veraltet.');
  await expect(dialog.getByRole('button', { name: 'Neu laden' })).toBeVisible();
});
