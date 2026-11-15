import { flushPromises, mount } from '@vue/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { defineComponent, h } from 'vue';
import { createMemoryHistory, createRouter, RouterView } from 'vue-router';
import AppTopBar from '../../components/AppTopBar.vue';
import type { Scoreboard } from '../../core/api-client';
import { createAppVuetify } from '../../theme';
import RanglistePage from './RanglistePage.vue';

const evening: Scoreboard = {
  rows: [
    {
      personId: 3,
      name: 'Daniel',
      score: 13.5,
      count: 9,
      drinks: [
        { drinkId: 2, name: 'Bier', count: 4 },
        { drinkId: 3, name: 'Margarita', count: 1 },
      ],
    },
    {
      personId: 1,
      name: 'Anna',
      score: 9,
      count: 6,
      drinks: [
        { drinkId: 2, name: 'Bier', count: 3 },
        { drinkId: 6, name: 'Wein', count: 3 },
      ],
    },
    {
      personId: 6,
      name: 'Tom',
      score: 0.5,
      count: 1,
      drinks: [{ drinkId: 4, name: 'Radler', count: 1 }],
    },
  ],
};

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
    ],
  });
  await router.push('/rangliste');
  const shell = defineComponent(() => () => [h(AppTopBar), h(RouterView)]);
  const wrapper = mount(shell, {
    global: { plugins: [router, createAppVuetify()] },
  });
  await flushPromises();
  return wrapper;
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

  it('says so when nobody drank today and offers Zählen', async () => {
    api(answer({ rows: [] }));

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
