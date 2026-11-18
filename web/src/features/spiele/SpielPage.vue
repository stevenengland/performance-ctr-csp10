<script setup lang="ts">
import { mdiHistory, mdiRestart } from '@mdi/js';
import {
  computed,
  onMounted,
  onUnmounted,
  ref,
  shallowRef,
  watch,
  type DeepReadonly,
} from 'vue';
import { useRouter } from 'vue-router';
import AppFab from '../../components/AppFab.vue';
import ConfirmDialog from '../../components/ConfirmDialog.vue';
import PeriodPicker from '../../components/PeriodPicker.vue';
import type { Game, Measure, Standings } from '../../core/api-client';
import type { DaysWithData } from '../../core/days-with-data';
import { formatTime } from '../../core/format';
import {
  forgetStandings,
  type GamePeriod,
  gameDays,
  loadGames,
  restartGame,
  useGames,
  usePeriodStandings,
  useStandings,
} from '../../core/games';
import { messages } from '../../core/messages';
import {
  calendarDateOf,
  isToday,
  type Period,
  type PeriodKind,
} from '../../core/period';
import { showProblem, showSnackbar } from '../../core/snackbar';
import { useToday } from '../../core/today';
import { provideTopBar } from '../../core/top-bar';
import GameStandingList from './GameStandingList.vue';
import { leaveGone } from './game-flow';
import {
  contextLine,
  currentRun,
  gameAsRanked,
  gameHistoryPath,
  gameStandings,
  recordPath,
  ruleLine,
  unrankedGameStandings,
} from './game-view';

/**
A game's page (§7o): its name and context line in the top bar, the period picker
`Aktuell` | `Tag` | `Woche` | `Gesamt`, the rule that decides its ranking, and the
ranking of the period shown, shaped like the Rangliste. It opens on `Aktuell`
every time: the ranking since the last (re)start, kept current like the
Rangliste — polled while shown, at once on focus and after the device's own
writes; while its latest refresh failed, the top bar shows when the ranking was
last confirmed (§6.6). `Tag`, `Woche` and `Gesamt` rank the matches or results of
that period over every run, read apart per game and period, the current ones kept
live; the calendar dots the days the game was played, and `Gesamt` says since when
and over how many days. A points game's `Woche` and `Gesamt` rank by the measure
its chips `Summe` | `Ø pro Ergebnis` choose (the sum on every opening, kept while
switching periods; `Tag` ranks by the sum without asking for one), the chosen one
as the value and the other in the details; switching back shows the ranking kept
for it at once. The start and a points game's direction come with each
ranking read, so a restart or rule edit elsewhere shows with it; the name and a
duel's draw setting come from the games, read again on focus and on return to the
page. The FAB opens the recording flow: `Partie eintragen` on a duel (§7p),
`Ergebnis eintragen` on a points game (§7q); `Verlauf` under the ranking opens the
game's Verlauf (§7r); `Neu starten` beside it starts the game's next run after a
confirmation. A game deleted meanwhile, found on open or by the ranking's poll,
leads back to Spiele.
*/
const props = defineProps<{ gameId: string }>();
const SKELETON_ROWS = 3;
const KINDS: PeriodKind[] = ['run', 'day', 'week', 'all'];
const MEASURES: Measure[] = ['sum', 'average'];
/** The periods a points game ranks by a chosen measure. */
const MEASURED: Period['kind'][] = ['week', 'all'];
/** What a period without any match or result, counted or pending, says. */
const NOTHING_PLAYED: Record<GamePeriod['kind'], string> = {
  day: messages.spiele.nothingPlayedThatDay,
  week: messages.spiele.nothingPlayedThatWeek,
  all: messages.spiele.nothingPlayedEver,
};

const router = useRouter();
const games = useGames();
const gameId = computed(() => Number(props.gameId));

/** `seit heute, 19:30` turns into the date at midnight, even while the page stays open. */
const today = useToday();
const todayDate = computed(() => calendarDateOf(today.value));

