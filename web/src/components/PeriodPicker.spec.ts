import { flushPromises, mount } from '@vue/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { DaysAnswer } from '../core/api-client';
import { createDaysRead, type DaysWithData } from '../core/days-with-data';
import { messages } from '../core/messages';
import {
  type CalendarDate,
  type Period,
  type PeriodKind,
  weekOf,
} from '../core/period';
import { stubDialogEnvironment } from '../features/verwalten/manage-page-harness';
import { createAppVuetify } from '../theme';
import PeriodPicker from './PeriodPicker.vue';

const today: CalendarDate = { year: 2026, month: 11, day: 16 };
const day = (dayOfMonth: number, month = 11): Period => ({
  kind: 'day',
  date: { year: 2026, month, day: dayOfMonth },
});

function picker(
  period: Period,
  kinds: PeriodKind[] = ['day', 'all'],
  days?: DaysWithData,
) {
  const wrapper = mount(PeriodPicker, {
    props: {
      kinds,
      today,
      days,
      modelValue: period,
      'onUpdate:modelValue': (chosen: Period) =>
        wrapper.setProps({ modelValue: chosen }),
    },
    global: { plugins: [createAppVuetify()] },
    attachTo: document.body,
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

  describe('the calendar Tag wählen', () => {
    let opened: Picker | undefined;

    beforeEach(() => {
      stubDialogEnvironment();
      Object.defineProperty(document, 'visibilityState', {
        configurable: true,
        get: () => 'visible',
      });
    });

    afterEach(() => {
      opened?.unmount();
      opened = undefined;
      document.body.innerHTML = '';
      vi.unstubAllGlobals();
    });

    /** A days read that answers `instants` and counts its reads. */
    function daysOf(instants: string[]) {
      const read = vi.fn(async (): Promise<DaysAnswer> => ({
        instants,
        etag: '"1"',
      }));
      const days: DaysWithData = {
        read: createDaysRead(read),
        summary: messages.rangliste.allDaysSince,
      };
      return { days, read };
    }

    async function open(
      period: Period,
      kinds = ALL_KINDS,
      days?: DaysWithData,
    ) {
      opened = picker(period, kinds, days);
      await opened
        .get('[data-test="day-bar"] button.day-bar__day')
        .trigger('click');
      await flushPromises();
      return opened;
    }
    const dialog = () => document.querySelector('[role="dialog"]');
    /** Whether the dialog is open; a closed one stays in the DOM while it fades. */
    const isOpen = () =>
      document.querySelector('[role="dialog"].v-overlay--active') !== null;
    function button(name: string): HTMLButtonElement {
      const found = [...(dialog()?.querySelectorAll('button') ?? [])].find(
        (candidate) =>
          candidate.getAttribute('aria-label') === name ||
          candidate.textContent.trim() === name,
      );
      if (!found) throw new Error(`no button ${name}`);
      return found;
    }
    async function click(name: string) {
      button(name).click();
      await flushPromises();
    }
    const marked = () =>
      [...(dialog()?.querySelectorAll('.calendar__day--marked') ?? [])].map(
        (day) => day.getAttribute('aria-label'),
      );

    it('opens from the bar’s day, named Tag wählen with the day it shows', async () => {
      const wrapper = await open(day(14));

      expect(
        wrapper
          .get('[data-test="day-bar"] button.day-bar__day')
          .attributes('aria-label'),
      ).toBe('Tag wählen: Sa., 14.11.');
      expect(isOpen()).toBe(true);
      expect(dialog()?.textContent).toContain('Tag wählen');
      expect(dialog()?.textContent).toContain('November 2026');
      expect(button('Samstag, 14. November').getAttribute('aria-pressed')).toBe(
        'true',
      );
    });

    it('shows a picked day and closes', async () => {
      const wrapper = await open(day(16));

      await click('Dienstag, 10. November');

      expect(chosen(wrapper)).toEqual([[day(10)]]);
      expect(isOpen()).toBe(false);
      expect(wrapper.get('[data-test="day-bar"]').text()).toBe('Di., 10.11.');
    });

    it('shows the week of a picked day under Woche, and that day again under Tag', async () => {
      const wrapper = await open(week(16));

      await click('Mittwoch, 4. November');
      await option(wrapper, 'Tag')?.trigger('click');

      expect(chosen(wrapper)).toEqual([[week(4)], [day(4)]]);
    });

    it('fills the day last shown under Woche, the week’s Monday until a day was shown', async () => {
      await open(week(2));

      expect(
        [...(dialog()?.querySelectorAll('[aria-pressed="true"]') ?? [])].map(
          (pressed) => pressed.getAttribute('aria-label'),
        ),
      ).toEqual(['Montag, 2. November']);
    });

    it('shows today with Heute and closes; Abbrechen closes and changes nothing', async () => {
      const wrapper = await open(day(4));

      await click('Abbrechen');
      expect(isOpen()).toBe(false);
      expect(chosen(wrapper)).toBeUndefined();
      await wrapper.get('button.day-bar__day').trigger('click');
      await flushPromises();
      await click('Heute');

      expect(chosen(wrapper)).toEqual([[day(16)]]);
      expect(isOpen()).toBe(false);
    });

    it('shows the current week with Heute under Woche', async () => {
      const wrapper = await open(week(2));

      await click('Heute');

      expect(chosen(wrapper)).toEqual([[week(16)]]);
    });

    it('opens on the shown day’s month again after browsing and cancelling', async () => {
      const wrapper = await open(day(4));
      await click('Vorheriger Monat');
      expect(dialog()?.textContent).toContain('Oktober 2026');
      await click('Abbrechen');

      await wrapper.get('button.day-bar__day').trigger('click');
      await flushPromises();

      expect(dialog()?.textContent).toContain('November 2026');
    });

    it('dots the local days of the days read, which it reads only while the calendar is open', async () => {
      const { days, read } = daysOf([
        '2026-11-02T22:45:00.000Z', // 23:45 on Monday in Berlin
        '2026-11-02T23:00:00.000Z', // Tuesday
        '2026-11-14T19:30:00.000Z',
      ]);
      opened = picker(day(16), ALL_KINDS, days);
      await flushPromises();
      expect(read).not.toHaveBeenCalled();

      await opened.get('button.day-bar__day').trigger('click');
      await flushPromises();
      expect(marked()).toEqual([
        'Montag, 2. November',
        'Dienstag, 3. November',
        'Samstag, 14. November',
      ]);
      await click('Abbrechen');
      window.dispatchEvent(new Event('focus'));
      await flushPromises();

      expect(read).toHaveBeenCalledTimes(1);
    });

    it('says since when and over how many evenings Gesamt counts, reading the days while it is shown', async () => {
      const { days, read } = daysOf([
        '2026-10-27T19:00:00.000Z',
        '2026-10-27T19:15:00.000Z',
        '2026-11-14T19:30:00.000Z',
      ]);
      opened = picker(day(16), ALL_KINDS, days);
      await flushPromises();
      expect(opened.find('.period-line').exists()).toBe(false);

      await option(opened, 'Gesamt')?.trigger('click');
      await flushPromises();

      expect(opened.get('.period-line').text()).toBe(
        'Alle Tage seit 27.10.2026 · 2 Abende',
      );
      expect(read).toHaveBeenCalledTimes(1);
    });

    it('counts one evening as 1 Abend, and shows no line before a day counts', async () => {
      const one = daysOf(['2026-11-14T19:30:00.000Z']);
      opened = picker({ kind: 'all' }, ALL_KINDS, one.days);
      await flushPromises();
      expect(opened.get('.period-line').text()).toBe(
        'Alle Tage seit 14.11.2026 · 1 Abend',
      );
      opened.unmount();

      opened = picker({ kind: 'all' }, ALL_KINDS, daysOf([]).days);
      await flushPromises();
      expect(opened.find('.period-line').exists()).toBe(false);
      expect(opened.find('.period-gap').exists()).toBe(true);
    });
  });
});
