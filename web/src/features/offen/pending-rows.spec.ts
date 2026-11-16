import { describe, expect, it } from 'vitest';
import type { PendingItem } from '../../core/api-client';
import { pendingRows } from './pending-rows';

const BERLIN = 'Europe/Berlin';

type PendingEntry = Extract<PendingItem, { kind: 'entry' }>;
type PendingMatch = Extract<PendingItem, { kind: 'match' }>;

const entry = (change: Partial<PendingEntry> = {}): PendingEntry => ({
  kind: 'entry',
  id: '6f1c2d3e-4a5b-4c6d-8e7f-90a1b2c3d4e5',
  createdAt: '2026-11-15T20:00:00.000Z',
  accountName: 'anna',
  person: { id: 1, name: 'Daniel' },
  drink: { id: 1, name: 'Bier' },
  quantity: 2,
  factor: null,
  ...change,
});

const match = (change: Partial<PendingMatch> = {}): PendingMatch => ({
  kind: 'match',
  id: '0b8f5e3a-1c2d-4e5f-9a0b-1c2d3e4f5a6b',
  createdAt: '2026-11-15T20:00:00.000Z',
  accountName: 'anna',
  game: { id: 1, name: 'Schach' },
  earlierRun: false,
  first: { id: 1, name: 'Anna' },
  second: { id: 2, name: 'Ben' },
  outcome: 'first',
  ...change,
});

describe('the Offen rows', () => {
  it('name an entry by quantity, drink and person, with its factor, day, time and recorder', () => {
    expect(
      pendingRows(
        [entry({ factor: { id: 1, name: 'Happy Hour', multiplier: 2 } })],
        BERLIN,
      ),
    ).toEqual([
      {
        id: '6f1c2d3e-4a5b-4c6d-8e7f-90a1b2c3d4e5',
        kind: 'entry',
        title: '2× Bier für Daniel',
        details: 'Happy Hour ×2 · 15.11., 21:00 · anna',
        verifyLabel: '2× Bier für Daniel bestätigen',
        rejectLabel: '2× Bier für Daniel ablehnen',
      },
    ]);
  });

  it('say Kein Faktor and gelöschtes Konto where they apply', () => {
    const [row] = pendingRows([entry({ accountName: null })], BERLIN);

    expect(row?.details).toBe('Kein Faktor · 15.11., 21:00 · gelöschtes Konto');
  });

  it('name a match by its players and outcome, with its game, day, time and recorder', () => {
    expect(pendingRows([match()], BERLIN)).toEqual([
      {
        id: '0b8f5e3a-1c2d-4e5f-9a0b-1c2d3e4f5a6b',
        kind: 'match',
        title: 'Anna – Ben · Anna gewinnt',
        details: 'Schach · 15.11., 21:00 · anna',
        verifyLabel: 'Anna – Ben · Anna gewinnt bestätigen',
        rejectLabel: 'Anna – Ben · Anna gewinnt ablehnen',
      },
    ]);
  });

  it('mark a match of an earlier run and name a deleted player', () => {
    const [row] = pendingRows(
      [match({ earlierRun: true, first: null, outcome: 'draw' })],
      BERLIN,
    );

    expect([row?.title, row?.details]).toEqual([
      'gelöschte Person – Ben · Remis',
      'Schach · vor dem Neustart · 15.11., 21:00 · anna',
    ]);
  });
});
