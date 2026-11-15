<script setup lang="ts">
import { computed } from 'vue';
import { CLIENT_VERSION } from '../../app';
import TallyMarks from '../../components/TallyMarks.vue';
import { useServerHealth } from '../../core/health';
import { messages } from '../../core/messages';

/** The brand mark beside the app name, as on Anmelden. */
const BRAND_STROKES = 13;

const server = useServerHealth();
const serverLine = computed(() =>
  server.value
    ? messages.konto.server(server.value.appVersion)
    : messages.konto.serverUnknown,
);
</script>

<template>
  <section class="konto">
    <p class="type-name-hero konto__brand">{{ messages.appName }}</p>
    <TallyMarks :count="BRAND_STROKES" :height="30" class="konto__tally" />
    <p class="type-row-title">{{ messages.konto.version(CLIENT_VERSION) }}</p>
    <p class="type-support konto__server" data-testid="server-version">
      {{ serverLine }}
    </p>
  </section>
</template>

<style scoped>
.konto {
  padding-top: 16px;
}

.konto__tally {
  margin: 10px 0 24px;
  color: rgb(var(--v-theme-primary));
}

.konto__server {
  color: rgb(var(--v-theme-on-surface-variant));
}
</style>
