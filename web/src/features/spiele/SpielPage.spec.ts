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
import type { Game, Standings } from '../../core/api-client';
import { refreshStandings } from '../../core/games';
import { dismissSnackbar, useSnackbar } from '../../core/snackbar';
import { createAppVuetify } from '../../theme';
import { json, problem } from '../verwalten/manage-page-harness';

/** A 503 while a migration runs, to be retried after `Retry-After`. */
function maintenance(): Response {
  const answer = problem(503, {
    type: 'urn:performance:problem:maintenance',
    title: 'Wird aktualisiert – gleich wieder da',
  });
  answer.headers.set('Retry-After', '30');
  return answer;
}
import SpielPage from './SpielPage.vue';

const STARTED = '2026-09-15T10:00:00.000Z';
const game = (
  id: number,
  name: string,
  kind: Game['kind'],
  { drawsAllowed = true, lowerWins = false, startedAt = STARTED } = {},
): Game => ({ id, name, kind, drawsAllowed, lowerWins, startedAt });

const noRows = (subject: Game): Standings =>
  subject.kind === 'duel'
    ? { kind: 'duel', startedAt: subject.startedAt, rows: [] }
    : {
        kind: 'points',
        startedAt: subject.startedAt,
        lowerWins: subject.lowerWins,
        rows: [],
      };

/** The API with the games and each game's ranking (none recorded unless given). */
function api(
  games: Game[],
  standings: Record<number, Standings | Response> = {},
) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      if (url === '/api/games') return json({ games });
      const id = Number(/^\/api\/games\/(\d+)\/standings$/.exec(url)?.[1]);
      const subject = games.find((candidate) => candidate.id === id);
      if (subject) {
        const answer = standings[id] ?? noRows(subject);
        return answer instanceof Response ? answer : json(answer);
      }
      throw new Error(`unexpected ${url}`);
    }),
  );
}

const SCHACH: Standings = {
  kind: 'duel',
  startedAt: STARTED,
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
    {
      personId: 6,
      name: 'Tom',
      points: 0.5,
      wins: 0,
      draws: 1,
      losses: 2,
      played: 3,
    },
  ],
};

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

  it('shows a duel’s leader on the amber card and everyone else ranked with record and points', async () => {
    api([game(1, 'Schach', 'duel')], { 1: SCHACH });

    wrapper = await spiel(1);

    const leader = wrapper.get('.game-leader');
    expect(leader.text()).toContain('Anna');
    expect(leader.get('.game-leader__value').text()).toBe('3,5');
    expect(leader.text()).toContain('3,5 Punkte');
    expect(leader.text()).toContain('5 Partien · 3 S · 1 R · 1 N');
    expect(
      wrapper.findAll('.game-rank').map((row) => row.attributes('aria-label')),
    ).toEqual([
      'Platz 2, Ben, 2 Punkte, 4 Partien · 2 S · 0 R · 2 N',
      'Platz 3, Tom, 0,5 Punkte, 3 Partien · 0 S · 1 R · 2 N',
    ]);
    expect(wrapper.text()).not.toContain('noch keine Partien');
  });

  it('shows a points game’s sums with a real minus sign and result counts in the game’s direction', async () => {
    api([game(2, 'Rommé', 'points', { lowerWins: true })], {
      2: {
        kind: 'points',
        startedAt: STARTED,
        lowerWins: true,
        rows: [
          { personId: 3, name: 'Daniel', sum: -11, results: 2 },
          { personId: 2, name: 'Ben', sum: 39, results: 2 },
        ],
      },
    });

    wrapper = await spiel(2);

    expect(
      wrapper
        .findAll('[data-test="game-place"]')
        .map((place) => place.attributes('aria-label')),
    ).toEqual([
      'Platz 1, Daniel, −11 Punkte, 2 Ergebnisse',
      'Platz 2, Ben, 39 Punkte, 2 Ergebnisse',
    ]);
    expect(wrapper.get('.game-leader__value').text()).toBe('−11');
  });

  it('shows maintenance in the snackbar when the ranking cannot be read', async () => {
    // A game no screen has read the ranking of yet.
    api([game(5, 'Dame', 'duel')], {
      5: maintenance(),
    });

    wrapper = await spiel(5);

    expect(useSnackbar().value?.text).toBe(
      'Wird aktualisiert – gleich wieder da',
    );
    expect(wrapper.find('.game-leader').exists()).toBe(false);
  });

  it('shows the ranking read again after the device’s own write', async () => {
    api([game(1, 'Schach', 'duel')]);
    wrapper = await spiel(1);
    expect(wrapper.text()).toContain('Seit dem Start noch keine Partien.');

    api([game(1, 'Schach', 'duel')], { 1: SCHACH });
    await refreshStandings(1);
    await flushPromises();

    expect(wrapper.get('.game-leader').text()).toContain('Anna');
  });

  it('leads back to Spiele with “Nicht mehr vorhanden” when the game no longer exists', async () => {
    api([game(1, 'Schach', 'duel')]);

    wrapper = await spiel(7);

    expect(router.currentRoute.value.path).toBe('/spiele');
    expect(useSnackbar().value?.text).toBe('Nicht mehr vorhanden');
  });
});

