import { describe, expect, it } from 'vitest';
import type { PendingItem } from '../../core/api-client';
import { pendingRows } from './pending-rows';

const BERLIN = 'Europe/Berlin';

const entry = (change: Partial<PendingItem> = {}): PendingItem => ({
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
});
