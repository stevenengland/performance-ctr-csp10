import { flushPromises, type VueWrapper } from '@vue/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Person } from '../../../core/api-client';
import { dismissSnackbar, useSnackbar } from '../../../core/snackbar';
import {
  buttonIn,
  catalogApi,
  type Call,
  click,
  dialog,
  field,
  json,
  mountPage,
  problem,
  rows,
  stubDialogEnvironment,
  type,
} from '../manage-page-harness';
import PersonenPage from './PersonenPage.vue';

const api = (
  persons: Person[],
  options?: Parameters<typeof catalogApi<Person>>[3],
) =>
  catalogApi('/api/persons', 'persons', persons, {
    created: { photoUrl: null },
    ...options,
  });
const page = () => mountPage('/verwalten/personen', PersonenPage);

/** What the stubbed canvas encodes: SOI and EOI. */
const JPEG = '/9j/2Q==';
const writes = (calls: Call[]) =>
  calls.filter(({ method }) => method !== 'GET');
const crop = () =>
  dialog().querySelector('canvas[aria-label="Ausschnitt des Fotos"]');
const dialogAvatar = () => dialog().querySelector('.person-avatar');
const alert = () =>
  dialog().querySelector('[role="alert"]')?.textContent.trim();
const fileInput = () => {
  const input = dialog().querySelector('input[type="file"]');
  if (!(input instanceof HTMLInputElement)) throw new Error('no picker');
  return input;
};

/**
jsdom decodes and draws nothing: every file but a `.heic` decodes to a
400 × 300 picture (scaled as asked), and a canvas encodes a tiny JPEG.
*/
function stubPhotoBrowser() {
  const decoded: { close: () => void }[] = [];
  vi.stubGlobal(
    'createImageBitmap',
    vi.fn((file: File, options: ImageBitmapOptions = {}) => {
      if (file.name.endsWith('.heic')) {
        return Promise.reject(new DOMException('no', 'InvalidStateError'));
      }
      const width = options.resizeWidth ?? 400;
      const picture = { width, height: (width * 3) / 4, close: vi.fn() };
      decoded.push(picture);
      return Promise.resolve(picture);
    }),
  );
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
    fillStyle: '',
    imageSmoothingQuality: 'low',
    fillRect: vi.fn(),
    drawImage: vi.fn(),
  } as unknown as CanvasRenderingContext2D);
  vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation(
    (done) => {
      done(
        new Blob([new Uint8Array([0xff, 0xd8, 0xff, 0xd9])], {
          type: 'image/jpeg',
        }),
      );
    },
  );
  HTMLCanvasElement.prototype.setPointerCapture = vi.fn();
  return decoded;
}

/** Picks a file in the platform's picker. */
async function choose(name = 'photo.jpg') {
  const input = fileInput();
  Object.defineProperty(input, 'files', {
    value: [new File(['photo'], name)],
    configurable: true,
  });
  input.dispatchEvent(new Event('change'));
  await flushPromises();
}

