import { readonly, shallowRef } from 'vue';
import { checkClientVersion } from '../pwa/reload-floor';
import { getHealth, type Health } from './api-client';

const server = shallowRef<Health>();

/** Reads the server's health once; a client the server no longer serves gets the reload floor. */
export async function loadServerHealth(clientVersion: string): Promise<void> {
  try {
    server.value = await getHealth();
    checkClientVersion(clientVersion, server.value.minClientVersion);
  } catch {
    // Offline or unreachable: the shell keeps working; the version view says so.
  }
}

export function useServerHealth() {
  return readonly(server);
}
