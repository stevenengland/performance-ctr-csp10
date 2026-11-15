import { beforeEach, describe, expect, it, vi } from 'vitest';
import { dismissSnackbar, showSnackbar, useSnackbar } from './snackbar';

describe('the snackbar', () => {
  beforeEach(() => {
    dismissSnackbar();
  });

  it('shows one message at a time; a newer one replaces the older', () => {
    showSnackbar({ text: 'Erste' });
    showSnackbar({ text: 'Zweite' });

    expect(useSnackbar().value?.text).toBe('Zweite');
  });

  it('lasts 8 seconds unless it is persistent', () => {
    showSnackbar({ text: 'Kurz' });
    expect(useSnackbar().value?.timeoutMs).toBe(8000);

    showSnackbar({ text: 'Bleibt', persistent: true });
    expect(useSnackbar().value?.timeoutMs).toBe(-1);
  });

  it('runs its action and closes', () => {
    const run = vi.fn();
    showSnackbar({ text: 'Mit Aktion', action: { label: 'Los', run } });

    useSnackbar().value?.action?.run();

    expect(run).toHaveBeenCalledOnce();
    expect(useSnackbar().value).toBeUndefined();
  });
});
