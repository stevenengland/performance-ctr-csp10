<script setup lang="ts">
import { mdiChevronRight } from '@mdi/js';
import { computed, onMounted, shallowRef } from 'vue';
import { listAccounts } from '../../core/api-client';
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
import { useSession } from '../../core/session';
import { showProblem } from '../../core/snackbar';

/**
Verwalten (§7h): Personen, Getränke, Faktoren and, for admins, Konten, each with
its count; a count stays away until its list has loaded.
*/
type Count = (formatted: string, count: number) => string;

const account = useSession();
const persons = usePersons();
const drinks = useDrinks();
const factors = useFactors();
const accounts = shallowRef<number>();

const counted = (count: number | undefined, label: Count) =>
  count === undefined ? undefined : label(formatNumber(count), count);

const sections = computed(() => [
  {
    label: messages.verwalten.persons,
    to: '/verwalten/personen',
    count: counted(persons.value?.length, messages.verwalten.personCount),
  },
  {
    label: messages.verwalten.drinks,
    to: '/verwalten/getraenke',
    count: counted(drinks.value?.length, messages.verwalten.drinkCount),
  },
  {
    label: messages.verwalten.factors,
    to: '/verwalten/faktoren',
    count: counted(factors.value?.length, messages.verwalten.factorCount),
  },
  ...(account.value?.isAdmin
    ? [
        {
          label: messages.verwalten.accounts,
          to: '/verwalten/konten',
          count: counted(accounts.value, messages.verwalten.accountCount),
        },
      ]
    : []),
]);

onMounted(() => {
  for (const load of [loadPersons, loadDrinks, loadFactors]) {
    load().catch(showProblem);
  }
  if (account.value?.isAdmin) {
    listAccounts()
      .then((list) => (accounts.value = list.length))
      .catch(showProblem);
  }
});
</script>

<template>
  <ul class="list">
    <li v-for="section in sections" :key="section.to">
      <RouterLink :to="section.to" class="list__row list__link">
        <span class="list__main">
          <span class="type-row-title list__title">{{ section.label }}</span>
          <span v-if="section.count" class="type-support list__support">{{
            section.count
          }}</span>
        </span>
        <v-icon :icon="mdiChevronRight" size="24" />
      </RouterLink>
    </li>
  </ul>
</template>
