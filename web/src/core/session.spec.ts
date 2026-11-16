import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Account } from './api-client';
import {
  forgetSession,
  resolveSession,
  returnPath,
  signIn,
  signOut,
  useSession,
} from './session';

const anna: Account = { id: 2, userName: 'anna', isAdmin: false };

function answer(status: number, body?: unknown) {
  const fetch = vi.fn(
    async () =>
      new Response(body === undefined ? null : JSON.stringify(body), {
        status,
        headers: {
          'Content-Type':
            status >= 400 ? 'application/problem+json' : 'application/json',
        },
      }),
  );
  vi.stubGlobal('fetch', fetch);
  return fetch;
}

describe('the session', () => {
  beforeEach(() => {
    forgetSession();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('asks the server once who is signed in', async () => {
    const fetch = answer(200, anna);

    await expect(resolveSession()).resolves.toEqual(anna);
    await expect(resolveSession()).resolves.toEqual(anna);

    expect(fetch).toHaveBeenCalledOnce();
    expect(useSession().value).toEqual(anna);
  });

  it('is signed out when the server answers 401', async () => {
    answer(401, { type: 'x', title: 'Nicht angemeldet', status: 401 });

    await expect(resolveSession()).resolves.toBeNull();
  });

  it('stays unknown while the server cannot be reached, so an offline app still opens', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new TypeError('Failed to fetch');
      }),
    );

    await expect(resolveSession()).resolves.toBeUndefined();
  });

  it('knows the account after signing in and forgets it after signing out', async () => {
    answer(200, anna);
    await signIn('anna', 'annas-passwort');
    expect(useSession().value).toEqual(anna);

    answer(204);
    await signOut();

    expect(useSession().value).toBeNull();
  });
});

describe('the return path after sign-in', () => {
  it('is the requested in-app route', () => {
    expect(returnPath('/verwalten/konten')).toBe('/verwalten/konten');
    expect(returnPath('/rangliste?x=1')).toBe('/rangliste?x=1');
  });

  it('falls back to Zählen for anything else', () => {
    for (const unsafe of [
      undefined,
      null,
      '',
      'https://example.org',
      '//example.org',
      '/anmelden',
      ['/rangliste'],
    ]) {
      expect(returnPath(unsafe), String(unsafe)).toBe('/zaehlen');
    }
  });
});
