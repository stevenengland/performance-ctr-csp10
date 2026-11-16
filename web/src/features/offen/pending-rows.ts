import type { DeepReadonly } from 'vue';
import type { PendingItem } from '../../core/api-client';
import { formatDay, formatMultiplier, formatTime } from '../../core/format';
import { messages } from '../../core/messages';
import { outcomeText } from '../spiele/game-view';

type PendingEntry = Extract<PendingItem, { kind: 'entry' }>;
type PendingMatch = Extract<PendingItem, { kind: 'match' }>;

/** One row on Offen, formatted for display (§7s). */
export interface PendingRow {
  id: string;
  kind: PendingItem['kind'];
  /** `2× Bier für Daniel`, or `Anna – Ben · Anna gewinnt`. */
  title: string;
  /**
  `Happy Hour ×2 · 15.11., 21:00 · anna`, or `Schach · 15.11., 21:00 · anna` with
  `Schach · vor dem Neustart · …` for a match of an earlier run; `Kein Faktor`,
  `gelöschte Person`, `gelöschtes Konto` where they apply.
  */
  details: string;
  /** The button's accessible name: `2× Bier für Daniel bestätigen`. */
  verifyLabel: string;
  /** The button's accessible name: `2× Bier für Daniel ablehnen`. */
  rejectLabel: string;
}

/** What a pending row is about: its title and what comes before the time in its details. */
function about(item: DeepReadonly<PendingItem>): {
  title: string;
  what: string;
} {
  return item.kind === 'entry' ? entryAbout(item) : matchAbout(item);
}

function entryAbout(item: DeepReadonly<PendingEntry>) {
  return {
    title: messages.offen.entry(
      messages.zaehlen.quantityOf(item.quantity, item.drink.name),
      item.person.name,
    ),
    what: item.factor
      ? `${item.factor.name} ${formatMultiplier(item.factor.multiplier)}`
      : messages.zaehlen.noFactor,
  };
}

function matchAbout(item: DeepReadonly<PendingMatch>) {
  const first = item.first?.name ?? messages.spiele.deletedPerson;
  const second = item.second?.name ?? messages.spiele.deletedPerson;
  return {
    title: messages.spiele.savedMatch(
      messages.spiele.pairing(first, second),
      outcomeText(item.outcome, first, second),
    ),
    what: item.earlierRun
      ? messages.offen.earlierRun(item.game.name)
      : item.game.name,
  };
}

/** The queue's items in its order, as Offen shows them; times in the browser's time zone unless one is given. */
export function pendingRows(
  items: DeepReadonly<PendingItem[]>,
  timeZone?: string,
): PendingRow[] {
  return items.map((item) => {
    const at = new Date(item.createdAt);
    const { title, what } = about(item);
    return {
      id: item.id,
      kind: item.kind,
      title,
      details: messages.offen.details(
        what,
        formatDay(at, timeZone),
        formatTime(at, timeZone),
        item.accountName ?? messages.verlauf.deletedAccount,
      ),
      verifyLabel: messages.offen.verifyLabel(title),
      rejectLabel: messages.offen.rejectLabel(title),
    };
  });
}
