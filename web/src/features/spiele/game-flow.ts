import type { Router } from 'vue-router';
import {
  ApiProblem,
  deleteMatch,
  deleteResult,
  putMatch,
  putResult,
  type NewMatch,
  type NewResult,
} from '../../core/api-client';
import { refreshStandings } from '../../core/games';
import { messages } from '../../core/messages';
import { showSnackbar } from '../../core/snackbar';

/**
A recording to save under a client id: a match or a result. Like the add flow's
saver, each save is a new attempt with a new id and only `Erneut versuchen` reuses
it, so a lost answer never books a result twice.
*/
type Recording =
  { kind: 'match'; body: NewMatch } | { kind: 'result'; body: NewResult };

type Outcome =
  | { kind: 'saved'; id: string }
  | { kind: 'lost'; retry: () => Promise<Outcome> }
  | { kind: 'rejected'; problem: ApiProblem };

async function attempt(id: string, recording: Recording): Promise<Outcome> {
  try {
    if (recording.kind === 'match') await putMatch(id, recording.body);
    else await putResult(id, recording.body);
    return { kind: 'saved', id };
  } catch (failure) {
    if (failure instanceof ApiProblem && failure.status < 500) {
      return { kind: 'rejected', problem: failure };
    }
    return { kind: 'lost', retry: () => attempt(id, recording) };
  }
}

async function undo(recording: Recording, id: string): Promise<void> {
  try {
    if (recording.kind === 'match') await deleteMatch(id);
    else await deleteResult(id);
  } catch (failure) {
    if (!(failure instanceof ApiProblem) || failure.status >= 500) {
      showSnackbar({
        text: messages.zaehlen.notUndone,
        action: {
          label: messages.zaehlen.retry,
          run: () => void undo(recording, id),
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
  await refreshStandings(recording.body.gameId);
}

async function report(
  outcome: Outcome,
  recording: Recording,
  text: string,
  done: () => void,
): Promise<boolean> {
  if (outcome.kind === 'saved') {
    done();
    showSnackbar({
      text,
      action: {
        label: messages.zaehlen.undo,
        run: () => void undo(recording, outcome.id),
      },
    });
    await refreshStandings(recording.body.gameId);
    return true;
  }
  if (outcome.kind === 'lost') {
    showSnackbar({
      text: messages.zaehlen.notSaved,
      action: {
        label: messages.zaehlen.retry,
        run: () =>
          void outcome
            .retry()
            .then((next) => report(next, recording, text, done)),
      },
    });
  } else {
    showSnackbar({ text: outcome.problem.title });
  }
  return false;
}

/** Saves a match or result and says so; resolves to whether it is saved. */
export async function saveRecording(
  recording: Recording,
  text: string,
  done: () => void,
): Promise<boolean> {
  return report(
    await attempt(crypto.randomUUID(), recording),
    recording,
    text,
    done,
  );
}

/** The flow's first step that the current one was walked from, in this session. */
let startedOn: string | undefined;

/** Opens the next step; from the first step, it remembers that the flow started there. */
export function step(router: Router, to: string, firstStep?: string): void {
  if (firstStep !== undefined) startedOn = firstStep;
  void router.push(to);
}

/**
The `done` of a save: back to the flow's first step (the next player, the next
match), taking the walked steps off the history, as the add flow does; only while
the saving step is still shown.
*/
export function backToFirstStepFrom(
  router: Router,
  firstStep: string,
): () => void {
  const shown = router.currentRoute.value.fullPath;
  return () => {
    if (router.currentRoute.value.fullPath !== shown) return;
    const walked = shown.slice(firstStep.length).split('/').length - 1;
    if (startedOn === firstStep && walked > 0) router.go(-walked);
    else void router.replace(firstStep);
    startedOn = undefined;
  };
}

/** A game or person of the route is gone (deleted on another phone): back to Spiele. */
export function leaveGone(router: Router): void {
  void router.replace('/spiele');
  showSnackbar({ text: messages.zaehlen.gone });
}
