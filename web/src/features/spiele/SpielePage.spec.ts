import { flushPromises, mount, type VueWrapper } from '@vue/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { defineComponent, h } from 'vue';
import {
  createMemoryHistory,
  createRouter,
  RouterView,
  type Router,
} from 'vue-router';
import type { Game } from '../../core/api-client';
import { createAppVuetify } from '../../theme';
import { json } from '../verwalten/manage-page-harness';
import SpielePage from './SpielePage.vue';

const game = (
  id: number,
  name: string,
  kind: Game['kind'],
  startedAt: string,
): Game => ({
  id,
  name,
  kind,
  drawsAllowed: true,
  lowerWins: false,
  startedAt,
});

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

async function spiele(): Promise<VueWrapper> {
  const blank = { render: () => null };
  router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/spiele', component: SpielePage },
      { path: '/spiele/:gameId(\\d+)', component: blank },
      { path: '/verwalten/spiele', component: blank },
    ],
  });
  await router.push('/spiele');
  const shell = defineComponent(() => () => h(RouterView));
  const wrapper = mount(shell, {
    global: { plugins: [router, createAppVuetify()] },
    attachTo: document.body,
  });
  await flushPromises();
  return wrapper;
}

const cards = (wrapper: VueWrapper) =>
  wrapper.findAll('.game-card').map((card) => card.text());

describe('Spiele', () => {
  const zone = process.env.TZ;
  let wrapper: VueWrapper | undefined;

  beforeEach(() => {
    process.env.TZ = 'Europe/Berlin';
    vi.useFakeTimers({
      now: new Date('2026-11-15T22:45:00Z'),
      toFake: ['Date'],
    });
  });
  afterEach(() => {
    wrapper?.unmount();
    document.body.innerHTML = '';
    vi.useRealTimers();
    vi.unstubAllGlobals();
    process.env.TZ = zone;
  });

  it('lists the games as the API sends them (alphabetically), each with its kind and since when it counts', async () => {
    api([
      game(3, 'Rommé', 'points', '2026-11-15T18:30:00.000Z'),
      game(1, 'Schach', 'duel', '2026-09-15T10:00:00.000Z'),
      game(2, 'Tischtennis', 'duel', '2026-10-25T08:00:00.000Z'),
    ]);

    wrapper = await spiele();

    expect(cards(wrapper)).toEqual([
      'RomméPunktespiel · seit heute, 19:30',
      'SchachDuell · seit 15.09.',
      'TischtennisDuell · seit 25.10.',
    ]);
    expect(wrapper.find('ul[aria-label="Spiele"]').exists()).toBe(true);
  });

  it('opens a game’s page', async () => {
    api([game(1, 'Schach', 'duel', '2026-09-15T10:00:00.000Z')]);
    wrapper = await spiele();

    await wrapper.get('.game-card').trigger('click');
    await flushPromises();

    expect(router.currentRoute.value.path).toBe('/spiele/1');
  });

  it('offers to create the first game under Verwalten when there is none', async () => {
    api([]);
    wrapper = await spiele();

    expect(wrapper.text()).toContain('Noch keine Spiele.');
    const create = wrapper.get('a.v-btn');
    expect(create.text()).toBe('Spiel anlegen');

    await create.trigger('click');
    await flushPromises();

    expect(router.currentRoute.value.fullPath).toBe(
      '/verwalten/spiele?anlegen',
    );
  });
});
