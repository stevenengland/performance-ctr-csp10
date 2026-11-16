import type { DeepReadonly } from 'vue';
import {
  formatMultiplier,
  formatPoints,
  formatSigned,
  formatTime,
} from '../../../core/format';
import { messages } from '../../../core/messages';

/*
Protokoll's rows (§7l), formatted from audit events. Plain functions over the
event's shape, without the API client, so the fixture preview can use them as
they are.
*/

type Operation = 'create' | 'update' | 'delete';
type SubjectKind = keyof typeof messages.protokoll.kind;

/** A subject's values as an event recorded them; a key that is missing is unknown. */
export interface AuditSnapshotView {
  name?: string;
  points?: number;
  multiplier?: number;
  person?: string;
  drink?: string;
  quantity?: number;
  factor?: { name?: string; multiplier?: number } | null;
  game?: string;
  /** A match's persons; null once that person was deleted. */
  first?: string | null;
  second?: string | null;
  outcome?: 'first' | 'second' | 'draw';
}

/** What Protokoll reads of an audit event of the API. */
export interface AuditEventView {
  id: number;
  occurredAt: string;
  operation: Operation;
  subjectKind: SubjectKind;
  actor: { userName: string };
  before: AuditSnapshotView | null;
  after: AuditSnapshotView | null;
  cause: { name: string } | null;
}

/** One event on Protokoll. */
export interface AuditRow {
  id: number;
  operation: Operation;
  /** The operation chip: `Angelegt`, `Geändert`, `Gelöscht`. */
  operationLabel: string;
  /** `Getränk Bier`, `Eintrag 2× Bier für Daniel`. */
  title: string;
  /** `Punkte: 1 Punkt → 0,5 Punkte` for an update, the values (`1 Punkt`) otherwise; empty when there are none. */
  changes: string;
  /** `23:41 · anna`. */
  by: string;
  /** `durch Löschen von Wein` for a consequential event. */
  cause?: string;
}

/** The rows of one calendar day under its heading. */
export interface AuditDay {
  /** `Heute`, `Gestern` or the date: `Sa., 14.11.2026`. */
  label: string;
  rows: AuditRow[];
}

type Snapshot = DeepReadonly<AuditSnapshotView>;
type Field = readonly [label: string, value: string];

const MS_PER_DAY = 86_400_000;
const text = messages.protokoll;

/** `Happy Hour ×2`, from the keys the factor has; `Kein Faktor` for none. */
const factorText = (factor: Snapshot['factor']) =>
  factor
    ? [
        factor.name,
        factor.multiplier === undefined
          ? undefined
          : formatMultiplier(factor.multiplier),
      ]
        .filter((part) => part !== undefined)
        .join(' ')
    : messages.zaehlen.noFactor;

/**
An entry's `2× Bier für Daniel`, from the parts the snapshot has: a missing key
is unknown, so it is left out (`Bier für Daniel`), never shown as 0 or blank.
*/
function entryName({ quantity, drink, person }: Snapshot): string {
  const what =
    quantity === undefined
      ? drink
      : messages.zaehlen.quantityOf(quantity, drink ?? '').trimEnd();
  if (person === undefined) return what ?? '';
  return text.entry(what ?? '', person).trimStart();
}

/** A match side's name: the person's, `gelöschte Person` once cleared, empty when unknown. */
const sideName = (side: string | null | undefined) =>
  side === null ? text.deletedPerson : (side ?? '');

/** A match's `Anna gewinnt` or `Remis`; empty when a part is unknown. */
function outcomeText({ outcome, first, second }: Snapshot): string {
  if (outcome === 'draw') return text.draw;
  const winner = sideName(outcome === 'first' ? first : second);
  return outcome === undefined || winner === '' ? '' : text.wins(winner);
}

/** A person's, drink's, factor's or game's name, an entry's `2× Bier für Daniel`, a match's `Anna – Ben`, a result's person; empty when unknown. */
function subjectName(kind: SubjectKind, snapshot: Snapshot): string {
  if (kind === 'entry') return entryName(snapshot);
  if (kind === 'result') return snapshot.person ?? '';
  if (kind === 'match') {
    return text.match(sideName(snapshot.first), sideName(snapshot.second));
  }
  return snapshot.name ?? '';
}

