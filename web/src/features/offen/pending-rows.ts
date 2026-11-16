import type { DeepReadonly } from 'vue';
import type { PendingItem } from '../../core/api-client';
import { formatDay, formatMultiplier, formatTime } from '../../core/format';
import { messages } from '../../core/messages';

/** One row on Offen, formatted for display (§7s). */
export interface PendingRow {
  id: string;
  kind: PendingItem['kind'];
  /** `2× Bier für Daniel`. */
  title: string;
  /** `Happy Hour ×2 · 15.11., 21:00 · anna`; `Kein Faktor`, `gelöschtes Konto` where they apply. */
  details: string;
  /** The button's accessible name: `2× Bier für Daniel bestätigen`. */
  verifyLabel: string;
}

/** The queue's items in its order, as Offen shows them; times in the browser's time zone unless one is given. */
export function pendingRows(
  items: DeepReadonly<PendingItem[]>,
  timeZone?: string,
): PendingRow[] {
  return items.map((item) => {
    const at = new Date(item.createdAt);
    const title = messages.offen.entry(
      messages.zaehlen.quantityOf(item.quantity, item.drink.name),
      item.person.name,
    );
    const factor = item.factor
      ? `${item.factor.name} ${formatMultiplier(item.factor.multiplier)}`
      : messages.zaehlen.noFactor;
    return {
      id: item.id,
      kind: item.kind,
      title,
      details: messages.offen.details(
        factor,
        formatDay(at, timeZone),
        formatTime(at, timeZone),
        item.accountName ?? messages.verlauf.deletedAccount,
      ),
      verifyLabel: messages.offen.verifyLabel(title),
    };
  });
}
