import { VitePWA } from 'vite-plugin-pwa';
import { LIGHT_SURFACE } from '../theme-colours';

/**
Web manifest and service worker: the worker precaches the complete build so an
installed app never depends on assets the server has pruned, asks before it
updates (prompt), and never touches API requests.
*/
export function pwaOptions() {
  return VitePWA({
    registerType: 'prompt',
    injectRegister: false,
    manifestFilename: 'manifest.webmanifest',
    filename: 'sw.js',
    includeAssets: ['favicon.svg', 'apple-touch-icon.png'],
    manifest: {
      name: 'Performance',
      short_name: 'Performance',
      lang: 'de',
      dir: 'ltr',
      display: 'standalone',
      start_url: '/zaehlen',
      scope: '/',
      theme_color: LIGHT_SURFACE,
      background_color: LIGHT_SURFACE,
      icons: [
        { src: 'pwa-192.png', sizes: '192x192', type: 'image/png' },
        { src: 'pwa-512.png', sizes: '512x512', type: 'image/png' },
        {
          src: 'pwa-maskable-512.png',
          sizes: '512x512',
          type: 'image/png',
          purpose: 'maskable',
        },
      ],
    },
    workbox: {
      globPatterns: ['**/*.{js,css,html,woff2,svg,png,webmanifest}'],
      inlineWorkboxRuntime: true,
      cleanupOutdatedCaches: true,
      navigateFallback: 'index.html',
      navigateFallbackDenylist: [/^\/api\//],
      runtimeCaching: [],
    },
    devOptions: { enabled: false },
  });
}
