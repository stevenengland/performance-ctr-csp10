const RELOADED = 'performance.chunkReload';

const CHUNK_FAILURE =
  /Failed to fetch dynamically imported module|Importing a module script failed|error loading dynamically imported module|Unable to preload CSS/i;

export interface ChunkFailureEnvironment {
  storage: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;
  reload: () => void;
  showReloadFloor: () => void;
}

/**
A lazy chunk that fails to load (the server already serves a newer build) reloads
the page once; if it fails again after that reload, the reload floor takes over.
*/
export function handleChunkFailures(environment: ChunkFailureEnvironment) {
  const { storage, reload, showReloadFloor } = environment;
  return {
    /** Returns whether the error was a chunk failure it handled. */
    onError(error: unknown): boolean {
      if (!(error instanceof Error) || !CHUNK_FAILURE.test(error.message)) {
        return false;
      }
      if (storage.getItem(RELOADED) === null) {
        storage.setItem(RELOADED, '1');
        reload();
      } else {
        showReloadFloor();
      }
      return true;
    },
    /** A navigation succeeded: the next failure deserves a reload again. */
    onNavigated(): void {
      storage.removeItem(RELOADED);
    },
  };
}
