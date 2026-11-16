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
