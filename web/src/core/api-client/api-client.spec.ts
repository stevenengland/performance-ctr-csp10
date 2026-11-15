import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiProblem, getHealth } from './index';
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
});
