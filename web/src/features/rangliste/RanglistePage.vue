<script setup lang="ts">
import { computed } from 'vue';
import { type LocationQuery, useRoute, useRouter } from 'vue-router';
import PeriodPicker from '../../components/PeriodPicker.vue';
import { type DaysWithData, scoreboardDays } from '../../core/days-with-data';
import { formatTime } from '../../core/format';
import { messages } from '../../core/messages';
import {
  calendarDateOf,
  contextLine,
  isToday,
  type PeriodKind,
} from '../../core/period';
import {
  type DrinksPeriod,
  usePeriodScoreboard,
} from '../../core/period-scoreboard';
import { useScoreboardFeed } from '../../core/scoreboard-feed';
import { useToday } from '../../core/today';
import { provideTopBar } from '../../core/top-bar';
import { useChosenPeriod } from './chosen-period';
import LeaderCard from './LeaderCard.vue';
import RankRow from './RankRow.vue';
import { type Counting, standingsOf, unrankedOf } from './standings';

/**
Rangliste (§7f): the chosen period's leader on the amber card, everyone else with
entries that count in ranked rows, and below them, without a rank, the persons whose
entries of the period all wait for verification. The period picker offers `Tag`
(opening on today), `Woche` and `Gesamt`; its calendar dots the days with drinks
that count, and `Gesamt` says since when and over how many evenings it counts. Today comes from the shared feed, which
also serves Zählen, and stays live; another day, a week or all time is read apart
from it, kept live while it contains the present. While the latest refresh
failed, the top bar shows when the standings were last confirmed (§6.6). The switch
under the picker counts the drinks with their factors or, kept in the URL as
`zaehlung=roh`, the pure quantities; score and order stay factor-based.
*/
const SKELETON_ROWS = 3;
const KINDS: PeriodKind[] = ['day', 'week', 'all'];
const COUNTINGS: Counting[] = ['factored', 'raw'];
/** The calendar's dots and the `Gesamt` line: `Alle Tage seit 27.10.2026 · 15 Abende`. */
const DAYS: DaysWithData = {
  reads: scoreboardDays,
  summary: messages.rangliste.allDaysSince,
  mark: messages.rangliste.counted,
};
/** What a period without any entry, counted or pending, says (today aside). */
const NOTHING_COUNTED: Record<DrinksPeriod['kind'], string> = {
  day: messages.rangliste.noDrinksThatDay,
  week: messages.rangliste.noDrinksThatWeek,
  all: messages.rangliste.noDrinksEver,
};

const today = useToday();
const todayDate = computed(() => calendarDateOf(today.value));
const period = useChosenPeriod(todayDate);
const showsToday = computed(() => isToday(period.value, todayDate.value));

const feed = useScoreboardFeed(showsToday);
const other = usePeriodScoreboard(() =>
  showsToday.value ? undefined : period.value,
);
const shown = computed(() => {
  if (showsToday.value) return feed.value;
  const { value, updatedAt, stale } = other.value;
  return { board: value, updatedAt, stale };
});

const route = useRoute();
const router = useRouter();
/** `zaehlung=roh` counts the pure quantities; anything else, the factored ones. */
const counting = computed<Counting>(() =>
  route.query.zaehlung === 'roh' ? 'raw' : 'factored',
);
function countWith(chosen: Counting) {
  const query: LocationQuery = { ...route.query };
  delete query.zaehlung;
  if (chosen === 'raw') query.zaehlung = 'roh';
  void router.replace({ query });
}

const standings = computed(() =>
  shown.value.board
    ? standingsOf(shown.value.board, counting.value)
    : undefined,
);
const leader = computed(() => standings.value?.[0]);
const others = computed(() => standings.value?.slice(1) ?? []);
const unranked = computed(() =>
  shown.value.board ? unrankedOf(shown.value.board, counting.value) : [],
);
/** The day a place's Verlauf shows: the past day shown, else today (from `Woche` and `Gesamt` too). */
const verlaufDay = computed(() =>
  period.value.kind === 'day' && !showsToday.value
    ? period.value.date
    : undefined,
);
const emptyText = computed(() =>
  showsToday.value
    ? messages.rangliste.noDrinks
    : NOTHING_COUNTED[period.value.kind],
);

provideTopBar(() => {
  const { stale, updatedAt } = shown.value;
  return {
    context: contextLine(period.value, todayDate.value),
    stale:
      stale && updatedAt ? messages.stand(formatTime(updatedAt)) : undefined,
  };
});
</script>

<template>
  <section class="rangliste">
    <PeriodPicker
      v-model="period"
      :kinds="KINDS"
      :today="todayDate"
      :days="DAYS"
    />
    <div
      class="segmented-switch counting-switch"
      role="group"
      :aria-label="messages.rangliste.counting.label"
    >
      <button
        v-for="option in COUNTINGS"
        :key="option"
        type="button"
        class="type-label segmented-switch__option"
        :aria-pressed="counting === option"
        @click="countWith(option)"
      >
        {{ messages.rangliste.counting[option] }}
      </button>
    </div>
    <div v-if="standings === undefined" aria-busy="true">
      <div class="rangliste__skeleton-card" />
      <div
        v-for="row in SKELETON_ROWS"
        :key="row"
        class="rangliste__skeleton-row"
      />
    </div>
    <div
      v-else-if="leader === undefined && unranked.length === 0"
      class="empty-state"
    >
      <p class="type-body">{{ emptyText }}</p>
      <v-btn
        v-if="showsToday"
        to="/zaehlen"
        variant="flat"
        color="primary"
        rounded="0"
        class="dialog-button type-row-title"
      >
        {{ messages.rangliste.count }}
      </v-btn>
    </div>
    <template v-else>
      <ol
        v-if="leader"
        class="rangliste__list"
        :aria-label="messages.navigation.rangliste"
      >
        <LeaderCard :standing="leader" :day="verlaufDay" />
        <RankRow
          v-for="standing in others"
          :key="standing.personId"
          :standing="standing"
          :day="verlaufDay"
        />
      </ol>
      <template v-if="unranked.length > 0">
        <h2 class="type-label rangliste__unranked-title">
          {{ messages.rangliste.unranked }}
        </h2>
        <ul class="rangliste__list" :aria-label="messages.rangliste.unranked">
          <RankRow
            v-for="standing in unranked"
            :key="standing.personId"
            :standing="standing"
            :day="verlaufDay"
          />
        </ul>
      </template>
    </template>
  </section>
</template>

<style scoped>
.rangliste {
  padding-top: 8px;
}

.counting-switch {
  grid-template-columns: 1fr 1fr;
  margin: 8px 0 12px;
}

.rangliste__list {
  margin: 0;
  padding: 0;
  list-style: none;
}

.rangliste__unranked-title {
  margin: 20px 4px 4px;
  color: rgb(var(--v-theme-on-surface-variant));
}

.rangliste__skeleton-card {
  height: 140px;
  margin-bottom: 10px;
  border-radius: 18px;
  background: rgb(var(--v-theme-surface-container-low));
}

.rangliste__skeleton-row {
  height: 74px;
  border-bottom: 1px solid rgb(var(--v-theme-outline-variant));
}
</style>
