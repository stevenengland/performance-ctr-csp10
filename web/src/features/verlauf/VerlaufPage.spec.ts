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
import type { HistoryEntry, Person } from '../../core/api-client';
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
import VerlaufPage from './VerlaufPage.vue';

const persons: Person[] = [
  { id: 1, name: 'Anna', photoUrl: null },
  { id: 3, name: 'Daniel', photoUrl: null },
];

/** Daniel's evening, newest first, as the API sends it. */
function evening(): HistoryEntry[] {
  return [
    {
      id: 'e3',
      drink: { id: 2, name: 'Bier' },
      quantity: 2,
      factor: { id: 1, name: 'Happy Hour', multiplier: 2 },
      createdAt: '2026-11-15T22:41:00.000Z',
      accountName: 'anna',
      pending: true,
    },
    {
      id: 'e2',
      drink: { id: 3, name: 'Margarita' },
      quantity: 1,
      factor: null,
      createdAt: '2026-11-15T21:58:00.000Z',
      accountName: 'daniel',
      pending: false,
    },
    {
      id: 'e1',
      drink: { id: 4, name: 'Schnaps' },
      quantity: 2,
      factor: null,
      createdAt: '2026-11-15T21:10:00.000Z',
      accountName: null,
      pending: false,
    },
  ];
}

interface Call {
  method: string;
  url: string;
}

/** A fake API: persons, the person's entries (deletes remove them) and the scoreboard. */
function api(
  entries: HistoryEntry[],
  { deleteReply }: { deleteReply?: () => Response } = {},
) {
  const calls: Call[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init: RequestInit) => {
      const method = init.method ?? 'GET';
      calls.push({ method, url });
      if (url === '/api/persons') return json({ persons });
      if (url.startsWith('/api/scoreboard')) return json({ rows: [] });
      if (url.startsWith('/api/entries?')) {
        const personId = new URL(url, 'http://app').searchParams.get(
          'personId',
        );
        return personId === '3'
          ? json({ entries })
          : problem(404, { title: 'Nicht gefunden.' });
      }
      if (method === 'DELETE') {
        if (deleteReply) return deleteReply();
        const id = url.split('/').pop();
        entries.splice(
          entries.findIndex((entry) => entry.id === id),
          1,
        );
        return new Response(null, { status: 204 });
      }
      throw new Error(`unexpected ${method} ${url}`);
    }),
  );
  return calls;
}

let router: Router;

/** Verlauf in the shell's top bar, opened from the Rangliste (with `?tag=…` from a past day). */
async function verlauf(personId: number, query = ''): Promise<VueWrapper> {
  router = createRouter({
    history: createMemoryHistory(),
    routes: [
      {
        path: '/verlauf/:personId(\\d+)',
        component: VerlaufPage,
        props: true,
        meta: {
          title: 'Verlauf',
          context: 'Heute',
          destination: 'rangliste',
          child: true,
        },
      },
      {
        path: '/rangliste',
        component: { render: () => null },
        meta: { title: 'Rangliste' },
      },
      {
        path: '/konto',
        component: { render: () => null },
        meta: { title: 'Konto' },
      },
    ],
  });
  await router.push('/rangliste');
  await router.push(`/verlauf/${String(personId)}${query}`);
  const shell = defineComponent(() => () => [h(AppTopBar), h(RouterView)]);
  const wrapper = mount(shell, {
    global: { plugins: [router, createAppVuetify()] },
    attachTo: document.body,
  });
  await flushPromises();
  return wrapper;
}

const rows = (wrapper: VueWrapper) =>
  wrapper.findAll('[data-test="entry"]').map((row) => row.text());

