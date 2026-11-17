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
import type { Game, MatchItem, ResultItem } from '../../core/api-client';
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
import SpielVerlaufPage from './SpielVerlaufPage.vue';

const STARTED = '2026-09-15T10:00:00.000Z';
const games: Game[] = [
  {
    id: 1,
    name: 'Rommé',
    kind: 'points',
    drawsAllowed: true,
    lowerWins: true,
    startedAt: STARTED,
  },
  {
    id: 2,
    name: 'Schach',
    kind: 'duel',
    drawsAllowed: true,
    lowerWins: false,
    startedAt: STARTED,
  },
];

const anna = { id: 1, name: 'Anna' };
const ben = { id: 2, name: 'Ben' };
const daniel = { id: 3, name: 'Daniel' };

/** Schach's matches, newest first, as the API pages them. */
function schach(): MatchItem[] {
  return [
    {
      id: 'm3',
      first: anna,
      second: ben,
      outcome: 'first',
      createdAt: '2026-11-15T20:00:00.000Z',
      accountName: 'anna',
      pending: false,
    },
    {
      id: 'm2',
      first: null,
      second: ben,
      outcome: 'draw',
      createdAt: '2026-11-08T20:00:00.000Z',
      accountName: null,
      pending: false,
    },
    {
      id: 'm1',
      first: daniel,
      second: anna,
      outcome: 'second',
      createdAt: '2026-11-01T20:00:00.000Z',
      accountName: 'daniel',
      pending: false,
    },
  ];
}

/** Tonight's Rommé, newest first. */
function romme(): ResultItem[] {
  return [
    {
      id: 'r2',
      person: daniel,
      points: -20,
      createdAt: '2026-11-15T21:12:00.000Z',
      accountName: 'anna',
      pending: false,
    },
    {
      id: 'r1',
      person: anna,
      points: 35,
      createdAt: '2026-11-15T20:05:00.000Z',
      accountName: 'ben',
      pending: false,
    },
  ];
}

interface Call {
  method: string;
  url: string;
}

/**
A fake API: the games, each game's Verlauf in pages of `size` (the cursor is the
index of the next item), deletes that remove the item, and the rankings.
*/
function api(
  history: { matches?: MatchItem[]; results?: ResultItem[] },
  {
    size = 20,
    replies = [] as (() => Response)[],
  }: { size?: number; replies?: (() => Response)[] } = {},
) {
  const calls: Call[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init: RequestInit) => {
      const method = init.method ?? 'GET';
      calls.push({ method, url });
      if (url === '/api/games') return json({ games });
      const reply = replies.shift();
      if (reply) return reply();
      const listed =
        /^\/api\/games\/(\d+)\/(matches|results)(?:\?before=(\d+))?$/.exec(url);
      if (listed) {
        const items =
          listed[2] === 'matches' ? history.matches : history.results;
        if (!items) return problem(404, { title: 'Nicht gefunden.' });
        const start = Number(listed[3] ?? 0);
        const end = start + size;
        return json({
          items: items.slice(start, end),
          next: end < items.length ? String(end) : null,
        });
      }
      if (/^\/api\/games\/\d+\/standings$/.test(url)) {
        return json({
          kind: 'duel',
          startedAt: STARTED,
          rows: [],
          unranked: [],
        });
      }
      const removed = /^\/api\/(matches|results)\/(\w+)$/.exec(url);
      if (method === 'DELETE' && removed) {
        const items =
          removed[1] === 'matches' ? history.matches : history.results;
        const index = items?.findIndex((item) => item.id === removed[2]) ?? -1;
        if (index === -1) return problem(404, { title: 'Nicht gefunden.' });
        items?.splice(index, 1);
        return new Response(null, { status: 204 });
      }
      throw new Error(`unexpected ${method} ${url}`);
    }),
  );
  return calls;
}

let router: Router;

