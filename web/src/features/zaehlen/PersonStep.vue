<script setup lang="ts">
import { computed, onMounted } from 'vue';
import { useRouter } from 'vue-router';
import CountTile from '../../components/CountTile.vue';
import { loadFactors, loadPersons, usePersons } from '../../core/catalog';
import { formatNumber } from '../../core/format';
import { messages } from '../../core/messages';
import { scoreOf, useScoreboardFeed } from '../../core/scoreboard-feed';
import { showProblem } from '../../core/snackbar';
import { choosePerson } from './add-flow';

/** Step 1 — Namen (§7b): one tile per person with today's total score. */
const SKELETON_TILES = 4;

const router = useRouter();
const persons = usePersons();
const feed = useScoreboardFeed();
const board = computed(() => feed.value.board);

function score(personId: number): string | undefined {
  const value = scoreOf(board.value, personId);
  return value === 0 ? undefined : formatNumber(value);
}

onMounted(() => {
  // The factors decide how many steps the indicator shows (§6.1).
  Promise.all([loadPersons(), loadFactors()]).catch(showProblem);
});
</script>

<template>
  <section>
    <h2 class="type-question page-question">{{ messages.zaehlen.question }}</h2>
    <ul v-if="persons === undefined" class="tile-grid" aria-busy="true">
      <li v-for="tile in SKELETON_TILES" :key="tile" class="skeleton-tile" />
    </ul>
    <div v-else-if="persons.length === 0" class="empty-state">
      <p class="type-body">{{ messages.zaehlen.noPersons }}</p>
      <v-btn
        to="/verwalten/personen?anlegen"
        variant="flat"
        color="primary"
        rounded="0"
        class="dialog-button type-row-title"
      >
        {{ messages.zaehlen.createPerson }}
      </v-btn>
    </div>
    <ul v-else class="tile-grid">
      <li v-for="person in persons" :key="person.id">
        <CountTile
          variant="person"
          :name="person.name"
          :label="messages.zaehlen.personTile(person.name, score(person.id))"
          :support="
            score(person.id) === undefined
              ? messages.zaehlen.nothingYet
              : messages.zaehlen.scoreToday
          "
          :numeral="score(person.id)"
          @click="choosePerson(router, person.id)"
        />
      </li>
    </ul>
  </section>
</template>
