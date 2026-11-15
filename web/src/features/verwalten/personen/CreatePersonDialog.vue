<script setup lang="ts">
import { ref, watch } from 'vue';
import AppDialog from '../../../components/AppDialog.vue';
import AppTextField from '../../../components/AppTextField.vue';
import { createPerson } from '../../../core/catalog';
import { useCreateForm } from '../../../core/create-form';
import { messages } from '../../../core/messages';

/** `Person anlegen` (§7i): a name; field errors and a taken name inline. */
const open = defineModel<boolean>({ required: true });

const name = ref('');
const { errors, busy, submit } = useCreateForm('name');

watch(open, (isOpen) => {
  if (!isOpen) return;
  name.value = '';
  errors.value = {};
});

async function save() {
  if (await submit(() => createPerson(name.value))) open.value = false;
}
</script>

<template>
  <AppDialog v-model="open" :title="messages.personen.create" @submit="save">
    <AppTextField
      v-model="name"
      :label="messages.personen.name"
      :error="errors.name"
      autocomplete="off"
      autofocus
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
