<script setup lang="ts">
import type { Standing } from './standings';

/**
Rank 2 and below on the Rangliste (§7f): the rank, the name with the per-drink
counters beneath, and the score with the total count beneath on the right.
*/
defineProps<{ standing: Standing }>();
</script>

<template>
  <li class="rank" data-test="rank" :aria-label="standing.label">
    <span class="type-title rank__position">{{ standing.rank }}</span>
    <span class="rank__who">
      <span class="rank__name">{{ standing.name }}</span>
      <span class="type-support rank__drinks">{{ standing.drinks }}</span>
    </span>
    <span class="rank__total">
      <span class="type-numeral">{{ standing.score }}</span>
      <span class="type-caption rank__count">{{ standing.countText }}</span>
    </span>
  </li>
</template>

<style scoped>
.rank {
  display: grid;
  grid-template-columns: 36px minmax(0, 1fr) auto;
  gap: 10px;
  align-items: center;
  padding: 12px 4px;
  border-bottom: 1px solid rgb(var(--v-theme-outline-variant));
}

.rank__position {
  color: rgb(var(--v-theme-on-surface-variant));
  text-align: center;
}

.rank__who,
.rank__total {
  display: flex;
  flex-direction: column;
  min-width: 0;
}

/* rank-name (§3.2). */
.rank__name {
  overflow: hidden;
  font-family: var(--font-display);
  font-size: 24px;
  font-weight: 900;
  line-height: 24px;
  letter-spacing: 0.02em;
  text-overflow: ellipsis;
  text-transform: uppercase;
  white-space: nowrap;
}

.rank__drinks {
  margin-top: 3px;
  color: rgb(var(--v-theme-on-surface-variant));
}

.rank__total {
  align-items: flex-end;
}

.rank__count {
  color: rgb(var(--v-theme-on-surface-variant));
  font-weight: 400;
}
</style>
