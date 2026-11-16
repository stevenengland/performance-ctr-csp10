import vue from '@vitejs/plugin-vue';
import { defineConfig, type Plugin } from 'vite';
import vuetify from 'vite-plugin-vuetify';
import { sharedConfig } from './vite.config';

/** Swaps the app entry for the preview entry; nothing in src/ knows about the preview. */
function previewEntry(): Plugin {
  return {
    name: 'performance-preview-entry',
    transformIndexHtml: {
      order: 'pre',
      handler: (html) => html.replace('/src/main.ts', '/preview/main.ts'),
    },
  };
}

/**
The fixture preview (design spec §12): the real SPA on canned answers, with hash
routing and relative asset paths so it runs wherever it is published, and no
service worker.
*/
export default defineConfig({
  ...sharedConfig,
  base: './',
  plugins: [previewEntry(), vue(), vuetify({ autoImport: true })],
  build: { ...sharedConfig.build, outDir: 'dist-preview', emptyOutDir: true },
});
