<script setup lang="ts">
import { useDisplay } from 'vuetify';
import AppNavigation from './components/AppNavigation.vue';
import AppSnackbar from './components/AppSnackbar.vue';
import AppTopBar from './components/AppTopBar.vue';
import OfflineBanner from './components/OfflineBanner.vue';
import ReloadFloorDialog from './components/ReloadFloorDialog.vue';
import { useOnline } from './core/online';

const { xs: compact } = useDisplay();
const online = useOnline();
</script>

<template>
  <v-app>
    <div class="shell" :class="compact ? 'shell--compact' : 'shell--rail'">
      <AppNavigation v-if="!compact" variant="rail" />
      <div class="shell__main">
        <AppTopBar />
        <OfflineBanner v-if="!online" />
        <main class="shell__content">
          <RouterView />
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
