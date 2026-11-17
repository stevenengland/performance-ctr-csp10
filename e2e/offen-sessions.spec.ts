import { randomUUID } from 'node:crypto';
import {
  expect,
  test,
  type APIRequestContext,
  type Page,
  type Request,
} from './support/playwright.ts';
import { createAccount, signInVia, uniqueName } from './support/session.ts';

/*
Every sign-out and sign-in is a session boundary for `Offen` and its badge
(PRD #61): what one account's session read never shows in the next one, also
when the server's answer for the previous session arrives late, and a sign-in
of the account that just signed out reads its queue anew.
*/

/** How long every answer of the queue is held back, so a late one could still land. */
const DELAY_MS = 500;

interface Member {
  userName: string;
  password: string;
}

/** Creates a person or drink and answers its id. */
async function created(
  request: APIRequestContext,
  path: '/api/persons' | '/api/drinks',
  data: Record<string, unknown>,
): Promise<number> {
  const response = await request.post(path, { data });
  expect(response.status()).toBe(201);
  return ((await response.json()) as { id: number }).id;
}

/** Records drinks as the member, one entry per quantity; each waits for another account. */
async function recordAs(
  request: APIRequestContext,
  member: Member,
  personId: number,
  drinkId: number,
  quantities: number[],
): Promise<void> {
  await signInVia(request, member);
  for (const quantity of quantities) {
    const response = await request.put(`/api/entries/${randomUUID()}`, {
      data: { personId, drinkId, quantity },
    });
    expect(response.status()).toBe(201);
  }
}

/** Signs in on Anmelden as a user would, and waits for the server's answer. */
async function signInOnAnmelden(page: Page, member: Member) {
  await expect(page).toHaveURL(/\/anmelden/);
  await page.getByLabel('Benutzername').fill(member.userName);
  await page.getByLabel('Passwort', { exact: true }).fill(member.password);
  await Promise.all([
    page.waitForResponse(
      (response) =>
        response.url().endsWith('/api/session') &&
        response.request().method() === 'POST',
    ),
    page.getByRole('button', { name: 'Anmelden' }).click(),
  ]);
}

/** Signs out on Konto, reached inside the app so its in-memory state stays. */
async function signOutOnKonto(page: Page) {
  await page.getByRole('link', { name: 'Konto' }).click();
  await page.getByRole('button', { name: 'Abmelden' }).click();
  await expect(page).toHaveURL(/\/anmelden$/);
}

/** Opens Offen through the navigation, inside the app. */
async function openOffen(page: Page) {
  await page.getByRole('link', { name: /^Offen(, \d+ offen)?$/ }).click();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Offen');
}

/** Offen's rows of a drink. */
function rowsOf(page: Page, drink: string) {
  return page.getByRole('listitem').filter({ hasText: `× ${drink} für` });
}

/** The badge shows the signed-in account's own count, as the API answers it for this session. */
async function expectOwnBadge(page: Page) {
  await expect(async () => {
    const answer = await page.request.get('/api/pending');
    const { count } = (await answer.json()) as { count: number };
    await expect(
      page.getByRole('link', { name: `Offen, ${String(count)} offen` }),
    ).toBeVisible({ timeout: 2_000 });
  }).toPass({ timeout: 20_000 });
}

test('after every sign-out and sign-in Offen and its badge show only the signed-in account’s queue, also when an answer of the previous session arrives late', async ({
  page,
  request,
}) => {
  const anna = { userName: uniqueName('anna'), password: 'anna-passwort' };
  const ben = { userName: uniqueName('ben'), password: 'ben-passwort' };
  await createAccount(request, anna.userName, anna.password);
  await createAccount(request, ben.userName, ben.password);
  const person = uniqueName('Daniel');
  const annasDrink = uniqueName('Bier');
  const bensDrink = uniqueName('Wein');
  const personId = await created(request, '/api/persons', { name: person });
  const annasDrinkId = await created(request, '/api/drinks', {
    name: annasDrink,
    points: 1,
  });
  const bensDrinkId = await created(request, '/api/drinks', {
    name: bensDrink,
    points: 1,
  });
  // Anna waits for two rows to be verified, Ben for one: each is in the other's queue only.
  await recordAs(request, anna, personId, annasDrinkId, [1, 2]);
  await recordAs(request, ben, personId, bensDrinkId, [3]);

  /** Every queue answer comes late; one, if asked for, is held until released. */
  let holdNext = false;
  let release: () => void = () => undefined;
  let heldAnswered: Promise<void> = Promise.resolve();
  const reads: Request[] = [];
  page.on('request', (sent) => {
    if (new URL(sent.url()).pathname === '/api/pending') reads.push(sent);
  });
  await page.route('**/api/pending*', async (route) => {
    const response = await route.fetch();
    if (holdNext) {
      holdNext = false;
      const released = new Promise<void>((resolve) => {
        release = resolve;
      });
      heldAnswered = released.then(() => route.fulfill({ response }));
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, DELAY_MS));
    await route.fulfill({ response });
  });

  // Anna sees Ben's row, not her own.
  await page.goto('/offen');
  await signInOnAnmelden(page, anna);
  await expect(rowsOf(page, bensDrink)).toHaveCount(1);
  await expect(rowsOf(page, annasDrink)).toHaveCount(0);
  await expectOwnBadge(page);

  // A refresh of Anna's queue is still on its way when she signs out.
  holdNext = true;
  const heldRead = page.waitForRequest(
    (sent) => new URL(sent.url()).pathname === '/api/pending',
  );
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await heldRead;
  await signOutOnKonto(page);

  // Ben sees Anna's rows only, also once Anna's late answer has arrived.
  await signInOnAnmelden(page, ben);
  await openOffen(page);
  await expect(rowsOf(page, annasDrink)).toHaveCount(2);
  await expect(rowsOf(page, bensDrink)).toHaveCount(0);
  release();
  await heldAnswered;
  await page.waitForTimeout(DELAY_MS);
  await expect(rowsOf(page, bensDrink)).toHaveCount(0);
  await expect(rowsOf(page, annasDrink)).toHaveCount(2);
  await expectOwnBadge(page);

  // Anna again: her own queue, nothing of Ben's session.
  await signOutOnKonto(page);
  await signInOnAnmelden(page, anna);
  await openOffen(page);
  await expect(rowsOf(page, bensDrink)).toHaveCount(1);
  await expect(rowsOf(page, annasDrink)).toHaveCount(0);
  await expectOwnBadge(page);

  // Anna signs out and in again: her queue is read anew, not on condition of the old ETag.
  await signOutOnKonto(page);
  const before = reads.length;
  await signInOnAnmelden(page, anna);
  await openOffen(page);
  await expect(rowsOf(page, bensDrink)).toHaveCount(1);
  const firstRead = reads[before];
  expect(firstRead).toBeDefined();
  expect(await firstRead?.headerValue('if-none-match')).toBeNull();
  await expectOwnBadge(page);
});
