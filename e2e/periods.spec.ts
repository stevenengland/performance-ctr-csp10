import { randomUUID } from 'node:crypto';
import {
  expect,
  test,
  type APIRequestContext,
  type Page,
} from './support/playwright.ts';
import { recordedAt } from './support/stack-database.ts';
import { signIn, uniqueName, verifierOn } from './support/session.ts';

/*
The periods end to end on the stack (PRD #70): rows recorded on earlier days, read
through the Rangliste's and a game's periods, Verlauf and Zählen. The API records
every row at its own clock, so a test moves its rows back to an earlier day in the
stack's database (support/stack-database.ts). The stack is shared by every worker and
both window projects run this file at once: each test works with persons of its own
names, and a test that needs a day to itself first finds one nobody recorded on.
*/

test.use({ timezoneId: 'Europe/Berlin' });

async function created(
  request: APIRequestContext,
  path: '/api/persons' | '/api/drinks' | '/api/games',
  data: Record<string, unknown>,
): Promise<number> {
  const response = await request.post(path, { data });
  expect(response.status()).toBe(201);
  return ((await response.json()) as { id: number }).id;
}

/** Records an entry, which waits for verification, and returns its id. */
async function addEntry(
  request: APIRequestContext,
  personId: number,
  drinkId: number,
  quantity: number,
): Promise<string> {
  const id = randomUUID();
  const response = await request.put(`/api/entries/${id}`, {
    data: { personId, drinkId, quantity },
  });
  expect(response.status()).toBe(201);
  return id;
}

/** A local calendar day in the page's time zone, as the app names and reads it. */
interface Day {
  /** The calendar's name of the day: `Montag, 9. November`. */
  name: string;
  /** How many months before today's month it lies (`Vorheriger Monat` clicks). */
  monthsBack: number;
  /** Its local midnight and the next day's, the window the app reads. */
  start: Date;
  end: Date;
  /** 20:00 that evening, local. */
  evening: Date;
  /** Verlauf's `?tag=`. */
  tag: string;
}

async function dayBack(page: Page, daysBack: number): Promise<Day> {
  const day = await page.evaluate((back) => {
    const now = new Date();
    const start = new Date(
      now.getFullYear(),
      now.getMonth(),
      now.getDate() - back,
    );
    const end = new Date(
      start.getFullYear(),
      start.getMonth(),
      start.getDate() + 1,
    );
    const evening = new Date(
      start.getFullYear(),
      start.getMonth(),
      start.getDate(),
      20,
    );
    const pad = (value: number) => String(value).padStart(2, '0');
    return {
      name: new Intl.DateTimeFormat('de-DE', {
        weekday: 'long',
        day: 'numeric',
        month: 'long',
      }).format(start),
      monthsBack:
        (now.getFullYear() - start.getFullYear()) * 12 +
        now.getMonth() -
        start.getMonth(),
      start: start.toISOString(),
      end: end.toISOString(),
      evening: evening.toISOString(),
      tag: `${String(start.getFullYear())}-${pad(start.getMonth() + 1)}-${pad(start.getDate())}`,
    };
  }, daysBack);
  return {
    ...day,
    start: new Date(day.start),
    end: new Date(day.end),
    evening: new Date(day.evening),
  };
}

/**
A past day on which nothing is recorded yet, at least `from` days back, so a test can
own it: the two window projects search from different days, so they never share one.
*/
async function freeDay(page: Page, from: number): Promise<Day> {
  const base = from + (test.info().project.name.endsWith('expanded') ? 30 : 0);
  for (let back = base; back < base + 30; back += 1) {
    const day = await dayBack(page, back);
    const window = new URLSearchParams({
      from: day.start.toISOString(),
      to: day.end.toISOString(),
    });
    const response = await page.request.get(`/api/scoreboard?${window}`);
    expect(response.status()).toBe(200);
    const board = (await response.json()) as {
      rows: unknown[];
      unranked: unknown[];
    };
    if (board.rows.length + board.unranked.length === 0) return day;
  }
  throw new Error(`no free day from ${String(base)} days back`);
}

/** Opens `Tag wählen` and picks the day, going back as many months as it needs. */
async function pickDay(page: Page, day: Day) {
  await page.getByRole('button', { name: /^Tag wählen: / }).click();
  const dialog = page.getByRole('dialog');
  for (let month = 0; month < day.monthsBack; month += 1) {
    await dialog.getByRole('button', { name: 'Vorheriger Monat' }).click();
  }
  await dialog.getByRole('button', { name: day.name, exact: true }).click();
  await expect(dialog).toBeHidden();
}

/** The shown day in the calendar of `Tag wählen`, which opens on its month and stays open. */
async function shownInCalendar(page: Page, day: Day) {
  await page.getByRole('button', { name: /^Tag wählen: / }).click();
  return page.getByRole('dialog').getByRole('button', {
    name: day.name,
    exact: true,
  });
}

