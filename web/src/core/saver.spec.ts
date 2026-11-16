import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiProblem } from './api-client';
import { createSaver } from './saver';
import { dismissSnackbar, useSnackbar } from './snackbar';

type Reply = () => Promise<void>;

const answered: Reply = () => Promise.resolve();
const lost: Reply = () => Promise.reject(new TypeError('Failed to fetch'));
const rejectedWith =
  (status: number, title: string): Reply =>
  () =>
    Promise.reject(new ApiProblem(status, 'urn:performance:problem:x', title));

/** A fake recording endpoint: answers each call with the next reply and records it. */
function endpoint(...replies: Reply[]) {
  const calls: string[] = [];
  function call(name: string) {
    calls.push(name);
    const reply = replies.shift();
    if (!reply) throw new Error(`unexpected ${name}`);
    return reply();
  }
  const refresh = vi.fn(() => Promise.resolve());
  return {
    calls,
    refresh,
    port: {
      put: (id: string, body: { points: number }) =>
        call(`put ${id} ${String(body.points)}`),
      remove: (id: string) => call(`remove ${id}`),
      refresh,
    },
  };
}

function ids() {
  let next = 0;
  return () => {
    next += 1;
    return `id-${String(next)}`;
  };
}

const runSnackbarAction = () => {
  useSnackbar().value?.action?.run();
};

describe('the saver', () => {
  beforeEach(dismissSnackbar);

  it('retries a save whose answer was lost under the same id', async () => {
    const { calls, port } = endpoint(lost, answered);
    const done = vi.fn();
    const saver = createSaver(port, ids());

    await expect(saver.save({ points: 7 }, 'Anna · 7', done)).resolves.toBe(
      false,
    );
    expect(useSnackbar().value?.text).toBe(
      'Nicht gespeichert – keine Verbindung',
    );
    expect(useSnackbar().value?.action?.label).toBe('Erneut versuchen');
    runSnackbarAction();

    await vi.waitFor(() => {
      expect(done).toHaveBeenCalledOnce();
    });
    expect(calls).toEqual(['put id-1 7', 'put id-1 7']);
    expect(useSnackbar().value?.text).toBe('Anna · 7');
    expect(useSnackbar().value?.action?.label).toBe('Rückgängig');
  });

  it('takes a new id for every new save, even after a lost answer', async () => {
    const { calls, port } = endpoint(lost, answered);
    const saver = createSaver(port, ids());

    await saver.save({ points: 7 }, 'Anna · 7', vi.fn());
    dismissSnackbar();
    await saver.save({ points: 7 }, 'Anna · 7', vi.fn());

    expect(calls).toEqual(['put id-1 7', 'put id-2 7']);
  });

  it('shows a rejected save’s problem title and stays on the step', async () => {
    const { port, refresh } = endpoint(
      rejectedWith(422, 'Bitte Eingaben prüfen'),
    );
    const done = vi.fn();

    await expect(
      createSaver(port, ids()).save({ points: 7 }, 'Anna · 7', done),
    ).resolves.toBe(false);

    expect(useSnackbar().value?.text).toBe('Bitte Eingaben prüfen');
    expect(useSnackbar().value?.action).toBeUndefined();
    expect(done).not.toHaveBeenCalled();
    expect(refresh).not.toHaveBeenCalled();
  });

  it('undoes a save from its Rückgängig and refreshes the view', async () => {
    const { calls, port, refresh } = endpoint(answered, answered);
    await createSaver(port, ids()).save({ points: 7 }, 'Anna · 7', vi.fn());

    runSnackbarAction();

    await vi.waitFor(() => {
      expect(useSnackbar().value?.text).toBe('Rückgängig gemacht');
    });
    expect(calls).toEqual(['put id-1 7', 'remove id-1']);
    expect(refresh).toHaveBeenCalledTimes(2);
  });

  it('counts an undo whose record is already gone (404) as undone', async () => {
    const { port, refresh } = endpoint(rejectedWith(404, 'Nicht gefunden'));

    await createSaver(port, ids()).undo('id-1');

    expect(useSnackbar().value?.text).toBe('Rückgängig gemacht');
    expect(refresh).toHaveBeenCalledOnce();
  });

  it('offers to try an undo again without a connection', async () => {
    const { calls, port } = endpoint(lost, answered);

    await createSaver(port, ids()).undo('id-1');
    expect(useSnackbar().value?.text).toBe(
      'Nicht rückgängig gemacht – keine Verbindung',
    );
    runSnackbarAction();

    await vi.waitFor(() => {
      expect(useSnackbar().value?.text).toBe('Rückgängig gemacht');
    });
    expect(calls).toEqual(['remove id-1', 'remove id-1']);
  });
});
