import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createMemoryHistory, createRouter } from 'vue-router';
import { dismissSnackbar, useSnackbar } from '../../core/snackbar';
import {
  addFlowSteps,
  backToNamesFrom,
  choosePerson,
  createEntrySaver,
  saveEntry,
  undoEntry,
} from './add-flow';

const TWO_BEERS = { personId: 1, drinkId: 2, quantity: 2 };
const LABELS = { drink: 'Bier', person: 'Daniel' };

interface Call {
  method: string;
  url: string;
}

/** A fake API: answers each request with the next reply and records it. */
function api(...replies: (() => Response | Promise<Response>)[]) {
  const calls: Call[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init: RequestInit) => {
      calls.push({ method: init.method ?? 'GET', url });
      if (url.startsWith('/api/scoreboard')) return json({ rows: [] });
      const reply = replies.shift();
      if (!reply) throw new Error(`unexpected ${init.method ?? ''} ${url}`);
      return reply();
    }),
  );
  return calls;
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function problem(status: number, title: string) {
  return new Response(
    JSON.stringify({ type: 'urn:performance:problem:x', title, status }),
    { status, headers: { 'Content-Type': 'application/problem+json' } },
  );
}

const created = () => json({ ...TWO_BEERS, id: 'x', createdAt: '' }, 201);
const lost = () => Promise.reject(new TypeError('Failed to fetch'));
const noContent = () => new Response(null, { status: 204 });

function ids() {
  let next = 0;
  return () => {
    next += 1;
    return `id-${String(next)}`;
  };
}

const entryCalls = (calls: Call[]) =>
  calls.filter(({ url }) => url.startsWith('/api/entries/'));

describe('saving an entry', () => {
  beforeEach(dismissSnackbar);
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('keeps the id after a lost response and reuses it for the retry of that attempt', async () => {
    const calls = api(lost, lost, created);
    const save = createEntrySaver(ids());

    const first = await save(TWO_BEERS);
    expect(first.kind).toBe('lost');
    const second = first.kind === 'lost' ? await first.retry() : first;
    expect(second.kind).toBe('lost');
    const third = second.kind === 'lost' ? await second.retry() : second;
    expect(third).toEqual({ kind: 'saved', id: 'id-1' });

    expect(entryCalls(calls).map(({ url }) => url)).toEqual([
      '/api/entries/id-1',
      '/api/entries/id-1',
      '/api/entries/id-1',
    ]);
  });

  it('keeps the id while the server is unavailable (5xx), which is no definite answer', async () => {
    const calls = api(() => problem(503, 'Wird aktualisiert'), created);
    const save = createEntrySaver(ids());

    const first = await save(TWO_BEERS);
    if (first.kind === 'lost') await first.retry();

    expect(entryCalls(calls).map(({ url }) => url)).toEqual([
      '/api/entries/id-1',
      '/api/entries/id-1',
    ]);
  });

  it('takes a new id for every new save, even with the same content after a lost response', async () => {
    const calls = api(
      created,
      () => problem(422, 'Bitte Eingaben prüfen'),
      lost,
      created,
    );
    const save = createEntrySaver(ids());

    await save(TWO_BEERS);
    expect(await save(TWO_BEERS)).toMatchObject({
      kind: 'rejected',
      problem: { status: 422 },
    });
    expect((await save(TWO_BEERS)).kind).toBe('lost');
    // Later the same drink again: a new save, never the lost attempt's id.
    expect(await save(TWO_BEERS)).toEqual({ kind: 'saved', id: 'id-4' });

    expect(entryCalls(calls).map(({ url }) => url)).toEqual([
      '/api/entries/id-1',
      '/api/entries/id-2',
      '/api/entries/id-3',
      '/api/entries/id-4',
    ]);
  });

  it('says what was saved, returns to the name list and offers Rückgängig', async () => {
    const calls = api(created, noContent);
    const done = vi.fn();

    await expect(saveEntry(TWO_BEERS, LABELS, done)).resolves.toBe(true);

    expect(done).toHaveBeenCalledOnce();
    const shown = useSnackbar().value;
    expect(shown?.text).toBe('2× Bier · Daniel');
    expect(shown?.timeoutMs).toBe(8000);
    expect(shown?.action?.label).toBe('Rückgängig');
    const [put] = entryCalls(calls);

    shown?.action?.run();
    await vi.waitFor(() => {
      expect(useSnackbar().value?.text).toBe('Rückgängig gemacht');
    });
    expect(entryCalls(calls)).toEqual([
      put,
      { method: 'DELETE', url: put?.url },
    ]);
    expect(
      calls.filter(({ url }) => url.startsWith('/api/scoreboard')).length,
    ).toBe(2);
  });

  it('offers Erneut versuchen without an answer, which retries with the same id', async () => {
    const calls = api(lost, created);
    const done = vi.fn();

    await expect(saveEntry(TWO_BEERS, LABELS, done)).resolves.toBe(false);

    expect(done).not.toHaveBeenCalled();
    expect(useSnackbar().value?.text).toBe(
      'Nicht gespeichert – keine Verbindung',
    );
    expect(useSnackbar().value?.action?.label).toBe('Erneut versuchen');
    useSnackbar().value?.action?.run();
    await vi.waitFor(() => {
      expect(done).toHaveBeenCalledOnce();
    });
    const [first, retry] = entryCalls(calls);
    expect(retry).toEqual(first);
    expect(useSnackbar().value?.text).toBe('2× Bier · Daniel');
  });

  it('books a later save of the same content under a new id, after an ignored Erneut versuchen', async () => {
    const calls = api(lost, created);

    await saveEntry(TWO_BEERS, LABELS, vi.fn());
    dismissSnackbar();
    await expect(saveEntry(TWO_BEERS, LABELS, vi.fn())).resolves.toBe(true);

    const [lostPut, laterPut] = entryCalls(calls);
    expect(laterPut?.url).not.toBe(lostPut?.url);
  });

  it('takes a new id when the factor differs, since that is a new save', async () => {
    const calls = api(lost, created);
    const save = createEntrySaver(ids());

    await save({ ...TWO_BEERS, factorId: 1 });
    await save({ ...TWO_BEERS, factorId: null });

    expect(entryCalls(calls).map(({ url }) => url)).toEqual([
      '/api/entries/id-1',
      '/api/entries/id-2',
    ]);
  });

  it('names the factor in the saved snackbar: 2× Bier · Happy Hour ×2 · Daniel', async () => {
    api(created);

    await saveEntry(
      { ...TWO_BEERS, factorId: 1 },
      { ...LABELS, factor: 'Happy Hour ×2' },
      vi.fn(),
    );

    expect(useSnackbar().value?.text).toBe('2× Bier · Happy Hour ×2 · Daniel');
  });

  it('shows a problem’s title', async () => {
    api(() =>
      problem(409, 'Eintrag wurde schon mit anderem Inhalt gespeichert.'),
    );

    await saveEntry(TWO_BEERS, LABELS, vi.fn());

    expect(useSnackbar().value?.text).toBe(
      'Eintrag wurde schon mit anderem Inhalt gespeichert.',
    );
  });
});

