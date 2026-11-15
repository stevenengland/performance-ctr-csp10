import { fileURLToPath } from 'node:url';
import vue from '@vitejs/plugin-vue';
import { defineConfig } from 'vitest/config';
import vuetify from 'vite-plugin-vuetify';
import { pwaOptions } from './src/pwa/manifest';

const root = fileURLToPath(new URL('.', import.meta.url));

/** The released version; CI passes `<package version>+<commit>`. */
export const appVersion = process.env.APP_VERSION ?? '0.1.0+dev';

export const sharedConfig = {
  root,
  define: { __APP_VERSION__: JSON.stringify(appVersion) },
  build: {
    // No data: URIs, so the CSP needs no img-src or font-src exception.
    assetsInlineLimit: 0,
  },
};

export default defineConfig({
  ...sharedConfig,
  plugins: [vue(), vuetify({ autoImport: true }), pwaOptions()],
  test: {
    name: 'web',
    environment: 'jsdom',
    include: ['src/**/*.spec.ts', 'preview/**/*.spec.ts'],
    setupFiles: ['src/test-setup.ts'],
    server: { deps: { inline: ['vuetify'] } },
  },
});
