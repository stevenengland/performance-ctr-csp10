<script setup lang="ts">
import { onMounted, ref, shallowRef } from 'vue';
import { useRoute } from 'vue-router';
import AppFab from '../../../components/AppFab.vue';
import CatalogList from '../../../components/CatalogList.vue';
import ConfirmDialog from '../../../components/ConfirmDialog.vue';
import { getDrink, type Drink } from '../../../core/api-client';
import { deleteDrink, loadDrinks, useDrinks } from '../../../core/catalog';
import { useConfirmedDelete } from '../../../core/confirmed-delete';
import { formatPoints } from '../../../core/format';
import { messages } from '../../../core/messages';
import { showProblem } from '../../../core/snackbar';
import DrinkDialog from './DrinkDialog.vue';

/**
Verwalten → Getränke (§7i): drinks alphabetically with their points, each
editable and deletable; deleting says how many entries go with the drink (§6.9).
*/
const drinks = useDrinks();
/** `?anlegen` opens the create dialog (the add flow's empty state links here). */
const editing = ref(useRoute().query.anlegen !== undefined);
/** The drink in the dialog; none for `Getränk anlegen`. */
const edited = shallowRef<Readonly<Drink>>();
const removal = useConfirmedDelete(getDrink, deleteDrink, loadDrinks);
const { open: confirming, target: removing, busy } = removal;

function openDialog(drink?: Readonly<Drink>) {
  edited.value = drink;
  editing.value = true;
}

onMounted(() => {
  loadDrinks().catch(showProblem);
});
</script>

<template>
  <section class="catalog-page">
    <CatalogList
      :items="drinks"
      :label="messages.getraenke.title"
      :empty="messages.getraenke.empty"
      :support="(drink) => formatPoints(drink.points)"
      @edit="openDialog"
      @remove="removal.ask"
    />
    <AppFab :label="messages.getraenke.create" @click="openDialog()" />
    <DrinkDialog v-model="editing" :drink="edited" />
    <ConfirmDialog
      v-model="confirming"
      :title="messages.remove.title(removing?.name ?? '')"
      :body="
        messages.remove.cascadeBody(
          removing?.name ?? '',
          removing?.entryCount ?? 0,
        )
      "
      :action="messages.remove.confirm"
      :busy="busy"
      @confirm="removal.confirm"
    />
  </section>
</template>