/** The sessions with counted drinks that `GET /api/scoreboard/days` answers for the day's window. */
async function daysWithDataIn(
  page: Page,
  day: Day,
): Promise<{ from: string; to: string }[]> {
  const response = await page.request.get('/api/scoreboard/days', {
    params: { from: day.start.toISOString(), to: day.end.toISOString() },
  });
  expect(response.status()).toBe(200);
  const { spans } = (await response.json()) as {
    spans: { from: string; to: string }[];
  };
  return spans;
}

/**
A person's place on the Rangliste: the leader card or a row, a link named
`Platz n, <name>, …`, or a row without a rank, named `<name>, …`.
*/
function place(page: Page, name: string) {
  return page.getByRole('link', {
    name: new RegExp(`^(Platz \\d+, )?${name},`),
  });
}

/** What a read period shows: its ranking, its persons without a rank, or that nothing counted. */
function read(page: Page) {
  return page
    .getByRole('list', { name: 'Rangliste' })
    .or(page.getByRole('list', { name: 'Noch nicht gewertet' }))
    .or(
      page.getByText(
        /^(Heute noch keine Getränke|An diesem Tag wurde nichts gezählt)\.$/,
      ),
    )
    .first();
}

function periods(page: Page) {
  return page.getByRole('group', { name: 'Zeitraum' });
}

test.beforeEach(async ({ page }) => {
  await signIn(page);
});

test('an entry recorded on a past day ranks under that day, its week and Gesamt, not today, and opens that day’s Verlauf', async ({
  page,
  request,
}) => {
  const verify = await verifierOn(request);
  const anna = uniqueName('Anna');
  const annaId = await created(page.request, '/api/persons', { name: anna });
  const bier = uniqueName('Bier');
  const bierId = await created(page.request, '/api/drinks', {
    name: bier,
    points: 1,
  });
  await page.goto('/rangliste');
  const day = await freeDay(page, 3);
  const entry = await addEntry(page.request, annaId, bierId, 3);
  recordedAt('entries', entry, day.evening);
  await verify(entry);
  const ranked = new RegExp(`^Platz 1, ${anna}, 3 Punkte, 3 Getränke$`);

  await page.reload();
  await expect(
    page.getByRole('banner').getByText('Heute', { exact: true }),
  ).toBeVisible();
  await expect(read(page)).toBeVisible();
  await expect(place(page, anna)).toHaveCount(0);

  await pickDay(page, day);
  await expect(place(page, anna)).toHaveAccessibleName(ranked);

  await periods(page).getByRole('button', { name: 'Woche' }).click();
  await expect(page.getByRole('banner')).toContainText(/KW \d{1,2} · /);
  await expect(place(page, anna)).toHaveAccessibleName(
    new RegExp(`^Platz \\d+, ${anna}, 3 Punkte, 3 Getränke$`),
  );

  await periods(page).getByRole('button', { name: 'Gesamt' }).click();
  await expect(place(page, anna)).toHaveAccessibleName(
    new RegExp(`^Platz \\d+, ${anna}, 3 Punkte, 3 Getränke$`),
  );

  await periods(page).getByRole('button', { name: 'Tag' }).click();
  await expect(place(page, anna)).toHaveAccessibleName(ranked);
  await place(page, anna).click();
  await expect(page).toHaveURL(
    new RegExp(`/verlauf/${String(annaId)}\\?tag=${day.tag}$`),
  );
  await expect(
    page
      .getByRole('list', { name: `Einträge von ${anna}` })
      .getByRole('listitem'),
  ).toHaveText([new RegExp(`^3× ${bier}.*20:00`)]);
});

test('Zählen’s tiles and top bar count today while the Rangliste shows another day', async ({
  page,
  request,
}) => {
  const verify = await verifierOn(request);
  const mara = uniqueName('Mara');
  const maraId = await created(page.request, '/api/persons', { name: mara });
  const bier = uniqueName('Bier');
  const bierId = await created(page.request, '/api/drinks', {
    name: bier,
    points: 1,
  });
  await page.goto('/rangliste');
  const day = await freeDay(page, 3);
  const earlier = await addEntry(page.request, maraId, bierId, 4);
  recordedAt('entries', earlier, day.evening);
  await verify(earlier);
  await verify(await addEntry(page.request, maraId, bierId, 1));

  await page.reload();
  await pickDay(page, day);
  await expect(place(page, mara)).toHaveAccessibleName(
    `Platz 1, ${mara}, 4 Punkte, 4 Getränke`,
  );

  await page.getByRole('link', { name: 'Zählen' }).first().click();
  await expect(page).toHaveURL(/\/zaehlen$/);
  await page.getByRole('button', { name: `${mara}, 1 Punkte heute` }).click();
  await expect(page.getByRole('banner').getByRole('heading')).toHaveText(mara);
  await expect(page.locator('.top-bar__score')).toHaveText('1Punkte heute');
  await expect(
    page.getByRole('button', {
      name: new RegExp(`^${bier}, 1 Punkt, heute 1`),
    }),
  ).toBeVisible();

  await page.getByRole('link', { name: 'Rangliste' }).click();
  await expect(place(page, mara)).toHaveAccessibleName(
    `Platz 1, ${mara}, 4 Punkte, 4 Getränke`,
  );
});

