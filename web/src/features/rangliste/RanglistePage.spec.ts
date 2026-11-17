import { type DOMWrapper, flushPromises, mount } from '@vue/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { defineComponent, effectScope, h, ref } from 'vue';
import { createMemoryHistory, createRouter, RouterView } from 'vue-router';
import AppTopBar from '../../components/AppTopBar.vue';
import type { Scoreboard } from '../../core/api-client';
import { calendarDateOf } from '../../core/period';
import {
  refreshScoreboard,
  useScoreboardFeed,
} from '../../core/scoreboard-feed';
import { createAppVuetify } from '../../theme';
import { stubDialogEnvironment } from '../verwalten/manage-page-harness';
import { useChosenPeriod } from './chosen-period';
import RanglistePage from './RanglistePage.vue';

const evening: Scoreboard = {
  rows: [
    {
      personId: 3,
      name: 'Daniel',
      photoUrl: null,
      score: 13.5,
      count: 9,
      pendingCount: 0,
      drinks: [
        { drinkId: 2, name: 'Bier', count: 4, recordedCount: 4 },
        { drinkId: 3, name: 'Margarita', count: 1, recordedCount: 1 },
      ],
    },
    {
      personId: 1,
      name: 'Anna',
      photoUrl: null,
      score: 9,
      count: 6,
      pendingCount: 0,
      drinks: [
        { drinkId: 2, name: 'Bier', count: 3, recordedCount: 3 },
        { drinkId: 6, name: 'Wein', count: 3, recordedCount: 3 },
      ],
    },
    {
      personId: 6,
      name: 'Tom',
      photoUrl: null,
      score: 0.5,
      count: 1,
      pendingCount: 0,
      drinks: [{ drinkId: 4, name: 'Radler', count: 1, recordedCount: 1 }],
    },
  ],
  unranked: [],
};

/** The evening with Daniel's photo at `version`, or without a photo. */
function withDanielsPhoto(version: string | null): Scoreboard {
  return {
    ...evening,
    rows: evening.rows.map((row) =>
      row.personId === 3
        ? {
            ...row,
            photoUrl:
              version === null ? null : `/api/persons/3/photo?v=${version}`,
          }
        : row,
    ),
  };
}

/** The leader's or a row's avatar. */
function avatarIn(place: Pick<DOMWrapper<Element>, 'get'>) {
  const avatar = place.get('.person-avatar').element;
  return {
    size: avatar.getAttribute('style'),
    photo: avatar.querySelector('img')?.getAttribute('src'),
    initials: avatar
      .querySelector('[data-initials]')
      ?.getAttribute('data-initials'),
  };
}

function answer(board: Scoreboard) {
  return () =>
    new Response(JSON.stringify(board), {
      status: 200,
      headers: { 'Content-Type': 'application/json', ETag: '"1-0"' },
    });
}
const offline = () => Promise.reject(new TypeError('Failed to fetch'));

function api(...replies: (() => Response | Promise<Response>)[]) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => {
      const reply = replies.length > 1 ? replies.shift() : replies[0];
      if (!reply) throw new Error('no reply');
      return reply();
    }),
  );
}

/** The Rangliste in the shell's top bar, as the app shows it. */
async function rangliste() {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      {
        path: '/rangliste',
        component: RanglistePage,
        meta: {
          title: 'Rangliste',
          context: 'Heute',
          destination: 'rangliste',
        },
      },
      {
        path: '/zaehlen',
        component: { render: () => null },
        meta: { title: 'Zählen' },
      },
      {
        path: '/konto',
        component: { render: () => null },
        meta: { title: 'Konto' },
      },
      {
        path: '/verlauf/:personId',
        component: { render: () => null },
        meta: { title: 'Verlauf' },
      },
    ],
  });
  await router.push('/rangliste');
  const shell = defineComponent(() => () => [h(AppTopBar), h(RouterView)]);
  const wrapper = mount(shell, {
    global: { plugins: [router, createAppVuetify()] },
  });
  await flushPromises();
  return Object.assign(wrapper, { router });
}

/** Back to today, as a fresh start opens: the chosen period outlives a mounted page. */
function chooseToday() {
  const today = calendarDateOf(new Date());
  useChosenPeriod(ref(today)).value = { kind: 'day', date: today };
}