describe('undoing an entry', () => {
  beforeEach(dismissSnackbar);
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('counts an entry that is already gone as undone', async () => {
    api(() => problem(404, 'Nicht gefunden'));

    await undoEntry('id-1');

    expect(useSnackbar().value?.text).toBe('Rückgängig gemacht');
  });

  it('offers to try again without a connection', async () => {
    const calls = api(lost, noContent);

    await undoEntry('id-1');

    expect(useSnackbar().value?.text).toBe(
      'Nicht rückgängig gemacht – keine Verbindung',
    );
    useSnackbar().value?.action?.run();
    await vi.waitFor(() => {
      expect(useSnackbar().value?.text).toBe('Rückgängig gemacht');
    });
    expect(entryCalls(calls).map(({ method }) => method)).toEqual([
      'DELETE',
      'DELETE',
    ]);
  });
});

function memoryRouter() {
  const Empty = { render: () => null };
  return createRouter({
    history: createMemoryHistory(),
    routes: [{ path: '/:rest(.*)*', component: Empty }],
  });
}

describe('leaving the step after saving', () => {
  it('returns to the name list from the step that saved', async () => {
    const router = memoryRouter();
    await router.push('/zaehlen');
    await choosePerson(router, 4);
    await router.push('/zaehlen/4/1');
    const done = backToNamesFrom(router);

    done();
    await vi.waitFor(() => {
      expect(router.currentRoute.value.path).toBe('/zaehlen');
    });
  });

  it('stays where the user went in the meantime, e.g. a retry from the Rangliste', async () => {
    const router = memoryRouter();
    await router.push('/zaehlen/4/1');
    const done = backToNamesFrom(router);
    await router.push('/rangliste');

    done();
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(router.currentRoute.value.path).toBe('/rangliste');
  });

  it('stays in another add flow the user started in the meantime', async () => {
    const router = memoryRouter();
    await router.push('/zaehlen/4/1');
    const done = backToNamesFrom(router);
    await router.push('/zaehlen');
    await choosePerson(router, 5);
    await router.push('/zaehlen/5/2');

    done();
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(router.currentRoute.value.path).toBe('/zaehlen/5/2');
  });
});

describe('the steps of the add flow', () => {
  it('has the factor step as a fourth step once factors exist', () => {
    expect(addFlowSteps([{ id: 1, name: 'Happy Hour', multiplier: 2 }])).toBe(
      4,
    );
  });

  it('skips the factor step while no factors exist, so the quantity saves', () => {
    expect(addFlowSteps([])).toBe(3);
  });
});
