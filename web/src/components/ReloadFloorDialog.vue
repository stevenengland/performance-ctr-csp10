<script setup lang="ts">
import { messages } from '../core/messages';
import { ref } from 'vue';
import { useReloadFloor } from '../pwa/reload-floor';
import { activateLatestAndReload } from '../pwa/update-prompt';

const required = useReloadFloor();
const reloading = ref(false);

/** Activates the new service worker first; a plain reload would get the old shell again. */
function reload() {
  reloading.value = true;
  void activateLatestAndReload();
}
</script>

<template>
  <v-dialog :model-value="required" persistent max-width="400">
    <v-card class="reload-floor" color="surface-container" rounded="xl">
      <v-card-title class="type-tile-name">{{
        messages.reloadFloor.title
      }}</v-card-title>
      <v-card-text class="type-body">{{
        messages.reloadFloor.body
      }}</v-card-text>
      <v-card-actions>
        <v-spacer />
        <v-btn
          variant="flat"
          color="primary"
          rounded="lg"
          :loading="reloading"
          @click="reload"
        >
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
