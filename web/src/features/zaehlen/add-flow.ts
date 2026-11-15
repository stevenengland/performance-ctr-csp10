import {
  ApiProblem,
  deleteEntry,
  putEntry,
  type NewEntry,
} from '../../core/api-client';
import type { Router } from 'vue-router';
import { messages } from '../../core/messages';
import { refreshScoreboard } from '../../core/scoreboard';
import { showSnackbar } from '../../core/snackbar';

/** What the snackbar names: `2× Bier · Daniel`. */
export interface EntryLabels {
  drink: string;
  person: string;
}

export type SaveOutcome =
  | { kind: 'saved'; id: string }
  /** No definite answer (no connection, server unavailable): the id is kept for the retry. */
  | { kind: 'lost' }
  | { kind: 'rejected'; problem: ApiProblem };

function sameContent(a: NewEntry, b: NewEntry): boolean {
  return (
    a.personId === b.personId &&
    a.drinkId === b.drinkId &&
    a.quantity === b.quantity
  );
}

/**
Saves entries under a client-generated id and keeps that id until the server gave a
definite answer: saving the same content again (`Erneut versuchen`) reuses it, so a
save whose response was lost can never be booked twice.
*/
export function createEntrySaver(newId: () => string) {
  let pending: { id: string; entry: NewEntry } | undefined;

  return async function save(entry: NewEntry): Promise<SaveOutcome> {
    if (!pending || !sameContent(pending.entry, entry)) {
      pending = { id: newId(), entry };
    }
    const { id } = pending;
    try {
      await putEntry(id, entry);
      pending = undefined;
      return { kind: 'saved', id };
    } catch (failure) {
      if (failure instanceof ApiProblem && failure.status < 500) {
        pending = undefined;
        return { kind: 'rejected', problem: failure };
      }
      return { kind: 'lost' };
    }
  };
}

const save = createEntrySaver(() => crypto.randomUUID());

/** Undoes a saved entry; an entry that is already gone counts as undone. */
export async function undoEntry(id: string): Promise<void> {
  try {
    await deleteEntry(id);
  } catch (failure) {
    if (!(failure instanceof ApiProblem) || failure.status >= 500) {
      showSnackbar({
        text: messages.zaehlen.notUndone,
        action: {
          label: messages.zaehlen.retry,
          run: () => void undoEntry(id),
        },
      });
      return;
    }
    if (failure.status !== 404) {
      showSnackbar({ text: failure.title });
      return;
    }
  }
  showSnackbar({ text: messages.zaehlen.undone });
  await refreshScoreboard();
}

/**
Saves an entry and says so: on success `done` runs (back to the name list) and the
snackbar offers `Rückgängig`; without an answer it offers `Erneut versuchen` with the
same id; a problem shows its title. Resolves to whether the entry is saved.
*/
export async function saveEntry(
  entry: NewEntry,
  labels: EntryLabels,
  done: () => void,
): Promise<boolean> {
  const outcome = await save(entry);
  if (outcome.kind === 'saved') {
    done();
    showSnackbar({
      text: messages.zaehlen.saved(entry.quantity, labels.drink, labels.person),
      action: {
        label: messages.zaehlen.undo,
        run: () => void undoEntry(outcome.id),
      },
    });
    await refreshScoreboard();
    return true;
  }
  if (outcome.kind === 'lost') {
    showSnackbar({
      text: messages.zaehlen.notSaved,
      action: {
        label: messages.zaehlen.retry,
        run: () => void saveEntry(entry, labels, done),
      },
    });
  } else {
    showSnackbar({ text: outcome.problem.title });
  }
  return false;
}

export const NAMES_PATH = '/zaehlen';
export const drinkStepPath = (personId: number) =>
  `${NAMES_PATH}/${String(personId)}`;
export const quantityStepPath = (personId: number, drinkId: number) =>
  `${drinkStepPath(personId)}/${String(drinkId)}`;

/** Whether the drink step in the history was opened from the name list in this session. */
let startedOnNames = false;

/** Opens the drink step for a person from the name list. */
export function choosePerson(
  router: Router,
  personId: number,
): Promise<unknown> {
  startedOnNames = true;
  return router.push(drinkStepPath(personId));
}

/**
Back to the name list after saving. When the flow was walked from the name list,
the two steps are taken back off the history, so the system back gesture does not
return into a finished flow; otherwise the step is replaced by the name list.
*/
export function returnToNames(router: Router, personId: number): void {
  const back = router.options.history.state.back;
  if (startedOnNames && back === drinkStepPath(personId)) {
    router.go(-2);
  } else {
    void router.replace(NAMES_PATH);
  }
  startedOnNames = false;
}

/** A person or drink of the route was deleted (on another phone): back to the start (§4). */
export function leaveGoneStep(router: Router): void {
  void router.replace(NAMES_PATH);
  showSnackbar({ text: messages.zaehlen.gone });
}
