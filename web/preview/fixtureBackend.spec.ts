import { afterEach, describe, expect, it } from 'vitest';
import {
  ApiProblem,
  createAccount,
  getHealth,
  getSession,
  listAccounts,
  signIn,
  signOut,
} from '../src/core/api-client';
import { installFixtureBackend } from './fixtureBackend';
import { SAMPLE_PASSWORD, sampleEvening } from './fixtures';

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

  it('starts signed in as an admin', async () => {
    installFixtureBackend(sampleEvening());

    await expect(getSession()).resolves.toMatchObject({
      userName: 'anna',
      isAdmin: true,
    });
  });

  it('signs out and in again in memory', async () => {
    installFixtureBackend(sampleEvening());

    await signOut();
    await expect(getSession()).rejects.toMatchObject({ status: 401 });
    await expect(signIn('ben', 'falsch')).rejects.toMatchObject({
      status: 401,
    });
    await expect(signIn('Ben', SAMPLE_PASSWORD)).resolves.toMatchObject({
      userName: 'ben',
      isAdmin: false,
    });
    await expect(listAccounts()).rejects.toMatchObject({ status: 403 });
  });

  it('creates accounts with the API’s validation', async () => {
    installFixtureBackend(sampleEvening());

    await expect(createAccount('jule', 'kurz')).rejects.toMatchObject({
      status: 422,
      errors: { password: 'Mindestens 10 Zeichen.' },
    });
    await expect(createAccount('ANNA', SAMPLE_PASSWORD)).rejects.toMatchObject({
      status: 409,
      title: 'Benutzername ist bereits vergeben.',
    });
    await createAccount('jule', SAMPLE_PASSWORD);

    expect((await listAccounts()).map((a) => a.userName)).toEqual([
      'anna',
      'ben',
      'daniel',
      'jule',
      'mara',
    ]);
  });
});
