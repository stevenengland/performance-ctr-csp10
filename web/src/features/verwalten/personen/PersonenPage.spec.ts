import type { VueWrapper } from '@vue/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Person } from '../../../core/api-client';
import { dismissSnackbar, useSnackbar } from '../../../core/snackbar';
import {
  buttonIn,
  catalogApi,
  click,
  dialog,
  field,
  mountPage,
  problem,
  rows,
  stubDialogEnvironment,
  type,
} from '../manage-page-harness';
import PersonenPage from './PersonenPage.vue';

const api = (persons: Person[], options?: Parameters<typeof catalogApi>[3]) =>
  catalogApi('/api/persons', 'persons', persons, options);
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
      { id: 1, name: 'Anna' },
      { id: 2, name: 'Daniel' },
    ]);

    wrapper = await page();

    expect(rows(wrapper)).toEqual(['Anna', 'Daniel']);
    expect(buttonIn(document, 'Daniel bearbeiten')).toBeTruthy();
    expect(buttonIn(document, 'Daniel löschen')).toBeTruthy();
  });

  it('opens a person’s Verlauf from their row', async () => {
    api([{ id: 2, name: 'Daniel' }]);

    wrapper = await page();

    const link = wrapper.get('a[aria-label="Verlauf von Daniel"]');
    expect(link.attributes('href')).toBe('/verlauf/2');
    expect(link.text()).toBe('Daniel');
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
    const calls = api([{ id: 2, name: 'Daniel' }]);
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

  it('shows a taken name under the name field', async () => {
    api(
      [
        { id: 1, name: 'Anna' },
        { id: 2, name: 'Daniel' },
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
    const calls = api([{ id: 2, name: 'Daniel' }], { entryCount: 23 });
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

  it('says only the person is deleted when there are no entries', async () => {
    api([{ id: 2, name: 'Daniel' }], { entryCount: 0 });
    wrapper = await page();

    await click(buttonIn(document, 'Daniel löschen'));

    expect(dialog().textContent).toContain('Daniel wird gelöscht.');
  });

  it('keeps the person when the dialog is cancelled', async () => {
    const calls = api([{ id: 2, name: 'Daniel' }]);
    wrapper = await page();

    await click(buttonIn(document, 'Daniel löschen'));
    await click(buttonIn(dialog(), 'Abbrechen'));

    expect(calls.some(({ method }) => method === 'DELETE')).toBe(false);
    expect(rows(wrapper)).toEqual(['Daniel']);
  });
});
