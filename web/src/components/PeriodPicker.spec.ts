import { mount } from '@vue/test-utils';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { CalendarDate, Period, PeriodKind } from '../core/period';
import { createAppVuetify } from '../theme';
import PeriodPicker from './PeriodPicker.vue';

const today: CalendarDate = { year: 2026, month: 11, day: 16 };
const day = (dayOfMonth: number, month = 11): Period => ({
  kind: 'day',
  date: { year: 2026, month, day: dayOfMonth },
});

function picker(period: Period, kinds: PeriodKind[] = ['day', 'all']) {
  const wrapper = mount(PeriodPicker, {
    props: {
      kinds,
      today,
      modelValue: period,
      'onUpdate:modelValue': (chosen: Period) =>
        wrapper.setProps({ modelValue: chosen }),
    },
    global: { plugins: [createAppVuetify()] },
  });
  return wrapper;
}

type Picker = ReturnType<typeof picker>;
const options = (wrapper: Picker) =>
  wrapper
    .get('[role="group"][aria-label="Zeitraum"]')
    .findAll('button')
    .map((button) => [button.text(), button.attributes('aria-pressed')]);
const option = (wrapper: Picker, name: string) =>
  wrapper
    .findAll('[role="group"] button')
    .find((button) => button.text() === name);
const previous = (wrapper: Picker) =>
  wrapper.get('button[aria-label="Vorheriger Tag"]');
const next = (wrapper: Picker) =>
  wrapper.get('button[aria-label="Nächster Tag"]');
const chosen = (wrapper: Picker) => wrapper.emitted('update:modelValue');

describe('PeriodPicker', () => {
  const zone = process.env.TZ;

  beforeEach(() => {
    process.env.TZ = 'Europe/Berlin';
  });

  afterEach(() => {
    process.env.TZ = zone;
  });

  it('offers the kinds the page passes as a switch named Zeitraum, the shown one pressed', () => {
    expect(options(picker(day(16)))).toEqual([
      ['Tag', 'true'],
      ['Gesamt', 'false'],
    ]);
    expect(options(picker({ kind: 'run' }, ['run', 'day', 'all']))).toEqual([
      ['Aktuell', 'true'],
      ['Tag', 'false'],
      ['Gesamt', 'false'],
    ]);
  });

  it('chooses all time from the switch and hides the day bar', async () => {
    const wrapper = picker(day(16));

    await option(wrapper, 'Gesamt')?.trigger('click');

    expect(chosen(wrapper)).toEqual([[{ kind: 'all' }]]);
    expect(options(wrapper)).toEqual([
      ['Tag', 'false'],
      ['Gesamt', 'true'],
    ]);
    expect(wrapper.find('[data-test="day-bar"]').exists()).toBe(false);
  });

  it('shows Heute, Gestern or the short weekday and date in the day bar', async () => {
    const wrapper = picker(day(16));
    const label = () => wrapper.get('[data-test="day-bar"]').text();

    expect(label()).toBe('Heute');
    await wrapper.setProps({ modelValue: day(15) });
    expect(label()).toBe('Gestern');
    await wrapper.setProps({ modelValue: day(14) });
    expect(label()).toBe('Sa., 14.11.');
  });

  it('steps one day back and forward, its next control disabled on today', async () => {
    const wrapper = picker(day(16));
    expect(next(wrapper).attributes('disabled')).toBeDefined();

    await previous(wrapper).trigger('click');
    await previous(wrapper).trigger('click');
    expect(next(wrapper).attributes('disabled')).toBeUndefined();
    await next(wrapper).trigger('click');

    expect(chosen(wrapper)).toEqual([[day(15)], [day(14)], [day(15)]]);
  });

  it('steps across a month and returns to the day it showed when Tag is chosen again', async () => {
    const wrapper = picker(day(1));

    await previous(wrapper).trigger('click');
    await option(wrapper, 'Gesamt')?.trigger('click');
    await option(wrapper, 'Tag')?.trigger('click');

    expect(chosen(wrapper)).toEqual([
      [day(31, 10)],
      [{ kind: 'all' }],
      [day(31, 10)],
    ]);
  });

  it('opens Tag on today when it starts on another kind', async () => {
    const wrapper = picker({ kind: 'all' });

    await option(wrapper, 'Tag')?.trigger('click');

    expect(chosen(wrapper)).toEqual([[day(16)]]);
  });
});
