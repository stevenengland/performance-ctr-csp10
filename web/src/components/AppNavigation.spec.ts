import { flushPromises, mount, type VueWrapper } from '@vue/test-utils';
import { afterEach, describe, expect, it } from 'vitest';
import { createMemoryHistory, createRouter } from 'vue-router';
import type { Destination } from '../router';
import { createAppVuetify } from '../theme';
import AppNavigation from './AppNavigation.vue';

const route = (path: string, destination: Destination, child?: true) => ({
  path,
  component: { render: () => null },
  meta: { title: '', destination, child },
});

async function navigation(
  variant: 'bar' | 'rail',
  path: string,
): Promise<VueWrapper> {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      route('/zaehlen', 'zaehlen'),
      route('/rangliste', 'rangliste'),
      route('/verlauf/:personId', 'rangliste', true),
      route('/spiele', 'spiele'),
      route('/spiele/:gameId', 'spiele', true),
      route('/verwalten', 'verwalten'),
    ],
  });
  await router.push(path);
  const wrapper = mount(AppNavigation, {
    props: { variant },
    global: { plugins: [router, createAppVuetify()] },
  });
  await flushPromises();
  return wrapper;
}

const destinations = (wrapper: VueWrapper) =>
  wrapper
    .findAll('a')
    .map((link) => [link.text(), link.attributes('href')] as const);

const active = (wrapper: VueWrapper) =>
  wrapper.get('a[aria-current="page"]').text();

describe('the navigation', () => {
  let wrapper: VueWrapper | undefined;

  afterEach(() => {
    wrapper?.unmount();
  });

  it.each(['bar', 'rail'] as const)(
    'offers Zählen, Rangliste, Spiele and Verwalten in that order as a %s',
    async (variant) => {
      wrapper = await navigation(variant, '/zaehlen');

      expect(wrapper.get('nav').classes()).toContain(`navigation--${variant}`);
      expect(destinations(wrapper)).toEqual([
        ['Zählen', '/zaehlen'],
        ['Rangliste', '/rangliste'],
        ['Spiele', '/spiele'],
        ['Verwalten', '/verwalten'],
      ]);
    },
  );

  it('keeps Spiele active on the list and on a game’s page', async () => {
    wrapper = await navigation('bar', '/spiele');
    expect(active(wrapper)).toBe('Spiele');
    wrapper.unmount();

    wrapper = await navigation('rail', '/spiele/2');
    expect(active(wrapper)).toBe('Spiele');
  });

  it('keeps Rangliste active on a person’s Verlauf, as before', async () => {
    wrapper = await navigation('bar', '/verlauf/3');

    expect(active(wrapper)).toBe('Rangliste');
  });
});
