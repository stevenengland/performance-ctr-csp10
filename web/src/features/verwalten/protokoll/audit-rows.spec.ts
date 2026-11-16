import { describe, expect, it } from 'vitest';
import { auditDays, type AuditEventView } from './audit-rows';

const BERLIN = 'Europe/Berlin';
/** Sunday, 15 November 2026, 23:45 in Berlin. */
const NOW = new Date('2026-11-15T22:45:00Z');

let nextId = 100;

/** An event as the API sends it: a direct change by `anna` at 23:41 today unless given otherwise. */
function event(change: Partial<AuditEventView>): AuditEventView {
  nextId += 1;
  return {
    id: nextId,
    occurredAt: '2026-11-15T22:41:00.000Z',
    operation: 'update',
    subjectKind: 'drink',
    actor: { userName: 'anna' },
    before: null,
    after: null,
    cause: null,
    ...change,
  };
}

const rowsOf = (events: AuditEventView[]) =>
  auditDays(events, NOW, BERLIN).flatMap((day) => day.rows);

const only = (change: Partial<AuditEventView>) => {
  const [row] = rowsOf([event(change)]);
  if (!row) throw new Error('no row');
  return row;
};

const beer = { person: 'Daniel', drink: 'Bier', points: 1, quantity: 2 };

