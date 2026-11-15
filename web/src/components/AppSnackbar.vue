<script setup lang="ts">
import { computed } from 'vue';
import { useDisplay } from 'vuetify';
import { dismissSnackbar, useSnackbar } from '../core/snackbar';

const snackbar = useSnackbar();
const { xs: compact } = useDisplay();
const open = computed({
  get: () => snackbar.value !== undefined,
  set: (value) => {
    if (!value) dismissSnackbar();
  },
});
</script>

<template>
  <v-snackbar
    :key="snackbar?.id"
    v-model="open"
    :timeout="snackbar?.timeoutMs"
    :timer="snackbar && snackbar.timeoutMs > 0 ? 'inverse-primary' : false"
    timer-location="bottom"
    color="inverse-surface"
    rounded="lg"
    :class="{ 'app-snackbar--above-bar': compact }"
    role="status"
    aria-live="polite"
  >
    <span class="type-label">{{ snackbar?.text }}</span>
    <template v-if="snackbar?.action" #actions>
      <v-btn
        variant="text"
        color="inverse-primary"
        class="type-label"
        @click="snackbar.action.run()"
      >
        {{ snackbar.action.label }}
      </v-btn>
    </template>
  </v-snackbar>
</template>

<style scoped>
.app-snackbar--above-bar {
  margin-bottom: 84px;
}
</style>
