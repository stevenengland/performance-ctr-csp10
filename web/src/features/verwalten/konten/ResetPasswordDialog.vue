<script setup lang="ts">
import { ref, watch } from 'vue';
import AppDialog from '../../../components/AppDialog.vue';
import AppTextField from '../../../components/AppTextField.vue';
import { updateAccount, type Account } from '../../../core/api-client';
import { useCreateForm } from '../../../core/create-form';
import { messages } from '../../../core/messages';

/**
`Passwort zurücksetzen` (§7j): a new password for the account, which the server
signs out on every device; a short one is refused inline (§6.11).
*/
const open = defineModel<boolean>({ required: true });
const props = defineProps<{ account: Readonly<Account> | undefined }>();
const emit = defineEmits<{ reset: [account: Readonly<Account>] }>();

const password = ref('');
const { errors, busy, submit } = useCreateForm('password');

watch(open, (isOpen) => {
  if (!isOpen) return;
  password.value = '';
  errors.value = {};
});

async function save() {
  const { account } = props;
  if (!account) return;
  if (
    await submit(() => updateAccount(account.id, { password: password.value }))
  ) {
    open.value = false;
    emit('reset', account);
  }
}
</script>

<template>
  <AppDialog
    v-model="open"
    :title="messages.konten.resetTitle(account?.userName ?? '')"
    @submit="save"
  >
    <p class="type-body">
      {{ messages.konten.resetBody(account?.userName ?? '') }}
    </p>
    <AppTextField
      v-model="password"
      :label="messages.konten.newPassword"
      :error="errors.password"
      autocomplete="new-password"
      autofocus
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
