import type { DeepReadonly } from 'vue';
import type { Scoreboard } from '../../core/api-client';
import { formatNumber, formatPoints } from '../../core/format';
import { messages } from '../../core/messages';

type DrinkCounters = DeepReadonly<Scoreboard['rows'][number]['drinks']>;
type DrinkCounter = 'count' | 'recordedCount' | 'rawCount' | 'rawRecordedCount';

/** How the Rangliste counts drinks: with their factors (the default) or the pure quantities. */
export type Counting = 'factored' | 'raw';

/**
The scoreboard's counters each counting shows: a ranked row's total and drinks, and
what an unranked person recorded. Score and order stay factor-based in both.
*/
const COUNTERS: Record<
  Counting,
  { counted: 'count' | 'rawCount'; recorded: DrinkCounter }
> = {
  factored: { counted: 'count', recorded: 'recordedCount' },
  raw: { counted: 'rawCount', recorded: 'rawRecordedCount' },
};

/** One person on the Rangliste, formatted for display (§7f). */
export interface Standing {
  personId: number;
  rank: number;
  name: string;
  /** The person's photo, or `null` for their initials. */
  photoUrl: string | null;
  /** Total score today: `13,5`. */
  score: string;
  /** Total count today, for the tally. */
  count: number;
  /** `9 Getränke`. */
  countText: string;
  /** Per-drink counters of the entries that count: `Bier 4 · Margarita 1`. */
  drinks: string;
  /** `+2 offen` while entries of today wait for verification. */
  pending?: string;
  /** Accessible name: `Platz 1, Daniel, 13,5 Punkte, 9 Getränke, +2 offen`. */
  label: string;
}

/** A person whose entries of today all wait for verification: listed without a rank (§7f). */
export interface UnrankedStanding {
  personId: number;
  name: string;
  /** The person's photo, or `null` for their initials. */
  photoUrl: string | null;
  /** Per-drink counters of what was recorded: `Bier 2`. */
  drinks: string;
  /** `+2 offen`. */
  pending: string;
  /** Accessible name: `Jule, Bier 2, +2 offen`. */
  label: string;
}

/** `Bier 4 · Margarita 1` from the chosen counter, leaving out drinks at 0. */
function drinksText(drinks: DrinkCounters, counter: DrinkCounter): string {
  return drinks
    .filter((drink) => drink[counter] > 0)
    .map((drink) => `${drink.name} ${formatNumber(drink[counter])}`)
    .join(' · ');
}

/**
The scoreboard's ranked rows as the Rangliste shows them, counted as chosen. The API
owns the ranking (score, ties by name); the rank is the position.
*/
export function standingsOf(
  board: DeepReadonly<Scoreboard>,
  counting: Counting,
): Standing[] {
  const { counted } = COUNTERS[counting];
  return board.rows.map((row, index) => {
    const rank = index + 1;
    const count = row[counted];
    const countText = messages.rangliste.drinks(formatNumber(count), count);
    const pending =
      row.pendingCount > 0
        ? messages.pending.hint(row.pendingCount)
        : undefined;
    const label = messages.rangliste.label(
      rank,
      row.name,
      formatPoints(row.score),
      countText,
    );
    return {
      personId: row.personId,
      rank,
      name: row.name,
      photoUrl: row.photoUrl,
      score: formatNumber(row.score),
      count,
      countText,
      drinks: drinksText(row.drinks, counted),
      pending,
      label: pending === undefined ? label : `${label}, ${pending}`,
    };
  });
}

/** The persons whose entries of today all wait, by name, as the Rangliste lists them apart, counted as chosen. */
export function unrankedOf(
  board: DeepReadonly<Scoreboard>,
  counting: Counting,
): UnrankedStanding[] {
  const { recorded } = COUNTERS[counting];
  return board.unranked.map((row) => {
    const drinks = drinksText(row.drinks, recorded);
    const pending = messages.pending.hint(row.pendingCount);
    return {
      personId: row.personId,
      name: row.name,
      photoUrl: row.photoUrl,
      drinks,
      pending,
      label: `${row.name}, ${drinks}, ${pending}`,
    };
  });
}
