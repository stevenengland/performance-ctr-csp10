<?php

declare(strict_types=1);

namespace Performance\Domain;

use DateTimeImmutable;
use DateTimeZone;
use PDO;
use PDOException;

/**
 * The entry log. Adding is idempotent on the client's entry id: the id and a
 * fingerprint of the content are recorded in `entry_requests` in the same
 * transaction as the entry, and its primary key settles concurrent duplicates.
 * A known id answers with the original outcome and never recreates an undone
 * entry; different content under a known id is a conflict. Requests are kept
 * seven days and purged on a later add.
 */
final readonly class EntryLedger
{
    public const MAX_QUANTITY = 99;
    private const KEEP_REQUESTS = 'P7D';
    private const ATTEMPTS = 3;

    public function __construct(
        private PDO $pdo,
        private Clock $clock,
        private DataRevision $revision,
    ) {}

    /**
     * @throws ValidationFailed for a quantity outside 1–99 or a person or drink that does not exist
     * @throws EntryConflict when the id was used before for different content
     */
    public function add(string $id, ?int $personId, ?int $drinkId, ?int $quantity, int $accountId): AddedEntry
    {
        if ($quantity === null || $quantity < 1 || $quantity > self::MAX_QUANTITY) {
            throw new ValidationFailed(['quantity' => sprintf('1 bis %d.', self::MAX_QUANTITY)]);
        }
        $now = $this->clock->now();
        $this->purge($now);
        $fingerprint = hash('sha256', json_encode([$personId, $drinkId, $quantity], JSON_THROW_ON_ERROR));

        for ($attempt = 1; ; ++$attempt) {
            try {
                // A missing id is a row that does not exist (ids start at 1): the foreign keys reject it.
                return $this->record(new Entry($id, $personId ?? 0, $drinkId ?? 0, $quantity, $now), $fingerprint, $accountId);
            } catch (PDOException $failure) {
                // A deadlock between duplicates whose first request rolled back: try again.
                if ($attempt === self::ATTEMPTS || !DatabaseError::is($failure, DatabaseError::DEADLOCK)) {
                    throw $failure;
                }
            }
        }
    }

    /**
     * @throws NotFound when there is no such entry
     */
    public function delete(string $id): void
    {
        $this->revision->write(function () use ($id): void {
            $statement = $this->pdo->prepare('DELETE FROM entries WHERE id = ?');
            $statement->execute([$id]);
            if ($statement->rowCount() === 0) {
                throw new NotFound($id);
            }
        });
    }

    private function record(Entry $entry, string $fingerprint, int $accountId): AddedEntry
    {
        try {
            $this->revision->write(function () use ($entry, $fingerprint, $accountId): void {
                $this->pdo->prepare('INSERT INTO entry_requests (id, fingerprint, created_at) VALUES (?, ?, ?)')
                    ->execute([$entry->id, $fingerprint, Timestamp::of($entry->createdAt)]);
                $this->pdo->prepare(
                    'INSERT INTO entries (id, person_id, drink_id, quantity, account_id, created_at) VALUES (?, ?, ?, ?, ?, ?)',
                )->execute([$entry->id, $entry->personId, $entry->drinkId, $entry->quantity, $accountId, Timestamp::of($entry->createdAt)]);
            });

            return new AddedEntry($entry, true);
        } catch (PDOException $failure) {
            if (DatabaseError::is($failure, DatabaseError::DUPLICATE_KEY)) {
                return $this->replay($entry, $fingerprint);
            }
            $missing = DatabaseError::is($failure, DatabaseError::MISSING_PARENT)
                ? self::missing($this->exists('persons', $entry->personId), $this->exists('drinks', $entry->drinkId))
                : [];
            if ($missing !== []) {
                throw new ValidationFailed($missing);
            }
            throw $failure;
        }
    }

    /** The original outcome of a known id, or a conflict for different content. */
    private function replay(Entry $entry, string $fingerprint): AddedEntry
    {
        $statement = $this->pdo->prepare('SELECT fingerprint, created_at FROM entry_requests WHERE id = ?');
        $statement->execute([$entry->id]);
        $request = $statement->fetch(PDO::FETCH_ASSOC);
        $recordedAt = is_array($request) ? ($request['created_at'] ?? null) : null;
        if (!is_array($request) || $request['fingerprint'] !== $fingerprint || !is_string($recordedAt)) {
            throw new EntryConflict($entry->id);
        }
        $createdAt = new DateTimeImmutable($recordedAt, new DateTimeZone('UTC'));

        return new AddedEntry(new Entry($entry->id, $entry->personId, $entry->drinkId, $entry->quantity, $createdAt), false);
    }

    private function purge(DateTimeImmutable $now): void
    {
        $this->pdo->prepare('DELETE FROM entry_requests WHERE created_at < ?')
            ->execute([Timestamp::of($now->sub(new \DateInterval(self::KEEP_REQUESTS)))]);
    }

    private function exists(string $table, int $id): bool
    {
        $statement = $this->pdo->prepare("SELECT 1 FROM {$table} WHERE id = ?");
        $statement->execute([$id]);

        return $statement->fetchColumn() !== false;
    }

    /**
     * @return array<string, string>
     */
    private static function missing(bool $personExists, bool $drinkExists): array
    {
        return array_filter([
            'personId' => $personExists ? null : 'Person nicht gefunden.',
            'drinkId' => $drinkExists ? null : 'Getränk nicht gefunden.',
        ]);
    }
}
