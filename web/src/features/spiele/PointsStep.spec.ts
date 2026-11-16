import { flushPromises, type VueWrapper } from '@vue/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { dismissSnackbar, useSnackbar } from '../../core/snackbar';
import {
  button,
  gameApi,
  lost,
  openFlow,
  POINTS_RANKING,
  ROMME,
  SCHACH,
  saved,
  stubEnvironment,
  tapTo,
  tileLabels,
  type Answer,
} from './game-flow-harness';

/** The points typed so far, as the step shows them large. */
const shown = (wrapper: VueWrapper) =>
  wrapper.get('.points-step__value').text();

async function tap(wrapper: VueWrapper, ...keys: string[]) {
  for (const key of keys) await button(wrapper, key).trigger('click');
}

function press(...keys: string[]) {
  for (const key of keys) {
    window.dispatchEvent(new KeyboardEvent('keydown', { key }));
  }
}

const saveButton = (wrapper: VueWrapper) => button(wrapper, 'Speichern');

describe('the points of a result', () => {
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

  it('types the points on the app’s own number pad, shown large, with the person’s sum so far', async () => {
    gameApi();
    wrapper = (await openFlow('/spiele/2/ergebnis/2', '/spiele/2')).wrapper;

    expect(wrapper.text()).toContain('Wie viele Punkte?');
    expect(wrapper.text()).toContain('bisher −11 Punkte');
    expect(shown(wrapper)).toBe('0');
    expect(
      wrapper
        .findAll('.points-pad__key')
        .map((key) => key.attributes('aria-label')),
    ).toEqual([
      'Ziffer 1',
      'Ziffer 2',
      'Ziffer 3',
      'Ziffer 4',
      'Ziffer 5',
      'Ziffer 6',
      'Ziffer 7',
      'Ziffer 8',
      'Ziffer 9',
      'Vorzeichen wechseln',
      'Ziffer 0',
      'Letzte Ziffer löschen',
    ]);

    await tap(wrapper, 'Ziffer 2', 'Ziffer 0');
    expect(shown(wrapper)).toBe('20');
    await tap(wrapper, 'Vorzeichen wechseln');
    expect(shown(wrapper)).toBe('−20');
    expect(
      button(wrapper, 'Vorzeichen wechseln').attributes('aria-pressed'),
    ).toBe('true');
    await tap(wrapper, 'Letzte Ziffer löschen');
    expect(shown(wrapper)).toBe('−2');
  });

  it('takes at most four digits', async () => {
    gameApi();
    wrapper = (await openFlow('/spiele/2/ergebnis/2', '/spiele/2')).wrapper;

    await tap(
      wrapper,
      'Ziffer 9',
      'Ziffer 8',
      'Ziffer 7',
      'Ziffer 6',
      'Ziffer 5',
    );

    expect(shown(wrapper)).toBe('9.876');
  });

  it('replaces a leading zero instead of adding to it', async () => {
    gameApi();
    wrapper = (await openFlow('/spiele/2/ergebnis/2', '/spiele/2')).wrapper;

    await tap(wrapper, 'Ziffer 0', 'Ziffer 0', 'Ziffer 7');

    expect(shown(wrapper)).toBe('7');
  });

  it('works with a keyboard too: digits, minus, backspace and Enter to save', async () => {
    const { results } = gameApi();
    const opened = await openFlow('/spiele/2/ergebnis/2', '/spiele/2');
    wrapper = opened.wrapper;

    press('1', '5', '-');
    await flushPromises();
    expect(shown(wrapper)).toBe('−15');
    press('Backspace');
    await flushPromises();
    expect(shown(wrapper)).toBe('−1');

    press('Enter');
    await vi.waitFor(() => {
      expect(results).toHaveLength(1);
    });
    expect(results[0]?.body).toEqual({ gameId: 2, personId: 2, points: -1 });
  });

  it('says that a person without a result has none yet', async () => {
    gameApi();
    wrapper = (await openFlow('/spiele/2/ergebnis/1', '/spiele/2')).wrapper;

    expect(wrapper.text()).toContain('noch keine Ergebnisse');
  });

  it('saves the result, returns to Für wen? and shows it with Rückgängig', async () => {
    const { results, state } = gameApi();
    const opened = await openFlow('/spiele/2/ergebnis', '/spiele/2');
    wrapper = opened.wrapper;
    await tapTo(wrapper, opened.router, 'Ben, −11 Punkte');
    await tap(wrapper, 'Ziffer 2', 'Ziffer 0', 'Vorzeichen wechseln');
    state.points = {
      ...POINTS_RANKING,
      rows: [
        { personId: 3, name: 'Carla', sum: 25, results: 3 },
        { personId: 2, name: 'Ben', sum: -31, results: 3 },
      ],
    };

    await saveButton(wrapper).trigger('click');
    await vi.waitFor(() => {
      expect(opened.router.currentRoute.value.path).toBe('/spiele/2/ergebnis');
    });
    await flushPromises();

    expect(results.map(({ method, body }) => [method, body])).toEqual([
      ['PUT', { gameId: 2, personId: 2, points: -20 }],
    ]);
    expect(useSnackbar().value?.text).toBe('Ben · −20 Punkte');
    expect(useSnackbar().value?.action?.label).toBe('Rückgängig');
    expect(wrapper.text()).toContain('Für wen?');
    expect(tileLabels(wrapper)[1]).toBe('Ben, −31 Punkte');
  });

  it('shows the new sum in the game’s ranking after saving', async () => {
    const { state } = gameApi();
    const opened = await openFlow('/spiele/2/ergebnis/1', '/spiele/2');
    wrapper = opened.wrapper;
    await tap(wrapper, 'Ziffer 4', 'Ziffer 0');
    state.points = {
      ...POINTS_RANKING,
      rows: [
        { personId: 1, name: 'Anna', sum: 40, results: 1 },
        ...POINTS_RANKING.rows,
      ],
    };

    await saveButton(wrapper).trigger('click');
    await vi.waitFor(() => {
      expect(opened.router.currentRoute.value.path).toBe('/spiele/2/ergebnis');
    });
    await opened.router.push('/spiele/2');
    await flushPromises();

    expect(
      wrapper
        .findAll('[data-test="game-place"]')
        .map((place) => place.attributes('aria-label')),
    ).toEqual([
      'Platz 1, Anna, 40 Punkte, 1 Ergebnis',
      'Platz 2, Carla, 25 Punkte, 3 Ergebnisse',
      'Platz 3, Ben, −11 Punkte, 2 Ergebnisse',
    ]);
  });

  it('deletes the result again with Rückgängig', async () => {
    const { results } = gameApi();
    const opened = await openFlow('/spiele/2/ergebnis', '/spiele/2');
    wrapper = opened.wrapper;
    await tapTo(wrapper, opened.router, 'Ben, −11 Punkte');
    await tap(wrapper, 'Ziffer 5');
    await saveButton(wrapper).trigger('click');
    await vi.waitFor(() => {
      expect(opened.router.currentRoute.value.path).toBe('/spiele/2/ergebnis');
    });

    useSnackbar().value?.action?.run();
    await vi.waitFor(() => {
      expect(useSnackbar().value?.text).toBe('Rückgängig gemacht');
    });

    const [put, remove] = results;
    expect(remove).toEqual({ method: 'DELETE', url: put?.url });
  });

  it('offers Erneut versuchen with the same id when the answer got lost, and stays on the step', async () => {
    let answer: Answer = lost;
    const { results } = gameApi([SCHACH, ROMME], (call) => answer(call));
    const opened = await openFlow('/spiele/2/ergebnis/2', '/spiele/2');
    wrapper = opened.wrapper;
    await tap(wrapper, 'Ziffer 3');

    await saveButton(wrapper).trigger('click');
    await flushPromises();

    expect(opened.router.currentRoute.value.path).toBe('/spiele/2/ergebnis/2');
    expect(useSnackbar().value?.action?.label).toBe('Erneut versuchen');
    expect(shown(wrapper)).toBe('3');

    answer = saved;
    useSnackbar().value?.action?.run();
    await vi.waitFor(() => {
      expect(opened.router.currentRoute.value.path).toBe('/spiele/2/ergebnis');
    });
    expect(results.map(({ url }) => url)).toEqual([
      results[0]?.url,
      results[0]?.url,
    ]);
    expect(useSnackbar().value?.text).toBe('Ben · 3 Punkte');
  });

  it('keeps Speichern disabled until a digit is typed', async () => {
    gameApi();
    wrapper = (await openFlow('/spiele/2/ergebnis/2', '/spiele/2')).wrapper;

    expect(saveButton(wrapper).attributes('disabled')).toBeDefined();
    await tap(wrapper, 'Ziffer 0');
    expect(saveButton(wrapper).attributes('disabled')).toBeUndefined();
  });

  it('disables Speichern while offline', async () => {
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
    gameApi();
    wrapper = (await openFlow('/spiele/2/ergebnis/2', '/spiele/2')).wrapper;

    await tap(wrapper, 'Ziffer 7');

    expect(saveButton(wrapper).attributes('disabled')).toBeDefined();
  });

  it.each([
    ['a person who no longer exists', '/spiele/2/ergebnis/9'],
    ['a game that is no points game', '/spiele/1/ergebnis/2'],
  ])(
    'leads back to Spiele with “Nicht mehr vorhanden” for %s',
    async (_case, path) => {
      gameApi();
      const opened = await openFlow(path, '/spiele/2');
      wrapper = opened.wrapper;

      await vi.waitFor(() => {
        expect(opened.router.currentRoute.value.path).toBe('/spiele');
      });
      expect(useSnackbar().value?.text).toBe('Nicht mehr vorhanden');
    },
  );
});
