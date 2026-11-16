import { randomUUID } from 'node:crypto';
import { expect, test, type Browser, type Page } from './support/playwright.ts';
import {
  createAccount,
  signIn,
  signInVia,
  uniqueName,
} from './support/session.ts';

/*
Account administration under Verwalten → Konten on the stack. Accounts are shared
by everyone on it and both window projects run this file at once, so every test
works with accounts of its own names and never touches the bootstrap admin.
*/

const created: string[] = [];

async function member(request: Parameters<typeof createAccount>[0]) {
  const account = {
    userName: uniqueName('konto'),
    password: 'mitglieds-passwort',
  };
  await createAccount(request, account.userName, account.password);
  return account;
}

/** A second device: a fresh browser context with the window settings of the project. */
async function otherDevice(browser: Browser, baseURL: string | undefined) {
  const context = await browser.newContext({ baseURL, locale: 'de-DE' });
  return { context, page: await context.newPage() };
}

function row(page: Page, userName: string) {
  return page.getByRole('listitem').filter({ hasText: userName });
}

/** Opens an account's menu on Konten and chooses an entry. */
async function choose(page: Page, userName: string, entry: string) {
  await page.getByRole('button', { name: `Aktionen für ${userName}` }).click();
  await page.getByRole('menuitem', { name: entry }).click();
}

test.beforeEach(async ({ page }) => {
  await signIn(page);
});

test.afterEach(async ({ page }) => {
  for (const path of created.splice(0).reverse()) {
    await page.request.delete(path);
  }
});

test('an admin resets a password under Konten, which signs that account out on every device', async ({
  page,
  request,
  browser,
  baseURL,
}) => {
  const account = await member(request);
  const phone = await otherDevice(browser, baseURL);
  await signInVia(phone.context.request, account);
  await page.goto('/verwalten/konten');

  await choose(page, account.userName, 'Passwort zurücksetzen');
  const dialog = page.getByRole('dialog');
  await expect(
    dialog.getByRole('heading', {
      name: `Passwort von ${account.userName} zurücksetzen`,
    }),
  ).toBeVisible();
  await expect(
    dialog.getByText(`${account.userName} wird auf allen Geräten abgemeldet.`),
  ).toBeVisible();
  await expect(dialog.getByLabel('Neues Passwort')).toBeFocused();
  await dialog.getByLabel('Neues Passwort').fill('zu-kurz');
  await dialog.getByRole('button', { name: 'Speichern' }).click();
  await expect(dialog.getByText('Mindestens 10 Zeichen.')).toBeVisible();
  await dialog.getByLabel('Neues Passwort').fill('zurueckgesetzt-1');
  await dialog.getByRole('button', { name: 'Speichern' }).click();

  await expect(dialog).toBeHidden();
  await expect(
    page.getByText(`Passwort von ${account.userName} zurückgesetzt`),
  ).toBeVisible();
  expect((await phone.context.request.get('/api/session')).status()).toBe(401);
  await phone.page.goto('/konto');
  await expect(phone.page).toHaveURL(/\/anmelden\?weiter=\/konto$/);
  const old = await phone.context.request.post('/api/session', {
    data: account,
  });
  expect(old.status()).toBe(401);
  await signInVia(phone.context.request, {
    userName: account.userName,
    password: 'zurueckgesetzt-1',
  });
  await phone.context.close();
});

test('an admin grants and revokes admin rights, and the change persists', async ({
  page,
  request,
  browser,
  baseURL,
}) => {
  const account = await member(request);
  const device = await otherDevice(browser, baseURL);
  await signInVia(device.context.request, account);
  await page.goto('/verwalten/konten');
  await expect(row(page, account.userName)).not.toContainText('Admin');

  await choose(page, account.userName, 'Zum Admin machen');

  await expect(
    page.getByText(`${account.userName} ist jetzt Admin`),
  ).toBeVisible();
  await page.reload();
  await expect(row(page, account.userName)).toContainText('Admin');
  expect((await device.context.request.get('/api/accounts')).status()).toBe(
    200,
  );

  await choose(page, account.userName, 'Adminrechte entziehen');

  await expect(
    page.getByText(`${account.userName} ist kein Admin mehr`),
  ).toBeVisible();
  await page.reload();
  await expect(row(page, account.userName)).not.toContainText('Admin');
  expect((await device.context.request.get('/api/accounts')).status()).toBe(
    403,
  );
  await device.context.close();
});

