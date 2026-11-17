import { flushPromises, mount, type VueWrapper } from '@vue/test-utils';
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
import { defineComponent, h } from 'vue';
import { createMemoryHistory, createRouter, RouterView } from 'vue-router';
import AppTopBar from '../../components/AppTopBar.vue';
import { refreshPending } from '../../core/pending-queue';
import { forgetSession, signIn, signOut } from '../../core/session';
import { createAppVuetify } from '../../theme';
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

function match(n: number): PendingItem {
  return {
    kind: 'match',
    id: `00000000-0000-4000-9000-${String(n).padStart(12, '0')}`,
    createdAt: '2026-11-15T20:00:00.000Z',
    accountName: 'anna',
    game: { id: 1, name: 'Schach' },
    earlierRun: false,
    first: { id: 1, name: 'Anna' },
    second: { id: 2, name: 'Ben' },
    outcome: 'first',
  };
}

function result(n: number): PendingItem {
  return {
    kind: 'result',
    id: `00000000-0000-4000-a000-${String(n).padStart(12, '0')}`,
    createdAt: '2026-11-15T20:00:00.000Z',
    accountName: 'anna',
    game: { id: 2, name: 'Rommé' },
    earlierRun: false,
    person: { id: 3, name: 'Daniel' },
    points: -20,
  };
}

type Reply = () => Response | Promise<Response>;

/** Every fake API answers with ETags of its own, so the shared queue never takes one test's ETag into the next. */
let apis = 0;

/**
A fake API over the queue, answering like the real one: the first page holds
`pageSize` rows with the ETag of the data revision and answers 304 while the
revision stays; a cursor `p<n>` reads on from the n-th row. A verification or
rejection takes the next given reply or succeeds, removes the row and bumps the
revision. A queue read takes the next given `reads` reply first, if any (an
`undefined` one reads the queue). The scoreboard answers empty. `elsewhere`
bumps the revision, as any write on another phone does, after removing the
given rows (verified by someone else).
*/
function api(
  queue: PendingItem[],
  {
    pageSize = 20,
    replies = [] as Reply[],
    reads = [] as (Reply | undefined)[],
  } = {},
) {
  apis += 1;
  const prefix = String(apis);
  let revision = 1;
  const verified: string[] = [];
  const rejected: string[] = [];
  /** Each decision's method and path, in order. */
  const sent: string[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init: RequestInit) => {
      const { pathname, searchParams } = new URL(url, 'http://app');
      if (pathname === '/api/scoreboard')
        return json({ rows: [], unranked: [] });
      if (pathname === '/api/pending') {
        const read = reads.shift();
        if (read) return read();
        const cursor = searchParams.get('cursor');
        const etag = `"${prefix}.${String(revision)}-1"`;
        const headers = new Headers(init.headers);
        if (!cursor && headers.get('If-None-Match') === etag)
          return new Response(null, { status: 304, headers: { ETag: etag } });
        const from = Number(cursor?.slice(1) ?? 0);
        const end = from + pageSize;
        const answer = json({
          items: queue.slice(from, end),
          next: end < queue.length ? `p${String(end)}` : null,
          count: queue.length,
        });
        if (!cursor) answer.headers.set('ETag', etag);
        return answer;
      }
      const id =
        /\/api\/(?:entries|matches|results)\/([^/]+)\/verification$/.exec(
          pathname,
        )?.[1];
      const decided = { PUT: verified, DELETE: rejected }[init.method ?? ''];
      if (!decided || !id) throw new Error(`unexpected ${url}`);
      sent.push(`${init.method ?? ''} ${pathname}`);
      const reply = replies.shift();
      if (reply) return reply();
      decided.push(id);
      queue.splice(
        queue.findIndex((item) => item.id === id),
        1,
      );
      revision += 1;
      return new Response(null, { status: 204 });
    }),
  );
  function elsewhere(...gone: PendingItem[]) {
    for (const item of gone) {
      queue.splice(
        queue.findIndex(({ id }) => id === item.id),
        1,
      );
    }
    revision += 1;
  }
  return { verified, rejected, sent, elsewhere };
}

const snackbar = useSnackbar();

