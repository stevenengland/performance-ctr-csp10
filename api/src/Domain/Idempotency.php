<?php

declare(strict_types=1);

namespace Performance\Domain;

use DateInterval;
use DateTimeImmutable;
use DateTimeZone;
use PDO;
use PDOException;

/**
 * Retry keys for client-UUID writes. A write records its key (the client's UUID) and a
 * fingerprint of its content in the write's own transaction, so the key exists exactly when
 * the write committed, and the key's primary key settles concurrent duplicates. A known key
 * with the same fingerprint replays: the original instant is answered and nothing is written
 * again, even after the written row was removed. A known key with another fingerprint is a
 * conflict. Keys are kept seven days and purged on a later write; after that the key is
 * forgotten. One store serves every kind, so a key is unique across them.
 *
 * The store is `idempotency_keys`. Entry keys recorded before it existed, and those the
 * previous release records during a rollout, are in `entry_requests` (ADR 0006: expand, then
 * contract), so a key is looked up there too and purged from both. A release after this one
 * has been live for seven days drops that table and the fallback.
 */
final readonly class Idempotency
{
    /** Entries carry no tag in their fingerprint: their shape predates the shared store. */
    public const ENTRY = 'entry';
    private const KEEP = 'P7D';
    private const TABLE = 'idempotency_keys';
    /** The previous release's entry keys; read and purged until the contract step drops it. */
    private const PREVIOUS_TABLE = 'entry_requests';

    public function __construct(
        private PDO $pdo,
        private DataRevision $revision,
    ) {}

    /**
     * The fingerprint of a request: its kind's tag and its canonical fields.
     *
     * @param list<int|string|null> $fields
     */
    public static function fingerprint(string $kind, array $fields): string
    {
        $content = $kind === self::ENTRY ? $fields : [$kind, ...$fields];

        return hash('sha256', json_encode($content, JSON_THROW_ON_ERROR));
    }

    /**
     * Runs the write with its key in one transaction (with the revision bump, retried on
     * deadlock), unless the key is known.
     *
     * @param callable(): void $write run once per attempt; it must do nothing outside the database
     *
     * @return DateTimeImmutable|null null when this call wrote; else the instant the key was recorded
     *
     * @throws RequestConflict when the key was used before with another fingerprint
     * @throws PDOException any other failure of the write, rolled back
     */
    public function write(string $key, string $fingerprint, DateTimeImmutable $now, callable $write): ?DateTimeImmutable
    {
        $this->purge($now);
        // The new table's primary key cannot see a key of the previous release, and the row it
        // answered for may be gone (an undone entry), so such a key is answered before writing.
        $previous = $this->recorded(self::PREVIOUS_TABLE, $key);
        if ($previous !== null) {
            return self::answer($key, $fingerprint, $previous);
        }
        try {
            $this->revision->write(function () use ($key, $fingerprint, $now, $write): void {
                $this->pdo->prepare('INSERT INTO ' . self::TABLE . ' (id, fingerprint, created_at) VALUES (?, ?, ?)')
                    ->execute([$key, $fingerprint, Timestamp::of($now)]);
                $write();
            });

            return null;
        } catch (PDOException $failure) {
            if (DatabaseError::is($failure, DatabaseError::DUPLICATE_KEY)) {
                return $this->replay($key, $fingerprint);
            }
            throw $failure;
        }
    }

    /**
     * The duplicate is this store's key, or a key the previous release recorded meanwhile
     * together with the same entry id.
     */
    private function replay(string $key, string $fingerprint): DateTimeImmutable
    {
        return self::answer($key, $fingerprint, $this->recorded(self::TABLE, $key) ?? $this->recorded(self::PREVIOUS_TABLE, $key));
    }

    /**
     * @param array{fingerprint: string, createdAt: string}|null $recorded
     *
     * @throws RequestConflict for another fingerprint, or no key behind the duplicate
     */
    private static function answer(string $key, string $fingerprint, ?array $recorded): DateTimeImmutable
    {
        if ($recorded === null || $recorded['fingerprint'] !== $fingerprint) {
            throw new RequestConflict($key);
        }

        return new DateTimeImmutable($recorded['createdAt'], new DateTimeZone('UTC'));
    }

    /**
     * @return array{fingerprint: string, createdAt: string}|null
     */
    private function recorded(string $table, string $key): ?array
    {
        $statement = $this->pdo->prepare("SELECT fingerprint, created_at FROM {$table} WHERE id = ?");
        $statement->execute([$key]);
        $row = $statement->fetch(PDO::FETCH_ASSOC);
        if (!is_array($row) || !is_string($row['fingerprint'] ?? null) || !is_string($row['created_at'] ?? null)) {
            return null;
        }

        return ['fingerprint' => $row['fingerprint'], 'createdAt' => $row['created_at']];
    }

    private function purge(DateTimeImmutable $now): void
    {
        $before = Timestamp::of($now->sub(new DateInterval(self::KEEP)));
        foreach ([self::TABLE, self::PREVIOUS_TABLE] as $table) {
            $this->pdo->prepare("DELETE FROM {$table} WHERE created_at < ?")->execute([$before]);
        }
    }
}
