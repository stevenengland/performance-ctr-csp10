import { ApiProblem } from './api-client';
import { messages } from './messages';
import { showSnackbar } from './snackbar';

/** Where a saver writes: a record kind's PUT and DELETE by client id, and the view to refresh. */
export interface SaverPort<T> {
  put: (id: string, body: T) => Promise<unknown>;
  remove: (id: string) => Promise<unknown>;
  /** Reloads what the saved record shows up in (the Rangliste, a game's standings). */
  refresh: () => Promise<void>;
}

export type SaveOutcome =
  | { kind: 'saved'; id: string }
  /**
  No definite answer (no connection, server unavailable). `retry` sends this attempt
  again under the same id, so a save whose response was lost is never booked twice.
  */
  | { kind: 'lost'; retry: () => Promise<SaveOutcome> }
  | { kind: 'rejected'; problem: ApiProblem };

export interface Saver<T> {
  /**
  One attempt under a new id. Every call is a new attempt; only the outcome's own
  `retry` (`Erneut versuchen`) reuses its id. A later save of the same content is a
  new record, so it must never reuse a lost attempt's id: the server would answer it
  as a replay and book nothing.
  */
  attempt: (body: T) => Promise<SaveOutcome>;
  /**
  Saves and says so: on success `done` runs and the snackbar shows `savedText` with
  `Rückgängig`; without an answer it offers `Erneut versuchen`, which retries this
  attempt with the same id; a problem shows its title. Resolves to whether it is saved.
  */
  save: (body: T, savedText: string, done: () => void) => Promise<boolean>;
  /** Undoes a saved record; a record that is already gone counts as undone. */
  undo: (id: string) => Promise<void>;
}

/** Save, `Erneut versuchen` and `Rückgängig` for records stored under a client-generated id. */
export function createSaver<T>(
  port: SaverPort<T>,
  newId: () => string = () => crypto.randomUUID(),
): Saver<T> {
  async function attemptAs(id: string, body: T): Promise<SaveOutcome> {
    try {
      await port.put(id, body);
      return { kind: 'saved', id };
    } catch (failure) {
      if (failure instanceof ApiProblem && failure.status < 500) {
        return { kind: 'rejected', problem: failure };
      }
      return { kind: 'lost', retry: () => attemptAs(id, body) };
    }
  }

  async function undo(id: string): Promise<void> {
    try {
      await port.remove(id);
    } catch (failure) {
      if (!(failure instanceof ApiProblem) || failure.status >= 500) {
        showSnackbar({
          text: messages.zaehlen.notUndone,
          action: { label: messages.zaehlen.retry, run: () => void undo(id) },
        });
        return;
      }
      if (failure.status !== 404) {
        showSnackbar({ text: failure.title });
        return;
      }
    }
    showSnackbar({ text: messages.zaehlen.undone });
    await port.refresh();
  }

  async function report(
    outcome: SaveOutcome,
    savedText: string,
    done: () => void,
  ): Promise<boolean> {
    if (outcome.kind === 'saved') {
      done();
      showSnackbar({
        text: savedText,
        action: {
          label: messages.zaehlen.undo,
          run: () => void undo(outcome.id),
        },
      });
      await port.refresh();
      return true;
    }
    if (outcome.kind === 'lost') {
      showSnackbar({
        text: messages.zaehlen.notSaved,
        action: {
          label: messages.zaehlen.retry,
          run: () =>
            void outcome.retry().then((next) => report(next, savedText, done)),
        },
      });
    } else {
      showSnackbar({ text: outcome.problem.title });
    }
    return false;
  }

  const attempt = (body: T) => attemptAs(newId(), body);

  return {
    attempt,
    save: async (body, savedText, done) =>
      report(await attempt(body), savedText, done),
    undo,
  };
}
