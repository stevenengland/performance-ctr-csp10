<script setup lang="ts">
import { computed } from 'vue';
import { useRoute } from 'vue-router';
import { useDisplay } from 'vuetify';
import AppNavigation from './components/AppNavigation.vue';
import AppSnackbar from './components/AppSnackbar.vue';
import AppTopBar from './components/AppTopBar.vue';
import OfflineBanner from './components/OfflineBanner.vue';
import ReloadFloorDialog from './components/ReloadFloorDialog.vue';
import { useOnline } from './core/online';
import { screenKey } from './router';

const { xs: compact } = useDisplay();
const online = useOnline();
const route = useRoute();
/** Nothing renders until the first navigation (and its session check) resolved. */
const ready = computed(() => route.matched.length > 0);
/** Anmelden stands alone: no top bar, no navigation (§6.2, §7a). */
const bare = computed(() => route.meta.public === true);
</script>

<template>
  <v-app>
    <template v-if="!ready" />
    <template v-else-if="bare">
      <OfflineBanner v-if="!online" />
      <RouterView />
    </template>
    <div
      v-else
      class="shell"
      :class="compact ? 'shell--compact' : 'shell--rail'"
    >
      <AppNavigation v-if="!compact" variant="rail" />
      <div class="shell__main">
        <AppTopBar />
        <OfflineBanner v-if="!online" />
        <main class="shell__content">
          <RouterView v-slot="{ Component, route: shown }">
            <component :is="Component" :key="screenKey(shown)" />
          </RouterView>
        </main>
      </div>
      <AppNavigation v-if="compact" variant="bar" />
    </div>
    <AppSnackbar />
    <ReloadFloorDialog />
  </v-app>
</template>

<style scoped>
.shell {
  display: flex;
  min-height: 100dvh;
}

.shell--compact {
  flex-direction: column;
}

.shell__main {
  display: flex;
  flex: 1;
  flex-direction: column;
  min-width: 0;
}

.shell__content {
  flex: 1;
  width: 100%;
  max-width: 840px;
  margin: 0 auto;
  padding: 0 var(--app-margin) var(--app-margin);
}
</style>
