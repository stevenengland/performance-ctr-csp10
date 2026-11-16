import { randomUUID } from 'node:crypto';
import {
  expect,
  test,
  type APIRequestContext,
  type Page,
} from './support/playwright.ts';
import { ADMIN, signIn, uniqueName, verifierOn } from './support/session.ts';

/*
Persons, drinks and factors are shared by everyone on the stack, and both window
projects run this file at once: every test works with items of its own names and
deletes them at the end.
*/

type Collection = '/api/persons' | '/api/drinks' | '/api/factors';

const created: { path: Collection; id: number }[] = [];

async function create(
  request: APIRequestContext,
  path: Collection,
  data: Record<string, unknown>,
): Promise<{ id: number; name: string }> {
  const response = await request.post(path, { data });
  expect(response.status()).toBe(201);
  const item = (await response.json()) as { id: number; name: string };
  created.push({ path, id: item.id });
  return item;
}

interface NewEntry {
  personId: number;
  drinkId: number;
  quantity: number;
  factorId?: number;
}

async function add(
  request: APIRequestContext,
  entry: NewEntry,
  id = randomUUID(),
) {
  const response = await request.put(`/api/entries/${id}`, { data: entry });
  expect(response.status()).toBe(201);
  return id;
}

/** The Verlauf's rows: `2× Bier` over `Happy Hour ×2 · 23:41 · anna`. */
function entries(page: Page, person: string) {
  return page
    .getByRole('list', { name: `Einträge von ${person}` })
    .getByRole('listitem');
}

/** HH:mm of an instant in the page's time zone, as the app shows it. */
async function localTime(page: Page, instant: string): Promise<string> {
  return page.evaluate(
    (iso) =>
      new Date(iso).toLocaleTimeString('de-DE', {
        hour: '2-digit',
        minute: '2-digit',
      }),
    instant,
  );
}

test.beforeEach(async ({ page }) => {
  await signIn(page);
});

test.afterEach(async ({ page }) => {
  for (const { path, id } of created.splice(0).reverse()) {
    await page.request.delete(`${path}/${String(id)}`);
  }
});

test('the Rangliste opens a person’s Verlauf: today’s entries newest first with drink, factor, local time, account and the offen marker', async ({
  page,
  request,
}) => {
  const verify = await verifierOn(request);
  const person = await create(page.request, '/api/persons', {
    name: uniqueName('Daniel'),
  });
  const bier = await create(page.request, '/api/drinks', {
    name: uniqueName('Bier'),
    points: 1,
  });
  const margarita = await create(page.request, '/api/drinks', {
    name: uniqueName('Margarita'),
    points: 3,
  });
  const factor = await create(page.request, '/api/factors', {
    name: uniqueName('Happy Hour'),
    multiplier: 2,
  });
  await verify(
    await add(page.request, {
      personId: person.id,
      drinkId: margarita.id,
      quantity: 1,
    }),
  );
  await add(page.request, {
    personId: person.id,
    drinkId: bier.id,
    quantity: 2,
    factorId: factor.id,
  });
  const history = await page.request.get(
    `/api/entries?personId=${String(person.id)}&from=${encodeURIComponent(
      new Date(Date.now() - 60 * 60 * 1000).toISOString(),
    )}`,
  );
  const [newest, oldest] = (
    (await history.json()) as { entries: { createdAt: string }[] }
  ).entries;

  // The Margarita is verified, so the person has a place; the beers still wait.
  await page.goto('/rangliste');
  await page
    .getByRole('link', { name: new RegExp(`^Platz \\d+, ${person.name},`) })
    .click();

  await expect(page).toHaveURL(new RegExp(`/verlauf/${String(person.id)}$`));
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(person.name);
  await expect(page.getByText('Heute', { exact: true })).toBeVisible();
  await expect(entries(page, person.name)).toHaveText([
    `2× ${bier.name}${factor.name} ×2 · ${await localTime(page, newest?.createdAt ?? '')} · ${ADMIN.userName}offen`,
    `1× ${margarita.name}Kein Faktor · ${await localTime(page, oldest?.createdAt ?? '')} · ${ADMIN.userName}`,
  ]);
});

test('deleting an entry after the dialog removes it from Verlauf and the Rangliste, and a late replay does not bring it back', async ({
  page,
  request,
}) => {
  const verify = await verifierOn(request);
  const person = await create(page.request, '/api/persons', {
    name: uniqueName('Daniel'),
  });
  const bier = await create(page.request, '/api/drinks', {
    name: uniqueName('Bier'),
    points: 1.5,
  });
  const twoBeers = { personId: person.id, drinkId: bier.id, quantity: 2 };
  await verify(await add(page.request, { ...twoBeers, quantity: 1 }));
  const replayed = await add(page.request, twoBeers);
  await verify(replayed);
  await page.goto(`/verlauf/${String(person.id)}`);
  await expect(entries(page, person.name)).toHaveCount(2);

  await page
    .getByRole('button', {
      name: new RegExp(`^2× ${bier.name} um .* löschen$`),
    })
    .click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByRole('heading')).toHaveText('Eintrag löschen?');
  await expect(dialog).toContainText(
    new RegExp(`2× ${bier.name} um \\d\\d:\\d\\d`),
  );
  await dialog.getByRole('button', { name: 'Löschen' }).click();

  await expect(page.getByText('Eintrag gelöscht')).toBeVisible();
  await expect(entries(page, person.name)).toHaveCount(1);
  const replay = await page.request.put(`/api/entries/${replayed}`, {
    data: twoBeers,
  });
  expect(replay.status()).toBe(200);
  await page.reload();
  await expect(entries(page, person.name)).toHaveText([
    new RegExp(`^1× ${bier.name}`),
  ]);
  await page.goto('/rangliste');
  await expect(
    page.getByRole('link', {
      name: new RegExp(`^Platz \\d+, ${person.name},`),
    }),
  ).toHaveAccessibleName(
    new RegExp(`^Platz \\d+, ${person.name}, 1,5 Punkte, 1 Getränk$`),
  );
});

test('Verwalten → Personen opens a Verlauf, which says when there are no entries today', async ({
  page,
}) => {
  const person = await create(page.request, '/api/persons', {
    name: uniqueName('Jule'),
  });
  await page.goto('/verwalten/personen');

  await page.getByRole('link', { name: `Verlauf von ${person.name}` }).click();

  await expect(page).toHaveURL(new RegExp(`/verlauf/${String(person.id)}$`));
  await expect(page.getByText('Heute keine Einträge.')).toBeVisible();
});
