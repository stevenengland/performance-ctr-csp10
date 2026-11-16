<?php

declare(strict_types=1);

namespace Performance\Domain;

use PDO;
use RuntimeException;

/**
 * Lets one deletion of a parent row run at a time: a person, drink or factor (Catalog) and a
 * game (Games). Two deletions of different parents that share a dependent row (an entry's
 * person and drink, a match's game and person) would each lock their parent and then wait for
 * the other's to snapshot that row: a deadlock. It is a named lock, taken before the
 * transaction holds any row, so no row lock ever waits for it.
 */
final class DeletionLock
{
    /** How long a deletion waits for the one before it; one of 50 000 entries took 1.5 s (runbook, "Audit log"). */
    private const SECONDS = 10;
    /**
     * The name the lock had when only the catalog took it. Kept, so that during a rollout the
     * previous release's catalog deletions and this release's deletions still exclude each other.
     */
    private const NAME = 'performance.catalog-deletion.';

    /**
     * Runs a deletion while this session holds the deletion lock, and releases it afterwards,
     * also when the deletion fails. The lock is server-wide, so its name carries the database's.
     *
     * @param callable(): void $deletion
     *
     * @throws RuntimeException when another deletion holds the lock for longer than SECONDS
     */
    public static function hold(PDO $pdo, callable $deletion): void
    {
        $statement = $pdo->query('SELECT DATABASE()');
        $database = $statement === false ? null : $statement->fetchColumn();
        $lock = self::NAME . substr(is_string($database) ? $database : '', 0, 32);
        $acquire = $pdo->prepare('SELECT GET_LOCK(?, ?)');
        $acquire->execute([$lock, self::SECONDS]);
        if ((int) $acquire->fetchColumn() !== 1) {
            throw new RuntimeException("Another deletion held {$lock} for longer than " . self::SECONDS . ' seconds');
        }
        try {
            $deletion();
        } finally {
            $pdo->prepare('SELECT RELEASE_LOCK(?)')->execute([$lock]);
        }
    }
}
