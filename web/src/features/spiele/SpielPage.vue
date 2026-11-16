<script setup lang="ts">
import { mdiHistory, mdiRestart } from '@mdi/js';
import {
  computed,
  onMounted,
  onUnmounted,
  ref,
  watch,
  type DeepReadonly,
} from 'vue';
import { useRouter } from 'vue-router';
import AppFab from '../../components/AppFab.vue';
import ConfirmDialog from '../../components/ConfirmDialog.vue';
import type { Game } from '../../core/api-client';
import { formatTime } from '../../core/format';
import {
  forgetStandings,
  loadGames,
  restartGame,
  useGames,
  useStandings,
} from '../../core/games';
import { messages } from '../../core/messages';
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
} from './game-view';

/**
A game's page (§7o): its name and context line in the top bar, the rule that
decides its ranking, and the ranking since the last (re)start, shaped like the
Rangliste and kept current like it: polled while the page is open, at once on
focus and after the device's own writes; while its latest refresh failed, the top
bar shows when the ranking was last confirmed (§6.6). The start and a points
game's direction come with each ranking read, so a restart or rule edit elsewhere
shows with it; the name and a duel's draw setting come from the games, read again
on focus and on return to the page. The FAB opens the recording flow: `Partie eintragen` on a duel (§7p), `Ergebnis eintragen` on a points game (§7q);
`Verlauf` under the ranking opens the game's Verlauf (§7r); `Neu starten` beside it
starts the game's next run after a confirmation. A game deleted meanwhile, found
on open or by the ranking's poll, leads back to Spiele.
*/
const props = defineProps<{ gameId: string }>();
const SKELETON_ROWS = 3;

const router = useRouter();
const games = useGames();
const gameId = computed(() => Number(props.gameId));
const ranking = useStandings(gameId.value);
const game = computed(() => {
  const listed = games.value?.find(
    (candidate) => candidate.id === gameId.value,
  );
  return listed && gameAsRanked(listed, run(listed));
});
/** The ranking of the run the game knows of; the page waits for the game before it shows one. */
const run = (listed: DeepReadonly<Game>) =>
  currentRun(listed, ranking.value.value);
const standings = computed(() => {
  const ranked = game.value ? run(game.value) : ranking.value.value;
  return ranked ? gameStandings(ranked) : undefined;
});

/** `seit heute, 19:30` turns into the date at midnight, even while the page stays open. */
const today = useToday();

const confirming = ref(false);
const restarting = ref(false);

provideTopBar(() => {
  const { stale, updatedAt } = ranking.value;
  return {
    title: game.value?.name,
    context: game.value ? contextLine(game.value, today.value) : undefined,
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
  () => ranking.value.gone,
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
    <p v-if="game" class="type-label spiel__rule">{{ ruleLine(game) }}</p>
    <div v-if="standings === undefined" aria-busy="true">
      <div class="spiel__skeleton-card" />
      <div
        v-for="row in SKELETON_ROWS"
        :key="row"
        class="spiel__skeleton-row"
      />
    </div>
    <p v-else-if="standings.length === 0" class="type-body empty-state">
      {{
        game?.kind === 'points'
          ? messages.spiele.noneYetPoints
          : messages.spiele.noneYetDuel
      }}
    </p>
    <GameStandingList
      v-else
      :standings="standings"
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
