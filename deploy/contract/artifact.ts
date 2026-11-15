/** Folder of the web root that holds Vite's content-hashed build output. */
export const ASSET_DIR = 'assets';

/** Web-root files that name the current build and must never be served stale. */
export const REVALIDATED_FILES = [
  'index.html',
  'sw.js',
  'manifest.webmanifest',
] as const;

/** The web root's PHP entry pointer; it names the PHP release that answers `/api/*`. */
export const API_ENTRY = 'api/index.php';
