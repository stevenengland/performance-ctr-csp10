<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { useRoute } from 'vue-router';
import AppFab from '../../../components/AppFab.vue';
import { loadPersons, usePersons } from '../../../core/catalog';
import { messages } from '../../../core/messages';
import { showProblem } from '../../../core/snackbar';
import CreatePersonDialog from './CreatePersonDialog.vue';

/** Skeleton rows while the list loads (§6.10). */
const SKELETON_ROWS = 3;

const persons = usePersons();
/** `?anlegen` opens the create dialog (the add flow's empty state links here). */
const creating = ref(useRoute().query.anlegen !== undefined);

onMounted(() => {
  loadPersons().catch(showProblem);
});
</script>

<template>
  <section class="catalog-page">
    <ul v-if="persons === undefined" class="list" aria-busy="true">
      <li v-for="row in SKELETON_ROWS" :key="row" class="list__row">
        <span class="skeleton" />
      </li>
    </ul>
    <p v-else-if="persons.length === 0" class="type-body empty-state">
      {{ messages.personen.empty }}
    </p>
    <ul v-else class="list" :aria-label="messages.personen.title">
      <li v-for="person in persons" :key="person.id" class="list__row">
        <span class="type-row-title list__main">{{ person.name }}</span>
      </li>
    </ul>
    <AppFab :label="messages.personen.create" @click="creating = true" />
    <CreatePersonDialog v-model="creating" />
  </section>
</template>
