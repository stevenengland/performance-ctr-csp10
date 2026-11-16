import {
  coloursAt,
  jpegSize,
  pickWith,
  PICTURES,
  UNDECODABLE_HEIC,
} from './support/photo.ts';
import { expect, test, type Page } from './support/playwright.ts';
import { signIn, uniqueName } from './support/session.ts';

/*
A person's photo on the stack, served with the rendered `.htaccess` and so under
the production CSP (the CSP guard fails any test that trips it): decoding and
encoding in a real browser, the framing from the keyboard, and the uploaded
photo shown from its versioned URL. Every test works with a person of its own
and deletes it at the end.
*/

const created: number[] = [];

async function personOf(page: Page) {
  const response = await page.request.post('/api/persons', {
    data: { name: uniqueName('Foto') },
  });
  expect(response.status()).toBe(201);
  const person = (await response.json()) as { id: number; name: string };
  created.push(person.id);
  return person;
}

/** Opens `Person bearbeiten` for a new person of this test. */
async function editNewPerson(page: Page) {
  const person = await personOf(page);
  await page.goto('/verwalten/personen');
  await page.getByRole('button', { name: `${person.name} bearbeiten` }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toContainText('Person bearbeiten');
  const row = page
    .getByRole('list', { name: 'Personen' })
    .getByRole('listitem')
    .filter({ hasText: person.name });
  return { dialog, row };
}

test.beforeEach(async ({ page }) => {
  await signIn(page);
});

test.afterEach(async ({ page }) => {
  for (const id of created) {
    await page.request.delete(`/api/persons/${String(id)}`);
  }
  created.length = 0;
});

test('a PNG is chosen, framed from the keyboard and saved as a 256 × 256 JPEG that shows under the production CSP', async ({
  page,
}) => {
  const { dialog, row } = await editNewPerson(page);

  await pickWith(
    page,
    dialog.getByRole('button', { name: 'Foto wählen' }),
    PICTURES.halves,
  );
  const crop = dialog.getByRole('img', { name: 'Ausschnitt des Fotos' });
  await expect(crop).toBeVisible();
  await expect(crop).toHaveAccessibleDescription(
    'Ziehen zum Verschieben · zoomen mit zwei Fingern oder dem Regler Pfeiltasten verschieben, Plus und Minus zoomen.',
  );
  // Centred, the frame shows the middle of the 2:1 picture: red, then blue.
  expect(
    await coloursAt(crop, [
      [0.3, 0.5],
      [0.7, 0.5],
    ]),
  ).toEqual(['red', 'blue']);

  // The canvas takes focus, and the zoom slider follows it.
  await crop.focus();
  await expect(crop).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(dialog.getByRole('slider', { name: 'Zoom' })).toBeFocused();

  // Ten steps right move the picture by 0.3 of the frame: more red shows.
  await crop.focus();
  for (let step = 0; step < 10; step += 1) {
    await page.keyboard.press('ArrowRight');
  }
  expect(
    await coloursAt(crop, [
      [0.7, 0.5],
      [0.9, 0.5],
    ]),
  ).toEqual(['red', 'blue']);

  const upload = page.waitForRequest(
    (request) => request.method() === 'PUT' && request.url().endsWith('/photo'),
  );
  await dialog.getByRole('button', { name: 'Speichern' }).click();
  const { image } = (await upload).postDataJSON() as { image: string };
  await expect(dialog).toBeHidden();

  const jpeg = Buffer.from(image, 'base64');
  expect([jpeg[0], jpeg[1]]).toEqual([0xff, 0xd8]);
  expect(jpeg.length).toBeLessThanOrEqual(64 * 1024);
  expect(jpegSize(jpeg)).toEqual({ width: 256, height: 256 });

  // The list shows the stored photo from its versioned URL, framed as it was.
  const photo = row.locator('.person-avatar img');
  await expect(photo).toHaveAttribute(
    'src',
    /\/api\/persons\/\d+\/photo\?v=[0-9a-f]{64}$/,
  );
  await expect
    .poll(() =>
      photo.evaluate(
        (img: HTMLImageElement) => img.complete && img.naturalWidth,
      ),
    )
    .toBe(256);
  expect(
    await coloursAt(photo, [
      [0.7, 0.5],
      [0.9, 0.5],
    ]),
  ).toEqual(['red', 'blue']);
});

test('a JPEG with EXIF orientation is framed upright', async ({ page }) => {
  const { dialog } = await editNewPerson(page);

  await dialog
    .locator('input[type="file"]')
    .setInputFiles(PICTURES.exifRotated);

  // Upright the stored left half (red) is on top.
  const crop = dialog.getByRole('img', { name: 'Ausschnitt des Fotos' });
  await expect(crop).toBeVisible();
  expect(
    await coloursAt(crop, [
      [0.25, 0.25],
      [0.75, 0.25],
      [0.25, 0.75],
      [0.75, 0.75],
    ]),
  ).toEqual(['red', 'red', 'blue', 'blue']);
});

test('a photo the browser cannot open is named under the photo and changes nothing', async ({
  page,
}) => {
  const { dialog } = await editNewPerson(page);

  await dialog.locator('input[type="file"]').setInputFiles(UNDECODABLE_HEIC);

  await expect(dialog.getByRole('alert')).toHaveText(
    'Dieses Foto lässt sich nicht öffnen.',
  );
  await expect(
    dialog.getByRole('img', { name: 'Ausschnitt des Fotos' }),
  ).toHaveCount(0);
  await expect(
    dialog.getByRole('button', { name: 'Foto wählen' }),
  ).toBeVisible();
});
