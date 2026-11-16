import { afterEach, describe, expect, it } from 'vitest';
import {
  createGame,
  deleteGame,
  deleteMatch,
  deleteResult,
  deletePerson,
  getGame,
  getPerson,
  listGames,
  listMatches,
  listResults,
  updateGame,
  getStandings,
  listPersons,
  putEntry,
  putMatch,
  putResult,
  type Game,
  type Standings,
} from '../src/core/api-client';
import { installFixtureBackend } from './fixtureBackend';
import { newest, told } from './fixtureTesting';
import { sampleEvening } from './fixtures';

describe('the fixture backend’s games', () => {
  const realFetch = globalThis.fetch;
  afterEach(() => {
    globalThis.fetch = realFetch;
  });

  /** Restarts a game as the API takes it, with an empty JSON body. */
  async function restart(id: number): Promise<Game> {
    const response = await fetch(`/api/games/${String(id)}/restart`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{}',
    });
    return (await response.json()) as Game;
  }

  it('serves sample games alphabetically, a duel game with and one without draws and a points game', async () => {
    installFixtureBackend(sampleEvening());

    const games = await listGames();

    expect(
      games.map(({ name, kind, drawsAllowed, lowerWins }) => [
        name,
        kind,
        drawsAllowed,
        lowerWins,
      ]),
    ).toEqual([
      ['Rommé', 'points', true, true],
      ['Schach', 'duel', true, false],
      ['Tischtennis', 'duel', false, false],
    ]);
    for (const { startedAt } of games) {
      expect(new Date(startedAt).getTime()).toBeLessThan(Date.now());
    }
  });

  it('creates games with the API’s validation and defaults, taking only the kind’s own setting', async () => {
    installFixtureBackend(sampleEvening());

    await expect(
      createGame({ name: ' ', kind: 'quiz' as Game['kind'] }),
    ).rejects.toMatchObject({
      status: 422,
      errors: { name: '1 bis 40 Zeichen.', kind: 'Duell oder Punktespiel.' },
    });
    await expect(
      createGame({
        name: 'Go',
        kind: 'duel',
        drawsAllowed: 'ja' as unknown as boolean,
      }),
    ).rejects.toMatchObject({
      status: 422,
      errors: { drawsAllowed: 'Ja oder nein.' },
    });
    await expect(
      createGame({ name: 'schach', kind: 'duel' }),
    ).rejects.toMatchObject({
      status: 409,
      type: 'urn:performance:problem:duplicate-name',
      title: 'Name ist bereits vergeben.',
    });

    const go = await createGame({
      name: ' Go ',
      kind: 'duel',
      lowerWins: true,
    });
    const kniffel = await createGame({
      name: 'Kniffel',
      kind: 'points',
      drawsAllowed: false,
    });

    expect(go).toMatchObject({
      name: 'Go',
      kind: 'duel',
      drawsAllowed: true,
      lowerWins: false,
    });
    expect(kniffel).toMatchObject({ drawsAllowed: true, lowerWins: false });
    expect((await listGames()).map(({ name }) => name)).toEqual([
      'Go',
      'Kniffel',
      'Rommé',
      'Schach',
      'Tischtennis',
    ]);
  });

  it('reads a game with its match and result counts, and edits its name and setting but never its kind', async () => {
    installFixtureBackend(sampleEvening());
    const schach = (await listGames()).find(({ name }) => name === 'Schach');
    if (!schach) throw new Error('no Schach');

    await expect(getGame(schach.id)).resolves.toEqual({
      ...schach,
      matchCount: 9,
      resultCount: 0,
    });
    await expect(
      updateGame(schach.id, { name: 'Schach', kind: 'points' }),
    ).rejects.toMatchObject({
      status: 422,
      errors: { kind: 'Die Art eines Spiels ist fest.' },
    });
    await expect(
      updateGame(schach.id, { name: 'Rommé' }),
    ).rejects.toMatchObject({ status: 409 });
    await expect(updateGame(999, { name: 'Go' })).rejects.toMatchObject({
      status: 404,
    });

    const edited = await updateGame(schach.id, {
      name: 'Blitzschach',
      kind: 'duel',
      drawsAllowed: false,
      lowerWins: true,
    });

    expect(edited).toEqual({
      ...schach,
      name: 'Blitzschach',
      drawsAllowed: false,
    });
  });

  it('restarts a game from now and deletes games', async () => {
    installFixtureBackend(sampleEvening());
    const [romme] = await listGames();
    if (!romme) throw new Error('no game');

    const restarted = await restart(romme.id);
    await deleteGame(romme.id);

    expect(restarted).toMatchObject({ id: romme.id, name: 'Rommé' });
    expect(new Date(restarted.startedAt).getTime()).toBeGreaterThan(
      new Date(romme.startedAt).getTime(),
    );
    expect((await listGames()).map(({ name }) => name)).toEqual([
      'Schach',
      'Tischtennis',
    ]);
    await expect(getGame(romme.id)).rejects.toMatchObject({ status: 404 });
    await expect(deleteGame(romme.id)).rejects.toMatchObject({ status: 404 });
  });

  it('records the viewer’s game writes in the audit log, a restart as an update of run and start', async () => {
    const fixtures = sampleEvening();
    installFixtureBackend(fixtures);
    const seeded = fixtures.audit.length;

    const go = await createGame({ name: 'Go', kind: 'duel' });
    await updateGame(go.id, { name: 'Go', drawsAllowed: true });
    await updateGame(go.id, { name: 'Go', drawsAllowed: false });
    const restarted = await restart(go.id);
    await deleteGame(go.id);

    expect((await newest(4)).map(told).reverse()).toEqual([
      {
        operation: 'create',
        subjectKind: 'game',
        subjectId: String(go.id),
        userName: 'anna',
        before: null,
        after: {
          name: 'Go',
          kind: 'duel',
          drawsAllowed: true,
          run: 1,
          startedAt: go.startedAt,
        },
        cause: null,
      },
      {
        operation: 'update',
        subjectKind: 'game',
        subjectId: String(go.id),
        userName: 'anna',
        before: {
          name: 'Go',
          kind: 'duel',
          drawsAllowed: true,
          run: 1,
          startedAt: go.startedAt,
        },
        after: {
          name: 'Go',
          kind: 'duel',
          drawsAllowed: false,
          run: 1,
          startedAt: go.startedAt,
        },
        cause: null,
      },
      {
        operation: 'update',
        subjectKind: 'game',
        subjectId: String(go.id),
        userName: 'anna',
        before: {
          name: 'Go',
          kind: 'duel',
          drawsAllowed: false,
          run: 1,
          startedAt: go.startedAt,
        },
        after: {
          name: 'Go',
          kind: 'duel',
          drawsAllowed: false,
          run: 2,
          startedAt: restarted.startedAt,
        },
        cause: null,
      },
      {
        operation: 'delete',
        subjectKind: 'game',
        subjectId: String(go.id),
        userName: 'anna',
        before: {
          name: 'Go',
          kind: 'duel',
          drawsAllowed: false,
          run: 2,
          startedAt: restarted.startedAt,
        },
        after: null,
        cause: null,
      },
    ]);
    expect(fixtures.audit).toHaveLength(seeded + 4);
  });

  /** A game's id by its sample name. */
  async function gameId(name: string): Promise<number> {
    const game = (await listGames()).find(
      (candidate) => candidate.name === name,
    );
    if (!game) throw new Error(`no ${name}`);
    return game.id;
  }

  /** A game's ranking, read without condition. */
  async function standingsOf(id: number): Promise<Standings> {
    const answer = await getStandings(id);
    if (answer === 'unchanged') throw new Error('asked without condition');
    return answer.standings;
  }

  /** A ranking's rows as `name points W-D-L/played` or `name sum (results)`, with ` +n` pending results. */
  async function ranking(id: number): Promise<string[]> {
    const standings = await standingsOf(id);
    return standings.kind === 'duel'
      ? standings.rows.map(
          (row) =>
            `${row.name} ${String(row.points)} ${String(row.wins)}-${String(row.draws)}-${String(row.losses)}/${String(row.played)}`,
        )
      : standings.rows.map(
          (row) =>
            `${row.name} ${String(row.sum)} (${String(row.results)})${row.pendingCount > 0 ? ` +${String(row.pendingCount)}` : ''}`,
        );
  }

  it('ranks the sample duels like the API: points, wins, name — a deleted side counts for no one', async () => {
    installFixtureBackend(sampleEvening());

    expect(await ranking(await gameId('Schach'))).toEqual([
      'Anna 4 3-2-0/5',
      'Ben 3.5 3-1-1/5',
      'Tom 1 0-2-2/4',
      'Daniel 0.5 0-1-2/3',
    ]);
    expect(await ranking(await gameId('Tischtennis'))).toEqual([
      'Jule 1 1-0-1/2',
      'Mara 1 1-0-1/2',
      'Tom 1 1-0-1/2',
    ]);
  });

  it('ranks tonight’s Rommé by the lowest sum, and the highest once the direction flips', async () => {
    installFixtureBackend(sampleEvening());
    const romme = await gameId('Rommé');

    const standings = await standingsOf(romme);
    expect(standings).toMatchObject({ kind: 'points', lowerWins: true });
    // Daniel's third result waits; Jule's only one, a 0, waits, so she does not lead.
    expect(await ranking(romme)).toEqual([
      'Daniel -11 (2) +1',
      'Anna 15 (2)',
      'Ben 39 (2)',
      'Mara 79 (2)',
    ]);
    expect(standings).toMatchObject({
      unranked: [{ name: 'Jule', pendingCount: 1 }],
    });
    await expect(getGame(romme)).resolves.toMatchObject({
      matchCount: 0,
      resultCount: 10,
    });

    await updateGame(romme, { name: 'Rommé', lowerWins: false });

    expect(await ranking(romme)).toEqual([
      'Mara 79 (2)',
      'Ben 39 (2)',
      'Anna 15 (2)',
      'Daniel -11 (2) +1',
    ]);
  });

  it('ranks only the current run: a restart starts from an empty ranking', async () => {
    installFixtureBackend(sampleEvening());
    const schach = await gameId('Schach');

    await restart(schach);

    await expect(standingsOf(schach)).resolves.toMatchObject({ rows: [] });
    await expect(getGame(schach)).resolves.toMatchObject({ matchCount: 9 });
  });

  it('tags the ranking with the data revision and answers 304 while it holds', async () => {
    installFixtureBackend(sampleEvening());
    const schach = await gameId('Schach');

    const first = await fetch(`/api/games/${String(schach)}/standings`);
    const etag = first.headers.get('ETag') ?? '';
    const again = await fetch(`/api/games/${String(schach)}/standings`, {
      headers: { 'If-None-Match': etag },
    });
    await restart(schach);
    const changed = await fetch(`/api/games/${String(schach)}/standings`, {
      headers: { 'If-None-Match': etag },
    });

    expect(etag).toMatch(/^"\d+"$/);
    expect(again.status).toBe(304);
    expect(changed.status).toBe(200);
    await expect(
      fetch('/api/games/999/standings').then(({ status }) => status),
    ).resolves.toBe(404);
  });

  it('deletes a game’s matches with it, one caused event per match', async () => {
    const fixtures = sampleEvening();
    installFixtureBackend(fixtures);
    const tischtennis = await gameId('Tischtennis');

    await deleteGame(tischtennis);

    const events = (await newest(5)).map(told).reverse();
    expect(events[0]).toMatchObject({
      operation: 'delete',
      subjectKind: 'game',
      cause: null,
    });
    expect(events.slice(1)).toEqual(
      (
        [
          ['00000000-0000-4000-a000-000000000010', 'Mara', 'Jule', 'first'],
          ['00000000-0000-4000-a000-000000000011', 'Jule', 'Tom', 'first'],
          ['00000000-0000-4000-a000-000000000012', 'Mara', 'Tom', 'second'],
          ['00000000-0000-4000-a000-000000000013', 'Jule', 'Tom', 'second'],
        ] as const
      ).map(([id, first, second, outcome]) => ({
        operation: 'delete',
        subjectKind: 'match',
        subjectId: id,
        userName: 'anna',
        before: {
          game: 'Tischtennis',
          first,
          second,
          outcome,
          pending: id.endsWith('13'),
        },
        after: null,
        cause: { subjectKind: 'game', name: 'Tischtennis' },
      })),
    );
    expect(
      fixtures.matches.filter(({ gameId }) => gameId === tischtennis),
    ).toEqual([]);
  });

  it('deletes a game’s results with it, one caused event per result', async () => {
    const fixtures = sampleEvening();
    installFixtureBackend(fixtures);
    const romme = await gameId('Rommé');

    await deleteGame(romme);

    const events = (await newest(11)).map(told).reverse();
    expect(events[0]).toMatchObject({ subjectKind: 'game', cause: null });
    expect(events.slice(1)).toHaveLength(10);
    expect(events[1]).toEqual({
      operation: 'delete',
      subjectKind: 'result',
      subjectId: '00000000-0000-4000-b000-000000000001',
      userName: 'anna',
      before: { game: 'Rommé', person: 'Anna', points: 35, pending: false },
      after: null,
      cause: { subjectKind: 'game', name: 'Rommé' },
    });
    expect(fixtures.results).toEqual([]);
  });

  it('counts a person’s results and deletes them with the person, one caused event each', async () => {
    const fixtures = sampleEvening();
    installFixtureBackend(fixtures);
    const daniel = (await listPersons()).find(({ name }) => name === 'Daniel');
    if (!daniel) throw new Error('no Daniel');
    await expect(getPerson(daniel.id)).resolves.toMatchObject({
      resultCount: 3,
    });

    await deletePerson(daniel.id);

    const removed = (await newest(3)).map(told).reverse();
    expect(removed).toEqual(
      (
        [
          ['00000000-0000-4000-b000-000000000003', -20, false],
          ['00000000-0000-4000-b000-000000000007', 9, false],
          ['00000000-0000-4000-b000-000000000009', 14, true],
        ] as const
      ).map(([id, points, pending]) => ({
        operation: 'delete',
        subjectKind: 'result',
        subjectId: id,
        userName: 'anna',
        before: { game: 'Rommé', person: 'Daniel', points, pending },
        after: null,
        cause: { subjectKind: 'person', name: 'Daniel' },
      })),
    );
    expect(
      fixtures.results.filter(({ personId }) => personId === daniel.id),
    ).toEqual([]);
  });

  it('keeps a deleted person’s matches with that side cleared, so the others keep their record', async () => {
    const fixtures = sampleEvening();
    installFixtureBackend(fixtures);
    const ben = (await listPersons()).find(({ name }) => name === 'Ben');
    if (!ben) throw new Error('no Ben');
    await expect(getPerson(ben.id)).resolves.toMatchObject({ matchCount: 5 });

    await deletePerson(ben.id);

    expect(await ranking(await gameId('Schach'))).toEqual([
      'Anna 4 3-2-0/5',
      'Tom 1 0-2-2/4',
      'Daniel 0.5 0-1-2/3',
    ]);
    expect(await ranking(await gameId('Rommé'))).toEqual([
      'Daniel -11 (2) +1',
      'Anna 15 (2)',
      'Mara 79 (2)',
    ]);
    // Ben's five match updates, then his two results' deletions.
    const updates = (await newest(7)).map(told).reverse().slice(0, 5);
    expect(updates[0]).toMatchObject({
      operation: 'update',
      subjectKind: 'match',
      subjectId: '00000000-0000-4000-a000-000000000001',
      before: {
        game: 'Schach',
        first: 'Anna',
        second: 'Ben',
        outcome: 'first',
      },
      after: { game: 'Schach', first: 'Anna', second: null, outcome: 'first' },
      cause: { subjectKind: 'person', name: 'Ben' },
    });
    expect(updates.every(({ subjectKind }) => subjectKind === 'match')).toBe(
      true,
    );
  });

  it('records matches idempotently with the API’s validation, audits them and never brings an undone one back', async () => {
    const fixtures = sampleEvening();
    installFixtureBackend(fixtures);
    const schach = await gameId('Schach');
    const persons = await listPersons();
    const idOf = (name: string) =>
      persons.find((person) => person.name === name)?.id ?? 0;
    const id = '1b2c3d4e-5f60-4a7b-8c9d-0e1f2a3b4c5d';
    const match = {
      gameId: schach,
      firstPersonId: idOf('Daniel'),
      secondPersonId: idOf('Tom'),
      outcome: 'first' as const,
    };
    const put = (key: string, body: object) =>
      fetch(`/api/matches/${key}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });

    const created = await put(id, match);
    expect(created.status).toBe(201);
    const { createdAt } = (await created.json()) as { createdAt: string };
    expect((await put(id, match)).status).toBe(200);
    const conflict = await put(id, { ...match, outcome: 'draw' });
    expect(conflict.status).toBe(409);
    await expect(conflict.json()).resolves.toMatchObject({
      type: 'urn:performance:problem:request-conflict',
    });
    // The new match waits, so it counts for neither player yet.
    expect(await ranking(schach)).toEqual([
      'Anna 4 3-2-0/5',
      'Ben 3.5 3-1-1/5',
      'Tom 1 0-2-2/4',
      'Daniel 0.5 0-1-2/3',
    ]);
    await expect(getGame(schach)).resolves.toMatchObject({ matchCount: 10 });
    const [recorded] = (await newest(1)).map(told);
    expect(recorded).toEqual({
      operation: 'create',
      subjectKind: 'match',
      subjectId: id,
      userName: 'anna',
      before: null,
      after: {
        game: 'Schach',
        first: 'Daniel',
        second: 'Tom',
        outcome: 'first',
        pending: true,
      },
      cause: null,
    });

    await deleteMatch(id);
    const replayed = await put(id, match);
    expect(replayed.status).toBe(200);
    // Even after the undo, a replay answers the original instant, like the API.
    await expect(replayed.json()).resolves.toEqual({ id, ...match, createdAt });
    await expect(getGame(schach)).resolves.toMatchObject({ matchCount: 9 });
    const [undone] = (await newest(1)).map(told);
    expect(undone).toMatchObject({
      operation: 'delete',
      subjectId: id,
      before: recorded?.after,
      after: null,
    });
    await expect(deleteMatch(id)).rejects.toMatchObject({ status: 404 });
    // A UUID is unique across entries and matches.
    await expect(
      putEntry(id, { personId: idOf('Tom'), drinkId: 1, quantity: 1 }),
    ).rejects.toMatchObject({ status: 409 });
  });

  it('refuses a match with the API’s validation', async () => {
    installFixtureBackend(sampleEvening());
    const [anna, ben] = await listPersons();
    const match = {
      gameId: await gameId('Schach'),
      firstPersonId: anna?.id ?? 0,
      secondPersonId: ben?.id ?? 0,
      outcome: 'first' as const,
    };
    let next = 0;
    const record = (body: object) => {
      next += 1;
      return putMatch(
        `1b2c3d4e-5f60-4a7b-8c9d-${String(next).padStart(12, '0')}`,
        { ...match, ...body },
      );
    };

    await expect(record({ gameId: 999 })).rejects.toMatchObject({
      status: 404,
    });
    await expect(
      record({ gameId: await gameId('Rommé') }),
    ).rejects.toMatchObject({ status: 422, errors: { gameId: 'Kein Duell.' } });
    await expect(
      record({ gameId: await gameId('Tischtennis'), outcome: 'draw' }),
    ).rejects.toMatchObject({
      status: 422,
      errors: { outcome: 'Remis ist in diesem Spiel nicht möglich.' },
    });
    await expect(
      record({ secondPersonId: anna?.id ?? 0 }),
    ).rejects.toMatchObject({
      status: 422,
      errors: { secondPersonId: 'Zwei verschiedene Personen.' },
    });
    await expect(record({ firstPersonId: 999 })).rejects.toMatchObject({
      status: 422,
      errors: { firstPersonId: 'Person nicht gefunden.' },
    });
    await expect(record({ outcome: 'won' })).rejects.toMatchObject({
      status: 422,
      errors: { outcome: 'Sieg des Ersten, des Zweiten oder Remis.' },
    });
  });

  it('records results idempotently, audits them and never brings an undone one back', async () => {
    const fixtures = sampleEvening();
    installFixtureBackend(fixtures);
    const romme = await gameId('Rommé');
    const persons = await listPersons();
    const tom = persons.find((person) => person.name === 'Tom')?.id ?? 0;
    const id = '2c3d4e5f-6071-4b8c-9d0e-1f2a3b4c5d6e';
    const result = { gameId: romme, personId: tom, points: -20 };
    const put = (key: string, body: object) =>
      fetch(`/api/results/${key}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });

    const created = await put(id, result);
    expect(created.status).toBe(201);
    const { createdAt, ...answered } = (await created.json()) as {
      createdAt: string;
    };
    expect(answered).toEqual({ id, ...result });
    expect((await put(id, result)).status).toBe(200);
    const conflict = await put(id, { ...result, points: 20 });
    expect(conflict.status).toBe(409);
    await expect(conflict.json()).resolves.toMatchObject({
      type: 'urn:performance:problem:request-conflict',
    });
    // The new result waits, so Tom is not ranked on it yet.
    expect(await ranking(romme)).toEqual([
      'Daniel -11 (2) +1',
      'Anna 15 (2)',
      'Ben 39 (2)',
      'Mara 79 (2)',
    ]);
    await expect(standingsOf(romme)).resolves.toMatchObject({
      unranked: [
        { name: 'Jule', pendingCount: 1 },
        { name: 'Tom', pendingCount: 1 },
      ],
    });
    await expect(getGame(romme)).resolves.toMatchObject({ resultCount: 11 });
    await expect(getPerson(tom)).resolves.toMatchObject({ resultCount: 1 });
    const [recorded] = (await newest(1)).map(told);
    expect(recorded).toEqual({
      operation: 'create',
      subjectKind: 'result',
      subjectId: id,
      userName: 'anna',
      before: null,
      after: { game: 'Rommé', person: 'Tom', points: -20, pending: true },
      cause: null,
    });

    await deleteResult(id);
    const replayed = await put(id, result);
    expect(replayed.status).toBe(200);
    // Even after the undo, a replay answers the original instant, like the API.
    await expect(replayed.json()).resolves.toEqual({
      id,
      ...result,
      createdAt,
    });
    await expect(getGame(romme)).resolves.toMatchObject({ resultCount: 10 });
    const [undone] = (await newest(1)).map(told);
    expect(undone).toMatchObject({
      operation: 'delete',
      subjectKind: 'result',
      subjectId: id,
      before: recorded?.after,
      after: null,
    });
    await expect(deleteResult(id)).rejects.toMatchObject({ status: 404 });
    // A UUID is unique across entries, matches and results.
    await expect(
      putMatch(id, {
        gameId: await gameId('Schach'),
        firstPersonId: tom,
        secondPersonId: persons[0]?.id ?? 0,
        outcome: 'first',
      }),
    ).rejects.toMatchObject({ status: 409 });
  });

  it('refuses a result with the API’s validation', async () => {
    installFixtureBackend(sampleEvening());
    const [anna] = await listPersons();
    const result = {
      gameId: await gameId('Rommé'),
      personId: anna?.id ?? 0,
      points: 5,
    };
    let next = 0;
    const record = (body: object) => {
      next += 1;
      return putResult(
        `2c3d4e5f-6071-4b8c-9d0e-${String(next).padStart(12, '0')}`,
        { ...result, ...body },
      );
    };
    const pointsError = 'Ganze Zahl von −9.999 bis 9.999.';

    await expect(record({ gameId: 999 })).rejects.toMatchObject({
      status: 404,
    });
    await expect(
      record({ gameId: await gameId('Schach') }),
    ).rejects.toMatchObject({
      status: 422,
      errors: { gameId: 'Kein Punktespiel.' },
    });
    await expect(record({ personId: 999 })).rejects.toMatchObject({
      status: 422,
      errors: { personId: 'Person nicht gefunden.' },
    });
    for (const points of [10000, -10000, 1.5]) {
      await expect(record({ points })).rejects.toMatchObject({
        status: 422,
        errors: { points: pointsError },
      });
    }
    await expect(record({ points: -9999 })).resolves.toMatchObject({
      points: -9999,
    });
  });

  /** A page of a game's Verlauf as the API answers it, raw. */
  async function historyPage(
    id: number,
    kind: 'matches' | 'results',
    query: string,
  ): Promise<{ items: { id: string }[]; next: string | null }> {
    const response = await fetch(`/api/games/${String(id)}/${kind}?${query}`);
    return (await response.json()) as {
      items: { id: string }[];
      next: string | null;
    };
  }

  it('pages a duel’s matches of its current run newest first, with deleted sides and accounts as null', async () => {
    installFixtureBackend(sampleEvening());
    const schach = await gameId('Schach');

    const all = await listMatches(schach);

    expect(all.next).toBeNull();
    expect(all.items).toHaveLength(9);
    expect(all.items[0]).toMatchObject({
      first: { name: 'Ben' },
      second: { name: 'Anna' },
      outcome: 'draw',
      accountName: 'ben',
    });
    expect(all.items.at(-1)).toMatchObject({
      first: { name: 'Anna' },
      second: { name: 'Ben' },
      outcome: 'first',
      accountName: 'anna',
    });
    expect(all.items.find(({ first }) => first === null)).toMatchObject({
      second: { name: 'Ben' },
      outcome: 'second',
    });
    expect(
      all.items.filter(({ accountName }) => accountName === null),
    ).toHaveLength(1);
    const times = all.items.map(({ createdAt }) => createdAt);
    expect(times).toEqual([...times].sort().reverse());

    const first = await historyPage(schach, 'matches', 'limit=4');
    expect(first.next).not.toBeNull();
    const second = await historyPage(
      schach,
      'matches',
      `limit=4&before=${encodeURIComponent(first.next ?? '')}`,
    );
    const third = await historyPage(
      schach,
      'matches',
      `limit=4&before=${encodeURIComponent(second.next ?? '')}`,
    );
    expect(third.next).toBeNull();
    expect(
      [...first.items, ...second.items, ...third.items].map(({ id }) => id),
    ).toEqual(all.items.map(({ id }) => id));
  });

  it('pages a points game’s results newest first, and keeps a cursor in its run across a restart', async () => {
    installFixtureBackend(sampleEvening());
    const romme = await gameId('Rommé');

    const all = await listResults(romme);
    expect(
      all.items.map(({ person, points }) => [person.name, points]),
    ).toEqual([
      ['Jule', 0],
      ['Daniel', 14],
      ['Mara', 31],
      ['Daniel', 9],
      ['Ben', 27],
      ['Anna', -20],
      ['Mara', 48],
      ['Daniel', -20],
      ['Ben', 12],
      ['Anna', 35],
    ]);
    expect(
      all.items.map(({ accountName, pending }) => [accountName, pending]),
    ).toEqual([
      ['anna', true],
      ['ben', true],
      ...Array<[string, boolean]>(4).fill(['ben', false]),
      ...Array<[string, boolean]>(4).fill(['anna', false]),
    ]);

    const first = await historyPage(romme, 'results', 'limit=3');
    await restart(romme);

    await expect(listResults(romme)).resolves.toEqual({
      items: [],
      next: null,
    });
    const older = await listResults(romme, first.next ?? '');
    expect(older.items.map(({ id }) => id)).toEqual(
      all.items.slice(3).map(({ id }) => id),
    );
  });

  it('refuses a Verlauf of another kind or game, a bad cursor and a bad limit like the API', async () => {
    installFixtureBackend(sampleEvening());
    const schach = await gameId('Schach');
    const romme = await gameId('Rommé');
    const status = (path: string) =>
      fetch(path).then((response) => response.status);

    await expect(listMatches(romme)).rejects.toMatchObject({ status: 404 });
    await expect(listResults(schach)).rejects.toMatchObject({ status: 404 });
    await expect(listMatches(999)).rejects.toMatchObject({ status: 404 });
    // The kind is checked before the query.
    await expect(
      status(`/api/games/${String(romme)}/matches?limit=0`),
    ).resolves.toBe(404);
    await expect(listMatches(schach, 'nonsense')).rejects.toMatchObject({
      status: 422,
      errors: { before: 'Unbekannte Seite.' },
    });
    for (const limit of ['0', '101', 'x']) {
      const response = await fetch(
        `/api/games/${String(schach)}/matches?limit=${limit}`,
      );
      expect(response.status).toBe(422);
      await expect(response.json()).resolves.toMatchObject({
        errors: { limit: '1 bis 100.' },
      });
    }
  });
});
