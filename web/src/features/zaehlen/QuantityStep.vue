<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { useRouter } from 'vue-router';
import QuantityStepper from '../../components/QuantityStepper.vue';
import {
  loadDrinks,
  loadFactors,
  loadPersons,
  useDrinks,
  useFactors,
  usePersons,
} from '../../core/catalog';
import { formatNumber } from '../../core/format';
import { messages } from '../../core/messages';
import { useOnline } from '../../core/online';
import {
  counterOf,
  scoreOf,
  useScoreboardFeed,
} from '../../core/scoreboard-feed';
import { showProblem } from '../../core/snackbar';
import { provideTopBar } from '../../core/top-bar';
import {
  addFlowSteps,
  factorStepPath,
  leaveGoneStep,
  returnToNames,
  saveEntry,
} from './add-flow';

/**
Step 3 — Anzahl (§7d): the stepper starts at what is booked today. Once factors
exist, `Weiter` goes on to the factor step with the number of new drinks; while
none exist, `Speichern` saves them (step 4 is skipped). Offline, nothing can be
saved.
*/
const props = defineProps<{ personId: string; drinkId: string }>();

const router = useRouter();
const online = useOnline();
const persons = usePersons();
const drinks = useDrinks();
const factors = useFactors();
const feed = useScoreboardFeed();
const board = computed(() => feed.value.board);
const personId = computed(() => Number(props.personId));
const drinkId = computed(() => Number(props.drinkId));
const person = computed(() =>
  persons.value?.find((candidate) => candidate.id === personId.value),
);
const drink = computed(() =>
  drinks.value?.find((candidate) => candidate.id === drinkId.value),
);
const booked = computed(() =>
  counterOf(board.value, personId.value, drinkId.value),
);
const added = ref(0);
const saving = ref(false);
/** Unknown until the factors are loaded. */
const withFactorStep = computed(() =>
  factors.value === undefined ? undefined : addFlowSteps(factors.value) === 4,
);
const disabled = computed(
  () =>
    added.value === 0 ||
    !person.value ||
    !drink.value ||
    withFactorStep.value === undefined ||
    (!withFactorStep.value && !online.value),
);

provideTopBar(() => ({
  title: person.value?.name,
  context: drink.value?.name,
  score: formatNumber(scoreOf(board.value, personId.value)),
}));

async function next() {
  if (withFactorStep.value) {
    await router.push(
      factorStepPath(personId.value, drinkId.value, added.value),
    );
    return;
  }
  if (!person.value || !drink.value) return;
  saving.value = true;
  await saveEntry(
    {
      personId: personId.value,
      drinkId: drinkId.value,
      quantity: added.value,
      factorId: null,
    },
    { drink: drink.value.name, person: person.value.name },
    () => returnToNames(router),
  );
  saving.value = false;
}

onMounted(async () => {
  try {
    await Promise.all([loadPersons(), loadDrinks(), loadFactors()]);
    if (!person.value || !drink.value) leaveGoneStep(router);
  } catch (failure) {
    showProblem(failure);
  }
});
</script>

<template>
  <section class="quantity-step">
    <h2 class="type-question page-question">
      {{ messages.zaehlen.quantityQuestion }}
    </h2>
    <QuantityStepper
      v-model="added"
      :booked="booked"
      :drink="drink?.name ?? ''"
    />
    <v-btn
      block
      size="x-large"
      variant="flat"
      color="primary"
      rounded="0"
      class="dialog-button type-row-title"
      :disabled="disabled"
      :loading="saving"
      @click="next"
    >
      {{ withFactorStep ? messages.zaehlen.next : messages.zaehlen.save }}
    </v-btn>
  </section>
</template>

<style scoped>
/* Wider windows only widen grids (§5): the stepper keeps its phone width. */
.quantity-step {
  max-width: 480px;
}
</style>
