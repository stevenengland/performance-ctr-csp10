<script setup lang="ts">
import { messages } from '../core/messages';
import { useReloadFloor } from '../pwa/reload-floor';

const required = useReloadFloor();

function reload() {
  window.location.reload();
}
</script>

<template>
  <v-dialog :model-value="required" persistent max-width="400">
    <v-card class="reload-floor" color="surface-container" rounded="xl">
      <v-card-title class="type-tile-name">{{ messages.reloadFloor.title }}</v-card-title>
      <v-card-text class="type-body">{{ messages.reloadFloor.body }}</v-card-text>
      <v-card-actions>
        <v-spacer />
        <v-btn variant="flat" color="primary" rounded="lg" @click="reload">
          {{ messages.reloadFloor.reload }}
        </v-btn>
      </v-card-actions>
    </v-card>
  </v-dialog>
</template>

<style scoped>
.reload-floor {
  padding: 8px;
}
</style>
