import { flushPromises, type VueWrapper } from '@vue/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Account } from '../../core/api-client';
import { forgetSession, resolveSession } from '../../core/session';
import { json, mountPage, problem } from './manage-page-harness';
import VerwaltenPage from './VerwaltenPage.vue';

const named = (count: number) =>
  Array.from({ length: count }, (_, index) => ({
    id: index + 1,
    name: `Name ${String(index + 1)}`,
  }));

/** A server with the given numbers of items, signed in as `account`. */
function server(account: Account, counts: Record<string, number>) {
  const answers: Record<string, () => Response> = {
    '/api/session': () => json(account),
    '/api/persons': () => json({ persons: named(counts.persons ?? 0) }),
    '/api/drinks': () =>
      json({
        drinks: named(counts.drinks ?? 0).map((d) => ({ ...d, points: 1 })),
      }),
    '/api/factors': () =>
      json({
        factors: named(counts.factors ?? 0).map((f) => ({
          ...f,
          multiplier: 2,
        })),
      }),
    '/api/games': () =>
      json({
        games: named(counts.games ?? 0).map((g) => ({
          ...g,
          kind: 'duel',
          drawsAllowed: true,
          lowerWins: false,
          startedAt: '2026-11-01T00:00:00.000Z',
        })),
      }),
    '/api/accounts': () =>
      account.isAdmin
        ? json({
            accounts: named(counts.accounts ?? 0).map(({ id, name }) => ({
              id,
              userName: name,
              isAdmin: false,
            })),
          })
        : problem(403, { title: 'Nur für Admins' }),
  };
  const asked: string[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      asked.push(url);
      return (answers[url] ?? (() => problem(503, { title: 'x' })))();
    }),
  );
  return asked;
}

async function page(): Promise<VueWrapper> {
  await resolveSession();
  const wrapper = await mountPage('/verwalten', VerwaltenPage);
  await flushPromises();
  return wrapper;
}

const rows = (wrapper: VueWrapper) =>
  wrapper.findAll('.list__row').map((row) => row.text());

describe('Verwalten', () => {
  let wrapper: VueWrapper | undefined;

  beforeEach(() => {
    forgetSession();
  });
  afterEach(() => {
    wrapper?.unmount();
    vi.unstubAllGlobals();
  });

  it('lists Personen, Getränke, Faktoren, Spiele and, for admins, Konten with their counts', async () => {
    server(
      { id: 1, userName: 'anna', isAdmin: true },
      { persons: 6, drinks: 1, factors: 2, games: 3, accounts: 4 },
    );

    wrapper = await page();

    expect(rows(wrapper)).toEqual([
      'Personen6 Personen',
      'Getränke1 Getränk',
      'Faktoren2 Faktoren',
      'Spiele3 Spiele',
      'Konten4 Konten',
    ]);
  });

  it('names one of each in the singular', async () => {
    server(
      { id: 1, userName: 'anna', isAdmin: true },
      { persons: 1, drinks: 1, factors: 1, games: 1, accounts: 1 },
    );

    wrapper = await page();

    expect(rows(wrapper)).toEqual([
      'Personen1 Person',
      'Getränke1 Getränk',
      'Faktoren1 Faktor',
      'Spiele1 Spiel',
      'Konten1 Konto',
    ]);
  });

  it('leaves out Konten for others and never asks for accounts', async () => {
    const asked = server(
      { id: 2, userName: 'ben', isAdmin: false },
      { persons: 0, drinks: 3, factors: 0 },
    );

    wrapper = await page();

    expect(rows(wrapper)).toEqual([
      'Personen0 Personen',
      'Getränke3 Getränke',
      'Faktoren0 Faktoren',
      'Spiele0 Spiele',
    ]);
    expect(asked).not.toContain('/api/accounts');
  });
});