/** Lets the current fake API also answer sign-in (as the given user name) and sign-out. */
function sessions() {
  const queue = fetch;
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init: RequestInit) => {
      if (new URL(url, 'http://app').pathname !== '/api/session')
        return queue(url, init);
      if (init.method === 'DELETE') return new Response(null, { status: 204 });
      const { userName } = JSON.parse(String(init.body)) as {
        userName: string;
      };
      return json({ id: userName.length, userName, isAdmin: false });
    }),
  );
}

/** Offen below the shell's top bar, as the app shows it. */
async function offenInTheShell() {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      {
        path: '/offen',
        component: OffenPage,
        meta: { title: 'Offen', destination: 'offen' },
      },
    ],
  });
  await router.push('/offen');
  const shell = defineComponent(() => () => [h(AppTopBar), h(RouterView)]);
  const wrapper = mount(shell, {
    global: { plugins: [router, createAppVuetify()] },
    attachTo: document.body,
  });
  await flushPromises();
  return wrapper;
}

function buttonsNamed(name: string): HTMLButtonElement[] {
  return [
    ...document.querySelectorAll<HTMLButtonElement>(
      `button[aria-label="${name}"]`,
    ),
  ];
}

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
    forgetSession();
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

  it('verifies and rejects a match at the match verification', async () => {
    const { sent } = api([match(2), match(1)]);
    wrapper = await mountPage('/offen', OffenPage);
    expect(rows(wrapper)).toEqual([
      expect.stringContaining('Anna – Ben · Anna gewinnt'),
      expect.stringContaining('Anna – Ben · Anna gewinnt'),
    ]);

    const [reject] = buttonsNamed('Anna – Ben · Anna gewinnt ablehnen');
    if (reject) await click(reject);
    const [verify] = buttonsNamed('Anna – Ben · Anna gewinnt bestätigen');
    if (verify) await click(verify);

    expect(sent).toEqual([
      `DELETE /api/matches/${match(2).id}/verification`,
      `PUT /api/matches/${match(1).id}/verification`,
    ]);
    expect(rows(wrapper)).toEqual([]);
  });

  it('verifies and rejects a result at the result verification', async () => {
    const { sent } = api([result(2), result(1)]);
    wrapper = await mountPage('/offen', OffenPage);
    expect(rows(wrapper)).toEqual([
      expect.stringContaining('Daniel · −20 Punkte'),
      expect.stringContaining('Daniel · −20 Punkte'),
    ]);

    const [reject] = buttonsNamed('Daniel · −20 Punkte ablehnen');
    if (reject) await click(reject);
    const [verify] = buttonsNamed('Daniel · −20 Punkte bestätigen');
    if (verify) await click(verify);

    expect(sent).toEqual([
      `DELETE /api/results/${result(2).id}/verification`,
      `PUT /api/results/${result(1).id}/verification`,
    ]);
    expect(rows(wrapper)).toEqual([]);
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

  it('keeps the loaded older rows after verifying one of them', async () => {
    api([entry(6), entry(5), entry(4), entry(3), entry(2), entry(1)], {
      pageSize: 2,
    });
    wrapper = await mountPage('/offen', OffenPage);
    await click(buttonIn(document, 'Ältere laden'));
    await flushPromises();
    await click(buttonIn(document, 'Ältere laden'));
    await flushPromises();
    expect(rows(wrapper)).toHaveLength(6);

    await click(buttonIn(document, '3× Bier für Daniel bestätigen'));
    await flushPromises();

    expect(rows(wrapper)).toEqual(
      [6, 5, 4, 2, 1].map((n) =>
        expect.stringContaining(`${String(n)}× Bier für Daniel`),
      ),
    );
  });

  it('keeps the loaded older rows when another member records something elsewhere', async () => {
    const { elsewhere } = api(
      [entry(6), entry(5), entry(4), entry(3), entry(2), entry(1)],
      { pageSize: 2 },
    );
    wrapper = await mountPage('/offen', OffenPage);
    await click(buttonIn(document, 'Ältere laden'));
    await flushPromises();
    expect(rows(wrapper)).toHaveLength(4);

    // A drink recorded on another phone: the queue itself stays as it was.
    elsewhere();
    await refreshPending();
    await flushPromises();

    expect(rows(wrapper)).toEqual(
      [6, 5, 4, 3].map((n) =>
        expect.stringContaining(`${String(n)}× Bier für Daniel`),
      ),
    );
    buttonIn(document, 'Ältere laden');
  });

  it('drops a loaded older row someone else verified, keeping its neighbours', async () => {
    const { elsewhere } = api(
      [entry(6), entry(5), entry(4), entry(3), entry(2), entry(1)],
      { pageSize: 2 },
    );
    wrapper = await mountPage('/offen', OffenPage);
    await click(buttonIn(document, 'Ältere laden'));
    await flushPromises();
    await click(buttonIn(document, 'Ältere laden'));
    await flushPromises();
    expect(rows(wrapper)).toHaveLength(6);

    elsewhere(entry(3));
    await refreshPending();
    await flushPromises();

    expect(rows(wrapper)).toEqual(
      [6, 5, 4, 2, 1].map((n) =>
        expect.stringContaining(`${String(n)}× Bier für Daniel`),
      ),
    );
  });

  it('keeps the loaded older rows when reading them again fails', async () => {
    const reads: (Reply | undefined)[] = [];
    const { elsewhere } = api(
      [entry(6), entry(5), entry(4), entry(3), entry(2), entry(1)],
      { pageSize: 2, reads },
    );
    wrapper = await mountPage('/offen', OffenPage);
    await click(buttonIn(document, 'Ältere laden'));
    await flushPromises();

    elsewhere();
    reads.push(undefined, () =>
      Promise.reject(new TypeError('Failed to fetch')),
    );
    await refreshPending();
    await flushPromises();

    expect(rows(wrapper)).toHaveLength(4);
    expect(snackbar.value).toBeUndefined();
  });

  it.each([
    ['the same account', 'anna'],
    ['another account', 'ben'],
  ])(
    'drops an older page that arrives after sign-out, also once %s signed in',
    async (_who, next) => {
      const reads: (Reply | undefined)[] = [];
      api([entry(4), entry(3), entry(2), entry(1)], { pageSize: 2, reads });
      sessions();
      await signIn('anna', 'geheim');
      wrapper = await mountPage('/offen', OffenPage);
      let answerOlder: () => void = () => undefined;
      reads.push(
        () =>
          new Promise<Response>((resolve) => {
            answerOlder = () => {
              resolve(json({ items: [entry(2), entry(1)], next: null }));
            };
          }),
      );
      await click(buttonIn(document, 'Ältere laden'));

      await signOut();
      answerOlder();
      await flushPromises();
      expect(rows(wrapper).join()).not.toContain('Bier');

      api([match(1)]);
      sessions();
      await signIn(next, 'geheim');
      await flushPromises();
      expect(rows(wrapper)).toEqual([expect.stringContaining('Schach')]);
    },
  );

  it('shows a row handled before sign-out again in the next session’s queue', async () => {
    api([entry(2), entry(1)], {
      replies: [() => problem(404, NOT_FOUND)],
    });
    sessions();
    await signIn('anna', 'geheim');
    wrapper = await mountPage('/offen', OffenPage);
    await click(buttonIn(document, '1× Bier für Daniel bestätigen'));
    await flushPromises();
    expect(rows(wrapper)).toHaveLength(1);

    await signOut();
    api([entry(2), entry(1)]);
    sessions();
    await signIn('ben', 'geheim');
    await flushPromises();

    expect(rows(wrapper)).toHaveLength(2);
  });

  it('shows “Stand: hh:mm” in the top bar while the queue cannot be read', async () => {
    const reads: (Reply | undefined)[] = [];
    api([entry(2), entry(1)], { reads });
    wrapper = await offenInTheShell();
    expect(wrapper.get('.top-bar').text()).not.toContain('Stand');

    reads.push(() => Promise.reject(new TypeError('Failed to fetch')));
    await refreshPending();
    await flushPromises();

    expect(rows(wrapper)).toHaveLength(2);
    expect(wrapper.get('.top-bar').text()).toMatch(/Stand: \d\d:\d\d/);
  });
});
