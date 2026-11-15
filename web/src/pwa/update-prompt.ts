import { messages } from '../core/messages';
import { showSnackbar } from '../core/snackbar';

/** The shape of vite-plugin-pwa's `registerSW`; the worker activates when the returned function runs. */
export type RegisterServiceWorker = (options: {
  onNeedRefresh: () => void;
}) => (reloadPage?: boolean) => Promise<void>;

/**
Registers the service worker and, when a new one is waiting, offers the update;
the app reloads only when the user taps "Neu laden".
*/
export function offerUpdates(register: RegisterServiceWorker): void {
  const updateServiceWorker = register({
    onNeedRefresh: () => {
      showSnackbar({
        text: messages.update.available,
        persistent: true,
        action: {
          label: messages.update.reload,
          run: () => void updateServiceWorker(true),
        },
      });
    },
  });
}