describe('the Rangliste', () => {
  const zone = process.env.TZ;
  let wrapper: Awaited<ReturnType<typeof rangliste>> | undefined;

  beforeEach(() => {
    process.env.TZ = 'Europe/Berlin';
    vi.useFakeTimers({
      now: new Date('2026-11-15T22:41:00Z'),
      toFake: ['Date', 'setTimeout', 'clearTimeout'],
    });
    chooseToday();
  });

  afterEach(() => {
    wrapper?.unmount();
    vi.useRealTimers();
    vi.unstubAllGlobals();
    process.env.TZ = zone;
  });

  it('shows the leader on the card and the others in ranked rows, German-style', async () => {
    api(answer(evening));

    wrapper = await rangliste();

    const leader = wrapper.get('[data-test="leader"]');
    expect(leader.attributes('aria-label')).toBe(
      'Platz 1, Daniel, 13,5 Punkte, 9 Getränke',
    );
    expect(leader.text()).toContain('Daniel');
    expect(leader.text()).toContain('13,5');
    expect(leader.text()).toContain('9 Getränke');
    expect(leader.text()).toContain('Bier 4 · Margarita 1');
    const rows = wrapper.findAll('[data-test="rank"]');
    expect(rows.map((row) => row.attributes('aria-label'))).toEqual([
      'Platz 2, Anna, 9 Punkte, 6 Getränke',
      'Platz 3, Tom, 0,5 Punkte, 1 Getränk',
    ]);
    expect(rows[1]?.text()).toContain('0,5');
    expect(rows[0]?.text()).toContain('Bier 3 · Wein 3');
    expect(wrapper.text()).not.toContain('Stand');
  });

  it('hints at the entries of today that wait for verification beside a place’s counters', async () => {
    api(
      answer({
        ...evening,
        rows: evening.rows.map((row) =>
          row.personId === 6 ? row : { ...row, pendingCount: row.personId },
        ),
      }),
    );

    wrapper = await rangliste();

    const leader = wrapper.get('[data-test="leader"]');
    expect(leader.attributes('aria-label')).toBe(
      'Platz 1, Daniel, 13,5 Punkte, 9 Getränke, +3 offen',
    );
    expect(leader.text()).toContain('+3 offen');
    const rows = wrapper.findAll('[data-test="rank"]');
    expect(rows.map((row) => row.attributes('aria-label'))).toEqual([
      'Platz 2, Anna, 9 Punkte, 6 Getränke, +1 offen',
      'Platz 3, Tom, 0,5 Punkte, 1 Getränk',
    ]);
    expect(rows[0]?.text()).toContain('+1 offen');
    expect(rows[1]?.text()).not.toContain('offen');
  });

  it('lists the persons whose entries all wait apart, without a rank, and never as the leader', async () => {
    api(
      answer({
        rows: [],
        unranked: [
          {
            personId: 4,
            name: 'Jule',
            photoUrl: null,
            pendingCount: 2,
            drinks: [{ drinkId: 2, name: 'Bier', count: 0, recordedCount: 2 }],
          },
        ],
      }),
    );

    wrapper = await rangliste();

    expect(wrapper.find('[data-test="leader"]').exists()).toBe(false);
    expect(wrapper.text()).not.toContain('Heute noch keine Getränke.');
    const unranked = wrapper.get('[aria-label="Noch nicht gewertet"]');
    const places = unranked.findAll('[data-test="unranked"]');
    expect(places.map((place) => place.attributes('aria-label'))).toEqual([
      'Jule, Bier 2, +2 offen',
    ]);
    expect(places[0]?.attributes('href')).toBe('/verlauf/4');
    expect(places[0]?.text()).toContain('+2 offen');
    expect(places[0]?.text()).not.toMatch(/Platz|Punkt/);
  });

  it('lists the unranked persons after the ranked ones', async () => {
    api(
      answer({
        ...evening,
        unranked: [
          {
            personId: 4,
            name: 'Jule',
            photoUrl: null,
            pendingCount: 1,
            drinks: [{ drinkId: 2, name: 'Bier', count: 0, recordedCount: 1 }],
          },
        ],
      }),
    );

    wrapper = await rangliste();

    expect(wrapper.get('[data-test="leader"]').text()).toContain('Daniel');
    expect(wrapper.findAll('[data-test="rank"]')).toHaveLength(2);
    expect(
      wrapper
        .findAll('[data-test="unranked"]')
        .map((place) => place.attributes('aria-label')),
    ).toEqual(['Jule, Bier 1, +1 offen']);
  });

  it('shows the leader’s 64 px avatar above the name and each row’s 44 px avatar between rank and name, keeping every place’s accessible name', async () => {
    api(answer(withDanielsPhoto('d1')));

    wrapper = await rangliste();

    const leader = wrapper.get('[data-test="leader"]');
    expect(leader.attributes('aria-label')).toBe(
      'Platz 1, Daniel, 13,5 Punkte, 9 Getränke',
    );
    expect(avatarIn(leader)).toEqual({
      size: expect.stringContaining('width: 64px'),
      photo: '/api/persons/3/photo?v=d1',
      initials: undefined,
    });
    // Above the name, in the same column.
    expect(
      leader.get('.person-avatar').element.nextElementSibling?.textContent,
    ).toBe('Daniel');
    const rows = wrapper.findAll('[data-test="rank"]');
    expect(rows.map((row) => row.attributes('aria-label'))).toEqual([
      'Platz 2, Anna, 9 Punkte, 6 Getränke',
      'Platz 3, Tom, 0,5 Punkte, 1 Getränk',
    ]);
    const [anna] = rows;
    if (!anna) throw new Error('no row');
    expect(avatarIn(anna)).toEqual({
      size: expect.stringContaining('width: 44px'),
      photo: undefined,
      initials: 'A',
    });
    const avatar = anna.get('.person-avatar').element;
    expect(avatar.previousElementSibling?.textContent).toBe('2');
    expect(avatar.nextElementSibling?.textContent).toContain('Anna');
    expect(avatar.getAttribute('aria-hidden')).toBe('true');
  });

  it('shows a photo changed on another phone after the next refresh, and initials once it is removed', async () => {
    api(
      answer(withDanielsPhoto('d1')),
      answer(withDanielsPhoto('d2')),
      answer(withDanielsPhoto(null)),
    );
    const page = await rangliste();
    wrapper = page;
    const leader = () => avatarIn(page.get('[data-test="leader"]'));
    expect(leader().photo).toBe('/api/persons/3/photo?v=d1');

    await vi.advanceTimersByTimeAsync(10_000);
    await flushPromises();
    expect(leader().photo).toBe('/api/persons/3/photo?v=d2');

    await vi.advanceTimersByTimeAsync(10_000);
    await flushPromises();
    expect(leader()).toMatchObject({ photo: undefined, initials: 'D' });
  });

  it('opens a person’s Verlauf from the leader card and from each row', async () => {
    api(answer(evening));

    wrapper = await rangliste();

    const places = wrapper
      .findAll('ol[aria-label="Rangliste"] > li > a')
      .map((link) => [link.attributes('href'), link.attributes('aria-label')]);
    expect(places).toEqual([
      ['/verlauf/3', 'Platz 1, Daniel, 13,5 Punkte, 9 Getränke'],
      ['/verlauf/1', 'Platz 2, Anna, 9 Punkte, 6 Getränke'],
      ['/verlauf/6', 'Platz 3, Tom, 0,5 Punkte, 1 Getränk'],
    ]);
  });

  it('says so when nobody drank today and offers Zählen', async () => {
    api(answer({ rows: [], unranked: [] }));

    wrapper = await rangliste();

    expect(wrapper.text()).toContain('Heute noch keine Getränke.');
    expect(wrapper.get('a[href="/zaehlen"]').text()).toBe('Zählen');
  });

  it('keeps the last standings with “Stand: hh:mm” in the top bar when a refresh fails', async () => {
    api(answer(evening), offline);
    wrapper = await rangliste();

    vi.setSystemTime(new Date('2026-11-15T22:45:00Z'));
    await vi.advanceTimersByTimeAsync(10_000);
    await flushPromises();

    expect(wrapper.get('[data-test="leader"]').text()).toContain('Daniel');
    expect(wrapper.get('.top-bar').text()).toContain('Stand: 23:41');
  });
});

