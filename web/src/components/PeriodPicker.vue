<script setup lang="ts">
import {
  mdiCalendarMonthOutline,
  mdiChevronLeft,
  mdiChevronRight,
} from '@mdi/js';
import { computed, shallowRef, watch } from 'vue';
import { messages } from '../core/messages';
import {
  barLabel,
  type CalendarDate,
  isLive,
  kindLabel,
  type Period,
  type PeriodKind,
  sameDate,
  step,
  weekOf,
} from '../core/period';

/**
The one period picker (PRD #70): a segmented switch of the kinds the page offers
and, under `Tag` and `Woche`, a bar that steps one day or week back and forward,
never past the one that contains today. The selected option sits in
`secondary-container`; `primary-container` stays the leader card's. `Tag` and
`Woche` share the day last shown: switching shows that day or its week.
*/
const props = defineProps<{
  kinds: PeriodKind[];
  /** The viewer's current calendar day. */
  today: CalendarDate;
}>();
const period = defineModel<Period>({ required: true });

/** The day `Tag` and `Woche` show, kept while another kind is shown; until one is shown, today. */
const shownDate = shallowRef<CalendarDate>();
watch(
  period,
  (shown) => {
    if (shown.kind === 'day') shownDate.value = shown.date;
    if (shown.kind === 'week' && !inWeek(shownDate.value, shown.date)) {
      shownDate.value = shown.date;
    }
  },
  { immediate: true },
);

function inWeek(date: CalendarDate | undefined, monday: CalendarDate) {
  return date !== undefined && sameDate(weekOf(date).date, monday);
}

/** The day or week the bar names, if one is shown. */
const stepped = computed(() =>
  period.value.kind === 'day' || period.value.kind === 'week'
    ? period.value
    : undefined,
);
const stepNames = computed(() =>
  stepped.value?.kind === 'week'
    ? { back: messages.period.previousWeek, on: messages.period.nextWeek }
    : { back: messages.period.previousDay, on: messages.period.nextDay },
);

function choose(kind: PeriodKind) {
  if (kind === period.value.kind) return;
  const date = shownDate.value ?? props.today;
  if (kind === 'day') period.value = { kind, date };
  else if (kind === 'week') period.value = weekOf(date);
  else period.value = { kind };
}

function stepBy(by: number) {
  period.value = step(period.value, by, props.today);
}
</script>

<template>
  <div
    class="period-switch"
    role="group"
    :aria-label="messages.period.label"
    :style="{ gridTemplateColumns: `repeat(${String(kinds.length)}, 1fr)` }"
  >
    <button
      v-for="kind in kinds"
      :key="kind"
      type="button"
      class="type-label period-switch__option"
      :aria-pressed="period.kind === kind"
      @click="choose(kind)"
    >
      {{ kindLabel(kind) }}
    </button>
  </div>
  <div v-if="stepped" class="day-bar" data-test="day-bar">
    <v-btn
      :icon="mdiChevronLeft"
      :aria-label="stepNames.back"
      variant="text"
      @click="stepBy(-1)"
    />
    <p class="day-bar__day" aria-live="polite">
      <v-icon :icon="mdiCalendarMonthOutline" size="20" />
      <span class="type-row-title">{{ barLabel(stepped, today) }}</span>
    </p>
    <v-btn
      :icon="mdiChevronRight"
      :aria-label="stepNames.on"
      :disabled="isLive(stepped, today)"
      variant="text"
      @click="stepBy(1)"
    />
  </div>
  <div v-else class="period-gap" />
</template>

<style scoped>
.period-switch {
  display: grid;
  overflow: hidden;
  margin-bottom: 4px;
  border: 1px solid rgb(var(--v-theme-outline));
  border-radius: 10px;
}

.period-switch__option {
  min-width: 0;
  min-height: 44px;
  padding: 0 4px;
  border: 0;
  background: none;
  color: rgb(var(--v-theme-on-surface));
  cursor: pointer;
}

.period-switch__option + .period-switch__option {
  border-left: 1px solid rgb(var(--v-theme-outline));
}

.period-switch__option[aria-pressed='true'] {
  background: rgb(var(--v-theme-secondary-container));
  color: rgb(var(--v-theme-on-secondary-container));
}

.period-switch__option:focus-visible {
  outline: 2px solid rgb(var(--v-theme-primary));
  outline-offset: -2px;
}

.day-bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 6px;
}

/* Room for the calendar dialog `Tag wählen`, which this label will open. */
.day-bar__day {
  display: flex;
  flex: 1;
  align-items: center;
  justify-content: center;
  gap: 8px;
  min-height: 48px;
  margin: 0;
  color: rgb(var(--v-theme-on-surface));
}

.period-gap {
  height: 12px;
}
</style>
