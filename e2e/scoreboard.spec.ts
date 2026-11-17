import { randomUUID } from 'node:crypto';
import {
  expect,
  test,
  type APIRequestContext,
  type Locator,
  type Page,
} from './support/playwright.ts';
import { withoutFactors } from './support/factors.ts';
import { coloursAt } from './support/photo.ts';
import {
  signIn,
  signInVia,
  uniqueName,
  verifierOn,
} from './support/session.ts';

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

/** Records an entry, which waits for verification, and returns its id. */
async function addEntry(
  request: APIRequestContext,
  personId: number,
  drinkId: number,
  quantity: number,
): Promise<string> {
  const id = randomUUID();
  const response = await request.put(`/api/entries/${id}`, {
    data: { personId, drinkId, quantity },
  });
  expect(response.status()).toBe(201);
  return id;
}

/**
Sets a person's photo through the API, as another phone would: a 256 × 256
JPEG in one colour, encoded by the browser like the app's own uploads.
*/
async function setPhoto(page: Page, personId: number, colour: 'red' | 'blue') {
  const image = await page.evaluate((fill) => {
    const canvas = document.createElement('canvas');
    canvas.width = 256;
    canvas.height = 256;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('no 2D context');
    context.fillStyle = fill;
    context.fillRect(0, 0, 256, 256);
    return canvas.toDataURL('image/jpeg', 0.85).split(',')[1] ?? '';
  }, colour);
  const response = await page.request.put(
    `/api/persons/${String(personId)}/photo`,
    { data: { image } },
  );
  expect(response.status()).toBe(200);
}

/**
A person with one drink today, so they are listed on the Rangliste: the entry
waits for verification, so without a rank, under `Noch nicht gewertet`.
*/
async function drinking(request: APIRequestContext, name: string) {
  const personId = await created(request, '/api/persons', { name });
  const drinkId = await created(request, '/api/drinks', {
    name: uniqueName('Bier'),
    points: 1,
  });
  await addEntry(request, personId, drinkId, 1);
  return personId;
}

/** The colour in the middle of a loaded photo; polled, as photos load late. */
function colourOf(photo: Locator) {
  return async () => (await coloursAt(photo, [[0.5, 0.5]]))[0];
}

/**
A person's place on the Rangliste: the leader card or a row, a link named
`Platz n, <name>, …`, or a row without a rank, named `<name>, …`.
*/
function place(page: Page, name: string) {
  return page.getByRole('link', {
    name: new RegExp(`^(Platz \\d+, )?${name},`),
  });
}

/**
The next scoreboard read of a period: today (`from` alone, today's feed, polled
every 10 s), a window with its end (a day or a week), or all time. The feed and a
period's read share the path, and the days read beside them is another resource,
so the query tells them apart.
*/
function scoreboardRequests(page: Page, period: 'today' | 'window' | 'all') {
  return page.waitForRequest((request) => {
    const url = new URL(request.url());
    if (!url.pathname.endsWith('/api/scoreboard')) return false;
    if (period === 'all') return url.search === '?scope=all';
    return url.searchParams.has('to') === (period === 'window');
  });
}

test.beforeEach(async ({ page }) => {
  await signIn(page);
});