/** The period shown, `Aktuell` on every opening; today is held as today, so it moves on at midnight. */
const chosen = shallowRef<Period | 'today'>({ kind: 'run' });
const period = computed<Period>({
  get: (): Period => {
    const shown = chosen.value;
    return shown === 'today' ? { kind: 'day', date: todayDate.value } : shown;
  },
  set: (shown: Period) => {
    chosen.value = isToday(shown, todayDate.value) ? 'today' : shown;
  },
});
const showsRun = computed(() => period.value.kind === 'run');
/** The chips' measure, `Summe` on every opening. */
const chosenMeasure = shallowRef<Measure>('sum');
const listedGame = computed(() =>
  games.value?.find((candidate) => candidate.id === gameId.value),
);
/** The measure the shown period ranks by, while the chips offer one. */
const measure = computed(() =>
  listedGame.value?.kind === 'points' && MEASURED.includes(period.value.kind)
    ? chosenMeasure.value
    : undefined,
);

const ranking = useStandings(gameId.value, showsRun);
const other = usePeriodStandings(() => {
  const shown = period.value;
  return shown.kind === 'run'
    ? undefined
    : { gameId: gameId.value, period: shown, measure: measure.value };
});
/** The shown period's ranking with its freshness. */
const shownRanking = computed(() =>
  showsRun.value ? ranking.value : other.value,
);
const DAYS = computed<DaysWithData>(() => ({
  read: gameDays(gameId.value),
  summary: messages.spiele.allRunsSince,
  mark: messages.spiele.playedThatDay,
}));

/** The ranking of the period shown; the current run's is the run the game knows of. */
const shownOf = (
  listed: DeepReadonly<Game>,
): DeepReadonly<Standings> | undefined =>
  showsRun.value ? currentRun(listed, ranking.value.value) : other.value.value;
const game = computed(() => {
  const listed = listedGame.value;
  return listed && gameAsRanked(listed, shownOf(listed));
});
/** The page waits for the game before it shows a ranking of the current run. */
const ranked = computed(() =>
  game.value ? shownOf(game.value) : shownRanking.value.value,
);
const standings = computed(() =>
  ranked.value ? gameStandings(ranked.value, measure.value) : undefined,
);
const unranked = computed(() =>
  ranked.value ? unrankedGameStandings(ranked.value) : [],
);
const emptyText = computed(() => {
  const shown = period.value;
  if (shown.kind !== 'run') return NOTHING_PLAYED[shown.kind];
  return game.value?.kind === 'points'
    ? messages.spiele.noneYetPoints
    : messages.spiele.noneYetDuel;
});

const confirming = ref(false);
const restarting = ref(false);

provideTopBar(() => {
  const { stale, updatedAt } = shownRanking.value;
  return {
    title: game.value?.name,
    context: game.value
      ? contextLine(game.value, today.value, period.value)
      : undefined,
    stale:
      stale && updatedAt ? messages.stand(formatTime(updatedAt)) : undefined,
  };
});

async function restart() {
  const current = game.value;
  if (!current || restarting.value) return;
  restarting.value = true;
  try {
    await restartGame(current.id);
    confirming.value = false;
    showSnackbar({ text: messages.spiele.restarted(current.name) });
  } catch (failure) {
    showProblem(failure);
  } finally {
    restarting.value = false;
  }
}

watch(
  () => ranking.value.gone ?? other.value.gone,
  (gone) => {
    if (!gone) return;
    forgetStandings(gameId.value);
    leaveGone(router);
  },
);

onMounted(async () => {
  window.addEventListener('focus', onFocus);
  document.addEventListener('visibilitychange', onVisibilityChange);
  try {
    await loadGames();
    if (!game.value) leaveGone(router);
  } catch (failure) {
    showProblem(failure);
  }
});
onUnmounted(() => {
  window.removeEventListener('focus', onFocus);
  document.removeEventListener('visibilitychange', onVisibilityChange);
});

/**
Reads the games again when the page comes back, as the ranking is: a rename or
draw setting changed elsewhere shows then. A failed read keeps the game shown.
*/
async function reread() {
  try {
    await loadGames();
    if (!game.value) leaveGone(router);
  } catch {
    // The ranking's own refresh reports trouble (stale, maintenance).
  }
}

