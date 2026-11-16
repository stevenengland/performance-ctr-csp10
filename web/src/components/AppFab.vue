<script setup lang="ts">
import { mdiPlus } from '@mdi/js';

/** The extended FAB (design spec §7i): bottom right, above the navigation bar, no shadow. */
defineProps<{ label: string }>();
const emit = defineEmits<{ click: [] }>();
</script>

<template>
  <v-btn
    class="app-fab type-row-title"
    color="primary"
    variant="flat"
    size="large"
    rounded="0"
    :prepend-icon="mdiPlus"
    @click="emit('click')"
  >
    {{ label }}
  </v-btn>
</template>

<style scoped>
.app-fab {
  position: fixed;
  right: var(--app-margin);
  bottom: calc(var(--app-margin) + env(safe-area-inset-bottom));
  z-index: 3;
  height: 56px;
  padding: 0 20px;
  border-radius: 10px;
  letter-spacing: normal;
  text-transform: none;
}

/* Above the compact navigation bar. */
@media (width < 600px) {
  .app-fab {
    bottom: calc(92px + env(safe-area-inset-bottom));
  }
}
</style>
