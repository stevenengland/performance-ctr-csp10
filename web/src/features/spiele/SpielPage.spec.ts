import { flushPromises, mount, type VueWrapper } from '@vue/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { defineComponent, h } from 'vue';
import {
  createMemoryHistory,
  createRouter,
  RouterView,
  type Router,
} from 'vue-router';
import AppTopBar from '../../components/AppTopBar.vue';
import type { Game } from '../../core/api-client';
import { dismissSnackbar, useSnackbar } from '../../core/snackbar';
import { createAppVuetify } from '../../theme';
import { json } from '../verwalten/manage-page-harness';
import SpielPage from './SpielPage.vue';

const STARTED = '2026-09-15T10:00:00.000Z';
const game = (
  id: number,
  name: string,
  kind: Game['kind'],
  { drawsAllowed = true, lowerWins = false, startedAt = STARTED } = {},
): Game => ({ id, name, kind, drawsAllowed, lowerWins, startedAt });

function api(games: Game[]) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      if (url === '/api/games') return json({ games });
      throw new Error(`unexpected ${url}`);
    }),
  );
}

let router: Router;

/** A game's page in the shell's top bar, opened from Spiele. */
async function spiel(gameId: number): Promise<VueWrapper> {
  const blank = { render: () => null };
  router = createRouter({
    history: createMemoryHistory(),
    routes: [
      {
        path: '/spiele/:gameId(\\d+)',
        component: SpielPage,
        props: true,
        meta: { title: 'Spiele', destination: 'spiele', child: true },
      },
      {
        path: '/spiele',
        component: blank,
        meta: { title: 'Spiele', destination: 'spiele' },
      },
      { path: '/konto', component: blank, meta: { title: 'Konto' } },
    ],
  });
  await router.push('/spiele');
  await router.push(`/spiele/${String(gameId)}`);
  const shell = defineComponent(() => () => [h(AppTopBar), h(RouterView)]);
  const wrapper = mount(shell, {
    global: { plugins: [router, createAppVuetify()] },
    attachTo: document.body,
  });
  await flushPromises();
  return wrapper;
}

describe('a game’s page', () => {
  const zone = process.env.TZ;
  let wrapper: VueWrapper | undefined;

  beforeEach(() => {
    process.env.TZ = 'Europe/Berlin';
    vi.useFakeTimers({
      now: new Date('2026-11-15T22:45:00Z'),
      toFake: ['Date'],
    });
    dismissSnackbar();
  });
  afterEach(() => {
    wrapper?.unmount();
    document.body.innerHTML = '';
    vi.useRealTimers();
    vi.unstubAllGlobals();
    process.env.TZ = zone;
  });

  it('shows a duel’s name, context line and rule over its still empty ranking', async () => {
    api([game(1, 'Schach', 'duel'), game(2, 'Rommé', 'points')]);

    wrapper = await spiel(1);

    expect(wrapper.get('h1').text()).toBe('Schach');
    expect(wrapper.get('.top-bar__context').text()).toBe('Duell · seit 15.09.');
    expect(wrapper.get('.spiel__rule').text()).toBe('Remis möglich');
    expect(wrapper.text()).toContain('Seit dem Start noch keine Partien.');
  });

  it('shows a points game started today with its rule and no results yet', async () => {
    api([
      game(2, 'Rommé', 'points', {
        lowerWins: true,
        startedAt: '2026-11-15T18:30:00.000Z',
      }),
    ]);

    wrapper = await spiel(2);

    expect(wrapper.get('h1').text()).toBe('Rommé');
    expect(wrapper.get('.top-bar__context').text()).toBe(
      'Punktespiel · seit heute, 19:30',
    );
    expect(wrapper.get('.spiel__rule').text()).toBe('Niedrigste Summe gewinnt');
    expect(wrapper.text()).toContain('Seit dem Start noch keine Ergebnisse.');
  });

  it.each([
    [game(3, 'Tischtennis', 'duel', { drawsAllowed: false }), 'Kein Remis'],
    [game(3, 'Kniffel', 'points'), 'Höchste Summe gewinnt'],
  ])('states the rule of %o as %s', async (subject, rule) => {
    api([subject]);

    wrapper = await spiel(3);

    expect(wrapper.get('.spiel__rule').text()).toBe(rule);
  });

  it('leads back to Spiele with “Nicht mehr vorhanden” when the game no longer exists', async () => {
    api([game(1, 'Schach', 'duel')]);

    wrapper = await spiel(7);

    expect(router.currentRoute.value.path).toBe('/spiele');
    expect(useSnackbar().value?.text).toBe('Nicht mehr vorhanden');
  });
});