function onFocus() {
  void reread();
}

function onVisibilityChange() {
  if (document.visibilityState === 'visible') void reread();
}
</script>

<template>
  <section class="spiel">
    <PeriodPicker
      v-model="period"
      :kinds="KINDS"
      :today="todayDate"
      :days="DAYS"
    />
    <div
      v-if="measure"
      class="measure"
      role="group"
      :aria-label="messages.spiele.measure"
    >
      <button
        v-for="option in MEASURES"
        :key="option"
        type="button"
        class="type-caption measure__option"
        :aria-pressed="option === measure"
        @click="chosenMeasure = option"
      >
        {{ messages.spiele.measures[option] }}
      </button>
    </div>
    <p v-if="game" class="type-label spiel__rule">{{ ruleLine(game) }}</p>
    <div v-if="standings === undefined" aria-busy="true">
      <div class="spiel__skeleton-card" />
      <div
        v-for="row in SKELETON_ROWS"
        :key="row"
        class="spiel__skeleton-row"
      />
    </div>
    <p
      v-else-if="standings.length === 0 && unranked.length === 0"
      class="type-body empty-state"
    >
      {{ emptyText }}
    </p>
    <GameStandingList
      v-else
      :standings="standings"
      :unranked="unranked"
      :label="game?.name ?? messages.spiele.title"
    />
    <div v-if="game" class="spiel__actions">
      <v-btn
        :to="gameHistoryPath(game.id)"
        :prepend-icon="mdiHistory"
        variant="text"
        class="type-row-title"
      >
        {{ messages.spiele.history }}
      </v-btn>
      <v-btn
        :prepend-icon="mdiRestart"
        variant="text"
        class="type-row-title"
        @click="confirming = true"
      >
        {{ messages.spiele.restart }}
      </v-btn>
    </div>
    <AppFab
      v-if="game"
      :label="
        game.kind === 'duel'
          ? messages.spiele.recordMatch
          : messages.spiele.recordResult
      "
      @click="router.push(recordPath(game))"
    />
    <ConfirmDialog
      v-model="confirming"
      :title="messages.spiele.restartTitle(game?.name ?? '')"
      :body="messages.spiele.restartBody"
      :action="messages.spiele.restart"
      :busy="restarting"
      @confirm="restart"
    />
  </section>
</template>

<style scoped>
.spiel {
  padding-top: 8px;
  /* The ranking's end stays clear of the FAB. */
  padding-bottom: 88px;
}

.measure {
  display: flex;
  gap: 8px;
  margin: 0 0 12px;
}

/* A 32 dp chip (draft) whose touch target reaches 48 dp, without reaching
   into the day/week bar 6 px above. */
.measure__option {
  position: relative;
  min-height: 32px;
  padding: 0 12px;
  border: 1px solid rgb(var(--v-theme-outline));
  border-radius: 8px;
  background: none;
  color: rgb(var(--v-theme-on-surface-variant));
  cursor: pointer;
}

.measure__option::after {
  position: absolute;
  inset: -6px 0 -10px;
  content: '';
}

.measure__option[aria-pressed='true'] {
  border-color: transparent;
  background: rgb(var(--v-theme-secondary-container));
  color: rgb(var(--v-theme-on-secondary-container));
}

.measure__option:focus-visible {
  outline: 2px solid rgb(var(--v-theme-primary));
  outline-offset: 2px;
}

.spiel__rule {
  margin-bottom: 10px;
  color: rgb(var(--v-theme-on-surface-variant));
}

.spiel__actions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-top: 12px;
}

.spiel__actions .v-btn {
  letter-spacing: normal;
  text-transform: none;
}

.spiel__skeleton-card {
  height: 140px;
  margin-bottom: 10px;
  border-radius: 18px;
  background: rgb(var(--v-theme-surface-container-low));
}

.spiel__skeleton-row {
  height: 74px;
  border-bottom: 1px solid rgb(var(--v-theme-outline-variant));
}
</style>
