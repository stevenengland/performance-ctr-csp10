import { readFileSync } from 'node:fs';
import { coloursAt, pickWith, PICTURES } from './support/photo.ts';
import { expect, test, type Locator, type Page } from './support/playwright.ts';

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
    ['spiele/2', 'Schach'],
    ['spiele/2/partie/1/3', 'Schach'],
    ['spiele/1/ergebnis/3', 'Rommé'],
    ['spiele/2/verlauf', 'Verlauf'],
    ['verwalten/konten', 'Konten'],
    ['verlauf/3', 'Daniel'],
    ['offen', 'Offen'],
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

test('the fixture preview counts a drink with Happy Hour ×2 on its sample evening, where it waits for verification, and undoes it', async ({
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
    page.getByText('2× Bier · Happy Hour ×2 · Daniel · wartet auf Bestätigung'),
  ).toBeVisible();
  // It waits: the score stays, the drink's counter shows what was recorded.
  await page.getByRole('button', { name: 'Daniel, 13,5 Punkte heute' }).click();
  await expect(
    page.getByRole('button', { name: 'Bier, 1 Punkt, heute 8' }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Rückgängig' }).click();
  await expect(
    page.getByRole('button', { name: 'Bier, 1 Punkt, heute 4' }),
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
  await expect(dialog).toContainText(
    'Daniel, 5 Einträge und 3 Ergebnisse werden gelöscht.',
  );
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
  await expect(places.nth(2)).toHaveAccessibleName(
    'Platz 3, Mara, 6 Punkte, 4 Getränke, +1 offen',
  );
  await expect(
    page.getByRole('list', { name: 'Noch nicht gewertet' }).getByRole('link'),
  ).toHaveAccessibleName('Jule, Aperol 1 · Bier 2, +2 offen');
});

test('the fixture preview lists what anna may verify under Offen with its badge; Bestätigen lets it count, Ablehnen removes it', async ({
  page,
}) => {
  await page.goto('/index.html#/offen');
  const navigation = page.getByRole('navigation', { name: 'Hauptnavigation' });
  await expect(
    navigation.getByRole('link', { name: 'Offen, 4 offen' }),
  ).toBeVisible();
  await expect(
    page.getByRole('list', { name: 'Zu bestätigen' }).getByRole('listitem'),
  ).toHaveText([
    /^2× Bier für Jule.* · ben/,
    /^1× Aperol für Jule.* · mara/,
    /^Daniel · 14 Punkte\s*Rommé · \d\d\.\d\d\., \d\d:\d\d · ben/,
    /^Jule – Tom · Tom gewinnt\s*Tischtennis · \d\d\.\d\d\., 21:00 · mara/,
  ]);

  await page
    .getByRole('button', { name: '2× Bier für Jule bestätigen' })
    .click();

  await expect(
    page.getByRole('list', { name: 'Zu bestätigen' }).getByRole('listitem'),
  ).toHaveText([/^1× Aperol für Jule/, /^Daniel · 14 Punkte/, /^Jule – Tom/]);
  await expect(
    navigation.getByRole('link', { name: 'Offen, 3 offen' }),
  ).toBeVisible();

  await page
    .getByRole('button', { name: '1× Aperol für Jule ablehnen' })
    .click();
  await expect(
    navigation.getByRole('link', { name: 'Offen, 2 offen' }),
  ).toBeVisible();
  await page
    .getByRole('button', { name: 'Daniel · 14 Punkte ablehnen' })
    .click();
  await expect(
    navigation.getByRole('link', { name: 'Offen, 1 offen' }),
  ).toBeVisible();
  await page
    .getByRole('button', { name: 'Jule – Tom · Tom gewinnt bestätigen' })
    .click();

  await expect(page.getByText('Nichts zu bestätigen.')).toBeVisible();
  await page.goto('/index.html#/rangliste');
  await expect(
    page.getByRole('link', { name: /^Platz \d+, Jule, 2 Punkte, 2 Getränke$/ }),
  ).toBeVisible();
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
  const entries = page
    .getByRole('list', { name: 'Einträge von Jule' })
    .getByRole('listitem');
  await expect(entries).toHaveText([/^2× Bier.*offen/, /^1× Aperol.*offen/]);
});

test('the fixture preview lists its sample games with their leaders under Spiele and opens one’s ranking', async ({
  page,
}) => {
  await page.goto('/index.html#/zaehlen');
  await expect(
    page.getByRole('navigation', { name: 'Hauptnavigation' }).getByRole('link'),
  ).toHaveText(['Zählen', 'Rangliste', 'Spiele', /Offen$/, 'Verwalten']);
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

test('the fixture preview records a Schach match in three taps and undoes it', async ({
  page,
}) => {
  await page.goto('/index.html#/spiele/2');
  await page.getByRole('button', { name: 'Partie eintragen' }).click();

  await expect(
    page.getByRole('heading', { name: 'Wer spielt?' }),
  ).toBeVisible();
  await expect(page.getByRole('banner')).toContainText('Partie eintragen');
  await page.getByRole('button', { name: 'Daniel, 0,5 Punkte' }).click();
  await expect(page.getByRole('heading', { name: 'Gegen wen?' })).toBeVisible();
  await page.getByRole('button', { name: 'Tom, 1 Punkt' }).click();
  await expect(
    page.getByRole('progressbar', { name: 'Schritt 3 von 3' }),
  ).toBeVisible();
  await expect(page.getByRole('button', { name: 'Remis' })).toBeVisible();
  await page.getByRole('button', { name: 'Daniel gewinnt' }).click();

  await expect(
    page.getByText('Daniel – Tom · Daniel gewinnt · wartet auf Bestätigung'),
  ).toBeVisible();
  await expect(
    page.getByRole('heading', { name: 'Wer spielt?' }),
  ).toBeVisible();
  // The match waits for another account, so Daniel's standing stays as it was.
  await expect(
    page.getByRole('button', { name: 'Daniel, 0,5 Punkte' }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Rückgängig' }).click();
  await expect(page.getByText('Rückgängig gemacht')).toBeVisible();
});

test('the fixture preview records a Rommé result on its number pad, where it waits unranked', async ({
  page,
}) => {
  await page.goto('/index.html#/spiele/1');
  await page.getByRole('button', { name: 'Ergebnis eintragen' }).click();

  await expect(page.getByRole('heading', { name: 'Für wen?' })).toBeVisible();
  await expect(page.getByRole('banner')).toContainText('Ergebnis eintragen');
  await expect(
    page.getByRole('button', { name: 'Daniel, −11 Punkte' }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Tom, noch nichts' }).click();
  await expect(
    page.getByRole('heading', { name: 'Wie viele Punkte?' }),
  ).toBeVisible();
  await expect(
    page.getByRole('progressbar', { name: 'Schritt 2 von 2' }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Ziffer 2' }).click();
  await page.getByRole('button', { name: 'Ziffer 0' }).click();
  // A keyboard works too: the minus key sets the sign.
  await page.keyboard.press('-');
  await expect(page.locator('output')).toHaveText('−20');
  await page.getByRole('button', { name: 'Speichern' }).click();

  await expect(
    page.getByText('Tom · −20 Punkte · wartet auf Bestätigung'),
  ).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Für wen?' })).toBeVisible();
  // The result waits for another account, so Tom has no counted result yet.
  await expect(
    page.getByRole('button', { name: 'Tom, noch nichts' }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Zurück' }).click();
  await expect(
    page.getByRole('listitem', {
      name: 'Platz 1, Daniel, −11 Punkte, 2 Ergebnisse, +1 offen',
    }),
  ).toBeVisible();
  const unranked = page
    .getByRole('list', { name: 'Noch nicht gewertet' })
    .getByRole('listitem');
  await expect(unranked).toHaveCount(2);
  await expect(unranked.nth(0)).toHaveAccessibleName('Jule, +1 offen');
  await expect(unranked.nth(1)).toHaveAccessibleName('Tom, +1 offen');
});

test('the fixture preview opens Schach’s Verlauf and deletes a match from it', async ({
  page,
}) => {
  await page.goto('/index.html#/spiele/2');
  await page.getByRole('link', { name: 'Verlauf' }).click();

  await expect(page).toHaveURL(/#\/spiele\/2\/verlauf$/);
  const bar = page.getByRole('banner');
  await expect(bar.getByRole('heading', { level: 1 })).toHaveText('Verlauf');
  await expect(bar).toContainText(/Schach · seit \d\d\.\d\d\./);
  const rows = page
    .getByRole('list', { name: 'Verlauf' })
    .getByRole('listitem');
  await expect(rows).toHaveCount(9);
  await expect(rows.first()).toContainText(
    /^Ben – Anna\s*Remis · \d\d\.\d\d\., 21:00 · ben/,
  );
  await expect(rows.filter({ hasText: 'gelöschte Person – Ben' })).toHaveText(
    /Ben gewinnt · \d\d\.\d\d\., 21:00 · ben/,
  );
  await expect(rows.filter({ hasText: 'gelöschtes Konto' })).toHaveText(
    /^Ben – Tom\s*Ben gewinnt/,
  );
  await expect(page.getByRole('button', { name: 'Ältere laden' })).toHaveCount(
    0,
  );

  await page
    .getByRole('button', { name: /^Ben – Anna vom \d\d\.\d\d\. löschen$/ })
    .click();
  const confirm = page.getByRole('dialog');
  await expect(confirm.getByRole('heading')).toHaveText('Partie löschen?');
  await expect(confirm).toContainText(
    /Ben – Anna · Remis am \d\d\.\d\d\. um 21:00/,
  );
  await confirm.getByRole('button', { name: 'Löschen' }).click();

  await expect(page.getByText('Partie gelöscht')).toBeVisible();
  await expect(rows).toHaveCount(8);
  await page.getByRole('button', { name: 'Zurück' }).click();
  await expect(
    page.getByRole('listitem', {
      name: 'Platz 1, Anna, 3,5 Punkte, 4 Partien · 3 S · 1 R · 0 N',
    }),
  ).toBeVisible();
});

test('the fixture preview restarts Schach: an empty ranking and Verlauf since today', async ({
  page,
}) => {
  await page.goto('/index.html#/spiele/2');
  await expect(
    page.getByRole('list', { name: 'Schach' }).getByRole('listitem'),
  ).toHaveCount(4);
  await page.getByRole('button', { name: 'Neu starten' }).click();

  const confirm = page.getByRole('dialog');
  await expect(confirm.getByRole('heading')).toHaveText('Schach neu starten?');
  await expect(confirm).toContainText(
    'Die Rangliste beginnt wieder bei null. Bisherige Ergebnisse bleiben gespeichert, werden aber nicht mehr angezeigt.',
  );
  await confirm.getByRole('button', { name: 'Neu starten' }).click();

  await expect(page.getByText('Schach neu gestartet')).toBeVisible();
  await expect(
    page.getByText('Seit dem Start noch keine Partien.'),
  ).toBeVisible();
  await expect(page.getByRole('banner')).toContainText(
    /Duell · seit heute, \d\d:\d\d/,
  );

  await page.getByRole('link', { name: 'Verlauf' }).click();
  await expect(page).toHaveURL(/#\/spiele\/2\/verlauf$/);
  await expect(page.getByRole('banner')).toContainText(
    /Schach · seit heute, \d\d:\d\d/,
  );
  await expect(
    page.getByText('Seit dem Start noch keine Partien.'),
  ).toBeVisible();
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

test('the fixture preview shows sample photos for Anna, Daniel and Mara and initials for the others', async ({
  page,
}) => {
  await page.goto('/index.html#/verwalten/personen');
  const list = page.getByRole('list', { name: 'Personen' });
  await expect(list.getByRole('listitem')).toHaveCount(6);

  // Polled: the photos load after the rows are there.
  const avatars = () =>
    list.locator('.person-avatar').evaluateAll((spans) =>
      spans.map((span) => {
        const img = span.querySelector('img');
        return img
          ? { photo: img.complete && img.naturalWidth === 256 }
          : {
              initials: span
                .querySelector('[data-initials]')
                ?.getAttribute('data-initials'),
            };
      }),
    );
  await expect
    .poll(avatars)
    .toEqual([
      { photo: true },
      { initials: 'B' },
      { photo: true },
      { initials: 'J' },
      { photo: true },
      { initials: 'T' },
    ]);
  await expect(
    list.getByRole('link', { name: 'Verlauf von Anna', exact: true }),
  ).toHaveText('Anna');
});

test('the fixture preview shows avatars on the Zählen tiles and the Rangliste', async ({
  page,
}) => {
  /** Each avatar's size, and whether it shows a loaded photo or initials. */
  const avatars = (scope: Locator) => () =>
    scope.locator('.person-avatar').evaluateAll((spans) =>
      spans.map((span) => {
        const img = span.querySelector('img');
        return {
          size: span.getBoundingClientRect().width,
          shows: img
            ? img.complete && img.naturalWidth === 256
              ? 'photo'
              : 'loading'
            : span
                .querySelector('[data-initials]')
                ?.getAttribute('data-initials'),
        };
      }),
    );

  await page.goto('/index.html#/zaehlen');
  const tiles = page.locator('.count-tile');
  await expect(tiles).toHaveCount(6);
  await expect(tiles.first()).toHaveAccessibleName(/^Anna, /);
  await expect.poll(avatars(page.locator('.tile-grid'))).toEqual([
    { size: 40, shows: 'photo' },
    { size: 40, shows: 'B' },
    { size: 40, shows: 'photo' },
    { size: 40, shows: 'J' },
    { size: 40, shows: 'photo' },
    { size: 40, shows: 'T' },
  ]);

  await page.getByRole('link', { name: 'Rangliste' }).click();
  const leader = page.getByRole('link', {
    name: 'Platz 1, Daniel, 13,5 Punkte, 9 Getränke',
  });
  await expect.poll(avatars(leader)).toEqual([{ size: 64, shows: 'photo' }]);
  // The ring is the card's own on-primary-container, 3 px wide.
  const ring = await leader
    .locator('.person-avatar')
    .evaluate((span) => getComputedStyle(span).boxShadow);
  const ink = await leader.evaluate((card) => getComputedStyle(card).color);
  expect(ring).toBe(`${ink} 0px 0px 0px 3px`);
  const rows = page.locator('[data-test="rank"]');
  await expect(rows).toHaveCount(4);
  const sizes = await avatars(rows)();
  expect(sizes.map((avatar) => avatar.size)).toEqual([44, 44, 44, 44]);
  const unranked = page.locator('[data-test="unranked"]');
  await expect(unranked).toHaveCount(1);
  const unrankedSizes = await avatars(unranked)();
  expect(unrankedSizes.map((avatar) => avatar.size)).toEqual([44]);
});

test('the fixture preview removes a person’s photo in Person bearbeiten', async ({
  page,
}) => {
  await page.goto('/index.html#/verwalten/personen');
  const anna = page
    .getByRole('list', { name: 'Personen' })
    .getByRole('listitem')
    .first();
  await expect(anna.locator('.person-avatar img')).toHaveCount(1);

  await page.getByRole('button', { name: 'Anna bearbeiten' }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.locator('.person-avatar')).toHaveCSS('width', '112px');
  await dialog.getByRole('button', { name: 'Foto entfernen' }).click();
  await expect(dialog.locator('[data-initials="A"]')).toHaveCount(1);
  await dialog.getByRole('button', { name: 'Speichern' }).click();

  await expect(dialog).toBeHidden();
  await expect(anna.locator('.person-avatar img')).toHaveCount(0);
  await expect(anna.locator('[data-initials]')).toHaveAttribute(
    'data-initials',
    'A',
  );

  // Protokoll names the change, never the photo's version.
  await page.goto('/index.html#/verwalten/protokoll');
  const newest = page
    .getByRole('list', { name: 'Heute' })
    .getByRole('listitem')
    .first();
  await expect(newest).toContainText('Person Anna');
  await expect(newest).toContainText('Foto entfernt');
  await expect(newest).not.toContainText(/data:|\.jpg/);
});

test('the fixture preview sets and replaces a person’s photo in Person bearbeiten', async ({
  page,
}) => {
  await page.goto('/index.html#/verwalten/personen');
  const ben = page
    .getByRole('list', { name: 'Personen' })
    .getByRole('listitem')
    .filter({ hasText: 'Ben' });
  await expect(ben.locator('[data-initials="B"]')).toHaveCount(1);
  const dialog = page.getByRole('dialog');
  const photo = ben.locator('.person-avatar img');
  const loaded = () =>
    photo.evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth);

  await page.getByRole('button', { name: 'Ben bearbeiten' }).click();
  await pickWith(
    page,
    dialog.getByRole('button', { name: 'Foto wählen' }),
    PICTURES.halves,
  );
  await expect(
    dialog.getByRole('application', { name: 'Ausschnitt des Fotos' }),
  ).toBeVisible();
  await dialog.getByRole('button', { name: 'Speichern' }).click();
  await expect(dialog).toBeHidden();

  await expect(photo).toHaveAttribute('src', /^data:image\/jpeg;base64,/);
  await expect.poll(loaded).toBe(256);
  const first = await photo.getAttribute('src');

  await page.getByRole('button', { name: 'Ben bearbeiten' }).click();
  await pickWith(
    page,
    dialog.getByRole('button', { name: 'Foto ändern' }),
    PICTURES.exifRotated,
  );
  await expect(
    dialog.getByRole('button', { name: 'Anderes Foto' }),
  ).toBeVisible();
  await dialog.getByRole('button', { name: 'Speichern' }).click();
  await expect(dialog).toBeHidden();

  await expect(photo).not.toHaveAttribute('src', first ?? '');
  await expect.poll(loaded).toBe(256);
  expect(
    await coloursAt(photo, [
      [0.5, 0.2],
      [0.5, 0.8],
    ]),
  ).toEqual(['red', 'blue']);
});

test('the fixture preview creates a person with a photo in Person anlegen', async ({
  page,
}) => {
  await page.goto('/index.html#/verwalten/personen');
  const list = page.getByRole('list', { name: 'Personen' });
  await expect(list.getByRole('listitem')).toHaveCount(6);
  const dialog = page.getByRole('dialog');

  await page.getByRole('button', { name: 'Person anlegen' }).click();
  await dialog.getByLabel('Name').fill('Lea');
  await expect(dialog.locator('[data-initials="L"]')).toHaveCount(1);
  await pickWith(
    page,
    dialog.getByRole('button', { name: 'Foto wählen' }),
    PICTURES.halves,
  );
  await expect(
    dialog.getByRole('application', { name: 'Ausschnitt des Fotos' }),
  ).toBeVisible();
  await dialog.getByRole('button', { name: 'Speichern' }).click();
  await expect(dialog).toBeHidden();

  const lea = list.getByRole('listitem').filter({ hasText: 'Lea' });
  const photo = lea.locator('.person-avatar img');
  await expect(list.getByRole('listitem')).toHaveCount(7);
  await expect(photo).toHaveAttribute('src', /^data:image\/jpeg;base64,/);
  await expect
    .poll(() =>
      photo.evaluate(
        (img: HTMLImageElement) => img.complete && img.naturalWidth,
      ),
    )
    .toBe(256);
  expect(
    await coloursAt(photo, [
      [0.3, 0.5],
      [0.7, 0.5],
    ]),
  ).toEqual(['red', 'blue']);
});