test('a past day whose entries all wait lists them only under Noch nicht gewertet without a dot, and ranks and dots them once another account confirms one', async ({
  page,
  request,
}) => {
  const verify = await verifierOn(request);
  const jule = uniqueName('Jule');
  const juleId = await created(page.request, '/api/persons', { name: jule });
  const weinId = await created(page.request, '/api/drinks', {
    name: uniqueName('Wein'),
    points: 1,
  });
  await page.goto('/rangliste');
  const day = await freeDay(page, 3);
  const entry = await addEntry(page.request, juleId, weinId, 2);
  recordedAt('entries', entry, day.evening);

  await page.reload();
  await pickDay(page, day);
  await expect(
    page.getByRole('list', { name: 'Noch nicht gewertet' }).getByRole('link'),
  ).toHaveAccessibleName(new RegExp(`^${jule}, .*\\+1 offen$`));
  await expect(page.getByRole('list', { name: 'Rangliste' })).toHaveCount(0);
  await expect(page.locator('[data-test="leader"]')).toHaveCount(0);
  // The absence of a dot proves nothing while the calendar's read is on its way: the
  // server's days are the proof, the calendar shows them.
  expect(await daysWithDataIn(page, day)).toEqual([]);
  const unmarked = await shownInCalendar(page, day);
  await expect(unmarked).toHaveAttribute('aria-pressed', 'true');
  await expect(unmarked).not.toHaveClass(/calendar__day--marked/);
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toBeHidden();

  await verify(entry);
  expect(await daysWithDataIn(page, day)).toEqual([
    {
      from: day.evening.toISOString(),
      to: new Date(day.evening.getTime() + 15 * 60_000).toISOString(),
    },
  ]);
  // A past day is read again on focus, not polled.
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await expect(place(page, jule)).toHaveAccessibleName(
    `Platz 1, ${jule}, 2 Punkte, 2 Getränke`,
  );
  await expect(
    page.getByRole('list', { name: 'Noch nicht gewertet' }),
  ).toHaveCount(0);
  await expect(await shownInCalendar(page, day)).toHaveClass(
    /calendar__day--marked/,
  );
});

test('an entry recorded shortly before local midnight and confirmed after it ranks under the day it was recorded', async ({
  page,
  request,
}) => {
  const verify = await verifierOn(request);
  const tom = uniqueName('Tom');
  const tomId = await created(page.request, '/api/persons', { name: tom });
  const bierId = await created(page.request, '/api/drinks', {
    name: uniqueName('Bier'),
    points: 1,
  });
  await page.goto('/rangliste');
  const day = await freeDay(page, 3);
  const entry = await addEntry(page.request, tomId, bierId, 2);
  await verify(entry);
  recordedAt(
    'entries',
    entry,
    new Date(day.end.getTime() - 30_000),
    new Date(day.end.getTime() + 30_000),
  );

  await page.reload();
  await pickDay(page, day);
  await expect(place(page, tom)).toHaveAccessibleName(
    `Platz 1, ${tom}, 2 Punkte, 2 Getränke`,
  );

  await page.getByRole('button', { name: 'Nächster Tag' }).click();
  await expect(read(page)).toBeVisible();
  await expect(place(page, tom)).toHaveCount(0);
});

