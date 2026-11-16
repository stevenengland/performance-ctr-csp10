import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';
import { h } from 'vue';
import { createAppVuetify } from '../theme';
import CatalogList from './CatalogList.vue';

const ITEMS = [
  { id: 1, name: 'Bier' },
  { id: 2, name: 'Radler' },
];

function list(slots: Parameters<typeof mount>[1]['slots'] = {}) {
  return mount(CatalogList<{ id: number; name: string }>, {
    props: {
      items: ITEMS,
      label: 'Getränke',
      empty: 'Noch keine Getränke.',
      support: (item: { name: string }) => `${item.name.length} Punkte`,
    },
    slots,
    global: { plugins: [createAppVuetify()] },
  });
}

/** What a row's main part holds, in order, by class. */
const parts = (wrapper: ReturnType<typeof list>) =>
  wrapper
    .findAll('.list__main')
    .map((main) => [...main.element.children].map((child) => child.className));

describe('CatalogList', () => {
  it('shows only the name and the supporting line without a leading slot', () => {
    const wrapper = list();

    expect(parts(wrapper)).toEqual([
      ['type-row-title list__title', 'type-support list__support'],
      ['type-row-title list__title', 'type-support list__support'],
    ]);
    expect(wrapper.find('.list__main--leading').exists()).toBe(false);
  });

  it('puts the leading slot of each item before its name', () => {
    const wrapper = list({
      leading: ({ item }: { item: { name: string } }) =>
        h('span', { class: 'lead', 'data-name': item.name }),
    });

    expect(parts(wrapper)[0]).toEqual([
      'lead',
      'type-row-title list__title',
      'type-support list__support',
    ]);
    expect(
      wrapper.findAll('.lead').map((lead) => lead.attributes('data-name')),
    ).toEqual(['Bier', 'Radler']);
    expect(wrapper.findAll('.list__row').map((row) => row.text())).toEqual([
      'Bier4 Punkte',
      'Radler6 Punkte',
    ]);
  });
});
