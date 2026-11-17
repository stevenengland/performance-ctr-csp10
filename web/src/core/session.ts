import { readonly, shallowRef, watch, type DeepReadonly, type Ref } from 'vue';
import * as api from './api-client';
import { ApiProblem, type Account } from './api-client';

/** The signed-in account; `null` when signed out, `undefined` while unknown (not asked yet, or offline). */
const account = shallowRef<Account | null | undefined>();
let pending: Promise<Account | null | undefined> | undefined;

async function askServer(): Promise<Account | null | undefined> {
  try {
    account.value = await api.getSession();
  } catch (error) {
    if (error instanceof ApiProblem && error.status === 401) {
      account.value = null;
    }
    // Anything else (offline, maintenance) leaves it unknown; the next navigation asks again.
  } finally {
    pending = undefined;
  }
  return account.value;
}

/** Who is signed in: asks the server only while that is unknown. */
export function resolveSession(): Promise<Account | null | undefined> {
  if (account.value !== undefined) return Promise.resolve(account.value);
  pending ??= askServer();
  return pending;
}

export async function signIn(userName: string, password: string) {
  account.value = await api.signIn(userName, password);
}

export async function signOut() {
  await api.signOut();
  account.value = null;
}

/** Forgets who is signed in, so the next navigation asks the server again (after it answered 401 elsewhere). */
export function forgetSession(): void {
  account.value = undefined;
  pending = undefined;
}

export function useSession() {
  return readonly(account);
}

/**
Calls `cross` at every authentication boundary: signing out, and every sign-in,
also of the account that just signed out (each answer of the server about who
is signed in is a new account object). Whatever was read for one session must
not outlive it, so the caller drops its data and every answer still on its way.
A session that is only unknown for a moment (asked again after a 401 elsewhere,
or offline) crosses no boundary until the server answers again.
*/
export function watchAuthBoundaries(
  session: Readonly<Ref<DeepReadonly<Account> | null | undefined>>,
  cross: (account: DeepReadonly<Account> | null) => void,
): void {
  let known = session.value;
  watch(
    session,
    (now) => {
      if (now === undefined || now === known) return;
      known = now;
      cross(now);
    },
    { flush: 'sync' },
  );
}

export const SIGN_IN_PATH = '/anmelden';
const HOME = '/zaehlen';

/** Where to go after signing in: the requested in-app route, never another origin or Anmelden itself. */
export function returnPath(requested: unknown): string {
  if (
    typeof requested !== 'string' ||
    !requested.startsWith('/') ||
    requested.startsWith('//') ||
    requested.startsWith(SIGN_IN_PATH)
  ) {
    return HOME;
  }
  return requested;
}
