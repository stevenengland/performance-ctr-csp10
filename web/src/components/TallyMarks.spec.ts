import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';
import TallyMarks from './TallyMarks.vue';

function strokes(count: number, height = 18) {
  return mount(TallyMarks, { props: { count, height } });
}

describe('TallyMarks', () => {
  it('draws bundles of five: four upright strokes and one diagonal across them', () => {
    const wrapper = strokes(7);

    expect(wrapper.findAll('[data-stroke="upright"]')).toHaveLength(6);
    expect(wrapper.findAll('[data-stroke="diagonal"]')).toHaveLength(1);
  });

  it('draws only the whole part of the value', () => {
    expect(strokes(4.5).findAll('[data-stroke]')).toHaveLength(4);
  });

  it.each([0, 26])('draws nothing for %d', (count) => {
    expect(strokes(count).find('svg').exists()).toBe(false);
  });

  it('is decorative and hidden from assistive technology', () => {
    expect(strokes(3).find('svg').attributes('aria-hidden')).toBe('true');
  });

  it('leans each stroke by a fixed amount, so every render looks the same', () => {
    expect(strokes(12).html()).toBe(strokes(12).html());
    const leans = strokes(4)
      .findAll('[data-stroke="upright"]')
      .map((line) => line.attributes('x1'));
    expect(new Set(leans).size).toBeGreaterThan(1);
  });

  it('has the requested height', () => {
    expect(strokes(3, 30).find('svg').attributes('height')).toBe('30');
  });
});
