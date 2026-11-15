<script setup lang="ts">
import { ref, watch } from 'vue';
import AppDialog from '../../../components/AppDialog.vue';
import AppTextField from '../../../components/AppTextField.vue';
import { createAccount } from '../../../core/api-client';
import { useCreateForm } from '../../../core/create-form';
import { messages } from '../../../core/messages';

/** `Konto anlegen` (§7j): user name and start password; field errors from the server inline. */
const open = defineModel<boolean>({ required: true });
const emit = defineEmits<{ created: [] }>();

const userName = ref('');
const password = ref('');
const { errors, busy, submit } = useCreateForm('userName');

watch(open, (isOpen) => {
  if (!isOpen) return;
  userName.value = password.value = '';
  errors.value = {};
});

async function save() {
  if (await submit(() => createAccount(userName.value, password.value))) {
    open.value = false;
    emit('created');
  }
}
</script>

<template>
  <AppDialog v-model="open" :title="messages.konten.create" @submit="save">
    <AppTextField
      v-model="userName"
      :label="messages.konten.userName"
      :error="errors.userName"
      autocomplete="off"
      autofocus
    />
    <AppTextField
      v-model="password"
      :label="messages.konten.startPassword"
      :error="errors.password"
      autocomplete="new-password"
      password
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