test('after Neu starten a points game ranks its earlier results under Gesamt and none under Aktuell, by Summe and by Ø pro Ergebnis', async ({
  page,
  request,
}) => {
  const anna = uniqueName('Anna');
  const ben = uniqueName('Ben');
  const annaId = await created(page.request, '/api/persons', { name: anna });
  const benId = await created(page.request, '/api/persons', { name: ben });
  const game = uniqueName('Darts');
  const gameId = await created(page.request, '/api/games', {
    name: game,
    kind: 'points',
    lowerWins: false,
  });
  const verify = await verifierOn(request);
  const score = async (personId: number, points: number) => {
    const id = randomUUID();
    const response = await page.request.put(`/api/results/${id}`, {
      data: { gameId, personId, points },
    });
    expect(response.status()).toBe(201);
    await verify(id, 'results');
  };
  await score(annaId, 10);
  await score(annaId, 10);
  await score(benId, 15);
  const places = page.getByRole('listitem', { name: /^Platz / });
  const measures = page.getByRole('group', { name: 'Wertung' });

  await page.goto(`/spiele/${String(gameId)}`);
  await expect(places).toHaveCount(2);
  await page.getByRole('button', { name: 'Neu starten' }).click();
  await page
    .getByRole('dialog')
    .getByRole('button', { name: 'Neu starten' })
    .click();
  await expect(page.getByText(`${game} neu gestartet`)).toBeVisible();
  await expect(
    page.getByText('Seit dem Start noch keine Ergebnisse.'),
  ).toBeVisible();
  await expect(places).toHaveCount(0);

  await periods(page).getByRole('button', { name: 'Gesamt' }).click();
  await expect(places).toHaveText([
    new RegExp(`${anna}[\\s\\S]*20`),
    new RegExp(`${ben}[\\s\\S]*15`),
  ]);
  await expect(places.nth(0)).toHaveAccessibleName(
    `Platz 1, ${anna}, 20 Punkte, 2 Ergebnisse · Ø 10`,
  );

  await measures.getByRole('button', { name: 'Ø pro Ergebnis' }).click();
  await expect(places.nth(0)).toHaveAccessibleName(
    `Platz 1, ${ben}, Ø 15 Punkte, 1 Ergebnis · Summe 15`,
  );
  await expect(places.nth(1)).toHaveAccessibleName(
    `Platz 2, ${anna}, Ø 10 Punkte, 2 Ergebnisse · Summe 20`,
  );

  await periods(page).getByRole('button', { name: 'Aktuell' }).click();
  await expect(
    page.getByText('Seit dem Start noch keine Ergebnisse.'),
  ).toBeVisible();
});

test('requests shaped like the previous release’s answer as before: today’s scoreboard with only from, a game’s standings without parameters', async ({
  page,
  request,
}) => {
  const verify = await verifierOn(request);
  const daniel = uniqueName('Daniel');
  const danielId = await created(page.request, '/api/persons', {
    name: daniel,
  });
  const bierId = await created(page.request, '/api/drinks', {
    name: uniqueName('Bier'),
    points: 1,
  });
  await verify(await addEntry(page.request, danielId, bierId, 2));
  const gameId = await created(page.request, '/api/games', {
    name: uniqueName('Rommé'),
    kind: 'points',
    lowerWins: true,
  });
  const result = randomUUID();
  expect(
    (
      await page.request.put(`/api/results/${result}`, {
        data: { gameId, personId: danielId, points: 12 },
      })
    ).status(),
  ).toBe(201);
  await verify(result, 'results');
  await page.goto('/rangliste');
  const today = await dayBack(page, 0);

  const board = await page.request.get(
    `/api/scoreboard?from=${encodeURIComponent(today.start.toISOString())}`,
  );
  expect(board.status()).toBe(200);
  expect(board.headers().etag).toMatch(
    new RegExp(`^"\\d+-${String(today.start.getTime())}"$`),
  );
  const { rows } = (await board.json()) as {
    rows: Record<string, unknown>[];
  };
  const row = rows.find((candidate) => candidate.personId === danielId);
  expect(Object.keys(row ?? {}).sort()).toEqual(
    [
      'count',
      'drinks',
      'name',
      'pendingCount',
      'personId',
      'photoUrl',
      'score',
    ].sort(),
  );

  const standings = await page.request.get(
    `/api/games/${String(gameId)}/standings`,
  );
  expect(standings.status()).toBe(200);
  expect(standings.headers().etag).toMatch(/^"\d+"$/);
  const body = (await standings.json()) as {
    rows: Record<string, unknown>[];
  };
  expect(Object.keys(body).sort()).toEqual(
    ['kind', 'lowerWins', 'rows', 'startedAt', 'unranked'].sort(),
  );
  expect(body.rows).toEqual([
    { personId: danielId, name: daniel, sum: 12, results: 1, pendingCount: 0 },
  ]);

  // The app's today and Aktuell still ask exactly so, and show the answers.
  await expect(place(page, daniel)).toHaveAccessibleName(
    new RegExp(`^Platz \\d+, ${daniel}, 2 Punkte, 2 Getränke$`),
  );
  const aktuell = page.waitForRequest((request) => {
    const url = new URL(request.url());
    return (
      url.pathname === `/api/games/${String(gameId)}/standings` &&
      url.search === ''
    );
  });
  await page.goto(`/spiele/${String(gameId)}`);
  await aktuell;
  await expect(
    page.getByRole('listitem', { name: /^Platz 1, / }),
  ).toHaveAccessibleName(`Platz 1, ${daniel}, 12 Punkte, 1 Ergebnis`);
});
