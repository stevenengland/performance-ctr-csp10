import type { VueWrapper } from '@vue/test-utils';
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
    const writes = (calls: Call[]) =>
      calls.filter(({ method }) => method !== 'GET');
    const dialogAvatar = () => dialog().querySelector('.person-avatar');
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
      expect(message?.previousElementSibling?.textContent.trim()).toBe(
        'Foto behalten',
      );
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
