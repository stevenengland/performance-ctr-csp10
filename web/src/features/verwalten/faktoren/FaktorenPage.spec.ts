import type { VueWrapper } from '@vue/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Factor } from '../../../core/api-client';
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
import FaktorenPage from './FaktorenPage.vue';

const api = (factors: Factor[], ...replies: (() => Response)[]) =>
  catalogApi('/api/factors', 'factors', factors, { replies });
const page = () => mountPage('/verwalten/faktoren', FaktorenPage);

describe('Verwalten → Faktoren', () => {
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

  it('lists the factors with their multiplier, as the API sends them', async () => {
    api([
      { id: 2, name: 'Geburtstag', multiplier: 1.5 },
      { id: 1, name: 'Happy Hour', multiplier: 2 },
    ]);

    wrapper = await page();

    expect(rows(wrapper)).toEqual(['Geburtstag×1,5', 'Happy Hour×2']);
  });

  it('creates a factor with a decimal comma in the multiplier', async () => {
    const calls = api([]);
    wrapper = await page();

    await click(buttonIn(document, 'Faktor anlegen'));
    await type('Name', 'Geburtstag');
    await type('Multiplikator', '1,5');
    await click(buttonIn(dialog(), 'Speichern'));

    expect(calls.find(({ method }) => method === 'POST')?.body).toEqual({
      name: 'Geburtstag',
      multiplier: 1.5,
    });
    expect(rows(wrapper)).toEqual(['Geburtstag×1,5']);
  });

  it('shows the server’s field errors under their fields', async () => {
    api([], () =>
      problem(422, {
        title: 'Bitte Eingaben prüfen',
        errors: { multiplier: 'Zahl über 0 bis 99,99.' },
      }),
    );
    wrapper = await page();

    await click(buttonIn(document, 'Faktor anlegen'));
    await type('Name', 'Happy Hour');
    await type('Multiplikator', '0');
    await click(buttonIn(dialog(), 'Speichern'));

    expect(dialog().textContent).toContain('Zahl über 0 bis 99,99.');
  });

  it('edits a factor in a dialog that starts with its values', async () => {
    const calls = api([{ id: 1, name: 'Happy Hour', multiplier: 2 }]);
    wrapper = await page();

    await click(buttonIn(document, 'Happy Hour bearbeiten'));
    expect(field('Name').value).toBe('Happy Hour');
    expect(field('Multiplikator').value).toBe('2');
    await type('Multiplikator', '2,5');
    await click(buttonIn(dialog(), 'Speichern'));

    expect(calls.find(({ method }) => method === 'PATCH')).toEqual({
      method: 'PATCH',
      url: '/api/factors/1',
      body: { name: 'Happy Hour', multiplier: 2.5 },
    });
  });

  it('deletes a factor after a dialog that says its entries then count ×1', async () => {
    const calls = api([{ id: 1, name: 'Happy Hour', multiplier: 2 }]);
    wrapper = await page();

    await click(buttonIn(document, 'Happy Hour löschen'));
    expect(dialog().textContent).toContain('Happy Hour löschen?');
    expect(dialog().textContent).toContain('5 Einträge zählen danach ×1.');
    await click(buttonIn(dialog(), 'Löschen'));

    expect(calls.some(({ method }) => method === 'DELETE')).toBe(true);
    expect(useSnackbar().value?.text).toBe('Happy Hour gelöscht');
    expect(rows(wrapper)).toEqual([]);
  });
});
