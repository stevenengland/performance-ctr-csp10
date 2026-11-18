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
    expect(standingsOf(board, 'factored')).toEqual([
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
    expect(standingsOf({ rows: [], unranked: [] }, 'factored')).toEqual([]);
  });

  it('lists the persons whose entries all wait without a rank, with what they recorded', () => {
    expect(unrankedOf(board, 'factored')).toEqual([
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

  it('counts the pure quantities in the tally, the total and the accessible name without the factors', () => {
    const [leader, second] = standingsOf(board, 'raw');

    expect([leader, second]).toMatchObject([
      {
        count: 5,
        countText: '5 Getränke',
        label: 'Platz 1, Daniel, 13,5 Punkte, 5 Getränke, +2 offen',
      },
      {
        count: 6,
        countText: '6 Getränke',
        label: 'Platz 2, Anna, 9 Punkte, 6 Getränke',
      },
    ]);
  });

  it('shows one line per drink with its pure count, or its factored count by default', () => {
    const bier = {
      drinkId: 2,
      name: 'Bier',
      count: 22,
      recordedCount: 22,
      rawCount: 6,
      rawRecordedCount: 6,
    };
    const ben: Scoreboard = {
      rows: [
        {
          personId: 7,
          name: 'Ben',
          photoUrl: null,
          score: 22,
          count: 22,
          rawCount: 6,
          pendingCount: 0,
          drinks: [bier],
        },
      ],
      unranked: [],
    };

    const drinks = (['raw', 'factored'] as const).map(
      (counting) => standingsOf(ben, counting)[0]?.drinks,
    );

    expect(drinks).toEqual(['Bier 6', 'Bier 22']);
  });

  it('keeps the score, the rank and the order of the factored standings', () => {
    const shape = (counting: 'factored' | 'raw') =>
      standingsOf(board, counting).map(({ personId, rank, score }) => ({
        personId,
        rank,
        score,
      }));

    expect(shape('raw')).toEqual(shape('factored'));
  });

  it('lists what the waiting persons recorded without the factors, with the same pending hint', () => {
    const jule: Scoreboard = {
      rows: [],
      unranked: [
        {
          personId: 4,
          name: 'Jule',
          photoUrl: null,
          pendingCount: 2,
          drinks: [
            {
              drinkId: 2,
              name: 'Bier',
              count: 0,
              recordedCount: 10,
              rawCount: 0,
              rawRecordedCount: 2,
            },
          ],
        },
      ],
    };

    expect(unrankedOf(jule, 'raw')).toEqual([
      {
        personId: 4,
        name: 'Jule',
        photoUrl: null,
        drinks: 'Bier 2',
        pending: '+2 offen',
        label: 'Jule, Bier 2, +2 offen',
      },
    ]);
  });
});
