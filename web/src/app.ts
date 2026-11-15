import '@fontsource/big-shoulders-display/latin-700';
import '@fontsource/big-shoulders-display/latin-900';
import '@fontsource/hanken-grotesk/latin-400';
import '@fontsource/hanken-grotesk/latin-600';
// Only Vuetify's layers and core: the app uses no utility or palette classes.
import 'vuetify/styles/layers';
import 'vuetify/styles/core';
import './styles/app.css';
import { createApp } from 'vue';
import type { RouterHistory } from 'vue-router';
import App from './App.vue';
import { loadServerHealth } from './core/health';
import { handleChunkFailures } from './pwa/chunk-reload';
import { requireReload } from './pwa/reload-floor';
import { createAppRouter } from './router';
import { createAppVuetify } from './theme';

export const CLIENT_VERSION = __APP_VERSION__;

/** Builds and mounts the app on the given history; the entry decides which history and service worker. */
export function startApp(history: RouterHistory) {
  const router = createAppRouter(history);
  const chunks = handleChunkFailures({
    storage: window.sessionStorage,
    reload: () => window.location.reload(),
    showReloadFloor: requireReload,
  });
  router.onError((error) => {
    if (!chunks.onError(error)) throw error;
  });
  router.afterEach((_to, _from, failure) => {
    if (!failure) chunks.onNavigated();
  });
  window.addEventListener('vite:preloadError', (event) => {
    if (chunks.onError(event.payload)) event.preventDefault();
  });

  const app = createApp(App).use(createAppVuetify()).use(router);
  app.mount('#app');
  void loadServerHealth(CLIENT_VERSION);
  return { app, router };
}
