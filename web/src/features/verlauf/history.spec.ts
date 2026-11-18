import { describe, expect, it } from 'vitest';
import type { HistoryEntry } from '../../core/api-client';
import type { CalendarDate } from '../../core/period';
import { dayOfTag, historyRows, verlaufPath } from './history';

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
  it('show quantity and drink, the factor with its German multiplier, the local day and time and the account', () => {
    expect(historyRows([entry], 'Europe/Berlin')).toEqual([
      {
        id: 'e1',
        title: '2× Bier',
        details: 'Geburtstag ×1,5 · 15.11., 23:41 · anna',
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

    expect(row?.details).toBe('Kein Faktor · 15.11., 16:41 · gelöschtes Konto');
    expect(row?.removeBody).toBe('2× Bier um 16:41');
  });

  it('show the local day where it differs from the UTC day, and name the time only to delete', () => {
    const [row] = historyRows(
      [{ ...entry, createdAt: '2026-11-15T23:30:00.000Z' }],
      'Europe/Berlin',
    );

    expect(row?.details).toBe('Geburtstag ×1,5 · 16.11., 00:30 · anna');
    expect(row?.removeLabel).toBe('2× Bier um 00:30 löschen');
    expect(row?.removeBody).toBe('2× Bier · Geburtstag ×1,5 um 00:30');
  });
});

describe('the Verlauf of a day', () => {
  const today: CalendarDate = { year: 2026, month: 11, day: 16 };

  it('is reached by the person alone for today, and with the day as `tag` for a past day', () => {
    expect(verlaufPath(3)).toBe('/verlauf/3');
    expect(verlaufPath(3, { year: 2026, month: 3, day: 4 })).toBe(
      '/verlauf/3?tag=2026-03-04',
    );
  });

  it('shows the past day its `tag` names, as a calendar date', () => {
    expect(dayOfTag('2026-11-15', today)).toEqual({
      year: 2026,
      month: 11,
      day: 15,
    });
    expect(dayOfTag('2025-12-31', today)).toEqual({
      year: 2025,
      month: 12,
      day: 31,
    });
  });

  it.each([
    ['no tag', undefined],
    ['today', '2026-11-16'],
    ['a future day', '2026-11-17'],
    ['an impossible date', '2026-02-30'],
    ['a month 13', '2026-13-01'],
    ['no date', 'gestern'],
    ['a date with a time', '2026-11-15T20:00'],
    ['a date without leading zeros', '2026-11-1'],
    ['a list', ['2026-11-15']],
  ])('shows today for %s', (_case, tag) => {
    expect(dayOfTag(tag, today)).toEqual(today);
  });
});
