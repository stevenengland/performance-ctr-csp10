import { flushPromises, type VueWrapper } from '@vue/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PendingItem } from '../../core/api-client';
import { dismissSnackbar, useSnackbar } from '../../core/snackbar';
import {
  buttonIn,
  click,
  json,
  mountPage,
  problem,
  rows,
} from '../verwalten/manage-page-harness';
import OffenPage from './OffenPage.vue';

const OWN_ROW = {
  type: 'urn:performance:problem:own-row',
  title: 'Das muss ein anderes Konto bestätigen.',
};
const ALREADY_VERIFIED = {
  type: 'urn:performance:problem:already-verified',
  title: 'Wurde schon bestätigt.',
};
const NOT_FOUND = {
  type: 'urn:performance:problem:not-found',
  title: 'Nicht gefunden',
};

function entry(n: number, person = 'Daniel'): PendingItem {
  return {
    kind: 'entry',
    id: `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`,
    createdAt: '2026-11-15T20:00:00.000Z',
    accountName: 'anna',
    person: { id: n, name: person },
    drink: { id: 1, name: 'Bier' },
    quantity: n,
    factor: null,
  };
}

type Reply = () => Response | Promise<Response>;

/**
A fake API over the queue: the first page holds `pageSize` rows, a cursor `p<n>`
reads on from the n-th row; a verification or rejection takes the next given
reply or succeeds and removes the row. The scoreboard answers empty.
*/
function api(
  queue: PendingItem[],
  { pageSize = 20, replies = [] as Reply[] } = {},
) {
  const verified: string[] = [];
  const rejected: string[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init: RequestInit) => {
      const { pathname, searchParams } = new URL(url, 'http://app');
      if (pathname === '/api/scoreboard')
        return json({ rows: [], unranked: [] });
      if (pathname === '/api/pending') {
        const from = Number(searchParams.get('cursor')?.slice(1) ?? 0);
        const end = from + pageSize;
        return json({
          items: queue.slice(from, end),
          next: end < queue.length ? `p${String(end)}` : null,
          count: queue.length,
        });
      }
      const id = /\/api\/entries\/([^/]+)\/verification$/.exec(pathname)?.[1];
      const decided = { PUT: verified, DELETE: rejected }[init.method ?? ''];
      if (!decided || !id) throw new Error(`unexpected ${url}`);
      const reply = replies.shift();
      if (reply) return reply();
      decided.push(id);
      queue.splice(
        queue.findIndex((item) => item.id === id),
        1,
      );
      return new Response(null, { status: 204 });
    }),
  );
  return { verified, rejected };
}

const snackbar = useSnackbar();

