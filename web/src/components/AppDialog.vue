<script setup lang="ts">
/**
A dialog (design spec §6.9): `surface-container`, corner 20 dp, title in the display
face, on a 50 % scrim. Its content is a form, so Enter submits; the actions slot
holds its buttons, the submit button last.
*/
const open = defineModel<boolean>({ required: true });
defineProps<{ title: string }>();
const emit = defineEmits<{ submit: [] }>();
</script>

<template>
  <v-dialog v-model="open" max-width="560" scrim="scrim" opacity="0.5">
    <v-card class="app-dialog" color="surface-container" rounded="0">
      <form novalidate @submit.prevent="emit('submit')">
        <h2 class="type-tile-name app-dialog__title">{{ title }}</h2>
        <div class="app-dialog__body">
          <slot />
        </div>
        <div class="app-dialog__actions">
          <slot name="actions" />
        </div>
      </form>
    </v-card>
  </v-dialog>
</template>

<style scoped>
.app-dialog {
  padding: 22px;
  border-radius: 20px;
}

.app-dialog__title {
  margin-bottom: 16px;
}

.app-dialog__body {
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.app-dialog__actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  margin-top: 20px;
}
</style>
