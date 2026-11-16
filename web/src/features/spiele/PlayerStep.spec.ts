import type { VueWrapper } from '@vue/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { dismissSnackbar, useSnackbar } from '../../core/snackbar';
import {
  button,
  duelApi,
  openFlow,
  ROMME,
  SCHACH,
  stepIndicator,
  stubEnvironment,
  tapTo,
  tileLabels,
} from './duel-flow-harness';

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
    duelApi();
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

  it('asks Gegen wen? without the first person', async () => {
    duelApi();
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
    duelApi();
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

  it('offers Partie eintragen only on a duel', async () => {
    duelApi();
    const opened = await openFlow('/spiele/2');
    wrapper = opened.wrapper;

    expect(wrapper.get('h1').text()).toBe('Rommé');
    expect(() => button(wrapper as VueWrapper, 'Partie eintragen')).toThrow();
  });

  it.each([
    ['a game that no longer exists', '/spiele/7/partie'],
    ['a first person who no longer exists', '/spiele/1/partie/9'],
    ['a game that is no duel', `/spiele/${String(ROMME.id)}/partie`],
  ])(
    'leads back to Spiele with “Nicht mehr vorhanden” for %s',
    async (_case, path) => {
      duelApi([SCHACH, ROMME]);
      const opened = await openFlow(path);
      wrapper = opened.wrapper;

      await vi.waitFor(() => {
        expect(opened.router.currentRoute.value.path).toBe('/spiele');
      });
      expect(useSnackbar().value?.text).toBe('Nicht mehr vorhanden');
    },
  );
});
