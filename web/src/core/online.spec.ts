import { afterEach, describe, expect, it, vi } from 'vitest';
import { effectScope } from 'vue';
import { useOnline } from './online';

describe('useOnline', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('starts from the browser state and follows offline and online events', () => {
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
    const scope = effectScope();
    const online = scope.run(() => useOnline());

    expect(online?.value).toBe(false);
    window.dispatchEvent(new Event('online'));
    expect(online?.value).toBe(true);
    window.dispatchEvent(new Event('offline'));
    expect(online?.value).toBe(false);
    scope.stop();
  });
});
