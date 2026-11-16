import { flushPromises, mount, type VueWrapper } from '@vue/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { defineComponent, h } from 'vue';
import {
  createMemoryHistory,
  createRouter,
  RouterView,
  type Router,
} from 'vue-router';
import type { Game, Standings } from '../../core/api-client';
import { dismissSnackbar, useSnackbar } from '../../core/snackbar';
import { createAppVuetify } from '../../theme';
import { json, problem } from '../verwalten/manage-page-harness';
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

/** The API with the games and each game's ranking (none recorded unless given). */
function api(
  games: Game[],
  standings: Record<number, Standings | Response> = {},
) {
  const fetch = vi.fn(async (url: string) => {
    if (url === '/api/games') return json({ games });
    const id = Number(/^\/api\/games\/(\d+)\/standings$/.exec(url)?.[1]);
    const subject = games.find((candidate) => candidate.id === id);
    if (subject) {
      const answer = standings[id] ?? {
        kind: subject.kind,
        startedAt: subject.startedAt,
        lowerWins: subject.lowerWins,
        rows: [],
      };
      return answer instanceof Response ? answer : json(answer);
    }
    throw new Error(`unexpected ${url}`);
  });
  vi.stubGlobal('fetch', fetch);
  return fetch;
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
    dismissSnackbar();
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
      'RomméPunktespiel · seit heute, 19:30noch keine Ergebnisse',
      'SchachDuell · seit 15.09.noch keine Ergebnisse',
      'TischtennisDuell · seit 25.10.noch keine Ergebnisse',
    ]);
    expect(wrapper.find('ul[aria-label="Spiele"]').exists()).toBe(true);
  });

  it('moves a game started today to its date once the page is used again on a later day', async () => {
    api([game(3, 'Rommé', 'points', '2026-11-15T18:30:00.000Z')]);
    wrapper = await spiele();

    vi.setSystemTime(new Date('2026-11-16T00:05:00Z'));
    document.dispatchEvent(new Event('visibilitychange'));
    await flushPromises();

    expect(cards(wrapper)).toEqual([
      'RomméPunktespiel · seit 15.11.noch keine Ergebnisse',
    ]);
  });

  it('shows each game’s leader, or that nothing was recorded yet', async () => {
    const started = '2026-09-15T10:00:00.000Z';
    const fetch = api(
      [
        game(3, 'Rommé', 'points', started),
        game(1, 'Schach', 'duel', started),
        game(2, 'Tischtennis', 'duel', started),
      ],
      {
        1: {
          kind: 'duel',
          startedAt: started,
          rows: [
            {
              personId: 1,
              name: 'Anna',
              points: 4,
              wins: 4,
              draws: 0,
              losses: 1,
              played: 5,
            },
          ],
        },
        3: {
          kind: 'points',
          startedAt: started,
          lowerWins: true,
          rows: [{ personId: 3, name: 'Daniel', sum: -11, results: 2 }],
        },
      },
    );

    wrapper = await spiele();

    expect(
      wrapper.findAll('.game-card__leader').map((leader) => leader.text()),
    ).toEqual([
      '1. Daniel · −11 Punkte',
      '1. Anna · 4 Punkte',
      'noch keine Ergebnisse',
    ]);
    // Read once on open, not polled per game.
    expect(fetch).toHaveBeenCalledTimes(4);
  });

  it('shows maintenance in the snackbar when a leader cannot be read and keeps the list', async () => {
    const started = '2026-09-15T10:00:00.000Z';
    const maintenance = problem(503, {
      type: 'urn:performance:problem:maintenance',
      title: 'Wird aktualisiert – gleich wieder da',
    });
    maintenance.headers.set('Retry-After', '30');
    // A game no screen has read the ranking of yet.
    api([game(43, 'Schach', 'duel', started)], { 43: maintenance });

    wrapper = await spiele();

    expect(useSnackbar().value?.text).toBe(
      'Wird aktualisiert – gleich wieder da',
    );
    expect(cards(wrapper)).toEqual(['SchachDuell · seit 15.09.']);
  });

  it('reads the leaders again on focus, on condition of each ranking’s ETag, and never polls them', async () => {
    vi.useFakeTimers({ now: new Date('2026-11-15T22:45:00Z') });
    const started = '2026-09-15T10:00:00.000Z';
    const asked: string[] = [];
    let leader = 'Anna';
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init: RequestInit) => {
        if (url === '/api/games') {
          return json({ games: [game(41, 'Schach', 'duel', started)] });
        }
        const ifNoneMatch = (init.headers as Record<string, string>)[
          'If-None-Match'
        ];
        asked.push(ifNoneMatch ?? 'none');
        if (ifNoneMatch === `"${leader}"`) {
          return new Response(null, { status: 304 });
        }
        const answer = json({
          kind: 'duel',
          startedAt: started,
          rows: [
            {
              personId: 1,
              name: leader,
              points: 1,
              wins: 1,
              draws: 0,
              losses: 0,
              played: 1,
            },
          ],
        });
        answer.headers.set('ETag', `"${leader}"`);
        return answer;
      }),
    );
    wrapper = await spiele();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(asked).toEqual(['none']);

    window.dispatchEvent(new Event('focus'));
    await flushPromises();
    expect(asked).toEqual(['none', '"Anna"']);

    leader = 'Ben';
    window.dispatchEvent(new Event('focus'));
    await flushPromises();
    expect(wrapper.get('.game-card__leader').text()).toBe('1. Ben · 1 Punkt');

    wrapper.unmount();
    wrapper = undefined;
    window.dispatchEvent(new Event('focus'));
    await flushPromises();
    expect(asked).toHaveLength(3);
  });

  it('keeps a leader shown when reading it again fails', async () => {
    const started = '2026-09-15T10:00:00.000Z';
    const anna = {
      kind: 'duel' as const,
      startedAt: started,
      rows: [
        {
          personId: 1,
          name: 'Anna',
          points: 2,
          wins: 2,
          draws: 0,
          losses: 0,
          played: 2,
        },
      ],
    };
    api([game(42, 'Schach', 'duel', started)], { 42: anna });
    wrapper = await spiele();

    api([game(42, 'Schach', 'duel', started)], {
      42: problem(500, { type: 'about:blank', title: 'Fehler' }),
    });
    window.dispatchEvent(new Event('focus'));
    await flushPromises();

    expect(wrapper.get('.game-card__leader').text()).toBe('1. Anna · 2 Punkte');
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
