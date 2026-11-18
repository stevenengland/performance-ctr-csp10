import type { DeepReadonly } from 'vue';
import type { HistoryEntry } from '../../core/api-client';
import { formatDay, formatMultiplier, formatTime } from '../../core/format';
import { messages } from '../../core/messages';
import {
  addDays,
  type CalendarDate,
  isAfter,
  isoDate,
} from '../../core/period';

/**
A person's Verlauf, reached from the Rangliste and from Verwalten → Personen: of
today, or of a past `day` (`/verlauf/3?tag=2026-11-14`) from a day the Rangliste shows.
*/
export function verlaufPath(personId: number, day?: CalendarDate): string {
  const path = `/verlauf/${String(personId)}`;
  return day ? `${path}?tag=${isoDate(day)}` : path;
}

const TAG = /^(\d{4})-(\d{2})-(\d{2})$/;

/**
The day a Verlauf shows: the past day its `tag` names (`2026-11-14`), held as a
calendar date; today without a `tag`, or for one that names no date or a day after
today.
*/
export function dayOfTag(tag: unknown, today: CalendarDate): CalendarDate {
  const parts = typeof tag === 'string' ? TAG.exec(tag) : null;
  if (!parts) return today;
  const [year, month, day] = parts.slice(1).map(Number) as [
    number,
    number,
    number,
  ];
  // Calendar addition rolls an impossible date over (30.02. → 02.03.).
  const date = addDays({ year, month, day }, 0);
  return isoDate(date) === tag && !isAfter(date, today) ? date : today;
}

/** One entry on Verlauf, formatted for display (§7g). */
export interface HistoryRow {
  id: string;
  /** `2× Bier`. */
  title: string;
  /** `Happy Hour ×2 · 15.11., 23:41 · anna`; `Kein Faktor`, `gelöschtes Konto` where they apply. */
  details: string;
  /** The delete icon button's accessible name: `2× Bier um 23:41 löschen`. */
  removeLabel: string;
  /** The confirmation dialog's body (§6.9): `2× Bier · Happy Hour ×2 um 23:41`. */
  removeBody: string;
  /** `offen` while the entry waits for verification. */
  pending?: string;
}

/** The API's entries, newest first, as Verlauf shows them; days and times in the browser's time zone unless one is given. */
export function historyRows(
  entries: DeepReadonly<HistoryEntry[]>,
  timeZone?: string,
): HistoryRow[] {
  return entries.map((entry) => {
    const title = messages.zaehlen.quantityOf(entry.quantity, entry.drink.name);
    const createdAt = new Date(entry.createdAt);
    const time = formatTime(createdAt, timeZone);
    const factor = entry.factor
      ? `${entry.factor.name} ${formatMultiplier(entry.factor.multiplier)}`
      : undefined;
    return {
      id: entry.id,
      title,
      details: messages.verlauf.details(
        factor ?? messages.zaehlen.noFactor,
        formatDay(createdAt, timeZone),
        time,
        entry.accountName ?? messages.verlauf.deletedAccount,
      ),
      removeLabel: messages.verlauf.remove(title, time),
      removeBody: messages.verlauf.removeBody(title, time, factor),
      pending: entry.pending ? messages.pending.marker : undefined,
    };
  });
}
