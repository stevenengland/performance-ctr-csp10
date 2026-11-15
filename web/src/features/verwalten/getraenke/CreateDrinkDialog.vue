<script setup lang="ts">
import { ref, watch } from 'vue';
import AppDialog from '../../../components/AppDialog.vue';
import AppTextField from '../../../components/AppTextField.vue';
import { createDrink } from '../../../core/catalog';
import { useCreateForm } from '../../../core/create-form';
import { parseDecimal } from '../../../core/format';
import { messages } from '../../../core/messages';

/**
`Getränk anlegen` (§7i): name and points with a decimal comma or point. Input that is
no number goes to the server as such, which answers with the field error.
*/
const open = defineModel<boolean>({ required: true });

const name = ref('');
const points = ref('');
const { errors, busy, submit } = useCreateForm('name');

watch(open, (isOpen) => {
  if (!isOpen) return;
  name.value = points.value = '';
  errors.value = {};
});

async function save() {
  if (await submit(() => createDrink(name.value, parseDecimal(points.value)))) {
    open.value = false;
  }
}
</script>

<template>
  <AppDialog v-model="open" :title="messages.getraenke.create" @submit="save">
    <AppTextField
      v-model="name"
      :label="messages.getraenke.name"
      :error="errors.name"
      autocomplete="off"
      autofocus
    />
    <AppTextField
      v-model="points"
      :label="messages.getraenke.points"
      :error="errors.points"
      autocomplete="off"
      inputmode="decimal"
    />
    <template #actions>
      <v-btn variant="text" class="type-row-title" @click="open = false">
        {{ messages.dialog.cancel }}
      </v-btn>
      <v-btn
        type="submit"
        variant="flat"
        color="primary"
        rounded="0"
        class="dialog-button type-row-title"
        :loading="busy"
      >
        {{ messages.dialog.save }}
      </v-btn>
    </template>
  </AppDialog>
</template>
