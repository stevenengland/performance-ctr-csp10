import { describe, expect, it } from 'vitest';
import type { Scoreboard } from '../../core/api-client';
import { standingsOf } from './standings';

const board: Scoreboard = {
  rows: [
    {
      personId: 3,
      name: 'Daniel',
      photoUrl: null,
      score: 13.5,
      count: 9,
      drinks: [
        { drinkId: 2, name: 'Bier', count: 4 },
        { drinkId: 3, name: 'Margarita', count: 1.5 },
      ],
    },
    {
      personId: 1,
      name: 'Anna',
      photoUrl: null,
      score: 9,
      count: 6,
      drinks: [{ drinkId: 6, name: 'Wein', count: 6 }],
    },
    {
      personId: 6,
      name: 'Tom',
      photoUrl: null,
      score: 1,
      count: 1,
      drinks: [{ drinkId: 4, name: 'Radler', count: 1 }],
    },
  ],
};

describe('the standings on the Rangliste', () => {
  it('ranks the rows in the order the scoreboard sends them, numbers German-style', () => {
    expect(standingsOf(board)).toEqual([
      {
        personId: 3,
        rank: 1,
        name: 'Daniel',
        score: '13,5',
        count: 9,
        countText: '9 Getränke',
        drinks: 'Bier 4 · Margarita 1,5',
        label: 'Platz 1, Daniel, 13,5 Punkte, 9 Getränke',
      },
      {
        personId: 1,
        rank: 2,
        name: 'Anna',
        score: '9',
        count: 6,
        countText: '6 Getränke',
        drinks: 'Wein 6',
        label: 'Platz 2, Anna, 9 Punkte, 6 Getränke',
      },
      {
        personId: 6,
        rank: 3,
        name: 'Tom',
        score: '1',
        count: 1,
        countText: '1 Getränk',
        drinks: 'Radler 1',
        label: 'Platz 3, Tom, 1 Punkt, 1 Getränk',
      },
    ]);
  });

  it('is empty without entries today', () => {
    expect(standingsOf({ rows: [] })).toEqual([]);
  });
});
