<script setup lang="ts">
import PersonAvatar from '../../components/PersonAvatar.vue';
import { verlaufPath } from '../verlauf/history';
import type { Standing, UnrankedStanding } from './standings';

/**
Rank 2 and below on the Rangliste (§7f): the rank, the avatar, the name with the per-drink
counters beneath, and the score with the total count beneath on the right, then
`+2 offen` while entries wait for verification. A person whose entries all wait has
the same row without rank and score, with only `+2 offen` on the right. The row opens
the person's Verlauf.
*/
defineProps<{ standing: Standing | UnrankedStanding }>();
</script>

<template>
  <li class="rank-place">
    <RouterLink
      :to="verlaufPath(standing.personId)"
      class="rank"
      :data-test="'rank' in standing ? 'rank' : 'unranked'"
      :aria-label="standing.label"
    >
      <span class="type-title rank__position">{{
        'rank' in standing ? standing.rank : ''
      }}</span>
      <PersonAvatar
        :name="standing.name"
        :photo-url="standing.photoUrl"
        :size="44"
      />
      <span class="rank__who">
        <span class="rank__name">{{ standing.name }}</span>
        <span class="type-support rank__drinks">{{ standing.drinks }}</span>
      </span>
      <span class="rank__total">
        <template v-if="'rank' in standing">
          <span class="type-numeral">{{ standing.score }}</span>
          <span class="type-caption rank__count">{{ standing.countText }}</span>
        </template>
        <span v-if="standing.pending" class="assist-chip type-caption">{{
          standing.pending
        }}</span>
      </span>
    </RouterLink>
  </li>
</template>

<style scoped>
.rank-place {
  border-bottom: 1px solid rgb(var(--v-theme-outline-variant));
}

.rank {
  display: grid;
  grid-template-columns: 28px 44px minmax(0, 1fr) auto;
  gap: 10px;
  align-items: center;
  padding: 12px 4px;
  color: rgb(var(--v-theme-on-surface));
  text-decoration: none;
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
  gap: 2px;
}

.rank__count {
  color: rgb(var(--v-theme-on-surface-variant));
  font-weight: 400;
}
</style>
