import { flushPromises, type VueWrapper } from '@vue/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { dismissSnackbar, useSnackbar } from '../../core/snackbar';
import {
  button,
  gameApi,
  openFlow,
  RANKING,
  ROMME,
  SCHACH,
  stepIndicator,
  stubEnvironment,
  tapTo,
  tileLabels,
} from './game-flow-harness';

describe('picking the players of a match', () => {
  let wrapper: VueWrapper | undefined;

  beforeEach(() => {
    dismissSnackbar();
    stubEnvironment();
  });
  afterEach(() => {
    wrapper?.unmount();
    document.body.innerHTML = '';
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('opens Wer spielt? from Partie eintragen, with each person’s standing in this game', async () => {
    gameApi();
    const opened = await openFlow('/spiele/1');
    wrapper = opened.wrapper;

    await tapTo(wrapper, opened.router, 'Partie eintragen');

    expect(opened.router.currentRoute.value.path).toBe('/spiele/1/partie');
    expect(wrapper.text()).toContain('Wer spielt?');
    expect(wrapper.get('h1').text()).toBe('Schach');
    expect(wrapper.get('.top-bar__context').text()).toBe('Partie eintragen');
    expect(tileLabels(wrapper)).toEqual([
      'Anna, 3,5 Punkte',
      'Ben, 2 Punkte',
      'Carla, noch nichts',
    ]);
    const [anna, , carla] = wrapper.findAll('.count-tile');
    expect(anna?.text()).toContain('5 Partien');
    expect(anna?.text()).toContain('3,5');
    expect(carla?.text()).toContain('noch nichts');
    expect(stepIndicator(wrapper)).toBe('Schritt 1 von 3');
  });

  it('keeps each person’s standing current while the step is open', async () => {
    const api = gameApi();
    const opened = await openFlow('/spiele/1/partie');
    wrapper = opened.wrapper;

    api.state.standings = { ...RANKING, rows: RANKING.rows.slice(1) };
    window.dispatchEvent(new Event('focus'));
    await flushPromises();

    expect(tileLabels(wrapper)).toEqual([
      'Anna, noch nichts',
      'Ben, 2 Punkte',
      'Carla, noch nichts',
    ]);
  });

  it('asks Gegen wen? without the first person', async () => {
    gameApi();
    const opened = await openFlow('/spiele/1/partie');
    wrapper = opened.wrapper;

    await tapTo(wrapper, opened.router, 'Anna, 3,5 Punkte');

    expect(opened.router.currentRoute.value.path).toBe('/spiele/1/partie/1');
    expect(wrapper.text()).toContain('Gegen wen?');
    expect(wrapper.get('.top-bar__context').text()).toBe('Anna – …');
    expect(tileLabels(wrapper)).toEqual([
      'Ben, 2 Punkte',
      'Carla, noch nichts',
    ]);
    expect(stepIndicator(wrapper)).toBe('Schritt 2 von 3');
  });

  it('steps back one level with the back arrow', async () => {
    gameApi();
    const opened = await openFlow('/spiele/1/partie');
    wrapper = opened.wrapper;
    await tapTo(wrapper, opened.router, 'Anna, 3,5 Punkte');
    await tapTo(wrapper, opened.router, 'Ben, 2 Punkte');
    expect(stepIndicator(wrapper)).toBe('Schritt 3 von 3');

    await tapTo(wrapper, opened.router, 'Zurück');
    expect(opened.router.currentRoute.value.path).toBe('/spiele/1/partie/1');
    expect(wrapper.text()).toContain('Gegen wen?');

    await tapTo(wrapper, opened.router, 'Zurück');
    expect(opened.router.currentRoute.value.path).toBe('/spiele/1/partie');
    expect(wrapper.text()).toContain('Wer spielt?');
  });

  it('offers Partie eintragen on a duel and Ergebnis eintragen on a points game', async () => {
    gameApi();
    const opened = await openFlow('/spiele/2', '/spiele/2');
    wrapper = opened.wrapper;

    expect(wrapper.get('h1').text()).toBe('Rommé');
    expect(() => button(wrapper as VueWrapper, 'Partie eintragen')).toThrow();
    await opened.router.push('/spiele/1');
    await flushPromises();
    expect(() => button(wrapper as VueWrapper, 'Ergebnis eintragen')).toThrow();
  });

  it('opens Für wen? from Ergebnis eintragen, with each person’s sum in this game', async () => {
    gameApi();
    const opened = await openFlow('/spiele/2', '/spiele/2');
    wrapper = opened.wrapper;

    await tapTo(wrapper, opened.router, 'Ergebnis eintragen');

    expect(opened.router.currentRoute.value.path).toBe('/spiele/2/ergebnis');
    expect(wrapper.text()).toContain('Für wen?');
    expect(wrapper.get('h1').text()).toBe('Rommé');
    expect(wrapper.get('.top-bar__context').text()).toBe('Ergebnis eintragen');
    expect(tileLabels(wrapper)).toEqual([
      'Anna, noch nichts',
      'Ben, −11 Punkte',
      'Carla, 25 Punkte',
    ]);
    const ben = wrapper.findAll('.count-tile')[1];
    expect(ben?.text()).toContain('−11');
    expect(ben?.text()).toContain('2 Ergebnisse');
    expect(stepIndicator(wrapper)).toBe('Schritt 1 von 2');
  });

  it('asks Wie viele Punkte? for the tapped person', async () => {
    gameApi();
    const opened = await openFlow('/spiele/2/ergebnis', '/spiele/2');
    wrapper = opened.wrapper;

    await tapTo(wrapper, opened.router, 'Ben, −11 Punkte');

    expect(opened.router.currentRoute.value.path).toBe('/spiele/2/ergebnis/2');
    expect(wrapper.text()).toContain('Wie viele Punkte?');
    expect(wrapper.get('.top-bar__context').text()).toBe('Ben');
    expect(stepIndicator(wrapper)).toBe('Schritt 2 von 2');
  });

  it.each([
    ['a game that no longer exists', '/spiele/7/partie'],
    ['a first person who no longer exists', '/spiele/1/partie/9'],
    ['a game that is no duel', `/spiele/${String(ROMME.id)}/partie`],
    ['a game that is no points game', `/spiele/${String(SCHACH.id)}/ergebnis`],
  ])(
    'leads back to Spiele with “Nicht mehr vorhanden” for %s',
    async (_case, path) => {
      gameApi([SCHACH, ROMME]);
      const opened = await openFlow(path);
      wrapper = opened.wrapper;

      await vi.waitFor(() => {
        expect(opened.router.currentRoute.value.path).toBe('/spiele');
      });
      expect(useSnackbar().value?.text).toBe('Nicht mehr vorhanden');
    },
  );
});
