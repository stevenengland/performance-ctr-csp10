import { randomBytes } from 'node:crypto';
import type { APIRequestContext, Page } from '@playwright/test';

/** The bootstrap admin of the e2e stack (e2e/stack/config.php). */
export const ADMIN = { userName: 'e2e-admin', password: 'e2e-admin-passwort' };

/** A user name no earlier run used: the stack's database outlives a run, and both window projects share it. */
export function uniqueName(prefix: string): string {
  return `${prefix}-${randomBytes(4).toString('hex')}`;
}

/** Signs in through the API; the browser context of the request keeps the cookie. */
export async function signInVia(
  request: APIRequestContext,
  account: { userName: string; password: string } = ADMIN,
): Promise<void> {
  const response = await request.post('/api/session', { data: account });
  if (response.status() !== 200) {
    throw new Error(
      `sign-in as ${account.userName} failed: ${String(response.status())}`,
    );
  }
}

/** Signs in as the bootstrap admin in the page's browser context. */
export async function signIn(page: Page): Promise<void> {
  await signInVia(page.request);
}

/** Creates an account as the bootstrap admin, from a separate request context. */
export async function createAccount(
  request: APIRequestContext,
  userName: string,
  password: string,
): Promise<void> {
  await signInVia(request);
  const response = await request.post('/api/accounts', {
    data: { userName, password },
  });
  if (response.status() !== 201) {
    throw new Error(
      `creating ${userName} failed: ${String(response.status())}`,
    );
  }
}

/**
The account that verifies what the bootstrap admin records (PRD #61): the
four-eyes rule needs a second account. Shared by every test and kept between
runs, like the bootstrap admin.
*/
export const VERIFIER = {
  userName: 'e2e-pruefer',
  password: 'e2e-pruefer-passwort',
};

/** The rows the four-eyes rule applies to, by their route. */
export type VerifiableRows = 'entries' | 'matches' | 'results';

/**
Signs a request context of its own in as the verifier, creating that account
first when it is missing, and returns how it verifies a row: an entry by
default, or a match or result; the row then counts.
*/
export async function verifierOn(
  request: APIRequestContext,
): Promise<(id: string, rows?: VerifiableRows) => Promise<void>> {
  await signInVia(request);
  const created = await request.post('/api/accounts', { data: VERIFIER });
  if (![201, 409].includes(created.status())) {
    throw new Error(
      `creating the verifier failed: ${String(created.status())}`,
    );
  }
  await signInVia(request, VERIFIER);
  return async (id, rows = 'entries') => {
    const verified = await request.put(`/api/${rows}/${id}/verification`, {
      data: {},
    });
    if (verified.status() !== 204) {
      throw new Error(`verifying ${id} failed: ${String(verified.status())}`);
    }
  };
}
