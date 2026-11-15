<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { useRouter } from 'vue-router';
import CountTile from '../../components/CountTile.vue';
import type { Factor } from '../../core/api-client';
import {
  loadDrinks,
  loadFactors,
  loadPersons,
  useDrinks,
  useFactors,
  usePersons,
} from '../../core/catalog';
import { formatMultiplier, formatNumber } from '../../core/format';
import { messages } from '../../core/messages';
import { useOnline } from '../../core/online';
import { scoreOf, useScoreboardFeed } from '../../core/scoreboard-feed';
import { showProblem } from '../../core/snackbar';
import { provideTopBar } from '../../core/top-bar';
import { leaveGoneStep, returnToNames, saveEntry } from './add-flow';

/**
Step 4 — Faktor (§7e): `Kein Faktor`, then one raspberry tile per factor. The tap
saves: the tapped tile turns amber while the others wait; without an answer the
step stays, its buttons enabled again. Offline, nothing can be saved.
*/
const props = defineProps<{
  personId: string;
  drinkId: string;
  quantity: string;
}>();
/** The choice being saved: a factor's id, `null` for `Kein Faktor`. */
type Choice = number | null;

const router = useRouter();
const online = useOnline();
const persons = usePersons();
const drinks = useDrinks();
const factors = useFactors();
const feed = useScoreboardFeed();
const personId = computed(() => Number(props.personId));
const drinkId = computed(() => Number(props.drinkId));
const quantity = computed(() => Number(props.quantity));
const person = computed(() =>
  persons.value?.find((candidate) => candidate.id === personId.value),
);
const drink = computed(() =>
  drinks.value?.find((candidate) => candidate.id === drinkId.value),
);
const saving = ref<Choice>();
const ready = computed(() => online.value && person.value && drink.value);

provideTopBar(() => ({
  title: person.value?.name,
  context: drink.value
    ? messages.zaehlen.quantityOf(quantity.value, drink.value.name)
    : undefined,
  score: formatNumber(scoreOf(feed.value.board, personId.value)),
}));

function factorLabel(factor: Readonly<Factor>): string {
  return messages.zaehlen.factorTile(
    factor.name,
    formatMultiplier(factor.multiplier),
  );
}

async function choose(factor: Readonly<Factor> | null) {
  if (saving.value !== undefined || !person.value || !drink.value) return;
  saving.value = factor?.id ?? null;
  await saveEntry(
    {
      personId: personId.value,
      drinkId: drinkId.value,
      quantity: quantity.value,
      factorId: factor?.id ?? null,
    },
    {
      drink: drink.value.name,
      person: person.value.name,
      factor: factor
        ? `${factor.name} ${formatMultiplier(factor.multiplier)}`
        : undefined,
    },
    () => returnToNames(router),
  );
  saving.value = undefined;
}

/** Disabled offline, and while another choice is being saved. */
function disabled(choice: Choice): boolean {
  return (
    !ready.value || (saving.value !== undefined && saving.value !== choice)
  );
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
  <section>
    <h2 class="type-question page-question">
      {{ messages.zaehlen.factorQuestion }}
    </h2>
    <ul class="factor-list">
      <li>
        <CountTile
          variant="plain"
          :name="messages.zaehlen.noFactor"
          :label="`${messages.zaehlen.noFactor}, ${messages.zaehlen.countsOnce}`"
          :support="messages.zaehlen.countsOnce"
          :pressed="saving === null"
          :disabled="disabled(null)"
          @click="choose(null)"
        />
      </li>
      <li v-for="factor in factors" :key="factor.id">
        <CountTile
          variant="factor"
          :name="factor.name"
          :label="factorLabel(factor)"
          :numeral="formatMultiplier(factor.multiplier)"
          :support="
            messages.zaehlen.countsTimes(formatNumber(factor.multiplier))
          "
          :pressed="saving === factor.id"
          :disabled="disabled(factor.id)"
          @click="choose(factor)"
        />
      </li>
    </ul>
  </section>
</template>

<style scoped>
/* One column (§7e); like the stepper, it keeps a phone's width on wide windows. */
.factor-list {
  display: grid;
  gap: 12px;
  max-width: 480px;
  margin: 0;
  padding: 0;
  list-style: none;
}
</style>
