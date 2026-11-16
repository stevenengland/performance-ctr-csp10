import {
  expect,
  test,
  type APIRequestContext,
  type Page,
} from './support/playwright.ts';
import { withoutFactors } from './support/factors.ts';
import { signIn, uniqueName, verifierOn } from './support/session.ts';

/** A person and a drink with names no earlier run used (the stack's database outlives a run). */
async function personAndDrink(request: APIRequestContext, points = 1) {
  const person = uniqueName('Daniel');
  const drink = uniqueName('Bier');
  const created = await Promise.all([
    request.post('/api/persons', { data: { name: person } }),
    request.post('/api/drinks', { data: { name: drink, points } }),
  ]);
  for (const response of created) expect(response.status()).toBe(201);
  return { person, drink };
}

/** The tile whose accessible name starts with the given name. */
function tile(page: Page, name: string) {
  return page.getByRole('button', { name: new RegExp(`^${name},`) });
}

/** Opens the quantity step for a person and drink from the name list. */
async function openQuantity(page: Page, person: string, drink: string) {
  await page.goto('/zaehlen');
  await tile(page, person).click();
  await tile(page, drink).click();
  await expect(page.getByRole('heading', { name: 'Wie viele?' })).toBeVisible();
}

test.beforeEach(async ({ page }) => {
  await signIn(page);
  await withoutFactors(page);
});

test('persons and drinks are created under Verwalten with inline errors and a decimal comma', async ({
  page,
}) => {
  const person = uniqueName('Daniel');
  const drink = uniqueName('Bier');

  await page.goto('/verwalten');
  await page.getByRole('link', { name: 'Personen' }).click();
  await expect(page).toHaveURL(/\/verwalten\/personen$/);
  await page.getByRole('button', { name: 'Person anlegen' }).click();
  const personDialog = page.getByRole('dialog');
  await personDialog.getByLabel('Name').fill(`  ${person}  `);
  await personDialog.getByRole('button', { name: 'Speichern' }).click();
  await expect(personDialog).toBeHidden();
  await expect(page.getByRole('list', { name: 'Personen' })).toContainText(
    person,
  );

  await page.getByRole('button', { name: 'Person anlegen' }).click();
  await personDialog.getByLabel('Name').fill(person.toUpperCase());
  await personDialog.getByRole('button', { name: 'Speichern' }).click();
  await expect(personDialog).toContainText('Name ist bereits vergeben.');
  await personDialog.getByRole('button', { name: 'Abbrechen' }).click();

  await page.goto('/verwalten/getraenke');
  await page.getByRole('button', { name: 'Getränk anlegen' }).click();
  const drinkDialog = page.getByRole('dialog');
  await drinkDialog.getByLabel('Name').fill(drink);
  await drinkDialog.getByLabel('Punkte').fill('10000');
  await drinkDialog.getByRole('button', { name: 'Speichern' }).click();
  await expect(drinkDialog).toContainText('Zahl von 0 bis 9.999,99.');
  await drinkDialog.getByLabel('Punkte').fill('zwei');
  await drinkDialog.getByRole('button', { name: 'Speichern' }).click();
  await expect(drinkDialog).toContainText('Zahl von 0 bis 9.999,99.');
  await drinkDialog.getByLabel('Punkte').fill('0,5');
  await drinkDialog.getByRole('button', { name: 'Speichern' }).click();
  await expect(drinkDialog).toBeHidden();
  await expect(
    page
      .getByRole('list', { name: 'Getränke' })
      .getByRole('listitem')
      .filter({ hasText: drink }),
  ).toContainText('0,5 Punkte');
});

