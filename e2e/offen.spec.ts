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
records a drink, which waits; the verifier confirms it in `Offen`; it counts.
*/

/** The Rangliste's polling interval. */
const POLL_MS = 10_000;

async function created(
  request: APIRequestContext,
  path: '/api/persons' | '/api/drinks',
  data: Record<string, unknown>,
): Promise<void> {
  const response = await request.post(path, { data });
  expect(response.status()).toBe(201);
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
