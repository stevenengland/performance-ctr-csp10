<script setup lang="ts">
import { computed, onMounted } from 'vue';
import { useRouter } from 'vue-router';
import CountTile from '../../components/CountTile.vue';
import {
  loadDrinks,
  loadFactors,
  loadPersons,
  useDrinks,
  usePersons,
} from '../../core/catalog';
import { formatNumber, formatPoints } from '../../core/format';
import { messages } from '../../core/messages';
import {
  counterOf,
  scoreOf,
  useScoreboardFeed,
} from '../../core/scoreboard-feed';
import { showProblem } from '../../core/snackbar';
import { provideTopBar } from '../../core/top-bar';
import { leaveGoneStep, quantityStepPath } from './add-flow';

/** Step 2 — Getränk (§7c): drinks with points and the person's counter for today. */
const props = defineProps<{ personId: string }>();
const SKELETON_TILES = 4;

const router = useRouter();
const persons = usePersons();
const drinks = useDrinks();
const feed = useScoreboardFeed();
const board = computed(() => feed.value.board);
const personId = computed(() => Number(props.personId));
const person = computed(() =>
  persons.value?.find((candidate) => candidate.id === personId.value),
);

provideTopBar(() => ({
  title: person.value?.name,
  score: formatNumber(scoreOf(board.value, personId.value)),
}));

function counter(drinkId: number): number {
  return counterOf(board.value, personId.value, drinkId);
}

onMounted(async () => {
  try {
    await Promise.all([loadPersons(), loadDrinks(), loadFactors()]);
    if (!person.value) leaveGoneStep(router);
  } catch (failure) {
    showProblem(failure);
  }
});
</script>

<template>
  <section>
    <h2 class="type-question page-question">
      {{ messages.zaehlen.drinkQuestion }}
    </h2>
    <ul v-if="drinks === undefined" class="tile-grid" aria-busy="true">
      <li v-for="tile in SKELETON_TILES" :key="tile" class="skeleton-tile" />
    </ul>
    <div v-else-if="drinks.length === 0" class="empty-state">
      <p class="type-body">{{ messages.zaehlen.noDrinks }}</p>
      <v-btn
        to="/verwalten/getraenke?anlegen"
        variant="flat"
        color="primary"
        rounded="0"
        class="dialog-button type-row-title"
      >
        {{ messages.zaehlen.createDrink }}
      </v-btn>
    </div>
    <ul v-else class="tile-grid">
      <li v-for="drink in drinks" :key="drink.id">
        <CountTile
          variant="drink"
          :name="drink.name"
          :label="
            messages.zaehlen.drinkTile(
              drink.name,
              formatPoints(drink.points),
              formatNumber(counter(drink.id)),
            )
          "
          :support="formatPoints(drink.points)"
          :numeral="
            counter(drink.id) > 0 ? formatNumber(counter(drink.id)) : undefined
          "
          :tally="counter(drink.id)"
          @click="router.push(quantityStepPath(personId, drink.id))"
        />
      </li>
    </ul>
  </section>
</template>
