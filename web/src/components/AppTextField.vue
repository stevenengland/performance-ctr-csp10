<script setup lang="ts">
import { mdiEyeOffOutline, mdiEyeOutline } from '@mdi/js';
import { computed, onMounted, ref, useId } from 'vue';
import { messages } from '../core/messages';

/**
The app's form field (design spec §6.11): outlined, the label inside the top of the
field, the field error from the server under it. Passwords get a show/hide button.
A native input, so the sign-in screen carries no field framework.
*/
const model = defineModel<string>({ required: true });
const props = defineProps<{
  label: string;
  password?: boolean;
  autocomplete?: string;
  error?: string;
  autofocus?: boolean;
  /** The on-screen keyboard to offer, e.g. `decimal` for points. */
  inputmode?: 'text' | 'decimal';
  /** Shown before the value, e.g. `×` for a multiplier; not part of it. */
  prefix?: string;
}>();

const id = useId();
const input = ref<HTMLInputElement>();
const visible = ref(false);
const type = computed(() =>
  props.password && !visible.value ? 'password' : 'text',
);

onMounted(() => {
  if (props.autofocus) input.value?.focus();
});
</script>

<template>
  <div class="app-field" :class="{ 'app-field--error': error }">
    <div class="app-field__box">
      <label :for="id" class="app-field__label type-caption">{{ label }}</label>
      <span
        v-if="prefix"
        class="app-field__prefix type-body"
        aria-hidden="true"
        >{{ prefix }}</span
      >
      <input
        :id="id"
        ref="input"
        v-model="model"
        class="app-field__input type-body"
        :type="type"
        :autocomplete="autocomplete"
        :inputmode="inputmode"
        :aria-invalid="error ? 'true' : undefined"
        :aria-describedby="error ? `${id}-error` : undefined"
        autocapitalize="off"
        spellcheck="false"
      />
      <v-btn
        v-if="password"
        :icon="visible ? mdiEyeOffOutline : mdiEyeOutline"
        :aria-label="
          visible ? messages.field.hidePassword : messages.field.showPassword
        "
        :aria-pressed="visible"
        variant="text"
        size="small"
        density="comfortable"
        class="app-field__toggle"
        @click="visible = !visible"
      />
    </div>
    <p v-if="error" :id="`${id}-error`" class="app-field__error type-support">
      {{ error }}
    </p>
  </div>
</template>

<style scoped>
.app-field__box {
  position: relative;
  display: flex;
  align-items: center;
  min-height: 56px;
  border: 1.5px solid rgb(var(--v-theme-outline));
  border-radius: 10px;
}

.app-field__box:focus-within {
  border: 2px solid rgb(var(--v-theme-primary));
  margin: -0.5px;
}

.app-field--error .app-field__box {
  border: 2px solid rgb(var(--v-theme-error));
  margin: -0.5px;
}

.app-field__label {
  position: absolute;
  top: 7px;
  left: 14px;
  color: rgb(var(--v-theme-on-surface-variant));
  pointer-events: none;
}

.app-field__input {
  flex: 1;
  min-width: 0;
  padding: 25px 14px 7px;
  border: 0;
  background: transparent;
  color: rgb(var(--v-theme-on-surface));
  outline: none;
}

.app-field__prefix {
  padding: 25px 0 7px 14px;
  color: rgb(var(--v-theme-on-surface-variant));
}

.app-field__prefix + .app-field__input {
  padding-left: 2px;
}

.app-field__toggle {
  margin-right: 6px;
  color: rgb(var(--v-theme-primary));
}

.app-field__error {
  margin: 4px 14px 0;
  color: rgb(var(--v-theme-error));
}
</style>
