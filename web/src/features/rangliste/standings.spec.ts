import { describe, expect, it } from 'vitest';
import type { Scoreboard } from '../../core/api-client';
import { standingsOf, unrankedOf } from './standings';

const board: Scoreboard = {
  rows: [
    {
      personId: 3,
      name: 'Daniel',
      photoUrl: '/api/persons/3/photo?v=d1',
      score: 13.5,
      count: 9,
      rawCount: 5,
      pendingCount: 2,
      drinks: [
        {
          drinkId: 1,
          name: 'Aperol',
          count: 0,
          recordedCount: 1,
          rawCount: 0,
          rawRecordedCount: 1,
        },
        {
          drinkId: 2,
          name: 'Bier',
          count: 4,
          recordedCount: 5,
          rawCount: 4,
          rawRecordedCount: 5,
        },
        {
          drinkId: 3,
          name: 'Margarita',
          count: 1.5,
          recordedCount: 1.5,
          rawCount: 1,
          rawRecordedCount: 1,
        },
      ],
    },
    {
      personId: 1,
      name: 'Anna',
      photoUrl: null,
      score: 9,
      count: 6,
      rawCount: 6,
      pendingCount: 0,
      drinks: [
        {
          drinkId: 6,
          name: 'Wein',
          count: 6,
          recordedCount: 6,
          rawCount: 6,
          rawRecordedCount: 6,
        },
      ],
    },
    {
      personId: 6,
      name: 'Tom',
      photoUrl: null,
      score: 1,
      count: 1,
      rawCount: 1,
      pendingCount: 0,
      drinks: [
        {
          drinkId: 4,
          name: 'Radler',
          count: 1,
          recordedCount: 1,
          rawCount: 1,
          rawRecordedCount: 1,
        },
      ],
    },
  ],
  unranked: [
    {
      personId: 4,
      name: 'Jule',
      photoUrl: null,
      pendingCount: 2,
      drinks: [
        {
          drinkId: 1,
          name: 'Aperol',
          count: 0,
          recordedCount: 1,
          rawCount: 0,
          rawRecordedCount: 1,
        },
        {
          drinkId: 2,
          name: 'Bier',
          count: 0,
          recordedCount: 2,
          rawCount: 0,
          rawRecordedCount: 2,
        },
      ],
    },
  ],
};

describe('the standings on the Rangliste', () => {
  it('ranks the rows in the order the scoreboard sends them, with their photos, numbers German-style, counting verified drinks and hinting at pending ones', () => {
    expect(standingsOf(board)).toEqual([
      {
        personId: 3,
        rank: 1,
        name: 'Daniel',
        photoUrl: '/api/persons/3/photo?v=d1',
        score: '13,5',
        count: 9,
        countText: '9 Getränke',
        drinks: 'Bier 4 · Margarita 1,5',
        pending: '+2 offen',
        label: 'Platz 1, Daniel, 13,5 Punkte, 9 Getränke, +2 offen',
      },
      {
        personId: 1,
        rank: 2,
        name: 'Anna',
        photoUrl: null,
        score: '9',
        count: 6,
        countText: '6 Getränke',
        drinks: 'Wein 6',
        pending: undefined,
        label: 'Platz 2, Anna, 9 Punkte, 6 Getränke',
      },
      {
        personId: 6,
        rank: 3,
        name: 'Tom',
        photoUrl: null,
        score: '1',
        count: 1,
        countText: '1 Getränk',
        drinks: 'Radler 1',
        pending: undefined,
        label: 'Platz 3, Tom, 1 Punkt, 1 Getränk',
      },
    ]);
  });

  it('is empty without entries today', () => {
    expect(standingsOf({ rows: [], unranked: [] })).toEqual([]);
  });

  it('lists the persons whose entries all wait without a rank, with what they recorded', () => {
    expect(unrankedOf(board)).toEqual([
      {
        personId: 4,
        name: 'Jule',
        photoUrl: null,
        drinks: 'Aperol 1 · Bier 2',
        pending: '+2 offen',
        label: 'Jule, Aperol 1 · Bier 2, +2 offen',
      },
    ]);
  });
});
