import { readFileSync } from 'node:fs';
import { expect, test } from './support/playwright.ts';

test('the fixture preview opens on the fixture backend without network access', async ({
  page,
}) => {
  const network: string[] = [];
  await page.route(/\/api\//, async (route) => {
    network.push(route.request().url());
    await route.abort();
  });

  await page.goto('/index.html');

  await expect(page).toHaveURL(/#\/zaehlen$/);
  await expect(page.getByRole('heading', { name: 'Zählen' })).toBeVisible();
  await page.getByRole('link', { name: 'Konto' }).click();
  await expect(page).toHaveURL(/#\/konto$/);
  await expect(page.getByTestId('server-version')).toHaveText(
    /^Server: .+ \(Vorschau\)$/,
  );
  expect(network).toEqual([]);
});

test('the fixture preview registers no service worker', async ({ page }) => {
  await page.goto('/index.html');
  await expect(page.getByRole('heading', { name: 'Zählen' })).toBeVisible();

  const registrations = await page.evaluate(
    async () => (await navigator.serviceWorker.getRegistrations()).length,
  );

  expect(registrations).toBe(0);
});

test('the fixture preview uses relative asset paths only', () => {
  const html = readFileSync('web/dist-preview/index.html', 'utf8');

  expect(html).not.toMatch(/(src|href)="\//);
  expect(html).toMatch(/src="\.\/assets\//);
});

test('the preview menu offers the update prompt and the reload floor', async ({
  page,
}) => {
  await page.goto('/index.html');
  await page.getByText('Vorschau · Beispieldaten').click();

  await page.getByRole('button', { name: 'Neue Version anbieten' }).click();
  await expect(page.getByText('Neue Version verfügbar')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Neu laden' })).toBeVisible();

  await page
    .getByRole('button', { name: 'Veraltete Version simulieren' })
    .click();
  await expect(page.getByRole('dialog')).toContainText('Bitte neu laden');
});

test('the fixture preview counts a drink with Happy Hour ×2 on its sample evening and undoes it', async ({
  page,
}) => {
  await page.goto('/index.html');
  await page.getByRole('button', { name: 'Daniel, 13,5 Punkte heute' }).click();
  await page.getByRole('button', { name: 'Bier, 1 Punkt, heute 4' }).click();
  await page.getByRole('button', { name: 'Eins mehr' }).click();
  await page.getByRole('button', { name: 'Eins mehr' }).click();
  await page.getByRole('button', { name: 'Weiter' }).click();
  await page.getByRole('button', { name: 'Happy Hour, ×2' }).click();

  await expect(
    page.getByText('2× Bier · Happy Hour ×2 · Daniel'),
  ).toBeVisible();
  await expect(
    page.getByRole('button', { name: 'Daniel, 17,5 Punkte heute' }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Rückgängig' }).click();
  await expect(
    page.getByRole('button', { name: 'Daniel, 13,5 Punkte heute' }),
  ).toBeVisible();
});

test('the fixture preview manages its sample factors', async ({ page }) => {
  await page.goto('/index.html#/verwalten');
  await page.getByRole('link', { name: 'Faktoren' }).click();

  const factors = page.getByRole('list', { name: 'Faktoren' });
  await expect(factors.getByRole('listitem')).toHaveText([
    /Geburtstag\s*×1,5/,
    /Happy Hour\s*×2/,
  ]);
  await page.getByRole('button', { name: 'Happy Hour löschen' }).click();
  await expect(page.getByRole('dialog')).toContainText(
    '1 Eintrag zählt danach ×1.',
  );
});

test('the fixture preview ranks its sample evening on the Rangliste', async ({
  page,
}) => {
  await page.goto('/index.html#/rangliste');

  const places = page
    .getByRole('list', { name: 'Rangliste' })
    .getByRole('listitem');
  await expect(places).toHaveCount(5);
  await expect(places.first()).toHaveAccessibleName(
    'Platz 1, Daniel, 13,5 Punkte, 9 Getränke',
  );
  await expect(places.last()).toHaveAccessibleName(
    'Platz 5, Tom, 0,5 Punkte, 1 Getränk',
  );
});
