<script setup lang="ts">
import { mdiChevronRight } from '@mdi/js';
import { onMounted } from 'vue';
import { loadGames, useGames } from '../../core/games';
import { messages } from '../../core/messages';
import { showProblem } from '../../core/snackbar';
import { contextLine, gamePath } from './game-view';

/**
Spiele (§7n): every game alphabetically, each with its kind and the day its
ranking counts from. A game opens its page; with no games yet, the empty state
links to Verwalten → Spiele with the create dialog open.
*/
const SKELETON_CARDS = 3;

const games = useGames();

onMounted(async () => {
  try {
    await loadGames();
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
</style>
