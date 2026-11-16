<?php

declare(strict_types=1);

namespace Performance\Domain;

use DateTimeImmutable;
use DateTimeZone;
use PDO;
use PDOException;

/**
 * The entry log. Adding is idempotent on the client's entry id, through the shared retry
 * keys (Idempotency): a known id answers with the original outcome and never recreates an
 * undone entry; different content under a known id is a conflict. It also lists a person's
 * entries of a day. Adding and deleting name their actor and are recorded in the audit log in
 * their own transaction, with the entry as it is then; a replay, a conflict or a failure
 * records nothing. A new entry waits for verification; as VerifiableRows it lets Verification
 * decide on one inside Verification's transaction.
 */
final readonly class EntryLedger implements VerifiableRows
{
    public const MAX_QUANTITY = 99;
    /** The pending entries an account (the parameter) may verify: those another account or one deleted since recorded. */
    private const MAY_VERIFY = 'e.pending = 1 AND (e.account_id IS NULL OR e.account_id <> ?)';

    public function __construct(
        private PDO $pdo,
        private Clock $clock,
        private DataRevision $revision,
        private AuditLog $audit,
        private Idempotency $idempotency,
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
        $fingerprint = self::fingerprint($personId, $drinkId, $quantity, $factorId);

        // A missing id is a row that does not exist (ids start at 1): the foreign keys reject it.
        return $this->record(new Entry($id, $personId ?? 0, $drinkId ?? 0, $quantity, $factorId, $now), $fingerprint, $actor);
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
            $this->audit->record($actor, AuditOperation::Delete, AuditSubjectKind::Entry, $id, EntrySnapshots::of($this->pdo, $id), null);
            $this->pdo->prepare('DELETE FROM entries WHERE id = ?')->execute([$id]);
        });
    }

    /**
     * Locked first, like an undo, so the values recorded are the ones the decision is about;
     * the snapshot then reads the entry's person, drink and factor under a shared lock.
     */
    public function lock(string $id): ?VerifiableRow
    {
        $locked = $this->pdo->prepare('SELECT account_id, pending FROM entries WHERE id = ? FOR UPDATE');
        $locked->execute([$id]);
        /** @var array{account_id: int|string|null, pending: int|string}|false $row */
        $row = $locked->fetch(PDO::FETCH_ASSOC);
        if ($row === false) {
            return null;
        }

        return new VerifiableRow(
            $row['account_id'] === null ? null : (int) $row['account_id'],
            (int) $row['pending'] === 1,
            EntrySnapshots::of($this->pdo, $id),
        );
    }

    public function markVerified(string $id, int $accountId, DateTimeImmutable $at): array
    {
        // The account under a shared lock, which its deletion waits for; gone already, it is null.
        $this->pdo->prepare(
            'UPDATE entries SET pending = 0, verified_at = ?,
                    verified_by_account_id = (SELECT a.id FROM accounts a WHERE a.id = ? LOCK IN SHARE MODE)
              WHERE id = ?',
        )->execute([Timestamp::of($at), $accountId, $id]);

        return EntrySnapshots::of($this->pdo, $id);
    }

    public function pending(int $accountId, ?PendingBound $bound, int $limit): array
    {
        $statement = $this->pdo->prepare(
            'SELECT e.id, e.created_at, a.user_name AS account_name, e.person_id, p.name AS person_name, e.drink_id,
                    d.name AS drink_name, e.quantity, e.factor_id, f.name AS factor_name, f.multiplier
               FROM entries e JOIN persons p ON p.id = e.person_id JOIN drinks d ON d.id = e.drink_id
               LEFT JOIN factors f ON f.id = e.factor_id LEFT JOIN accounts a ON a.id = e.account_id
              WHERE ' . self::MAY_VERIFY
            . match (true) {
                $bound === null => '',
                $bound->afterId === null => ' AND e.created_at < ?',
                default => ' AND (e.created_at < ? OR (e.created_at = ? AND e.id > ?))',
            }
            . ' ORDER BY e.created_at DESC, e.id LIMIT ' . $limit,
        );
        $at = $bound === null ? null : Timestamp::of($bound->createdAt);
        $statement->execute(match (true) {
            $bound === null => [$accountId],
            $bound->afterId === null => [$accountId, $at],
            default => [$accountId, $at, $at, $bound->afterId],
        });
        /** @var list<array<string, scalar|null>> $rows */
        $rows = $statement->fetchAll(PDO::FETCH_ASSOC);

        return array_map(self::pendingItem(...), $rows);
    }

    public function countPending(int $accountId): int
    {
        $statement = $this->pdo->prepare('SELECT COUNT(*) FROM entries e WHERE ' . self::MAY_VERIFY);
        $statement->execute([$accountId]);

        return (int) $statement->fetchColumn();
    }

    /**
     * @param array<string, scalar|null> $row
     */
    private static function pendingItem(array $row): PendingItem
    {
        return new PendingItem(
            VerifiableKind::Entry,
            (string) $row['id'],
            new DateTimeImmutable((string) $row['created_at'], new DateTimeZone('UTC')),
            $row['account_name'] === null ? null : (string) $row['account_name'],
            new PendingEntry(
                (int) $row['person_id'],
                (string) $row['person_name'],
                (int) $row['drink_id'],
                (string) $row['drink_name'],
                (int) $row['quantity'],
                $row['factor_id'] === null ? null : new HistoryFactor((int) $row['factor_id'], (string) $row['factor_name'], (string) $row['multiplier']),
            ),
        );
    }

    /**
     * A person's entries since `from` (the start of the viewer's day), newest first, pending
     * ones included and marked.
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
                    e.created_at, a.user_name AS account_name, e.pending
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
            (int) $row['pending'] === 1,
        );
    }

    private function record(Entry $entry, string $fingerprint, Actor $actor): AddedEntry
    {
        try {
            $recordedAt = $this->idempotency->write($entry->id, $fingerprint, $entry->createdAt, function () use ($entry, $actor): void {
                $this->pdo->prepare(
                    'INSERT INTO entries (id, person_id, drink_id, quantity, factor_id, account_id, created_at, pending) VALUES (?, ?, ?, ?, ?, ?, ?, 1)',
                )->execute([
                    $entry->id,
                    $entry->personId,
                    $entry->drinkId,
                    $entry->quantity,
                    $entry->factorId,
                    $actor->accountId,
                    Timestamp::of($entry->createdAt),
                ]);
                $this->audit->record($actor, AuditOperation::Create, AuditSubjectKind::Entry, $entry->id, null, EntrySnapshots::of($this->pdo, $entry->id));
            });
        } catch (RequestConflict) {
            throw new EntryConflict($entry->id);
        } catch (PDOException $failure) {
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

        return $recordedAt === null
            ? new AddedEntry($entry, true)
            : new AddedEntry(new Entry($entry->id, $entry->personId, $entry->drinkId, $entry->quantity, $entry->factorId, $recordedAt), false);
    }

    /**
     * The content a known id must repeat. Without a factor it is the shape from before
     * factors existed, so requests recorded then still replay.
     */
    private static function fingerprint(?int $personId, ?int $drinkId, int $quantity, ?int $factorId): string
    {
        return Idempotency::fingerprint(
            Idempotency::ENTRY,
            $factorId === null ? [$personId, $drinkId, $quantity] : [$personId, $drinkId, $quantity, $factorId],
        );
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
