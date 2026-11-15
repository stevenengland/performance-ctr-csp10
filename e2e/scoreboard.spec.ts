import { randomUUID } from 'node:crypto';
import {
  expect,
  test,
  type APIRequestContext,
  type Page,
} from './support/playwright.ts';
import { withoutFactors } from './support/factors.ts';
import { signIn, signInVia, uniqueName } from './support/session.ts';

/** The feed's polling interval while the Rangliste is visible. */
const POLL_MS = 10_000;

async function created(
  request: APIRequestContext,
  path: '/api/persons' | '/api/drinks',
  data: Record<string, unknown>,
): Promise<number> {
  const response = await request.post(path, { data });
  expect(response.status()).toBe(201);
  return ((await response.json()) as { id: number }).id;
}

async function addEntry(
  request: APIRequestContext,
  personId: number,
  drinkId: number,
  quantity: number,
) {
  const response = await request.put(`/api/entries/${randomUUID()}`, {
    data: { personId, drinkId, quantity },
  });
  expect(response.status()).toBe(201);
}

/** A person's place on the Rangliste: the leader card or a row, a link named `Platz n, <name>, …`. */
function place(page: Page, name: string) {
  return page.getByRole('link', {
    name: new RegExp(`^Platz \\d+, ${name},`),
  });
}

/** The next scoreboard request the page sends. */
function scoreboardRequests(page: Page) {
  return page.waitForRequest((request) =>
    request.url().includes('/api/scoreboard'),
  );
}

test.beforeEach(async ({ page }) => {
  await signIn(page);
});

test('the Rangliste ranks today’s persons by score with their counters, German-style', async ({
  page,
}) => {
  const anna = uniqueName('Anna');
  const ben = uniqueName('Ben');
  const bier = uniqueName('Bier');
  const radler = uniqueName('Radler');
  const annaId = await created(page.request, '/api/persons', { name: anna });
  const benId = await created(page.request, '/api/persons', { name: ben });
  const bierId = await created(page.request, '/api/drinks', {
    name: bier,
    points: 1,
  });
  const radlerId = await created(page.request, '/api/drinks', {
    name: radler,
    points: 0.5,
  });
  await addEntry(page.request, annaId, bierId, 2);
  await addEntry(page.request, benId, bierId, 1);
  await addEntry(page.request, benId, radlerId, 3);

  await page.goto('/rangliste');

  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Rangliste');
  await expect(page.getByText('Heute', { exact: true })).toBeVisible();
  // Ben: 1 × 1 + 3 × 0,5 = 2,5 before Anna: 2 × 1 = 2.
  const ben2 = place(page, ben);
  await expect(ben2).toHaveAccessibleName(
    new RegExp(`^Platz \\d+, ${ben}, 2,5 Punkte, 4 Getränke$`),
  );
  await expect(ben2).toContainText(`${bier} 1 · ${radler} 3`);
  await expect(place(page, anna)).toHaveAccessibleName(
    new RegExp(`^Platz \\d+, ${anna}, 2 Punkte, 2 Getränke$`),
  );
  const rank = async (name: string) =>
    Number(
      /^Platz (\d+)/.exec(
        (await place(page, name).getAttribute('aria-label')) ?? '',
      )?.[1],
    );
  expect(await rank(ben)).toBeLessThan(await rank(anna));
});

test('an entry added in one browser appears on another browser’s Rangliste within one refresh interval', async ({
  page,
  browser,
}) => {
  const person = uniqueName('Daniel');
  const drink = uniqueName('Bier');
  await created(page.request, '/api/persons', { name: person });
  await created(page.request, '/api/drinks', { name: drink, points: 1.5 });
  const other = await browser.newContext({
    baseURL: test.info().project.use.baseURL,
    viewport: test.info().project.use.viewport,
    locale: 'de-DE',
  });
  try {
    const watcher = await other.newPage();
    await signInVia(watcher.request);
    await watcher.goto('/rangliste');
    await expect(
      watcher.getByRole('list', { name: 'Rangliste' }),
    ).toBeVisible();
    await expect(place(watcher, person)).toHaveCount(0);

    await withoutFactors(page);
    await page.goto('/zaehlen');
    await page.getByRole('button', { name: new RegExp(`^${person},`) }).click();
    await page.getByRole('button', { name: new RegExp(`^${drink},`) }).click();
    await page.getByRole('button', { name: 'Eins mehr' }).click();
    await page.getByRole('button', { name: 'Speichern' }).click();
    await expect(page.getByText(`1× ${drink} · ${person}`)).toBeVisible();

    await expect(place(watcher, person)).toHaveAccessibleName(
      new RegExp(`^Platz \\d+, ${person}, 1,5 Punkte, 1 Getränk$`),
      { timeout: POLL_MS + 2_000 },
    );
  } finally {
    await other.close();
  }
});

