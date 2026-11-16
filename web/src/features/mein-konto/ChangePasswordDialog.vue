<script setup lang="ts">
import { ref, watch } from 'vue';
import AppDialog from '../../components/AppDialog.vue';
import AppTextField from '../../components/AppTextField.vue';
import { ApiProblem, changePassword } from '../../core/api-client';
import { messages } from '../../core/messages';
import { showSnackbar } from '../../core/snackbar';

/** `Passwort ändern` (§7k): current, new, repeat; the server checks the rest. */
const open = defineModel<boolean>({ required: true });

const current = ref('');
const next = ref('');
const repeat = ref('');
const errors = ref<Partial<Record<string, string>>>({});
const busy = ref(false);

watch(open, (isOpen) => {
  if (!isOpen) return;
  current.value = next.value = repeat.value = '';
  errors.value = {};
});

async function submit() {
  if (busy.value) return;
  if (next.value !== repeat.value) {
    errors.value = { repeat: messages.konto.mismatch };
    return;
  }
  busy.value = true;
  errors.value = {};
  try {
    await changePassword(current.value, next.value);
    open.value = false;
    showSnackbar({ text: messages.konto.changed });
  } catch (failure) {
    if (failure instanceof ApiProblem && failure.status === 422) {
      errors.value = { ...failure.errors };
    } else {
      showSnackbar({
        text:
          failure instanceof ApiProblem
            ? failure.title
            : messages.anmelden.unreachable,
      });
    }
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <AppDialog
    v-model="open"
    :title="messages.konto.changePassword"
    @submit="submit"
  >
    <AppTextField
      v-model="current"
      :label="messages.konto.currentPassword"
      :error="errors.currentPassword"
      autocomplete="current-password"
      password
      autofocus
    />
    <AppTextField
      v-model="next"
      :label="messages.konto.newPassword"
      :error="errors.newPassword"
      autocomplete="new-password"
      password
    />
    <AppTextField
      v-model="repeat"
      :label="messages.konto.repeatPassword"
      :error="errors.repeat"
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
