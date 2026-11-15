/// <reference types="vite/client" />
/// <reference types="vite-plugin-pwa/client" />

/** The released version, `<package version>+<commit>`, set at build time. */
declare const __APP_VERSION__: string;
/** The newest migration of this tree's API (the fixture preview's health). */
declare const __SCHEMA_VERSION__: number;
/** The API's `MIN_CLIENT_VERSION` in this tree (the fixture preview's health). */
declare const __MIN_CLIENT_VERSION__: string;
