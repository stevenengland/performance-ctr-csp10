import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';
import { createAppVuetify } from '../../theme';
import GameStandingList from './GameStandingList.vue';
import type { GameStanding } from './game-view';

const standing = (
  rank: number,
  name: string,
  value: string,
  details: string,
): GameStanding => ({
  personId: rank,
  rank,
  name,
  value,
  valueText: `${value} Punkte`,
  details,
  label: `Platz ${String(rank)}, ${name}`,
});

function list(standings: GameStanding[]) {
  return mount(GameStandingList, {
    props: { standings, label: 'Schach' },
    global: { plugins: [createAppVuetify()] },
  });
}

describe('a game’s ranking list', () => {
  it('puts the leader on the amber card and everyone else in ranked rows', () => {
    const wrapper = list([
      standing(1, 'Anna', '3,5', '5 Partien · 3 S · 1 R · 1 N'),
      standing(2, 'Ben', '2', '4 Partien · 2 S · 0 R · 2 N'),
      standing(3, 'Tom', '0,5', '3 Partien · 0 S · 1 R · 2 N'),
    ]);

    expect(wrapper.get('ol').attributes('aria-label')).toBe('Schach');
    const leader = wrapper.get('.game-leader');
    expect(leader.text()).toContain('Anna');
    expect(leader.get('.game-leader__value').text()).toBe('3,5');
    expect(leader.text()).toContain('3,5 Punkte');
    expect(leader.text()).toContain('5 Partien · 3 S · 1 R · 1 N');
    expect(leader.attributes('aria-label')).toBe('Platz 1, Anna');

    const rows = wrapper.findAll('.game-rank');
    expect(
      rows.map((row) => [
        row.get('.game-rank__position').text(),
        row.get('.game-rank__name').text(),
        row.get('.game-rank__details').text(),
        row.get('.game-rank__value').text(),
      ]),
    ).toEqual([
      ['2', 'Ben', '4 Partien · 2 S · 0 R · 2 N', '2'],
      ['3', 'Tom', '3 Partien · 0 S · 1 R · 2 N', '0,5'],
    ]);
  });
});
