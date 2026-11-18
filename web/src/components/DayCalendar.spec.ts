import { mount } from '@vue/test-utils';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { type CalendarDate, monthOf } from '../core/period';
import { createAppVuetify } from '../theme';
import DayCalendar from './DayCalendar.vue';

const today: CalendarDate = { year: 2026, month: 11, day: 17 };
const november = (day: number): CalendarDate => ({
  year: 2026,
  month: 11,
  day,
});

function calendar(
  selected: CalendarDate,
  marked: CalendarDate[] = [],
  shownToday = today,
  mark?: string,
) {
  const wrapper = mount(DayCalendar, {
    props: {
      selected,
      today: shownToday,
      marked,
      mark,
      month: monthOf(selected),
      'onUpdate:month': (shown: CalendarDate) =>
        wrapper.setProps({ month: shown }),
    },
    global: { plugins: [createAppVuetify()] },
  });
  return wrapper;
}

type Calendar = ReturnType<typeof calendar>;
const days = (wrapper: Calendar) => wrapper.findAll('.calendar__day');
const dayNamed = (wrapper: Calendar, name: string) =>
  wrapper.get(`.calendar__day[aria-label="${name}"]`);
const month = (wrapper: Calendar) =>
  wrapper.get('[data-test="calendar-month"]').text();
const previousMonth = (wrapper: Calendar) =>
  wrapper.get('button[aria-label="Vorheriger Monat"]');
const nextMonth = (wrapper: Calendar) =>
  wrapper.get('button[aria-label="Nächster Monat"]');

describe('DayCalendar', () => {
  const zone = process.env.TZ;

  beforeEach(() => {
    process.env.TZ = 'Europe/Berlin';
  });

  afterEach(() => {
    process.env.TZ = zone;
  });

  it('shows the selected day’s month, Monday first, each day named by its weekday and date', () => {
    const wrapper = calendar(november(13));

    expect(month(wrapper)).toBe('November 2026');
    expect(
      wrapper.findAll('.calendar__weekday').map((head) => head.text()),
    ).toEqual(['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So']);
    expect(days(wrapper)).toHaveLength(30);
    // 01.11.2026 is a Sunday: six blanks before it.
    expect(wrapper.findAll('.calendar__blank')).toHaveLength(6);
    expect(days(wrapper)[0]?.attributes('aria-label')).toBe(
      'Sonntag, 1. November',
    );
    expect(days(wrapper)[0]?.text()).toBe('1');
  });

  it('presses the selected day and outlines today', () => {
    const wrapper = calendar(november(13));

    const pressed = days(wrapper).filter(
      (day) => day.attributes('aria-pressed') === 'true',
    );
    expect(pressed.map((day) => day.attributes('aria-label'))).toEqual([
      'Freitag, 13. November',
    ]);
    expect(pressed[0]?.classes()).toContain('calendar__day--selected');
    expect(dayNamed(wrapper, 'Dienstag, 17. November').classes()).toContain(
      'calendar__day--today',
    );
    expect(
      dayNamed(wrapper, 'Dienstag, 17. November').attributes('aria-pressed'),
    ).toBe('false');
  });

  it('marks the days it is given, and only those', () => {
    const wrapper = calendar(november(13), [november(3), november(13)]);

    expect(
      days(wrapper)
        .filter((day) => day.classes('calendar__day--marked'))
        .map((day) => day.text()),
    ).toEqual(['3', '13']);
  });

  it('describes the marked days to screen readers with the mark, keeping each day’s name', () => {
    const wrapper = calendar(
      november(13),
      [november(3), november(13)],
      today,
      'Gezählt',
    );
    const description = (day: ReturnType<Calendar['get']>) =>
      (day.attributes('aria-describedby') ?? '')
        .split(' ')
        .filter(Boolean)
        .map((id) => wrapper.get(`[id="${id}"]`).text());

    expect(description(dayNamed(wrapper, 'Dienstag, 3. November'))).toEqual([
      'Gezählt',
    ]);
    expect(description(dayNamed(wrapper, 'Freitag, 13. November'))).toEqual([
      'Gezählt',
    ]);
    expect(description(dayNamed(wrapper, 'Mittwoch, 4. November'))).toEqual([]);
  });

  it('disables the days after today and picks an earlier one', async () => {
    const wrapper = calendar(november(13));

    expect(
      days(wrapper)
        .filter((day) => day.attributes('disabled') !== undefined)
        .map((day) => day.text()),
    ).toEqual([
      '18',
      '19',
      '20',
      '21',
      '22',
      '23',
      '24',
      '25',
      '26',
      '27',
      '28',
      '29',
      '30',
    ]);
    await dayNamed(wrapper, 'Dienstag, 17. November').trigger('click');
    await dayNamed(wrapper, 'Montag, 2. November').trigger('click');

    expect(wrapper.emitted('pick')).toEqual([[november(17)], [november(2)]]);
  });

  it('browses back across a year and forward again, never past the current month, telling the page the month it shows', async () => {
    const wrapper = calendar(november(13), [
      { year: 2025, month: 12, day: 31 },
    ]);
    expect(nextMonth(wrapper).attributes('disabled')).toBeDefined();

    for (let step = 0; step < 11; step += 1) {
      await previousMonth(wrapper).trigger('click');
    }
    expect(month(wrapper)).toBe('Dezember 2025');
    expect(dayNamed(wrapper, 'Mittwoch, 31. Dezember').classes()).toContain(
      'calendar__day--marked',
    );
    expect(
      days(wrapper).filter((day) => day.attributes('disabled') !== undefined),
    ).toHaveLength(0);
    expect(nextMonth(wrapper).attributes('disabled')).toBeUndefined();
    await nextMonth(wrapper).trigger('click');

    expect(month(wrapper)).toBe('Januar 2026');
    expect(wrapper.props('month')).toEqual({ year: 2026, month: 1, day: 1 });
    expect(
      days(wrapper).filter((day) => day.attributes('aria-pressed') === 'true'),
    ).toHaveLength(0);
  });
});
