import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import vue from '@vitejs/plugin-vue';
import { defineConfig } from 'vitest/config';
import vuetify from 'vite-plugin-vuetify';
import { minClientVersion, schemaVersion } from '../scripts/artifact';
import { pwaOptions } from './src/pwa/manifest';

const root = fileURLToPath(new URL('.', import.meta.url));

const { version } = JSON.parse(
  readFileSync(new URL('package.json', import.meta.url), 'utf8'),
) as { version: string };

/** The released version; CI passes `<package version>+<commit>`, a local build `<package version>+dev`. */
export const appVersion = process.env.APP_VERSION ?? `${version}+dev`;

/** What this tree's API reports in health, for the fixture preview's canned health. */
const api = (path: string) => new URL(`../api/${path}`, import.meta.url);
const apiFacts = {
  __SCHEMA_VERSION__: JSON.stringify(
    schemaVersion(readdirSync(api('migrations'))),
  ),
  __MIN_CLIENT_VERSION__: JSON.stringify(
    minClientVersion(readFileSync(api('src/Http/Compatibility.php'), 'utf8')),
  ),
};

export const sharedConfig = {
  root,
  define: { __APP_VERSION__: JSON.stringify(appVersion), ...apiFacts },
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
