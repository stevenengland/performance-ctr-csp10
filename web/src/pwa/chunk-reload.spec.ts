import { beforeEach, describe, expect, it, vi } from 'vitest';
import { handleChunkFailures } from './chunk-reload';

const chunkError = new TypeError(
  'Failed to fetch dynamically imported module: https://example.test/assets/RanglistePage-1a2b3c.js',
);

describe('chunk load failures', () => {
  let storage: Storage;
  let reload: ReturnType<typeof vi.fn<() => void>>;
  let showReloadFloor: ReturnType<typeof vi.fn<() => void>>;

  beforeEach(() => {
    storage = window.sessionStorage;
    storage.clear();
    reload = vi.fn<() => void>();
    showReloadFloor = vi.fn<() => void>();
  });

  function handler() {
    return handleChunkFailures({ storage, reload, showReloadFloor });
  }

  it('reload the page once on the first failure', () => {
    expect(handler().onError(chunkError)).toBe(true);

    expect(reload).toHaveBeenCalledOnce();
    expect(showReloadFloor).not.toHaveBeenCalled();
  });

  it('show the reload floor instead when the reload did not help', () => {
    handler().onError(chunkError);

    // The page reloaded: a new handler on the same session storage.
    handler().onError(chunkError);

    expect(reload).toHaveBeenCalledOnce();
    expect(showReloadFloor).toHaveBeenCalledOnce();
  });

  it('reload again after a later failure once a navigation succeeded', () => {
    handler().onError(chunkError);
    const afterReload = handler();
    afterReload.onNavigated();

    afterReload.onError(chunkError);

    expect(reload).toHaveBeenCalledTimes(2);
    expect(showReloadFloor).not.toHaveBeenCalled();
  });

  it('leave other errors alone', () => {
    expect(handler().onError(new Error('Something else'))).toBe(false);

    expect(reload).not.toHaveBeenCalled();
  });
});