/** Sunday 15.11.2026, 23:41 in Berlin: today's, Saturday's and Friday's windows and all time. */
const TODAY = '?from=2026-11-14T23:00:00.000Z';
const SATURDAY = '?from=2026-11-13T23:00:00.000Z&to=2026-11-14T23:00:00.000Z';
const FRIDAY = '?from=2026-11-12T23:00:00.000Z&to=2026-11-13T23:00:00.000Z';
const ALL_TIME = '?scope=all';
/** The current week (Monday 09.11. to Sunday 15.11.) and the one before, in Berlin. */
const THIS_WEEK = '?from=2026-11-08T23:00:00.000Z&to=2026-11-15T23:00:00.000Z';
const LAST_WEEK = '?from=2026-11-01T23:00:00.000Z&to=2026-11-08T23:00:00.000Z';

const nobody: Scoreboard = { rows: [], unranked: [] };
/** A board whose only place is `name` with `score`. */
function only(name: string, score: number): Scoreboard {
  return {
    rows: [
      {
        personId: 9,
        name,
        photoUrl: null,
        score,
        count: score,
        pendingCount: 0,
        drinks: [
          { drinkId: 2, name: 'Bier', count: score, recordedCount: score },
        ],
      },
    ],
    unranked: [],
  };
}

type Reply = Scoreboard | 'unchanged' | Promise<Scoreboard>;

