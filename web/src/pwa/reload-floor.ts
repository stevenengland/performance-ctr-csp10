import { readonly, ref } from 'vue';

const required = ref(false);

function core(version: string): number[] {
  const [release = ''] = version.split(/[+-]/, 1);
  return release.split('.').map((part) => Number.parseInt(part, 10) || 0);
}

/** Compares `MAJOR.MINOR.PATCH`; build metadata and pre-release tags do not count. */
export function isOlderThan(client: string, minimum: string): boolean {
  const [a, b] = [core(client), core(minimum)];
  for (let index = 0; index < 3; index += 1) {
    const difference = (a[index] ?? 0) - (b[index] ?? 0);
    if (difference !== 0) return difference < 0;
  }
  return false;
}

/** Blocks the app when the server no longer serves this client version. */
export function checkClientVersion(
  clientVersion: string,
  minClientVersion: string,
): void {
  if (isOlderThan(clientVersion, minClientVersion)) required.value = true;
}

export function requireReload(): void {
  required.value = true;
}

export function resetReloadFloor(): void {
  required.value = false;
}

export function useReloadFloor() {
  return readonly(required);
}
