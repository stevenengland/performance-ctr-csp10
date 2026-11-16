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
    private const SELECT = 'SELECT e.id, p.name AS person, d.name AS drink, d.points, e.quantity, f.name AS factor, f.multiplier
        FROM entries e %s JOIN persons p ON p.id = e.person_id JOIN drinks d ON d.id = e.drink_id
        LEFT JOIN factors f ON f.id = e.factor_id';

    /**
     * One entry whose row the transaction holds already.
     *
     * @return EntrySnapshot
     */
    public static function of(PDO $pdo, string $id): array
    {
        $statement = $pdo->prepare(sprintf(self::SELECT, '') . ' WHERE e.id = ? LOCK IN SHARE MODE');
        $statement->execute([$id]);
        /** @var array<string, scalar|null>|false $row */
        $row = $statement->fetch(PDO::FETCH_ASSOC);
        if ($row === false) {
            throw new LogicException("Entry {$id} is not there to be recorded");
        }

        return self::snapshot($row);
    }

    /**
     * Locks the entries that reference a person, drink or factor for update, in id order, and
     * reads them. The parent's row must be locked first: then no entry can be added to it or
     * taken from it until the transaction ends.
     *
     * @return list<array{string, EntrySnapshot}> each entry's id and snapshot, in id order
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
        // Two statements: the entries for update, then their references under a shared lock.
        // Locking the references for update too would wait for an insert that holds them shared
        // while it waits for the parent: a deadlock.
        $pdo->prepare("SELECT id FROM entries FORCE INDEX ({$index}) WHERE {$column} = ? ORDER BY id FOR UPDATE")
            ->execute([$parentId]);
        $statement = $pdo->prepare(
            sprintf(self::SELECT, "FORCE INDEX ({$index})") . " WHERE e.{$column} = ? ORDER BY e.id LOCK IN SHARE MODE",
        );
        $statement->execute([$parentId]);
        /** @var list<array<string, scalar|null>> $rows */
        $rows = $statement->fetchAll(PDO::FETCH_ASSOC);

        return array_map(static fn(array $row): array => [(string) $row['id'], self::snapshot($row)], $rows);
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