/**
A fake API that answers each scoreboard query from `boards` (by its decoded query
string; an unknown one is an empty board), tagged `"<n>-<query>"`, and records what
was asked with which ETag.
*/
function scoreboards(
  boards: Record<string, Reply | (() => Reply)>,
  days: () => string[] = () => [],
) {
  const asked: [string, string | undefined][] = [];
  /** The ETags the days read was asked with. */
  const daysAsked: (string | undefined)[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init: RequestInit) => {
      const { pathname, search } = new URL(url, 'http://app');
      const ifNoneMatch = (init.headers as Record<string, string>)[
        'If-None-Match'
      ];
      if (pathname === '/api/scoreboard/days') {
        daysAsked.push(ifNoneMatch);
        const instants = days();
        const etag = `"${String(instants.length)}"`;
        return ifNoneMatch === etag
          ? new Response(null, { status: 304, headers: { ETag: etag } })
          : new Response(JSON.stringify({ instants }), {
              status: 200,
              headers: { 'Content-Type': 'application/json', ETag: etag },
            });
      }
      const query = decodeURIComponent(search);
      asked.push([query, ifNoneMatch]);
      const entry = boards[query];
      const reply = typeof entry === 'function' ? entry() : (entry ?? nobody);
      if (reply === 'unchanged') return new Response(null, { status: 304 });
      return new Response(JSON.stringify(await reply), {
        status: 200,
        headers: { 'Content-Type': 'application/json', ETag: `"1${query}"` },
      });
    }),
  );
  return Object.assign(asked, { days: daysAsked });
}

