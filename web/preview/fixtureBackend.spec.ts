import { afterEach, describe, expect, it } from 'vitest';
import { ApiProblem, getHealth } from '../src/core/api-client';
import { installFixtureBackend } from './fixtureBackend';
import { sampleEvening } from './fixtures';

describe('the fixture backend', () => {
  const realFetch = globalThis.fetch;
  afterEach(() => {
    globalThis.fetch = realFetch;
  });

  it('answers health through the app’s own API client', async () => {
    const fixtures = sampleEvening();
    installFixtureBackend(fixtures);

    await expect(getHealth()).resolves.toEqual(fixtures.health);
  });

  it('answers what it does not know with 503, like a server in maintenance', async () => {
    installFixtureBackend(sampleEvening());

    const response = await fetch('/api/persons');

    expect(response.status).toBe(503);
    expect(response.headers.get('Content-Type')).toBe(
      'application/problem+json',
    );
    await expect(ApiProblem.from(response)).resolves.toMatchObject({
      type: 'urn:performance:problem:maintenance',
    });
  });

  it('serves a current client', () => {
    const { health } = sampleEvening();

    expect(health.migration).toBe('ok');
    expect(health.minClientVersion).toBe('0.1.0');
  });
});
