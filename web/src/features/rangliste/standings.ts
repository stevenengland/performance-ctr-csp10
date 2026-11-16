import type { DeepReadonly } from 'vue';
import type { Scoreboard } from '../../core/api-client';
import { formatNumber, formatPoints } from '../../core/format';
import { messages } from '../../core/messages';

/** One person on the Rangliste, formatted for display (§7f). */
export interface Standing {
  personId: number;
  rank: number;
  name: string;
  /** The person's photo, or `null` for initials. */
  photoUrl: string | null;
  /** Total score today: `13,5`. */
  score: string;
  /** Total count today, for the tally. */
  count: number;
  /** `9 Getränke`. */
  countText: string;
  /** Per-drink counters: `Bier 4 · Margarita 1`. */
  drinks: string;
  /** Accessible name: `Platz 1, Daniel, 13,5 Punkte, 9 Getränke`. */
  label: string;
}

/**
The scoreboard's rows as the Rangliste shows them. The API owns the ranking (score,
ties by name); the rank is the position.
*/
export function standingsOf(board: DeepReadonly<Scoreboard>): Standing[] {
  return board.rows.map((row, index) => {
    const rank = index + 1;
    const countText = messages.rangliste.drinks(
      formatNumber(row.count),
      row.count,
    );
    return {
      personId: row.personId,
      rank,
      name: row.name,
      photoUrl: row.photoUrl,
      score: formatNumber(row.score),
      count: row.count,
      countText,
      drinks: row.drinks
        .map((drink) => `${drink.name} ${formatNumber(drink.count)}`)
        .join(' · '),
      label: messages.rangliste.label(
        rank,
        row.name,
        formatPoints(row.score),
        countText,
      ),
    };
  });
}
