<script setup lang="ts">
import { ref, watch } from 'vue';
import AppDialog from '../../../components/AppDialog.vue';
import AppTextField from '../../../components/AppTextField.vue';
import type { Person } from '../../../core/api-client';
import { createPerson, updatePerson } from '../../../core/catalog';
import { useCreateForm } from '../../../core/create-form';
import { messages } from '../../../core/messages';

/** `Person anlegen` / `Person bearbeiten` (§7i): a name; field errors and a taken name inline. */
const open = defineModel<boolean>({ required: true });
const props = defineProps<{ person?: Readonly<Person> }>();

const name = ref('');
const { errors, busy, submit } = useCreateForm('name');

watch(open, (isOpen) => {
  if (!isOpen) return;
  name.value = props.person?.name ?? '';
  errors.value = {};
});

async function save() {
  const { person } = props;
  const done = await submit(() =>
    person ? updatePerson(person.id, name.value) : createPerson(name.value),
  );
  if (done) open.value = false;
}
</script>

<template>
  <AppDialog
    v-model="open"
    :title="person ? messages.personen.edit : messages.personen.create"
    @submit="save"
  >
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
