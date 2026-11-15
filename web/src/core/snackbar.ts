import { ApiProblem } from './api-client';
import { readonly, shallowRef } from 'vue';

export const SNACKBAR_TIMEOUT_MS = 8000;

export interface SnackbarAction {
  label: string;
  run: () => void;
}

export interface SnackbarMessage {
  text: string;
  action?: SnackbarAction;
  /** Stays until its action or a newer message replaces it. */
  persistent?: boolean;
}

export interface ShownSnackbar {
  id: number;
  text: string;
  action?: SnackbarAction;
  /** Vuetify's convention: -1 never times out. */
  timeoutMs: number;
}

const current = shallowRef<ShownSnackbar>();
let shown = 0;

/** Shows a message; it replaces whatever snackbar is showing. */
export function showSnackbar(message: SnackbarMessage): void {
  shown += 1;
  const { action } = message;
  current.value = {
    id: shown,
    text: message.text,
    timeoutMs: message.persistent ? -1 : SNACKBAR_TIMEOUT_MS,
    action: action && {
      label: action.label,
      run: () => {
        dismissSnackbar();
        action.run();
      },
    },
  };
}

export function dismissSnackbar(): void {
  current.value = undefined;
}

export function useSnackbar() {
  return readonly(current);
}

/**
Shows a failed request's problem title. Without an answer it stays quiet: the
offline banner already says so, and the screen keeps its last data.
*/
export function showProblem(failure: unknown): void {
  if (failure instanceof ApiProblem && failure.status !== 401) {
    showSnackbar({ text: failure.title });
  }
}
