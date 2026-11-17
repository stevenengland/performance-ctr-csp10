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
  isToday,
  kindLabel,
  type Period,
  type PeriodKind,
  step,
} from '../core/period';

/**
The one period picker (PRD #70): a segmented switch of the kinds the page offers
and, under `Tag`, a bar that steps one day back and forward, never past today. The
selected option sits in `secondary-container`; `primary-container` stays the
leader card's. Switching back to `Tag` returns to the day shown last.
*/
const props = defineProps<{
  kinds: PeriodKind[];
  /** The viewer's current calendar day. */
  today: CalendarDate;
}>();
const period = defineModel<Period>({ required: true });

/** The day `Tag` shows, kept while another kind is shown. */
const lastDay = shallowRef<Extract<Period, { kind: 'day' }>>();
watch(
  period,
  (shown) => {
    if (shown.kind === 'day') lastDay.value = shown;
  },
  { immediate: true },
);

const shownDay = computed(() =>
  period.value.kind === 'day' ? period.value : undefined,
);

function choose(kind: PeriodKind) {
  if (kind === period.value.kind) return;
  period.value =
    kind === 'day'
      ? (lastDay.value ?? { kind: 'day', date: props.today })
      : { kind };
}

function stepBy(days: number) {
  period.value = step(period.value, days, props.today);
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
  <div v-if="shownDay" class="day-bar" data-test="day-bar">
    <v-btn
      :icon="mdiChevronLeft"
      :aria-label="messages.period.previousDay"
      variant="text"
      @click="stepBy(-1)"
    />
    <p class="day-bar__day" aria-live="polite">
      <v-icon :icon="mdiCalendarMonthOutline" size="20" />
      <span class="type-row-title">{{ barLabel(shownDay, today) }}</span>
    </p>
    <v-btn
      :icon="mdiChevronRight"
      :aria-label="messages.period.nextDay"
      :disabled="isToday(shownDay, today)"
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