describe('keeping a game’s page current', () => {
  const zone = process.env.TZ;
  let wrapper: VueWrapper | undefined;

  beforeEach(() => {
    process.env.TZ = 'Europe/Berlin';
    vi.useFakeTimers({ now: new Date('2026-11-15T22:41:00Z') });
    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      get: () => 'visible',
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

  /** The API with one game whose ranking has the given ETag; `answer` decides each ranking request. */
  function serve(
    subject: Game,
    answer: (ifNoneMatch: string | undefined) => Response | Promise<Response>,
  ) {
    const asked: (string | undefined)[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init: RequestInit) => {
        if (url === '/api/games') return json({ games: [subject] });
        const ifNoneMatch = (init.headers as Record<string, string>)[
          'If-None-Match'
        ];
        asked.push(ifNoneMatch);
        return answer(ifNoneMatch);
      }),
    );
    return asked;
  }

  const tagged = (body: Standings, etag: string) => {
    const answer = json(body);
    answer.headers.set('ETag', etag);
    return answer;
  };

  it('asks for the ranking every 10 s on condition of its ETag and at once on focus, showing what changed', async () => {
    let current = SCHACH;
    const asked = serve(game(21, 'Schach', 'duel'), (ifNoneMatch) =>
      ifNoneMatch === `"${String(current.rows.length)}"`
        ? new Response(null, { status: 304 })
        : tagged(current, `"${String(current.rows.length)}"`),
    );
    wrapper = await spiel(21);
    expect(wrapper.findAll('.game-rank')).toHaveLength(2);

    await vi.advanceTimersByTimeAsync(10_000);
    expect(asked).toEqual([undefined, '"3"']);

    current = { ...SCHACH, rows: SCHACH.rows.slice(0, 2) };
    window.dispatchEvent(new Event('focus'));
    await flushPromises();

    expect(asked).toEqual([undefined, '"3"', '"3"']);
    expect(wrapper.findAll('.game-rank')).toHaveLength(1);
  });

  it('keeps the last ranking with “Stand: hh:mm” in the top bar when a refresh fails, and retries after 5 s', async () => {
    let online = true;
    const asked = serve(game(22, 'Schach', 'duel'), () =>
      online
        ? tagged(SCHACH, '"1"')
        : Promise.reject(new TypeError('Failed to fetch')),
    );
    wrapper = await spiel(22);
    expect(wrapper.text()).not.toContain('Stand');

    online = false;
    await vi.advanceTimersByTimeAsync(10_000);
    await flushPromises();

    expect(wrapper.get('.game-leader').text()).toContain('Anna');
    expect(wrapper.get('.top-bar').text()).toContain('Stand: 23:41');

    online = true;
    await vi.advanceTimersByTimeAsync(5_000);
    await flushPromises();
    expect(asked).toHaveLength(3);
    expect(wrapper.text()).not.toContain('Stand');
  });

  it('stops asking once the page is left', async () => {
    const asked = serve(game(23, 'Schach', 'duel'), () =>
      tagged(SCHACH, '"1"'),
    );
    wrapper = await spiel(23);

    await router.push('/spiele');
    await vi.advanceTimersByTimeAsync(60_000);

    expect(asked).toHaveLength(1);
  });
});
