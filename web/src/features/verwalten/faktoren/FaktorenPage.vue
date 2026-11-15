<script setup lang="ts">
import { mdiDeleteOutline, mdiPencilOutline } from '@mdi/js';
import { onMounted, ref, shallowRef } from 'vue';
import AppFab from '../../../components/AppFab.vue';
import ConfirmDialog from '../../../components/ConfirmDialog.vue';
import {
  getFactor,
  type Factor,
  type FactorDetail,
} from '../../../core/api-client';
import { deleteFactor, loadFactors, useFactors } from '../../../core/catalog';
import { formatMultiplier } from '../../../core/format';
import { messages } from '../../../core/messages';
import { showProblem, showSnackbar } from '../../../core/snackbar';
import FactorDialog from './FactorDialog.vue';

/**
Verwalten → Faktoren (§7i): factors alphabetically with their multiplier, each
editable and deletable; deleting says how many entries then count ×1 (§6.9).
*/
const SKELETON_ROWS = 3;

const factors = useFactors();
const editing = ref(false);
/** The factor in the dialog; none for `Faktor anlegen`. */
const edited = shallowRef<Readonly<Factor>>();
const confirming = ref(false);
const removing = shallowRef<FactorDetail>();
const busy = ref(false);

function openDialog(factor?: Readonly<Factor>) {
  edited.value = factor;
  editing.value = true;
}

/** Asks for the factor's current entry count first, which the dialog names. */
async function askToDelete(factor: Readonly<Factor>) {
  try {
    removing.value = await getFactor(factor.id);
    confirming.value = true;
  } catch (failure) {
    showProblem(failure);
    await loadFactors().catch(showProblem);
  }
}

async function remove() {
  const factor = removing.value;
  if (!factor || busy.value) return;
  busy.value = true;
  try {
    await deleteFactor(factor.id);
    confirming.value = false;
    showSnackbar({ text: messages.remove.done(factor.name) });
  } catch (failure) {
    showProblem(failure);
  } finally {
    busy.value = false;
  }
}

onMounted(() => {
  loadFactors().catch(showProblem);
});
</script>

<template>
  <section class="catalog-page">
    <ul v-if="factors === undefined" class="list" aria-busy="true">
      <li v-for="row in SKELETON_ROWS" :key="row" class="list__row">
        <span class="skeleton" />
      </li>
    </ul>
    <p v-else-if="factors.length === 0" class="type-body empty-state">
      {{ messages.faktoren.empty }}
    </p>
    <ul v-else class="list" :aria-label="messages.faktoren.title">
      <li v-for="factor in factors" :key="factor.id" class="list__row">
        <span class="list__main">
          <span class="type-row-title list__title">{{ factor.name }}</span>
          <span class="type-support list__support">{{
            formatMultiplier(factor.multiplier)
          }}</span>
        </span>
        <v-btn
          :icon="mdiPencilOutline"
          :aria-label="messages.faktoren.editLabel(factor.name)"
          variant="text"
          @click="openDialog(factor)"
        />
        <v-btn
          :icon="mdiDeleteOutline"
          :aria-label="messages.faktoren.deleteLabel(factor.name)"
          variant="text"
          @click="askToDelete(factor)"
        />
      </li>
    </ul>
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
      @confirm="remove"
    />
  </section>
</template>
