import { CSP } from '../deploy/contract/headers.ts';
import { expect, test } from './support/playwright';

const NO_CACHE = 'no-cache';
const IMMUTABLE = 'public, max-age=31536000, immutable';

test('app routes serve the SPA shell, revalidated', async ({ request }) => {
  for (const route of ['/', '/rangliste', '/zaehlen', '/verwalten']) {
    const response = await request.get(route);
    expect(response.status(), route).toBe(200);
    expect(await response.text(), route).toContain('<div id="app"></div>');
    expect(response.headers()['cache-control'], route).toBe(NO_CACHE);
  }
});

test('/api/* reaches the PHP front controller', async ({ request }) => {
  const response = await request.get('/api/no-such-route');

  expect(response.status()).toBe(404);
  expect(response.headers()['content-type']).toBe('application/problem+json');
  expect(await response.json()).toMatchObject({
    type: 'urn:performance:problem:not-found',
  });
});

test('the service worker and the manifest are revalidated, hashed assets cached forever', async ({
  request,
}) => {
  for (const file of ['/index.html', '/sw.js', '/manifest.webmanifest']) {
    const response = await request.get(file);
    expect(response.status(), file).toBe(200);
    expect(response.headers()['cache-control'], file).toBe(NO_CACHE);
  }
  const html = await (await request.get('/')).text();
  const asset = /src="(\/assets\/[^"]+\.js)"/.exec(html)?.[1];
  expect(asset).toBeDefined();
  const response = await request.get(asset ?? '');
  expect(response.status()).toBe(200);
  expect(response.headers()['cache-control']).toBe(IMMUTABLE);
});

test('a missing asset stays a 404 instead of falling back to the shell', async ({
  request,
}) => {
  const response = await request.get('/assets/gone-1a2b3c4d.js');

  expect(response.status()).toBe(404);
});

test('every response carries the CSP', async ({ request }) => {
  for (const path of [
    '/',
    '/rangliste',
    '/sw.js',
    '/manifest.webmanifest',
    '/api/health',
    '/api/no-such-route',
    '/assets/gone-1a2b3c4d.js',
  ]) {
    const response = await request.get(path);
    expect(response.headers()['content-security-policy'], path).toBe(CSP);
    expect(response.headers()['x-powered-by'], path).toBeUndefined();
  }
});

test('the app opens on every destination without a CSP violation', async ({
  page,
}) => {
  await page.goto('/');
  await expect(page).toHaveURL(/\/zaehlen$/);
  await expect(page.getByRole('heading', { name: 'Zählen' })).toBeVisible();
  for (const name of ['Rangliste', 'Verwalten'] as const) {
    await page.getByRole('link', { name }).click();
    await expect(page.getByRole('heading', { name, level: 1 })).toBeVisible();
  }
  await page.getByRole('link', { name: 'Konto' }).click();
  await expect(page).toHaveURL(/\/konto$/);
});
