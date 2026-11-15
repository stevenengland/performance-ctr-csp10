<script setup lang="ts">
import { mdiEyeOffOutline, mdiEyeOutline } from '@mdi/js';
import { computed, ref } from 'vue';
import { messages } from '../core/messages';

/**
The app's form field (design spec §6.11): outlined, the label inside the top of the
field, the field error from the server under it. Passwords get a show/hide button.
*/
const model = defineModel<string>({ required: true });
const props = defineProps<{
  label: string;
  password?: boolean;
  autocomplete?: string;
  error?: string;
  autofocus?: boolean;
}>();

const visible = ref(false);
const type = computed(() =>
  props.password && !visible.value ? 'password' : 'text',
);
</script>

<template>
  <v-text-field
    v-model="model"
    :label="label"
    :type="type"
    :autocomplete="autocomplete"
    :autofocus="autofocus"
    :error-messages="error ? [error] : []"
    variant="filled"
    hide-details="auto"
    class="app-field"
    autocapitalize="off"
    spellcheck="false"
  >
    <template v-if="password" #append-inner>
      <v-btn
        :icon="visible ? mdiEyeOffOutline : mdiEyeOutline"
        :aria-label="
          visible ? messages.field.hidePassword : messages.field.showPassword
        "
        :aria-pressed="visible"
        variant="text"
        size="small"
        density="comfortable"
        @click="visible = !visible"
      />
    </template>
  </v-text-field>
</template>

<style scoped>
/* Outlined, label inside the top (§6.11): Vuetify's filled field with its fill and underline replaced by a border. */
.app-field :deep(.v-field) {
  border-radius: 10px;
  background: transparent;
  box-shadow: inset 0 0 0 1.5px rgb(var(--v-theme-outline));
}

.app-field :deep(.v-field__overlay),
.app-field :deep(.v-field__outline) {
  display: none;
}

/* The 2 dp primary border is the focus indicator; no extra ring around the input. */
.app-field :deep(input:focus-visible) {
  outline: none;
}

.app-field :deep(.v-field--focused) {
  box-shadow: inset 0 0 0 2px rgb(var(--v-theme-primary));
}

.app-field :deep(.v-field--error) {
  box-shadow: inset 0 0 0 2px rgb(var(--v-theme-error));
}

.app-field :deep(.v-field-label) {
  color: rgb(var(--v-theme-on-surface-variant));
  font-family: var(--font-text);
  opacity: 1;
}

.app-field :deep(.v-field-label--floating) {
  font-size: 12px;
  font-weight: 600;
  line-height: 16px;
}

.app-field :deep(.v-field__input) {
  font-family: var(--font-text);
  font-size: 16px;
  line-height: 24px;
}

.app-field :deep(.v-messages__message) {
  color: rgb(var(--v-theme-error));
  font-family: var(--font-text);
  font-size: 13px;
  line-height: 18px;
}
</style>
