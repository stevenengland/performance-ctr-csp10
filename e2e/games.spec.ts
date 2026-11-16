import { randomUUID } from 'node:crypto';
import { expect, test, type APIRequestContext } from './support/playwright.ts';
import { signIn, signInVia, uniqueName } from './support/session.ts';

/** The game page's polling interval while it is visible. */
const POLL_MS = 10_000;

async function created(
  request: APIRequestContext,
  path: '/api/persons' | '/api/games',
  data: Record<string, unknown>,
): Promise<number> {
  const response = await request.post(path, { data });
  expect(response.status()).toBe(201);
  return ((await response.json()) as { id: number }).id;
}

/** A duel between two new persons with one match the first won, recorded through the API. */
async function duelWithAMatch(request: APIRequestContext) {
  const anna = uniqueName('Anna');
  const ben = uniqueName('Ben');
  const annaId = await created(request, '/api/persons', { name: anna });
  const benId = await created(request, '/api/persons', { name: ben });
  const game = uniqueName('Schach');
  const gameId = await created(request, '/api/games', {
    name: game,
    kind: 'duel',
  });
  const response = await request.put(`/api/matches/${randomUUID()}`, {
    data: {
      gameId,
      firstPersonId: annaId,
      secondPersonId: benId,
      outcome: 'first',
    },
  });
  expect(response.status()).toBe(201);
  return { anna, ben, benId, game, gameId };
}

test.beforeEach(async ({ page }) => {
  await signIn(page);
});

test('a match recorded in one browser appears on another browser’s game page within one refresh interval', async ({
  page,
  browser,
}) => {
  const anna = uniqueName('Anna');
  const ben = uniqueName('Ben');
  await created(page.request, '/api/persons', { name: anna });
  await created(page.request, '/api/persons', { name: ben });
  const gameId = await created(page.request, '/api/games', {
    name: uniqueName('Schach'),
    kind: 'duel',
  });
  const other = await browser.newContext({
    baseURL: test.info().project.use.baseURL,
    viewport: test.info().project.use.viewport,
    locale: 'de-DE',
  });
  try {
    const watcher = await other.newPage();
    await signInVia(watcher.request);
    await watcher.goto(`/spiele/${String(gameId)}`);
    await expect(
      watcher.getByText('Seit dem Start noch keine Partien.'),
    ).toBeVisible();

    await page.goto(`/spiele/${String(gameId)}`);
    await page.getByRole('button', { name: 'Partie eintragen' }).click();
    await page.getByRole('button', { name: new RegExp(`^${anna},`) }).click();
    await page.getByRole('button', { name: new RegExp(`^${ben},`) }).click();
    await page.getByRole('button', { name: `${anna} gewinnt` }).click();
    await expect(
      page.getByText(`${anna} – ${ben} · ${anna} gewinnt`),
    ).toBeVisible();

    await expect(
      watcher.getByRole('listitem', { name: new RegExp(`^Platz 1, ${anna},`) }),
    ).toBeVisible({ timeout: POLL_MS + 2_000 });
    await expect(
      watcher.getByRole('listitem', { name: new RegExp(`^Platz 2, ${ben},`) }),
    ).toBeVisible();
  } finally {
    await other.close();
  }
});

test('a result typed on the number pad is saved and ranked on the game’s page', async ({
  page,
}) => {
  const daniel = uniqueName('Daniel');
  await created(page.request, '/api/persons', { name: daniel });
  const gameId = await created(page.request, '/api/games', {
    name: uniqueName('Rommé'),
    kind: 'points',
  });

  await page.goto(`/spiele/${String(gameId)}`);
  await page.getByRole('button', { name: 'Ergebnis eintragen' }).click();
  await page.getByRole('button', { name: `${daniel}, noch nichts` }).click();
  await page.getByRole('button', { name: 'Ziffer 2' }).click();
  await page.getByRole('button', { name: 'Ziffer 0' }).click();
  await page.getByRole('button', { name: 'Vorzeichen wechseln' }).click();
  await page.getByRole('button', { name: 'Speichern' }).click();

  await expect(page.getByText(`${daniel} · −20 Punkte`)).toBeVisible();
  await expect(
    page.getByRole('button', { name: `${daniel}, −20 Punkte` }),
  ).toBeVisible();
  await page.goto(`/spiele/${String(gameId)}`);
  await expect(
    page.getByRole('listitem', {
      name: `Platz 1, ${daniel}, −20 Punkte, 1 Ergebnis`,
    }),
  ).toBeVisible();
});

test('a restart empties the game’s ranking and keeps nothing of the old run on its page', async ({
  page,
}) => {
  const { anna, game, gameId } = await duelWithAMatch(page.request);

  await page.goto(`/spiele/${String(gameId)}`);
  await expect(
    page.getByRole('listitem', { name: new RegExp(`^Platz 1, ${anna},`) }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Neu starten' }).click();
  const confirm = page.getByRole('dialog');
  await expect(confirm.getByRole('heading')).toHaveText(`${game} neu starten?`);
  await confirm.getByRole('button', { name: 'Neu starten' }).click();

  await expect(page.getByText(`${game} neu gestartet`)).toBeVisible();
  await expect(
    page.getByText('Seit dem Start noch keine Partien.'),
  ).toBeVisible();
  await expect(page.getByRole('banner')).toContainText(
    /Duell · seit heute, \d\d:\d\d/,
  );
});

test('a match deleted from the game’s Verlauf leaves its ranking', async ({
  page,
}) => {
  const { anna, ben, gameId } = await duelWithAMatch(page.request);

  await page.goto(`/spiele/${String(gameId)}/verlauf`);
  await page
    .getByRole('button', {
      name: new RegExp(`^${anna} – ${ben} vom \\d\\d\\.\\d\\d\\. löschen$`),
    })
    .click();
  const confirm = page.getByRole('dialog');
  await expect(confirm.getByRole('heading')).toHaveText('Partie löschen?');
  await confirm.getByRole('button', { name: 'Löschen' }).click();

  await expect(page.getByText('Partie gelöscht')).toBeVisible();
  await expect(
    page.getByText('Seit dem Start noch keine Partien.'),
  ).toBeVisible();
  await page.goto(`/spiele/${String(gameId)}`);
  await expect(
    page.getByText('Seit dem Start noch keine Partien.'),
  ).toBeVisible();
});

test('a deleted person’s match stays in the Verlauf as “gelöschte Person”', async ({
  page,
}) => {
  const { anna, benId, gameId } = await duelWithAMatch(page.request);
  const deleted = await page.request.delete(`/api/persons/${String(benId)}`);
  expect(deleted.status()).toBe(204);

  await page.goto(`/spiele/${String(gameId)}/verlauf`);

  await expect(
    page.getByRole('list', { name: 'Verlauf' }).getByRole('listitem'),
  ).toHaveText([new RegExp(`^${anna} – gelöschte Person\\s*${anna} gewinnt`)]);
});
