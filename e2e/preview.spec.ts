import { readFileSync } from 'node:fs';
import { expect, test, type Page } from './support/playwright.ts';

test('the fixture preview opens on the fixture backend without network access', async ({
  page,
}) => {
  const network: string[] = [];
  await page.route(/\/api\//, async (route) => {
    network.push(route.request().url());
    await route.abort();
  });

  await page.goto('/index.html');

  await expect(page).toHaveURL(/#\/zaehlen$/);
  await expect(page.getByRole('heading', { name: 'Zählen' })).toBeVisible();
  await page.getByRole('link', { name: 'Konto' }).click();
  await expect(page).toHaveURL(/#\/konto$/);
  await expect(page.getByTestId('server-version')).toHaveText(
    /^Server: .+ \(Vorschau\)$/,
  );
  expect(network).toEqual([]);
});

test('the fixture preview registers no service worker', async ({ page }) => {
  await page.goto('/index.html');
  await expect(page.getByRole('heading', { name: 'Zählen' })).toBeVisible();

  const registrations = await page.evaluate(
    async () => (await navigator.serviceWorker.getRegistrations()).length,
  );

  expect(registrations).toBe(0);
});

test('the fixture preview uses relative asset paths only', () => {
  const html = readFileSync('web/dist-preview/index.html', 'utf8');

  expect(html).not.toMatch(/(src|href)="\//);
  expect(html).toMatch(/src="\.\/assets\//);
});

test('the preview menu offers the update prompt and the reload floor', async ({
  page,
}) => {
  await page.goto('/index.html');
  await page.getByText('Vorschau · Beispieldaten').click();

  await page.getByRole('button', { name: 'Neue Version anbieten' }).click();
  await expect(page.getByText('Neue Version verfügbar')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Neu laden' })).toBeVisible();

  await page
    .getByRole('button', { name: 'Veraltete Version simulieren' })
    .click();
  await expect(page.getByRole('dialog')).toContainText('Bitte neu laden');
});

test('the preview marker covers no control of any screen', async ({ page }) => {
  // Each screen is awaited by its own title and then by a control of its own: the
  // Rangliste has links and no buttons, so waiting for "a button" only ever passed
  // while the previous screen was still on the page.
  for (const [screen, title] of [
    ['konto', 'Konto'],
    ['rangliste', 'Rangliste'],
    ['verwalten/personen', 'Personen'],
    ['spiele', 'Spiele'],
    ['verwalten/konten', 'Konten'],
    ['verlauf/3', 'Daniel'],
  ] as const) {
    await page.goto(`/index.html#/${screen}`);
    await expect(
      page.getByRole('banner').getByRole('heading', { level: 1 }),
    ).toHaveText(title);
    await expect(page.locator('main button, main a').first()).toBeVisible();
    const marker = await page
      .getByText('Vorschau · Beispieldaten')
      .boundingBox();
    expect(marker).not.toBeNull();
    const controls = page.locator(
      'header button, header a, header h1, main button, main a, main h1, main h2, main .v-chip',
    );
    for (const control of await controls.all()) {
      const box = await control.boundingBox();
      if (!box || !marker) continue;
      const overlaps =
        box.x < marker.x + marker.width &&
        marker.x < box.x + box.width &&
        box.y < marker.y + marker.height &&
        marker.y < box.y + box.height;
      expect(
        overlaps,
        `${screen}: the marker covers ${(await control.textContent()) ?? ''}`,
      ).toBe(false);
    }
  }
});

test('the fixture preview counts a drink with Happy Hour ×2 on its sample evening and undoes it', async ({
  page,
}) => {
  await page.goto('/index.html');
  await page.getByRole('button', { name: 'Daniel, 13,5 Punkte heute' }).click();
  await page.getByRole('button', { name: 'Bier, 1 Punkt, heute 4' }).click();
  await page.getByRole('button', { name: 'Eins mehr' }).click();
  await page.getByRole('button', { name: 'Eins mehr' }).click();
  await page.getByRole('button', { name: 'Weiter' }).click();
  await page.getByRole('button', { name: 'Happy Hour, ×2' }).click();

  await expect(
    page.getByText('2× Bier · Happy Hour ×2 · Daniel'),
  ).toBeVisible();
  await expect(
    page.getByRole('button', { name: 'Daniel, 17,5 Punkte heute' }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Rückgängig' }).click();
  await expect(
    page.getByRole('button', { name: 'Daniel, 13,5 Punkte heute' }),
  ).toBeVisible();
});

test('the fixture preview manages its sample factors', async ({ page }) => {
  await page.goto('/index.html#/verwalten');
  await page.getByRole('link', { name: 'Faktoren' }).click();

  const factors = page.getByRole('list', { name: 'Faktoren' });
  await expect(factors.getByRole('listitem')).toHaveText([
    /Geburtstag\s*×1,5/,
    /Happy Hour\s*×2/,
  ]);
  await page.getByRole('button', { name: 'Happy Hour löschen' }).click();
  await expect(page.getByRole('dialog')).toContainText(
    '1 Eintrag zählt danach ×1.',
  );
});

test('the fixture preview renames a drink and deletes a person with their entries', async ({
  page,
}) => {
  await page.goto('/index.html#/verwalten');
  await expect(page.getByRole('link', { name: /^Personen/ })).toContainText(
    '6 Personen',
  );
  await page.getByRole('link', { name: /^Getränke/ }).click();
  await page.getByRole('button', { name: 'Radler bearbeiten' }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Name').fill('Alster');
  await dialog.getByRole('button', { name: 'Speichern' }).click();
  await expect(
    page.getByRole('list', { name: 'Getränke' }).getByRole('listitem').first(),
  ).toHaveText(/Alster\s*0,5 Punkte/);

  await page.goto('/index.html#/verwalten/personen');
  await page.getByRole('button', { name: 'Daniel löschen' }).click();
  await expect(dialog).toContainText('Daniel und 5 Einträge werden gelöscht.');
  await dialog.getByRole('button', { name: 'Löschen' }).click();
  await expect(page.getByText('Daniel gelöscht')).toBeVisible();

  await page.getByRole('link', { name: 'Rangliste' }).click();
  await expect(page.getByText('Anna', { exact: true })).toBeVisible();
  await expect(page.getByText('Daniel', { exact: true })).toHaveCount(0);
});

test('the fixture preview ranks its sample evening on the Rangliste', async ({
  page,
}) => {
  await page.goto('/index.html#/rangliste');

  const places = page
    .getByRole('list', { name: 'Rangliste' })
    .getByRole('link');
  await expect(places).toHaveCount(5);
  await expect(places.first()).toHaveAccessibleName(
    'Platz 1, Daniel, 13,5 Punkte, 9 Getränke',
  );
  await expect(places.last()).toHaveAccessibleName(
    'Platz 5, Tom, 0,5 Punkte, 1 Getränk',
  );
});

test('the fixture preview shows and deletes entries on a person’s Verlauf', async ({
  page,
}) => {
  await page.goto('/index.html#/rangliste');
  await page
    .getByRole('link', { name: 'Platz 1, Daniel, 13,5 Punkte, 9 Getränke' })
    .click();

  await expect(page).toHaveURL(/#\/verlauf\/3$/);
  const entries = page
    .getByRole('list', { name: 'Einträge von Daniel' })
    .getByRole('listitem');
  await expect(entries).toHaveCount(5);
  await expect(entries.first()).toContainText(
    /^2× BierKein Faktor · \d\d:\d\d · anna/,
  );
  await expect(entries.nth(2)).toContainText(
    /^2× SchnapsGeburtstag ×1,5 · \d\d:\d\d · gelöschtes Konto/,
  );
  await page
    .getByRole('button', { name: /^2× Bier um .* löschen$/ })
    .first()
    .click();
  await page
    .getByRole('dialog')
    .getByRole('button', { name: 'Löschen' })
    .click();

  await expect(page.getByText('Eintrag gelöscht')).toBeVisible();
  await expect(entries).toHaveCount(4);
  await page.getByRole('button', { name: 'Zurück' }).click();
  await expect(
    page.getByRole('list', { name: 'Rangliste' }).getByRole('link').first(),
  ).toHaveAccessibleName('Platz 1, Daniel, 11,5 Punkte, 7 Getränke');
});

test('the fixture preview opens another person’s Verlauf as a new screen', async ({
  page,
}) => {
  await page.goto('/index.html#/verlauf/3');
  await expect(
    page.getByRole('list', { name: 'Einträge von Daniel' }),
  ).toBeVisible();

  await page.goto('/index.html#/verlauf/4');

  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Jule');
  await expect(page.getByText('Heute keine Einträge.')).toBeVisible();
});

test('the fixture preview lists its sample games with their leaders under Spiele and opens one’s ranking', async ({
  page,
}) => {
  await page.goto('/index.html#/zaehlen');
  await expect(
    page.getByRole('navigation', { name: 'Hauptnavigation' }).getByRole('link'),
  ).toHaveText(['Zählen', 'Rangliste', 'Spiele', 'Verwalten']);
  await page
    .getByRole('navigation', { name: 'Hauptnavigation' })
    .getByRole('link', { name: 'Spiele' })
    .click();

  const games = page.getByRole('list', { name: 'Spiele' }).getByRole('link');
  await expect(games).toHaveCount(3);
  await expect(games.nth(0)).toHaveText(
    /^Rommé\s*Punktespiel · seit heute, 00:00\s*1\. Daniel · −11 Punkte$/,
  );
  await expect(games.nth(1)).toHaveText(
    /^Schach\s*Duell · seit \d\d\.\d\d\.\s*1\. Anna · 4 Punkte$/,
  );
  await games.nth(1).click();

  await expect(page).toHaveURL(/#\/spiele\/2$/);
  const bar = page.getByRole('banner');
  await expect(bar.getByRole('heading', { level: 1 })).toHaveText('Schach');
  await expect(bar).toContainText(/Duell · seit \d\d\.\d\d\./);
  await expect(page.getByText('Remis möglich')).toBeVisible();
  const ranking = page
    .getByRole('list', { name: 'Schach' })
    .getByRole('listitem');
  await expect(ranking.first()).toHaveAccessibleName(
    'Platz 1, Anna, 4 Punkte, 5 Partien · 3 S · 2 R · 0 N',
  );
  await expect(ranking).toHaveText([
    /^Anna\s*4\s*4 Punkte\s*5 Partien · 3 S · 2 R · 0 N$/,
    /^2\s*Ben\s*5 Partien · 3 S · 1 R · 1 N\s*3,5$/,
    /^3\s*Tom\s*4 Partien · 0 S · 2 R · 2 N\s*1$/,
    /^4\s*Daniel\s*3 Partien · 0 S · 1 R · 2 N\s*0,5$/,
  ]);
});

/** Opens an account's menu on Konten once any other menu has closed. */
async function accountMenu(page: Page, userName: string) {
  const menu = page.getByRole('menu');
  await expect(menu).toHaveCount(0);
  // The preview marker sits over the first row on compact windows: open by keyboard.
  await page
    .getByRole('button', { name: `Aktionen für ${userName}` })
    .press('Enter');
  return menu;
}

test('the fixture preview keeps its last admin and deletes an account, whose entries stay as “gelöschtes Konto”', async ({
  page,
}) => {
  await page.goto('/index.html#/verwalten/konten');
  let menu = await accountMenu(page, 'anna');
  for (const entry of ['Adminrechte entziehen', 'Löschen']) {
    await expect(
      menu.getByRole('menuitem', { name: new RegExp(`^${entry}`) }),
    ).toHaveAttribute('aria-disabled', 'true');
  }
  await page.keyboard.press('Escape');

  menu = await accountMenu(page, 'ben');
  await menu.getByRole('menuitem', { name: 'Zum Admin machen' }).click();
  await expect(page.getByText('ben ist jetzt Admin')).toBeVisible();
  menu = await accountMenu(page, 'anna');
  await expect(
    menu.getByRole('menuitem', { name: 'Adminrechte entziehen' }),
  ).not.toHaveAttribute('aria-disabled', 'true');
  await page.keyboard.press('Escape');

  menu = await accountMenu(page, 'ben');
  await menu.getByRole('menuitem', { name: 'Löschen' }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toContainText('Konto ben löschen?');
  await expect(dialog).toContainText('Einträge von ben bleiben erhalten.');
  await dialog.getByRole('button', { name: 'Löschen' }).click();
  await expect(page.getByText('ben gelöscht')).toBeVisible();
  await expect(
    page.getByRole('list', { name: 'Konten' }).getByRole('listitem'),
  ).toHaveText(['annaAdmin', 'daniel', 'mara']);

  await page.goto('/index.html#/verlauf/3');
  await expect(
    page
      .getByRole('list', { name: 'Einträge von Daniel' })
      .getByRole('listitem')
      .filter({ hasText: 'gelöschtes Konto' }),
  ).toHaveCount(2);
  await page.goto('/index.html#/rangliste');
  await expect(
    page.getByRole('link', {
      name: 'Platz 1, Daniel, 13,5 Punkte, 9 Getränke',
    }),
  ).toBeVisible();
});

test('the fixture preview records a change and shows it on Protokoll with the signed-in account', async ({
  page,
}) => {
  await page.goto('/index.html#/verwalten/getraenke');
  await page.getByRole('button', { name: 'Radler bearbeiten' }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Name').fill('Alster');
  await dialog.getByRole('button', { name: 'Speichern' }).click();
  await expect(page.getByText('Alster', { exact: true })).toBeVisible();

  await page.goto('/index.html#/verwalten');
  await page.getByRole('link', { name: /^Protokoll/ }).click();

  await expect(page).toHaveURL(/#\/verwalten\/protokoll$/);
  const today = page.getByRole('list', { name: 'Heute' });
  const newest = today.getByRole('listitem').first();
  await expect(newest).toContainText('Getränk Alster');
  await expect(newest).toContainText('Name: Radler → Alster');
  await expect(newest).toContainText(/\d\d:\d\d · anna/);
  await expect(newest).toContainText('Geändert');
  // The sample log reaches back over several days.
  await expect(page.getByRole('list', { name: 'Gestern' })).toBeVisible();
});