test('the Rangliste ranks today’s persons by score with their counters, German-style, once another account verified their entries', async ({
  page,
  request,
}) => {
  const verify = await verifierOn(request);
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
  for (const entry of [
    await addEntry(page.request, annaId, bierId, 2),
    await addEntry(page.request, benId, bierId, 1),
    await addEntry(page.request, benId, radlerId, 3),
  ]) {
    await verify(entry);
  }

  await page.goto('/rangliste');

  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Rangliste');
  await expect(
    page.getByRole('banner').getByText('Heute', { exact: true }),
  ).toBeVisible();
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

test('the Rangliste lists today’s persons whose entries all wait without a rank, with what they recorded, German-style', async ({
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
  await expect(
    page.getByRole('banner').getByText('Heute', { exact: true }),
  ).toBeVisible();
  // Nothing is verified yet: both wait, by name, with what they recorded.
  const unranked = page.getByRole('list', { name: 'Noch nicht gewertet' });
  const ben2 = unranked.getByRole('link', { name: new RegExp(`^${ben},`) });
  await expect(ben2).toHaveAccessibleName(
    `${ben}, ${bier} 1 · ${radler} 3, +2 offen`,
  );
  await expect(ben2).toContainText('+2 offen');
  await expect(
    unranked.getByRole('link', { name: new RegExp(`^${anna},`) }),
  ).toHaveAccessibleName(`${anna}, ${bier} 2, +1 offen`);
  await expect(
    page.getByRole('link', {
      name: new RegExp(`^Platz \\d+, (${anna}|${ben}),`),
    }),
  ).toHaveCount(0);
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
    extraHTTPHeaders: test.info().project.use.extraHTTPHeaders,
  });
  try {
    const watcher = await other.newPage();
    await signInVia(watcher.request);
    await watcher.goto('/rangliste');
    // Loaded: ranked places, places without a rank, or nobody yet.
    await expect(
      watcher
        .getByRole('list', { name: /^(Rangliste|Noch nicht gewertet)$/ })
        .or(watcher.getByText('Heute noch keine Getränke.'))
        .first(),
    ).toBeVisible();
    await expect(place(watcher, person)).toHaveCount(0);

    await withoutFactors(page);
    await page.goto('/zaehlen');
    await page.getByRole('button', { name: new RegExp(`^${person},`) }).click();
    await page.getByRole('button', { name: new RegExp(`^${drink},`) }).click();
    await page.getByRole('button', { name: 'Eins mehr' }).click();
    await page.getByRole('button', { name: 'Speichern' }).click();
    await expect(
      page.getByText(`1× ${drink} · ${person} · wartet auf Bestätigung`),
    ).toBeVisible();

    await expect(place(watcher, person)).toHaveAccessibleName(
      `${person}, ${drink} 1, +1 offen`,
      { timeout: POLL_MS + 2_000 },
    );
  } finally {
    await other.close();
  }
});

test('a photo changed on another phone shows on the Rangliste after the next refresh, and a removed one shows initials', async ({
  page,
}) => {
  const person = uniqueName('Mara');
  const personId = await drinking(page.request, person);
  await setPhoto(page, personId, 'red');
  await page.goto('/rangliste');
  const avatar = place(page, person).locator('.person-avatar');
  await expect.poll(colourOf(avatar.locator('img'))).toBe('red');

  await setPhoto(page, personId, 'blue');

  await expect
    .poll(colourOf(avatar.locator('img')), { timeout: POLL_MS + 5_000 })
    .toBe('blue');
  const removed = await page.request.delete(
    `/api/persons/${String(personId)}/photo`,
  );
  expect(removed.status()).toBe(204);
  await expect(avatar.locator('[data-initials]')).toHaveAttribute(
    'data-initials',
    'M',
    { timeout: POLL_MS + 5_000 },
  );
  await expect(avatar.locator('img')).toHaveCount(0);
  await expect(place(page, person)).toHaveAccessibleName(
    new RegExp(`^${person}, .+ 1, \\+1 offen$`),
  );
});

test('after a warm load the cached photos keep showing when the connection drops', async ({
  page,
  context,
}) => {
  const person = uniqueName('Jule');
  const personId = await drinking(page.request, person);
  await setPhoto(page, personId, 'red');
  const tilePhoto = page
    .getByRole('button', { name: new RegExp(`^${person},`) })
    .locator('.person-avatar img');
  const placePhoto = place(page, person).locator('.person-avatar img');
  await page.goto('/zaehlen');
  await expect.poll(colourOf(tilePhoto)).toBe('red');
  await page.getByRole('link', { name: 'Rangliste' }).click();
  await expect.poll(colourOf(placePhoto)).toBe('red');

  await context.setOffline(true);
  try {
    // Each screen draws new images, which only the browser's cache can fill now.
    await page.getByRole('link', { name: 'Zählen' }).click();
    await expect.poll(colourOf(tilePhoto)).toBe('red');
    await page.getByRole('link', { name: 'Rangliste' }).click();
    await expect.poll(colourOf(placePhoto)).toBe('red');
  } finally {
    await context.setOffline(false);
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
  const first = scoreboardRequests(page, 'today');
  await page.goto('/rangliste');
  await first;
  await expect(place(page, person)).toBeVisible();

  const polled = scoreboardRequests(page, 'today');
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

test('the Rangliste reads yesterday with its window and Gesamt with scope=all, and comes back to today', async ({
  page,
  request,
}) => {
  const verify = await verifierOn(request);
  const anna = uniqueName('Anna');
  const annaId = await created(page.request, '/api/persons', { name: anna });
  const bierId = await created(page.request, '/api/drinks', {
    name: uniqueName('Bier'),
    points: 1,
  });
  await verify(await addEntry(page.request, annaId, bierId, 2));
  await page.goto('/rangliste');
  await expect(place(page, anna)).toBeVisible();

  const yesterday = scoreboardRequests(page, 'window');
  await page.getByRole('button', { name: 'Vorheriger Tag' }).click();
  const window = new URL((await yesterday).url()).searchParams;
  expect(
    Date.parse(window.get('to') ?? '') - Date.parse(window.get('from') ?? ''),
  ).toBeGreaterThanOrEqual(23 * 60 * 60 * 1000);
  await expect(page.getByText('Gestern', { exact: true })).toBeVisible();
  await expect(place(page, anna)).toHaveCount(0);

  const allTime = scoreboardRequests(page, 'all');
  await page
    .getByRole('group', { name: 'Zeitraum' })
    .getByRole('button', { name: 'Gesamt' })
    .click();
  expect(new URL((await allTime).url()).search).toBe('?scope=all');
  await expect(
    page.getByRole('banner').getByText('Gesamt', { exact: true }),
  ).toBeVisible();
  await expect(place(page, anna)).toHaveAccessibleName(
    new RegExp(`^Platz \\d+, ${anna}, 2 Punkte, 2 Getränke$`),
  );

  await page
    .getByRole('group', { name: 'Zeitraum' })
    .getByRole('button', { name: 'Tag' })
    .click();
  await page.getByRole('button', { name: 'Nächster Tag' }).click();
  await expect(
    page.getByRole('banner').getByText('Heute', { exact: true }),
  ).toBeVisible();
  await expect(place(page, anna)).toBeVisible();
});

test('the Rangliste reads this week from Monday’s to next Monday’s local midnight, and the week before without today’s entries', async ({
  page,
  request,
}) => {
  const verify = await verifierOn(request);
  const anna = uniqueName('Anna');
  const annaId = await created(page.request, '/api/persons', { name: anna });
  const bierId = await created(page.request, '/api/drinks', {
    name: uniqueName('Bier'),
    points: 1,
  });
  await verify(await addEntry(page.request, annaId, bierId, 3));
  await page.goto('/rangliste');
  await expect(place(page, anna)).toBeVisible();

  const thisWeek = scoreboardRequests(page, 'window');
  await page
    .getByRole('group', { name: 'Zeitraum' })
    .getByRole('button', { name: 'Woche' })
    .click();
  const window = new URL((await thisWeek).url()).searchParams;
  const from = window.get('from') ?? '';
  const hours =
    (Date.parse(window.get('to') ?? '') - Date.parse(from)) / 3_600_000;
  expect([167, 168, 169]).toContain(hours);
  expect(
    await page.evaluate((instant) => {
      const start = new Date(instant);
      return [start.getDay(), start.getHours(), start.getMinutes()];
    }, from),
  ).toEqual([1, 0, 0]);
  await expect(page.getByText('Diese Woche', { exact: true })).toBeVisible();
  await expect(page.getByRole('banner')).toContainText(/KW \d{1,2} · /);
  await expect(place(page, anna)).toHaveAccessibleName(
    new RegExp(`^Platz \\d+, ${anna}, 3 Punkte, 3 Getränke$`),
  );

  await page.getByRole('button', { name: 'Vorherige Woche' }).click();
  await expect(page.getByText('Letzte Woche', { exact: true })).toBeVisible();
  await expect(place(page, anna)).toHaveCount(0);
});

test('Tag wählen dots today once an entry counts and picks yesterday; Gesamt says since when it counts, its days read again on condition', async ({
  page,
  request,
}) => {
  const verify = await verifierOn(request);
  const anna = uniqueName('Anna');
  const annaId = await created(page.request, '/api/persons', { name: anna });
  const bierId = await created(page.request, '/api/drinks', {
    name: uniqueName('Bier'),
    points: 1,
  });
  await verify(await addEntry(page.request, annaId, bierId, 1));
  await page.goto('/rangliste');
  await expect(place(page, anna)).toBeVisible();
  const dialog = page.getByRole('dialog');
  const daysRead = () =>
    page.waitForResponse((response) =>
      new URL(response.url()).pathname.endsWith('/api/scoreboard/days'),
    );
  const [today, yesterday] = await page.evaluate(() => {
    const now = new Date();
    const name = new Intl.DateTimeFormat('de-DE', {
      weekday: 'long',
      day: 'numeric',
      month: 'long',
    });
    const before = new Date(
      now.getFullYear(),
      now.getMonth(),
      now.getDate() - 1,
    );
    return [
      { name: name.format(now) },
      {
        name: name.format(before),
        earlierMonth: before.getMonth() !== now.getMonth(),
      },
    ];
  });

  const first = daysRead();
  await page.getByRole('button', { name: 'Tag wählen: Heute' }).click();
  expect((await first).status()).toBe(200);
  const firstEtag = (await first).headers().etag;
  expect(firstEtag).toMatch(/^"\d+"$/);
  const todayInCalendar = dialog.getByRole('button', {
    name: today?.name,
    exact: true,
  });
  await expect(todayInCalendar).toHaveAttribute('aria-pressed', 'true');
  await expect(todayInCalendar).toHaveClass(/calendar__day--marked/);
  if (yesterday?.earlierMonth) {
    await dialog.getByRole('button', { name: 'Vorheriger Monat' }).click();
  }
  await dialog
    .getByRole('button', { name: yesterday?.name, exact: true })
    .click();
  await expect(page.getByText('Gestern', { exact: true })).toBeVisible();
  await expect(place(page, anna)).toHaveCount(0);

  const again = daysRead();
  await page
    .getByRole('group', { name: 'Zeitraum' })
    .getByRole('button', { name: 'Gesamt' })
    .click();
  // Other tests write to the same stack in parallel, so the revision may have moved
  // on: the read is conditional on the first answer, whatever the server says.
  expect(await (await again).request().headerValue('if-none-match')).toBe(
    firstEtag,
  );
  expect([200, 304]).toContain((await again).status());
  await expect(
    page.getByText(/^Alle Tage seit \d{2}\.\d{2}\.\d{4} · \d+ Abende?$/),
  ).toBeVisible();
});

test('with nobody today the Rangliste says so and offers Zählen', async ({
  page,
}) => {
  await page.route('**/api/scoreboard*', (route) =>
    route.fulfill({
      json: { rows: [], unranked: [] },
      headers: { ETag: '"0-0"' },
    }),
  );

  await page.goto('/rangliste');

  await expect(page.getByText('Heute noch keine Getränke.')).toBeVisible();
  await page.getByRole('main').getByRole('link', { name: 'Zählen' }).click();
  await expect(page).toHaveURL(/\/zaehlen$/);
});
