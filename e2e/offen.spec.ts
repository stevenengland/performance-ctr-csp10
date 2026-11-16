import { randomUUID } from 'node:crypto';
import { expect, test, type APIRequestContext } from './support/playwright.ts';
import { withoutFactors } from './support/factors.ts';
import {
  ADMIN,
  signIn,
  uniqueName,
  VERIFIER,
  verifierOn,
} from './support/session.ts';

/*
The four-eyes rule end to end with two accounts (PRD #61): the bootstrap admin
records a drink or a match, which waits; the verifier confirms it in `Offen`,
and it counts, or rejects it there, and it is gone.
*/

/** The Rangliste's polling interval. */
const POLL_MS = 10_000;

/** Creates a person, drink or game and answers its id. */
async function created(
  request: APIRequestContext,
  path: '/api/persons' | '/api/drinks' | '/api/games',
  data: Record<string, unknown>,
): Promise<number> {
  const response = await request.post(path, { data });
  expect(response.status()).toBe(201);
  return ((await response.json()) as { id: number }).id;
}

test('one account records a drink, it waits as offen, another confirms it in Offen, and it counts', async ({
  page,
  browser,
}) => {
  await signIn(page);
  await withoutFactors(page);
  const person = uniqueName('Daniel');
  const drink = uniqueName('Bier');
  await created(page.request, '/api/persons', { name: person });
  await created(page.request, '/api/drinks', { name: drink, points: 1.5 });

  await page.goto('/zaehlen');
  await page.getByRole('button', { name: new RegExp(`^${person},`) }).click();
  await page.getByRole('button', { name: new RegExp(`^${drink},`) }).click();
  await page.getByRole('button', { name: 'Eins mehr' }).click();
  await page.getByRole('button', { name: 'Speichern' }).click();
  await expect(
    page.getByText(`1× ${drink} · ${person} · wartet auf Bestätigung`),
  ).toBeVisible();

  // It waits: listed without a rank, marked offen in the Verlauf, not in the recorder's Offen.
  await page.goto('/rangliste');
  const waiting = page
    .getByRole('list', { name: 'Noch nicht gewertet' })
    .getByRole('link', { name: new RegExp(`^${person},`) });
  await expect(waiting).toHaveAccessibleName(`${person}, ${drink} 1, +1 offen`);
  await waiting.click();
  await expect(
    page
      .getByRole('list', { name: `Einträge von ${person}` })
      .getByRole('listitem'),
  ).toHaveText([new RegExp(`^1× ${drink}.* · ${ADMIN.userName}offen$`)]);
  await page.goto('/offen');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Offen');
  await expect(
    page.getByRole('button', { name: `1× ${drink} für ${person} bestätigen` }),
  ).toHaveCount(0);

  const other = await browser.newContext({
    baseURL: test.info().project.use.baseURL,
    viewport: test.info().project.use.viewport,
    locale: 'de-DE',
    extraHTTPHeaders: test.info().project.use.extraHTTPHeaders,
  });
  try {
    await verifierOn(other.request);
    const verifier = await other.newPage();
    await verifier.goto('/offen');
    await expect(
      verifier.getByRole('link', { name: /^Offen, \d+ offen$/ }),
    ).toBeVisible();
    const row = verifier
      .getByRole('listitem')
      .filter({ hasText: `1× ${drink} für ${person}` });
    await expect(row).toContainText(`Kein Faktor`);
    await expect(row).toContainText(ADMIN.userName);

    await row
      .getByRole('button', { name: `1× ${drink} für ${person} bestätigen` })
      .click();

    await expect(row).toHaveCount(0);
  } finally {
    await other.close();
  }

  // It counts on the recorder's Rangliste within one refresh, and Protokoll names the verifier.
  await page.goto('/rangliste');
  await expect(
    page.getByRole('link', { name: new RegExp(`^Platz \\d+, ${person},`) }),
  ).toHaveAccessibleName(
    new RegExp(`^Platz \\d+, ${person}, 1,5 Punkte, 1 Getränk$`),
    { timeout: POLL_MS + 2_000 },
  );
  await page.goto('/verwalten/protokoll');
  await expect(
    page
      .locator('[data-test="audit-event"]')
      .filter({ hasText: `1× ${drink} für ${person}` })
      .filter({ hasText: 'bestätigt' }),
  ).toContainText(VERIFIER.userName);
});

