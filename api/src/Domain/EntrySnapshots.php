<?php

declare(strict_types=1);

namespace Performance\Domain;

use LogicException;
use PDO;

/**
 * Entries as the audit log keeps them, their references resolved as they are now: the person's
 * name, the drink's name and points, the quantity, and the factor's name and multiplier or null.
 *
 * Every read here locks what it reads (ADR 0004): a write transaction never reads without a lock,
 * so it opens no read view that would make its later locking reads fail under MariaDB's snapshot
 * isolation. The referenced person, drink and factor are read under a shared lock only, which an
 * entry insert also takes for its foreign key checks, so the two never wait on each other there.
 *
 * @phpstan-type EntrySnapshot array{person: string, drink: string, points: string, quantity: int, factor: array{name: string, multiplier: string}|null}
 */
final class EntrySnapshots
{
    /** Entries read per statement by `each`: few statements, and one chunk is a few megabytes at most. */
    private const CHUNK_SIZE = 2000;
    /**
     * Entries by primary key, then their person, drink and factor, in exactly that order: a
     * locking read locks every row it scans, so a plan that started from the (small) persons
     * table and reached the entries through the person's index would lock, and wait for, entries
     * other requests are inserting at that moment, while they wait for a row this one holds.
     */
    private const SELECT = 'SELECT STRAIGHT_JOIN e.id, p.name AS person, d.name AS drink, d.points, e.quantity, f.name AS factor, f.multiplier
        FROM entries e FORCE INDEX (PRIMARY) JOIN persons p ON p.id = e.person_id JOIN drinks d ON d.id = e.drink_id
        LEFT JOIN factors f ON f.id = e.factor_id';

    /**
     * One entry whose row the transaction holds already.
     *
     * @return EntrySnapshot
     */
    public static function of(PDO $pdo, string $id): array
    {
        $statement = $pdo->prepare(self::SELECT . ' WHERE e.id = ? LOCK IN SHARE MODE');
        $statement->execute([$id]);
        /** @var array<string, scalar|null>|false $row */
        $row = $statement->fetch(PDO::FETCH_ASSOC);
        if ($row === false) {
            throw new LogicException("Entry {$id} is not there to be recorded");
        }

        return self::snapshot($row);
    }

    /**
     * Locks the entries that reference a person, drink or factor for update and returns their
     * ids in id order. The rows are locked in the order of the parent's index (a person's by
     * time, a drink's and a factor's by id); deletions run one at a time (Catalog), so the order
     * in which two of them would lock shared entries never matters. The parent's row must be
     * locked first: then no entry can be added to it or taken from it until the transaction ends.
     *
     * @return list<string>
     */
    public static function lockReferencing(PDO $pdo, AuditSubjectKind $parent, int $parentId): array
    {
        // The index is forced so the locks cover exactly the parent's entries, whatever the
        // optimizer would pick on a small table: a full scan would also lock (and wait for) an
        // entry another transaction is inserting for a different parent.
        [$column, $index] = match ($parent) {
            AuditSubjectKind::Person => ['person_id', 'entries_person'],
            AuditSubjectKind::Drink => ['drink_id', 'entries_drink'],
            AuditSubjectKind::Factor => ['factor_id', 'entries_factor'],
            AuditSubjectKind::Entry => throw new LogicException('Entries reference no entries'),
        };
        $statement = $pdo->prepare("SELECT id FROM entries FORCE INDEX ({$index}) WHERE {$column} = ? FOR UPDATE");
        $statement->execute([$parentId]);
        /** @var list<string> $ids */
        $ids = $statement->fetchAll(PDO::FETCH_COLUMN);
        sort($ids, SORT_STRING);

        return $ids;
    }

    /**
     * The snapshots of entries the transaction holds already, in the order of the ids given,
     * read CHUNK_SIZE at a time: a deletion of tens of thousands of entries never holds more
     * than one chunk of them in memory.
     *
     * Their references are read under a shared lock only. Locking them for update would wait
     * for an entry insert that holds them shared (for its foreign key checks) while it waits
     * for the parent the caller holds: a deadlock.
     *
     * @param list<string> $ids
     *
     * @return iterable<string, EntrySnapshot> keyed by entry id
     */
    public static function each(PDO $pdo, array $ids): iterable
    {
        foreach (array_chunk($ids, self::CHUNK_SIZE) as $chunk) {
            $statement = $pdo->prepare(
                self::SELECT . ' WHERE e.id IN (' . implode(', ', array_fill(0, count($chunk), '?')) . ') ORDER BY e.id LOCK IN SHARE MODE',
            );
            $statement->execute($chunk);
            /** @var array<string, scalar|null> $row */
            foreach ($statement->fetchAll(PDO::FETCH_ASSOC) as $row) {
                yield (string) $row['id'] => self::snapshot($row);
            }
        }
    }

    /**
     * @param array<string, scalar|null> $row
     *
     * @return EntrySnapshot
     */
    private static function snapshot(array $row): array
    {
        return [
            'person' => (string) $row['person'],
            'drink' => (string) $row['drink'],
            'points' => (string) $row['points'],
            'quantity' => (int) $row['quantity'],
            'factor' => $row['factor'] === null ? null : ['name' => (string) $row['factor'], 'multiplier' => (string) $row['multiplier']],
        ];
    }
}
