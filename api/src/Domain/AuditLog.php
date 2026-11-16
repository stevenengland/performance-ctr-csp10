<?php

declare(strict_types=1);

namespace Performance\Domain;

use DateTimeImmutable;
use DateTimeZone;
use LogicException;
use PDO;

/**
 * The audit log: application-level append-only history of the changes to entries, persons,
 * drinks and factors. It can append an event and read events back, nothing else.
 *
 * Callers say what they alone know: the actor, the operation, the subject and its values
 * before and after the change. The log owns the rest: it checks that the values fit the
 * operation, encodes the snapshots with their version, stamps the time, gives the event its
 * id, skips an update that changed no value, and stores it. It records only inside the
 * transaction of the change itself, so a change and its events commit or roll back together.
 */
final readonly class AuditLog
{
    /** The shape of the snapshots written now; raised only if a breaking change is ever unavoidable. */
    public const SNAPSHOT_VERSION = 1;
    public const PAGE_SIZE = 20;

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
        if (!$this->pdo->inTransaction()) {
            throw new LogicException('An audit event is recorded only in the transaction of its change');
        }
        self::checkSnapshots($operation, $before, $after);
        if ($operation === AuditOperation::Update && $before === $after) {
            return null;
        }
        $this->pdo->prepare(
            'INSERT INTO audit_events (occurred_at, operation, subject_kind, subject_id, actor_account_id, actor_user_name,
                before_json, after_json, snapshot_version)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
        )->execute([
            Timestamp::of($this->clock->now()),
            $operation->value,
            $subjectKind->value,
            $subjectId,
            $actor->accountId,
            $actor->userName,
            self::encode($before),
            self::encode($after),
            self::SNAPSHOT_VERSION,
        ]);

        return (int) $this->pdo->lastInsertId();
    }

    /**
     * The newest events, newest first.
     *
     * @return list<AuditEvent>
     */
    public function page(): array
    {
        $statement = $this->pdo->prepare(
            'SELECT id, occurred_at, operation, subject_kind, subject_id, actor_account_id, actor_user_name, before_json, after_json
               FROM audit_events
              ORDER BY id DESC
              LIMIT ' . self::PAGE_SIZE,
        );
        $statement->execute();

        /** @var list<array<string, scalar|null>> $rows */
        $rows = $statement->fetchAll(PDO::FETCH_ASSOC);

        return array_map(self::eventOf(...), $rows);
    }

    /**
     * @param array<string, mixed>|null $before
     * @param array<string, mixed>|null $after
     */
    private static function checkSnapshots(AuditOperation $operation, ?array $before, ?array $after): void
    {
        $fits = match ($operation) {
            AuditOperation::Create => $before === null && $after !== null,
            AuditOperation::Update => $before !== null && $after !== null,
            AuditOperation::Delete => $before !== null && $after === null,
        };
        if (!$fits) {
            throw new LogicException("The snapshots do not fit a {$operation->value}");
        }
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
        );
    }
}
