import { randomUUID } from 'node:crypto';
import {
  expect,
  test,
  type APIRequestContext,
  type Page,
} from './support/playwright.ts';
import { signIn, uniqueName, VERIFIER, verifierOn } from './support/session.ts';

/*
The four-eyes rule across all three kinds at once (PRD #61): the bootstrap
admin records a drink, a match and a result; each waits as `offen` and counts
nowhere. The verifier confirms the drink and rejects the match in `Offen`,
the result keeps waiting, and the Rangliste, the game screens and the
Protokoll show exactly that.
*/

/** The polling interval of the Rangliste and the game screens. */
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

/** Records a row under a new UUID; it waits for verification. */
async function recorded(
  request: APIRequestContext,
  rows: 'entries' | 'matches' | 'results',
  data: Record<string, unknown>,
): Promise<void> {
  const response = await request.put(`/api/${rows}/${randomUUID()}`, {
    data,
  });
  expect(response.status()).toBe(201);
}

/** A game's Verlauf rows. */
async function gameHistory(page: Page, gameId: number) {
  await page.goto(`/spiele/${String(gameId)}/verlauf`);
  return page.getByRole('list', { name: 'Verlauf' }).getByRole('listitem');
}

test('a drink, a match and a result wait as offen; another account confirms one and rejects one in Offen, and only the confirmed one counts', async ({
  page,
  browser,
}) => {
  await signIn(page);
  const anna = uniqueName('Anna');
  const ben = uniqueName('Ben');
  const drink = uniqueName('Bier');
  const duel = uniqueName('Schach');
  const points = uniqueName('Wizard');
  const annaId = await created(page.request, '/api/persons', { name: anna });
  const benId = await created(page.request, '/api/persons', { name: ben });
  const drinkId = await created(page.request, '/api/drinks', {
    name: drink,
    points: 2,
  });
  const duelId = await created(page.request, '/api/games', {
    name: duel,
    kind: 'duel',
  });
  const pointsId = await created(page.request, '/api/games', {
    name: points,
    kind: 'points',
  });
  await recorded(page.request, 'entries', {
    personId: annaId,
    drinkId,
    quantity: 1,
  });
  await recorded(page.request, 'matches', {
    gameId: duelId,
    firstPersonId: annaId,
    secondPersonId: benId,
    outcome: 'first',
  });
  await recorded(page.request, 'results', {
    gameId: pointsId,
    personId: benId,
    points: 7,
  });

  // Each waits: marked offen in its Verlauf, and its persons are listed without a rank.
  await page.goto('/rangliste');
  const drinker = page
    .getByRole('list', { name: 'Noch nicht gewertet' })
    .getByRole('link', { name: new RegExp(`^${anna},`) });
  await expect(drinker).toHaveAccessibleName(`${anna}, ${drink} 1, +1 offen`);
  await drinker.click();
  await expect(
    page
      .getByRole('list', { name: `Einträge von ${anna}` })
      .getByRole('listitem'),
  ).toHaveText([new RegExp(`^1× ${drink}.*offen$`)]);
  await expect(await gameHistory(page, duelId)).toHaveText([
    new RegExp(`^${anna} – ${ben}\\s*${anna} gewinnt · .*offen$`),
  ]);
  await page.goto(`/spiele/${String(duelId)}`);
  await expect(
    page
      .getByRole('list', { name: 'Noch nicht gewertet' })
      .getByRole('listitem'),
  ).toHaveCount(2);
  await expect(await gameHistory(page, pointsId)).toHaveText([
    new RegExp(`^${ben} · 7 Punkte\\s*.*offen$`),
  ]);
  await page.goto(`/spiele/${String(pointsId)}`);
  await expect(
    page
      .getByRole('list', { name: 'Noch nicht gewertet' })
      .getByRole('listitem', { name: `${ben}, +1 offen` }),
  ).toBeVisible();

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
    const entryRow = verifier
      .getByRole('listitem')
      .filter({ hasText: `1× ${drink} für ${anna}` });
    const match = `${anna} – ${ben} · ${anna} gewinnt`;
    const matchRow = verifier.getByRole('listitem').filter({ hasText: match });
    const resultRow = verifier
      .getByRole('listitem')
      .filter({ hasText: `${ben} · 7 Punkte` });
    await expect(entryRow).toBeVisible();
    await expect(matchRow).toContainText(`${duel} · `);
    await expect(resultRow).toContainText(`${points} · `);

    await entryRow
      .getByRole('button', { name: `1× ${drink} für ${anna} bestätigen` })
      .click();
    await matchRow.getByRole('button', { name: `${match} ablehnen` }).click();

    await expect(entryRow).toHaveCount(0);
    await expect(matchRow).toHaveCount(0);
    await expect(resultRow).toBeVisible();
  } finally {
    await other.close();
  }

  // The drink counts on the Rangliste within one refresh.
  await page.goto('/rangliste');
  await expect(
    page.getByRole('link', { name: new RegExp(`^Platz \\d+, ${anna},`) }),
  ).toHaveAccessibleName(
    new RegExp(`^Platz \\d+, ${anna}, 2 Punkte, 1 Getränk$`),
    { timeout: POLL_MS + 2_000 },
  );
  // The match is gone: nobody stands in the duel any more.
  await expect(await gameHistory(page, duelId)).toHaveCount(0);
  await page.goto(`/spiele/${String(duelId)}`);
  await expect(
    page.getByRole('listitem').filter({ hasText: anna }),
  ).toHaveCount(0);
  // The result still waits.
  await page.goto(`/spiele/${String(pointsId)}`);
  await expect(
    page
      .getByRole('list', { name: 'Noch nicht gewertet' })
      .getByRole('listitem', { name: `${ben}, +1 offen` }),
  ).toBeVisible();
  // Protokoll names the verifier for both decisions.
  await page.goto('/verwalten/protokoll');
  const events = page.locator('[data-test="audit-event"]');
  await expect(
    events
      .filter({ hasText: `1× ${drink} für ${anna}` })
      .filter({ hasText: 'bestätigt' }),
  ).toContainText(VERIFIER.userName);
  await expect(
    events
      .filter({ hasText: `${anna} – ${ben}` })
      .filter({ hasText: 'abgelehnt' }),
  ).toContainText(VERIFIER.userName);
});
