import type { Router } from 'vue-router';
import {
  deleteMatch,
  deleteResult,
  putMatch,
  putResult,
  type NewMatch,
  type NewResult,
} from '../../core/api-client';
import { refreshStandings } from '../../core/games';
import { messages } from '../../core/messages';
import { createSaver, type Saver } from '../../core/saver';
import { showSnackbar } from '../../core/snackbar';

/** Saves a game's matches: saving and `Rückgängig` read that game's ranking again. */
export function matchSaver(gameId: number): Saver<NewMatch> {
  return createSaver<NewMatch>({
    put: putMatch,
    remove: deleteMatch,
    refresh: () => refreshStandings(gameId),
  });
}

/** Saves a game's results: saving and `Rückgängig` read that game's ranking again. */
export function resultSaver(gameId: number): Saver<NewResult> {
  return createSaver<NewResult>({
    put: putResult,
    remove: deleteResult,
    refresh: () => refreshStandings(gameId),
  });
}

/** The flow's first step that the current one was walked from, in this session. */
let startedOn: string | undefined;

/** Opens the next step; from the first step, it remembers that the flow started there. */
export function step(router: Router, to: string, firstStep?: string): void {
  if (firstStep !== undefined) startedOn = firstStep;
  void router.push(to);
}

/**
The `done` of a save: back to the flow's first step (the next match), taking the
walked steps off the history, as the add flow does, so the system back gesture
does not return into a finished flow. Only while the saving step is still shown:
a save that succeeds later never pulls the user off another screen.
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

/** A game or person of the route is gone (deleted on another phone): back to Spiele (§4). */
export function leaveGone(router: Router): void {
  void router.replace('/spiele');
  showSnackbar({ text: messages.zaehlen.gone });
}
