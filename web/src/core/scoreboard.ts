import { readonly, shallowRef, type DeepReadonly } from 'vue';
import { getScoreboard, type Scoreboard } from './api-client';
import { todayFrom } from './day-window';

/**
Today's standings, shared by every screen that shows scores or counters (the add
flow's tiles and its top bar). Each refresh computes the day window anew, so the
data resets at local midnight, and a response that a newer refresh overtook is
dropped. Polling arrives with the Rangliste.
*/
const standings = shallowRef<Scoreboard>();
let latest = 0;

export async function refreshScoreboard(now: () => Date = () => new Date()) {
  latest += 1;
  const request = latest;
  try {
    const answer = await getScoreboard(todayFrom(now()));
    if (request === latest) standings.value = answer;
  } catch {
    // The last standings stay visible; the next refresh tries again.
  }
}

export function useScoreboard() {
  return readonly(standings);
}

/** A person's total score today; 0 without entries. */
export function scoreOf(
  board: DeepReadonly<Scoreboard> | undefined,
  personId: number,
) {
  return board?.rows.find((row) => row.personId === personId)?.score ?? 0;
}

/** A person's counter for one drink today; 0 without entries. */
export function counterOf(
  board: DeepReadonly<Scoreboard> | undefined,
  personId: number,
  drinkId: number,
): number {
  const row = board?.rows.find((candidate) => candidate.personId === personId);
  return row?.drinks.find((drink) => drink.drinkId === drinkId)?.count ?? 0;
}
