<script setup lang="ts">
import { messages } from '../../core/messages';
import type { GameStanding, UnrankedGameStanding } from './game-view';

/**
A game's ranking, shaped like the drink Rangliste (§7f): the leader on the amber
card, everyone else in ranked rows with the record beneath the name and the value
on the right, then `+2 offen` while rows of the run wait for verification. Persons
whose rows all wait follow under `Noch nicht gewertet`, without rank and value.
Places are not links: a game has one Verlauf, not one per person.
*/
defineProps<{
  standings: GameStanding[];
  unranked: UnrankedGameStanding[];
  label: string;
}>();
</script>

<template>
  <ol v-if="standings.length > 0" class="game-ranking" :aria-label="label">
    <li
      v-for="standing in standings"
      :key="standing.personId"
      :class="standing.rank === 1 ? 'game-leader' : 'game-rank'"
      :aria-label="standing.label"
      data-test="game-place"
    >
      <template v-if="standing.rank === 1">
        <div class="game-leader__top">
          <p class="type-name-hero game-leader__name">{{ standing.name }}</p>
          <p class="game-leader__value">{{ standing.value }}</p>
        </div>
        <p class="type-label game-leader__value-text">
          {{ standing.valueText }}
          <span
            v-if="standing.pending"
            class="assist-chip game-leader__pending"
            >{{ standing.pending }}</span
          >
        </p>
        <p class="type-support">{{ standing.details }}</p>
      </template>
      <template v-else>
        <span class="type-title game-rank__position">{{ standing.rank }}</span>
        <span class="game-rank__who">
          <span class="game-rank__name">{{ standing.name }}</span>
          <span class="type-support game-rank__details">{{
            standing.details
          }}</span>
        </span>
        <span class="game-rank__total">
          <span class="type-numeral game-rank__value">{{
            standing.value
          }}</span>
          <span v-if="standing.pending" class="assist-chip type-caption">{{
            standing.pending
          }}</span>
        </span>
      </template>
    </li>
  </ol>
  <template v-if="unranked.length > 0">
    <h2 class="type-label game-ranking__unranked-title">
      {{ messages.rangliste.unranked }}
    </h2>
    <ul class="game-ranking" :aria-label="messages.rangliste.unranked">
      <li
        v-for="standing in unranked"
        :key="standing.personId"
        class="game-rank"
        :aria-label="standing.label"
        data-test="game-unranked"
      >
        <span class="game-rank__position" />
        <span class="game-rank__who">
          <span class="game-rank__name">{{ standing.name }}</span>
        </span>
        <span class="game-rank__total">
          <span class="assist-chip type-caption">{{ standing.pending }}</span>
        </span>
      </li>
    </ul>
  </template>
</template>

<style scoped>
.game-ranking {
  margin: 0;
  padding: 0;
  list-style: none;
}

.game-leader {
  margin-bottom: 10px;
  padding: 16px 18px 14px;
  border-radius: 18px;
  background: rgb(var(--v-theme-primary-container));
  color: rgb(var(--v-theme-on-primary-container));
}

.game-leader__top {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
}

.game-leader__name {
  overflow: hidden;
  min-width: 0;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* score-hero (§3.2). */
.game-leader__value {
  flex: none;
  font-family: var(--font-display);
  font-size: 84px;
  font-weight: 900;
  line-height: 68px;
  font-variant-numeric: tabular-nums;
}

.game-leader__value-text {
  display: flex;
  align-items: center;
  gap: 8px;
}

/* On the amber card the chip takes the card's colour, like everything else on it. */
.game-leader__pending {
  border-color: currentcolor;
  color: inherit;
}

.game-ranking__unranked-title {
  margin: 20px 4px 4px;
  color: rgb(var(--v-theme-on-surface-variant));
}

.game-rank {
  display: grid;
  grid-template-columns: 36px minmax(0, 1fr) auto;
  gap: 10px;
  align-items: center;
  padding: 12px 4px;
  border-bottom: 1px solid rgb(var(--v-theme-outline-variant));
}

.game-rank__position {
  color: rgb(var(--v-theme-on-surface-variant));
  text-align: center;
}

.game-rank__who {
  display: flex;
  flex-direction: column;
  min-width: 0;
}

/* rank-name (§3.2). */
.game-rank__name {
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

.game-rank__total {
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 2px;
}

.game-rank__details {
  margin-top: 3px;
  color: rgb(var(--v-theme-on-surface-variant));
}
</style>
