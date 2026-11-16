import { flushPromises, mount, type VueWrapper } from '@vue/test-utils';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createMemoryHistory, createRouter } from 'vue-router';
import type { Person, Scoreboard } from '../../core/api-client';
import { createAppVuetify } from '../../theme';
import PersonStep from './PersonStep.vue';

const ANNA_PHOTO = '/api/persons/1/photo?v=a1';
const PERSONS: Person[] = [
  { id: 1, name: 'Anna', photoUrl: ANNA_PHOTO },
  { id: 3, name: 'Daniel', photoUrl: null },
];
const BOARD: Scoreboard = {
  rows: [
    {
      personId: 3,
      name: 'Daniel',
      photoUrl: null,
      score: 13.5,
      count: 9,
      pendingCount: 0,
      drinks: [{ drinkId: 2, name: 'Bier', count: 9, recordedCount: 9 }],
    },
  ],
  unranked: [],
};

function api() {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      const answers: Record<string, unknown> = {
        '/api/persons': { persons: PERSONS },
        '/api/factors': { factors: [] },
        '/api/scoreboard': BOARD,
      };
      const body = answers[url.split('?')[0] ?? ''];
      if (body === undefined) throw new Error(`unexpected ${url}`);
      return new Response(JSON.stringify(body), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }),
  );
}

async function personStep() {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/zaehlen', component: PersonStep },
      { path: '/zaehlen/:personId', component: { render: () => null } },
    ],
  });
  await router.push('/zaehlen');
  const wrapper = mount(PersonStep, {
    global: { plugins: [router, createAppVuetify()] },
  });
  await flushPromises();
  return wrapper;
}

describe('Zählen, step 1', () => {
  let wrapper: VueWrapper | undefined;

  afterEach(() => {
    wrapper?.unmount();
    vi.unstubAllGlobals();
  });

  it('shows each person’s 40 px avatar left of the name, keeping the tile’s accessible name', async () => {
    api();

    wrapper = await personStep();

    const tiles = wrapper.findAll('.count-tile');
    expect(tiles.map((tile) => tile.attributes('aria-label'))).toEqual([
      'Anna, noch nichts',
      'Daniel, 13,5 Punkte heute',
    ]);
    const [anna, daniel] = tiles;
    expect(anna?.get('.person-avatar img').attributes('src')).toBe(ANNA_PHOTO);
    expect(
      daniel?.get('.person-avatar [data-initials]').attributes('data-initials'),
    ).toBe('D');
    for (const tile of tiles) {
      const avatar = tile.get('.person-avatar');
      expect(avatar.attributes('style')).toContain('width: 40px');
      expect(avatar.attributes('aria-hidden')).toBe('true');
      // Left of the name, in the same row.
      expect(avatar.element.nextElementSibling?.textContent).toBe(
        tile === anna ? 'Anna' : 'Daniel',
      );
    }
  });
});