test('another account rejects a waiting drink in Offen: it is gone, and Protokoll says abgelehnt', async ({
  page,
  browser,
}) => {
  await signIn(page);
  const person = uniqueName('Jule');
  const drink = uniqueName('Aperol');
  const personId = await created(page.request, '/api/persons', {
    name: person,
  });
  const drinkId = await created(page.request, '/api/drinks', {
    name: drink,
    points: 1,
  });
  const recorded = await page.request.put(`/api/entries/${randomUUID()}`, {
    data: { personId, drinkId, quantity: 2 },
  });
  expect(recorded.status()).toBe(201);

  const other = await browser.newContext({
    baseURL: test.info().project.use.baseURL,
    viewport: test.info().project.use.viewport,
    locale: 'de-DE',
    extraHTTPHeaders: test.info().project.use.extraHTTPHeaders,
  });
  try {
    await verifierOn(other.request);
    const verifier = await other.newPage();
    await verifier.goto('/offen');
    const row = verifier
      .getByRole('listitem')
      .filter({ hasText: `2× ${drink} für ${person}` });

    await row
      .getByRole('button', { name: `2× ${drink} für ${person} ablehnen` })
      .click();

    await expect(row).toHaveCount(0);
  } finally {
    await other.close();
  }

  // Gone for the recorder too: nothing of the person waits, and Protokoll names the rejecting account.
  await page.goto('/rangliste');
  await expect(
    page.getByRole('link', { name: new RegExp(`^${person},`) }),
  ).toHaveCount(0, { timeout: POLL_MS + 2_000 });
  await page.goto('/verwalten/protokoll');
  await expect(
    page
      .locator('[data-test="audit-event"]')
      .filter({ hasText: `2× ${drink} für ${person}` })
      .filter({ hasText: 'abgelehnt' }),
  ).toContainText(VERIFIER.userName);
});

test('a match waits as offen for both players until another account confirms it in Offen, then counts on both sides', async ({
  page,
  browser,
}) => {
  await signIn(page);
  const anna = uniqueName('Anna');
  const ben = uniqueName('Ben');
  const annaId = await created(page.request, '/api/persons', { name: anna });
  const benId = await created(page.request, '/api/persons', { name: ben });
  const game = uniqueName('Schach');
  const gameId = await created(page.request, '/api/games', {
    name: game,
    kind: 'duel',
  });
  const recorded = await page.request.put(`/api/matches/${randomUUID()}`, {
    data: {
      gameId,
      firstPersonId: annaId,
      secondPersonId: benId,
      outcome: 'draw',
    },
  });
  expect(recorded.status()).toBe(201);

  // It waits: offen in the game's Verlauf, both players without a rank.
  await page.goto(`/spiele/${String(gameId)}/verlauf`);
  await expect(
    page.getByRole('list', { name: 'Verlauf' }).getByRole('listitem'),
  ).toHaveText([new RegExp(`^${anna} – ${ben}\\s*Remis · .*offen$`)]);
  await page.goto(`/spiele/${String(gameId)}`);
  await expect(
    page
      .getByRole('list', { name: 'Noch nicht gewertet' })
      .getByRole('listitem'),
  ).toHaveCount(2);

  const other = await browser.newContext({
    baseURL: test.info().project.use.baseURL,
    viewport: test.info().project.use.viewport,
    locale: 'de-DE',
    extraHTTPHeaders: test.info().project.use.extraHTTPHeaders,
  });
  try {
    await verifierOn(other.request);
    const verifier = await other.newPage();
    await verifier.goto('/offen');
    const row = verifier
      .getByRole('listitem')
      .filter({ hasText: `${anna} – ${ben} · Remis` });
    await expect(row).toContainText(`${game} · `);

    await row
      .getByRole('button', { name: `${anna} – ${ben} · Remis bestätigen` })
      .click();

    await expect(row).toHaveCount(0);
  } finally {
    await other.close();
  }

  // Both players count it within one refresh: half a point each.
  await expect(
    page.getByRole('listitem', { name: new RegExp(`^Platz 1, ${anna},`) }),
  ).toHaveAccessibleName(
    new RegExp(`^Platz 1, ${anna}, 0,5 Punkte, 1 Partie · 0 S · 1 R · 0 N$`),
    { timeout: POLL_MS + 2_000 },
  );
  await expect(
    page.getByRole('listitem', { name: new RegExp(`^Platz 2, ${ben},`) }),
  ).toBeVisible();
});
