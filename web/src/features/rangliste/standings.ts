import type { DeepReadonly } from 'vue';
import type { Scoreboard } from '../../core/api-client';
import { formatNumber, formatPoints } from '../../core/format';
import { messages } from '../../core/messages';

type DrinkCounters = DeepReadonly<Scoreboard['rows'][number]['drinks']>;

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
function drinksText(
  drinks: DrinkCounters,
  counter: 'count' | 'recordedCount',
): string {
  return drinks
    .filter((drink) => drink[counter] > 0)
    .map((drink) => `${drink.name} ${formatNumber(drink[counter])}`)
    .join(' · ');
}

/**
The scoreboard's ranked rows as the Rangliste shows them. The API owns the ranking
(score, ties by name); the rank is the position.
*/
export function standingsOf(board: DeepReadonly<Scoreboard>): Standing[] {
  return board.rows.map((row, index) => {
    const rank = index + 1;
    const countText = messages.rangliste.drinks(
      formatNumber(row.count),
      row.count,
    );
    const pending =
      row.pendingCount > 0 ? messages.pending.hint(row.pendingCount) : undefined;
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
      count: row.count,
      countText,
      drinks: drinksText(row.drinks, 'count'),
      pending,
      label: pending === undefined ? label : `${label}, ${pending}`,
    };
  });
}

/** The persons whose entries of today all wait, by name, as the Rangliste lists them apart. */
export function unrankedOf(board: DeepReadonly<Scoreboard>): UnrankedStanding[] {
  return board.unranked.map((row) => {
    const drinks = drinksText(row.drinks, 'recordedCount');
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
