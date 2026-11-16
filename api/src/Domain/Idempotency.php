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
 */
final readonly class Idempotency
{
    /** Entries carry no tag in their fingerprint: their shape predates the shared store. */
    public const ENTRY = 'entry';
    private const KEEP = 'P7D';

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
        try {
            $this->revision->write(function () use ($key, $fingerprint, $now, $write): void {
                $this->pdo->prepare('INSERT INTO entry_requests (id, fingerprint, created_at) VALUES (?, ?, ?)')
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

    private function replay(string $key, string $fingerprint): DateTimeImmutable
    {
        $statement = $this->pdo->prepare('SELECT fingerprint, created_at FROM entry_requests WHERE id = ?');
        $statement->execute([$key]);
        $recorded = $statement->fetch(PDO::FETCH_ASSOC);
        $recordedAt = is_array($recorded) ? ($recorded['created_at'] ?? null) : null;
        if (!is_array($recorded) || $recorded['fingerprint'] !== $fingerprint || !is_string($recordedAt)) {
            throw new RequestConflict($key);
        }

        return new DateTimeImmutable($recordedAt, new DateTimeZone('UTC'));
    }

    private function purge(DateTimeImmutable $now): void
    {
        $this->pdo->prepare('DELETE FROM entry_requests WHERE created_at < ?')
            ->execute([Timestamp::of($now->sub(new DateInterval(self::KEEP)))]);
    }
}