describe('the Rangliste’s periods', () => {
  const zone = process.env.TZ;
  let page: Awaited<ReturnType<typeof rangliste>> | undefined;

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
    chooseToday();
  });

  afterEach(() => {
    page?.unmount();
    page = undefined;
    chooseToday();
    vi.useRealTimers();
    vi.unstubAllGlobals();
    process.env.TZ = zone;
  });

  async function open() {
    page = await rangliste();
    return page;
  }
  const shown = () => page?.find('[data-test="leader"]').text() ?? '';
  const context = () => page?.get('.top-bar__context').text();
  const bar = () => page?.find('[data-test="day-bar"]');
  const options = () =>
    page
      ?.get('[role="group"][aria-label="Zeitraum"]')
      .findAll('button')
      .map((button) => [button.text(), button.attributes('aria-pressed')]);
  async function click(selector: string) {
    await page?.get(selector).trigger('click');
    await flushPromises();
  }
  async function choose(kind: 'Tag' | 'Woche' | 'Gesamt') {
    await page
      ?.findAll('[role="group"] button')
      .find((button) => button.text() === kind)
      ?.trigger('click');
    await flushPromises();
  }
  const back = () => click('button[aria-label="Vorheriger Tag"]');
  const forward = () => click('button[aria-label="Nächster Tag"]');
  const next = () => page?.get('button[aria-label="Nächster Tag"]');

  it('opens on today with the switch Tag | Woche | Gesamt, Heute in the bar and in the top bar, and no next day', async () => {
    scoreboards({ [TODAY]: evening });

    await open();

    expect(options()).toEqual([
      ['Tag', 'true'],
      ['Woche', 'false'],
      ['Gesamt', 'false'],
    ]);
    expect(bar()?.text()).toBe('Heute');
    expect(next()?.attributes('disabled')).toBeDefined();
    expect(context()).toBe('Heute');
    expect(shown()).toContain('Daniel');
  });

  it('steps back to Gestern and further, read with each day’s window, naming the day in the bar and in full in the top bar', async () => {
    const asked = scoreboards({
      [TODAY]: evening,
      [SATURDAY]: only('Mara', 7),
      [FRIDAY]: only('Tom', 3),
    });
    await open();

    await back();
    expect(bar()?.text()).toBe('Gestern');
    expect(context()).toBe('Samstag, 14.11.2026');
    expect(shown()).toContain('Mara');
    expect(next()?.attributes('disabled')).toBeUndefined();

    await back();
    expect(bar()?.text()).toBe('Fr., 13.11.');
    expect(context()).toBe('Freitag, 13.11.2026');
    expect(shown()).toContain('Tom');

    await forward();
    await forward();
    expect(bar()?.text()).toBe('Heute');
    expect(shown()).toContain('Daniel');
    expect(asked.map(([query]) => query)).toEqual([
      TODAY,
      SATURDAY,
      FRIDAY,
      SATURDAY,
      TODAY,
    ]);
  });

  it('ranks every entry under Gesamt, read with scope=all and no date, with Gesamt in the top bar and no day bar', async () => {
    const asked = scoreboards({
      [TODAY]: evening,
      [ALL_TIME]: only('Ben', 40),
    });
    await open();

    await choose('Gesamt');

    expect(asked.at(-1)).toEqual([ALL_TIME, undefined]);
    expect(shown()).toContain('Ben');
    expect(context()).toBe('Gesamt');
    expect(bar()?.exists()).toBe(false);
    expect(options()).toEqual([
      ['Tag', 'false'],
      ['Woche', 'false'],
      ['Gesamt', 'true'],
    ]);
  });

  it('ranks the current week under Woche, read with its local Monday-to-Monday window and kept live, named in the bar and by number in the top bar', async () => {
    const asked = scoreboards({
      [TODAY]: evening,
      [THIS_WEEK]: only('Anna', 21),
    });
    await open();

    await choose('Woche');
    expect(bar()?.text()).toBe('Diese Woche');
    expect(context()).toBe('KW 46 · 09.11.–15.11.');
    expect(shown()).toContain('Anna');
    expect(
      page?.get('button[aria-label="Nächste Woche"]').attributes('disabled'),
    ).toBeDefined();

    await vi.advanceTimersByTimeAsync(10_000);
    expect(asked.slice(1)).toEqual([
      [THIS_WEEK, undefined],
      [THIS_WEEK, `"1${THIS_WEEK}"`],
    ]);
  });

  it('steps back to Letzte Woche and further, each read when shown and on focus but not polled', async () => {
    const asked = scoreboards({
      [TODAY]: evening,
      [THIS_WEEK]: only('Anna', 21),
      [LAST_WEEK]: only('Mara', 30),
    });
    await open();
    await choose('Woche');

    await click('button[aria-label="Vorherige Woche"]');
    expect(bar()?.text()).toBe('Letzte Woche');
    expect(context()).toBe('KW 45 · 02.11.–08.11.');
    expect(shown()).toContain('Mara');
    await vi.advanceTimersByTimeAsync(60_000);
    window.dispatchEvent(new Event('focus'));
    await flushPromises();
    expect(asked.filter(([query]) => query === LAST_WEEK)).toEqual([
      [LAST_WEEK, undefined],
      [LAST_WEEK, `"1${LAST_WEEK}"`],
    ]);

    await click('button[aria-label="Vorherige Woche"]');
    expect(bar()?.text()).toBe('KW 44 · 26.10.–01.11.');
    expect(asked.at(-1)?.[0]).toBe(
      '?from=2026-10-25T23:00:00.000Z&to=2026-11-01T23:00:00.000Z',
    );
  });

  it('keeps a week as its Monday when Sunday’s midnight passes: it becomes Letzte Woche and is no longer polled', async () => {
    const asked = scoreboards({
      [TODAY]: evening,
      [THIS_WEEK]: only('Anna', 21),
    });
    await open();
    await choose('Woche');

    await vi.advanceTimersByTimeAsync(20 * 60_000);
    window.dispatchEvent(new Event('focus'));
    await flushPromises();
    const reads = asked.length;
    await vi.advanceTimersByTimeAsync(60_000);

    expect(bar()?.text()).toBe('Letzte Woche');
    expect(context()).toBe('KW 46 · 09.11.–15.11.');
    expect(asked.at(-1)?.[0]).toBe(THIS_WEEK);
    expect(asked).toHaveLength(reads);
  });

  it('says nothing was counted in a week without any entry, without Zählen', async () => {
    scoreboards({ [TODAY]: evening });
    await open();

    await choose('Woche');

    expect(page?.text()).toContain('In dieser Woche wurde nichts gezählt.');
    expect(page?.find('a[href="/zaehlen"]').exists()).toBe(false);
  });

  it('says nothing was counted on a past day without any entry, and offers Zählen only on today', async () => {
    scoreboards({ [TODAY]: nobody });
    await open();
    expect(page?.text()).toContain('Heute noch keine Getränke.');
    expect(page?.find('a[href="/zaehlen"]').exists()).toBe(true);

    await back();
    expect(page?.text()).toContain('An diesem Tag wurde nichts gezählt.');
    expect(page?.text()).not.toContain('Heute');
    expect(page?.find('a[href="/zaehlen"]').exists()).toBe(false);

    await choose('Gesamt');
    expect(page?.text()).toContain('Noch keine Getränke.');
    expect(page?.find('a[href="/zaehlen"]').exists()).toBe(false);
  });

  it('shows a past day whose entries all wait as the unranked group only, without a leader or the empty text', async () => {
    scoreboards({
      [TODAY]: evening,
      [SATURDAY]: {
        rows: [],
        unranked: [
          {
            personId: 4,
            name: 'Jule',
            photoUrl: null,
            pendingCount: 2,
            drinks: [{ drinkId: 2, name: 'Bier', count: 0, recordedCount: 2 }],
          },
        ],
      },
    });
    await open();

    await back();

    expect(page?.find('[data-test="leader"]').exists()).toBe(false);
    expect(page?.findAll('[data-test="rank"]')).toHaveLength(0);
    expect(
      page
        ?.get('[aria-label="Noch nicht gewertet"]')
        .findAll('[data-test="unranked"]')
        .map((place) => place.attributes('aria-label')),
    ).toEqual(['Jule, Bier 2, +2 offen']);
    expect(page?.text()).not.toContain('nichts gezählt');
  });

  it('keeps today live while it is shown, and Zählen’s standings on today whatever period is shown', async () => {
    const asked = scoreboards({
      [TODAY]: evening,
      [SATURDAY]: only('Mara', 7),
      [ALL_TIME]: only('Ben', 40),
    });
    await open();
    const scope = effectScope();
    const zaehlen = scope.run(() => useScoreboardFeed(false));

    await back();
    await vi.advanceTimersByTimeAsync(60_000);
    await choose('Gesamt');
    expect(zaehlen?.value.board).toEqual(evening);
    expect(asked.filter(([query]) => query === TODAY)).toHaveLength(1);

    await choose('Tag');
    await forward();
    await vi.advanceTimersByTimeAsync(10_000);
    expect(asked.map(([query]) => query)).toEqual([
      TODAY,
      SATURDAY,
      ALL_TIME,
      SATURDAY,
      TODAY,
      TODAY,
    ]);
    expect(zaehlen?.value.board).toEqual(evening);
    scope.stop();
  });

  it('shows the chosen period again on returning from a person’s Verlauf', async () => {
    scoreboards({ [TODAY]: evening, [ALL_TIME]: only('Ben', 40) });
    const { router } = await open();
    await choose('Gesamt');

    await router.push('/verlauf/9');
    await flushPromises();
    await router.push('/rangliste');
    await flushPromises();

    expect(options()).toEqual([
      ['Tag', 'false'],
      ['Woche', 'false'],
      ['Gesamt', 'true'],
    ]);
    expect(context()).toBe('Gesamt');
    expect(shown()).toContain('Ben');
  });

  it('opens a person’s Verlauf of the past day shown, ranked or unranked, and today’s from Woche and Gesamt', async () => {
    const jule = {
      personId: 4,
      name: 'Jule',
      photoUrl: null,
      pendingCount: 1,
      drinks: [{ drinkId: 2, name: 'Bier', count: 0, recordedCount: 1 }],
    };
    const withJule = (board: Scoreboard) => ({ ...board, unranked: [jule] });
    scoreboards({
      [TODAY]: evening,
      [SATURDAY]: withJule(only('Mara', 7)),
      [THIS_WEEK]: withJule(only('Mara', 9)),
      [ALL_TIME]: withJule(only('Mara', 40)),
    });
    await open();
    const links = () =>
      page
        ?.findAll('a[href^="/verlauf"]')
        .map((link) => link.attributes('href')) ?? [];

    expect(links()).toEqual(['/verlauf/3', '/verlauf/1', '/verlauf/6']);
    await back();
    expect(links()).toEqual([
      '/verlauf/9?tag=2026-11-14',
      '/verlauf/4?tag=2026-11-14',
    ]);
    await choose('Woche');
    expect(links()).toEqual(['/verlauf/9', '/verlauf/4']);
    await choose('Gesamt');
    expect(links()).toEqual(['/verlauf/9', '/verlauf/4']);
  });

  it('keeps a past day across its Verlauf and reads it again on return, after a delete there', async () => {
    let saturday = only('Mara', 7);
    const asked = scoreboards({ [TODAY]: evening, [SATURDAY]: () => saturday });
    const { router } = await open();
    await back();

    await click('[data-test="leader"]');
    expect(router.currentRoute.value.fullPath).toBe(
      '/verlauf/9?tag=2026-11-14',
    );
    // Verlauf deletes one of Mara's entries of that day.
    saturday = only('Mara', 6);
    await refreshScoreboard();
    router.back();
    await flushPromises();

    expect(router.currentRoute.value.fullPath).toBe('/rangliste');
    expect(bar()?.text()).toBe('Gestern');
    expect(context()).toBe('Samstag, 14.11.2026');
    expect(shown()).toContain('6');
    expect(asked.filter(([query]) => query === SATURDAY)).toEqual([
      [SATURDAY, undefined],
      [SATURDAY, `"1${SATURDAY}"`],
      [SATURDAY, `"1${SATURDAY}"`],
    ]);
  });

  it('shows only the shown period’s ranking when answers arrive out of order, and sends an ETag only with its own period', async () => {
    let answerSaturday: (board: Scoreboard) => void = () => undefined;
    const slowSaturday = new Promise<Scoreboard>((resolve) => {
      answerSaturday = resolve;
    });
    let saturday: () => Reply = () => slowSaturday;
    const asked = scoreboards({
      [TODAY]: evening,
      [SATURDAY]: () => saturday(),
      [ALL_TIME]: only('Ben', 40),
    });
    await open();

    await back();
    await choose('Gesamt');
    answerSaturday(only('Mara', 7));
    await flushPromises();
    expect(shown()).toContain('Ben');
    expect(context()).toBe('Gesamt');

    saturday = () => only('Mara', 8);
    await choose('Tag');
    expect(shown()).toContain('Mara');
    saturday = () => 'unchanged';
    window.dispatchEvent(new Event('focus'));
    await flushPromises();
    expect(page?.get('[data-test="leader"]').attributes('aria-label')).toBe(
      'Platz 1, Mara, 8 Punkte, 8 Getränke',
    );
    await choose('Gesamt');

    // Today's request is the shared feed's, on condition of what it read before.
    expect(asked.slice(1)).toEqual([
      [SATURDAY, undefined],
      [ALL_TIME, undefined],
      [SATURDAY, undefined],
      [SATURDAY, `"1${SATURDAY}"`],
      [ALL_TIME, undefined],
    ]);
  });

  it('reads a shown past day again after the device’s own delete and on focus, but does not poll it', async () => {
    let saturday = only('Mara', 7);
    const asked = scoreboards({ [TODAY]: evening, [SATURDAY]: () => saturday });
    await open();
    await back();

    saturday = only('Mara', 6);
    await refreshScoreboard();
    await flushPromises();
    expect(page?.get('[data-test="leader"]').text()).toContain('6');
    await vi.advanceTimersByTimeAsync(60_000);
    window.dispatchEvent(new Event('focus'));
    await flushPromises();

    expect(asked.filter(([query]) => query === SATURDAY)).toHaveLength(3);
  });

  it('keeps a past day as its calendar date when midnight passes, while Heute moves on', async () => {
    const asked = scoreboards({
      [TODAY]: evening,
      [SATURDAY]: only('Mara', 7),
    });
    await open();
    await back();

    await vi.advanceTimersByTimeAsync(20 * 60_000);
    window.dispatchEvent(new Event('focus'));
    await flushPromises();

    expect(bar()?.text()).toBe('Sa., 14.11.');
    expect(context()).toBe('Samstag, 14.11.2026');
    expect(asked.at(-1)).toEqual([SATURDAY, `"1${SATURDAY}"`]);
    await forward();
    await forward();
    expect(bar()?.text()).toBe('Heute');
    expect(context()).toBe('Heute');
    expect(asked.at(-1)?.[0]).toBe('?from=2026-11-15T23:00:00.000Z');
  });

  it('moves a Rangliste left on Heute on to the new day at midnight and after a resume from sleep', async () => {
    const asked = scoreboards({ [TODAY]: evening });
    await open();

    await vi.advanceTimersByTimeAsync(20 * 60_000);
    await flushPromises();
    expect(bar()?.text()).toBe('Heute');
    expect(asked.at(-1)?.[0]).toBe('?from=2026-11-15T23:00:00.000Z');

    vi.setSystemTime(new Date('2026-11-17T07:00:00Z'));
    document.dispatchEvent(new Event('visibilitychange'));
    await flushPromises();
    expect(bar()?.text()).toBe('Heute');
    expect(next()?.attributes('disabled')).toBeDefined();
    expect(asked.at(-1)?.[0]).toBe('?from=2026-11-16T23:00:00.000Z');
  });

  it('shows the new today under Woche and Tag after midnight passed on Gesamt chosen from Heute', async () => {
    scoreboards({ [TODAY]: evening });
    await open();
    expect(bar()?.text()).toBe('Heute');
    await choose('Gesamt');

    await vi.advanceTimersByTimeAsync(20 * 60_000);
    window.dispatchEvent(new Event('focus'));
    await flushPromises();
    await choose('Woche');
    const weekBar = bar()?.text();
    await choose('Tag');

    expect([weekBar, bar()?.text(), context()]).toEqual([
      'Diese Woche',
      'Heute',
      'Heute',
    ]);
  });

  it('keeps the chosen calendar day with a window rebuilt for a new time zone', async () => {
    const asked = scoreboards({
      [TODAY]: evening,
      [SATURDAY]: only('Mara', 7),
    });
    await open();
    await back();

    process.env.TZ = 'America/New_York';
    window.dispatchEvent(new Event('focus'));
    await flushPromises();

    expect(bar()?.text()).toBe('Gestern');
    expect(asked.at(-1)?.[0]).toBe(
      '?from=2026-11-14T05:00:00.000Z&to=2026-11-15T05:00:00.000Z',
    );
  });

  describe('with the calendar Tag wählen', () => {
    /** Saturday 14.11., 21:00 and 21:15 in Berlin, and Tuesday 27.10. */
    const DAYS = [
      '2026-10-27T19:00:00.000Z',
      '2026-11-14T20:00:00.000Z',
      '2026-11-14T20:15:00.000Z',
    ];

    beforeEach(() => {
      stubDialogEnvironment();
    });

    afterEach(() => {
      document.body.innerHTML = '';
    });

    const dialog = () =>
      document.querySelector('[role="dialog"].v-overlay--active');
    async function openCalendar() {
      await click('[data-test="day-bar"] button.day-bar__day');
    }
    async function pick(name: string) {
      const day = dialog()?.querySelector<HTMLButtonElement>(
        `[aria-label="${name}"]`,
      );
      if (!day) throw new Error(`no day ${name}`);
      day.click();
      await flushPromises();
    }

    it('shows the ranking of the day picked in the calendar, its days with drinks that count dotted', async () => {
      const asked = scoreboards(
        { [TODAY]: evening, [SATURDAY]: only('Mara', 7) },
        () => DAYS,
      );
      await open();

      await openCalendar();
      expect(
        [...(dialog()?.querySelectorAll('.calendar__day--marked') ?? [])].map(
          (day) => day.getAttribute('aria-label'),
        ),
      ).toEqual(['Samstag, 14. November']);
      await pick('Samstag, 14. November');

      expect(dialog()).toBeNull();
      expect(bar()?.text()).toBe('Gestern');
      expect(context()).toBe('Samstag, 14.11.2026');
      expect(shown()).toContain('Mara');
      expect(asked.at(-1)).toEqual([SATURDAY, undefined]);
    });

    it('shows the week of the day picked while Woche is shown', async () => {
      const asked = scoreboards({
        [TODAY]: evening,
        [LAST_WEEK]: only('Tom', 9),
      });
      await open();
      await choose('Woche');

      await openCalendar();
      await pick('Mittwoch, 4. November');

      expect(context()).toBe('KW 45 · 02.11.–08.11.');
      expect(shown()).toContain('Tom');
      expect(asked.at(-1)).toEqual([LAST_WEEK, undefined]);
    });

    it('says under Gesamt since when and over how many evenings it counts', async () => {
      scoreboards(
        { [TODAY]: evening, [ALL_TIME]: only('Ben', 40) },
        () => DAYS,
      );
      await open();

      await choose('Gesamt');

      expect(page?.get('.period-line').text()).toBe(
        'Alle Tage seit 27.10.2026 · 2 Abende',
      );
    });

    it('reads the days again after the device’s own writes and on focus, on condition of their ETag', async () => {
      let days = DAYS.slice(0, 1);
      const asked = scoreboards(
        { [TODAY]: evening, [ALL_TIME]: only('Ben', 40) },
        () => days,
      );
      await open();
      await choose('Gesamt');
      expect(page?.get('.period-line').text()).toContain('1 Abend');

      days = DAYS;
      await refreshScoreboard();
      await flushPromises();
      expect(page?.get('.period-line').text()).toContain('2 Abende');
      window.dispatchEvent(new Event('focus'));
      await flushPromises();

      // The first read asks on condition of what an earlier test left behind.
      expect(asked.days.slice(1)).toEqual(['"1"', '"3"']);
    });
  });
});
