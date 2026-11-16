<script setup lang="ts">
import { mdiChevronRight } from '@mdi/js';
import { onMounted, shallowRef } from 'vue';
import { getStandings, type Game } from '../../core/api-client';
import { loadGames, useGames } from '../../core/games';
import { messages } from '../../core/messages';
import { showProblem } from '../../core/snackbar';
import { contextLine, gamePath, gameStandings } from './game-view';

/**
Spiele (draft): every game alphabetically, each with its kind, the date its
ranking counts from and its current leader. A game opens its page; with no games
yet, the empty state links to Verwalten → Spiele.
*/
const SKELETON_CARDS = 3;

const games = useGames();
/** The leader line per game id; absent until its ranking has loaded. */
const leaders = shallowRef<Record<number, string>>({});

async function loadLeaders(list: readonly Readonly<Game>[]) {
  const lines = await Promise.all(
    list.map(async (game) => {
      const answer = await getStandings(game.id);
      if (answer === 'unchanged') return [game.id, ''] as const;
      const first = gameStandings(answer.standings)[0];
      return [
        game.id,
        first
          ? messages.spiele.leader(first.name, first.valueText)
          : messages.spiele.noResults,
      ] as const;
    }),
  );
  leaders.value = Object.fromEntries(lines);
}

onMounted(async () => {
  try {
    await loadGames();
    if (games.value) await loadLeaders(games.value);
  } catch (failure) {
    showProblem(failure);
  }
});
</script>

<template>
  <section class="spiele">
    <ul v-if="games === undefined" class="spiele__grid" aria-busy="true">
      <li v-for="card in SKELETON_CARDS" :key="card" class="skeleton-tile" />
    </ul>
    <div v-else-if="games.length === 0" class="empty-state">
      <p class="type-body">{{ messages.spiele.empty }}</p>
      <v-btn
        to="/verwalten/spiele?anlegen"
        variant="flat"
        color="primary"
        rounded="0"
        class="dialog-button type-row-title"
      >
        {{ messages.spiele.create }}
      </v-btn>
    </div>
    <ul v-else class="spiele__grid" :aria-label="messages.spiele.title">
      <li v-for="game in games" :key="game.id">
        <RouterLink :to="gamePath(game.id)" class="tile game-card">
          <span class="game-card__top">
            <span class="type-tile-name game-card__name">{{ game.name }}</span>
            <v-icon :icon="mdiChevronRight" size="24" />
          </span>
          <span class="type-support game-card__context">{{
            contextLine(game)
          }}</span>
          <span class="type-label game-card__leader">{{
            leaders[game.id]
          }}</span>
        </RouterLink>
      </li>
    </ul>
  </section>
</template>

<style scoped>
.spiele {
  padding-top: 8px;
}

.spiele__grid {
  display: grid;
  gap: 12px;
  margin: 0;
  padding: 0;
  list-style: none;
}

@media (width >= 600px) {
  .spiele__grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}

.game-card {
  gap: 4px;
  min-height: 0;
  text-decoration: none;
}

.game-card__top {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}

.game-card__name {
  overflow: hidden;
  min-width: 0;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.game-card__context {
  color: rgb(var(--v-theme-on-surface-variant));
}

.game-card__leader {
  min-height: 20px;
  margin-top: 6px;
}
</style>
