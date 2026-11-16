import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createMemoryHistory } from 'vue-router';
import type { Account } from './core/api-client';
import { forgetSession } from './core/session';
import { createAppRouter } from './router';

function signedInAs(account: Account | null) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () =>
      account === null
        ? new Response(
            JSON.stringify({
              type: 'x',
              title: 'Nicht angemeldet',
              status: 401,
            }),
            {
              status: 401,
              headers: { 'Content-Type': 'application/problem+json' },
            },
          )
        : new Response(JSON.stringify(account), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          }),
    ),
  );
}

async function open(path: string) {
  const router = createAppRouter(createMemoryHistory());
  await router.push(path);
  return router.currentRoute.value;
}

describe('the route guard', () => {
  beforeEach(() => {
    forgetSession();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('sends a signed-out user to Anmelden, remembering the requested route', async () => {
    signedInAs(null);

    const route = await open('/verwalten/konten');

    expect(route.path).toBe('/anmelden');
    expect(route.query.weiter).toBe('/verwalten/konten');
  });

  it('lets a signed-in user through', async () => {
    signedInAs({ id: 2, userName: 'anna', isAdmin: false });

    expect((await open('/rangliste')).path).toBe('/rangliste');
  });

  it('opens a person’s Verlauf under the Rangliste, for today, and nothing for an id that is none', async () => {
    signedInAs({ id: 2, userName: 'anna', isAdmin: false });

    const verlauf = await open('/verlauf/3');
    const notAnId = await open('/verlauf/daniel');

    expect(verlauf.path).toBe('/verlauf/3');
    expect(verlauf.params.personId).toBe('3');
    expect(verlauf.meta).toMatchObject({
      context: 'Heute',
      destination: 'rangliste',
      child: true,
    });
    expect(notAnId.path).toBe('/zaehlen');
  });

  it('keeps Konten to admins', async () => {
    signedInAs({ id: 2, userName: 'anna', isAdmin: false });
    expect((await open('/verwalten/konten')).path).toBe('/verwalten');

    forgetSession();
    signedInAs({ id: 1, userName: 'chef', isAdmin: true });
    expect((await open('/verwalten/konten')).path).toBe('/verwalten/konten');
  });

  it('keeps Protokoll to admins, under Verwalten', async () => {
    signedInAs({ id: 2, userName: 'anna', isAdmin: false });
    expect((await open('/verwalten/protokoll')).path).toBe('/verwalten');

    forgetSession();
    signedInAs({ id: 1, userName: 'chef', isAdmin: true });
    const protokoll = await open('/verwalten/protokoll');
    expect(protokoll.path).toBe('/verwalten/protokoll');
    expect(protokoll.meta).toMatchObject({
      title: 'Protokoll',
      destination: 'verwalten',
      child: true,
      admin: true,
    });
  });

  it('opens Spiele under Verwalten for every signed-in account', async () => {
    signedInAs({ id: 2, userName: 'anna', isAdmin: false });

    const spiele = await open('/verwalten/spiele?anlegen');

    expect(spiele.path).toBe('/verwalten/spiele');
    expect(spiele.query).toHaveProperty('anlegen');
    expect(spiele.meta).toMatchObject({
      title: 'Spiele',
      destination: 'verwalten',
      child: true,
    });
  });

  it('opens Spiele as a destination and a game’s page below it, and nothing for an id that is none', async () => {
    signedInAs({ id: 2, userName: 'anna', isAdmin: false });

    const spiele = await open('/spiele');
    const spiel = await open('/spiele/3');
    const notAnId = await open('/spiele/schach');

    expect(spiele.meta).toMatchObject({
      title: 'Spiele',
      destination: 'spiele',
    });
    expect(spiele.meta.child).toBeUndefined();
    expect(spiel.path).toBe('/spiele/3');
    expect(spiel.params.gameId).toBe('3');
    expect(spiel.meta).toMatchObject({
      title: 'Spiele',
      destination: 'spiele',
      child: true,
    });
    expect(notAnId.path).toBe('/zaehlen');
  });

  it('sends a signed-in user away from Anmelden to where they wanted to go', async () => {
    signedInAs({ id: 2, userName: 'anna', isAdmin: false });

    expect((await open('/anmelden?weiter=/rangliste')).path).toBe('/rangliste');
  });

  it('lets the app open while the server cannot be reached', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new TypeError('Failed to fetch');
      }),
    );

    expect((await open('/rangliste')).path).toBe('/rangliste');
  });
});
