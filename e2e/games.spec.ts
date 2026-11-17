import { randomUUID } from 'node:crypto';
import { expect, test, type APIRequestContext } from './support/playwright.ts';
import {
  signIn,
  signInVia,
  uniqueName,
  verifierOn,
} from './support/session.ts';

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

/**
A duel between two new persons with one match the first won, recorded through
the API and verified by a second account, so it counts.
*/
async function duelWithAMatch(
  request: APIRequestContext,
  verifier: APIRequestContext,
) {
  const anna = uniqueName('Anna');
  const ben = uniqueName('Ben');
  const annaId = await created(request, '/api/persons', { name: anna });
  const benId = await created(request, '/api/persons', { name: ben });
  const game = uniqueName('Schach');
  const gameId = await created(request, '/api/games', {
    name: game,
    kind: 'duel',
  });
  const matchId = randomUUID();
  const response = await request.put(`/api/matches/${matchId}`, {
    data: {
      gameId,
      firstPersonId: annaId,
      secondPersonId: benId,
      outcome: 'first',
    },
  });
  expect(response.status()).toBe(201);
  const verify = await verifierOn(verifier);
  await verify(matchId, 'matches');
  return { anna, ben, benId, game, gameId };
}

test.beforeEach(async ({ page }) => {
  await signIn(page);
});

test('a match recorded in one browser waits on another browser’s game page and counts there once verified, each within one refresh interval', async ({
  page,
  browser,
  request,
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
    extraHTTPHeaders: test.info().project.use.extraHTTPHeaders,
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
      page.getByText(
        `${anna} – ${ben} · ${anna} gewinnt · wartet auf Bestätigung`,
      ),
    ).toBeVisible();

    // It waits: both players are listed without a rank until another account verifies it.
    const waiting = watcher.getByRole('list', { name: 'Noch nicht gewertet' });
    await expect(
      waiting.getByRole('listitem', { name: `${anna}, +1 offen` }),
    ).toBeVisible({ timeout: POLL_MS + 2_000 });
    await expect(
      waiting.getByRole('listitem', { name: `${ben}, +1 offen` }),
    ).toBeVisible();
    const history = await page.request.get(
      `/api/games/${String(gameId)}/matches`,
    );
    const [match] = ((await history.json()) as { items: { id: string }[] })
      .items;
    const verify = await verifierOn(request);
    await verify(match?.id ?? '', 'matches');

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

test('a result typed on the number pad is saved, waits on the game’s page and is ranked once verified', async ({
  page,
  request,
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

  await expect(
    page.getByText(`${daniel} · −20 Punkte · wartet auf Bestätigung`),
  ).toBeVisible();
  // It waits: the tile keeps the verified standing, the game lists Daniel without a rank.
  await expect(
    page.getByRole('button', { name: `${daniel}, noch nichts` }),
  ).toBeVisible();
  await page.goto(`/spiele/${String(gameId)}`);
  await expect(
    page
      .getByRole('list', { name: 'Noch nicht gewertet' })
      .getByRole('listitem', { name: `${daniel}, +1 offen` }),
  ).toBeVisible();
  const history = await page.request.get(
    `/api/games/${String(gameId)}/results`,
  );
  const [result] = ((await history.json()) as { items: { id: string }[] })
    .items;
  const verify = await verifierOn(request);
  await verify(result?.id ?? '', 'results');

  await page.reload();
  await expect(
    page.getByRole('listitem', {
      name: `Platz 1, ${daniel}, −20 Punkte, 1 Ergebnis`,
    }),
  ).toBeVisible();
});

test('a restart empties the game’s ranking and keeps nothing of the old run on its page', async ({
  page,
  request,
}) => {
  const { anna, game, gameId } = await duelWithAMatch(page.request, request);

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

test('after a restart Aktuell is empty while Gesamt and Tag still rank the earlier run’s match, read with scope=all and today’s window', async ({
  page,
  request,
}) => {
  const { anna, ben, gameId } = await duelWithAMatch(page.request, request);
  const restarted = await page.request.post(
    `/api/games/${String(gameId)}/restart`,
    { data: {} },
  );
  expect(restarted.status()).toBe(200);
  const standingsOf = (matches: (url: URL) => boolean) =>
    page.waitForRequest((request) => {
      const url = new URL(request.url());
      return (
        url.pathname === `/api/games/${String(gameId)}/standings` &&
        matches(url)
      );
    });
  const periods = page.getByRole('group', { name: 'Zeitraum' });
  const leader = page.getByRole('listitem', {
    name: `Platz 1, ${anna}, 1 Punkt, 1 Partie · 1 S · 0 R · 0 N`,
  });

  await page.goto(`/spiele/${String(gameId)}`);
  await expect(
    page.getByText('Seit dem Start noch keine Partien.'),
  ).toBeVisible();

  const allTime = standingsOf((url) => url.search === '?scope=all');
  await periods.getByRole('button', { name: 'Gesamt' }).click();
  await allTime;
  await expect(page.getByRole('banner')).toContainText('Duell · Gesamt');
  await expect(leader).toBeVisible();
  await expect(
    page.getByRole('listitem', { name: new RegExp(`^Platz 2, ${ben},`) }),
  ).toBeVisible();
  await expect(
    page.getByText(/^Alle Läufe seit \d{2}\.\d{2}\.\d{4} · 1 Spieltag$/),
  ).toBeVisible();

  const today = standingsOf((url) => url.searchParams.has('to'));
  await periods.getByRole('button', { name: 'Tag' }).click();
  const window = new URL((await today).url()).searchParams;
  expect(
    await page.evaluate(
      (from) => new Date(from).getHours() + new Date(from).getMinutes(),
      window.get('from') ?? '',
    ),
  ).toBe(0);
  await expect(page.getByRole('banner')).toContainText('Duell · Heute');
  await expect(leader).toBeVisible();

  await periods.getByRole('button', { name: 'Aktuell' }).click();
  await expect(
    page.getByText('Seit dem Start noch keine Partien.'),
  ).toBeVisible();
});

test('a match deleted from the game’s Verlauf leaves its ranking', async ({
  page,
  request,
}) => {
  const { anna, ben, gameId } = await duelWithAMatch(page.request, request);

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
  request,
}) => {
  const { anna, benId, gameId } = await duelWithAMatch(page.request, request);
  const deleted = await page.request.delete(`/api/persons/${String(benId)}`);
  expect(deleted.status()).toBe(204);

  await page.goto(`/spiele/${String(gameId)}/verlauf`);

  await expect(
    page.getByRole('list', { name: 'Verlauf' }).getByRole('listitem'),
  ).toHaveText([new RegExp(`^${anna} – gelöschte Person\\s*${anna} gewinnt`)]);
});