describe('Offen', () => {
  let wrapper: VueWrapper | undefined;
  let online = true;

  beforeEach(() => {
    dismissSnackbar();
    online = true;
    Object.defineProperty(navigator, 'onLine', {
      configurable: true,
      get: () => online,
    });
  });
  afterEach(() => {
    wrapper?.unmount();
    document.body.innerHTML = '';
    vi.unstubAllGlobals();
  });

  it('lists the rows the account may verify, each with Ablehnen and Bestätigen', async () => {
    api([entry(2), entry(1, 'Jule')]);

    wrapper = await mountPage('/offen', OffenPage);

    expect(rows(wrapper)).toEqual([
      expect.stringContaining('2× Bier für Daniel'),
      expect.stringContaining('1× Bier für Jule'),
    ]);
    expect(
      buttonIn(document, '2× Bier für Daniel bestätigen').textContent,
    ).toContain('Bestätigen');
    expect(
      buttonIn(document, '2× Bier für Daniel ablehnen').textContent,
    ).toContain('Ablehnen');
  });

  it('says so when there is nothing to verify', async () => {
    api([]);

    wrapper = await mountPage('/offen', OffenPage);

    expect(wrapper.text()).toContain('Nichts zu bestätigen.');
  });

  it('verifies a row with Bestätigen and removes it', async () => {
    const { verified } = api([entry(2), entry(1)]);
    wrapper = await mountPage('/offen', OffenPage);

    await click(buttonIn(document, '2× Bier für Daniel bestätigen'));

    expect(verified).toEqual([entry(2).id]);
    expect(rows(wrapper)).toEqual([
      expect.stringContaining('1× Bier für Daniel'),
    ]);
    expect(snackbar.value).toBeUndefined();
  });

  it('removes a row that is gone already (404) as handled, without an error', async () => {
    const queue = [entry(2), entry(1)];
    api(queue, {
      replies: [
        () => {
          // Deleted on another phone meanwhile.
          queue.shift();
          return problem(404, {
            type: 'urn:performance:problem:not-found',
            title: 'Nicht gefunden',
          });
        },
      ],
    });
    wrapper = await mountPage('/offen', OffenPage);

    await click(buttonIn(document, '2× Bier für Daniel bestätigen'));

    expect(rows(wrapper)).toEqual([
      expect.stringContaining('1× Bier für Daniel'),
    ]);
    expect(snackbar.value).toBeUndefined();
  });

  it('keeps a row the server refuses (403) and shows why', async () => {
    api([entry(2)], { replies: [() => problem(403, OWN_ROW)] });
    wrapper = await mountPage('/offen', OffenPage);

    await click(buttonIn(document, '2× Bier für Daniel bestätigen'));

    expect(rows(wrapper)).toHaveLength(1);
    expect(snackbar.value?.text).toBe(OWN_ROW.title);
  });

  it('keeps a row without an answer and says it was not verified', async () => {
    api([entry(2)], {
      replies: [() => Promise.reject(new TypeError('Failed to fetch'))],
    });
    wrapper = await mountPage('/offen', OffenPage);

    await click(buttonIn(document, '2× Bier für Daniel bestätigen'));

    expect(rows(wrapper)).toHaveLength(1);
    expect(snackbar.value?.text).toBe('Nicht bestätigt – keine Verbindung');
  });

  it('blocks Bestätigen while offline, like saving', async () => {
    const { verified } = api([entry(2)]);
    online = false;
    wrapper = await mountPage('/offen', OffenPage);

    const button = buttonIn(document, '2× Bier für Daniel bestätigen');
    await click(button);

    expect(button.disabled).toBe(true);
    expect(verified).toEqual([]);
  });

  it('treats a 409 on Bestätigen as an error, not as handled', async () => {
    api([entry(2)], { replies: [() => problem(409, ALREADY_VERIFIED)] });
    wrapper = await mountPage('/offen', OffenPage);

    await click(buttonIn(document, '2× Bier für Daniel bestätigen'));

    expect(rows(wrapper)).toHaveLength(1);
    expect(snackbar.value?.text).toBe(ALREADY_VERIFIED.title);
  });

  it('rejects a row with Ablehnen and removes it', async () => {
    const { rejected, verified } = api([entry(2), entry(1)]);
    wrapper = await mountPage('/offen', OffenPage);

    await click(buttonIn(document, '2× Bier für Daniel ablehnen'));

    expect(rejected).toEqual([entry(2).id]);
    expect(verified).toEqual([]);
    expect(rows(wrapper)).toEqual([
      expect.stringContaining('1× Bier für Daniel'),
    ]);
    expect(snackbar.value).toBeUndefined();
  });

  it.each([
    ['gone already (404)', 404, NOT_FOUND],
    ['verified meanwhile (409)', 409, ALREADY_VERIFIED],
  ])(
    'removes a row it cannot reject because it is %s as handled, without an error',
    async (_, status, body) => {
      const queue = [entry(2), entry(1)];
      api(queue, {
        replies: [
          () => {
            // Handled on another phone meanwhile.
            queue.shift();
            return problem(status, body);
          },
        ],
      });
      wrapper = await mountPage('/offen', OffenPage);

      await click(buttonIn(document, '2× Bier für Daniel ablehnen'));

      expect(rows(wrapper)).toEqual([
        expect.stringContaining('1× Bier für Daniel'),
      ]);
      expect(snackbar.value).toBeUndefined();
    },
  );

  it.each([
    ['a refusal (403)', 403, OWN_ROW],
    [
      'any other problem',
      500,
      { type: 'urn:performance:problem:internal', title: 'Interner Fehler' },
    ],
  ])(
    'keeps a row on %s to reject it and shows why',
    async (_, status, body) => {
      api([entry(2)], { replies: [() => problem(status, body)] });
      wrapper = await mountPage('/offen', OffenPage);

      await click(buttonIn(document, '2× Bier für Daniel ablehnen'));

      expect(rows(wrapper)).toHaveLength(1);
      expect(snackbar.value?.text).toBe(body.title);
    },
  );

  it('keeps a row without an answer to its rejection and says it was not rejected', async () => {
    api([entry(2)], {
      replies: [() => Promise.reject(new TypeError('Failed to fetch'))],
    });
    wrapper = await mountPage('/offen', OffenPage);

    await click(buttonIn(document, '2× Bier für Daniel ablehnen'));

    expect(rows(wrapper)).toHaveLength(1);
    expect(snackbar.value?.text).toBe('Nicht abgelehnt – keine Verbindung');
  });

  it('blocks Ablehnen while offline, like saving', async () => {
    const { rejected } = api([entry(2)]);
    online = false;
    wrapper = await mountPage('/offen', OffenPage);

    const button = buttonIn(document, '2× Bier für Daniel ablehnen');
    await click(button);

    expect(button.disabled).toBe(true);
    expect(rejected).toEqual([]);
  });

  it('appends the next page with Ältere laden', async () => {
    api([entry(3), entry(2), entry(1)], { pageSize: 2 });
    wrapper = await mountPage('/offen', OffenPage);
    expect(rows(wrapper)).toHaveLength(2);

    await click(buttonIn(document, 'Ältere laden'));
    await flushPromises();

    expect(rows(wrapper)).toHaveLength(3);
    expect(() => buttonIn(document, 'Ältere laden')).toThrow();
  });
});
