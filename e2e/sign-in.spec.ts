import { expect, test, type Browser, type Page } from './support/playwright.ts';
import {
  ADMIN,
  createAccount,
  signIn,
  signInVia,
  uniqueName,
} from './support/session.ts';

/** Signs in on Anmelden and waits for the server's answer. */
async function fillSignIn(page: Page, userName: string, password: string) {
  await page.getByLabel('Benutzername').fill(userName);
  await page.getByLabel('Passwort', { exact: true }).fill(password);
  await Promise.all([
    page.waitForResponse(
      (response) =>
        response.url().endsWith('/api/session') &&
        response.request().method() === 'POST',
    ),
    page.getByRole('button', { name: 'Anmelden' }).click(),
  ]);
}

/** A second device: a fresh browser context with the window settings of the project. */
async function otherDevice(browser: Browser, baseURL: string | undefined) {
  // The tests' own API calls name the client version, as the config's contexts do.
  const context = await browser.newContext({
    baseURL,
    locale: 'de-DE',
    extraHTTPHeaders: test.info().project.use.extraHTTPHeaders,
  });
  return { context, page: await context.newPage() };
}

test('the bootstrap admin signs in on Anmelden, lands on the requested route and stays signed in', async ({
  page,
  context,
}) => {
  await page.goto('/verwalten');
  await expect(page).toHaveURL(/\/anmelden\?weiter=\/verwalten$/);
  await expect(
    page.getByRole('heading', { name: 'Performance' }),
  ).toBeVisible();
  await expect(page.getByRole('navigation')).toHaveCount(0);

  await fillSignIn(page, ADMIN.userName, ADMIN.password);

  await expect(page).toHaveURL(/\/verwalten$/);
  await expect(
    page.getByRole('heading', { name: 'Verwalten', level: 1 }),
  ).toBeVisible();
  const [cookie] = (await context.cookies()).filter(
    ({ name }) => name === 'session',
  );
  expect(cookie).toMatchObject({
    httpOnly: true,
    secure: true,
    sameSite: 'Strict',
    path: '/',
  });
  expect(cookie?.value).toMatch(/^[0-9a-f]{64}$/);

  await page.reload();
  await expect(page).toHaveURL(/\/verwalten$/);
  await expect(page.getByRole('link', { name: 'Konten' })).toBeVisible();
});

test('the sign-in response sets a HttpOnly, Secure, SameSite=Strict cookie', async ({
  request,
}) => {
  const response = await request.post('/api/session', { data: ADMIN });

  expect(response.status()).toBe(200);
  expect(response.headers()['set-cookie']).toMatch(
    /^session=[0-9a-f]{64}; Path=\/; Max-Age=15552000; HttpOnly; Secure; SameSite=Strict$/,
  );
});

test('an admin creates an account under Verwalten → Konten that signs in on another device', async ({
  page,
  browser,
  baseURL,
}) => {
  const friend = uniqueName('freund');
  await signIn(page);
  await page.goto('/verwalten');
  await page.getByRole('link', { name: 'Konten' }).click();
  await expect(page).toHaveURL(/\/verwalten\/konten$/);
  await expect(page.getByRole('heading', { name: 'Konten' })).toBeVisible();

  await page.getByRole('button', { name: 'Konto anlegen' }).click();
  const dialog = page.getByRole('dialog');
  // The dialog focuses its first field once it is open.
  await expect(dialog.getByLabel('Benutzername')).toBeFocused();
  await dialog.getByLabel('Benutzername').fill(friend);
  await dialog.getByLabel('Startpasswort').fill('kurz');
  await dialog.getByRole('button', { name: 'Speichern' }).click();
  await expect(dialog.getByText('Mindestens 10 Zeichen.')).toBeVisible();

  await dialog.getByLabel('Startpasswort').fill('freundes-startpasswort');
  await dialog.getByRole('button', { name: 'Speichern' }).click();
  await expect(dialog).toBeHidden();
  await expect(
    page.getByRole('listitem').filter({ hasText: friend }),
  ).toBeVisible();

  await page.getByRole('button', { name: 'Konto anlegen' }).click();
  await expect(dialog.getByLabel('Benutzername')).toBeFocused();
  await dialog.getByLabel('Benutzername').fill(friend.toUpperCase());
  await dialog.getByLabel('Startpasswort').fill('noch-ein-passwort');
  await dialog.getByRole('button', { name: 'Speichern' }).click();
  await expect(
    dialog.getByText('Benutzername ist bereits vergeben.'),
  ).toBeVisible();

  const device = await otherDevice(browser, baseURL);
  await device.page.goto('/konto');
  await fillSignIn(device.page, friend, 'freundes-startpasswort');
  await expect(device.page).toHaveURL(/\/konto$/);
  await expect(device.page.getByTestId('account-name')).toHaveText(friend);
  await device.context.close();
});

test('the API answers a duplicate user name with 409 and a short password with 422', async ({
  request,
}) => {
  const name = uniqueName('doppelt');
  await createAccount(request, name, 'ein-startpasswort');

  const duplicate = await request.post('/api/accounts', {
    data: { userName: name, password: 'ein-startpasswort' },
  });
  const short = await request.post('/api/accounts', {
    data: { userName: uniqueName('kurz'), password: 'kurz' },
  });

  expect(duplicate.status()).toBe(409);
  expect(duplicate.headers()['content-type']).toBe('application/problem+json');
  expect(short.status()).toBe(422);
  expect(await short.json()).toMatchObject({
    errors: { password: 'Mindestens 10 Zeichen.' },
  });
});