describe('Verlauf', () => {
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
    document.body.innerHTML = '';
    vi.useRealTimers();
    vi.unstubAllGlobals();
    process.env.TZ = zone;
  });

  it('shows the person’s entries since local midnight, newest first, with drink, quantity, factor, local time and account', async () => {
    const calls = api(evening());

    wrapper = await verlauf(3);

    expect(wrapper.get('h1').text()).toBe('Daniel');
    expect(wrapper.get('.top-bar__context').text()).toBe('Heute');
    expect(calls).toContainEqual({
      method: 'GET',
      url: '/api/entries?personId=3&from=2026-11-14T23%3A00%3A00.000Z',
    });
    expect(rows(wrapper)).toEqual([
      '2× BierHappy Hour ×2 · 23:41 · annaoffen',
      '1× MargaritaKein Faktor · 22:58 · daniel',
      '2× SchnapsKein Faktor · 22:10 · gelöschtes Konto',
    ]);
    expect(wrapper.find('ul[aria-label="Einträge von Daniel"]').exists()).toBe(
      true,
    );
  });

  it('marks the entries that wait for verification as offen', async () => {
    api(evening());

    wrapper = await verlauf(3);

    expect(
      wrapper.findAll('[data-test="entry"]').map((row) => {
        const marker = row.find('[data-test="pending"]');
        return marker.exists() ? marker.text() : null;
      }),
    ).toEqual(['offen', null, null]);
  });

  it('shows the new day’s entries once the page is used again after midnight', async () => {
    const entries = evening();
    const calls = api(entries);
    wrapper = await verlauf(3);

    // Yesterday's entries are no longer in the server's answer for the new day.
    entries.splice(0);
    vi.setSystemTime(new Date('2026-11-16T00:05:00Z'));
    document.dispatchEvent(new Event('visibilitychange'));
    await flushPromises();

    expect(calls).toContainEqual({
      method: 'GET',
      url: '/api/entries?personId=3&from=2026-11-15T23%3A00%3A00.000Z',
    });
    expect(wrapper.text()).toContain('Heute keine Einträge.');
  });

  it('says so when the person has no entries today', async () => {
    api([]);

    wrapper = await verlauf(3);

    expect(wrapper.text()).toContain('Heute keine Einträge.');
    expect(wrapper.findAll('[data-test="entry"]')).toHaveLength(0);
  });

  it('deletes an entry after the confirmation dialog and refreshes the scoreboard', async () => {
    const calls = api(evening());
    wrapper = await verlauf(3);

    await click(buttonIn(document, '2× Bier um 23:41 löschen'));
    expect(dialog().querySelector('h2')?.textContent).toBe('Eintrag löschen?');
    expect(dialog().textContent).toContain('2× Bier · Happy Hour ×2 um 23:41');
    await click(buttonIn(dialog(), 'Löschen'));

    expect(calls).toContainEqual({ method: 'DELETE', url: '/api/entries/e3' });
    expect(rows(wrapper)).toEqual([
      '1× MargaritaKein Faktor · 22:58 · daniel',
      '2× SchnapsKein Faktor · 22:10 · gelöschtes Konto',
    ]);
    expect(useSnackbar().value?.text).toBe('Eintrag gelöscht');
    expect(calls.some(({ url }) => url.startsWith('/api/scoreboard'))).toBe(
      true,
    );
  });

  it('names an entry without a factor in the dialog by drink and time only', async () => {
    api(evening());
    wrapper = await verlauf(3);

    await click(buttonIn(document, '1× Margarita um 22:58 löschen'));

    expect(dialog().textContent).toContain('1× Margarita um 22:58');
    expect(dialog().textContent).not.toContain('Kein Faktor');
  });

  it('keeps the entry when the dialog is cancelled', async () => {
    const calls = api(evening());
    wrapper = await verlauf(3);

    await click(buttonIn(document, '2× Bier um 23:41 löschen'));
    await click(buttonIn(dialog(), 'Abbrechen'));

    expect(calls.some(({ method }) => method === 'DELETE')).toBe(false);
    expect(rows(wrapper)).toHaveLength(3);
  });

  it('treats an entry deleted meanwhile on another phone as deleted', async () => {
    api(evening(), {
      deleteReply: () => problem(404, { title: 'Nicht gefunden.' }),
    });
    wrapper = await verlauf(3);

    await click(buttonIn(document, '2× Bier um 23:41 löschen'));
    await click(buttonIn(dialog(), 'Löschen'));

    expect(useSnackbar().value?.text).toBe('Eintrag gelöscht');
  });

  it('shows the problem title and keeps the entry when the delete fails', async () => {
    api(evening(), {
      deleteReply: () => problem(503, { title: 'Wartung.' }),
    });
    wrapper = await verlauf(3);

    await click(buttonIn(document, '2× Bier um 23:41 löschen'));
    await click(buttonIn(dialog(), 'Löschen'));

    expect(useSnackbar().value?.text).toBe('Wartung.');
    expect(rows(wrapper)).toHaveLength(3);
  });

  it('returns to the Rangliste with “Nicht mehr vorhanden” when the person is gone', async () => {
    api(evening());

    wrapper = await verlauf(7);

    await vi.waitFor(() => {
      expect(router.currentRoute.value.path).toBe('/rangliste');
    });
    expect(useSnackbar().value?.text).toBe('Nicht mehr vorhanden');
  });
  describe('of a past day', () => {
    /** Saturday 14.11.2026 in Berlin: `[13.11. 23:00Z, 14.11. 23:00Z)`. */
    const SATURDAY =
      '/api/entries?personId=3&from=2026-11-13T23%3A00%3A00.000Z&to=2026-11-14T23%3A00%3A00.000Z';
    const TODAY = '/api/entries?personId=3&from=2026-11-14T23%3A00%3A00.000Z';
    const reads = (calls: Call[]) =>
      calls.filter(({ url }) => url.startsWith('/api/entries?'));

    it('lists the person’s entries of the day its tag names, read with that day’s local window, and names the day in the context line', async () => {
      const calls = api(evening());

      wrapper = await verlauf(3, '?tag=2026-11-14');

      expect(wrapper.get('h1').text()).toBe('Daniel');
      expect(wrapper.get('.top-bar__context').text()).toBe(
        'Samstag, 14.11.2026',
      );
      expect(reads(calls)).toEqual([{ method: 'GET', url: SATURDAY }]);
      expect(rows(wrapper)).toHaveLength(3);
      expect(
        wrapper.get('[data-test="entry"] [data-test="pending"]').text(),
      ).toBe('offen');
    });

    it.each([
      ['a future day', '?tag=2026-11-16'],
      ['no date', '?tag=gestern'],
      ['an impossible date', '?tag=2026-02-30'],
      ['an empty tag', '?tag='],
    ])('shows today for %s', async (_case, query) => {
      const calls = api(evening());

      wrapper = await verlauf(3, query);

      expect(wrapper.get('.top-bar__context').text()).toBe('Heute');
      expect(reads(calls)).toEqual([{ method: 'GET', url: TODAY }]);
    });

    it('says the day had no entries without naming Heute', async () => {
      api([]);

      wrapper = await verlauf(3, '?tag=2026-11-14');

      const text = wrapper.get('section').text();
      expect(text).toBe('An diesem Tag keine Einträge.');
    });

    it('deletes an entry of the day, reads the day again and refreshes the scoreboard', async () => {
      const calls = api(evening());
      wrapper = await verlauf(3, '?tag=2026-11-14');

      await click(buttonIn(document, '2× Bier um 23:41 löschen'));
      await click(buttonIn(dialog(), 'Löschen'));

      expect(calls).toContainEqual({
        method: 'DELETE',
        url: '/api/entries/e3',
      });
      expect(reads(calls)).toEqual([
        { method: 'GET', url: SATURDAY },
        { method: 'GET', url: SATURDAY },
      ]);
      expect(rows(wrapper)).toHaveLength(2);
      expect(calls.some(({ url }) => url.startsWith('/api/scoreboard'))).toBe(
        true,
      );
    });

    it('keeps the day as its calendar date, its window rebuilt for a new time zone', async () => {
      const calls = api(evening());
      wrapper = await verlauf(3, '?tag=2026-11-14');

      process.env.TZ = 'America/New_York';
      await click(buttonIn(document, '2× Bier um 23:41 löschen'));
      await click(buttonIn(dialog(), 'Löschen'));

      expect(reads(calls).at(-1)?.url).toBe(
        '/api/entries?personId=3&from=2026-11-14T05%3A00%3A00.000Z&to=2026-11-15T05%3A00%3A00.000Z',
      );
      expect(wrapper.get('.top-bar__context').text()).toBe(
        'Samstag, 14.11.2026',
      );
    });

    it('stays on the day when midnight passes', async () => {
      const calls = api(evening());
      wrapper = await verlauf(3, '?tag=2026-11-14');

      vi.setSystemTime(new Date('2026-11-16T00:05:00Z'));
      document.dispatchEvent(new Event('visibilitychange'));
      await flushPromises();

      expect(reads(calls)).toEqual([{ method: 'GET', url: SATURDAY }]);
      expect(wrapper.get('.top-bar__context').text()).toBe(
        'Samstag, 14.11.2026',
      );
    });
  });
});
