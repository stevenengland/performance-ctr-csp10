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
import {
  buttonIn,
  click,
  dialog,
  json,
  problem,
  stubDialogEnvironment,
} from '../verwalten/manage-page-harness';

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
    ? { kind: 'duel', startedAt: subject.startedAt, rows: [], unranked: [] }
    : {
        kind: 'points',
        startedAt: subject.startedAt,
        lowerWins: subject.lowerWins,
        rows: [],
        unranked: [],
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
      pendingCount: 0,
    },
    {
      personId: 2,
      name: 'Ben',
      points: 2,
      wins: 2,
      draws: 0,
      losses: 2,
      played: 4,
      pendingCount: 0,
    },
    {
      personId: 6,
      name: 'Tom',
      points: 0.5,
      wins: 0,
      draws: 1,
      losses: 2,
      played: 3,
      pendingCount: 0,
    },
  ],
  unranked: [],
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
        path: '/spiele/:gameId(\\d+)/verlauf',
        component: blank,
        meta: { title: 'Verlauf', destination: 'spiele', child: true },
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

  it('lists the players whose matches all wait under Noch nicht gewertet instead of saying none were played', async () => {
    api([game(1, 'Schach', 'duel')], {
      1: {
        kind: 'duel',
        startedAt: STARTED,
        rows: [],
        unranked: [
          { personId: 1, name: 'Anna', pendingCount: 1 },
          { personId: 2, name: 'Ben', pendingCount: 1 },
        ],
      },
    });

    wrapper = await spiel(1);

    expect(wrapper.text()).not.toContain('Seit dem Start noch keine Partien.');
    expect(wrapper.find('.game-leader').exists()).toBe(false);
    expect(
      wrapper
        .findAll('[data-test="game-unranked"]')
        .map((row) => row.attributes('aria-label')),
    ).toEqual(['Anna, +1 offen', 'Ben, +1 offen']);
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

  it('moves the context line of a game started today to its date on a later day', async () => {
    api([
      game(2, 'Rommé', 'points', { startedAt: '2026-11-15T18:30:00.000Z' }),
    ]);
    wrapper = await spiel(2);
    // The morning's network is slow: the ranking read on resume has not answered yet.
    vi.stubGlobal(
      'fetch',
      vi.fn(() => new Promise<Response>(() => undefined)),
    );

    vi.setSystemTime(new Date('2026-11-16T00:05:00Z'));
    document.dispatchEvent(new Event('visibilitychange'));
    await flushPromises();

    expect(wrapper.get('.top-bar__context').text()).toBe(
      'Punktespiel · seit 15.11.',
    );
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
          {
            personId: 3,
            name: 'Daniel',
            sum: -11,
            results: 2,
            pendingCount: 0,
          },
          { personId: 2, name: 'Ben', sum: 39, results: 2, pendingCount: 0 },
        ],
        unranked: [],
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

  it('ranks only who has a counting result and lists who only waits apart, even on a pending zero in a lowest-wins game', async () => {
    api([game(2, 'Rommé', 'points', { lowerWins: true })], {
      2: {
        kind: 'points',
        startedAt: STARTED,
        lowerWins: true,
        rows: [
          {
            personId: 3,
            name: 'Daniel',
            sum: -11,
            results: 2,
            pendingCount: 1,
          },
          { personId: 2, name: 'Ben', sum: 39, results: 2, pendingCount: 0 },
        ],
        unranked: [{ personId: 4, name: 'Jule', pendingCount: 1 }],
      },
    });

    wrapper = await spiel(2);

    expect(
      wrapper
        .findAll('[data-test="game-place"]')
        .map((place) => place.attributes('aria-label')),
    ).toEqual([
      'Platz 1, Daniel, −11 Punkte, 2 Ergebnisse, +1 offen',
      'Platz 2, Ben, 39 Punkte, 2 Ergebnisse',
    ]);
    expect(wrapper.get('.game-leader__value').text()).toBe('−11');
    expect(
      wrapper
        .findAll('[data-test="game-unranked"]')
        .map((row) => row.attributes('aria-label')),
    ).toEqual(['Jule, +1 offen']);
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

  it('opens the game’s Verlauf from “Verlauf” under the ranking', async () => {
    api([game(1, 'Schach', 'duel')], { 1: SCHACH });
    wrapper = await spiel(1);

    const link = wrapper
      .findAll('a')
      .find((candidate) => candidate.text() === 'Verlauf');
    expect(link?.attributes('href')).toBe('/spiele/1/verlauf');
    await link?.trigger('click');

    // The page's dialog lets a navigation through one timer tick later.
    await vi.waitFor(() => {
      expect(router.currentRoute.value.path).toBe('/spiele/1/verlauf');
    });
  });

  it('leads back to Spiele with “Nicht mehr vorhanden” when the game no longer exists', async () => {
    api([game(1, 'Schach', 'duel')]);

    wrapper = await spiel(7);

    await vi.waitFor(() => {
      expect(router.currentRoute.value.path).toBe('/spiele');
    });
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
    subject: Game | (() => Game),
    answer: (ifNoneMatch: string | undefined) => Response | Promise<Response>,
  ) {
    const asked: (string | undefined)[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init: RequestInit) => {
        if (url === '/api/games')
          return json({
            games: [typeof subject === 'function' ? subject() : subject],
          });
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

  it('shows the start and the rule the ranking was read with after a restart or rule edit on another device', async () => {
    const before = game(24, 'Rommé', 'points');
    let current: Standings = noRows(before);
    serve(before, () => json(current));
    wrapper = await spiel(24);
    expect(wrapper.get('.top-bar__context').text()).toBe(
      'Punktespiel · seit 15.09.',
    );
    expect(wrapper.get('.spiel__rule').text()).toBe('Höchste Summe gewinnt');

    current = {
      kind: 'points',
      startedAt: '2026-11-15T21:00:00.000Z',
      lowerWins: true,
      rows: [],
      unranked: [],
    };
    await vi.advanceTimersByTimeAsync(10_000);

    expect(wrapper.get('.top-bar__context').text()).toBe(
      'Punktespiel · seit heute, 22:00',
    );
    expect(wrapper.get('.spiel__rule').text()).toBe('Niedrigste Summe gewinnt');
  });

  it.each([
    ['focus', () => window.dispatchEvent(new Event('focus'))],
    [
      'return to the page',
      () => document.dispatchEvent(new Event('visibilitychange')),
    ],
  ])(
    'shows a rename and a draw-setting change made on another device on %s',
    async (_, resume) => {
      let current = game(25, 'Schach', 'duel');
      serve(
        () => current,
        () => json(noRows(current)),
      );
      wrapper = await spiel(25);
      expect(wrapper.get('h1').text()).toBe('Schach');
      expect(wrapper.get('.spiel__rule').text()).toBe('Remis möglich');

      current = { ...current, name: 'Blitzschach', drawsAllowed: false };
      resume();
      await flushPromises();

      expect(wrapper.get('h1').text()).toBe('Blitzschach');
      expect(wrapper.get('.spiel__rule').text()).toBe('Kein Remis');
    },
  );

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

  it('leads back to Spiele with “Nicht mehr vorhanden” once the game is deleted on another device', async () => {
    let deleted = false;
    const asked = serve(game(24, 'Schach', 'duel'), () =>
      deleted
        ? new Response(
            JSON.stringify({
              type: 'urn:performance:problem:not-found',
              title: 'Nicht gefunden',
              status: 404,
            }),
            {
              status: 404,
              headers: { 'Content-Type': 'application/problem+json' },
            },
          )
        : tagged(SCHACH, '"1"'),
    );
    wrapper = await spiel(24);

    deleted = true;
    await vi.advanceTimersByTimeAsync(10_000);

    await vi.waitFor(() => {
      expect(router.currentRoute.value.path).toBe('/spiele');
    });
    expect(useSnackbar().value?.text).toBe('Nicht mehr vorhanden');
    await vi.advanceTimersByTimeAsync(120_000);
    expect(asked).toHaveLength(2);
  });

  it('stops asking once the page is left', async () => {
    const asked = serve(game(23, 'Schach', 'duel'), () =>
      tagged(SCHACH, '"1"'),
    );
    wrapper = await spiel(23);

    // The page's dialog lets a navigation through one timer tick later.
    const left = router.push('/spiele');
    await vi.advanceTimersByTimeAsync(60_000);
    await left;

    expect(asked).toHaveLength(1);
  });
});

describe('restarting a game', () => {
  const zone = process.env.TZ;
  let wrapper: VueWrapper | undefined;

  beforeEach(() => {
    process.env.TZ = 'Europe/Berlin';
    // 19:30 in Berlin.
    vi.useFakeTimers({
      now: new Date('2026-11-15T18:30:00Z'),
      toFake: ['Date'],
    });
    dismissSnackbar();
    stubDialogEnvironment();
  });
  afterEach(() => {
    wrapper?.unmount();
    wrapper = undefined;
    document.body.innerHTML = '';
    vi.useRealTimers();
    vi.unstubAllGlobals();
    process.env.TZ = zone;
  });

  interface Call {
    method: string;
    url: string;
    body?: unknown;
  }

  /**
  The API with one duel: its ranking holds SCHACH until a restart starts the next
  run from now, after which it is empty; `restart` answers the restart instead.
  */
  function restartable(subject: Game, restart?: () => Response) {
    const calls: Call[] = [];
    let current = { ...subject };
    let restarted = false;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init: RequestInit) => {
        const method = init.method ?? 'GET';
        calls.push({
          method,
          url,
          ...(typeof init.body === 'string'
            ? { body: JSON.parse(init.body) as unknown }
            : {}),
        });
        if (url === '/api/games') return json({ games: [current] });
        if (url === `/api/games/${String(subject.id)}/standings`) {
          return json(
            restarted
              ? {
                  kind: 'duel',
                  startedAt: current.startedAt,
                  rows: [],
                  unranked: [],
                }
              : SCHACH,
          );
        }
        if (
          method === 'POST' &&
          url === `/api/games/${String(subject.id)}/restart`
        ) {
          if (restart) return restart();
          restarted = true;
          current = { ...current, startedAt: new Date().toISOString() };
          return json(current);
        }
        throw new Error(`unexpected ${method} ${url}`);
      }),
    );
    return calls;
  }

  it('asks before restarting, then restarts the game and says so', async () => {
    const calls = restartable(game(31, 'Schach', 'duel'));
    wrapper = await spiel(31);

    await click(buttonIn(document, 'Neu starten'));

    expect(dialog().querySelector('h2')?.textContent).toBe(
      'Schach neu starten?',
    );
    expect(dialog().textContent).toContain(
      'Die Rangliste beginnt wieder bei null. Bisherige Ergebnisse bleiben gespeichert, werden aber nicht mehr angezeigt.',
    );
    expect(calls.some(({ method }) => method === 'POST')).toBe(false);

    await click(buttonIn(dialog(), 'Neu starten'));

    expect(calls).toContainEqual({
      method: 'POST',
      url: '/api/games/31/restart',
      body: {},
    });
    expect(useSnackbar().value?.text).toBe('Schach neu gestartet');
    expect(document.querySelector('.v-overlay--active')).toBeNull();
  });

  it('restarts nothing when the question is cancelled', async () => {
    const calls = restartable(game(32, 'Schach', 'duel'));
    wrapper = await spiel(32);

    await click(buttonIn(document, 'Neu starten'));
    await click(buttonIn(dialog(), 'Abbrechen'));

    expect(calls.some(({ method }) => method === 'POST')).toBe(false);
    expect(wrapper.get('.game-leader').text()).toContain('Anna');
  });

  it('shows the new run after a restart: an empty ranking since today', async () => {
    restartable(game(33, 'Schach', 'duel'));
    wrapper = await spiel(33);
    expect(wrapper.get('.game-leader').text()).toContain('Anna');
    expect(wrapper.get('.top-bar__context').text()).toBe('Duell · seit 15.09.');

    await click(buttonIn(document, 'Neu starten'));
    await click(buttonIn(dialog(), 'Neu starten'));

    expect(wrapper.find('.game-leader').exists()).toBe(false);
    expect(wrapper.text()).toContain('Seit dem Start noch keine Partien.');
    expect(wrapper.get('.top-bar__context').text()).toBe(
      'Duell · seit heute, 19:30',
    );
  });

  it('reports a restart the server took as done even when the games cannot be read after it', async () => {
    const calls = restartable(game(35, 'Schach', 'duel'));
    wrapper = await spiel(35);
    const answer = vi.mocked(fetch).getMockImplementation();
    vi.mocked(fetch).mockImplementation(async (url, init) =>
      url === '/api/games'
        ? problem(503, { title: 'Wird aktualisiert – gleich wieder da' })
        : (answer?.(url, init) ?? Promise.reject(new Error('no answer'))),
    );

    await click(buttonIn(document, 'Neu starten'));
    await click(buttonIn(dialog(), 'Neu starten'));

    expect(useSnackbar().value?.text).toBe('Schach neu gestartet');
    expect(document.querySelector('.v-overlay--active')).toBeNull();
    expect(calls.filter(({ method }) => method === 'POST')).toHaveLength(1);
    expect(wrapper.text()).toContain('Seit dem Start noch keine Partien.');
    expect(wrapper.get('.top-bar__context').text()).toBe(
      'Duell · seit heute, 19:30',
    );
  });

  it('shows the new run after a restart even when the ranking cannot be read after it', async () => {
    restartable(game(36, 'Schach', 'duel'));
    wrapper = await spiel(36);
    expect(wrapper.get('.game-leader').text()).toContain('Anna');
    const answer = vi.mocked(fetch).getMockImplementation();
    vi.mocked(fetch).mockImplementation(async (url, init) =>
      url === '/api/games/36/standings'
        ? problem(503, { title: 'Wird aktualisiert – gleich wieder da' })
        : (answer?.(url, init) ?? Promise.reject(new Error('no answer'))),
    );

    await click(buttonIn(document, 'Neu starten'));
    await click(buttonIn(dialog(), 'Neu starten'));

    expect(useSnackbar().value?.text).toBe('Schach neu gestartet');
    expect(wrapper.get('.top-bar__context').text()).toBe(
      'Duell · seit heute, 19:30',
    );
    expect(wrapper.find('.game-leader').exists()).toBe(false);
    expect(wrapper.text()).toContain('Seit dem Start noch keine Partien.');
  });

  it('keeps the ranking and shows the problem when the restart fails', async () => {
    restartable(game(34, 'Schach', 'duel'), () =>
      problem(503, { title: 'Wird aktualisiert – gleich wieder da' }),
    );
    wrapper = await spiel(34);

    await click(buttonIn(document, 'Neu starten'));
    await click(buttonIn(dialog(), 'Neu starten'));

    expect(useSnackbar().value?.text).toBe(
      'Wird aktualisiert – gleich wieder da',
    );
    expect(wrapper.get('.game-leader').text()).toContain('Anna');
    expect(wrapper.get('.top-bar__context').text()).toBe('Duell · seit 15.09.');
    expect(document.querySelector('.v-overlay--active')).not.toBeNull();
  });
});

describe('a game’s periods', () => {
  const zone = process.env.TZ;
  let wrapper: VueWrapper | undefined;

  /** Sunday 15.11.2026, Monday 09.11. its week's start, in Berlin. */
  const TODAY = '?from=2026-11-14T23:00:00.000Z&to=2026-11-15T23:00:00.000Z';
  const SATURDAY = '?from=2026-11-13T23:00:00.000Z&to=2026-11-14T23:00:00.000Z';
  const THIS_WEEK =
    '?from=2026-11-08T23:00:00.000Z&to=2026-11-15T23:00:00.000Z';
  const ALL = '?scope=all';
  /** The quarter hours Rommé was played: 28.10. and 14.11. twice. */
  const ROMME_DAYS = [
    '2026-10-28T19:00:00.000Z',
    '2026-11-14T20:00:00.000Z',
    '2026-11-14T20:15:00.000Z',
  ];

  beforeEach(() => {
    process.env.TZ = 'Europe/Berlin';
    vi.useFakeTimers({
      now: new Date('2026-11-15T22:41:00Z'),
      toFake: ['Date', 'setTimeout', 'clearTimeout'],
    });
    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      get: () => 'visible',
    });
    stubDialogEnvironment();
    dismissSnackbar();
  });
  afterEach(() => {
    wrapper?.unmount();
    wrapper = undefined;
    document.body.innerHTML = '';
    vi.useRealTimers();
    vi.unstubAllGlobals();
    process.env.TZ = zone;
  });

  const ROMME = game(41, 'Rommé', 'points', { lowerWins: true });
  const pointsOf = (
    ...rows: [number, string, number, number, number?][]
  ): Standings => ({
    kind: 'points',
    startedAt: STARTED,
    lowerWins: true,
    rows: rows.map(([personId, name, sum, results, pendingCount = 0]) => ({
      personId,
      name,
      sum,
      results,
      pendingCount,
    })),
    unranked: [],
  });
  const CURRENT = pointsOf([3, 'Daniel', -11, 2]);
  const FOREVER = pointsOf([6, 'Tom', 164, 12], [3, 'Daniel', 199, 14]);

  /**
  The API with the given games: each game's ranking by its query (`''` the current
  run; any other query without an answer is empty), tagged `"1<query>"` and 304 on
  condition of it, and the days it was played; records each ranking request.
  */
  function serve(
    games: Game[],
    rankings: Record<number, Record<string, Standings>>,
    days: Record<number, string[]> = {},
  ) {
    const asked: [string, string | undefined][] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init: RequestInit) => {
        if (url === '/api/games') return json({ games });
        const ifNoneMatch = (init.headers as Record<string, string>)[
          'If-None-Match'
        ];
        const [, id, rest = ''] =
          /^\/api\/games\/(\d+)\/standings(.*)$/.exec(
            decodeURIComponent(url),
          ) ?? [];
        const subject = games.find((candidate) => candidate.id === Number(id));
        if (!subject) throw new Error(`unexpected ${url}`);
        if (rest === '/days') {
          return json({ instants: days[subject.id] ?? [] });
        }
        asked.push([`${String(subject.id)}${rest}`, ifNoneMatch]);
        const etag = `"1${rest}"`;
        if (ifNoneMatch === etag) return new Response(null, { status: 304 });
        const answer = json(rankings[subject.id]?.[rest] ?? noRows(subject));
        answer.headers.set('ETag', etag);
        return answer;
      }),
    );
    return asked;
  }

  const options = () =>
    wrapper
      ?.get('[role="group"][aria-label="Zeitraum"]')
      .findAll('button')
      .map((button) => [button.text(), button.attributes('aria-pressed')]);
  async function choose(kind: 'Aktuell' | 'Tag' | 'Woche' | 'Gesamt') {
    await wrapper
      ?.findAll('[role="group"] button')
      .find((button) => button.text() === kind)
      ?.trigger('click');
    await flushPromises();
  }
  const context = () => wrapper?.get('.top-bar__context').text();
  const places = () =>
    wrapper
      ?.findAll('[data-test="game-place"]')
      .map((place) => place.attributes('aria-label'));
  const back = async () => {
    await wrapper?.get('button[aria-label="Vorheriger Tag"]').trigger('click');
    await flushPromises();
  };

  it('offers Aktuell | Tag | Woche | Gesamt and opens on Aktuell: the current run, live, with its start in the top bar', async () => {
    const asked = serve([ROMME], { 41: { '': CURRENT } });

    wrapper = await spiel(41);
    await vi.advanceTimersByTimeAsync(10_000);

    expect(options()).toEqual([
      ['Aktuell', 'true'],
      ['Tag', 'false'],
      ['Woche', 'false'],
      ['Gesamt', 'false'],
    ]);
    expect(wrapper.find('[data-test="day-bar"]').exists()).toBe(false);
    expect(wrapper.find('.period-line').exists()).toBe(false);
    expect(context()).toBe('Punktespiel · seit 15.09.');
    expect(places()).toEqual(['Platz 1, Daniel, −11 Punkte, 2 Ergebnisse']);
    expect(asked).toEqual([
      ['41', undefined],
      ['41', '"1"'],
    ]);
  });

  it('ranks today under Tag, the day before and the week with their windows, counting earlier runs, the period in the top bar', async () => {
    const asked = serve([ROMME], {
      41: {
        '': CURRENT,
        [TODAY]: pointsOf([3, 'Daniel', -11, 2], [6, 'Tom', 20, 1]),
        [SATURDAY]: pointsOf([6, 'Tom', 12, 3]),
        [THIS_WEEK]: pointsOf([6, 'Tom', 32, 4], [3, 'Daniel', 40, 5]),
      },
    });
    wrapper = await spiel(41);

    await choose('Tag');
    expect(context()).toBe('Punktespiel · Heute');
    expect(places()).toEqual([
      'Platz 1, Daniel, −11 Punkte, 2 Ergebnisse',
      'Platz 2, Tom, 20 Punkte, 1 Ergebnis',
    ]);
    await back();
    expect(context()).toBe('Punktespiel · Samstag, 14.11.2026');
    expect(places()).toEqual(['Platz 1, Tom, 12 Punkte, 3 Ergebnisse']);
    await choose('Woche');

    expect(context()).toBe('Punktespiel · KW 46 · 09.11.–15.11.');
    expect(places()).toEqual([
      'Platz 1, Tom, 32 Punkte, 4 Ergebnisse',
      'Platz 2, Daniel, 40 Punkte, 5 Ergebnisse',
    ]);
    expect(asked.map(([query]) => query)).toEqual([
      '41',
      `41${TODAY}`,
      `41${SATURDAY}`,
      `41${THIS_WEEK}`,
    ]);
  });

  it('ranks all time under Gesamt with scope=all, live, saying since when and over how many days the game was played', async () => {
    const asked = serve(
      [ROMME],
      { 41: { '': CURRENT, [ALL]: FOREVER } },
      {
        41: ROMME_DAYS,
      },
    );
    wrapper = await spiel(41);

    await choose('Gesamt');
    await vi.advanceTimersByTimeAsync(10_000);

    expect(context()).toBe('Punktespiel · Gesamt');
    expect(wrapper.get('.period-line').text()).toBe(
      'Alle Läufe seit 28.10.2026 · 2 Spieltage',
    );
    expect(wrapper.find('[data-test="day-bar"]').exists()).toBe(false);
    expect(places()).toEqual([
      'Platz 1, Tom, 164 Punkte, 12 Ergebnisse',
      'Platz 2, Daniel, 199 Punkte, 14 Ergebnisse',
    ]);
    expect(asked.filter(([query]) => query === `41${ALL}`)).toEqual([
      [`41${ALL}`, undefined],
      [`41${ALL}`, `"1${ALL}"`],
    ]);
  });

  it('counts a single day the game was played as 1 Spieltag', async () => {
    serve([ROMME], {}, { 41: ['2026-11-14T20:00:00.000Z'] });
    wrapper = await spiel(41);

    await choose('Gesamt');

    expect(wrapper.get('.period-line').text()).toBe(
      'Alle Läufe seit 14.11.2026 · 1 Spieltag',
    );
  });

  it('dots the days the game was played in the calendar, described as Gespielt', async () => {
    serve([ROMME], {}, { 41: ROMME_DAYS });
    wrapper = await spiel(41);
    await choose('Tag');

    await wrapper
      .get('[data-test="day-bar"] button.day-bar__day')
      .trigger('click');
    await flushPromises();

    const dialog = document.querySelector('[role="dialog"].v-overlay--active');
    const marked = [
      ...(dialog?.querySelectorAll('.calendar__day--marked') ?? []),
    ];
    expect(marked.map((day) => day.getAttribute('aria-label'))).toEqual([
      'Samstag, 14. November',
    ]);
    const described = marked[0]?.getAttribute('aria-describedby') ?? '';
    expect(document.getElementById(described)?.textContent).toBe('Gespielt');
  });

  it.each([
    ['Tag', 'An diesem Tag wurde nichts gespielt.'],
    ['Woche', 'In dieser Woche wurde nichts gespielt.'],
    ['Gesamt', 'Noch nichts gespielt.'],
  ] as const)(
    'says nothing was played under %s when the period has no match or result at all',
    async (kind, text) => {
      serve([game(42, 'Schach', 'duel')], { 42: { '': SCHACH } });
      wrapper = await spiel(42);

      await choose(kind);

      expect(wrapper.find('.empty-state').text()).toBe(text);
      expect(wrapper.text()).not.toContain('Seit dem Start');
    },
  );

  it('shows a period whose matches all wait as the Noch nicht gewertet group only', async () => {
    serve([game(42, 'Schach', 'duel')], {
      42: {
        [TODAY]: {
          kind: 'duel',
          startedAt: STARTED,
          rows: [],
          unranked: [{ personId: 4, name: 'Jule', pendingCount: 1 }],
        },
      },
    });
    wrapper = await spiel(42);

    await choose('Tag');

    expect(wrapper.find('.empty-state').exists()).toBe(false);
    expect(wrapper.find('.game-leader').exists()).toBe(false);
    expect(
      wrapper
        .findAll('[data-test="game-unranked"]')
        .map((row) => row.attributes('aria-label')),
    ).toEqual(['Jule, +1 offen']);
  });

  it('moves Tag left on Heute on to the new day at midnight', async () => {
    const asked = serve([ROMME], {});
    wrapper = await spiel(41);
    await choose('Tag');

    await vi.advanceTimersByTimeAsync(20 * 60_000);
    window.dispatchEvent(new Event('focus'));
    await flushPromises();

    expect(wrapper.get('[data-test="day-bar"]').text()).toBe('Heute');
    expect(context()).toBe('Punktespiel · Heute');
    expect(asked.at(-1)?.[0]).toBe(
      '41?from=2026-11-15T23:00:00.000Z&to=2026-11-16T23:00:00.000Z',
    );
  });

  it('opens on Aktuell again every time the page opens', async () => {
    serve([ROMME], { 41: { '': CURRENT, [ALL]: FOREVER } });
    wrapper = await spiel(41);
    await choose('Gesamt');
    wrapper.unmount();

    wrapper = await spiel(41);

    expect(options()?.[0]).toEqual(['Aktuell', 'true']);
    expect(context()).toBe('Punktespiel · seit 15.09.');
    expect(places()).toEqual(['Platz 1, Daniel, −11 Punkte, 2 Ergebnisse']);
  });

  it('keeps Verlauf, Neu starten and the record button in every period', async () => {
    serve([ROMME], { 41: { '': CURRENT, [ALL]: FOREVER } });
    wrapper = await spiel(41);

    await choose('Gesamt');

    expect(
      wrapper
        .findAll('a')
        .find((link) => link.text() === 'Verlauf')
        ?.attributes('href'),
    ).toBe('/spiele/41/verlauf');
    expect(wrapper.text()).toContain('Neu starten');
    expect(wrapper.text()).toContain('Ergebnis eintragen');
  });

  it('reads a shown past day again after the device’s own write and on focus, but neither polls it nor the current run meanwhile', async () => {
    const asked = serve([ROMME], { 41: { '': CURRENT } });
    wrapper = await spiel(41);
    await choose('Tag');
    await back();

    await vi.advanceTimersByTimeAsync(60_000);
    await refreshStandings(41);
    window.dispatchEvent(new Event('focus'));
    await flushPromises();

    expect(asked.map(([query]) => query)).toEqual([
      '41',
      `41${TODAY}`,
      `41${SATURDAY}`,
      '41',
      `41${SATURDAY}`,
      `41${SATURDAY}`,
    ]);
  });

  it('shows only the shown period’s ranking when answers arrive out of order, and sends an ETag only with its own period', async () => {
    const asked = serve([ROMME], {
      41: { '': CURRENT, [ALL]: FOREVER, [TODAY]: pointsOf([6, 'Tom', 1, 1]) },
    });
    wrapper = await spiel(41);
    await choose('Gesamt');
    const answer = vi.mocked(fetch).getMockImplementation();
    const held: (() => void)[] = [];
    vi.mocked(fetch).mockImplementation(async (url, init) => {
      if (String(url).includes('scope=all')) {
        await new Promise<void>((resolve) => held.push(resolve));
      }
      return answer?.(url, init) ?? Promise.reject(new Error('no answer'));
    });

    window.dispatchEvent(new Event('focus'));
    await flushPromises();
    await choose('Tag');
    for (const release of held) release();
    await flushPromises();

    expect(places()).toEqual(['Platz 1, Tom, 1 Punkt, 1 Ergebnis']);
    expect(context()).toBe('Punktespiel · Heute');
    expect(asked.filter(([query]) => query !== '41')).toEqual([
      [`41${ALL}`, undefined],
      [`41${TODAY}`, undefined],
      [`41${ALL}`, `"1${ALL}"`],
    ]);
  });

  it('shows the other game’s ranking, never the previous one’s, when another game opens under the same period', async () => {
    serve([ROMME, game(43, 'Kniffel', 'points')], {
      41: { [ALL]: FOREVER },
      43: { [ALL]: pointsOf([1, 'Anna', 300, 3]) },
    });
    wrapper = await spiel(41);
    await choose('Gesamt');
    expect(places()?.[0]).toContain('Tom');

    wrapper.unmount();
    wrapper = await spiel(43);
    await choose('Gesamt');

    expect(places()).toEqual(['Platz 1, Anna, 300 Punkte, 3 Ergebnisse']);
  });
});