/** A game's Verlauf in the shell's top bar, opened from the game's page. */
async function verlauf(gameId: number): Promise<VueWrapper> {
  const blank = { render: () => null };
  router = createRouter({
    history: createMemoryHistory(),
    routes: [
      {
        path: '/spiele/:gameId(\\d+)/verlauf',
        component: SpielVerlaufPage,
        props: true,
        meta: { title: 'Verlauf', destination: 'spiele', child: true },
      },
      {
        path: '/spiele/:gameId(\\d+)',
        component: blank,
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
  await router.push(`/spiele/${String(gameId)}`);
  await router.push(`/spiele/${String(gameId)}/verlauf`);
  const shell = defineComponent(() => () => [h(AppTopBar), h(RouterView)]);
  const wrapper = mount(shell, {
    global: { plugins: [router, createAppVuetify()] },
    attachTo: document.body,
  });
  await flushPromises();
  return wrapper;
}

const rows = (wrapper: VueWrapper) =>
  wrapper.findAll('[data-test="game-history-row"]').map((row) => row.text());

const olderButton = (wrapper: VueWrapper) =>
  wrapper.findAll('button').find((button) => button.text() === 'Ältere laden');

describe('a game’s Verlauf', () => {
  const zone = process.env.TZ;
  let wrapper: VueWrapper | undefined;

  beforeEach(() => {
    process.env.TZ = 'Europe/Berlin';
    vi.useFakeTimers({
      now: new Date('2026-11-15T22:45:00Z'),
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

  it('lists a duel’s matches since the start, newest first, with outcome, local date and time and account', async () => {
    const calls = api({ matches: schach() });

    wrapper = await verlauf(2);

    expect(wrapper.get('h1').text()).toBe('Verlauf');
    expect(wrapper.get('.top-bar__context').text()).toBe(
      'Schach · seit 15.09.',
    );
    expect(calls).toContainEqual({
      method: 'GET',
      url: '/api/games/2/matches',
    });
    expect(rows(wrapper)[0]).toBe(
      'Anna – BenAnna gewinnt · 15.11., 21:00 · anna',
    );
    expect(rows(wrapper)[2]).toBe(
      'Daniel – AnnaAnna gewinnt · 01.11., 21:00 · daniel',
    );
    expect(wrapper.find('ul[aria-label="Verlauf"]').exists()).toBe(true);
  });

  it('moves the context line of a game started today to its date on a later day', async () => {
    // On the day of the run's start (12:00 in Berlin).
    vi.setSystemTime(new Date('2026-09-15T21:00:00Z'));
    api({ results: romme() });
    wrapper = await verlauf(1);
    expect(wrapper.get('.top-bar__context').text()).toBe(
      'Rommé · seit heute, 12:00',
    );

    vi.setSystemTime(new Date('2026-09-15T22:05:00Z'));
    document.dispatchEvent(new Event('visibilitychange'));
    await flushPromises();

    expect(wrapper.get('.top-bar__context').text()).toBe('Rommé · seit 15.09.');
  });

  it('lists a points game’s results with their points, local date and time and account', async () => {
    api({ results: romme() });

    wrapper = await verlauf(1);

    expect(wrapper.get('.top-bar__context').text()).toBe('Rommé · seit 15.09.');
    expect(rows(wrapper)).toEqual([
      'Daniel · −20 Punkte15.11., 22:12 · anna',
      'Anna · 35 Punkte15.11., 21:05 · ben',
    ]);
  });

  it('marks a match that waits for verification offen', async () => {
    const [waiting, ...rest] = schach();
    api({ matches: [{ ...(waiting as MatchItem), pending: true }, ...rest] });

    wrapper = await verlauf(2);

    const marked = wrapper
      .findAll('[data-test="game-history-row"]')
      .map((row) => row.find('[data-test="pending"]'));
    expect(marked.map((marker) => marker.exists())).toEqual([
      true,
      false,
      false,
    ]);
    expect(marked[0]?.text()).toBe('offen');
  });

  it('marks a result that waits for verification offen', async () => {
    const [waiting, ...rest] = romme();
    api({ results: [{ ...(waiting as ResultItem), pending: true }, ...rest] });

    wrapper = await verlauf(1);

    const marked = wrapper
      .findAll('[data-test="game-history-row"]')
      .map((row) => row.find('[data-test="pending"]'));
    expect(marked.map((marker) => marker.exists())).toEqual([true, false]);
    expect(marked[0]?.text()).toBe('offen');
  });

  it('reads a deleted side as “gelöschte Person” and a deleted account as “gelöschtes Konto”', async () => {
    api({ matches: schach() });

    wrapper = await verlauf(2);

    expect(rows(wrapper)[1]).toBe(
      'gelöschte Person – BenRemis · 08.11., 21:00 · gelöschtes Konto',
    );
  });

  it('appends the next older page with “Ältere laden” and drops the button on the last page', async () => {
    const calls = api({ matches: schach() }, { size: 2 });
    wrapper = await verlauf(2);
    expect(rows(wrapper)).toHaveLength(2);

    const older = olderButton(wrapper);
    expect(older).toBeDefined();
    await older?.trigger('click');
    await flushPromises();

    expect(calls).toContainEqual({
      method: 'GET',
      url: '/api/games/2/matches?before=2',
    });
    expect(rows(wrapper)).toEqual([
      'Anna – BenAnna gewinnt · 15.11., 21:00 · anna',
      'gelöschte Person – BenRemis · 08.11., 21:00 · gelöschtes Konto',
      'Daniel – AnnaAnna gewinnt · 01.11., 21:00 · daniel',
    ]);
    expect(olderButton(wrapper)).toBeUndefined();
  });

  it('keeps what is loaded and shows the problem title when an older page fails', async () => {
    api(
      { matches: schach() },
      {
        size: 2,
        replies: [
          () => json({ items: schach().slice(0, 2), next: '2' }),
          () => problem(503, { title: 'Wartung.' }),
        ],
      },
    );
    wrapper = await verlauf(2);

    await olderButton(wrapper)?.trigger('click');
    await flushPromises();

    expect(useSnackbar().value?.text).toBe('Wartung.');
    expect(rows(wrapper)).toHaveLength(2);
    expect(olderButton(wrapper)).toBeDefined();
  });

  it('says so when nothing was recorded since the start', async () => {
    api({ matches: [] });

    wrapper = await verlauf(2);

    expect(wrapper.text()).toContain('Seit dem Start noch keine Partien.');
    expect(olderButton(wrapper)).toBeUndefined();
  });

  it('deletes a match after “Partie löschen?”, says so and reads the ranking again', async () => {
    const calls = api({ matches: schach() });
    wrapper = await verlauf(2);

    await click(buttonIn(document, 'Anna – Ben vom 15.11. löschen'));
    expect(dialog().querySelector('h2')?.textContent).toBe('Partie löschen?');
    expect(dialog().textContent).toContain(
      'Anna – Ben · Anna gewinnt am 15.11. um 21:00',
    );
    const read = calls.length;
    await click(buttonIn(dialog(), 'Löschen'));

    expect(calls).toContainEqual({ method: 'DELETE', url: '/api/matches/m3' });
    expect(useSnackbar().value?.text).toBe('Partie gelöscht');
    expect(rows(wrapper)).toHaveLength(2);
    expect(rows(wrapper)[0]).toContain('gelöschte Person – Ben');
    expect(
      calls.slice(read).some(({ url }) => url === '/api/games/2/standings'),
    ).toBe(true);
  });

  it('deletes a result after “Ergebnis löschen?” naming it', async () => {
    const calls = api({ results: romme() });
    wrapper = await verlauf(1);

    await click(buttonIn(document, 'Daniel · −20 Punkte vom 15.11. löschen'));
    expect(dialog().querySelector('h2')?.textContent).toBe('Ergebnis löschen?');
    expect(dialog().textContent).toContain(
      'Daniel · −20 Punkte am 15.11. um 22:12',
    );
    await click(buttonIn(dialog(), 'Löschen'));

    expect(calls).toContainEqual({ method: 'DELETE', url: '/api/results/r2' });
    expect(useSnackbar().value?.text).toBe('Ergebnis gelöscht');
    expect(rows(wrapper)).toEqual(['Anna · 35 Punkte15.11., 21:05 · ben']);
    expect(calls.some(({ url }) => url === '/api/games/1/standings')).toBe(
      true,
    );
  });

  it('keeps the match when the dialog is cancelled', async () => {
    const calls = api({ matches: schach() });
    wrapper = await verlauf(2);

    await click(buttonIn(document, 'Anna – Ben vom 15.11. löschen'));
    await click(buttonIn(dialog(), 'Abbrechen'));

    expect(calls.some(({ method }) => method === 'DELETE')).toBe(false);
    expect(rows(wrapper)).toHaveLength(3);
  });

  it('treats a match deleted meanwhile on another phone as deleted', async () => {
    api(
      { matches: schach() },
      {
        replies: [
          () => json({ items: schach(), next: null }),
          () => problem(404, { title: 'Nicht gefunden.' }),
        ],
      },
    );
    wrapper = await verlauf(2);

    await click(buttonIn(document, 'Anna – Ben vom 15.11. löschen'));
    await click(buttonIn(dialog(), 'Löschen'));

    expect(useSnackbar().value?.text).toBe('Partie gelöscht');
    expect(rows(wrapper)).toHaveLength(2);
  });

  it('shows the problem title and keeps the match when the delete fails', async () => {
    api(
      { matches: schach() },
      {
        replies: [
          () => json({ items: schach(), next: null }),
          () => problem(503, { title: 'Wartung.' }),
        ],
      },
    );
    wrapper = await verlauf(2);

    await click(buttonIn(document, 'Anna – Ben vom 15.11. löschen'));
    await click(buttonIn(dialog(), 'Löschen'));

    expect(useSnackbar().value?.text).toBe('Wartung.');
    expect(rows(wrapper)).toHaveLength(3);
  });

  it('returns to Spiele with “Nicht mehr vorhanden” when the game is gone', async () => {
    api({ matches: schach() });

    wrapper = await verlauf(7);

    await vi.waitFor(() => {
      expect(router.currentRoute.value.path).toBe('/spiele');
    });
    expect(useSnackbar().value?.text).toBe('Nicht mehr vorhanden');
  });

  it('returns to Spiele when the game is deleted while its Verlauf opens', async () => {
    api({});

    wrapper = await verlauf(2);

    await vi.waitFor(() => {
      expect(router.currentRoute.value.path).toBe('/spiele');
    });
    expect(useSnackbar().value?.text).toBe('Nicht mehr vorhanden');
  });
});

describe('a game’s Verlauf across a restart', () => {
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

  /**
  A fake API whose Schach has runs, as the real one: the first page reads the
  current run, a cursor (`<run>-<index>`) keeps the run it was given in, and
  `restart()` starts the next run, empty, from now.
  */
  function runsApi(firstRun: MatchItem[], size: number) {
    let schachGame = games.find(({ id }) => id === 2) as Game;
    const runs: MatchItem[][] = [firstRun];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        if (url === '/api/games') return json({ games: [schachGame] });
        const listed =
          /^\/api\/games\/2\/matches(?:\?before=(\d+)-(\d+))?$/.exec(url);
        if (!listed) throw new Error(`unexpected ${url}`);
        const run = listed[1] === undefined ? runs.length : Number(listed[1]);
        const start = Number(listed[2] ?? 0);
        const items = runs[run - 1] ?? [];
        const end = start + size;
        return json({
          items: items.slice(start, end),
          next: end < items.length ? `${String(run)}-${String(end)}` : null,
        });
      }),
    );
    return {
      restart() {
        runs.push([]);
        schachGame = { ...schachGame, startedAt: new Date().toISOString() };
      },
    };
  }

  it('keeps paging in the run it opened with when the game restarts meanwhile', async () => {
    const schachRuns = runsApi(schach(), 2);
    wrapper = await verlauf(2);
    expect(rows(wrapper)).toHaveLength(2);

    schachRuns.restart();
    await olderButton(wrapper)?.trigger('click');
    await flushPromises();

    expect(rows(wrapper)).toEqual([
      'Anna – BenAnna gewinnt · 15.11., 21:00 · anna',
      'gelöschte Person – BenRemis · 08.11., 21:00 · gelöschtes Konto',
      'Daniel – AnnaAnna gewinnt · 01.11., 21:00 · daniel',
    ]);
  });

  it('shows the new run, empty since today, when reopened after a restart', async () => {
    const schachRuns = runsApi(schach(), 2);
    wrapper = await verlauf(2);
    wrapper.unmount();

    schachRuns.restart();
    wrapper = await verlauf(2);

    expect(wrapper.get('.top-bar__context').text()).toBe(
      'Schach · seit heute, 19:30',
    );
    expect(rows(wrapper)).toEqual([]);
    expect(wrapper.text()).toContain('Seit dem Start noch keine Partien.');
  });
});
