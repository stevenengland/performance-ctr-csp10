import { describe, expect, it } from 'vitest';
import type { HistoryEntry } from '../../core/api-client';
import { historyRows } from './history';

const entry: HistoryEntry = {
  id: 'e1',
  drink: { id: 2, name: 'Bier' },
  quantity: 2,
  factor: { id: 1, name: 'Geburtstag', multiplier: 1.5 },
  createdAt: '2026-11-15T22:41:00.000Z',
  accountName: 'anna',
  pending: false,
};

describe('Verlauf rows', () => {
  it('show quantity and drink, the factor with its German multiplier, the local time and the account', () => {
    expect(historyRows([entry], 'Europe/Berlin')).toEqual([
      {
        id: 'e1',
        title: '2× Bier',
        details: 'Geburtstag ×1,5 · 23:41 · anna',
        removeLabel: '2× Bier um 23:41 löschen',
        removeBody: '2× Bier · Geburtstag ×1,5 um 23:41',
        pending: undefined,
      },
    ]);
  });

  it('mark an entry that waits for verification as offen', () => {
    const [row] = historyRows([{ ...entry, pending: true }], 'Europe/Berlin');

    expect(row?.pending).toBe('offen');
  });

  it('say “Kein Faktor” and “gelöschtes Konto” where they apply, and leave the factor out of the dialog', () => {
    const [row] = historyRows(
      [{ ...entry, factor: null, accountName: null }],
      'America/Mexico_City',
    );

    expect(row?.details).toBe('Kein Faktor · 16:41 · gelöschtes Konto');
    expect(row?.removeBody).toBe('2× Bier um 16:41');
  });
});
