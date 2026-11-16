import {
  deleteEntry,
  putEntry,
  type Factor,
  type NewEntry,
} from '../../core/api-client';
import type { Router } from 'vue-router';
import { messages } from '../../core/messages';
import { createSaver, type SaveOutcome } from '../../core/saver';
import { refreshScoreboard } from '../../core/scoreboard-feed';
import { showSnackbar } from '../../core/snackbar';

/** What the snackbar names: `2× Bier · Happy Hour ×2 · Daniel`. */
export interface EntryLabels {
  drink: string;
  person: string;
  /** The chosen factor with its multiplier; absent for none. */
  factor?: string;
}

function entrySaver(newId?: () => string) {
  return createSaver<NewEntry>(
    { put: putEntry, remove: deleteEntry, refresh: refreshScoreboard },
    newId,
  );
}

/** Saves entries under a client-generated id; see `Saver.attempt`. */
export function createEntrySaver(
  newId: () => string,
): (entry: NewEntry) => Promise<SaveOutcome> {
  return entrySaver(newId).attempt;
}

const entries = entrySaver();

/** Undoes a saved entry; an entry that is already gone counts as undone. */
export function undoEntry(id: string): Promise<void> {
  return entries.undo(id);
}

/**
Saves an entry and says so: on success `done` runs (back to the name list, see
`backToNamesFrom`) and the snackbar offers `Rückgängig`; without an answer it offers
`Erneut versuchen`, which retries this attempt with the same id; a problem shows its
title. Resolves to whether the entry is saved.
*/
export function saveEntry(
  entry: NewEntry,
  labels: EntryLabels,
  done: () => void,
): Promise<boolean> {
  return entries.save(
    entry,
    messages.zaehlen.saved(
      entry.quantity,
      labels.drink,
      labels.person,
      labels.factor,
    ),
    done,
  );
}

/**
The add flow's steps (§6.1, §7d): names → drink → quantity → factor. The factor step
is skipped while no factors exist; the quantity step then saves.
*/
export function addFlowSteps(factors: readonly Factor[]): 3 | 4 {
  return factors.length > 0 ? 4 : 3;
}

export const NAMES_PATH = '/zaehlen';
export const drinkStepPath = (personId: number) =>
  `${NAMES_PATH}/${String(personId)}`;
export const quantityStepPath = (personId: number, drinkId: number) =>
  `${drinkStepPath(personId)}/${String(drinkId)}`;
/** `quantity` is the number of new drinks. */
export const factorStepPath = (
  personId: number,
  drinkId: number,
  quantity: number,
) => `${quantityStepPath(personId, drinkId)}/${String(quantity)}`;

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
the steps after it are taken back off the history, so the system back gesture does
not return into a finished flow; otherwise the step is replaced by the name list.
*/
export function returnToNames(router: Router): void {
  const path = router.currentRoute.value.path;
  const previousStep = path.slice(0, path.lastIndexOf('/'));
  const stepsWalked = path.slice(NAMES_PATH.length).split('/').length - 1;
  if (startedOnNames && router.options.history.state.back === previousStep) {
    router.go(-stepsWalked);
  } else {
    void router.replace(NAMES_PATH);
  }
  startedOnNames = false;
}

/**
The `done` of a save on the current step: back to the name list, but only while that
step is still shown. A save that succeeds later (a slow answer, or `Erneut versuchen`
from the snackbar after the user moved on) never pulls the user off another screen or
out of another add flow.
*/
export function backToNamesFrom(router: Router): () => void {
  const step = router.currentRoute.value.fullPath;
  return () => {
    if (router.currentRoute.value.fullPath === step) returnToNames(router);
  };
}

/** A person or drink of the route was deleted (on another phone): back to the start (§4). */
export function leaveGoneStep(router: Router): void {
  void router.replace(NAMES_PATH);
  showSnackbar({ text: messages.zaehlen.gone });
}
