<script setup lang="ts">
import PersonAvatar from '../../components/PersonAvatar.vue';
import TallyMarks from '../../components/TallyMarks.vue';
import { verlaufPath } from '../verlauf/history';
import type { Standing } from './standings';

/**
Rank 1 on the Rangliste (§7f): amber, the one loud thing on the screen. Name and the
tally of the total count left, the score right; under them the total count and the
per-drink counters. The card opens the person's Verlauf.
*/
defineProps<{ standing: Standing }>();
</script>

<template>
  <li class="leader-place">
    <RouterLink
      :to="verlaufPath(standing.personId)"
      class="leader"
      data-test="leader"
      :aria-label="standing.label"
    >
      <div class="leader__top">
        <div class="leader__who">
          <PersonAvatar
            :name="standing.name"
            :photo-url="standing.photoUrl"
            :size="64"
            class="leader__avatar"
          />
          <p class="type-name-hero leader__name">{{ standing.name }}</p>
          <TallyMarks :count="standing.count" :height="26" />
        </div>
        <p class="leader__score">{{ standing.score }}</p>
      </div>
      <p class="type-label leader__count">{{ standing.countText }}</p>
      <p class="type-support">{{ standing.drinks }}</p>
    </RouterLink>
  </li>
</template>

<style scoped>
.leader-place {
  margin-bottom: 10px;
}

.leader {
  display: block;
  padding: 16px 18px 14px;
  border-radius: 18px;
  background: rgb(var(--v-theme-primary-container));
  color: rgb(var(--v-theme-on-primary-container));
  text-decoration: none;
}

.leader__top {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
}

.leader__avatar {
  margin: 3px 0 6px 3px;
  box-shadow: 0 0 0 3px rgb(var(--v-theme-on-primary-container));
}

.leader__who {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 4px;
  min-width: 0;
}

.leader__name {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* score-hero (§3.2). */
.leader__score {
  flex: none;
  font-family: var(--font-display);
  font-size: 84px;
  font-weight: 900;
  line-height: 68px;
  font-variant-numeric: tabular-nums;
}

.leader__count {
  margin-top: 10px;
}
</style>
