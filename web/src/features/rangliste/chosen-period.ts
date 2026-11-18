import { computed, shallowRef, type Ref, type WritableComputedRef } from 'vue';
import { type CalendarDate, isToday } from '../../core/period';
import type { DrinksPeriod } from '../../core/period-scoreboard';

/**
The Rangliste's chosen period while the app runs, so returning from a Verlauf shows
it again; a fresh start opens on today. `undefined` is today, which moves on at
midnight; any other period stays as chosen (a past day is its calendar date).
*/
const chosen = shallowRef<DrinksPeriod>();

/** The Rangliste's period, given the viewer's current day; choosing today follows today again. */
export function useChosenPeriod(
  today: Readonly<Ref<CalendarDate>>,
): WritableComputedRef<DrinksPeriod> {
  return computed({
    get: () => chosen.value ?? { kind: 'day', date: today.value },
    set: (period) => {
      chosen.value = isToday(period, today.value) ? undefined : period;
    },
  });
}
