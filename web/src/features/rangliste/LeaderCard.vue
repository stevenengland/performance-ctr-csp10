<script setup lang="ts">
import PersonAvatar from '../../components/PersonAvatar.vue';
import TallyMarks from '../../components/TallyMarks.vue';
import type { CalendarDate } from '../../core/period';
import { verlaufPath } from '../verlauf/history';
import type { Standing } from './standings';

/**
Rank 1 on the Rangliste (§7f): amber, the one loud thing on the screen. Name and the
tally of the total count left, under the ringed avatar (beside the name it left too
little room for a long name), the score right; under them the total count and the
per-drink counters, and `+2 offen` beside the count while entries wait for verification.
The card opens the person's Verlauf (of the past day shown, else of today).
*/
defineProps<{
  standing: Standing;
  /** The past day whose Verlauf the place opens; today's without one. */
  day?: CalendarDate | undefined;
}>();
</script>

<template>
  <li class="leader-place">
    <RouterLink
      :to="verlaufPath(standing.personId, day)"
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
      <p class="type-label leader__count">
        {{ standing.countText }}
        <span v-if="standing.pending" class="assist-chip leader__pending">{{
          standing.pending
        }}</span>
      </p>
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
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: 10px;
}

/* On the amber card the chip takes the card's colour, like everything else on it. */
.leader__pending {
  border-color: currentcolor;
  color: inherit;
}
</style>
