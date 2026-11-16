<?php

declare(strict_types=1);

namespace Performance\Domain;

use DateTimeImmutable;
use DateTimeZone;
use LogicException;
use PDO;

/**
 * The audit log: application-level append-only history of the changes to entries, persons,
 * drinks, factors, games, matches and results. It can append an event and read events back, nothing else.
 *
 * Callers say what they alone know: the actor, the operation, the subject and its values
 * before and after the change. The log owns the rest: it checks that the values fit the
 * operation, encodes the snapshots with their version, stamps the time, gives the event its
 * id, skips an update that changed no value, links the events a deletion brings about to it
 * as their cause, and stores them. It records only inside the transaction of the change
 * itself, so a change and its events commit or roll back together.
 */
final readonly class AuditLog
{
    /** The shape of the snapshots written now; raised only if a breaking change is ever unavoidable. */
    public const SNAPSHOT_VERSION = 1;
    /** Events per page when the reader names no limit. */
    public const PAGE_SIZE = 20;
    public const MAX_PAGE_SIZE = 100;
    /** Events per insert statement when one change records many; keeps a statement well below the placeholder limit. */
    private const BATCH_SIZE = 500;
    private const COLUMNS_PER_EVENT = 10;

    public function __construct(
        private PDO $pdo,
        private Clock $clock,
    ) {}

    /**
     * Records one change of one row. Decimals in a snapshot are the domain's fixed-scale strings
     * (`"1.50"`), referenced names are resolved, ids are left out.
     *
     * @param array<string, mixed>|null $before the subject's values before the change: null for a create, required otherwise
     * @param array<string, mixed>|null $after  the subject's values after the change: null for a delete, required otherwise
     *
     * @return int|null the event's id; null for an update that changed no value, which records nothing
     *
     * @throws LogicException outside a transaction, or when the snapshots do not fit the operation
     */
    public function record(
        Actor $actor,
        AuditOperation $operation,
        AuditSubjectKind $subjectKind,
        string $subjectId,
        ?array $before,
        ?array $after,
    ): ?int {
        $this->checkTransaction();
        if (!self::changes($operation, $before, $after)) {
            return null;
        }
        $this->insert($actor, null, [[$operation, $subjectKind, $subjectId, $before, $after]]);

        return (int) $this->pdo->lastInsertId();
    }

    /**
     * Records the deletion of a person, drink or factor, then what it does to each of its
     * entries: one event per entry, in the order given, each linked to the deletion as its
     * cause (see recordCaused).
     *
     * @param array<string, mixed>                                                     $before         the deleted row's values
     * @param AuditOperation                                                           $entryOperation delete for entries removed with the row, update for entries it changes
     * @param iterable<array{string, array<string, mixed>, array<string, mixed>|null}> $entries        each affected entry's id and its values before and after
     *
     * @return int the deletion's event id
     *
     * @throws LogicException outside a transaction, or when a snapshot does not fit its operation
     */
    public function recordDeletion(
        Actor $actor,
        AuditSubjectKind $subjectKind,
        string $subjectId,
        array $before,
        AuditOperation $entryOperation,
        iterable $entries,
    ): int {
        $cause = (int) $this->record($actor, AuditOperation::Delete, $subjectKind, $subjectId, $before, null);
        $this->recordCaused($actor, $cause, $entryOperation, AuditSubjectKind::Entry, $entries);

        return $cause;
    }

    /**
     * Records what a deletion already recorded as `$cause` does to the rows that depend on the
     * deleted one: one event per row, in the order given, each linked to the cause. The events
     * are stored in batches as they come, not one statement each and not all at once, so
     * `$changes` may be read lazily, chunk by chunk. An update that changes no value records
     * nothing.
     *
     * @param iterable<array{string, array<string, mixed>, array<string, mixed>|null}> $changes each affected row's id and its values before and after
     *
     * @throws LogicException outside a transaction, or when a snapshot does not fit the operation
     */
    public function recordCaused(Actor $actor, int $cause, AuditOperation $operation, AuditSubjectKind $subjectKind, iterable $changes): void
    {
        $this->checkTransaction();
        $batch = [];
        foreach ($changes as [$subjectId, $before, $after]) {
            if (self::changes($operation, $before, $after)) {
                $batch[] = [$operation, $subjectKind, $subjectId, $before, $after];
            }
            if (count($batch) === self::BATCH_SIZE) {
                $this->insert($actor, $cause, $batch);
                $batch = [];
            }
        }
        if ($batch !== []) {
            $this->insert($actor, $cause, $batch);
        }
    }

    /**
     * A page of events, newest first: the newest ones, or with `$before` the newest of those
     * older than that event. The page says where the next older one starts, and only when an
     * older event exists, so a log of exactly `$limit` events is one page, not two.
     *
     * @param int|null $before an event id; only older events are read. Null reads from the newest.
     * @param int      $limit  events per page, 1 to MAX_PAGE_SIZE
     *
     * @throws ValidationFailed when `$before` is not a positive id or `$limit` is out of range
     */
    public function page(?int $before = null, int $limit = self::PAGE_SIZE): AuditPage
    {
        $errors = [];
        if ($before !== null && $before < 1) {
            $errors['before'] = 'Positive ganze Zahl.';
        }
        if ($limit < 1 || $limit > self::MAX_PAGE_SIZE) {
            $errors['limit'] = sprintf('1 bis %d.', self::MAX_PAGE_SIZE);
        }
        if ($errors !== []) {
            throw new ValidationFailed($errors);
        }

        // One event more than the page holds tells whether an older page exists.
        $statement = $this->pdo->prepare(
            'SELECT e.id, e.occurred_at, e.operation, e.subject_kind, e.subject_id, e.actor_account_id, e.actor_user_name,
                    e.before_json, e.after_json, e.cause_id,
                    c.subject_kind AS cause_kind, c.before_json AS cause_before_json, c.after_json AS cause_after_json
               FROM audit_events e
               LEFT JOIN audit_events c ON c.id = e.cause_id
              ' . ($before === null ? '' : 'WHERE e.id < ?') . '
              ORDER BY e.id DESC
              LIMIT ' . ($limit + 1),
        );
        $statement->execute($before === null ? [] : [$before]);

        /** @var list<array<string, scalar|null>> $rows */
        $rows = $statement->fetchAll(PDO::FETCH_ASSOC);
        $events = array_map(self::eventOf(...), array_slice($rows, 0, $limit));
        $oldest = end($events);

        return new AuditPage($events, count($rows) > $limit && $oldest !== false ? $oldest->id : null);
    }

    private function checkTransaction(): void
    {
        if (!$this->pdo->inTransaction()) {
            throw new LogicException('An audit event is recorded only in the transaction of its change');
        }
    }

    /**
     * Whether a change is one to record: its snapshots must fit the operation, and an update
     * whose values stayed the same is not.
     *
     * @param array<string, mixed>|null $before
     * @param array<string, mixed>|null $after
     *
     * @throws LogicException when the snapshots do not fit the operation
     */
    private static function changes(AuditOperation $operation, ?array $before, ?array $after): bool
    {
        $fits = match ($operation) {
            AuditOperation::Create => $before === null && $after !== null,
            AuditOperation::Update, AuditOperation::Verify => $before !== null && $after !== null,
            AuditOperation::Delete, AuditOperation::Reject => $before !== null && $after === null,
        };
        if (!$fits) {
            throw new LogicException("The snapshots do not fit a {$operation->value}");
        }

        return $operation !== AuditOperation::Update || $before !== $after;
    }

    /**
     * Stores events of one actor and one moment with one statement, in the order given.
     *
     * @param list<array{AuditOperation, AuditSubjectKind, string, array<string, mixed>|null, array<string, mixed>|null}> $changes
     */
    private function insert(Actor $actor, ?int $cause, array $changes): void
    {
        $occurredAt = Timestamp::of($this->clock->now());
        $values = [];
        foreach ($changes as [$operation, $subjectKind, $subjectId, $before, $after]) {
            array_push(
                $values,
                $occurredAt,
                $operation->value,
                $subjectKind->value,
                $subjectId,
                $actor->accountId,
                $actor->userName,
                self::encode($before),
                self::encode($after),
                self::SNAPSHOT_VERSION,
                $cause,
            );
        }
        $row = '(' . implode(', ', array_fill(0, self::COLUMNS_PER_EVENT, '?')) . ')';
        $this->pdo->prepare(
            'INSERT INTO audit_events (occurred_at, operation, subject_kind, subject_id, actor_account_id, actor_user_name,
                before_json, after_json, snapshot_version, cause_id)
             VALUES ' . implode(', ', array_fill(0, count($changes), $row)),
        )->execute($values);
    }

    /**
     * @param array<string, mixed>|null $snapshot
     */
    private static function encode(?array $snapshot): ?string
    {
        return $snapshot === null ? null : json_encode($snapshot, JSON_THROW_ON_ERROR | JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE);
    }

    /**
     * @return array<string, mixed>|null
     */
    private static function decode(string|int|float|bool|null $json): ?array
    {
        if (!is_string($json)) {
            return null;
        }
        $snapshot = json_decode($json, true, flags: JSON_THROW_ON_ERROR);

        /** @var array<string, mixed>|null */
        return is_array($snapshot) ? $snapshot : null;
    }

    /**
     * @param array<string, scalar|null> $row
     */
    private static function eventOf(array $row): AuditEvent
    {
        return new AuditEvent(
            (int) $row['id'],
            new DateTimeImmutable((string) $row['occurred_at'], new DateTimeZone('UTC')),
            AuditOperation::from((string) $row['operation']),
            AuditSubjectKind::from((string) $row['subject_kind']),
            (string) $row['subject_id'],
            new Actor((int) $row['actor_account_id'], (string) $row['actor_user_name']),
            self::decode($row['before_json']),
            self::decode($row['after_json']),
            self::causeOf($row),
        );
    }

    /**
     * The causing event of a row read with its cause joined, named as its own snapshot names it.
     *
     * @param array<string, scalar|null> $row
     */
    private static function causeOf(array $row): ?AuditCause
    {
        if ($row['cause_id'] === null) {
            return null;
        }
        $snapshot = self::decode($row['cause_after_json']) ?? self::decode($row['cause_before_json']);
        $name = $snapshot['name'] ?? null;

        return new AuditCause((int) $row['cause_id'], AuditSubjectKind::from((string) $row['cause_kind']), is_string($name) ? $name : '');
    }
}
