<script setup lang="ts">
import { onMounted, ref, shallowRef } from 'vue';
import { useRoute } from 'vue-router';
import AppFab from '../../../components/AppFab.vue';
import CatalogList from '../../../components/CatalogList.vue';
import ConfirmDialog from '../../../components/ConfirmDialog.vue';
import { getPerson, type Person } from '../../../core/api-client';
import { deletePerson, loadPersons, usePersons } from '../../../core/catalog';
import { useConfirmedDelete } from '../../../core/confirmed-delete';
import { messages } from '../../../core/messages';
import { showProblem } from '../../../core/snackbar';
import { verlaufPath } from '../../verlauf/history';
import PersonDialog from './PersonDialog.vue';

/**
Verwalten → Personen (§7i): persons alphabetically, each renamable and
deletable; deleting says how many entries go with the person (§6.9). A name opens
the person's Verlauf (§7g).
*/
const persons = usePersons();
/** `?anlegen` opens the create dialog (the add flow's empty state links here). */
const editing = ref(useRoute().query.anlegen !== undefined);
/** The person in the dialog; none for `Person anlegen`. */
const edited = shallowRef<Readonly<Person>>();
const removal = useConfirmedDelete(getPerson, deletePerson, loadPersons);
const { open: confirming, target: removing, busy } = removal;

function verlauf(person: Readonly<Person>) {
  return {
    to: verlaufPath(person.id),
    label: messages.verlauf.open(person.name),
  };
}

function openDialog(person?: Readonly<Person>) {
  edited.value = person;
  editing.value = true;
}

onMounted(() => {
  loadPersons().catch(showProblem);
});
</script>

<template>
  <section class="catalog-page">
    <CatalogList
      :items="persons"
      :label="messages.personen.title"
      :empty="messages.personen.empty"
      :link="verlauf"
      @edit="openDialog"
      @remove="removal.ask"
    />
    <AppFab :label="messages.personen.create" @click="openDialog()" />
    <PersonDialog v-model="editing" :person="edited" />
    <ConfirmDialog
      v-model="confirming"
      :title="messages.remove.title(removing?.name ?? '')"
      :body="
        messages.remove.personBody(
          removing?.name ?? '',
          removing?.entryCount ?? 0,
          removing?.resultCount ?? 0,
          removing?.matchCount ?? 0,
        )
      "
      :action="messages.remove.confirm"
      :busy="busy"
      @confirm="removal.confirm"
    />
  </section>
</template>
