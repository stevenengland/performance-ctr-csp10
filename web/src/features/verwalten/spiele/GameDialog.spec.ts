import { flushPromises, type VueWrapper } from '@vue/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Game } from '../../../core/api-client';
import { dismissSnackbar } from '../../../core/snackbar';
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
import SpieleVerwaltenPage from './SpieleVerwaltenPage.vue';

const STARTED = '2026-11-01T00:00:00.000Z';
const schach: Game = {
  id: 1,
  name: 'Schach',
  kind: 'duel',
  drawsAllowed: true,
  lowerWins: false,
  startedAt: STARTED,
};
const romme: Game = {
  id: 2,
  name: 'Rommé',
  kind: 'points',
  drawsAllowed: true,
  lowerWins: true,
  startedAt: STARTED,
};

const api = (games: Game[], ...replies: (() => Response)[]) =>
  catalogApi('/api/games', 'games', games, { replies });
const page = () => mountPage('/verwalten/spiele', SpieleVerwaltenPage);

/** A kind tile of the dialog: `Duell` or `Punktespiel`. */
function tile(kind: string): HTMLButtonElement {
  const found = [
    ...dialog().querySelectorAll<HTMLButtonElement>('button[aria-pressed]'),
  ].find((button) => button.textContent.trim().startsWith(kind));
  if (!found) throw new Error(`no tile ${kind}`);
  return found;
}

async function check(label: string) {
  field(label).click();
  await flushPromises();
}

describe('the game dialog', () => {
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

  it('creates a duel game, draws allowed unless switched off', async () => {
    const calls = api([]);
    wrapper = await page();

    await click(buttonIn(document, 'Spiel anlegen'));
    expect(tile('Duell').getAttribute('aria-pressed')).toBe('true');
    expect(field('Remis möglich').checked).toBe(true);
    await type('Name', 'Tischtennis');
    await check('Remis möglich');
    await click(buttonIn(dialog(), 'Speichern'));

    expect(calls.find(({ method }) => method === 'POST')).toEqual({
      method: 'POST',
      url: '/api/games',
      body: { name: 'Tischtennis', kind: 'duel', drawsAllowed: false },
    });
    expect(rows(wrapper)).toEqual(['TischtennisDuell · kein Remis']);
  });

  it('creates a points game with its ranking direction', async () => {
    const calls = api([]);
    wrapper = await page();

    await click(buttonIn(document, 'Spiel anlegen'));
    await type('Name', 'Rommé');
    await click(tile('Punktespiel'));
    expect(tile('Punktespiel').getAttribute('aria-pressed')).toBe('true');
    expect(dialog().textContent).not.toContain('Remis möglich');
    expect(field('Höchste Summe gewinnt').checked).toBe(true);
    await check('Niedrigste Summe gewinnt');
    await click(buttonIn(dialog(), 'Speichern'));

    expect(calls.find(({ method }) => method === 'POST')?.body).toEqual({
      name: 'Rommé',
      kind: 'points',
      lowerWins: true,
    });
  });

  it('shows the server’s field errors under their fields', async () => {
    api([], () =>
      problem(422, {
        title: 'Bitte Eingaben prüfen',
        errors: { name: '1 bis 40 Zeichen.' },
      }),
    );
    wrapper = await page();

    await click(buttonIn(document, 'Spiel anlegen'));
    await click(buttonIn(dialog(), 'Speichern'));

    expect(dialog().textContent).toContain('1 bis 40 Zeichen.');
  });

  it('shows the problem title of a taken name and stays open', async () => {
    api([schach], () =>
      problem(409, {
        type: 'urn:performance:problem:duplicate-name',
        title: 'Name ist bereits vergeben.',
      }),
    );
    wrapper = await page();

    await click(buttonIn(document, 'Spiel anlegen'));
    await type('Name', 'schach');
    await click(buttonIn(dialog(), 'Speichern'));

    expect(dialog().textContent).toContain('Name ist bereits vergeben.');
  });

  it('edits a duel game with its kind fixed, saving the name and the draws setting', async () => {
    const calls = api([schach]);
    wrapper = await page();

    await click(buttonIn(document, 'Schach bearbeiten'));
    expect(dialog().textContent).toContain('Spiel bearbeiten');
    expect(field('Name').value).toBe('Schach');
    expect(tile('Duell').getAttribute('aria-pressed')).toBe('true');
    expect(tile('Punktespiel').disabled).toBe(true);
    expect(dialog().textContent).toContain(
      'Die Art bleibt nach dem Anlegen fest.',
    );
    await type('Name', 'Blitzschach');
    await check('Remis möglich');
    await click(buttonIn(dialog(), 'Speichern'));

    expect(calls.find(({ method }) => method === 'PATCH')).toEqual({
      method: 'PATCH',
      url: '/api/games/1',
      body: { name: 'Blitzschach', drawsAllowed: false },
    });
  });

  it('edits a points game starting with its ranking direction', async () => {
    const calls = api([romme]);
    wrapper = await page();

    await click(buttonIn(document, 'Rommé bearbeiten'));
    expect(tile('Duell').disabled).toBe(true);
    expect(field('Niedrigste Summe gewinnt').checked).toBe(true);
    await check('Höchste Summe gewinnt');
    await click(buttonIn(dialog(), 'Speichern'));

    expect(calls.find(({ method }) => method === 'PATCH')).toEqual({
      method: 'PATCH',
      url: '/api/games/2',
      body: { name: 'Rommé', lowerWins: false },
    });
  });
});
