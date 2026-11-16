<script setup lang="ts">
import { computed, onMounted } from 'vue';
import { useRouter } from 'vue-router';
import { loadGames, useGames } from '../../core/games';
import { messages } from '../../core/messages';
import { showProblem, showSnackbar } from '../../core/snackbar';
import { provideTopBar } from '../../core/top-bar';
import { contextLine, ruleLine } from './game-view';

/**
A game's page (§7o): its name and context line in the top bar, the rule that
decides its ranking, and the ranking since the last (re)start — still empty
until matches and results can be recorded.
*/
const props = defineProps<{ gameId: string }>();
const SKELETON_ROWS = 3;

const router = useRouter();
const games = useGames();
const gameId = computed(() => Number(props.gameId));
const game = computed(() =>
  games.value?.find((candidate) => candidate.id === gameId.value),
);

provideTopBar(() => ({
  title: game.value?.name,
  context: game.value ? contextLine(game.value) : undefined,
}));

/** The game was deleted (on another phone): back to Spiele (§4, §9). */
function leaveGone() {
  void router.replace('/spiele');
  showSnackbar({ text: messages.zaehlen.gone });
}

onMounted(async () => {
  try {
    await loadGames();
    if (!game.value) leaveGone();
  } catch (failure) {
    showProblem(failure);
  }
});
</script>

<template>
  <section class="spiel">
    <div v-if="game === undefined" aria-busy="true">
      <div class="spiel__skeleton-card" />
      <div
        v-for="row in SKELETON_ROWS"
        :key="row"
        class="spiel__skeleton-row"
      />
    </div>
    <template v-else>
      <p class="type-label spiel__rule">{{ ruleLine(game) }}</p>
      <p class="type-body empty-state">
        {{
          game.kind === 'points'
            ? messages.spiele.noneYetPoints
            : messages.spiele.noneYetDuel
        }}
      </p>
    </template>
  </section>
</template>

<style scoped>
.spiel {
  padding-top: 8px;
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
