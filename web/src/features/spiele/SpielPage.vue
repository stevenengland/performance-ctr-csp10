<script setup lang="ts">
import { computed, onMounted } from 'vue';
import { useRouter } from 'vue-router';
import AppFab from '../../components/AppFab.vue';
import {
  loadGames,
  refreshStandings,
  useGames,
  useStandings,
} from '../../core/games';
import { messages } from '../../core/messages';
import { showProblem } from '../../core/snackbar';
import { provideTopBar } from '../../core/top-bar';
import GameStandingList from './GameStandingList.vue';
import { leaveGone } from './game-flow';
import { contextLine, gameStandings, matchPath, ruleLine } from './game-view';

/**
A game's page (§7o): its name and context line in the top bar, the rule that
decides its ranking, and the ranking since the last (re)start, shaped like the
Rangliste. The ranking is read when the page opens and after the device's own
writes. On a duel, `Partie eintragen` (the FAB) opens the recording flow (§7p).
*/
const props = defineProps<{ gameId: string }>();
const SKELETON_ROWS = 3;

const router = useRouter();
const games = useGames();
const gameId = computed(() => Number(props.gameId));
const game = computed(() =>
  games.value?.find((candidate) => candidate.id === gameId.value),
);
const ranking = useStandings(gameId.value);
const standings = computed(() =>
  ranking.value ? gameStandings(ranking.value) : undefined,
);

provideTopBar(() => ({
  title: game.value?.name,
  context: game.value ? contextLine(game.value) : undefined,
}));

onMounted(async () => {
  try {
    await loadGames();
    if (!game.value) leaveGone(router);
    else await refreshStandings(gameId.value);
  } catch (failure) {
    showProblem(failure);
  }
});
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
    <AppFab
      v-if="game?.kind === 'duel'"
      :label="messages.spiele.recordMatch"
      @click="router.push(matchPath(game.id))"
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
