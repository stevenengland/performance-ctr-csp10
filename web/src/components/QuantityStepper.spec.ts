import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';
import QuantityStepper from './QuantityStepper.vue';

function stepper(booked: number, added = 0, max?: number) {
  return mount(QuantityStepper, {
    props: {
      booked,
      drink: 'Bier',
      modelValue: added,
      max,
      'onUpdate:modelValue': () => undefined,
    },
  });
}

const less = (wrapper: ReturnType<typeof stepper>) =>
  wrapper.get('[aria-label="Eins weniger"]');
const more = (wrapper: ReturnType<typeof stepper>) =>
  wrapper.get('[aria-label="Eins mehr"]');

describe('QuantityStepper', () => {
  it('starts at the booked count and says what is booked and new', () => {
    const wrapper = stepper(4, 2);

    expect(wrapper.get('output').text()).toBe('6');
    expect(wrapper.text()).toContain('Bier heute');
    expect(wrapper.text()).toContain('bisher 4, neu dazu 2');
    expect(wrapper.findAll('.tally-marks__new')).toHaveLength(2);
  });

  it('adds and takes back new drinks', async () => {
    const wrapper = stepper(4, 1);

    await more(wrapper).trigger('click');
    await less(wrapper).trigger('click');

    expect(wrapper.emitted('update:modelValue')).toEqual([[2], [0]]);
  });

  it('never takes back a booked drink: − is disabled without new ones', () => {
    expect(less(stepper(4, 0)).attributes('disabled')).toBeDefined();
    expect(less(stepper(4, 1)).attributes('disabled')).toBeUndefined();
  });

  it('stops at 99 new drinks', () => {
    expect(more(stepper(4, 99)).attributes('disabled')).toBeDefined();
    expect(more(stepper(4, 98)).attributes('disabled')).toBeUndefined();
  });

  it('shows a fractional booked count the German way', () => {
    expect(stepper(4.5, 1).get('output').text()).toBe('5,5');
  });
});
