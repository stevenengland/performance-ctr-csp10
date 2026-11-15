import type { components } from '../src/core/api-client/schema';
import type { Fixtures } from './fixtures';

type Problem = components['schemas']['Problem'];

function json(body: unknown, status: number, contentType: string): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': contentType },
  });
}

const MAINTENANCE: Problem = {
  type: 'urn:performance:problem:maintenance',
  title: 'Wird aktualisiert – gleich wieder da',
  status: 503,
};

/** The API path of a request, wherever the preview is published (`…/api/health` → `/api/health`). */
function apiPath(input: RequestInfo | URL): string {
  const url = new URL(
    input instanceof Request ? input.url : String(input),
    window.location.href,
  );
  const index = url.pathname.lastIndexOf('/api/');
  return index === -1 ? url.pathname : url.pathname.slice(index);
}

/**
Replaces the global `fetch` with an in-memory backend before the app starts, so
the real app runs on canned answers without network access.
*/
export function installFixtureBackend(fixtures: Fixtures): void {
  globalThis.fetch = async (input, init) => {
    const method = (
      init?.method ?? (input instanceof Request ? input.method : 'GET')
    ).toUpperCase();
    if (method === 'GET' && apiPath(input) === '/api/health') {
      return json(fixtures.health, 200, 'application/json');
    }
    return json(MAINTENANCE, 503, 'application/problem+json');
  };
}
