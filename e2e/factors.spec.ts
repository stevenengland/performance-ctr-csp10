import { randomUUID } from 'node:crypto';
import {
  expect,
  test,
  type APIRequestContext,
  type Page,
} from './support/playwright.ts';
import { signIn, uniqueName, verifierOn } from './support/session.ts';

/*
Factors are shared by everyone on the stack, and both window projects run this file
at once: every test works with factors of its own names and deletes them at the end.
*/

interface Created {
  id: number;
  name: string;
}

async function create(
  request: APIRequestContext,
  path: '/api/persons' | '/api/drinks' | '/api/factors',
  data: Record<string, unknown>,
): Promise<Created> {
  const response = await request.post(path, { data });
  expect(response.status()).toBe(201);
  return (await response.json()) as Created;
}

/** Records an entry, which waits for verification, and returns its id. */
async function addEntry(
  request: APIRequestContext,
  entry: { personId: number; drinkId: number; quantity: number },
  factorId: number | null,
): Promise<string> {
  const id = randomUUID();
  const response = await request.put(`/api/entries/${id}`, {
    data: { ...entry, factorId },
  });
  expect(response.status()).toBe(201);
  return id;
}

/** The id of the entry a saved response names (`PUT /api/entries/<id>`). */
function idOf(saved: { url(): string }): string {
  return new URL(saved.url()).pathname.split('/').pop() ?? '';
}

/** The person's tile on the name list, read afresh. */
async function personTile(page: Page, person: string) {
  await page.goto('/zaehlen');
  return tile(page, person);
}

/** A person and a beer worth 1,5 points. */
async function evening(request: APIRequestContext) {
  const person = await create(request, '/api/persons', {
    name: uniqueName('Daniel'),
  });
  const drink = await create(request, '/api/drinks', {
    name: uniqueName('Bier'),
    points: 1.5,
  });
  return { person, drink };
}

/** The tile whose accessible name starts with the given name. */
function tile(page: Page, name: string) {
  return page.getByRole('button', { name: new RegExp(`^${name},`) });
}

/** From the name list through the stepper to the factor step. */
async function openFactorStep(
  page: Page,
  person: string,
  drink: string,
  quantity: number,
) {
  await page.goto('/zaehlen');
  await tile(page, person).click();
  await tile(page, drink).click();
  for (let added = 0; added < quantity; added += 1) {
    await page.getByRole('button', { name: 'Eins mehr' }).click();
  }
  await page.getByRole('button', { name: 'Weiter' }).click();
  await expect(page.getByRole('heading', { name: 'Faktor?' })).toBeVisible();
}

/**
A drink tile's accessible name on the person's drink step: its counter is what
was recorded today, entries that wait for verification included.
*/
async function drinkTile(
  page: Page,
  person: string,
  drink: string,
): Promise<string | null> {
  await page.goto('/zaehlen');
  await tile(page, person).click();
  const found = tile(page, drink);
  await expect(found).toBeVisible();
  return found.getAttribute('aria-label');
}

/** Deletes the factors a test created by name, whatever happened to it. */
const ownFactors: string[] = [];

test.beforeEach(async ({ page }) => {
  await signIn(page);
});

test.afterEach(async ({ page }) => {
  const response = await page.request.get('/api/factors');
  const { factors } = (await response.json()) as { factors: Created[] };
  for (const factor of factors.filter(({ name }) =>
    ownFactors.includes(name),
  )) {
    await page.request.delete(`/api/factors/${String(factor.id)}`);
  }
  ownFactors.length = 0;
});

function factorName(prefix: string): string {
  const name = uniqueName(prefix);
  ownFactors.push(name);
  return name;
}

