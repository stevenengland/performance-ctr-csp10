<script setup lang="ts">
import { computed } from 'vue';
import { formatTime } from '../../core/format';
import { messages } from '../../core/messages';
import { useScoreboardFeed } from '../../core/scoreboard-feed';
import { provideTopBar } from '../../core/top-bar';
import LeaderCard from './LeaderCard.vue';
import RankRow from './RankRow.vue';
import { standingsOf } from './standings';

/**
Rangliste · Heute (§7f): today's leader on the amber card, everyone else with
entries today in ranked rows. The shared feed keeps it current; while its latest
refresh failed, the top bar shows when the standings were last confirmed (§6.6).
*/
const SKELETON_ROWS = 3;

const feed = useScoreboardFeed();
const standings = computed(() =>
  feed.value.board ? standingsOf(feed.value.board) : undefined,
);
const leader = computed(() => standings.value?.[0]);
const others = computed(() => standings.value?.slice(1) ?? []);

provideTopBar(() => {
  const { stale, updatedAt } = feed.value;
  return {
    stale:
      stale && updatedAt ? messages.stand(formatTime(updatedAt)) : undefined,
  };
});
</script>

<template>
  <section class="rangliste">
    <div v-if="standings === undefined" aria-busy="true">
      <div class="rangliste__skeleton-card" />
      <div
        v-for="row in SKELETON_ROWS"
        :key="row"
        class="rangliste__skeleton-row"
      />
    </div>
    <div v-else-if="leader === undefined" class="empty-state">
      <p class="type-body">{{ messages.rangliste.noDrinks }}</p>
      <v-btn
        to="/zaehlen"
        variant="flat"
        color="primary"
        rounded="0"
        class="dialog-button type-row-title"
      >
        {{ messages.rangliste.count }}
      </v-btn>
    </div>
    <ol
      v-else
      class="rangliste__list"
      :aria-label="messages.navigation.rangliste"
    >
      <LeaderCard :standing="leader" />
      <RankRow
        v-for="standing in others"
        :key="standing.personId"
        :standing="standing"
      />
    </ol>
  </section>
</template>

<style scoped>
.rangliste {
  padding-top: 8px;
}

.rangliste__list {
  margin: 0;
  padding: 0;
  list-style: none;
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
