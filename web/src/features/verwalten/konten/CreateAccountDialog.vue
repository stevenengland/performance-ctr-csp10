<script setup lang="ts">
import { ref, watch } from 'vue';
import AppDialog from '../../../components/AppDialog.vue';
import AppTextField from '../../../components/AppTextField.vue';
import { ApiProblem, createAccount } from '../../../core/api-client';
import { messages } from '../../../core/messages';
import { showSnackbar } from '../../../core/snackbar';

/** `Konto anlegen` (§7j): user name and start password; field errors from the server inline. */
const open = defineModel<boolean>({ required: true });
const emit = defineEmits<{ created: [] }>();

const userName = ref('');
const password = ref('');
const errors = ref<Partial<Record<string, string>>>({});
const busy = ref(false);

watch(open, (isOpen) => {
  if (!isOpen) return;
  userName.value = password.value = '';
  errors.value = {};
});

/** 422 carries field errors; a taken user name (409) belongs under the user name too. */
function fieldErrors(
  failure: ApiProblem,
): Partial<Record<string, string>> | undefined {
  if (failure.status === 422) return { ...failure.errors };
  if (failure.status === 409) return { userName: failure.title };
  return undefined;
}

async function submit() {
  if (busy.value) return;
  busy.value = true;
  errors.value = {};
  try {
    await createAccount(userName.value, password.value);
    open.value = false;
    emit('created');
  } catch (failure) {
    const inline =
      failure instanceof ApiProblem ? fieldErrors(failure) : undefined;
    if (inline) errors.value = inline;
    else
      showSnackbar({
        text:
          failure instanceof ApiProblem
            ? failure.title
            : messages.anmelden.unreachable,
      });
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <AppDialog v-model="open" :title="messages.konten.create" @submit="submit">
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
