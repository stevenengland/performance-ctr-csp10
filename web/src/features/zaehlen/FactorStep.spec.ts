import { flushPromises, mount, type VueWrapper } from '@vue/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { defineComponent, h } from 'vue';
import { createMemoryHistory, createRouter, RouterView } from 'vue-router';
import AppTopBar from '../../components/AppTopBar.vue';
import type { Factor, Scoreboard } from '../../core/api-client';
import { dismissSnackbar, useSnackbar } from '../../core/snackbar';
import { routes } from '../../router';
import { createAppVuetify } from '../../theme';

const HAPPY_HOUR: Factor = { id: 1, name: 'Happy Hour', multiplier: 2 };
const BIRTHDAY: Factor = { id: 2, name: 'Geburtstag', multiplier: 1.5 };
/**
Daniel has booked 4 beers today that count and 2 more that wait for
verification, 13,5 points in all; Ben has recorded 3 beers, all waiting.
*/
const BOARD: Scoreboard = {
  rows: [
    {
      personId: 3,
      name: 'Daniel',
      photoUrl: null,
      score: 13.5,
      count: 9,
      pendingCount: 1,
      drinks: [{ drinkId: 2, name: 'Bier', count: 4, recordedCount: 6 }],
    },
  ],
  unranked: [
    {
      personId: 4,
      name: 'Ben',
      photoUrl: null,
      pendingCount: 2,
      drinks: [{ drinkId: 2, name: 'Bier', count: 0, recordedCount: 3 }],
    },
  ],
};

interface Put {
  url: string;
  body: unknown;
}

/** A fake API with the given factors; it records every entry it is sent. */
function api(factors: Factor[], saving: () => Response | Promise<Response>) {
  const puts: Put[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init: RequestInit) => {
      if (url.startsWith('/api/entries/')) {
        puts.push({ url, body: JSON.parse(String(init.body)) });
        return saving();
      }
      const answers: Record<string, unknown> = {
        '/api/persons': {
          persons: [
            { id: 3, name: 'Daniel', photoUrl: null },
            { id: 4, name: 'Ben', photoUrl: null },
          ],
        },
        '/api/drinks': { drinks: [{ id: 2, name: 'Bier', points: 1 }] },
        '/api/factors': { factors },
      };
      const path = url.split('?')[0] ?? '';
      const body = path === '/api/scoreboard' ? BOARD : answers[path];
      if (body === undefined) throw new Error(`unexpected ${url}`);
      return json(body);
    }),
  );
  return puts;
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

const saved = () =>
  json(
    {
      id: 'x',
      personId: 3,
      drinkId: 2,
      quantity: 2,
      factorId: null,
      createdAt: '',
    },
    201,
  );
const lost = () => Promise.reject(new TypeError('Failed to fetch'));

/** The app's routes in a shell with the top bar, opened at `path`. */
async function flow(path: string) {
  const router = createRouter({ history: createMemoryHistory(), routes });
  await router.push(path);
  const shell = defineComponent(() => () => [h(AppTopBar), h(RouterView)]);
  const wrapper = mount(shell, {
    global: { plugins: [router, createAppVuetify()] },
    attachTo: document.body,
  });
  await flushPromises();
  return { wrapper, router };
}

function button(wrapper: VueWrapper, name: string) {
  const found = wrapper
    .findAll('button')
    .find(
      (candidate) =>
        candidate.attributes('aria-label') === name ||
        candidate.text().trim() === name,
    );
  if (!found) throw new Error(`no button ${name}`);
  return found;
}

function tileLabels(wrapper: VueWrapper) {
  return wrapper
    .findAll('.count-tile')
    .map((tile) => tile.attributes('aria-label'));
}

function steps(wrapper: VueWrapper) {
  return wrapper.get('[role="progressbar"]').attributes('aria-valuemax');
}

