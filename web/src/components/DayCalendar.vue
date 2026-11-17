<script setup lang="ts">
import { mdiChevronLeft, mdiChevronRight } from '@mdi/js';
import { computed, shallowRef, useId } from 'vue';
import { formatCalendarDay, formatMonth } from '../core/format';
import { messages } from '../core/messages';
import {
  type CalendarDate,
  isAfter,
  isoDate,
  sameDate,
  startOf,
} from '../core/period';

/**
A month of the calendar dialog `Tag wählen` (PRD #70), Monday first: the days with
data that counts carry a dot, which screen readers get as the day's description (the
mark, e.g. `Gezählt`) beside its name; today is outlined, the selected day is filled and
pressed, and days after today cannot be picked. It opens on the selected day's
month; it browses back freely but never past the month of today.
*/
const props = defineProps<{
  selected: CalendarDate;
  /** The viewer's current calendar day. */
  today: CalendarDate;
  /** The local days with data that counts, from a days-with-data read. */
  marked: readonly CalendarDate[];
  /** What a dot says to a screen reader: `Gezählt`, `Gespielt`. */
  mark?: string;
}>();
const emit = defineEmits<{ pick: [date: CalendarDate] }>();

/** The month shown, as its first day. */
const month = shallowRef<CalendarDate>({ ...props.selected, day: 1 });
const markedKeys = computed(() => new Set(props.marked.map(isoDate)));
const isMarked = (date: CalendarDate) => markedKeys.value.has(isoDate(date));
const markId = useId();
const isCurrentMonth = computed(
  () =>
    month.value.year === props.today.year &&
    month.value.month === props.today.month,
);

/** The blanks before the 1st (Monday first), then every day of the month. */
const cells = computed(() => {
  const { year, month: monthOfYear } = month.value;
  const weekday = new Date(Date.UTC(year, monthOfYear - 1, 1)).getUTCDay();
  const length = new Date(Date.UTC(year, monthOfYear, 0)).getUTCDate();
  return {
    blanks: (weekday + 6) % 7,
    days: Array.from({ length }, (_, index): CalendarDate => ({
      year,
      month: monthOfYear,
      day: index + 1,
    })),
  };
});

function browse(by: number) {
  const first = new Date(month.value.year, month.value.month - 1 + by, 1);
  month.value = {
    year: first.getFullYear(),
    month: first.getMonth() + 1,
    day: 1,
  };
}
</script>

<template>
  <div class="calendar">
    <div class="calendar__head">
      <v-btn
        :icon="mdiChevronLeft"
        :aria-label="messages.period.previousMonth"
        variant="text"
        density="comfortable"
        @click="browse(-1)"
      />
      <p
        class="type-row-title calendar__month"
        aria-live="polite"
        data-test="calendar-month"
      >
        {{ formatMonth(startOf(month)) }}
      </p>
      <v-btn
        :icon="mdiChevronRight"
        :aria-label="messages.period.nextMonth"
        :disabled="isCurrentMonth"
        variant="text"
        density="comfortable"
        @click="browse(1)"
      />
    </div>
    <div class="calendar__grid" aria-hidden="true">
      <span
        v-for="weekday in messages.period.weekdays"
        :key="weekday"
        class="type-caption calendar__weekday"
      >
        {{ weekday }}
      </span>
    </div>
    <div class="calendar__grid">
      <span
        v-for="blank in cells.blanks"
        :key="blank"
        class="calendar__blank"
      />
      <button
        v-for="date in cells.days"
        :key="date.day"
        type="button"
        class="calendar__day"
        :class="{
          'calendar__day--selected': sameDate(date, selected),
          'calendar__day--today': sameDate(date, today),
          'calendar__day--marked': isMarked(date),
        }"
        :disabled="isAfter(date, today)"
        :aria-label="formatCalendarDay(startOf(date))"
        :aria-pressed="sameDate(date, selected)"
        :aria-describedby="mark && isMarked(date) ? markId : undefined"
        @click="emit('pick', date)"
      >
        {{ date.day }}
      </button>
    </div>
    <span v-if="mark" :id="markId" hidden>{{ mark }}</span>
  </div>
</template>

<style scoped>
.calendar__head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 6px;
}

.calendar__month {
  margin: 0;
}

.calendar__grid {
  display: grid;
  grid-template-columns: repeat(7, 1fr);
  justify-items: center;
  gap: 2px;
}

.calendar__weekday {
  padding: 4px 0;
  color: rgb(var(--v-theme-on-surface-variant));
}

.calendar__day {
  position: relative;
  width: 40px;
  height: 40px;
  border: 0;
  border-radius: 50%;
  background: none;
  color: rgb(var(--v-theme-on-surface));
  font-family: var(--font-text);
  font-size: 15px;
  font-weight: 600;
  font-variant-numeric: tabular-nums;
  cursor: pointer;
}

.calendar__day:disabled {
  color: rgb(var(--v-theme-on-surface-variant));
  opacity: 0.4;
  cursor: default;
}

.calendar__day--today {
  box-shadow: inset 0 0 0 1.5px rgb(var(--v-theme-outline));
}

.calendar__day--marked::after {
  position: absolute;
  bottom: 5px;
  left: calc(50% - 2.5px);
  width: 5px;
  height: 5px;
  border-radius: 50%;
  background: rgb(var(--v-theme-primary));
  content: '';
}

.calendar__day--selected {
  background: rgb(var(--v-theme-primary));
  box-shadow: none;
  color: rgb(var(--v-theme-on-primary));
}

.calendar__day--selected::after {
  background: rgb(var(--v-theme-on-primary));
}

.calendar__day:focus-visible {
  outline: 2px solid rgb(var(--v-theme-primary));
  outline-offset: 2px;
}
</style>