test('Happy Hour ×2 from Verwalten → Faktoren doubles the counter and, once verified, the score of Daniel → Bier → 2', async ({
  page,
  request,
}) => {
  const verify = await verifierOn(request);
  const { person, drink } = await evening(page.request);
  const happyHour = factorName('Happy Hour');

  await page.goto('/verwalten');
  await page.getByRole('link', { name: 'Faktoren' }).click();
  await expect(page).toHaveURL(/\/verwalten\/faktoren$/);
  await page.getByRole('button', { name: 'Faktor anlegen' }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Name').fill(happyHour);
  await dialog.getByLabel('Multiplikator').fill('2');
  await dialog.getByRole('button', { name: 'Speichern' }).click();
  await expect(dialog).toBeHidden();

  await openFactorStep(page, person.name, drink.name, 2);
  await expect(page.getByRole('progressbar')).toHaveAttribute(
    'aria-valuemax',
    '4',
  );
  await expect(page.locator('.top-bar')).toContainText(`2× ${drink.name}`);
  const saved = page.waitForResponse(
    (response) =>
      response.url().includes('/api/entries/') &&
      response.request().method() === 'PUT',
  );
  await page.getByRole('button', { name: `${happyHour}, ×2` }).click();

  const response = await saved;
  expect(response.status()).toBe(201);
  await expect(page).toHaveURL(/\/zaehlen$/);
  await expect(
    page.getByText(
      `2× ${drink.name} · ${happyHour} ×2 · ${person.name} · wartet auf Bestätigung`,
    ),
  ).toBeVisible();
  // It waits for verification, so it scores nothing yet.
  await expect(tile(page, person.name)).toHaveAccessibleName(
    `${person.name}, noch nichts`,
  );
  // The finished flow left the history: back goes to where the flow began.
  await page.goBack();
  await expect(page).toHaveURL(/\/verwalten\/faktoren$/);
  await page.goto('/zaehlen');
  await tile(page, person.name).click();
  await expect(tile(page, drink.name)).toHaveAccessibleName(
    `${drink.name}, 1,5 Punkte, heute 4`,
  );
  await verify(idOf(response));
  await expect(await personTile(page, person.name)).toHaveAccessibleName(
    `${person.name}, 6 Punkte heute`,
  );
});

test('Kein Faktor counts once', async ({ page, request }) => {
  const verify = await verifierOn(request);
  const { person, drink } = await evening(page.request);
  await create(page.request, '/api/factors', {
    name: factorName('Happy Hour'),
    multiplier: 2,
  });

  await openFactorStep(page, person.name, drink.name, 2);
  await expect(
    page.getByRole('button').filter({ hasText: 'Kein Faktor' }),
  ).toHaveAccessibleName('Kein Faktor, zählt einfach');
  const saved = page.waitForResponse(
    (response) =>
      response.url().includes('/api/entries/') &&
      response.request().method() === 'PUT',
  );
  await page
    .getByRole('button', { name: 'Kein Faktor, zählt einfach' })
    .click();

  await expect(
    page.getByText(`2× ${drink.name} · ${person.name}`),
  ).toBeVisible();
  await expect(drinkTile(page, person.name, drink.name)).resolves.toBe(
    `${drink.name}, 1,5 Punkte, heute 2`,
  );
  await verify(idOf(await saved));
  await expect(await personTile(page, person.name)).toHaveAccessibleName(
    `${person.name}, 3 Punkte heute`,
  );
});

test('factors are listed alphabetically, edited and validated with inline errors', async ({
  page,
}) => {
  const later = factorName('zz-Rabatt');
  const earlier = factorName('zy-Geburtstag');
  await create(page.request, '/api/factors', { name: later, multiplier: 0.5 });
  await page.goto('/verwalten/faktoren');

  await page.getByRole('button', { name: 'Faktor anlegen' }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Name').fill(earlier);
  for (const invalid of ['0', '100', '1,005', 'zwei']) {
    await dialog.getByLabel('Multiplikator').fill(invalid);
    await dialog.getByRole('button', { name: 'Speichern' }).click();
    await expect(dialog).toContainText('Zahl über 0 bis 99,99.');
  }
  await dialog.getByLabel('Multiplikator').fill('1,5');
  await dialog.getByRole('button', { name: 'Speichern' }).click();
  await expect(dialog).toBeHidden();

  const rows = page
    .getByRole('list', { name: 'Faktoren' })
    .getByRole('listitem')
    .filter({ hasText: new RegExp(`${earlier}|${later}`) });
  await expect(rows).toHaveText([
    new RegExp(`${earlier}\\s*×1,5`),
    new RegExp(`${later}\\s*×0,5`),
  ]);

  await page.getByRole('button', { name: `${earlier} bearbeiten` }).click();
  await expect(dialog.getByLabel('Multiplikator')).toHaveValue('1,5');
  await dialog.getByLabel('Name').fill(later.toUpperCase());
  await dialog.getByRole('button', { name: 'Speichern' }).click();
  await expect(dialog).toContainText('Name ist bereits vergeben.');
  await dialog.getByLabel('Name').fill(earlier);
  await dialog.getByLabel('Multiplikator').fill('99,99');
  await dialog.getByRole('button', { name: 'Speichern' }).click();
  await expect(dialog).toBeHidden();
  await expect(rows.first()).toContainText('×99,99');
});

test('editing a multiplier changes today’s counter and score of the entries that use it', async ({
  page,
  request,
}) => {
  const verify = await verifierOn(request);
  const { person, drink } = await evening(page.request);
  const name = factorName('Happy Hour');
  const factor = await create(page.request, '/api/factors', {
    name,
    multiplier: 2,
  });
  const entry = { personId: person.id, drinkId: drink.id, quantity: 2 };
  await verify(await addEntry(page.request, entry, factor.id));
  await expect(drinkTile(page, person.name, drink.name)).resolves.toBe(
    `${drink.name}, 1,5 Punkte, heute 4`,
  );
  await expect(await personTile(page, person.name)).toHaveAccessibleName(
    `${person.name}, 6 Punkte heute`,
  );

  await page.goto('/verwalten/faktoren');
  await page.getByRole('button', { name: `${name} bearbeiten` }).click();
  await page.getByRole('dialog').getByLabel('Multiplikator').fill('3');
  await page
    .getByRole('dialog')
    .getByRole('button', { name: 'Speichern' })
    .click();
  await expect(page.getByRole('dialog')).toBeHidden();

  await expect(drinkTile(page, person.name, drink.name)).resolves.toBe(
    `${drink.name}, 1,5 Punkte, heute 6`,
  );
  await expect(await personTile(page, person.name)).toHaveAccessibleName(
    `${person.name}, 9 Punkte heute`,
  );
});

test('deleting a factor after its dialog keeps its entries, which then count ×1', async ({
  page,
  request,
}) => {
  const verify = await verifierOn(request);
  const { person, drink } = await evening(page.request);
  const name = factorName('Happy Hour');
  const factor = await create(page.request, '/api/factors', {
    name,
    multiplier: 2,
  });
  const entry = { personId: person.id, drinkId: drink.id, quantity: 1 };
  for (let count = 0; count < 5; count += 1) {
    await verify(await addEntry(page.request, entry, factor.id));
  }
  await page.goto('/verwalten/faktoren');

  await page.getByRole('button', { name: `${name} löschen` }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toContainText(`${name} löschen?`);
  await expect(dialog).toContainText('5 Einträge zählen danach ×1.');
  await dialog.getByRole('button', { name: 'Löschen' }).click();

  await expect(page.getByText(`${name} gelöscht`)).toBeVisible();
  await expect(
    page.getByRole('button', { name: `${name} löschen` }),
  ).toHaveCount(0);
  await expect(drinkTile(page, person.name, drink.name)).resolves.toBe(
    `${drink.name}, 1,5 Punkte, heute 5`,
  );
  await expect(await personTile(page, person.name)).toHaveAccessibleName(
    `${person.name}, 7,5 Punkte heute`,
  );
});

test('offline the factor tiles are disabled under the banner', async ({
  page,
  context,
}) => {
  const { person, drink } = await evening(page.request);
  const name = factorName('Happy Hour');
  await create(page.request, '/api/factors', { name, multiplier: 2 });
  await openFactorStep(page, person.name, drink.name, 1);

  await context.setOffline(true);

  await expect(
    page.getByText(
      'Offline – Getränke können gerade nicht gespeichert werden.',
    ),
  ).toBeVisible();
  await expect(
    page.getByRole('button', { name: 'Kein Faktor, zählt einfach' }),
  ).toBeDisabled();
  await expect(
    page.getByRole('button', { name: `${name}, ×2` }),
  ).toBeDisabled();
  await context.setOffline(false);
  await expect(page.getByRole('button', { name: `${name}, ×2` })).toBeEnabled();
});
