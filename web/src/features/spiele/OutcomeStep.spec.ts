import { flushPromises, type VueWrapper } from '@vue/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { dismissSnackbar, useSnackbar } from '../../core/snackbar';
import {
  button,
  gameApi,
  lost,
  openFlow,
  RANKING,
  ROMME,
  SCHACH,
  saved,
  stepIndicator,
  stubEnvironment,
  tapTo,
  tileLabels,
  type Answer,
} from './game-flow-harness';

describe('the outcome of a match', () => {
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

  it('asks Wie ging es aus? with a win for each and Remis between them, raspberry', async () => {
    gameApi();
    const opened = await openFlow('/spiele/1/partie/1/2');
    wrapper = opened.wrapper;

    expect(wrapper.text()).toContain('Wie ging es aus?');
    expect(wrapper.get('h1').text()).toBe('Schach');
    expect(wrapper.get('.top-bar__context').text()).toBe('Anna – Ben');
    expect(tileLabels(wrapper)).toEqual([
      'Anna gewinnt',
      'Remis',
      'Ben gewinnt',
    ]);
    const [win, draw] = wrapper.findAll('.count-tile');
    expect(draw?.classes()).toContain('count-tile--factor');
    expect(win?.classes()).not.toContain('count-tile--factor');
    expect(stepIndicator(wrapper)).toBe('Schritt 3 von 3');
  });

  it('offers no Remis while the game allows no draws', async () => {
    gameApi([{ ...SCHACH, drawsAllowed: false }, ROMME]);
    wrapper = (await openFlow('/spiele/1/partie/2/1')).wrapper;

    expect(tileLabels(wrapper)).toEqual(['Ben gewinnt', 'Anna gewinnt']);
  });

  it('saves the tapped outcome, returns to Wer spielt? and shows the match with Rückgängig and the new ranking', async () => {
    const { matches, state } = gameApi();
    const opened = await openFlow('/spiele/1/partie');
    wrapper = opened.wrapper;
    await tapTo(wrapper, opened.router, 'Anna, 3,5 Punkte');
    await tapTo(wrapper, opened.router, 'Ben, 2 Punkte');
    state.standings = {
      ...RANKING,
      rows: RANKING.rows.map((row) =>
        row.personId === 1 ? { ...row, points: 4.5, wins: 4, played: 6 } : row,
      ),
    };

    await button(wrapper, 'Anna gewinnt').trigger('click');
    await vi.waitFor(() => {
      expect(opened.router.currentRoute.value.path).toBe('/spiele/1/partie');
    });
    await flushPromises();

    expect(matches.map(({ method, body }) => [method, body])).toEqual([
      [
        'PUT',
        { gameId: 1, firstPersonId: 1, secondPersonId: 2, outcome: 'first' },
      ],
    ]);
    expect(useSnackbar().value?.text).toBe(
      'Anna – Ben · Anna gewinnt · wartet auf Bestätigung',
    );
    expect(useSnackbar().value?.action?.label).toBe('Rückgängig');
    expect(wrapper.text()).toContain('Wer spielt?');
    expect(tileLabels(wrapper)[0]).toBe('Anna, 4,5 Punkte');
  });

  it('names a draw in the snackbar', async () => {
    const { matches } = gameApi();
    wrapper = (await openFlow('/spiele/1/partie/2/3')).wrapper;

    await button(wrapper, 'Remis').trigger('click');
    await flushPromises();

    expect(matches[0]?.body?.outcome).toBe('draw');
    expect(useSnackbar().value?.text).toBe(
      'Ben – Carla · Remis · wartet auf Bestätigung',
    );
  });

  it('deletes the match again with Rückgängig and reads the ranking again', async () => {
    const { matches, state } = gameApi();
    const opened = await openFlow('/spiele/1/partie');
    wrapper = opened.wrapper;
    await tapTo(wrapper, opened.router, 'Anna, 3,5 Punkte');
    await tapTo(wrapper, opened.router, 'Ben, 2 Punkte');
    await button(wrapper, 'Ben gewinnt').trigger('click');
    await vi.waitFor(() => {
      expect(opened.router.currentRoute.value.path).toBe('/spiele/1/partie');
    });
    state.standings = { ...RANKING, rows: [] };

    useSnackbar().value?.action?.run();
    await vi.waitFor(() => {
      expect(useSnackbar().value?.text).toBe('Rückgängig gemacht');
    });
    await flushPromises();

    const [put, remove] = matches;
    expect(remove).toEqual({ method: 'DELETE', url: put?.url });
    expect(tileLabels(wrapper)[0]).toBe('Anna, noch nichts');
  });

  it('offers Erneut versuchen with the same id when the answer got lost, and stays on the step', async () => {
    let answer: Answer = lost;
    const { matches } = gameApi([SCHACH, ROMME], (call) => answer(call));
    const opened = await openFlow('/spiele/1/partie/1/2');
    wrapper = opened.wrapper;

    await button(wrapper, 'Anna gewinnt').trigger('click');
    await flushPromises();

    expect(opened.router.currentRoute.value.path).toBe('/spiele/1/partie/1/2');
    expect(useSnackbar().value?.text).toBe(
      'Nicht gespeichert – keine Verbindung',
    );
    expect(useSnackbar().value?.action?.label).toBe('Erneut versuchen');
    expect(
      wrapper.findAll('.count-tile').map((tile) => tile.attributes('disabled')),
    ).toEqual([undefined, undefined, undefined]);

    answer = saved;
    useSnackbar().value?.action?.run();
    await vi.waitFor(() => {
      expect(opened.router.currentRoute.value.path).toBe('/spiele/1/partie');
    });
    expect(matches.map(({ url }) => url)).toEqual([
      matches[0]?.url,
      matches[0]?.url,
    ]);
    expect(useSnackbar().value?.text).toBe(
      'Anna – Ben · Anna gewinnt · wartet auf Bestätigung',
    );
  });

  it('turns the tapped outcome amber and holds the others while it saves', async () => {
    let answer: (response: Response) => void = () => undefined;
    gameApi(
      [SCHACH, ROMME],
      () =>
        new Promise<Response>((resolve) => {
          answer = resolve;
        }),
    );
    wrapper = (await openFlow('/spiele/1/partie/1/2')).wrapper;

    await button(wrapper, 'Remis').trigger('click');

    const [first, draw, second] = wrapper.findAll('.count-tile');
    expect(draw?.classes()).toContain('tile--pressed');
    expect(first?.attributes('disabled')).toBeDefined();
    expect(second?.attributes('disabled')).toBeDefined();
    answer(new Response(null, { status: 503 }));
    await flushPromises();
  });

  it('disables the outcome tiles while offline', async () => {
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
    gameApi();
    wrapper = (await openFlow('/spiele/1/partie/1/2')).wrapper;

    expect(
      wrapper
        .findAll('.count-tile')
        .every((tile) => tile.attributes('disabled') !== undefined),
    ).toBe(true);
  });

  it('leads back to Spiele with “Nicht mehr vorhanden” when a player no longer exists', async () => {
    gameApi();
    const opened = await openFlow('/spiele/1/partie/1/9');
    wrapper = opened.wrapper;

    await vi.waitFor(() => {
      expect(opened.router.currentRoute.value.path).toBe('/spiele');
    });
    expect(useSnackbar().value?.text).toBe('Nicht mehr vorhanden');
  });
});
