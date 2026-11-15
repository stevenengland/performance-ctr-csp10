<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { useRoute } from 'vue-router';
import AppFab from '../../../components/AppFab.vue';
import { loadDrinks, useDrinks } from '../../../core/catalog';
import { formatPoints } from '../../../core/format';
import { messages } from '../../../core/messages';
import { showProblem } from '../../../core/snackbar';
import CreateDrinkDialog from './CreateDrinkDialog.vue';

/** Skeleton rows while the list loads (§6.10). */
const SKELETON_ROWS = 3;

const drinks = useDrinks();
/** `?anlegen` opens the create dialog (the add flow's empty state links here). */
const creating = ref(useRoute().query.anlegen !== undefined);

onMounted(() => {
  loadDrinks().catch(showProblem);
});
</script>

<template>
  <section class="catalog-page">
    <ul v-if="drinks === undefined" class="list" aria-busy="true">
      <li v-for="row in SKELETON_ROWS" :key="row" class="list__row">
        <span class="skeleton" />
      </li>
    </ul>
    <p v-else-if="drinks.length === 0" class="type-body empty-state">
      {{ messages.getraenke.empty }}
    </p>
    <ul v-else class="list" :aria-label="messages.getraenke.title">
      <li v-for="drink in drinks" :key="drink.id" class="list__row">
        <span class="list__main">
          <span class="type-row-title list__title">{{ drink.name }}</span>
          <span class="type-support list__support">{{
            formatPoints(drink.points)
          }}</span>
        </span>
      </li>
    </ul>
    <AppFab :label="messages.getraenke.create" @click="creating = true" />
    <CreateDrinkDialog v-model="creating" />
  </section>
</template>
