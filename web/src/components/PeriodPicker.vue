<script setup lang="ts">
import {
  mdiCalendarMonthOutline,
  mdiChevronLeft,
  mdiChevronRight,
} from '@mdi/js';
import { computed, onScopeDispose, shallowRef, watch } from 'vue';
import type { DaysRead, DaysWithData } from '../core/days-with-data';
import { formatDate } from '../core/format';
import { messages } from '../core/messages';
import {
  barLabel,
  type CalendarDate,
  isLive,
  kindLabel,
  localDaysOf,
  type Period,
  type PeriodKind,
  sameDate,
  startOf,
  step,
  weekOf,
} from '../core/period';
import AppDialog from './AppDialog.vue';
import DayCalendar from './DayCalendar.vue';

/**
The one period picker (PRD #70): a segmented switch of the kinds the page offers
and, under `Tag` and `Woche`, a bar that steps one day or week back and forward,
never past the one that contains today. The selected option sits in
`secondary-container`; `primary-container` stays the leader card's. `Tag` and
`Woche` share the day last shown: switching shows that day or its week. The bar's
day opens the calendar `Tag wählen`, where a picked day shows that day or its
week; with the page's days-with-data read, the calendar dots the days with data
that counts and `Gesamt` says since when and over how many days it counts. The
read runs only while the calendar or `Gesamt` is shown.
*/
const props = defineProps<{
  kinds: PeriodKind[];
  /** The viewer's current calendar day. */
  today: CalendarDate;
  /** The days with data that count, for the calendar's dots and the `Gesamt` line. */
  days?: DaysWithData;
}>();
const period = defineModel<Period>({ required: true });

/**
The day `Tag` and `Woche` show, kept while another kind is shown; `undefined` is
today, so a page left open over midnight shows the new today (and its week).
*/
const shownDate = shallowRef<CalendarDate>();
watch(
  period,
  (shown) => {
    if (shown.kind === 'day') remember(shown.date);
    if (shown.kind === 'week' && !inWeek(dateShown(), shown.date)) {
      remember(isLive(shown, props.today) ? props.today : shown.date);
    }
  },
  { immediate: true },
);

/** Keeps a day for `Tag` and `Woche`; today is kept as today, which moves on. */
function remember(date: CalendarDate) {
  shownDate.value = sameDate(date, props.today) ? undefined : date;
}

function dateShown(): CalendarDate {
  return shownDate.value ?? props.today;
}

function inWeek(date: CalendarDate, monday: CalendarDate) {
  return sameDate(weekOf(date).date, monday);
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
  const date = dateShown();
  if (kind === 'day') period.value = { kind, date };
  else if (kind === 'week') period.value = weekOf(date);
  else period.value = { kind };
}

function stepBy(by: number) {
  period.value = step(period.value, by, props.today);
}

const calendarOpen = shallowRef(false);
/** Each opening shows the calendar anew, on the shown day's month. */
const openings = shallowRef(0);

function openCalendar() {
  openings.value += 1;
  calendarOpen.value = true;
}

/** Shows the picked day, or its week under `Woche`, and closes the calendar. */
function pick(date: CalendarDate) {
  remember(date);
  period.value =
    period.value.kind === 'week' ? weekOf(date) : { kind: 'day', date };
  calendarOpen.value = false;
}

/** The days read, while the calendar or the `Gesamt` line needs it. */
const neededRead = computed(() =>
  calendarOpen.value || period.value.kind === 'all'
    ? props.days?.read
    : undefined,
);
let running: DaysRead | undefined;
watch(
  neededRead,
  (read) => {
    running?.stop();
    running = read;
    running?.start();
  },
  { immediate: true },
);
onScopeDispose(() => {
  running?.stop();
});

const markedDays = computed(() =>
  localDaysOf(props.days?.read.state.value.value ?? []),
);
/** `Alle Tage seit 27.10.2026 · 15 Abende`, once a day counts. */
const allLine = computed(() => {
  const first = markedDays.value[0];
  if (period.value.kind !== 'all' || !props.days || !first) return undefined;
  return props.days.summary(
    formatDate(startOf(first)),
    markedDays.value.length,
  );
});
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
    <button
      type="button"
      class="day-bar__day"
      :aria-label="messages.period.pickDayFrom(barLabel(stepped, today))"
      @click="openCalendar"
    >
      <v-icon :icon="mdiCalendarMonthOutline" size="20" />
      <span class="type-row-title" aria-live="polite">
        {{ barLabel(stepped, today) }}
      </span>
    </button>
    <v-btn
      :icon="mdiChevronRight"
      :aria-label="stepNames.on"
      :disabled="isLive(stepped, today)"
      variant="text"
      @click="stepBy(1)"
    />
  </div>
  <p v-else-if="allLine" class="type-support period-line">{{ allLine }}</p>
  <div v-else class="period-gap" />
  <!-- Mounted from its first opening on: the page carries no dialog it never opens. -->
  <AppDialog
    v-if="openings > 0"
    v-model="calendarOpen"
    :title="messages.period.pickDay"
  >
    <DayCalendar
      :key="openings"
      :selected="dateShown()"
      :today="today"
      :marked="markedDays"
      @pick="pick"
    />
    <template #actions>
      <v-btn
        variant="text"
        class="dialog-button type-row-title"
        @click="calendarOpen = false"
      >
        {{ messages.dialog.cancel }}
      </v-btn>
      <v-btn
        variant="flat"
        color="primary"
        rounded="0"
        class="dialog-button type-row-title"
        @click="pick(today)"
      >
        {{ messages.period.today }}
      </v-btn>
    </template>
  </AppDialog>
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

/* The shown day or week, which opens the calendar `Tag wählen`. */
.day-bar__day {
  display: flex;
  flex: 1;
  align-items: center;
  justify-content: center;
  gap: 8px;
  min-height: 48px;
  border: 0;
  border-radius: 10px;
  background: none;
  color: rgb(var(--v-theme-on-surface));
  cursor: pointer;
}

.day-bar__day:focus-visible {
  outline: 2px solid rgb(var(--v-theme-primary));
  outline-offset: -2px;
}

.period-line {
  margin: 12px 4px 10px;
  color: rgb(var(--v-theme-on-surface-variant));
}

.period-gap {
  height: 12px;
}
</style>