test('deleting an account after the dialog ends its sessions and keeps its entries as “gelöschtes Konto”', async ({
  page,
  request,
  browser,
  baseURL,
}) => {
  const account = await member(request);
  const device = await otherDevice(browser, baseURL);
  await signInVia(device.context.request, account);
  const person = (await (
    await page.request.post('/api/persons', {
      data: { name: uniqueName('Daniel') },
    })
  ).json()) as { id: number; name: string };
  created.push(`/api/persons/${String(person.id)}`);
  const drink = (await (
    await page.request.post('/api/drinks', {
      data: { name: uniqueName('Bier'), points: 1.5 },
    })
  ).json()) as { id: number; name: string };
  created.push(`/api/drinks/${String(drink.id)}`);
  const logged = await device.context.request.put(
    `/api/entries/${randomUUID()}`,
    { data: { personId: person.id, drinkId: drink.id, quantity: 2 } },
  );
  expect(logged.status()).toBe(201);
  const from = new Date(Date.now() - 60 * 60 * 1000).toISOString();
  const score = async () => {
    const board = (await (
      await page.request.get(`/api/scoreboard?from=${encodeURIComponent(from)}`)
    ).json()) as { rows: { personId: number; score: number }[] };
    return board.rows.find(({ personId }) => personId === person.id)?.score;
  };
  expect(await score()).toBe(3);
  await page.goto('/verwalten/konten');

  await choose(page, account.userName, 'Löschen');
  const dialog = page.getByRole('dialog');
  await expect(
    dialog.getByRole('heading', { name: `Konto ${account.userName} löschen?` }),
  ).toBeVisible();
  await expect(
    dialog.getByText(`Einträge von ${account.userName} bleiben erhalten.`),
  ).toBeVisible();
  await dialog.getByRole('button', { name: 'Löschen' }).click();

  await expect(dialog).toBeHidden();
  await expect(page.getByText(`${account.userName} gelöscht`)).toBeVisible();
  await expect(row(page, account.userName)).toHaveCount(0);
  expect((await device.context.request.get('/api/session')).status()).toBe(401);
  expect(await score()).toBe(3);
  await page.goto(`/verlauf/${String(person.id)}`);
  await expect(
    page
      .getByRole('list', { name: `Einträge von ${person.name}` })
      .getByRole('listitem'),
  ).toHaveText([
    new RegExp(
      `^2× ${drink.name}Kein Faktor · \\d\\d:\\d\\d · gelöschtes Konto$`,
    ),
  ]);
  await device.context.close();
});

test('the menu entries that would remove the last admin are disabled with “Letzter Admin”', async ({
  page,
}) => {
  // The stack's accounts are shared, so this test answers the list itself.
  await page.route('**/api/accounts', (route) =>
    route.fulfill({
      json: {
        accounts: [
          { id: 1, userName: 'e2e-admin', isAdmin: true },
          { id: 2, userName: 'ben', isAdmin: false },
        ],
      },
    }),
  );
  await page.goto('/verwalten/konten');

  await page.getByRole('button', { name: 'Aktionen für e2e-admin' }).click();

  const menu = page.getByRole('menu');
  await expect(
    menu.getByRole('menuitem', { name: 'Passwort zurücksetzen' }),
  ).toBeEnabled();
  for (const entry of ['Adminrechte entziehen', 'Löschen']) {
    const item = menu.getByRole('menuitem', { name: new RegExp(`^${entry}`) });
    await expect(item).toHaveAttribute('aria-disabled', 'true');
    await expect(item).toContainText('Letzter Admin');
  }
});

test('the API refuses non-admins with 403 and a short reset password with 422', async ({
  page,
  request,
}) => {
  const account = await member(request);
  const other = await member(request);
  const accounts = (await (await request.get('/api/accounts')).json()) as {
    accounts: { id: number; userName: string }[];
  };
  const id = accounts.accounts.find(
    ({ userName }) => userName === other.userName,
  )?.id;
  await signInVia(page.request, account);

  for (const response of [
    await page.request.patch(`/api/accounts/${String(id)}`, {
      data: { isAdmin: true },
    }),
    await page.request.delete(`/api/accounts/${String(id)}`),
  ]) {
    expect(response.status()).toBe(403);
    expect(response.headers()['content-type']).toBe('application/problem+json');
  }
  const short = await request.patch(`/api/accounts/${String(id)}`, {
    data: { password: 'kurz' },
  });
  expect(short.status()).toBe(422);
  expect(((await short.json()) as { errors: unknown }).errors).toEqual({
    password: 'Mindestens 10 Zeichen.',
  });
});
