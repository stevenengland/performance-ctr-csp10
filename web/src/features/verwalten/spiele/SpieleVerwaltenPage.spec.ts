import type { VueWrapper } from '@vue/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Game } from '../../../core/api-client';
import { dismissSnackbar, useSnackbar } from '../../../core/snackbar';
import {
  buttonIn,
  catalogApi,
  click,
  dialog,
  json,
  mountPage,
  rows,
  stubDialogEnvironment,
} from '../manage-page-harness';
import SpieleVerwaltenPage from './SpieleVerwaltenPage.vue';

const STARTED = '2026-11-01T00:00:00.000Z';
const game = (
  id: number,
  name: string,
  kind: Game['kind'],
  { drawsAllowed = true, lowerWins = false } = {},
): Game => ({ id, name, kind, drawsAllowed, lowerWins, startedAt: STARTED });

const api = (games: Game[], ...replies: (() => Response)[]) =>
  catalogApi('/api/games', 'games', games, { replies });
const page = (path = '/verwalten/spiele') =>
  mountPage(path, SpieleVerwaltenPage);

describe('Verwalten → Spiele', () => {
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

  it('lists the games as the API sends them (alphabetically), each with its kind and setting', async () => {
    api([
      game(3, 'Kniffel', 'points'),
      game(1, 'Rommé', 'points', { lowerWins: true }),
      game(2, 'Schach', 'duel'),
      game(4, 'Tischtennis', 'duel', { drawsAllowed: false }),
    ]);

    wrapper = await page();

    expect(rows(wrapper)).toEqual([
      'KniffelPunktespiel · Höchste Summe gewinnt',
      'RomméPunktespiel · Niedrigste Summe gewinnt',
      'SchachDuell · Remis möglich',
      'TischtennisDuell · kein Remis',
    ]);
  });

  it('says so when there are no games yet', async () => {
    api([]);

    wrapper = await page();

    expect(wrapper.text()).toContain('Noch keine Spiele.');
  });

  it('deletes a game after a dialog that names it and what goes with it', async () => {
    const schach = game(1, 'Schach', 'duel');
    const calls = api([schach], () =>
      json({ ...schach, matchCount: 9, resultCount: 0 }),
    );
    wrapper = await page();

    await click(buttonIn(document, 'Schach löschen'));
    expect(dialog().textContent).toContain('Schach löschen?');
    expect(dialog().textContent).toContain(
      'Schach und 9 Partien werden gelöscht.',
    );
    await click(buttonIn(dialog(), 'Löschen'));

    expect(calls).toContainEqual(
      expect.objectContaining({ method: 'DELETE', url: '/api/games/1' }),
    );
    expect(useSnackbar().value?.text).toBe('Schach gelöscht');
    expect(rows(wrapper)).toEqual([]);
  });

  it('counts the results that go with a points game in its delete dialog', async () => {
    const romme = game(2, 'Rommé', 'points');
    api([romme], () => json({ ...romme, matchCount: 0, resultCount: 8 }));
    wrapper = await page();

    await click(buttonIn(document, 'Rommé löschen'));

    expect(dialog().textContent).toContain(
      'Rommé und 8 Ergebnisse werden gelöscht.',
    );
  });

  it('opens the create dialog when asked to with ?anlegen', async () => {
    api([]);

    wrapper = await page('/verwalten/spiele?anlegen');

    expect(dialog().textContent).toContain('Spiel anlegen');
  });
});
