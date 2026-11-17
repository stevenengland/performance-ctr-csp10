import type { DeepReadonly } from 'vue';
import type { HistoryEntry } from '../../core/api-client';
import { formatMultiplier, formatTime } from '../../core/format';
import { messages } from '../../core/messages';

/** A person's Verlauf, reached from the Rangliste and from Verwalten → Personen. */
export function verlaufPath(personId: number): string {
  return `/verlauf/${String(personId)}`;
}

/** One entry on Verlauf, formatted for display (§7g). */
export interface HistoryRow {
  id: string;
  /** `2× Bier`. */
  title: string;
  /** `Happy Hour ×2 · 23:41 · anna`; `Kein Faktor`, `gelöschtes Konto` where they apply. */
  details: string;
  /** The delete icon button's accessible name: `2× Bier um 23:41 löschen`. */
  removeLabel: string;
  /** The confirmation dialog's body (§6.9): `2× Bier · Happy Hour ×2 um 23:41`. */
  removeBody: string;
  /** `offen` while the entry waits for verification. */
  pending?: string;
}

/** The API's entries, newest first, as Verlauf shows them; times in the browser's time zone unless one is given. */
export function historyRows(
  entries: DeepReadonly<HistoryEntry[]>,
  timeZone?: string,
): HistoryRow[] {
  return entries.map((entry) => {
    const title = messages.zaehlen.quantityOf(entry.quantity, entry.drink.name);
    const time = formatTime(new Date(entry.createdAt), timeZone);
    const factor = entry.factor
      ? `${entry.factor.name} ${formatMultiplier(entry.factor.multiplier)}`
      : undefined;
    return {
      id: entry.id,
      title,
      details: messages.verlauf.details(
        factor ?? messages.zaehlen.noFactor,
        time,
        entry.accountName ?? messages.verlauf.deletedAccount,
      ),
      removeLabel: messages.verlauf.remove(title, time),
      removeBody: messages.verlauf.removeBody(title, time, factor),
      pending: entry.pending ? messages.pending.marker : undefined,
    };
  });
}