describe('the quantity and factor steps', () => {
  let wrapper: VueWrapper | undefined;

  beforeEach(() => {
    dismissSnackbar();
    // A button that is loading observes its size.
    vi.stubGlobal(
      'ResizeObserver',
      class {
        observe = vi.fn();
        unobserve = vi.fn();
        disconnect = vi.fn();
      },
    );
  });
  afterEach(() => {
    wrapper?.unmount();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('starts the stepper at everything recorded today, entries that wait for verification included', async () => {
    api([HAPPY_HOUR], saved);
    wrapper = (await flow('/zaehlen/3/2')).wrapper;

    expect(wrapper.text()).toContain('bisher 6, neu dazu 0');
  });

  it('starts the stepper at what a person without a place recorded today', async () => {
    api([HAPPY_HOUR], saved);
    wrapper = (await flow('/zaehlen/4/2')).wrapper;

    expect(wrapper.text()).toContain('bisher 3, neu dazu 0');
  });

  it('goes on with Weiter to the factor step once factors exist', async () => {
    api([BIRTHDAY, HAPPY_HOUR], saved);
    const opened = await flow('/zaehlen/3/2');
    wrapper = opened.wrapper;

    expect(steps(wrapper)).toBe('4');
    await button(wrapper, 'Eins mehr').trigger('click');
    await button(wrapper, 'Eins mehr').trigger('click');
    await button(wrapper, 'Weiter').trigger('click');

    await vi.waitFor(() => {
      expect(opened.router.currentRoute.value.path).toBe('/zaehlen/3/2/2');
    });
    await flushPromises();
    expect(wrapper.text()).toContain('Faktor?');
    expect(wrapper.get('.top-bar').text()).toContain('Daniel');
    expect(wrapper.get('.top-bar').text()).toContain('2× Bier');
    expect(wrapper.get('.top-bar').text()).toContain('13,5');
    expect(steps(wrapper)).toBe('4');
  });

  it('offers Kein Faktor first, then each factor alphabetically with its multiplier', async () => {
    api([BIRTHDAY, HAPPY_HOUR], saved);
    wrapper = (await flow('/zaehlen/3/2/2')).wrapper;

    expect(tileLabels(wrapper)).toEqual([
      'Kein Faktor, zählt einfach',
      'Geburtstag, ×1,5',
      'Happy Hour, ×2',
    ]);
    const happyHour = wrapper.findAll('.count-tile')[2];
    expect(happyHour?.classes()).toContain('count-tile--factor');
    expect(happyHour?.text()).toContain('×2');
    expect(happyHour?.text()).toContain('zählt 2-fach');
  });

  it('saves with the tapped factor in four taps and returns to the name list, naming the factor', async () => {
    const puts = api([HAPPY_HOUR], saved);
    const { wrapper: shown, router } = await flow('/zaehlen');
    wrapper = shown;
    const tap = async (name: string) => {
      const path = router.currentRoute.value.path;
      await button(shown, name).trigger('click');
      await vi.waitFor(() => {
        expect(router.currentRoute.value.path).not.toBe(path);
      });
      await flushPromises();
    };

    await tap('Daniel, 13,5 Punkte heute');
    await tap('Bier, 1 Punkt, heute 6');
    await button(wrapper, 'Eins mehr').trigger('click');
    await button(wrapper, 'Eins mehr').trigger('click');
    await tap('Weiter');
    await button(wrapper, 'Happy Hour, ×2').trigger('click');
    await vi.waitFor(() => {
      expect(router.currentRoute.value.path).toBe('/zaehlen');
    });

    expect(puts.map(({ body }) => body)).toEqual([
      { personId: 3, drinkId: 2, quantity: 2, factorId: 1 },
    ]);
    expect(useSnackbar().value?.text).toBe(
      '2× Bier · Happy Hour ×2 · Daniel · wartet auf Bestätigung',
    );
    expect(useSnackbar().value?.action?.label).toBe('Rückgängig');
  });

  it('counts once with Kein Faktor', async () => {
    const puts = api([HAPPY_HOUR], saved);
    wrapper = (await flow('/zaehlen/3/2/2')).wrapper;

    await button(wrapper, 'Kein Faktor, zählt einfach').trigger('click');
    await flushPromises();

    expect(puts.map(({ body }) => body)).toEqual([
      { personId: 3, drinkId: 2, quantity: 2, factorId: null },
    ]);
    expect(useSnackbar().value?.text).toBe(
      '2× Bier · Daniel · wartet auf Bestätigung',
    );
  });

  it('turns the tapped tile amber and holds the others while it saves', async () => {
    let answer: (response: Response) => void = () => undefined;
    api(
      [HAPPY_HOUR],
      () =>
        new Promise<Response>((resolve) => {
          answer = resolve;
        }),
    );
    wrapper = (await flow('/zaehlen/3/2/2')).wrapper;

    await button(wrapper, 'Happy Hour, ×2').trigger('click');

    const [none, happyHour] = wrapper.findAll('.count-tile');
    expect(happyHour?.classes()).toContain('tile--pressed');
    expect(none?.attributes('disabled')).toBeDefined();
    answer(saved());
    await flushPromises();
  });

  it('stays on the step with its buttons enabled when the save got no answer', async () => {
    const puts = api([HAPPY_HOUR], lost);
    const { wrapper: shown, router } = await flow('/zaehlen/3/2/2');
    wrapper = shown;

    await button(wrapper, 'Happy Hour, ×2').trigger('click');
    await flushPromises();

    expect(router.currentRoute.value.path).toBe('/zaehlen/3/2/2');
    expect(useSnackbar().value?.text).toBe(
      'Nicht gespeichert – keine Verbindung',
    );
    expect(
      wrapper.findAll('.count-tile').map((tile) => tile.attributes('disabled')),
    ).toEqual([undefined, undefined]);
    useSnackbar().value?.action?.run();
    await flushPromises();
    expect(puts[1]?.url).toBe(puts[0]?.url);
  });

  it('disables the factor tiles while offline', async () => {
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
    api([HAPPY_HOUR], saved);
    wrapper = (await flow('/zaehlen/3/2/2')).wrapper;

    expect(
      wrapper
        .findAll('.count-tile')
        .every((tile) => tile.attributes('disabled') !== undefined),
    ).toBe(true);
  });

  it('saves from the quantity step with Speichern while no factors exist', async () => {
    const puts = api([], saved);
    wrapper = (await flow('/zaehlen/3/2')).wrapper;

    expect(steps(wrapper)).toBe('3');
    await button(wrapper, 'Eins mehr').trigger('click');
    await button(wrapper, 'Speichern').trigger('click');
    await flushPromises();

    expect(puts.map(({ body }) => body)).toEqual([
      { personId: 3, drinkId: 2, quantity: 1, factorId: null },
    ]);
    expect(useSnackbar().value?.text).toBe(
      '1× Bier · Daniel · wartet auf Bestätigung',
    );
  });
});
