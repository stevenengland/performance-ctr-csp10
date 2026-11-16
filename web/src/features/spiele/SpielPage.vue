<script setup lang="ts">
import { computed, onMounted } from 'vue';
import { useRouter } from 'vue-router';
import AppFab from '../../components/AppFab.vue';
import { formatTime } from '../../core/format';
import { loadGames, useGames, useStandings } from '../../core/games';
import { messages } from '../../core/messages';
import { showProblem } from '../../core/snackbar';
import { provideTopBar } from '../../core/top-bar';
import GameStandingList from './GameStandingList.vue';
import { leaveGone } from './game-flow';
import { contextLine, gameStandings, recordPath, ruleLine } from './game-view';

/**
A game's page (§7o): its name and context line in the top bar, the rule that
decides its ranking, and the ranking since the last (re)start, shaped like the
Rangliste and kept current like it: polled while the page is open, at once on
focus and after the device's own writes; while its latest refresh failed, the top
bar shows when the ranking was last confirmed (§6.6). The FAB opens the recording flow: `Partie eintragen` on a duel (§7p), `Ergebnis eintragen` on a points game (§7q).
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
  ranking.value.value ? gameStandings(ranking.value.value) : undefined,
);

provideTopBar(() => {
  const { stale, updatedAt } = ranking.value;
  return {
    title: game.value?.name,
    context: game.value ? contextLine(game.value) : undefined,
    stale:
      stale && updatedAt ? messages.stand(formatTime(updatedAt)) : undefined,
  };
});

onMounted(async () => {
  try {
    await loadGames();
    if (!game.value) leaveGone(router);
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
      v-if="game"
      :label="
        game.kind === 'duel'
          ? messages.spiele.recordMatch
          : messages.spiele.recordResult
      "
      @click="router.push(recordPath(game))"
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
