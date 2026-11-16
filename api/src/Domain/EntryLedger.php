<?php

declare(strict_types=1);

namespace Performance\Domain;

use DateTimeImmutable;
use DateTimeZone;
use LogicException;
use PDO;
use PDOException;

/**
 * The entry log. Adding is idempotent on the client's entry id: the id and a
 * fingerprint of the content are recorded in `entry_requests` in the same
 * transaction as the entry, and its primary key settles concurrent duplicates.
 * A known id answers with the original outcome and never recreates an undone
 * entry; different content under a known id is a conflict. Requests are kept
 * seven days and purged on a later add. It also lists a person's entries of a day.
 * Adding and deleting name their actor and are recorded in the audit log in their own
 * transaction, with the entry as it is then; a replay, a conflict or a failure records nothing.
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
        private AuditLog $audit,
    ) {}

    /**
     * @param int|null $factorId null for no factor (counts ×1)
     *
     * @throws ValidationFailed for a quantity outside 1–99 or a person, drink or factor that does not exist
     * @throws EntryConflict when the id was used before for different content, factor included
     */
    public function add(Actor $actor, string $id, ?int $personId, ?int $drinkId, ?int $quantity, ?int $factorId): AddedEntry
    {
        if ($quantity === null || $quantity < 1 || $quantity > self::MAX_QUANTITY) {
            throw new ValidationFailed(['quantity' => sprintf('1 bis %d.', self::MAX_QUANTITY)]);
        }
        $now = $this->clock->now();
        $this->purge($now);
        $fingerprint = self::fingerprint($personId, $drinkId, $quantity, $factorId);

        for ($attempt = 1; ; ++$attempt) {
            try {
                // A missing id is a row that does not exist (ids start at 1): the foreign keys reject it.
                return $this->record(new Entry($id, $personId ?? 0, $drinkId ?? 0, $quantity, $factorId, $now), $fingerprint, $actor);
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
    public function delete(Actor $actor, string $id): void
    {
        $this->revision->write(function () use ($actor, $id): void {
            // Locked first, so the values recorded are the ones this deletion removes.
            $locked = $this->pdo->prepare('SELECT id FROM entries WHERE id = ? FOR UPDATE');
            $locked->execute([$id]);
            if ($locked->fetchColumn() === false) {
                throw new NotFound($id);
            }
            $this->audit->record($actor, AuditOperation::Delete, AuditSubjectKind::Entry, $id, $this->snapshot($id), null);
            $this->pdo->prepare('DELETE FROM entries WHERE id = ?')->execute([$id]);
        });
    }

    /**
     * A person's entries since `from` (the start of the viewer's day), newest first.
     *
     * @return list<HistoryEntry>
     *
     * @throws NotFound when there is no such person
     */
    public function ofPersonSince(int $personId, DateTimeImmutable $from): array
    {
        if (!$this->exists('persons', $personId)) {
            throw new NotFound((string) $personId);
        }
        $statement = $this->pdo->prepare(
            'SELECT e.id, e.drink_id, d.name AS drink_name, e.quantity, e.factor_id, f.name AS factor_name, f.multiplier,
                    e.created_at, a.user_name AS account_name
             FROM entries e JOIN drinks d ON d.id = e.drink_id
             LEFT JOIN factors f ON f.id = e.factor_id LEFT JOIN accounts a ON a.id = e.account_id
             WHERE e.person_id = ? AND e.created_at >= ?
             ORDER BY e.created_at DESC, e.id DESC',
        );
        $statement->execute([$personId, Timestamp::of($from)]);
        /** @var list<array<string, scalar|null>> $rows */
        $rows = $statement->fetchAll(PDO::FETCH_ASSOC);

        return array_map(self::historyEntry(...), $rows);
    }

    /**
     * @param array<string, scalar|null> $row
     */
    private static function historyEntry(array $row): HistoryEntry
    {
        return new HistoryEntry(
            (string) $row['id'],
            (int) $row['drink_id'],
            (string) $row['drink_name'],
            (int) $row['quantity'],
            $row['factor_id'] === null ? null : new HistoryFactor((int) $row['factor_id'], (string) $row['factor_name'], (string) $row['multiplier']),
            new DateTimeImmutable((string) $row['created_at'], new DateTimeZone('UTC')),
            $row['account_name'] === null ? null : (string) $row['account_name'],
        );
    }

    private function record(Entry $entry, string $fingerprint, Actor $actor): AddedEntry
    {
        try {
            $this->revision->write(function () use ($entry, $fingerprint, $actor): void {
                $this->pdo->prepare('INSERT INTO entry_requests (id, fingerprint, created_at) VALUES (?, ?, ?)')
                    ->execute([$entry->id, $fingerprint, Timestamp::of($entry->createdAt)]);
                $this->pdo->prepare(
                    'INSERT INTO entries (id, person_id, drink_id, quantity, factor_id, account_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
                )->execute([
                    $entry->id,
                    $entry->personId,
                    $entry->drinkId,
                    $entry->quantity,
                    $entry->factorId,
                    $actor->accountId,
                    Timestamp::of($entry->createdAt),
                ]);
                $this->audit->record($actor, AuditOperation::Create, AuditSubjectKind::Entry, $entry->id, null, $this->snapshot($entry->id));
            });

            return new AddedEntry($entry, true);
        } catch (PDOException $failure) {
            if (DatabaseError::is($failure, DatabaseError::DUPLICATE_KEY)) {
                return $this->replay($entry, $fingerprint);
            }
            $missing = DatabaseError::is($failure, DatabaseError::MISSING_PARENT)
                ? self::missing(
                    $this->exists('persons', $entry->personId),
                    $this->exists('drinks', $entry->drinkId),
                    $entry->factorId === null || $this->exists('factors', $entry->factorId),
                )
                : [];
            if ($missing !== []) {
                throw new ValidationFailed($missing);
            }
            throw $failure;
        }
    }

    /**
     * An entry as the audit log keeps it, its references resolved as they are now: the person's
     * name, the drink's name and points, the quantity, and the factor's name and multiplier or null.
     *
     * @return array{person: string, drink: string, points: string, quantity: int, factor: array{name: string, multiplier: string}|null}
     */
    private function snapshot(string $id): array
    {
        $statement = $this->pdo->prepare(
            'SELECT p.name AS person, d.name AS drink, d.points, e.quantity, f.name AS factor, f.multiplier
             FROM entries e JOIN persons p ON p.id = e.person_id JOIN drinks d ON d.id = e.drink_id
             LEFT JOIN factors f ON f.id = e.factor_id
             WHERE e.id = ?',
        );
        $statement->execute([$id]);
        /** @var array<string, scalar|null>|false $row */
        $row = $statement->fetch(PDO::FETCH_ASSOC);
        if ($row === false) {
            throw new LogicException("Entry {$id} is not there to be recorded");
        }

        return [
            'person' => (string) $row['person'],
            'drink' => (string) $row['drink'],
            'points' => (string) $row['points'],
            'quantity' => (int) $row['quantity'],
            'factor' => $row['factor'] === null ? null : ['name' => (string) $row['factor'], 'multiplier' => (string) $row['multiplier']],
        ];
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

        return new AddedEntry(new Entry($entry->id, $entry->personId, $entry->drinkId, $entry->quantity, $entry->factorId, $createdAt), false);
    }

    /**
     * The content a known id must repeat. Without a factor it is the shape from before
     * factors existed, so requests recorded then still replay.
     */
    private static function fingerprint(?int $personId, ?int $drinkId, int $quantity, ?int $factorId): string
    {
        $content = $factorId === null ? [$personId, $drinkId, $quantity] : [$personId, $drinkId, $quantity, $factorId];

        return hash('sha256', json_encode($content, JSON_THROW_ON_ERROR));
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
    private static function missing(bool $personExists, bool $drinkExists, bool $factorExists): array
    {
        return array_filter([
            'personId' => $personExists ? null : 'Person nicht gefunden.',
            'drinkId' => $drinkExists ? null : 'Getränk nicht gefunden.',
            'factorId' => $factorExists ? null : 'Faktor nicht gefunden.',
        ]);
    }
}