describe('the Protokoll rows', () => {
  it('names the subject by its kind and name, and an entry by quantity, drink and person', () => {
    expect(
      only({
        subjectKind: 'drink',
        operation: 'create',
        after: { name: 'Bier', points: 1 },
      }).title,
    ).toBe('Getränk Bier');
    expect(
      only({
        subjectKind: 'person',
        operation: 'delete',
        before: { name: 'Jule' },
      }).title,
    ).toBe('Person Jule');
    expect(
      only({
        subjectKind: 'factor',
        operation: 'create',
        after: { name: 'Happy Hour', multiplier: 2 },
      }).title,
    ).toBe('Faktor Happy Hour');
    expect(
      only({
        subjectKind: 'entry',
        operation: 'create',
        after: { ...beer, factor: null },
      }).title,
    ).toBe('Eintrag 2× Bier für Daniel');
  });

  it('names a game Spiel with its name', () => {
    expect(
      only({
        subjectKind: 'game',
        operation: 'create',
        after: { name: 'Schach' },
      }).title,
    ).toBe('Spiel Schach');
  });

  const schach = {
    name: 'Schach',
    kind: 'duel',
    drawsAllowed: true,
    run: 1,
    startedAt: '2026-09-15T18:00:00.000Z',
  } as const;
  const romme = {
    name: 'Rommé',
    kind: 'points',
    lowerWins: false,
    run: 1,
    startedAt: '2026-09-15T18:00:00.000Z',
  } as const;

  it('shows a created or deleted game with its kind and rule', () => {
    expect(
      only({ subjectKind: 'game', operation: 'create', after: schach }).changes,
    ).toBe('Duell · Remis möglich');
    expect(
      only({
        subjectKind: 'game',
        operation: 'delete',
        before: { ...romme, lowerWins: true },
      }).changes,
    ).toBe('Punktespiel · Niedrigste Summe gewinnt');
  });

  it('shows a changed rule of a game as before → after', () => {
    expect(
      only({
        subjectKind: 'game',
        before: schach,
        after: { ...schach, drawsAllowed: false },
      }).changes,
    ).toBe('Regel: Remis möglich → kein Remis');
    expect(
      only({
        subjectKind: 'game',
        before: romme,
        after: { ...romme, lowerWins: true },
      }).changes,
    ).toBe('Regel: Höchste Summe gewinnt → Niedrigste Summe gewinnt');
  });

  it('shows a restarted game as Neu gestartet, apart from a change of its rule', () => {
    const restarted = only({
      subjectKind: 'game',
      before: romme,
      after: { ...romme, run: 2, startedAt: '2026-11-15T18:30:00.000Z' },
    });

    expect([restarted.title, restarted.changes]).toEqual([
      'Spiel Rommé',
      'Neu gestartet',
    ]);
  });

  it('shows a match side cleared by a person deletion as that change, the same for every outcome', () => {
    const cleared = (outcome: 'first' | 'second' | 'draw') =>
      only({
        subjectKind: 'match',
        before: { game: 'Schach', first: 'Ben', second: 'Anna', outcome },
        after: { game: 'Schach', first: null, second: 'Anna', outcome },
        cause: { name: 'Ben' },
      });

    for (const outcome of ['first', 'second', 'draw'] as const) {
      expect([cleared(outcome).title, cleared(outcome).changes]).toEqual([
        'Partie Ben – Anna',
        'Ben → gelöschte Person',
      ]);
    }
  });

  it('names an event of a subject kind it does not know by its name only', () => {
    expect(
      only({
        subjectKind: 'tournament' as AuditEventView['subjectKind'],
        operation: 'create',
        after: { name: 'Sommer' },
      }).title,
    ).toBe('Sommer');
  });

  it('names a match Partie with both persons, and shows its game and outcome', () => {
    const recorded = only({
      subjectKind: 'match',
      operation: 'create',
      after: { game: 'Schach', first: 'Anna', second: 'Ben', outcome: 'first' },
    });
    const removed = only({
      subjectKind: 'match',
      operation: 'delete',
      before: { game: 'Schach', first: null, second: 'Ben', outcome: 'draw' },
    });

    expect([recorded.title, recorded.changes]).toEqual([
      'Partie Anna – Ben',
      'Schach · Anna gewinnt',
    ]);
    expect([removed.title, removed.changes]).toEqual([
      'Partie gelöschte Person – Ben',
      'Schach · Remis',
    ]);
  });

  it('names a result Ergebnis with its person, and shows its game and signed points', () => {
    const recorded = only({
      subjectKind: 'result',
      operation: 'create',
      after: { game: 'Rommé', person: 'Daniel', points: -20 },
    });
    const removed = only({
      subjectKind: 'result',
      operation: 'delete',
      before: { game: 'Kniffel', person: 'Anna', points: 1 },
    });

    expect([recorded.title, recorded.changes]).toEqual([
      'Ergebnis Daniel',
      'Rommé · −20 Punkte',
    ]);
    expect([removed.title, removed.changes]).toEqual([
      'Ergebnis Anna',
      'Kniffel · 1 Punkt',
    ]);
  });

  it('labels the operation Angelegt, Geändert or Gelöscht', () => {
    const labels = (['create', 'update', 'delete'] as const).map(
      (operation) =>
        only({
          operation,
          before: operation === 'create' ? null : { name: 'Bier', points: 1 },
          after: operation === 'delete' ? null : { name: 'Bier', points: 2 },
        }).operationLabel,
    );

    expect(labels).toEqual(['Angelegt', 'Geändert', 'Gelöscht']);
  });

  it('shows each changed value of an update as before → after, in German number format', () => {
    expect(
      only({
        before: { name: 'Bier', points: 1 },
        after: { name: 'Bier', points: 0.5 },
      }).changes,
    ).toBe('Punkte: 1 Punkt → 0,5 Punkte');
    expect(
      only({
        subjectKind: 'factor',
        before: { name: 'Happy Hour', multiplier: 2 },
        after: { name: 'Doppelt', multiplier: 1.5 },
      }).changes,
    ).toBe('Name: Happy Hour → Doppelt · Multiplikator: ×2 → ×1,5');
    expect(
      only({
        subjectKind: 'person',
        before: { name: 'Dani' },
        after: { name: 'Daniel' },
      }).title,
    ).toBe('Person Daniel');
  });

  it('shows an entry losing its factor as Faktor: … → Kein Faktor', () => {
    expect(
      only({
        subjectKind: 'entry',
        before: { ...beer, factor: { name: 'Happy Hour', multiplier: 2 } },
        after: { ...beer, factor: null },
      }).changes,
    ).toBe('Faktor: Happy Hour ×2 → Kein Faktor');
  });

  it('shows the values of a created or deleted subject, leaving out its name and an absent factor', () => {
    expect(
      only({ operation: 'create', after: { name: 'Bier', points: 1 } }).changes,
    ).toBe('1 Punkt');
    expect(
      only({
        subjectKind: 'entry',
        operation: 'delete',
        before: { ...beer, factor: { name: 'Happy Hour', multiplier: 2 } },
      }).changes,
    ).toBe('1 Punkt · Happy Hour ×2');
    expect(
      only({
        subjectKind: 'entry',
        operation: 'create',
        after: { ...beer, factor: null },
      }).changes,
    ).toBe('1 Punkt');
    expect(
      only({
        subjectKind: 'person',
        operation: 'create',
        after: { name: 'Jule' },
      }).changes,
    ).toBe('');
  });

  it('shows a person’s photo change as Foto gesetzt, geändert or entfernt, never its version', () => {
    const first = 'a'.repeat(64);
    const second = 'b'.repeat(64);
    const photoChange = (before: string | null, after: string | null) =>
      only({
        subjectKind: 'person',
        before: { name: 'Anna', photo: before },
        after: { name: 'Anna', photo: after },
      });

    expect(photoChange(null, first).changes).toBe('Foto gesetzt');
    expect(photoChange(first, second).changes).toBe('Foto geändert');
    expect(photoChange(second, null).changes).toBe('Foto entfernt');
    const row = photoChange(first, second);
    expect(row.title).toBe('Person Anna');
    expect(JSON.stringify(row)).not.toMatch(/aaaa|bbbb/);
  });

  it('shows a rename that kept the photo as the name change only, and an event without a photo key as before', () => {
    const version = 'c'.repeat(64);

    expect(
      only({
        subjectKind: 'person',
        before: { name: 'Dani', photo: version },
        after: { name: 'Daniel', photo: version },
      }).changes,
    ).toBe('Name: Dani → Daniel');
    expect(
      only({
        subjectKind: 'person',
        before: { name: 'Dani' },
        after: { name: 'Daniel' },
      }).changes,
    ).toBe('Name: Dani → Daniel');
    // A key one side lacks is unknown, so nothing is said about the photo.
    expect(
      only({
        subjectKind: 'person',
        before: { name: 'Dani' },
        after: { name: 'Daniel', photo: version },
      }).changes,
    ).toBe('Name: Dani → Daniel');
    expect(
      only({
        subjectKind: 'person',
        before: { name: 'Dani', photo: null },
        after: { name: 'Daniel', photo: version },
      }).changes,
    ).toBe('Name: Dani → Daniel · Foto gesetzt');
    expect(
      only({
        subjectKind: 'person',
        operation: 'create',
        after: { name: 'Jule', photo: null },
      }).changes,
    ).toBe('');
    expect(
      only({
        subjectKind: 'person',
        operation: 'delete',
        before: { name: 'Jule', photo: version },
      }).changes,
    ).toBe('');
  });

  it('treats a snapshot key it does not get as unknown', () => {
    const row = only({
      subjectKind: 'factor',
      before: { name: 'Happy Hour' },
      after: { name: 'Happy Hour', multiplier: 2 },
    });

    expect(row.changes).toBe('');
  });

  it('names a created or deleted subject from the keys it gets only, never with a made-up quantity or an empty name', () => {
    const entry = (snapshot: AuditEventView['before']) =>
      only({ subjectKind: 'entry', operation: 'delete', before: snapshot })
        .title;
    const person = (snapshot: AuditEventView['before']) =>
      only({ subjectKind: 'person', operation: 'delete', before: snapshot })
        .title;

    expect(entry({ person: 'Daniel', drink: 'Bier' })).toBe(
      'Eintrag Bier für Daniel',
    );
    expect(entry({ quantity: 2 })).toBe('Eintrag 2×');
    expect(entry({ quantity: 2, person: 'Daniel' })).toBe(
      'Eintrag 2× für Daniel',
    );
    expect(entry({ drink: 'Bier', quantity: 2 })).toBe('Eintrag 2× Bier');
    expect(entry({})).toBe('Eintrag');
    expect(person({})).toBe('Person');
    expect(
      only({ subjectKind: 'drink', operation: 'create', after: { points: 1 } }),
    ).toMatchObject({ title: 'Getränk', changes: '1 Punkt' });
  });

  it('shows a factor of an entry with the factor keys it gets only', () => {
    expect(
      only({
        subjectKind: 'entry',
        operation: 'create',
        after: { ...beer, factor: { name: 'Happy Hour' } },
      }).changes,
    ).toBe('1 Punkt · Happy Hour');
    expect(
      only({
        subjectKind: 'entry',
        operation: 'create',
        after: { ...beer, factor: {} },
      }).changes,
    ).toBe('1 Punkt');
  });

  it('gives the local time and the user name the event recorded', () => {
    expect(
      only({
        occurredAt: '2026-11-15T20:05:00.000Z',
        actor: { userName: 'mara' },
        after: { name: 'Bier', points: 1 },
        operation: 'create',
      }).by,
    ).toBe('21:05 · mara');
  });

  it('names the cause of a consequential event from the event itself and marks the row as caused', () => {
    const caused = only({
      subjectKind: 'entry',
      operation: 'delete',
      before: { ...beer, factor: null },
      cause: { name: 'Wein' },
    });
    const direct = only({
      operation: 'create',
      after: { name: 'Bier', points: 1 },
    });

    expect(caused.cause).toBe('durch Löschen von Wein');
    expect(direct.cause).toBeUndefined();
  });

  it('groups the events newest first under Heute, Gestern and the date, in the given time zone', () => {
    const at = (occurredAt: string) =>
      event({
        occurredAt,
        operation: 'create',
        after: { name: 'Bier', points: 1 },
      });
    const events = [
      at('2026-11-15T23:30:00.000Z'), // Monday 00:30 in Berlin, still Sunday in UTC
      at('2026-11-14T23:10:00.000Z'), // Sunday 00:10 in Berlin
      at('2026-11-14T22:50:00.000Z'), // Saturday 23:50 in Berlin
      at('2026-11-14T08:00:00.000Z'),
      at('2026-11-12T19:00:00.000Z'),
    ];

    const days = auditDays(events, new Date('2026-11-16T07:00:00Z'), BERLIN);

    expect(
      days.map((day) => [day.label, day.rows.map((row) => row.id)]),
    ).toEqual([
      ['Heute', [events[0]?.id]],
      ['Gestern', [events[1]?.id]],
      ['Sa., 14.11.2026', [events[2]?.id, events[3]?.id]],
      ['Do., 12.11.2026', [events[4]?.id]],
    ]);
  });

  it('counts calendar days across a change of daylight saving time', () => {
    const days = auditDays(
      [
        event({
          occurredAt: '2026-10-24T22:30:00.000Z', // Sunday 25 October 00:30, still summer time
          operation: 'create',
          after: { name: 'Bier', points: 1 },
        }),
      ],
      new Date('2026-10-25T23:30:00Z'), // Monday 26 October 00:30, winter time
      BERLIN,
    );

    expect(days.map((day) => day.label)).toEqual(['Gestern']);
  });

  it('has no days for no events', () => {
    expect(auditDays([], NOW, BERLIN)).toEqual([]);
  });
});
