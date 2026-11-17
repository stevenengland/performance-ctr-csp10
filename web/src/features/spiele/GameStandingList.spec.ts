import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';
import { createAppVuetify } from '../../theme';
import GameStandingList from './GameStandingList.vue';
import type { GameStanding, UnrankedGameStanding } from './game-view';

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
  short: details,
  label: `Platz ${String(rank)}, ${name}`,
});

function list(
  standings: GameStanding[],
  unranked: UnrankedGameStanding[] = [],
) {
  return mount(GameStandingList, {
    props: { standings, unranked, label: 'Schach' },
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

  it('shows +n offen on the card and in a row while rows of the run wait', () => {
    const wrapper = list([
      {
        ...standing(1, 'Anna', '1', '1 Partie · 1 S · 0 R · 0 N'),
        pending: '+1 offen',
      },
      {
        ...standing(2, 'Ben', '0', '1 Partie · 0 S · 0 R · 1 N'),
        pending: '+2 offen',
      },
      standing(3, 'Tom', '0', '1 Partie · 0 S · 0 R · 1 N'),
    ]);

    expect(wrapper.get('.game-leader').text()).toContain('+1 offen');
    expect(
      wrapper
        .findAll('.game-rank')
        .map(
          (row) =>
            row.find('.assist-chip').exists() && row.get('.assist-chip').text(),
        ),
    ).toEqual(['+2 offen', false]);
  });

  it('lists the persons whose rows all wait under Noch nicht gewertet, without rank or value', () => {
    const wrapper = list(
      [standing(1, 'Anna', '1', '1 Partie · 1 S · 0 R · 0 N')],
      [
        {
          personId: 4,
          name: 'Jule',
          pending: '+2 offen',
          label: 'Jule, +2 offen',
        },
      ],
    );

    expect(wrapper.get('h2').text()).toBe('Noch nicht gewertet');
    const unranked = wrapper.get('[data-test="game-unranked"]');
    expect(unranked.attributes('aria-label')).toBe('Jule, +2 offen');
    expect(unranked.get('.game-rank__position').text()).toBe('');
    expect(unranked.text()).toContain('Jule');
    expect(unranked.get('.assist-chip').text()).toBe('+2 offen');
    expect(unranked.find('.game-rank__value').exists()).toBe(false);
  });

  it('shows no leader when every person of the run waits', () => {
    const wrapper = list(
      [],
      [
        {
          personId: 4,
          name: 'Jule',
          pending: '+1 offen',
          label: 'Jule, +1 offen',
        },
      ],
    );

    expect(wrapper.find('.game-leader').exists()).toBe(false);
    expect(wrapper.findAll('[data-test="game-unranked"]')).toHaveLength(1);
  });
});