/** `Getränk Bier`, or only the kind when the name is unknown. */
function title(kind: SubjectKind, snapshot: Snapshot): string {
  const name = subjectName(kind, snapshot);
  return name === '' ? text.kind[kind] : text.subject(text.kind[kind], name);
}

/** A result's known values: its game, then its points as a game shows them (`−20 Punkte`). */
function resultFields({ game, points }: Snapshot): Field[] {
  const known: Field[] = [];
  if (game !== undefined) known.push([text.game, game]);
  if (points !== undefined) {
    known.push([
      text.points,
      messages.spiele.gamePoints(formatSigned(points), points),
    ]);
  }
  return known;
}

/** The snapshot's known values, labelled and formatted. */
function fields(kind: SubjectKind, snapshot: Snapshot): Field[] {
  if (kind === 'result') return resultFields(snapshot);
  const known: Field[] = [];
  if (snapshot.name !== undefined) known.push([text.name, snapshot.name]);
  if (snapshot.person !== undefined) {
    known.push([text.kind.entry, entryName(snapshot)]);
  }
  if (snapshot.points !== undefined) {
    known.push([text.points, formatPoints(snapshot.points)]);
  }
  if (snapshot.multiplier !== undefined) {
    known.push([text.multiplier, formatMultiplier(snapshot.multiplier)]);
  }
  if (snapshot.factor !== undefined) {
    known.push([text.factor, factorText(snapshot.factor)]);
  }
  if (snapshot.game !== undefined) known.push([text.game, snapshot.game]);
  if (snapshot.outcome !== undefined) {
    known.push([text.outcome, outcomeText(snapshot)]);
  }
  return known;
}

/** An update's changed values as before → after; a create's or delete's values without the name the title already gives. */
function changes(event: DeepReadonly<AuditEventView>): string[] {
  const { before, after, subjectKind } = event;
  if (before && after) {
    const was = new Map(fields(subjectKind, before));
    return fields(subjectKind, after)
      .filter(([label, value]) => was.has(label) && was.get(label) !== value)
      .map(([label, value]) => text.change(label, was.get(label) ?? '', value));
  }
  const snapshot = after ?? before;
  if (!snapshot) return [];
  return fields(subjectKind, snapshot)
    .filter(
      ([label, value]) =>
        label !== text.name &&
        label !== text.kind.entry &&
        value !== '' &&
        value !== messages.zaehlen.noFactor,
    )
    .map(([, value]) => value);
}

/** The calendar day of an instant in the time zone, counted in days since 1970. */
function dayNumber(instant: Date, timeZone?: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    timeZone,
  }).formatToParts(instant);
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    Number(parts.find((candidate) => candidate.type === type)?.value);
  return Date.UTC(part('year'), part('month') - 1, part('day')) / MS_PER_DAY;
}

function dayLabel(instant: Date, daysAgo: number, timeZone?: string): string {
  if (daysAgo === 0) return text.today;
  if (daysAgo === 1) return text.yesterday;
  return new Intl.DateTimeFormat('de-DE', {
    weekday: 'short',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    timeZone,
  }).format(instant);
}

function auditRow(
  event: DeepReadonly<AuditEventView>,
  instant: Date,
  timeZone?: string,
): AuditRow {
  const snapshot = event.after ?? event.before ?? {};
  return {
    id: event.id,
    operation: event.operation,
    operationLabel: text.operation[event.operation],
    title: title(event.subjectKind, snapshot),
    changes: changes(event).join(' · '),
    by: text.by(formatTime(instant, timeZone), event.actor.userName),
    cause: event.cause ? text.causedBy(event.cause.name) : undefined,
  };
}

/**
The API's events, newest first, as Protokoll shows them: under the calendar day
they happened on, relative to `now`, in the browser's time zone unless one is given.
*/
export function auditDays(
  events: DeepReadonly<AuditEventView[]>,
  now: Date = new Date(),
  timeZone?: string,
): AuditDay[] {
  const today = dayNumber(now, timeZone);
  const days: AuditDay[] = [];
  let current: { day: number; group: AuditDay } | undefined;
  for (const event of events) {
    const instant = new Date(event.occurredAt);
    const day = dayNumber(instant, timeZone);
    if (current?.day !== day) {
      current = {
        day,
        group: { label: dayLabel(instant, today - day, timeZone), rows: [] },
      };
      days.push(current.group);
    }
    current.group.rows.push(auditRow(event, instant, timeZone));
  }
  return days;
}