test('without a session the API answers 401 and the app sends every screen to Anmelden', async ({
  page,
  request,
}) => {
  for (const [method, path] of [
    ['GET', '/api/session'],
    ['DELETE', '/api/session'],
    ['PUT', '/api/session/password'],
    ['GET', '/api/accounts'],
    ['POST', '/api/accounts'],
  ] as const) {
    const response = await request.fetch(path, {
      method,
      data: method === 'GET' || method === 'DELETE' ? undefined : {},
    });
    expect(response.status(), `${method} ${path}`).toBe(401);
    expect(response.headers()['content-type']).toBe('application/problem+json');
  }
  expect((await request.get('/api/health')).status()).toBe(200);

  for (const route of [
    '/zaehlen',
    '/rangliste',
    '/verwalten/konten',
    '/konto',
  ]) {
    await page.goto(route);
    await expect(page, route).toHaveURL(/\/anmelden\?weiter=/);
  }
});

test('a non-admin gets 403 on account routes and sees no Konten entry', async ({
  page,
  request,
}) => {
  const member = {
    userName: uniqueName('mitglied'),
    password: 'mitglieds-passwort',
  };
  await createAccount(request, member.userName, member.password);
  await signInVia(page.request, member);

  expect((await page.request.get('/api/accounts')).status()).toBe(403);
  await page.goto('/verwalten');
  await expect(
    page.getByRole('heading', { name: 'Verwalten', level: 1 }),
  ).toBeVisible();
  await expect(page.getByRole('link', { name: /^Personen/ })).toBeVisible();
  await expect(page.getByText('Konten')).toHaveCount(0);
  await page.goto('/verwalten/konten');
  await expect(page).toHaveURL(/\/verwalten$/);
});

test('signing out revokes the session on the server', async ({
  page,
  request,
}) => {
  const member = {
    userName: uniqueName('abmelden'),
    password: 'abmelde-passwort',
  };
  await createAccount(request, member.userName, member.password);
  await signInVia(page.request, member);
  await page.goto('/konto');
  const token = (await page.context().cookies()).find(
    ({ name }) => name === 'session',
  )?.value;
  expect(token).toBeDefined();

  await page.getByRole('button', { name: 'Abmelden' }).click();

  await expect(page).toHaveURL(/\/anmelden$/);
  const replayed = await request.get('/api/session', {
    headers: { Cookie: `session=${token ?? ''}` },
  });
  expect(replayed.status()).toBe(401);
});

test('changing the own password at /konto shows a short one inline and signs out the other devices', async ({
  page,
  request,
  browser,
  baseURL,
}) => {
  const member = {
    userName: uniqueName('passwort'),
    password: 'altes-passwort',
  };
  await createAccount(request, member.userName, member.password);
  const laptop = await otherDevice(browser, baseURL);
  await signInVia(laptop.context.request, member);
  await signInVia(page.request, member);
  await page.goto('/konto');

  await page.getByRole('button', { name: 'Passwort ändern' }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByLabel('Aktuelles Passwort')).toBeFocused();
  await dialog.getByLabel('Aktuelles Passwort').fill(member.password);
  await dialog.getByLabel('Neues Passwort', { exact: true }).fill('zu-kurz');
  await dialog.getByLabel('Neues Passwort wiederholen').fill('zu-kurz');
  await dialog.getByRole('button', { name: 'Speichern' }).click();
  await expect(dialog.getByText('Mindestens 10 Zeichen.')).toBeVisible();

  await dialog
    .getByLabel('Neues Passwort', { exact: true })
    .fill('neues-passwort');
  await dialog.getByLabel('Neues Passwort wiederholen').fill('neues-passwort');
  await dialog.getByRole('button', { name: 'Speichern' }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByText('Passwort geändert')).toBeVisible();

  expect((await page.request.get('/api/session')).status()).toBe(200);
  expect((await laptop.context.request.get('/api/session')).status()).toBe(401);
  await laptop.page.goto('/konto');
  await expect(laptop.page).toHaveURL(/\/anmelden\?weiter=\/konto$/);
  await laptop.context.close();
});

test('after 5 failed sign-ins Anmelden says to wait; unknown names and wrong passwords get the same answer', async ({
  page,
  request,
}) => {
  const member = { userName: uniqueName('sperre'), password: 'sperr-passwort' };
  await createAccount(request, member.userName, member.password);
  const unknownName = await request.post('/api/session', {
    data: { userName: uniqueName('niemand'), password: member.password },
  });
  const wrongPassword = await request.post('/api/session', {
    data: { userName: member.userName, password: 'falsch-1' },
  });
  expect(wrongPassword.status()).toBe(401);
  expect(await wrongPassword.text()).toBe(await unknownName.text());
  expect(await unknownName.json()).toEqual({
    type: 'urn:performance:problem:invalid-credentials',
    title: 'Benutzername oder Passwort falsch.',
    status: 401,
  });

  await page.goto('/anmelden');
  for (let attempt = 2; attempt <= 5; attempt += 1) {
    await fillSignIn(page, member.userName, `falsch-${String(attempt)}`);
    await expect(page.getByTestId('sign-in-error')).toHaveText(
      'Benutzername oder Passwort falsch.',
    );
  }
  await fillSignIn(page, member.userName, member.password);

  await expect(page.getByTestId('sign-in-error')).toHaveText(
    'Zu viele Versuche. Bitte später erneut.',
  );
  expect((await request.post('/api/session', { data: member })).status()).toBe(
    429,
  );
});

test('request bodies that are not JSON are rejected with 415', async ({
  request,
}) => {
  const response = await request.post('/api/session', {
    form: { userName: ADMIN.userName, password: ADMIN.password },
  });

  expect(response.status()).toBe(415);
  expect(response.headers()['content-type']).toBe('application/problem+json');
});