test('without factors Daniel → Bier → + twice → Speichern saves 2 beers and returns to the name list; they score once verified', async ({
  page,
  request,
}) => {
  const { person, drink } = await personAndDrink(page.request);
  await openQuantity(page, person, drink);
  await expect(page.getByText('bisher 0, neu dazu 0')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Speichern' })).toBeDisabled();

  await page.getByRole('button', { name: 'Eins mehr' }).click();
  await page.getByRole('button', { name: 'Eins mehr' }).click();
  await expect(page.getByText('bisher 0, neu dazu 2')).toBeVisible();
  const saved = page.waitForResponse(
    (response) =>
      response.url().includes('/api/entries/') &&
      response.request().method() === 'PUT',
  );
  await page.getByRole('button', { name: 'Speichern' }).click();

  expect((await saved).status()).toBe(201);
  await expect(page).toHaveURL(/\/zaehlen$/);
  await expect(
    page.getByText(`2× ${drink} · ${person} · wartet auf Bestätigung`),
  ).toBeVisible();
  await expect(page.getByRole('button', { name: 'Rückgängig' })).toBeVisible();
  // It waits for verification: no points yet, but the drink's counter shows it.
  await expect(tile(page, person)).toHaveAccessibleName(
    `${person}, noch nichts`,
  );
  const verify = await verifierOn(request);
  await verify(new URL((await saved).url()).pathname.split('/').pop() ?? '');
  await page.reload();
  await expect(tile(page, person)).toHaveAccessibleName(
    `${person}, 2 Punkte heute`,
  );
  await tile(page, person).click();
  await expect(tile(page, drink)).toHaveAccessibleName(
    `${drink}, 1 Punkt, heute 2`,
  );
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(person);
});

test('Rückgängig deletes the entry and the counter returns to its previous value', async ({
  page,
}) => {
  const { person, drink } = await personAndDrink(page.request);
  await openQuantity(page, person, drink);
  await page.getByRole('button', { name: 'Eins mehr' }).click();
  await page.getByRole('button', { name: 'Speichern' }).click();
  await expect(page.getByText(`1× ${drink} · ${person}`)).toBeVisible();

  const undone = page.waitForResponse(
    (response) => response.request().method() === 'DELETE',
  );
  await page.getByRole('button', { name: 'Rückgängig' }).click();

  expect((await undone).status()).toBe(204);
  await expect(page.getByText('Rückgängig gemacht')).toBeVisible();
  await expect(tile(page, person)).toHaveAccessibleName(
    `${person}, noch nichts`,
  );
  await tile(page, person).click();
  await expect(tile(page, drink)).toHaveAccessibleName(
    `${drink}, 1 Punkt, heute 0`,
  );
});

test('after a lost response Erneut versuchen retries with the same id and books once', async ({
  page,
}) => {
  const { person, drink } = await personAndDrink(page.request);
  const puts: string[] = [];
  await page.route('**/api/entries/*', async (route) => {
    puts.push(route.request().url());
    if (puts.length === 1) {
      // The server saves the entry, but its answer never arrives.
      await route.fetch();
      await route.abort('connectionreset');
      return;
    }
    await route.continue();
  });
  await openQuantity(page, person, drink);
  await page.getByRole('button', { name: 'Eins mehr' }).click();
  await page.getByRole('button', { name: 'Eins mehr' }).click();
  await page.getByRole('button', { name: 'Speichern' }).click();

  await expect(
    page.getByText('Nicht gespeichert – keine Verbindung'),
  ).toBeVisible();
  await expect(page).toHaveURL(/\/zaehlen\/\d+\/\d+$/);
  const retried = page.waitForResponse((response) =>
    response.url().includes('/api/entries/'),
  );
  await page.getByRole('button', { name: 'Erneut versuchen' }).click();

  expect((await retried).status()).toBe(200);
  expect(puts).toHaveLength(2);
  expect(puts[1]).toBe(puts[0]);
  await expect(page).toHaveURL(/\/zaehlen$/);
  await expect(page.getByText(`2× ${drink} · ${person}`)).toBeVisible();
  await tile(page, person).click();
  await expect(tile(page, drink)).toHaveAccessibleName(
    `${drink}, 1 Punkt, heute 2`,
  );
});

test('back navigation returns exactly one step', async ({ page }) => {
  const { person, drink } = await personAndDrink(page.request);
  await openQuantity(page, person, drink);

  await page.getByRole('button', { name: 'Zurück' }).click();
  await expect(
    page.getByRole('heading', { name: 'Welches Getränk?' }),
  ).toBeVisible();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(person);

  await page.goBack();
  await expect(page.getByRole('heading', { name: 'Für wen?' })).toBeVisible();
  await expect(page).toHaveURL(/\/zaehlen$/);
});

test('offline the banner shows and the flow offers no save action', async ({
  page,
  context,
}) => {
  const { person, drink } = await personAndDrink(page.request);
  await openQuantity(page, person, drink);
  await page.getByRole('button', { name: 'Eins mehr' }).click();
  await expect(page.getByRole('button', { name: 'Speichern' })).toBeEnabled();

  await context.setOffline(true);

  await expect(
    page.getByText(
      'Offline – Getränke können gerade nicht gespeichert werden.',
    ),
  ).toBeVisible();
  await expect(page.getByRole('button', { name: 'Speichern' })).toBeDisabled();
  await context.setOffline(false);
  await expect(page.getByRole('button', { name: 'Speichern' })).toBeEnabled();
});

test.describe('in Mexico City', () => {
  test.use({ timezoneId: 'America/Mexico_City' });

  test('the counters come from the scoreboard since local midnight, sent as UTC', async ({
    page,
  }) => {
    const { person } = await personAndDrink(page.request);
    const day = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'America/Mexico_City',
    }).format(new Date());
    const asked = page.waitForRequest((request) =>
      request.url().includes('/api/scoreboard'),
    );

    await page.goto('/zaehlen');

    const from = new URL((await asked).url()).searchParams.get('from');
    // Mexico City keeps UTC−6 all year.
    expect(from).toBe(`${day}T06:00:00.000Z`);
    await expect(tile(page, person)).toBeVisible();
  });
});

test('a person that no longer exists returns to the name list', async ({
  page,
}) => {
  await page.goto('/zaehlen/999999999');

  await expect(page).toHaveURL(/\/zaehlen$/);
  await expect(page.getByText('Nicht mehr vorhanden')).toBeVisible();
});
