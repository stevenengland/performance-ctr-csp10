<?php

declare(strict_types=1);

use Performance\Domain\Migration;

/** An INSTANT column on `accounts`: cheap, but it still waits for the table's metadata lock. */
return new class implements Migration {
    public function isApplied(PDO $pdo): bool
    {
        $statement = $pdo->query(
            "SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'accounts' AND COLUMN_NAME = 'lock_probe'",
        );

        return $statement !== false && (int) $statement->fetchColumn() > 0;
    }

    public function apply(PDO $pdo): void
    {
        $pdo->exec('ALTER TABLE accounts ADD COLUMN lock_probe TINYINT(1) NOT NULL DEFAULT 0, ALGORITHM=INSTANT');
    }
};
