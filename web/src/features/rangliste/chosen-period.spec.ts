import { describe, expect, it, vi } from 'vitest';
import { ref } from 'vue';
import type { CalendarDate } from '../../core/period';
import { useChosenPeriod } from './chosen-period';

const sunday: CalendarDate = { year: 2026, month: 11, day: 15 };
const monday: CalendarDate = { year: 2026, month: 11, day: 16 };
const saturday: CalendarDate = { year: 2026, month: 11, day: 14 };

describe('the Rangliste’s chosen period', () => {
  it('is today until another period is chosen, and moves on with today at midnight', () => {
    const today = ref(sunday);
    const period = useChosenPeriod(today);
    period.value = { kind: 'day', date: sunday };

    expect(period.value).toEqual({ kind: 'day', date: sunday });
    today.value = monday;
    expect(period.value).toEqual({ kind: 'day', date: monday });
  });

  it('keeps a past day as its calendar date when midnight passes, and all time as it is', () => {
    const today = ref(sunday);
    const period = useChosenPeriod(today);

    period.value = { kind: 'day', date: saturday };
    today.value = monday;
    expect(period.value).toEqual({ kind: 'day', date: saturday });

    period.value = { kind: 'all' };
    expect(useChosenPeriod(ref(monday)).value).toEqual({ kind: 'all' });
    period.value = { kind: 'day', date: monday };
  });

  it('opens on today after a fresh start, whatever was chosen before', async () => {
    useChosenPeriod(ref(sunday)).value = { kind: 'all' };

    vi.resetModules();
    const fresh = await import('./chosen-period');

    expect(fresh.useChosenPeriod(ref(monday)).value).toEqual({
      kind: 'day',
      date: monday,
    });
    useChosenPeriod(ref(sunday)).value = { kind: 'day', date: sunday };
  });
});