describe('Verwalten → Personen', () => {
  let wrapper: VueWrapper | undefined;

  beforeEach(() => {
    dismissSnackbar();
    stubDialogEnvironment();
  });
  afterEach(() => {
    wrapper?.unmount();
    document.body.innerHTML = '';
    vi.unstubAllGlobals();
  });

  it('lists the persons as the API sends them, each with edit and delete', async () => {
    api([
      { id: 1, name: 'Anna', photoUrl: null },
      { id: 2, name: 'Daniel', photoUrl: null },
    ]);

    wrapper = await page();

    expect(rows(wrapper)).toEqual(['Anna', 'Daniel']);
    expect(buttonIn(document, 'Daniel bearbeiten')).toBeTruthy();
    expect(buttonIn(document, 'Daniel löschen')).toBeTruthy();
  });

  it('opens a person’s Verlauf from their row', async () => {
    api([{ id: 2, name: 'Daniel', photoUrl: null }]);

    wrapper = await page();

    const link = wrapper.get('a[aria-label="Verlauf von Daniel"]');
    expect(link.attributes('href')).toBe('/verlauf/2');
    expect(link.text()).toBe('Daniel');
  });

  it('shows each person’s avatar left of the name: the photo, or the initials', async () => {
    api([
      { id: 1, name: 'Anna Lena', photoUrl: null },
      { id: 2, name: 'Daniel', photoUrl: '/api/persons/2/photo?v=abc' },
    ]);

    wrapper = await page();

    const [anna, daniel] = wrapper.findAll('.list__main');
    expect(anna?.get('.person-avatar').attributes('style')).toContain(
      'width: 40px',
    );
    expect(anna?.get('[data-initials]').attributes('data-initials')).toBe('AL');
    expect(daniel?.get('img').attributes('src')).toBe(
      '/api/persons/2/photo?v=abc',
    );
    expect(
      daniel?.element.firstElementChild?.classList.contains('person-avatar'),
    ).toBe(true);
  });

  it('shows the initials when a photo fails to load', async () => {
    api([{ id: 2, name: 'Daniel', photoUrl: '/api/persons/2/photo?v=abc' }]);
    wrapper = await page();

    await wrapper.get('.list__main img').trigger('error');

    expect(wrapper.find('.list__main img').exists()).toBe(false);
    expect(wrapper.get('[data-initials]').attributes('data-initials')).toBe(
      'D',
    );
  });

  it('keeps the row text and the Verlauf link name with an avatar, which is hidden', async () => {
    api([
      { id: 1, name: 'Anna Lena', photoUrl: null },
      { id: 2, name: 'Daniel', photoUrl: '/api/persons/2/photo?v=abc' },
    ]);

    wrapper = await page();

    expect(rows(wrapper)).toEqual(['Anna Lena', 'Daniel']);
    const link = wrapper.get('a[aria-label="Verlauf von Daniel"]');
    expect(link.text()).toBe('Daniel');
    expect(link.get('.person-avatar').attributes('aria-hidden')).toBe('true');
  });

  it('creates a person', async () => {
    const calls = api([]);
    wrapper = await page();

    await click(buttonIn(document, 'Person anlegen'));
    expect(dialog().textContent).toContain('Person anlegen');
    await type('Name', 'Jule');
    await click(buttonIn(dialog(), 'Speichern'));

    expect(calls.find(({ method }) => method === 'POST')?.body).toEqual({
      name: 'Jule',
    });
    expect(rows(wrapper)).toEqual(['Jule']);
  });

  it('renames a person in a dialog that starts with the name', async () => {
    const calls = api([{ id: 2, name: 'Daniel', photoUrl: null }]);
    wrapper = await page();

    await click(buttonIn(document, 'Daniel bearbeiten'));
    expect(dialog().textContent).toContain('Person bearbeiten');
    expect(field('Name').value).toBe('Daniel');
    await type('Name', 'Dani');
    await click(buttonIn(dialog(), 'Speichern'));

    expect(calls.find(({ method }) => method === 'PATCH')).toEqual({
      method: 'PATCH',
      url: '/api/persons/2',
      body: { name: 'Dani' },
    });
    expect(rows(wrapper)).toEqual(['Dani']);
  });

  describe('the photo in Person bearbeiten', () => {
    const photoUrl = '/api/persons/2/photo?v=abc';
    const listAvatar = (wrapper: VueWrapper) =>
      wrapper.get('.list__main .person-avatar');

    it('shows the person’s avatar at 112 px', async () => {
      api([{ id: 2, name: 'Daniel', photoUrl }]);
      wrapper = await page();

      await click(buttonIn(document, 'Daniel bearbeiten'));

      expect(dialogAvatar()?.getAttribute('style')).toContain('width: 112px');
      expect(dialogAvatar()?.querySelector('img')?.getAttribute('src')).toBe(
        photoUrl,
      );
    });

    it('shows the initials after Foto entfernen and the photo again after Foto behalten', async () => {
      api([{ id: 2, name: 'Daniel', photoUrl }]);
      wrapper = await page();
      await click(buttonIn(document, 'Daniel bearbeiten'));

      await click(buttonIn(dialog(), 'Foto entfernen'));

      expect(dialogAvatar()?.querySelector('img')).toBeNull();
      expect(
        dialogAvatar()
          ?.querySelector('[data-initials]')
          ?.getAttribute('data-initials'),
      ).toBe('D');
      expect(() => buttonIn(dialog(), 'Foto entfernen')).toThrow();

      await click(buttonIn(dialog(), 'Foto behalten'));

      expect(dialogAvatar()?.querySelector('img')?.getAttribute('src')).toBe(
        photoUrl,
      );
      expect(() => buttonIn(dialog(), 'Foto behalten')).toThrow();
    });

    it('offers no removal without a photo', async () => {
      api([{ id: 2, name: 'Daniel', photoUrl: null }]);
      wrapper = await page();

      await click(buttonIn(document, 'Daniel bearbeiten'));

      expect(dialogAvatar()?.querySelector('[data-initials]')).toBeTruthy();
      expect(() => buttonIn(dialog(), 'Foto entfernen')).toThrow();
    });

    it('removes the photo with Speichern, sending no name request, and the list shows the initials', async () => {
      const calls = api([{ id: 2, name: 'Daniel', photoUrl }]);
      wrapper = await page();
      await click(buttonIn(document, 'Daniel bearbeiten'));

      await click(buttonIn(dialog(), 'Foto entfernen'));
      await click(buttonIn(dialog(), 'Speichern'));

      expect(writes(calls)).toEqual([
        { method: 'DELETE', url: '/api/persons/2/photo', body: {} },
      ]);
      expect(listAvatar(wrapper).find('img').exists()).toBe(false);
      expect(
        listAvatar(wrapper).get('[data-initials]').attributes('data-initials'),
      ).toBe('D');
    });

    it('sends nothing on Abbrechen after Foto entfernen', async () => {
      const calls = api([{ id: 2, name: 'Daniel', photoUrl }]);
      wrapper = await page();
      await click(buttonIn(document, 'Daniel bearbeiten'));

      await click(buttonIn(dialog(), 'Foto entfernen'));
      await click(buttonIn(dialog(), 'Abbrechen'));

      expect(writes(calls)).toEqual([]);
      expect(listAvatar(wrapper).get('img').attributes('src')).toBe(photoUrl);
    });

    it('renames first and removes the photo second', async () => {
      const calls = api([{ id: 2, name: 'Daniel', photoUrl }]);
      wrapper = await page();
      await click(buttonIn(document, 'Daniel bearbeiten'));

      await type('Name', 'Dani');
      await click(buttonIn(dialog(), 'Foto entfernen'));
      await click(buttonIn(dialog(), 'Speichern'));

      expect(
        writes(calls).map(({ method, url }) => `${method} ${url}`),
      ).toEqual(['PATCH /api/persons/2', 'DELETE /api/persons/2/photo']);
      expect(rows(wrapper)).toEqual(['Dani']);
    });

    it('closes as saved and shows the change when only the reload of the list fails', async () => {
      api([{ id: 2, name: 'Daniel', photoUrl }], {
        lists: [
          undefined,
          () =>
            problem(503, {
              type: 'urn:performance:problem:maintenance',
              title: 'Wartung läuft.',
            }),
        ],
      });
      wrapper = await page();
      await click(buttonIn(document, 'Daniel bearbeiten'));

      await type('Name', 'Dani');
      await click(buttonIn(dialog(), 'Foto entfernen'));
      await click(buttonIn(dialog(), 'Speichern'));

      expect(document.querySelector('.v-overlay--active')).toBeNull();
      expect(rows(wrapper)).toEqual(['Dani']);
      expect(listAvatar(wrapper).find('img').exists()).toBe(false);
      expect(useSnackbar().value?.text).toBe('Wartung läuft.');
    });

    it('stays on the renamed person when the removal fails, and Speichern again sends only the removal', async () => {
      const calls = api([{ id: 2, name: 'Daniel', photoUrl }], {
        replies: [
          undefined,
          () =>
            problem(503, {
              type: 'urn:performance:problem:maintenance',
              title: 'Wartung läuft.',
            }),
        ],
      });
      wrapper = await page();
      await click(buttonIn(document, 'Daniel bearbeiten'));
      await type('Name', 'Dani');
      await click(buttonIn(dialog(), 'Foto entfernen'));

      await click(buttonIn(dialog(), 'Speichern'));

      expect(document.querySelector('.v-overlay--active')).not.toBeNull();
      const message = dialog().querySelector('[role="alert"]');
      expect(message?.textContent.trim()).toBe(
        'Person gespeichert, Foto nicht.',
      );
      // Under the photo's buttons, which still offer to keep the photo.
      expect(
        message?.previousElementSibling?.contains(
          buttonIn(dialog(), 'Foto behalten'),
        ),
      ).toBe(true);
      expect(rows(wrapper)).toEqual(['Dani']);
      calls.length = 0;

      await click(buttonIn(dialog(), 'Speichern'));

      expect(writes(calls)).toEqual([
        { method: 'DELETE', url: '/api/persons/2/photo', body: {} },
      ]);
      expect(document.querySelector('.v-overlay--active')).toBeNull();
      expect(listAvatar(wrapper).find('img').exists()).toBe(false);
    });
  });

  describe('a new photo in Person bearbeiten', () => {
    const photoUrl = '/api/persons/2/photo?v=abc';
    let pictures: { close: () => void }[];
    async function editDaniel(photo: string | null, options = {}) {
      const calls = api([{ id: 2, name: 'Daniel', photoUrl: photo }], options);
      wrapper = await page();
      await click(buttonIn(document, 'Daniel bearbeiten'));
      return calls;
    }

    beforeEach(() => {
      pictures = stubPhotoBrowser();
    });
    afterEach(() => {
      vi.restoreAllMocks();
    });

    it('opens the platform’s picker for images: Foto wählen without a photo', async () => {
      await editDaniel(null);
      const open = vi.spyOn(fileInput(), 'click');

      await click(buttonIn(dialog(), 'Foto wählen'));

      expect(open).toHaveBeenCalled();
      expect(fileInput().accept).toBe('image/*');
      expect(fileInput().hasAttribute('capture')).toBe(false);
    });

    it('offers Foto ändern when the person has a photo', async () => {
      await editDaniel(photoUrl);

      expect(buttonIn(dialog(), 'Foto ändern')).toBeTruthy();
    });

    it('frames a chosen photo in the round frame and uploads it with Speichern; the list then shows it', async () => {
      const calls = await editDaniel(null);

      await choose();

      expect(crop()).not.toBeNull();
      expect(dialogAvatar()).toBeNull();
      expect(buttonIn(dialog(), 'Anderes Foto')).toBeTruthy();
      expect(buttonIn(dialog(), 'Foto entfernen')).toBeTruthy();

      await click(buttonIn(dialog(), 'Speichern'));

      expect(writes(calls)).toEqual([
        { method: 'PUT', url: '/api/persons/2/photo', body: { image: JPEG } },
      ]);
      expect(document.querySelector('.v-overlay--active')).toBeNull();
      expect(wrapper?.get('.list__main img').attributes('src')).toBe(
        '/api/persons/2/photo?v=1',
      );
      for (const picture of pictures) expect(picture.close).toHaveBeenCalled();
    });

    it('says a file it cannot open under the photo and keeps the current photo', async () => {
      await editDaniel(photoUrl);

      await choose('photo.heic');

      expect(alert()).toBe('Dieses Foto lässt sich nicht öffnen.');
      expect(crop()).toBeNull();
      expect(dialogAvatar()?.querySelector('img')?.getAttribute('src')).toBe(
        photoUrl,
      );
    });

    it('keeps the framed photo when the next file cannot be opened', async () => {
      await editDaniel(null);
      await choose();

      await choose('photo.heic');

      expect(alert()).toBe('Dieses Foto lässt sich nicht öffnen.');
      expect(crop()).not.toBeNull();
    });

    it.each([
      [
        422,
        {
          title: 'Eingaben ungültig.',
          errors: {
            image: 'Kein gültiges Foto (JPEG, 256 × 256, höchstens 64 KB).',
          },
        },
        'Kein gültiges Foto (JPEG, 256 × 256, höchstens 64 KB).',
      ],
      [413, { title: 'Foto zu groß.' }, 'Foto zu groß.'],
    ])(
      'shows a %i on the photo under it and keeps the framed photo',
      async (status, body, message) => {
        await editDaniel(null, { replies: [() => problem(status, body)] });
        await choose();

        await click(buttonIn(dialog(), 'Speichern'));

        expect(document.querySelector('.v-overlay--active')).not.toBeNull();
        expect(alert()).toBe(message);
        expect(crop()).not.toBeNull();
        expect(useSnackbar().value).toBeUndefined();
      },
    );

    it('freezes the photo controls and the framing while saving', async () => {
      let answer!: (response: Response) => void;
      await editDaniel(null, {
        replies: [() => new Promise<Response>((done) => (answer = done))],
      });
      await choose();

      await click(buttonIn(dialog(), 'Speichern'));

      for (const name of ['Anderes Foto', 'Foto entfernen']) {
        expect(buttonIn(dialog(), name).disabled).toBe(true);
      }
      expect(crop()?.getAttribute('aria-disabled')).toBe('true');
      expect(
        dialog().querySelector('[role="slider"]')?.getAttribute('tabindex'),
      ).toBe('-1');

      answer(json({ id: 2, name: 'Daniel', photoUrl: '/p?v=1' }));
      await flushPromises();
      expect(document.querySelector('.v-overlay--active')).toBeNull();
    });

    it('closes the chosen photo’s picture on Abbrechen and sends nothing', async () => {
      const calls = await editDaniel(null);
      await choose();

      await click(buttonIn(dialog(), 'Abbrechen'));

      expect(writes(calls)).toEqual([]);
      expect(pictures.length).toBeGreaterThan(0);
      for (const picture of pictures) expect(picture.close).toHaveBeenCalled();
    });

    it('closes the chosen photo’s picture when the screen closes', async () => {
      await editDaniel(null);
      await choose();

      wrapper?.unmount();
      wrapper = undefined;

      for (const picture of pictures) expect(picture.close).toHaveBeenCalled();
    });

    it('drops a chosen photo with Foto entfernen, and removes the current one', async () => {
      const calls = await editDaniel(photoUrl);
      await choose();

      await click(buttonIn(dialog(), 'Foto entfernen'));

      expect(crop()).toBeNull();
      expect(dialogAvatar()?.querySelector('[data-initials]')).not.toBeNull();
      expect(buttonIn(dialog(), 'Foto behalten')).toBeTruthy();
      for (const picture of pictures) expect(picture.close).toHaveBeenCalled();

      await click(buttonIn(dialog(), 'Speichern'));

      expect(writes(calls)).toEqual([
        { method: 'DELETE', url: '/api/persons/2/photo', body: {} },
      ]);
    });

    it('drops a chosen photo with Foto entfernen back to the initials when there was none', async () => {
      await editDaniel(null);
      await choose();

      await click(buttonIn(dialog(), 'Foto entfernen'));

      expect(crop()).toBeNull();
      expect(() => buttonIn(dialog(), 'Foto behalten')).toThrow();
      expect(buttonIn(dialog(), 'Foto wählen')).toBeTruthy();
    });
  });

  describe('a photo in Person anlegen', () => {
    const maintenance = () =>
      problem(503, {
        type: 'urn:performance:problem:maintenance',
        title: 'Wartung läuft.',
      });
    const title = () => dialog().querySelector('h2')?.textContent;

    async function createJule(options = {}) {
      const calls = api([{ id: 2, name: 'Daniel', photoUrl: null }], options);
      wrapper = await page();
      await click(buttonIn(document, 'Person anlegen'));
      await type('Name', 'Jule');
      await choose();
      return calls;
    }

    beforeEach(() => {
      stubPhotoBrowser();
    });
    afterEach(() => {
      vi.restoreAllMocks();
    });

    it('shows the initials of the typed name at 112 px and offers Foto wählen', async () => {
      api([]);
      wrapper = await page();

      await click(buttonIn(document, 'Person anlegen'));
      await type('Name', 'Jule Berg');

      expect(dialogAvatar()?.getAttribute('style')).toContain('width: 112px');
      expect(
        dialogAvatar()
          ?.querySelector('[data-initials]')
          ?.getAttribute('data-initials'),
      ).toBe('JB');
      expect(buttonIn(dialog(), 'Foto wählen')).toBeTruthy();
      expect(() => buttonIn(dialog(), 'Foto entfernen')).toThrow();
    });

    it('encodes the framed photo before any request, then creates the person, then uploads the photo; the list shows it', async () => {
      const sentBeforeEncoding: number[] = [];
      let calls: Call[] = [];
      vi.mocked(HTMLCanvasElement.prototype.toBlob).mockImplementation(
        (done) => {
          sentBeforeEncoding.push(writes(calls).length);
          done(
            new Blob([new Uint8Array([0xff, 0xd8, 0xff, 0xd9])], {
              type: 'image/jpeg',
            }),
          );
        },
      );
      calls = await createJule();

      await click(buttonIn(dialog(), 'Speichern'));

      expect(sentBeforeEncoding).toEqual([0]);
      expect(writes(calls)).toEqual([
        { method: 'POST', url: '/api/persons', body: { name: 'Jule' } },
        { method: 'PUT', url: '/api/persons/9/photo', body: { image: JPEG } },
      ]);
      expect(document.querySelector('.v-overlay--active')).toBeNull();
      expect(rows(wrapper)).toEqual(['Daniel', 'Jule']);
      expect(wrapper?.get('.list__main img').attributes('src')).toBe(
        '/api/persons/9/photo?v=1',
      );
    });

    it('stays on the created person when the upload fails, and Speichern again sends only the upload', async () => {
      const calls = await createJule({
        replies: [undefined, maintenance],
      });

      await click(buttonIn(dialog(), 'Speichern'));

      expect(document.querySelector('.v-overlay--active')).not.toBeNull();
      expect(alert()).toBe('Person gespeichert, Foto nicht.');
      expect(title()).toBe('Person bearbeiten');
      expect(crop()).not.toBeNull();
      expect(rows(wrapper)).toEqual(['Daniel', 'Jule']);
      calls.length = 0;

      await click(buttonIn(dialog(), 'Speichern'));

      expect(writes(calls)).toEqual([
        { method: 'PUT', url: '/api/persons/9/photo', body: { image: JPEG } },
      ]);
      expect(document.querySelector('.v-overlay--active')).toBeNull();
      expect(wrapper?.get('.list__main img').attributes('src')).toBe(
        '/api/persons/9/photo?v=1',
      );
    });

    it('keeps the created person’s id and counts the save when only the reload of the list fails', async () => {
      const calls = await createJule({ lists: [undefined, maintenance] });

      await click(buttonIn(dialog(), 'Speichern'));

      expect(document.querySelector('.v-overlay--active')).toBeNull();
      expect(rows(wrapper)).toEqual(['Daniel', 'Jule']);
      expect(useSnackbar().value?.text).toBe('Wartung läuft.');
      calls.length = 0;

      await click(buttonIn(document, 'Jule bearbeiten'));
      await type('Name', 'Julia');
      await click(buttonIn(dialog(), 'Speichern'));

      expect(writes(calls)).toEqual([
        { method: 'PATCH', url: '/api/persons/9', body: { name: 'Julia' } },
      ]);
    });

    it('sends nothing and says so under the photo when the photo cannot be encoded', async () => {
      const calls = await createJule();
      vi.mocked(HTMLCanvasElement.prototype.toBlob).mockImplementation(
        (done) => {
          done(null);
        },
      );

      await click(buttonIn(dialog(), 'Speichern'));

      expect(writes(calls)).toEqual([]);
      expect(alert()).toBe('Dieses Foto lässt sich nicht öffnen.');
      expect(title()).toBe('Person anlegen');
      expect(crop()).not.toBeNull();
      expect(useSnackbar().value).toBeUndefined();
    });

    it('closes on Abbrechen after a partial save and keeps the created person', async () => {
      const calls = await createJule({
        replies: [undefined, maintenance],
      });
      await click(buttonIn(dialog(), 'Speichern'));
      calls.length = 0;

      await click(buttonIn(dialog(), 'Abbrechen'));

      expect(document.querySelector('.v-overlay--active')).toBeNull();
      expect(writes(calls)).toEqual([]);
      expect(rows(wrapper)).toEqual(['Daniel', 'Jule']);

      await click(buttonIn(document, 'Person anlegen'));

      expect(title()).toBe('Person anlegen');
      expect(field('Name').value).toBe('');
      expect(crop()).toBeNull();
    });
  });

  it('shows a taken name under the name field', async () => {
    api(
      [
        { id: 1, name: 'Anna', photoUrl: null },
        { id: 2, name: 'Daniel', photoUrl: null },
      ],
      {
        replies: [
          () =>
            problem(409, {
              type: 'urn:performance:problem:duplicate-name',
              title: 'Name ist bereits vergeben.',
            }),
        ],
      },
    );
    wrapper = await page();

    await click(buttonIn(document, 'Daniel bearbeiten'));
    await type('Name', 'anna');
    await click(buttonIn(dialog(), 'Speichern'));

    expect(dialog().textContent).toContain('Name ist bereits vergeben.');
  });

  it('deletes a person after a dialog that names the entries deleted with them', async () => {
    const calls = api([{ id: 2, name: 'Daniel', photoUrl: null }], {
      entryCount: 23,
    });
    wrapper = await page();

    await click(buttonIn(document, 'Daniel löschen'));
    expect(calls.at(-1)).toMatchObject({
      method: 'GET',
      url: '/api/persons/2',
    });
    expect(dialog().textContent).toContain('Daniel löschen?');
    expect(dialog().textContent).toContain(
      'Daniel und 23 Einträge werden gelöscht.',
    );
    await click(buttonIn(dialog(), 'Löschen'));

    expect(calls.some(({ method }) => method === 'DELETE')).toBe(true);
    expect(useSnackbar().value?.text).toBe('Daniel gelöscht');
    expect(rows(wrapper)).toEqual([]);
  });

  it('states the matches that stay with “gelöschte Person” in the delete dialog', async () => {
    api([{ id: 2, name: 'Daniel', photoUrl: null }], {
      replies: [
        () =>
          json({
            id: 2,
            name: 'Daniel',
            photoUrl: null,
            entryCount: 23,
            matchCount: 4,
          }),
      ],
    });
    wrapper = await page();

    await click(buttonIn(document, 'Daniel löschen'));

    expect(dialog().textContent).toContain(
      'Daniel und 23 Einträge werden gelöscht. 4 Partien bleiben mit „gelöschte Person“.',
    );
  });

  it('names the results that go with the person in the delete dialog', async () => {
    api([{ id: 2, name: 'Daniel', photoUrl: null }], {
      replies: [
        () =>
          json({
            id: 2,
            name: 'Daniel',
            photoUrl: null,
            entryCount: 23,
            matchCount: 0,
            resultCount: 7,
          }),
      ],
    });
    wrapper = await page();

    await click(buttonIn(document, 'Daniel löschen'));

    expect(dialog().textContent).toContain(
      'Daniel, 23 Einträge und 7 Ergebnisse werden gelöscht.',
    );
  });

  it.each([
    [0, 1, 0, 'Daniel wird gelöscht. 1 Partie bleibt mit „gelöschte Person“.'],
    [1, 0, 0, 'Daniel und 1 Eintrag werden gelöscht.'],
    [0, 0, 1, 'Daniel und 1 Ergebnis werden gelöscht.'],
    [
      1,
      2,
      2,
      'Daniel, 1 Eintrag und 2 Ergebnisse werden gelöscht. 2 Partien bleiben mit „gelöschte Person“.',
    ],
  ])(
    'names %i entries, %i matches and %i results in the delete dialog',
    async (entryCount, matchCount, resultCount, body) => {
      api([{ id: 2, name: 'Daniel', photoUrl: null }], {
        replies: [
          () =>
            json({
              id: 2,
              name: 'Daniel',
              photoUrl: null,
              entryCount,
              matchCount,
              resultCount,
            }),
        ],
      });
      wrapper = await page();

      await click(buttonIn(document, 'Daniel löschen'));

      expect(dialog().textContent).toContain(body);
    },
  );

  it('says only the person is deleted when there are no entries', async () => {
    api([{ id: 2, name: 'Daniel', photoUrl: null }], { entryCount: 0 });
    wrapper = await page();

    await click(buttonIn(document, 'Daniel löschen'));

    expect(dialog().textContent).toContain('Daniel wird gelöscht.');
  });

  it('keeps the person when the dialog is cancelled', async () => {
    const calls = api([{ id: 2, name: 'Daniel', photoUrl: null }]);
    wrapper = await page();

    await click(buttonIn(document, 'Daniel löschen'));
    await click(buttonIn(dialog(), 'Abbrechen'));

    expect(calls.some(({ method }) => method === 'DELETE')).toBe(false);
    expect(rows(wrapper)).toEqual(['Daniel']);
  });
});
