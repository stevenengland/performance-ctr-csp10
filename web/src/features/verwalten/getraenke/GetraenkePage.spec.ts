import type { VueWrapper } from '@vue/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Drink } from '../../../core/api-client';
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
import GetraenkePage from './GetraenkePage.vue';

const api = (drinks: Drink[], options?: Parameters<typeof catalogApi>[3]) =>
  catalogApi('/api/drinks', 'drinks', drinks, options);
const page = () => mountPage('/verwalten/getraenke', GetraenkePage);

describe('Verwalten → Getränke', () => {
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

  it('lists the drinks with their points, each with edit and delete', async () => {
    api([
      { id: 1, name: 'Bier', points: 1 },
      { id: 2, name: 'Radler', points: 0.5 },
    ]);

    wrapper = await page();

    expect(rows(wrapper)).toEqual(['Bier1 Punkt', 'Radler0,5 Punkte']);
    expect(buttonIn(document, 'Bier bearbeiten')).toBeTruthy();
    expect(buttonIn(document, 'Bier löschen')).toBeTruthy();
  });

  it('edits a drink’s name and points in a dialog that starts with its values', async () => {
    const calls = api([{ id: 1, name: 'Schnaps', points: 1.5 }]);
    wrapper = await page();

    await click(buttonIn(document, 'Schnaps bearbeiten'));
    expect(dialog().textContent).toContain('Getränk bearbeiten');
    expect(field('Name').value).toBe('Schnaps');
    expect(field('Punkte').value).toBe('1,5');
    await type('Name', 'Obstler');
    await type('Punkte', '2,25');
    await click(buttonIn(dialog(), 'Speichern'));

    expect(calls.find(({ method }) => method === 'PATCH')).toEqual({
      method: 'PATCH',
      url: '/api/drinks/1',
      body: { name: 'Obstler', points: 2.25 },
    });
    expect(rows(wrapper)).toEqual(['Obstler2,25 Punkte']);
  });

  it('shows the server’s field errors of an edit under their fields', async () => {
    api([{ id: 1, name: 'Bier', points: 1 }], {
      replies: [
        () =>
          problem(422, {
            title: 'Bitte Eingaben prüfen',
            errors: { points: 'Zahl von 0 bis 9.999,99.' },
          }),
      ],
    });
    wrapper = await page();

    await click(buttonIn(document, 'Bier bearbeiten'));
    await type('Punkte', '10000');
    await click(buttonIn(dialog(), 'Speichern'));

    expect(dialog().textContent).toContain('Zahl von 0 bis 9.999,99.');
  });

  it('deletes a drink after a dialog that names the entries deleted with it', async () => {
    const calls = api([{ id: 1, name: 'Bier', points: 1 }], {
      entryCount: 12,
    });
    wrapper = await page();

    await click(buttonIn(document, 'Bier löschen'));
    expect(dialog().textContent).toContain('Bier löschen?');
    expect(dialog().textContent).toContain(
      'Bier und 12 Einträge werden gelöscht.',
    );
    await click(buttonIn(dialog(), 'Löschen'));

    expect(calls.find(({ method }) => method === 'DELETE')?.url).toBe(
      '/api/drinks/1',
    );
    expect(useSnackbar().value?.text).toBe('Bier gelöscht');
    expect(rows(wrapper)).toEqual([]);
  });

  it('names one entry in the singular', async () => {
    api([{ id: 1, name: 'Bier', points: 1 }], { entryCount: 1 });
    wrapper = await page();

    await click(buttonIn(document, 'Bier löschen'));

    expect(dialog().textContent).toContain(
      'Bier und 1 Eintrag werden gelöscht.',
    );
  });

  it('shows the problem title when the drink is already gone', async () => {
    api([{ id: 1, name: 'Bier', points: 1 }], {
      replies: [
        () =>
          problem(404, {
            type: 'urn:performance:problem:not-found',
            title: 'Nicht gefunden',
          }),
      ],
    });
    wrapper = await page();

    await click(buttonIn(document, 'Bier löschen'));

    expect(document.querySelector('[role="dialog"]')).toBeNull();
    expect(useSnackbar().value?.text).toBe('Nicht gefunden');
  });
});
