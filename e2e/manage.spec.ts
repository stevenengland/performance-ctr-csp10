import { randomUUID } from 'node:crypto';
import {
  expect,
  test,
  type APIRequestContext,
  type Page,
} from './support/playwright.ts';
import { signIn, uniqueName } from './support/session.ts';

/*
Persons and drinks are shared by everyone on the stack, and both window projects
run this file at once: every test works with items of its own names and deletes
what is left of them at the end.
*/

type Collection = '/api/persons' | '/api/drinks';

interface Created {
  id: number;
  name: string;
}

const created: { path: Collection; id: number }[] = [];

async function create(
  request: APIRequestContext,
  path: Collection,
  data: Record<string, unknown>,
): Promise<Created> {
  const response = await request.post(path, { data });
  expect(response.status()).toBe(201);
  const item = (await response.json()) as Created;
  created.push({ path, id: item.id });
  return item;
}

async function addEntries(
  request: APIRequestContext,
  entry: { personId: number; drinkId: number; quantity: number },
  times: number,
) {
  for (let count = 0; count < times; count += 1) {
    const response = await request.put(`/api/entries/${randomUUID()}`, {
      data: entry,
    });
    expect(response.status()).toBe(201);
  }
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

/** The person tile on Zählen whose accessible name starts with the name. */
function personTile(page: Page, name: string) {
  return page.getByRole('button', { name: new RegExp(`^${name},`) });
}

/** The rows of a list whose text matches one of the names. */
function rowsOf(page: Page, list: string, ...names: string[]) {
  return page
    .getByRole('list', { name: list })
    .getByRole('listitem')
    .filter({ hasText: new RegExp(names.join('|')) });
}

test.beforeEach(async ({ page }) => {
  await signIn(page);
});

test.afterEach(async ({ page }) => {
  for (const { path, id } of created) {
    await page.request.delete(`${path}/${String(id)}`);
  }
  created.length = 0;
});

test('a person is renamed under Verwalten → Personen and the list stays alphabetical', async ({
  page,
}) => {
  const first = await create(page.request, '/api/persons', {
    name: uniqueName('zz-b'),
  });
  const second = await create(page.request, '/api/persons', {
    name: uniqueName('zz-c'),
  });
  const renamed = uniqueName('zz-a');

  await page.goto('/verwalten');
  await page.getByRole('link', { name: /^Personen/ }).click();
  await expect(page).toHaveURL(/\/verwalten\/personen$/);
  await page.getByRole('button', { name: `${second.name} bearbeiten` }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toContainText('Person bearbeiten');
  await expect(dialog.getByLabel('Name')).toHaveValue(second.name);
  await dialog.getByLabel('Name').fill(` ${renamed} `);
  await dialog.getByRole('button', { name: 'Speichern' }).click();
  await expect(dialog).toBeHidden();

  await expect(rowsOf(page, 'Personen', first.name, renamed)).toHaveText([
    renamed,
    first.name,
  ]);
  await page.reload();
  await expect(rowsOf(page, 'Personen', first.name, renamed)).toHaveText([
    renamed,
    first.name,
  ]);
});

test('deleting a person after a dialog that names the entries removes them from the scoreboard', async ({
  page,
}) => {
  const { person, drink } = await evening(page.request);
  await addEntries(
    page.request,
    { personId: person.id, drinkId: drink.id, quantity: 1 },
    3,
  );
  // The entries wait for verification: the person is listed without a rank.
  await page.goto('/rangliste');
  await expect(
    page.getByRole('link', { name: new RegExp(`^${person.name}, `) }),
  ).toHaveAccessibleName(`${person.name}, ${drink.name} 3, +3 offen`);

  await page.goto('/verwalten/personen');
  await page.getByRole('button', { name: `${person.name} löschen` }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toContainText(`${person.name} löschen?`);
  await expect(dialog).toContainText(
    `${person.name} und 3 Einträge werden gelöscht.`,
  );
  await dialog.getByRole('button', { name: 'Löschen' }).click();

  await expect(page.getByText(`${person.name} gelöscht`)).toBeVisible();
  await expect(rowsOf(page, 'Personen', person.name)).toHaveCount(0);
  await page.goto('/rangliste');
  await expect(page.getByText(person.name, { exact: true })).toHaveCount(0);
  await page.goto('/zaehlen');
  await expect(personTile(page, person.name)).toHaveCount(0);
  const entries = await page.request.get(`/api/persons/${String(person.id)}`);
  expect(entries.status()).toBe(404);
});

test('editing a drink’s name and points shows on the counter of its entries', async ({
  page,
}) => {
  const { person, drink } = await evening(page.request);
  await addEntries(
    page.request,
    { personId: person.id, drinkId: drink.id, quantity: 2 },
    1,
  );
  const renamed = uniqueName('Helles');

  await page.goto('/verwalten/getraenke');
  await page.getByRole('button', { name: `${drink.name} bearbeiten` }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toContainText('Getränk bearbeiten');
  await expect(dialog.getByLabel('Punkte')).toHaveValue('1,5');
  await dialog.getByLabel('Name').fill(renamed);
  await dialog.getByLabel('Punkte').fill('2,25');
  await dialog.getByRole('button', { name: 'Speichern' }).click();
  await expect(dialog).toBeHidden();
  await expect(rowsOf(page, 'Getränke', renamed)).toHaveText(
    new RegExp(`${renamed}\\s*2,25 Punkte`),
  );

  await page.goto('/zaehlen');
  // The entry waits for verification, so it scores nothing yet.
  await expect(personTile(page, person.name)).toHaveAccessibleName(
    `${person.name}, noch nichts`,
  );
  await personTile(page, person.name).click();
  await expect(
    page.getByRole('button', { name: new RegExp(`^${renamed},`) }),
  ).toHaveAccessibleName(`${renamed}, 2,25 Punkte, heute 2`);
});

test('deleting a drink after a dialog that names the entries removes its counters and score', async ({
  page,
}) => {
  const { person, drink } = await evening(page.request);
  await addEntries(
    page.request,
    { personId: person.id, drinkId: drink.id, quantity: 1 },
    12,
  );

  await page.goto('/verwalten/getraenke');
  await page.getByRole('button', { name: `${drink.name} löschen` }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toContainText(`${drink.name} löschen?`);
  await expect(dialog).toContainText(
    `${drink.name} und 12 Einträge werden gelöscht.`,
  );
  await dialog.getByRole('button', { name: 'Löschen' }).click();

  await expect(page.getByText(`${drink.name} gelöscht`)).toBeVisible();
  await expect(rowsOf(page, 'Getränke', drink.name)).toHaveCount(0);
  await page.goto('/zaehlen');
  await expect(personTile(page, person.name)).toHaveAccessibleName(
    `${person.name}, noch nichts`,
  );
});

test('renames and edits are validated like creating, with errors inline', async ({
  page,
}) => {
  const { person, drink } = await evening(page.request);
  const other = await create(page.request, '/api/persons', {
    name: uniqueName('Mara'),
  });
  const dialog = page.getByRole('dialog');

  await page.goto('/verwalten/personen');
  await page.getByRole('button', { name: `${person.name} bearbeiten` }).click();
  await dialog.getByLabel('Name').fill(other.name.toUpperCase());
  await dialog.getByRole('button', { name: 'Speichern' }).click();
  await expect(dialog).toContainText('Name ist bereits vergeben.');
  await dialog.getByLabel('Name').fill('x'.repeat(41));
  await dialog.getByRole('button', { name: 'Speichern' }).click();
  await expect(dialog).toContainText('1 bis 40 Zeichen.');
  await dialog.getByRole('button', { name: 'Abbrechen' }).click();

  await page.goto('/verwalten/getraenke');
  await page.getByRole('button', { name: `${drink.name} bearbeiten` }).click();
  for (const invalid of ['-1', '10000', '1,005', 'eins']) {
    await dialog.getByLabel('Punkte').fill(invalid);
    await dialog.getByRole('button', { name: 'Speichern' }).click();
    await expect(dialog).toContainText('Zahl von 0 bis 9.999,99.');
  }
  await dialog.getByLabel('Punkte').fill('9999,99');
  await dialog.getByRole('button', { name: 'Speichern' }).click();
  await expect(dialog).toBeHidden();
  await expect(rowsOf(page, 'Getränke', drink.name)).toContainText(
    '9.999,99 Punkte',
  );
});

test('the Verwalten hub lists each section with its count, Konten for admins', async ({
  page,
}) => {
  const answer = (body: unknown) => ({ json: body });
  await page.route('**/api/persons', (route) =>
    route.fulfill(
      answer({
        persons: [
          { id: 1, name: 'Anna', photoUrl: null },
          { id: 2, name: 'Ben', photoUrl: null },
        ],
      }),
    ),
  );
  await page.route('**/api/drinks', (route) =>
    route.fulfill(answer({ drinks: [{ id: 1, name: 'Bier', points: 1 }] })),
  );
  await page.route('**/api/factors', (route) =>
    route.fulfill(answer({ factors: [] })),
  );
  await page.route('**/api/accounts', (route) =>
    route.fulfill(
      answer({
        accounts: [
          { id: 1, userName: 'e2e-admin', isAdmin: true },
          { id: 2, userName: 'ben', isAdmin: false },
          { id: 3, userName: 'mara', isAdmin: false },
        ],
      }),
    ),
  );

  await page.goto('/verwalten');

  await expect(page.getByRole('link', { name: /^Personen/ })).toContainText(
    '2 Personen',
  );
  await expect(page.getByRole('link', { name: /^Getränke/ })).toContainText(
    '1 Getränk',
  );
  await expect(page.getByRole('link', { name: /^Faktoren/ })).toContainText(
    '0 Faktoren',
  );
  await expect(page.getByRole('link', { name: /^Konten/ })).toContainText(
    '3 Konten',
  );
});
