import { messages } from '../core/messages';
import { showSnackbar } from '../core/snackbar';

/** The shape of vite-plugin-pwa's `registerSW`; the worker activates when the returned function runs. */
export type RegisterServiceWorker = (options: {
  onNeedRefresh: () => void;
  onRegisteredSW?: (
    swScriptUrl: string,
    registration: ServiceWorkerRegistration | undefined,
  ) => void;
}) => (reloadPage?: boolean) => Promise<void>;

/** How long a new worker may take to precache the build, and to take over. */
const SETTLE_TIMEOUT_MS = 30_000;

/** The one activation path: sends the waiting worker `SKIP_WAITING` (vite-plugin-pwa). */
let activateWaitingWorker:
  ((reloadPage?: boolean) => Promise<void>) | undefined;
let registration: ServiceWorkerRegistration | undefined;

/**
Registers the service worker and, when a new one is waiting, offers the update;
the app reloads only when the user taps "Neu laden".
*/
export function offerUpdates(register: RegisterServiceWorker): void {
  registration = undefined;
  activateWaitingWorker = register({
    onNeedRefresh: () => {
      showSnackbar({
        text: messages.update.available,
        persistent: true,
        action: {
          label: messages.update.reload,
          run: () => void activateWaitingWorker?.(true),
        },
      });
    },
    onRegisteredSW: (_url, registered) => {
      registration = registered;
    },
  });
}

/** Resolves once the worker reached one of the states, is gone, or the timeout passed. */
function settled(
  worker: ServiceWorker | null,
  states: readonly ServiceWorkerState[],
): Promise<void> {
  if (
    !worker ||
    states.includes(worker.state) ||
    worker.state === 'redundant'
  ) {
    return Promise.resolve();
  }
  return new Promise((resolve) => {
    const done = () => {
      clearTimeout(timer);
      worker.removeEventListener('statechange', onChange);
      resolve();
    };
    const onChange = () => {
      if (states.includes(worker.state) || worker.state === 'redundant') done();
    };
    const timer = setTimeout(done, SETTLE_TIMEOUT_MS);
    worker.addEventListener('statechange', onChange);
  });
}

/**
The reload floor's "Neu laden": a plain reload would get the old shell again from
the old worker, so the newest worker is activated first, through the same path
as the update prompt. Without a waiting worker, the server is asked for one
first. The page reloads in every case, also offline or without a worker.
*/
export async function activateLatestAndReload(
  reload: () => void = () => {
    window.location.reload();
  },
): Promise<void> {
  try {
    if (registration && activateWaitingWorker) {
      if (!registration.waiting) {
        await registration.update();
        await settled(registration.installing, ['installed', 'activated']);
      }
      const waiting = registration.waiting;
      if (waiting) {
        await activateWaitingWorker(true);
        await settled(waiting, ['activated']);
      }
    }
  } catch {
    // Offline or the update check failed: reloading is still the way out.
  }
  reload();
}
