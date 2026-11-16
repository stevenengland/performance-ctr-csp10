import { flushPromises, mount, type VueWrapper } from '@vue/test-utils';
import { vi } from 'vitest';
import { defineComponent, h, type VNode } from 'vue';
import {
  createMemoryHistory,
  createRouter,
  RouterView,
  type RouteLocationNormalizedLoaded,
} from 'vue-router';
import AppTopBar from '../../components/AppTopBar.vue';
import type { Game, NewMatch, Standings } from '../../core/api-client';
import { routes } from '../../router';
import { createAppVuetify } from '../../theme';

/** A duel `Schach` (draws allowed) and a points game `Rommé`. */
export const SCHACH: Game = {
  id: 1,
  name: 'Schach',
  kind: 'duel',
  drawsAllowed: true,
  lowerWins: false,
  startedAt: '2026-09-15T10:00:00.000Z',
};
export const ROMME: Game = { ...SCHACH, id: 2, name: 'Rommé', kind: 'points' };

export const PERSONS = [
  { id: 1, name: 'Anna' },
  { id: 2, name: 'Ben' },
  { id: 3, name: 'Carla' },
];

/** Anna leads Schach with 3,5 points from 5 matches; Ben has 2 from 4; Carla has played none. */
export const RANKING: Extract<Standings, { kind: 'duel' }> = {
  kind: 'duel',
  startedAt: SCHACH.startedAt,
  rows: [
    {
      personId: 1,
      name: 'Anna',
      points: 3.5,
      wins: 3,
      draws: 1,
      losses: 1,
      played: 5,
    },
    {
      personId: 2,
      name: 'Ben',
      points: 2,
      wins: 2,
      draws: 0,
      losses: 2,
      played: 4,
    },
  ],
};

interface RouterViewSlot {
  Component: VNode;
  route: RouteLocationNormalizedLoaded;
}

export function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

export interface MatchCall {
  method: string;
  url: string;
  body?: NewMatch;
}

/**
A fake API with the games, the persons and each game's ranking (`standings` may be
changed by the test, e.g. after a save). Every match PUT and DELETE is recorded and
answered by `answer` (a saved match by default, 204 for a delete).
*/
export function duelApi(
  games: Game[] = [SCHACH, ROMME],
  answer: (call: MatchCall) => Response | Promise<Response> = saved,
) {
  const matches: MatchCall[] = [];
  const state: { standings: Standings } = { standings: RANKING };
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init: RequestInit = {}) => {
      const method = init.method ?? 'GET';
      if (url.startsWith('/api/matches/')) {
        const call: MatchCall = {
          method,
          url,
          ...(typeof init.body === 'string'
            ? { body: JSON.parse(init.body) as NewMatch }
            : {}),
        };
        matches.push(call);
        return answer(call);
      }
      if (url === '/api/games') return json({ games });
      if (url === '/api/persons') return json({ persons: PERSONS });
      if (url === '/api/factors') return json({ factors: [] });
      if (/^\/api\/games\/\d+\/standings$/.test(url)) {
        return json(state.standings);
      }
      throw new Error(`unexpected ${method} ${url}`);
    }),
  );
  return { matches, state };
}

export function saved({ method, url, body }: MatchCall): Response {
  if (method === 'DELETE') return new Response(null, { status: 204 });
  return json(
    { id: url.split('/').pop(), ...body, createdAt: '2026-11-15T20:00:00Z' },
    201,
  );
}

export const lost = () => Promise.reject(new TypeError('Failed to fetch'));

/** The app's routes in a shell with the top bar, opened at the game's page and then at `path`. */
export async function openFlow(path: string) {
  const router = createRouter({ history: createMemoryHistory(), routes });
  await router.push('/spiele/1');
  if (path !== '/spiele/1') await router.push(path);
  // Like the app's shell: a new path is a new screen.
  const shell = defineComponent(() => () => [
    h(AppTopBar),
    h(RouterView, null, {
      default: ({ Component, route }: RouterViewSlot) =>
        h(Component, { key: route.path }),
    }),
  ]);
  const wrapper = mount(shell, {
    global: { plugins: [router, createAppVuetify()] },
    attachTo: document.body,
  });
  await flushPromises();
  return { wrapper, router };
}

export function button(wrapper: VueWrapper, name: string) {
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

export function tileLabels(wrapper: VueWrapper) {
  return wrapper
    .findAll('.count-tile')
    .map((tile) => tile.attributes('aria-label'));
}

/** The step indicator: `Schritt 2 von 3`. */
export function stepIndicator(wrapper: VueWrapper) {
  return wrapper.get('[role="progressbar"]').attributes('aria-label');
}

/** Taps and waits until the route changed and the next screen is shown. */
export async function tapTo(
  wrapper: VueWrapper,
  router: ReturnType<typeof createRouter>,
  name: string,
) {
  const path = router.currentRoute.value.fullPath;
  await button(wrapper, name).trigger('click');
  await vi.waitFor(() => {
    if (router.currentRoute.value.fullPath === path) throw new Error('stayed');
  });
  await flushPromises();
}

/** Stubs what Vuetify's buttons and the system back need in jsdom. */
export function stubEnvironment() {
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe = vi.fn();
      unobserve = vi.fn();
      disconnect = vi.fn();
    },
  );
  // The top bar's back arrow goes back in the history only when there is one.
  vi.spyOn(window.history, 'length', 'get').mockReturnValue(3);
}
