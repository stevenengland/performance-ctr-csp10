<script setup lang="ts">
import { mdiWifiOff } from '@mdi/js';
import { messages } from '../core/messages';
</script>

<template>
  <div class="offline-banner type-banner" role="status">
    <v-icon :icon="mdiWifiOff" size="20" />
    <span>{{ messages.offline }}</span>
  </div>
</template>

<style scoped>
.offline-banner {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px var(--app-margin);
  background: rgb(var(--v-theme-error-container));
  color: rgb(var(--v-theme-on-error-container));
}
</style>
