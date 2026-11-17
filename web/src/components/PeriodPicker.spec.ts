import { mount } from '@vue/test-utils';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  type CalendarDate,
  type Period,
  type PeriodKind,
  weekOf,
} from '../core/period';
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
const week = (dayOfMonth: number, month = 11): Period =>
  weekOf({ year: 2026, month, day: dayOfMonth });
const ALL_KINDS: PeriodKind[] = ['day', 'week', 'all'];

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

  it('offers Tag | Woche | Gesamt and shows the week of the shown day under Woche', async () => {
    const wrapper = picker(day(4), ALL_KINDS);

    await option(wrapper, 'Woche')?.trigger('click');

    expect(chosen(wrapper)).toEqual([[week(2)]]);
    expect(options(wrapper)).toEqual([
      ['Tag', 'false'],
      ['Woche', 'true'],
      ['Gesamt', 'false'],
    ]);
  });

  it('names the week in the bar: Diese Woche, Letzte Woche or its number and days', async () => {
    const wrapper = picker(week(16), ALL_KINDS);
    const label = () => wrapper.get('[data-test="day-bar"]').text();

    expect(label()).toBe('Diese Woche');
    await wrapper.setProps({ modelValue: week(9) });
    expect(label()).toBe('Letzte Woche');
    await wrapper.setProps({ modelValue: week(2) });
    expect(label()).toBe('KW 45 · 02.11.–08.11.');
  });

  it('steps one week back and forward, its next control disabled on the current week', async () => {
    const wrapper = picker(week(16), ALL_KINDS);
    const previousWeek = () =>
      wrapper.get('button[aria-label="Vorherige Woche"]');
    const nextWeek = () => wrapper.get('button[aria-label="Nächste Woche"]');
    expect(nextWeek().attributes('disabled')).toBeDefined();

    await previousWeek().trigger('click');
    await previousWeek().trigger('click');
    expect(nextWeek().attributes('disabled')).toBeUndefined();
    await nextWeek().trigger('click');

    expect(chosen(wrapper)).toEqual([[week(9)], [week(2)], [week(9)]]);
  });

  it('returns to the day it showed when Tag is chosen again after Woche', async () => {
    const wrapper = picker(day(4), ALL_KINDS);

    await option(wrapper, 'Woche')?.trigger('click');
    await option(wrapper, 'Gesamt')?.trigger('click');
    await option(wrapper, 'Woche')?.trigger('click');
    await option(wrapper, 'Tag')?.trigger('click');

    expect(chosen(wrapper)).toEqual([
      [week(2)],
      [{ kind: 'all' }],
      [week(2)],
      [day(4)],
    ]);
  });

  it('opens Woche on the current week when it starts on another kind', async () => {
    const wrapper = picker({ kind: 'all' }, ALL_KINDS);

    await option(wrapper, 'Woche')?.trigger('click');

    expect(chosen(wrapper)).toEqual([[week(16)]]);
  });
});
