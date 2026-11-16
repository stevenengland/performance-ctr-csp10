<script setup lang="ts">
import { onMounted, ref, shallowRef } from 'vue';
import AppFab from '../../../components/AppFab.vue';
import CatalogList from '../../../components/CatalogList.vue';
import ConfirmDialog from '../../../components/ConfirmDialog.vue';
import { getFactor, type Factor } from '../../../core/api-client';
import { deleteFactor, loadFactors, useFactors } from '../../../core/catalog';
import { useConfirmedDelete } from '../../../core/confirmed-delete';
import { formatMultiplier } from '../../../core/format';
import { messages } from '../../../core/messages';
import { showProblem } from '../../../core/snackbar';
import FactorDialog from './FactorDialog.vue';

/**
Verwalten → Faktoren (§7i): factors alphabetically with their multiplier, each
editable and deletable; deleting says how many entries then count ×1 (§6.9).
*/
const factors = useFactors();
const editing = ref(false);
/** The factor in the dialog; none for `Faktor anlegen`. */
const edited = shallowRef<Readonly<Factor>>();
const removal = useConfirmedDelete(getFactor, deleteFactor, loadFactors);
const { open: confirming, target: removing, busy } = removal;

function openDialog(factor?: Readonly<Factor>) {
  edited.value = factor;
  editing.value = true;
}

onMounted(() => {
  loadFactors().catch(showProblem);
});
</script>

<template>
  <section class="catalog-page">
    <CatalogList
      :items="factors"
      :label="messages.faktoren.title"
      :empty="messages.faktoren.empty"
      :support="(factor) => formatMultiplier(factor.multiplier)"
      @edit="openDialog"
      @remove="removal.ask"
    />
    <AppFab :label="messages.faktoren.create" @click="openDialog()" />
    <FactorDialog v-model="editing" :factor="edited" />
    <ConfirmDialog
      v-model="confirming"
      :title="messages.remove.title(removing?.name ?? '')"
      :body="
        messages.remove.factorBody(
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
