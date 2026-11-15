import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  ApiProblem,
  createAccount,
  deleteEntry,
  getHealth,
  getScoreboard,
  getSession,
  onUnauthorized,
  putEntry,
  signOut,
} from './index';
import type { Health } from './index';

const health: Health = {
  appVersion: '0.1.0+abc',
  phpVersion: '8.3.6',
  database: { engine: 'MySQL', version: '8.4.3' },
  schemaVersion: 1,
  migration: 'ok',
  minClientVersion: '0.1.0',
};

function respond(body: unknown, init: ResponseInit) {
  const fetch = vi.fn(async () => new Response(JSON.stringify(body), init));
  vi.stubGlobal('fetch', fetch);
  return fetch;
}

describe('the API client', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    onUnauthorized(undefined);
  });

  it('reads health through whatever fetch is installed when it is called', async () => {
    const fetch = respond(health, {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });

    await expect(getHealth()).resolves.toEqual(health);
    expect(fetch).toHaveBeenCalledWith(
      '/api/health',
      expect.objectContaining({ credentials: 'same-origin' }),
    );
  });

  it('turns a problem response into an ApiProblem with its title and Retry-After', async () => {
    respond(
      {
        type: 'urn:performance:problem:maintenance',
        title: 'Wird aktualisiert – gleich wieder da',
        status: 503,
      },
      {
        status: 503,
        headers: {
          'Content-Type': 'application/problem+json',
          'Retry-After': '5',
        },
      },
    );

    const problem = await getHealth().catch((error: unknown) => error);

    expect(problem).toBeInstanceOf(ApiProblem);
    expect(problem).toMatchObject({
      status: 503,
      type: 'urn:performance:problem:maintenance',
      title: 'Wird aktualisiert – gleich wieder da',
      retryAfterSeconds: 5,
    });
  });

  it('describes a failure without a problem body by its status', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('<html>', { status: 502 })),
    );

    await expect(getHealth()).rejects.toMatchObject({
      status: 502,
      type: 'about:blank',
      retryAfterSeconds: undefined,
    });
  });

  it('sends a body as JSON and returns the created resource', async () => {
    const fetch = respond(
      { id: 2, userName: 'anna', isAdmin: false },
      { status: 201, headers: { 'Content-Type': 'application/json' } },
    );

    await expect(createAccount('anna', 'annas-startpasswort')).resolves.toEqual(
      { id: 2, userName: 'anna', isAdmin: false },
    );
    expect(fetch).toHaveBeenCalledWith(
      '/api/accounts',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          'Content-Type': 'application/json',
        }) as unknown,
        body: JSON.stringify({
          userName: 'anna',
          password: 'annas-startpasswort',
        }),
      }),
    );
  });

  it('resolves a 204 to nothing', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(null, { status: 204 })),
    );

    await expect(signOut()).resolves.toBeUndefined();
  });

  it('carries the field errors of a 422 problem', async () => {
    respond(
      {
        type: 'urn:performance:problem:validation',
        title: 'Bitte Eingaben prüfen',
        status: 422,
        errors: { password: 'Mindestens 10 Zeichen.' },
      },
      { status: 422, headers: { 'Content-Type': 'application/problem+json' } },
    );

    await expect(createAccount('anna', 'kurz')).rejects.toMatchObject({
      status: 422,
      errors: { password: 'Mindestens 10 Zeichen.' },
    });
  });

  it('reports a 401 outside /api/session as an ended session', async () => {
    const ended = vi.fn();
    onUnauthorized(ended);
    const unauthenticated = {
      type: 'urn:performance:problem:unauthenticated',
      title: 'Nicht angemeldet',
      status: 401,
    };
    const init = {
      status: 401,
      headers: { 'Content-Type': 'application/problem+json' },
    };

    respond(unauthenticated, init);
    await expect(getSession()).rejects.toMatchObject({ status: 401 });
    expect(ended).not.toHaveBeenCalled();

    respond(unauthenticated, init);
    await expect(createAccount('anna', 'x')).rejects.toMatchObject({
      status: 401,
    });
    expect(ended).toHaveBeenCalledOnce();
  });

  it('puts an entry under its id and deletes it by that id', async () => {
    const entry = {
      id: '6f1c2d3e-4a5b-4c6d-8e7f-90a1b2c3d4e5',
      personId: 1,
      drinkId: 2,
      quantity: 2,
      createdAt: '2026-11-14T20:00:00.000Z',
    };
    const fetch = respond(entry, {
      status: 201,
      headers: { 'Content-Type': 'application/json' },
    });

    await expect(
      putEntry(entry.id, { personId: 1, drinkId: 2, quantity: 2 }),
    ).resolves.toEqual(entry);
    expect(fetch).toHaveBeenCalledWith(
      `/api/entries/${entry.id}`,
      expect.objectContaining({
        method: 'PUT',
        body: JSON.stringify({ personId: 1, drinkId: 2, quantity: 2 }),
      }),
    );

    const remove = vi.fn(async () => new Response(null, { status: 204 }));
    vi.stubGlobal('fetch', remove);
    await expect(deleteEntry(entry.id)).resolves.toBeUndefined();
    expect(remove).toHaveBeenCalledWith(
      `/api/entries/${entry.id}`,
      expect.objectContaining({ method: 'DELETE' }),
    );
  });

  it('asks the scoreboard for the given start of the day', async () => {
    const fetch = respond(
      { rows: [] },
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    );

    await expect(getScoreboard('2026-11-14T23:00:00.000Z')).resolves.toEqual({
      rows: [],
    });
    expect(fetch).toHaveBeenCalledWith(
      '/api/scoreboard?from=2026-11-14T23%3A00%3A00.000Z',
      expect.anything(),
    );
  });
});
