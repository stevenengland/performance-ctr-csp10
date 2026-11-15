import { beforeEach, describe, expect, it, vi } from 'vitest';
import { dismissSnackbar, useSnackbar } from '../core/snackbar';
import { offerUpdates, type RegisterServiceWorker } from './update-prompt';

describe('the update prompt', () => {
  beforeEach(() => {
    dismissSnackbar();
  });

  function registerWithWaitingWorker() {
    const updateServiceWorker = vi.fn(async () => {});
    let needRefresh = () => {};
    const register: RegisterServiceWorker = (options) => {
      needRefresh = options.onNeedRefresh;
      return updateServiceWorker;
    };
    offerUpdates(register);
    return { updateServiceWorker, workerWaiting: () => needRefresh() };
  }

  it('says nothing while no new service worker is waiting', () => {
    registerWithWaitingWorker();

    expect(useSnackbar().value).toBeUndefined();
  });

  it('offers "Neu laden" when a new service worker waits and reloads only after the tap', () => {
    const { updateServiceWorker, workerWaiting } = registerWithWaitingWorker();

    workerWaiting();

    const snackbar = useSnackbar().value;
    expect(snackbar).toMatchObject({
      text: 'Neue Version verfügbar',
      action: { label: 'Neu laden' },
      timeoutMs: -1,
    });
    expect(updateServiceWorker).not.toHaveBeenCalled();

    snackbar?.action?.run();

    expect(updateServiceWorker).toHaveBeenCalledWith(true);
  });
});
