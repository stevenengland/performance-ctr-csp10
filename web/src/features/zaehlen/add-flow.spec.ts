import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { dismissSnackbar, useSnackbar } from '../../core/snackbar';
import {
  addFlowSteps,
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

  it('keeps the id after a lost response and reuses it for the retry', async () => {
    const calls = api(lost, lost, created);
    const save = createEntrySaver(ids());

    expect(await save(TWO_BEERS)).toEqual({ kind: 'lost' });
    expect(await save(TWO_BEERS)).toEqual({ kind: 'lost' });
    expect(await save(TWO_BEERS)).toEqual({ kind: 'saved', id: 'id-1' });

    expect(entryCalls(calls).map(({ url }) => url)).toEqual([
      '/api/entries/id-1',
      '/api/entries/id-1',
      '/api/entries/id-1',
    ]);
  });

  it('keeps the id while the server is unavailable (5xx), which is no definite answer', async () => {
    const calls = api(() => problem(503, 'Wird aktualisiert'), created);
    const save = createEntrySaver(ids());

    await save(TWO_BEERS);
    await save(TWO_BEERS);

    expect(entryCalls(calls).map(({ url }) => url)).toEqual([
      '/api/entries/id-1',
      '/api/entries/id-1',
    ]);
  });

  it('takes a new id only after a definite answer', async () => {
    const calls = api(
      created,
      () => problem(422, 'Bitte Eingaben prüfen'),
      created,
    );
    const save = createEntrySaver(ids());

    await save(TWO_BEERS);
    expect(await save(TWO_BEERS)).toMatchObject({
      kind: 'rejected',
      problem: { status: 422 },
    });
    await save(TWO_BEERS);

    expect(entryCalls(calls).map(({ url }) => url)).toEqual([
      '/api/entries/id-1',
      '/api/entries/id-2',
      '/api/entries/id-3',
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

  it('takes a new id when the factor differs, since that is other content', async () => {
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
