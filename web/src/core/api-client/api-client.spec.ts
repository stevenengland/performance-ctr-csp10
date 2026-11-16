import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  ApiProblem,
  createAccount,
  deleteAccount,
  deleteDrink,
  deleteEntry,
  deleteFactor,
  deleteMatch,
  deletePerson,
  deletePersonPhoto,
  deleteResult,
  getDrink,
  getFactor,
  getHealth,
  getScoreboard,
  getStandings,
  getPerson,
  getSession,
  listAuditEvents,
  listEntries,
  listMatches,
  listResults,
  onUnauthorized,
  putEntry,
  putMatch,
  putResult,
  restartGame,
  signOut,
  updateAccount,
  updateDrink,
  updateFactor,
  updatePerson,
} from './index';
import type { Health } from './index';
import { resetReloadFloor, useReloadFloor } from '../../pwa/reload-floor';

const health: Health = {
  appVersion: '0.1.0+abc',
  phpVersion: '8.5.12',
  database: { engine: 'MariaDB', version: '11.8.8' },
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
    resetReloadFloor();
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

  it('changes an account’s admin rights or resets its password with PATCH', async () => {
    const fetch = respond(
      { id: 2, userName: 'anna', isAdmin: true },
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    );

    await expect(updateAccount(2, { isAdmin: true })).resolves.toEqual({
      id: 2,
      userName: 'anna',
      isAdmin: true,
    });
    await updateAccount(2, { password: 'neues-passwort-1' });

    expect(fetch).toHaveBeenNthCalledWith(
      1,
      '/api/accounts/2',
      expect.objectContaining({
        method: 'PATCH',
        body: JSON.stringify({ isAdmin: true }),
      }),
    );
    expect(fetch).toHaveBeenNthCalledWith(
      2,
      '/api/accounts/2',
      expect.objectContaining({
        method: 'PATCH',
        body: JSON.stringify({ password: 'neues-passwort-1' }),
      }),
    );
  });

  it('deletes an account and reports the last admin as a problem', async () => {
    respond(
      {
        type: 'urn:performance:problem:last-admin',
        title: 'Der letzte Admin kann nicht entfernt werden.',
        status: 409,
      },
      { status: 409, headers: { 'Content-Type': 'application/problem+json' } },
    );

    await expect(deleteAccount(1)).rejects.toMatchObject({
      status: 409,
      title: 'Der letzte Admin kann nicht entfernt werden.',
    });
    expect(fetch).toHaveBeenCalledWith(
      '/api/accounts/1',
      expect.objectContaining({ method: 'DELETE' }),
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

  it('tells the server its app version on every request, health included', async () => {
    const fetch = respond(health, {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });

    await getHealth();
    await createAccount('anna', 'annas-startpasswort');
    await signOut();

    expect(fetch).toHaveBeenCalledTimes(3);
    for (const [, init] of fetch.mock.calls as unknown as [
      string,
      RequestInit,
    ][]) {
      expect(init.headers).toMatchObject({
        'X-Client-Version': __APP_VERSION__,
      });
    }
  });

  it('shows the reload floor when the server refuses this version as outdated', async () => {
    const outdated = {
      type: 'urn:performance:problem:client-outdated',
      title: 'Diese Version ist veraltet. Bitte neu laden.',
      status: 400,
    };
    respond(outdated, {
      status: 400,
      headers: { 'Content-Type': 'application/problem+json' },
    });

    await expect(createAccount('anna', 'x')).rejects.toMatchObject({
      status: 400,
      type: 'urn:performance:problem:client-outdated',
    });
    expect(useReloadFloor().value).toBe(true);
  });

  it('keeps the app running on any other refusal', async () => {
    respond(
      {
        type: 'urn:performance:problem:bad-request',
        title: 'Ungültige Anfrage',
        status: 400,
      },
      {
        status: 400,
        headers: { 'Content-Type': 'application/problem+json' },
      },
    );

    await expect(createAccount('anna', 'x')).rejects.toMatchObject({
      status: 400,
    });
    expect(useReloadFloor().value).toBe(false);
  });

  it('puts an entry under its id and deletes it by that id', async () => {
    const entry = {
      id: '6f1c2d3e-4a5b-4c6d-8e7f-90a1b2c3d4e5',
      personId: 1,
      drinkId: 2,
      quantity: 2,
      factorId: null,
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

  it('records a match under its id and deletes it by that id', async () => {
    const id = '0b6d2c1e-7f3a-4e5b-9c8d-1a2b3c4d5e6f';
    const body = {
      gameId: 1,
      firstPersonId: 1,
      secondPersonId: 2,
      outcome: 'first' as const,
    };
    const match = { id, ...body, createdAt: '2026-11-15T20:00:00.000Z' };
    const fetch = respond(match, {
      status: 201,
      headers: { 'Content-Type': 'application/json' },
    });

    await expect(putMatch(id, body)).resolves.toEqual(match);
    expect(fetch).toHaveBeenCalledWith(
      `/api/matches/${id}`,
      expect.objectContaining({ method: 'PUT', body: JSON.stringify(body) }),
    );

    const remove = vi.fn(async () => new Response(null, { status: 204 }));
    vi.stubGlobal('fetch', remove);
    await expect(deleteMatch(id)).resolves.toBeUndefined();
    expect(remove).toHaveBeenCalledWith(
      `/api/matches/${id}`,
      expect.objectContaining({ method: 'DELETE' }),
    );
  });

  it('records a result under its id and deletes it by that id', async () => {
    const id = '5c1d9e2a-3b4f-4a6c-8d7e-9f0a1b2c3d4e';
    const body = { gameId: 2, personId: 4, points: -20 };
    const result = { id, ...body, createdAt: '2026-11-15T20:00:00.000Z' };
    const fetch = respond(result, {
      status: 201,
      headers: { 'Content-Type': 'application/json' },
    });

    await expect(putResult(id, body)).resolves.toEqual(result);
    expect(fetch).toHaveBeenCalledWith(
      `/api/results/${id}`,
      expect.objectContaining({ method: 'PUT', body: JSON.stringify(body) }),
    );

    const remove = vi.fn(async () => new Response(null, { status: 204 }));
    vi.stubGlobal('fetch', remove);
    await expect(deleteResult(id)).resolves.toBeUndefined();
    expect(remove).toHaveBeenCalledWith(
      `/api/results/${id}`,
      expect.objectContaining({ method: 'DELETE' }),
    );
  });

  it('lists a person’s entries since an instant', async () => {
    const entries = [
      {
        id: '6f1c2d3e-4a5b-4c6d-8e7f-90a1b2c3d4e5',
        drink: { id: 2, name: 'Bier' },
        quantity: 2,
        factor: null,
        createdAt: '2026-11-14T23:41:00.000Z',
        accountName: null,
      },
    ];
    const fetch = respond(
      { entries },
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    );

    await expect(listEntries(3, '2026-11-14T23:00:00.000Z')).resolves.toEqual(
      entries,
    );
    expect(fetch).toHaveBeenCalledWith(
      '/api/entries?personId=3&from=2026-11-14T23%3A00%3A00.000Z',
      expect.objectContaining({ method: 'GET' }),
    );
  });

  it('reads the newest page of the audit log, and an older one before a given event', async () => {
    const page = { events: [], next: null };
    const fetch = respond(page, {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });

    await expect(listAuditEvents()).resolves.toEqual(page);
    await listAuditEvents(41);

    expect(fetch).toHaveBeenNthCalledWith(
      1,
      '/api/audit',
      expect.objectContaining({ method: 'GET' }),
    );
    expect(fetch).toHaveBeenNthCalledWith(
      2,
      '/api/audit?before=41',
      expect.objectContaining({ method: 'GET' }),
    );
  });

  it('reads the newest page of a game’s matches or results, and an older one before a cursor', async () => {
    const page = { items: [], next: null };
    const fetch = respond(page, {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });

    await expect(listMatches(2)).resolves.toEqual(page);
    await listMatches(2, 'WzEsIjIwMjYiXQ');
    await expect(listResults(1)).resolves.toEqual(page);
    await listResults(1, 'WzEsIjIwMjYiXQ');

    [
      '/api/games/2/matches',
      '/api/games/2/matches?before=WzEsIjIwMjYiXQ',
      '/api/games/1/results',
      '/api/games/1/results?before=WzEsIjIwMjYiXQ',
    ].forEach((url, index) => {
      expect(fetch).toHaveBeenNthCalledWith(
        index + 1,
        url,
        expect.objectContaining({ method: 'GET' }),
      );
    });
  });

  it('reads a factor with its entry count, edits it and deletes it at its id', async () => {
    const detail = { id: 3, name: 'Happy Hour', multiplier: 2, entryCount: 5 };
    const read = respond(detail, {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
    await expect(getFactor(3)).resolves.toEqual(detail);
    expect(read).toHaveBeenCalledWith(
      '/api/factors/3',
      expect.objectContaining({ method: 'GET' }),
    );

    const edit = respond(
      { id: 3, name: 'Happy Hour', multiplier: 1.5 },
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    );
    await updateFactor(3, 'Happy Hour', 1.5);
    expect(edit).toHaveBeenCalledWith(
      '/api/factors/3',
      expect.objectContaining({
        method: 'PATCH',
        body: JSON.stringify({ name: 'Happy Hour', multiplier: 1.5 }),
      }),
    );

    const remove = vi.fn(async () => new Response(null, { status: 204 }));
    vi.stubGlobal('fetch', remove);
    await expect(deleteFactor(3)).resolves.toBeUndefined();
    expect(remove).toHaveBeenCalledWith(
      '/api/factors/3',
      expect.objectContaining({ method: 'DELETE' }),
    );
  });

  it('removes a person’s photo at the person’s photo path', async () => {
    const remove = vi.fn(async () => new Response(null, { status: 204 }));
    vi.stubGlobal('fetch', remove);

    await expect(deletePersonPhoto(2)).resolves.toBeUndefined();

    expect(remove).toHaveBeenCalledWith(
      '/api/persons/2/photo',
      expect.objectContaining({ method: 'DELETE', body: undefined }),
    );
  });

  it('reads a person with the entry count, renames and deletes the person at its id', async () => {
    const detail = {
      id: 2,
      name: 'Daniel',
      photoUrl: null,
      entryCount: 23,
    };
    const read = respond(detail, {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
    await expect(getPerson(2)).resolves.toEqual(detail);
    expect(read).toHaveBeenCalledWith(
      '/api/persons/2',
      expect.objectContaining({ method: 'GET' }),
    );

    const rename = respond(
      { id: 2, name: 'Dani', photoUrl: null },
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    );
    await expect(updatePerson(2, 'Dani')).resolves.toEqual({
      id: 2,
      name: 'Dani',
      photoUrl: null,
    });
    expect(rename).toHaveBeenCalledWith(
      '/api/persons/2',
      expect.objectContaining({
        method: 'PATCH',
        body: JSON.stringify({ name: 'Dani' }),
      }),
    );

    const remove = vi.fn(async () => new Response(null, { status: 204 }));
    vi.stubGlobal('fetch', remove);
    await expect(deletePerson(2)).resolves.toBeUndefined();
    expect(remove).toHaveBeenCalledWith(
      '/api/persons/2',
      expect.objectContaining({ method: 'DELETE' }),
    );
  });

  it('reads a drink with its entry count, edits it and deletes it at its id', async () => {
    const detail = { id: 4, name: 'Bier', points: 1, entryCount: 12 };
    const read = respond(detail, {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
    await expect(getDrink(4)).resolves.toEqual(detail);
    expect(read).toHaveBeenCalledWith(
      '/api/drinks/4',
      expect.objectContaining({ method: 'GET' }),
    );

    const edit = respond(
      { id: 4, name: 'Helles', points: 1.25 },
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    );
    await updateDrink(4, 'Helles', 1.25);
    expect(edit).toHaveBeenCalledWith(
      '/api/drinks/4',
      expect.objectContaining({
        method: 'PATCH',
        body: JSON.stringify({ name: 'Helles', points: 1.25 }),
      }),
    );

    const remove = vi.fn(async () => new Response(null, { status: 204 }));
    vi.stubGlobal('fetch', remove);
    await expect(deleteDrink(4)).resolves.toBeUndefined();
    expect(remove).toHaveBeenCalledWith(
      '/api/drinks/4',
      expect.objectContaining({ method: 'DELETE' }),
    );
  });

  it('restarts a game with an empty JSON body and returns it with its new start', async () => {
    const game = {
      id: 2,
      name: 'Schach',
      kind: 'duel',
      drawsAllowed: true,
      lowerWins: false,
      startedAt: '2026-11-15T18:30:00.000Z',
    };
    const fetch = respond(game, {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });

    await expect(restartGame(2)).resolves.toEqual(game);
    expect(fetch).toHaveBeenCalledWith(
      '/api/games/2/restart',
      expect.objectContaining({
        method: 'POST',
        body: '{}',
        headers: expect.objectContaining({
          'Content-Type': 'application/json',
        }),
      }),
    );
  });

  it('reads a game’s ranking, tagged with its kind, and keeps its ETag', async () => {
    const standings = {
      kind: 'duel',
      startedAt: '2026-09-15T10:00:00.000Z',
      rows: [],
    };
    const fetch = respond(standings, {
      status: 200,
      headers: { 'Content-Type': 'application/json', ETag: '"42"' },
    });

    await expect(getStandings(2)).resolves.toEqual({
      standings,
      etag: '"42"',
    });
    expect(fetch).toHaveBeenCalledWith(
      '/api/games/2/standings',
      expect.objectContaining({
        headers: expect.not.objectContaining({
          'If-None-Match': expect.anything(),
        }),
      }),
    );
  });

  it('asks for a game’s ranking on condition of the last ETag; 304 means unchanged', async () => {
    const fetch = vi.fn(
      async () =>
        new Response(null, { status: 304, headers: { ETag: '"42"' } }),
    );
    vi.stubGlobal('fetch', fetch);

    await expect(getStandings(2, '"42"')).resolves.toBe('unchanged');
    expect(fetch).toHaveBeenCalledWith(
      '/api/games/2/standings',
      expect.objectContaining({
        headers: expect.objectContaining({ 'If-None-Match': '"42"' }),
      }),
    );
  });

  it('asks the scoreboard for the given start of the day and keeps its ETag', async () => {
    const fetch = respond(
      { rows: [] },
      {
        status: 200,
        headers: { 'Content-Type': 'application/json', ETag: '"7-1"' },
      },
    );

    await expect(getScoreboard('2026-11-14T23:00:00.000Z')).resolves.toEqual({
      board: { rows: [] },
      etag: '"7-1"',
    });
    expect(fetch).toHaveBeenCalledWith(
      '/api/scoreboard?from=2026-11-14T23%3A00%3A00.000Z',
      expect.objectContaining({
        headers: expect.not.objectContaining({
          'If-None-Match': expect.anything(),
        }),
      }),
    );
  });

  it('asks for the scoreboard on condition of the last ETag; 304 means unchanged', async () => {
    const fetch = vi.fn(
      async () =>
        new Response(null, { status: 304, headers: { ETag: '"7-1"' } }),
    );
    vi.stubGlobal('fetch', fetch);

    await expect(
      getScoreboard('2026-11-14T23:00:00.000Z', '"7-1"'),
    ).resolves.toBe('unchanged');
    expect(fetch).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        headers: expect.objectContaining({ 'If-None-Match': '"7-1"' }),
      }),
    );
  });
});
