import { onScopeDispose, ref, type Ref } from 'vue';

/** Whether the browser believes it is online, kept current by its online/offline events. */
export function useOnline(): Readonly<Ref<boolean>> {
  const online = ref(navigator.onLine);
  const goOnline = () => (online.value = true);
  const goOffline = () => (online.value = false);
  window.addEventListener('online', goOnline);
  window.addEventListener('offline', goOffline);
  onScopeDispose(() => {
    window.removeEventListener('online', goOnline);
    window.removeEventListener('offline', goOffline);
  });
  return online;
}
