import { beforeEach, describe, expect, it, vi } from 'vitest';
import { dismissSnackbar, useSnackbar } from '../core/snackbar';
import {
  activateLatestAndReload,
  offerUpdates,
  type RegisterServiceWorker,
} from './update-prompt';

/** A service worker whose state the test moves on. */
class FakeWorker extends EventTarget {
  constructor(public state: ServiceWorkerState) {
    super();
  }

  moveTo(state: ServiceWorkerState) {
    this.state = state;
    this.dispatchEvent(new Event('statechange'));
  }
}

/** A registration as the browser keeps it: active, waiting and installing workers. */
class FakeRegistration {
  waiting: FakeWorker | null = null;
  installing: FakeWorker | null = null;
  update = vi.fn(() => Promise.resolve());
}

const asRegistration = (registration: FakeRegistration) =>
  registration as unknown as ServiceWorkerRegistration;

describe('the update prompt', () => {
  beforeEach(() => {
    dismissSnackbar();
  });

  function registerWithWaitingWorker() {
    const updateServiceWorker = vi.fn(() => Promise.resolve());
    let needRefresh: () => void = vi.fn();
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

describe('activating the newest version before a reload (the reload floor)', () => {
  /** Registers like vite-plugin-pwa: the activation path is what the update prompt uses. */
  function registered(registration: FakeRegistration | undefined) {
    const activate = vi.fn((reloadPage?: boolean) => {
      void reloadPage;
      registration?.waiting?.moveTo('activating');
      registration?.waiting?.moveTo('activated');
      return Promise.resolve();
    });
    offerUpdates((options) => {
      options.onRegisteredSW?.(
        'sw.js',
        registration ? asRegistration(registration) : undefined,
      );
      return activate;
    });
    const reload = vi.fn();
    return { activate, reload };
  }

  it('activates the waiting worker through the update path, and reloads once it is active', async () => {
    const registration = new FakeRegistration();
    const waiting = new FakeWorker('installed');
    registration.waiting = waiting;
    const { activate, reload } = registered(registration);

    await activateLatestAndReload(reload);

    expect(activate).toHaveBeenCalledWith(true);
    expect(waiting.state).toBe('activated');
    expect(reload).toHaveBeenCalledOnce();
    expect(registration.update).not.toHaveBeenCalled();
  });

  it('does not reload before the waiting worker is active', async () => {
    const registration = new FakeRegistration();
    const waiting = new FakeWorker('installed');
    registration.waiting = waiting;
    const reload = vi.fn();
    const activate = vi.fn(() => Promise.resolve());
    offerUpdates((options) => {
      options.onRegisteredSW?.('sw.js', asRegistration(registration));
      return activate;
    });

    const done = activateLatestAndReload(reload);
    await vi.waitFor(() => {
      expect(activate).toHaveBeenCalledWith(true);
    });
    expect(reload).not.toHaveBeenCalled();

    waiting.moveTo('activated');
    await done;
    expect(reload).toHaveBeenCalledOnce();
  });

  it('without a waiting worker checks for an update first, then activates what it installed', async () => {
    const registration = new FakeRegistration();
    const installing = new FakeWorker('installing');
    registration.update.mockImplementation(() => {
      registration.installing = installing;
      return Promise.resolve();
    });
    const { activate, reload } = registered(registration);

    const done = activateLatestAndReload(reload);
    await vi.waitFor(() => {
      expect(registration.update).toHaveBeenCalledOnce();
    });
    registration.installing = null;
    registration.waiting = installing;
    installing.moveTo('installed');
    await done;

    expect(activate).toHaveBeenCalledWith(true);
    expect(installing.state).toBe('activated');
    expect(reload).toHaveBeenCalledOnce();
  });

  it('still reloads when the update check finds nothing newer', async () => {
    const registration = new FakeRegistration();
    const { activate, reload } = registered(registration);

    await activateLatestAndReload(reload);

    expect(registration.update).toHaveBeenCalledOnce();
    expect(activate).not.toHaveBeenCalled();
    expect(reload).toHaveBeenCalledOnce();
  });

  it('still reloads when the update check fails (offline)', async () => {
    const registration = new FakeRegistration();
    registration.update.mockRejectedValue(new TypeError('offline'));
    const { activate, reload } = registered(registration);

    await activateLatestAndReload(reload);

    expect(activate).not.toHaveBeenCalled();
    expect(reload).toHaveBeenCalledOnce();
  });

  it('reloads at once where no service worker is registered (fixture preview)', async () => {
    const { activate, reload } = registered(undefined);

    await activateLatestAndReload(reload);

    expect(activate).not.toHaveBeenCalled();
    expect(reload).toHaveBeenCalledOnce();
  });
});
