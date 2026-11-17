<?php

declare(strict_types=1);

namespace Performance\Domain;

use PDO;

/**
 * The schema steps of the four-eyes rule (PRD #61), the same for each row table (`entries`,
 * `matches`, `results`): one guarded DDL statement per step, each with its algorithm stated, so
 * MariaDB fails instead of copying the table (ADR 0006, rule 2). Each table's migrations call
 * these with their table's name.
 *
 * - The columns: `pending` (default 0, so every existing row and every insert of the previous
 *   release counts as verified), `verified_at` and `verified_by_account_id`, both null. INSTANT.
 * - The pending index `<table>_pending (pending, created_at DESC, id, account_id)`, which
 *   serves the pending queue (PendingQuery): its order is the queue's (newest first, then id),
 *   so a page reads only as many entries as it shows plus the reader's own rows it skips, and
 *   `account_id` lets both the page and the count leave those out inside the index; a count
 *   reads the index alone. Without `id` and `account_id`, a fifth of rows pending made MariaDB
 *   scan the whole table (PendingQueuePlanTest). INPLACE, LOCK=NONE.
 * - The verifier foreign key `<table>_verifier`, cleared when its account is deleted. MariaDB
 *   adds a foreign key in place only with foreign key checks off; that is safe here because
 *   every value of the new column is null at that moment. INPLACE, LOCK=NONE.
 */
final class VerificationSchema
{
    private const COLUMNS = ['pending', 'verified_at', 'verified_by_account_id'];

    public static function hasColumns(PDO $pdo, string $table): bool
    {
        $statement = $pdo->prepare(
            'SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME IN (?, ?, ?)',
        );
        $statement->execute([$table, ...self::COLUMNS]);

        return (int) $statement->fetchColumn() === count(self::COLUMNS);
    }

    /** One ALTER, which InnoDB applies atomically: all three columns exist, or none. */
    public static function addColumns(PDO $pdo, string $table): void
    {
        $pdo->exec(
            "ALTER TABLE {$table}
                ADD COLUMN pending TINYINT(1) NOT NULL DEFAULT 0,
                ADD COLUMN verified_at DATETIME(3) NULL,
                ADD COLUMN verified_by_account_id INT UNSIGNED NULL,
                ALGORITHM=INSTANT",
        );
    }

    public static function hasPendingIndex(PDO $pdo, string $table): bool
    {
        $statement = $pdo->prepare(
            'SELECT COUNT(*) FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND INDEX_NAME = ?',
        );
        $statement->execute([$table, "{$table}_pending"]);

        return (int) $statement->fetchColumn() > 0;
    }

    public static function addPendingIndex(PDO $pdo, string $table): void
    {
        $pdo->exec("ALTER TABLE {$table} ADD KEY {$table}_pending (pending, created_at DESC, id, account_id), ALGORITHM=INPLACE, LOCK=NONE");
    }

    public static function hasVerifierForeignKey(PDO $pdo, string $table): bool
    {
        $statement = $pdo->prepare(
            "SELECT COUNT(*) FROM information_schema.TABLE_CONSTRAINTS
              WHERE CONSTRAINT_SCHEMA = DATABASE() AND TABLE_NAME = ? AND CONSTRAINT_NAME = ? AND CONSTRAINT_TYPE = 'FOREIGN KEY'",
        );
        $statement->execute([$table, "{$table}_verifier"]);

        return (int) $statement->fetchColumn() > 0;
    }

    /**
     * Switches foreign key checks off on this connection only, for this one statement, and
     * restores the session's previous setting afterwards, whether the statement succeeded or
     * failed: the migration runs on the request's connection, which goes on serving it.
     */
    public static function addVerifierForeignKey(PDO $pdo, string $table): void
    {
        $statement = $pdo->query('SELECT @@SESSION.foreign_key_checks');
        $previous = $statement === false ? 1 : (int) $statement->fetchColumn();
        $pdo->exec('SET SESSION foreign_key_checks = 0');
        try {
            $pdo->exec(
                "ALTER TABLE {$table}
                    ADD CONSTRAINT {$table}_verifier FOREIGN KEY (verified_by_account_id) REFERENCES accounts (id) ON DELETE SET NULL,
                    ALGORITHM=INPLACE, LOCK=NONE",
            );
        } finally {
            $pdo->exec(sprintf('SET SESSION foreign_key_checks = %d', $previous));
        }
    }
}