test('the scoreboard answers 304 through Apache while nothing changed', async ({
  page,
}) => {
  const url = `/api/scoreboard?from=${encodeURIComponent(new Date().toISOString())}`;
  const first = await page.request.get(url);
  const etag = first.headers().etag ?? '';
  expect(etag).toMatch(/^"\d+-\d+"$/);

  const again = await page.request.get(url, {
    headers: { 'If-None-Match': etag },
  });

  expect(again.status()).toBe(304);
  await created(page.request, '/api/persons', { name: uniqueName('Jule') });
  const changed = await page.request.get(url, {
    headers: { 'If-None-Match': etag },
  });
  expect(changed.status()).toBe(200);
});

test('the Rangliste polls every 10 s on condition, keeps its standings with “Stand: hh:mm” when a refresh fails, and shows maintenance', async ({
  page,
}) => {
  const person = uniqueName('Mara');
  const personId = await created(page.request, '/api/persons', {
    name: person,
  });
  const drinkId = await created(page.request, '/api/drinks', {
    name: uniqueName('Aperol'),
    points: 2,
  });
  await addEntry(page.request, personId, drinkId, 1);
  await page.clock.install();
  const first = scoreboardRequests(page);
  await page.goto('/rangliste');
  await first;
  await expect(place(page, person)).toBeVisible();

  const polled = scoreboardRequests(page);
  await page.clock.runFor(POLL_MS);
  const conditional = await polled;
  expect(conditional.headers()['if-none-match']).toMatch(/^"\d+-\d+"$/);
  expect((await conditional.response())?.status()).toBe(304);
  // The time of the last successful refresh, as the page's clock tells it.
  const confirmedAt = await page.evaluate(() =>
    new Intl.DateTimeFormat('de-DE', {
      hour: '2-digit',
      minute: '2-digit',
    }).format(new Date()),
  );

  await page.route('**/api/scoreboard*', (route) =>
    route.abort('connectionreset'),
  );
  await page.clock.runFor(POLL_MS);
  await expect(page.getByText(`Stand: ${confirmedAt}`)).toBeVisible();
  await expect(place(page, person)).toBeVisible();

  await page.unroute('**/api/scoreboard*');
  await page.route('**/api/scoreboard*', (route) =>
    route.fulfill({
      status: 503,
      headers: { 'Retry-After': '3' },
      contentType: 'application/problem+json',
      body: JSON.stringify({
        type: 'urn:performance:problem:maintenance',
        title: 'Wird aktualisiert – gleich wieder da',
        status: 503,
      }),
    }),
  );
  await page.clock.runFor(5_000);
  await expect(
    page.getByText('Wird aktualisiert – gleich wieder da'),
  ).toBeVisible();

  await page.unroute('**/api/scoreboard*');
  const recovered = page.waitForResponse((response) =>
    response.url().includes('/api/scoreboard'),
  );
  await page.clock.runFor(3_000);
  expect([200, 304]).toContain((await recovered).status());
  await expect(page.getByText(/^Stand: /)).toHaveCount(0);
});

test('with nobody today the Rangliste says so and offers Zählen', async ({
  page,
}) => {
  await page.route('**/api/scoreboard*', (route) =>
    route.fulfill({ json: { rows: [] }, headers: { ETag: '"0-0"' } }),
  );

  await page.goto('/rangliste');

  await expect(page.getByText('Heute noch keine Getränke.')).toBeVisible();
  await page.getByRole('main').getByRole('link', { name: 'Zählen' }).click();
  await expect(page).toHaveURL(/\/zaehlen$/);
});
